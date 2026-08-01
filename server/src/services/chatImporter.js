import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { injectMarkdownConverter, dedupeOutermostScript } from './htmlToMarkdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

/**
 * Chat Importer Service
 * Scrapes shared conversations from Claude.ai and ChatGPT using headless browser
 */

class ChatImporter {
  constructor() {
    this.browser = null;
  }

  /**
   * Legacy hand-rolled HTML-to-Markdown converter, retained as a fallback
   * only. The primary path uses turndown via injectMarkdownConverter() —
   * this kept GFM tables broken, lacked code-fence escalation, and didn't
   * filter accessibility twins. Kept here so a future debugger can A/B
   * if turndown ever produces something surprising.
   */
  get htmlToMarkdownFn() {
    return function htmlToMarkdown(el) {
      function convert(node, listDepth = 0) {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();

        // Pre/code blocks — preserve exactly
        if (tag === 'pre') {
          const codeEl = node.querySelector('code');
          const code = codeEl ? codeEl.textContent : node.textContent;
          // Try to detect language from class
          const langClass = (codeEl || node).className.match(/language-(\w+)/);
          const lang = langClass ? langClass[1] : '';
          return '\n\n```' + lang + '\n' + code + '\n```\n\n';
        }

        // Inline code
        if (tag === 'code') {
          return '`' + node.textContent + '`';
        }

        // Headings
        if (/^h[1-6]$/.test(tag)) {
          const level = parseInt(tag[1]);
          const inner = childrenToMd(node, listDepth);
          return '\n\n' + '#'.repeat(level) + ' ' + inner.trim() + '\n\n';
        }

        // Bold
        if (tag === 'strong' || tag === 'b') {
          return '**' + childrenToMd(node, listDepth) + '**';
        }

        // Italic
        if (tag === 'em' || tag === 'i') {
          return '*' + childrenToMd(node, listDepth) + '*';
        }

        // Links
        if (tag === 'a') {
          const href = node.getAttribute('href') || '';
          const text = childrenToMd(node, listDepth);
          return '[' + text + '](' + href + ')';
        }

        // Unordered list
        if (tag === 'ul') {
          let result = '\n';
          node.querySelectorAll(':scope > li').forEach(li => {
            const indent = '  '.repeat(listDepth);
            result += indent + '- ' + childrenToMd(li, listDepth + 1).trim() + '\n';
          });
          return result + '\n';
        }

        // Ordered list
        if (tag === 'ol') {
          let result = '\n';
          let i = 1;
          node.querySelectorAll(':scope > li').forEach(li => {
            const indent = '  '.repeat(listDepth);
            result += indent + i + '. ' + childrenToMd(li, listDepth + 1).trim() + '\n';
            i++;
          });
          return result + '\n';
        }

        // List items handled by parent
        if (tag === 'li') {
          return childrenToMd(node, listDepth);
        }

        // Block elements get newlines
        if (tag === 'p') {
          return '\n\n' + childrenToMd(node, listDepth).trim() + '\n\n';
        }
        if (tag === 'br') {
          return '\n';
        }
        if (tag === 'blockquote') {
          const inner = childrenToMd(node, listDepth).trim();
          return '\n\n' + inner.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
        }
        if (tag === 'hr') {
          return '\n\n---\n\n';
        }

        // Tables
        if (tag === 'table') {
          let md = '\n\n';
          const rows = node.querySelectorAll('tr');
          rows.forEach((row, ri) => {
            const cells = row.querySelectorAll('th, td');
            const cellTexts = Array.from(cells).map(c => childrenToMd(c, listDepth).trim());
            md += '| ' + cellTexts.join(' | ') + ' |\n';
            if (ri === 0) {
              md += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\n';
            }
          });
          return md + '\n';
        }

        // Skip images (handled separately), script, style
        if (tag === 'img' || tag === 'script' || tag === 'style' || tag === 'svg') return '';

        // Default: recurse into children
        return childrenToMd(node, listDepth);
      }

      function childrenToMd(node, listDepth) {
        let result = '';
        for (const child of node.childNodes) {
          result += convert(child, listDepth);
        }
        return result;
      }

      // Convert and clean up excessive whitespace
      let md = convert(el);
      md = md.replace(/\n{3,}/g, '\n\n');
      return md.trim();
    };
  }

  /**
   * Initialize browser instance (reuse across requests)
   */
  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--disable-blink-features=AutomationControlled'
        ]
      });
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Detect platform from URL via strict hostname check (prevents SSRF).
   * Only allows https URLs on claude.ai or chatgpt.com (or their subdomains).
   */
  detectPlatform(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
    if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) return 'chatgpt';
    return null;
  }

  /**
   * Read CDP stream
   */
  async readCDPStream(client, streamHandle) {
    let eof = false;
    let data = '';

    while (!eof) {
      const response = await client.send('IO.read', { handle: streamHandle });
      data += response.data;
      eof = response.eof;
    }

    await client.send('IO.close', { handle: streamHandle });
    return data;
  }

  /**
   * Download image from URL and save to uploads directory
   * Returns object with filename and metadata
   */
  async downloadImage(page, imageUrl, messageIndex, interceptedImages = null) {
    try {
      console.log(`[ChatImporter] Attempting to download image: ${imageUrl.substring(0, 100)}...`);

      // Ensure directory exists
      const uploadDir = path.join(__dirname, '../../../public/uploads/imported-images');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`[ChatImporter] Created directory: ${uploadDir}`);
      }

      let buffer, contentType;

      // Check if we have this image from request interception
      if (interceptedImages && interceptedImages.has(imageUrl)) {
        console.log(`[ChatImporter] Using intercepted image data`);
        const intercepted = interceptedImages.get(imageUrl);
        buffer = intercepted.buffer;
        contentType = intercepted.contentType;
      }
      // Handle data URLs (base64 encoded images)
      else if (imageUrl.startsWith('data:')) {
        const matches = imageUrl.match(/^data:(.+?);base64,(.+)$/);
        if (!matches) {
          console.warn('[ChatImporter] Invalid data URL format');
          return null;
        }

        contentType = matches[1];
        const base64Data = matches[2];
        buffer = Buffer.from(base64Data, 'base64');
      }
      // Handle regular URLs - convert image to base64 in browser context
      else {
        console.log(`[ChatImporter] Converting image to base64...`);

        const imgData = await page.evaluate(async (url) => {
          return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = function() {
              try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const dataUrl = canvas.toDataURL('image/png');
                resolve({
                  success: true,
                  dataUrl: dataUrl,
                  width: canvas.width,
                  height: canvas.height
                });
              } catch (err) {
                reject(new Error(`Canvas conversion failed: ${err.message}`));
              }
            };

            img.onerror = function() {
              reject(new Error('Image failed to load in browser'));
            };

            setTimeout(() => reject(new Error('Image load timeout (10s)')), 10000);
            img.src = url;
          });
        }, imageUrl);

        if (!imgData.success) {
          throw new Error('Failed to convert image to base64');
        }

        const base64Data = imgData.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
        contentType = 'image/png';
      }

      // Now save the image (common path for all methods)
      let ext = 'png';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
      else if (contentType.includes('gif')) ext = 'gif';
      else if (contentType.includes('webp')) ext = 'webp';
      else if (imageUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        ext = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)[1].toLowerCase();
      }

      const filename = `${crypto.randomUUID()}.${ext}`;
      const filepath = path.join(uploadDir, filename);

      fs.writeFileSync(filepath, buffer);

      console.log(`[ChatImporter] Saved image: ${filename} (${buffer.length} bytes, type: ${contentType})`);

      return {
        type: 'image',
        filename,
        originalUrl: imageUrl,
        size: buffer.length,
        mimeType: contentType
      };

    } catch (error) {
      console.error(`[ChatImporter] Failed to download image ${imageUrl}:`, error.message);
      console.error(`[ChatImporter] Error stack:`, error.stack);
      return null;
    }
  }

  /**
   * Main import function - detects platform and scrapes accordingly
   */
  async importChat(shareUrl) {
    const platform = this.detectPlatform(shareUrl);

    if (!platform) {
      throw new Error('Unsupported platform. Only Claude.ai and ChatGPT share links are supported.');
    }

    console.log(`[ChatImporter] Importing from ${platform}: ${shareUrl}`);

    try {
      if (platform === 'claude') {
        return await this.scrapeClaude(shareUrl);
      } else if (platform === 'chatgpt') {
        return await this.scrapeChatGPT(shareUrl);
      }
    } catch (error) {
      console.error(`[ChatImporter] Error importing from ${platform}:`, error);
      throw error;
    }
  }

  /**
   * Scrape Claude.ai shared conversation
   */
  async scrapeClaude(url) {
    const browser = await this.initBrowser();
    const page = await browser.newPage();

    // Store intercepted images
    const interceptedImages = new Map();

    try {
      console.log('[ChatImporter] Loading Claude share page...');

      // Set viewport and user agent to avoid detection
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Enable request interception to capture images
      await page.setRequestInterception(true);

      page.on('request', request => {
        // Allow all requests to continue
        request.continue();
      });

      page.on('response', async response => {
        const contentType = response.headers()['content-type'] || '';
        const url = response.url();

        // Capture image responses
        if (contentType.startsWith('image/') ||
            url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i) ||
            url.includes('oaiusercontent.com/file-') ||
            url.includes('mm.bing.net')) {
          try {
            const buffer = await response.buffer();
            if (buffer && buffer.length > 0) {
              console.log(`[ChatImporter] Intercepted image: ${url.substring(0, 80)}... (${buffer.length} bytes)`);
              interceptedImages.set(url, {
                buffer,
                contentType: contentType || 'image/jpeg'
              });
            }
          } catch (err) {
            console.log(`[ChatImporter] Failed to capture image ${url}: ${err.message}`);
          }
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Extract conversation title
      const title = await page.evaluate(() => {
        const titleElement = document.querySelector('h1, title, [class*="title"]');
        return titleElement ? titleElement.textContent.trim() : 'Imported from Claude';
      });

      await injectMarkdownConverter(page);

      const rawMessages = await page.evaluate((dedupeScriptSrc) => {
        new Function(dedupeScriptSrc)();
        const halDedupeOutermost = window.halDedupeOutermost;
        const td = window.__halTurndown;

        const userMsgs = halDedupeOutermost(
          Array.from(document.querySelectorAll('[class*="font-user"]')),
        );
        const assistantMsgs = halDedupeOutermost(
          Array.from(document.querySelectorAll('[class*="font-claude"]')),
        );

        console.log(
          `Found ${userMsgs.length} user messages, ${assistantMsgs.length} assistant messages (post-dedupe)`,
        );

        const all = [
          ...userMsgs.map((el) => ({ role: 'user', el })),
          ...assistantMsgs.map((el) => ({ role: 'assistant', el })),
        ];

        all.sort((a, b) => {
          const rectA = a.el.getBoundingClientRect();
          const rectB = b.el.getBoundingClientRect();
          return rectA.top - rectB.top;
        });

        return all.map((item, idx) => {
          const content = td.turndown(item.el.outerHTML).trim();

          const images = [];
          const imgElements = item.el.querySelectorAll('img');
          console.log(`Message ${idx}: Found ${imgElements.length} img elements`);

          imgElements.forEach((img) => {
            const src = img.src || img.getAttribute('data-src') || img.getAttribute('srcset');
            if (src && !src.includes('/icon') && !src.includes('/avatar') && !src.includes('emoji')) {
              images.push(src);
            }
          });

          return { role: item.role, content, imageUrls: images };
        });
      }, dedupeOutermostScript);

      console.log(`[ChatImporter] Extracted ${rawMessages.length} raw messages from page`);

      // Group consecutive messages from same role and download images
      const messages = [];
      let currentMessage = null;

      for (const msg of rawMessages) {
        if (!msg.content) continue;

        if (currentMessage && currentMessage.role === msg.role) {
          // Same role, append content
          currentMessage.content += '\n\n' + msg.content;
          // Merge image URLs
          if (msg.imageUrls && msg.imageUrls.length > 0) {
            currentMessage.imageUrls = [...(currentMessage.imageUrls || []), ...msg.imageUrls];
          }
        } else {
          // Different role or first message
          if (currentMessage) {
            messages.push(currentMessage);
          }
          currentMessage = {
            role: msg.role,
            content: msg.content,
            imageUrls: msg.imageUrls || []
          };
        }
      }

      // Push last message
      if (currentMessage) {
        messages.push(currentMessage);
      }

      // Download all images
      const totalImages = messages.reduce((sum, msg) => sum + (msg.imageUrls?.length || 0), 0);
      console.log(`[ChatImporter] Found ${interceptedImages.size} intercepted images`);
      console.log(`[ChatImporter] Downloading ${totalImages} images from ${messages.length} messages...`);

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.imageUrls && msg.imageUrls.length > 0) {
          console.log(`[ChatImporter] Message ${i} has ${msg.imageUrls.length} images`);
          const attachments = [];
          for (const imageUrl of msg.imageUrls) {
            const attachment = await this.downloadImage(page, imageUrl, i, interceptedImages);
            if (attachment) {
              attachments.push(attachment);
            }
          }
          if (attachments.length > 0) {
            msg.attachments = attachments;
            console.log(`[ChatImporter] Message ${i} saved ${attachments.length} attachments`);
          }
          delete msg.imageUrls; // Remove temporary field
        }
      }

      const totalSaved = messages.reduce((sum, msg) => sum + (msg.attachments?.length || 0), 0);
      console.log(`[ChatImporter] Successfully saved ${totalSaved} out of ${totalImages} images`);

      await page.close();

      return {
        platform: 'claude',
        title,
        messages,
        importedAt: new Date().toISOString(),
        sourceUrl: url
      };

    } catch (error) {
      await page.close();
      throw new Error(`Failed to scrape Claude conversation: ${error.message}`);
    }
  }

  /**
   * Scrape ChatGPT shared conversation
   */
  async scrapeChatGPT(url) {
    const browser = await this.initBrowser();
    const page = await browser.newPage();

    // Store intercepted images
    const interceptedImages = new Map();

    try {
      console.log('[ChatImporter] Loading ChatGPT share page...');

      // Enable request interception to capture images
      await page.setRequestInterception(true);

      page.on('request', request => {
        request.continue();
      });

      page.on('response', async response => {
        const contentType = response.headers()['content-type'] || '';
        const url = response.url();

        // Capture image responses
        if (contentType.startsWith('image/') ||
            url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i) ||
            url.includes('oaiusercontent.com/file-') ||
            url.includes('mm.bing.net')) {
          try {
            const buffer = await response.buffer();
            if (buffer && buffer.length > 0) {
              console.log(`[ChatImporter] Intercepted image: ${url.substring(0, 80)}... (${buffer.length} bytes)`);
              interceptedImages.set(url, {
                buffer,
                contentType: contentType || 'image/jpeg'
              });
            }
          } catch (err) {
            console.log(`[ChatImporter] Failed to capture image ${url}: ${err.message}`);
          }
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for conversation to load (ChatGPT uses different selectors)
      await page.waitForSelector('[data-message-author-role]', { timeout: 10000 });

      // Extract conversation title
      const title = await page.evaluate(() => {
        const titleElement = document.querySelector('h1, title');
        return titleElement ? titleElement.textContent.trim() : 'Imported from ChatGPT';
      });

      await injectMarkdownConverter(page);

      const rawMessages = await page.evaluate(() => {
        const td = window.__halTurndown;
        const messageElements = document.querySelectorAll('[data-message-author-role]');
        const extracted = [];

        console.log(`Found ${messageElements.length} messages`);

        messageElements.forEach((el, idx) => {
          const role = el.getAttribute('data-message-author-role');
          const contentEl = el.querySelector('[class*="markdown"], [class*="message"], .prose') || el;
          const content = td.turndown(contentEl.outerHTML).trim();

          const images = [];
          const imgElements = el.querySelectorAll('img');
          console.log(`Message ${idx} (${role}): Found ${imgElements.length} img elements`);

          imgElements.forEach((img) => {
            const src = img.src || img.getAttribute('data-src') || img.getAttribute('srcset');
            if (src && !src.includes('/icon') && !src.includes('/avatar') && !src.includes('emoji')) {
              images.push(src);
            }
          });

          if (content && (role === 'user' || role === 'assistant')) {
            extracted.push({ role, content, imageUrls: images });
          }
        });

        return extracted;
      });

      console.log(`[ChatImporter] Extracted ${rawMessages.length} messages from page`);

      // Download all images
      const totalImages = rawMessages.reduce((sum, msg) => sum + (msg.imageUrls?.length || 0), 0);
      console.log(`[ChatImporter] Found ${interceptedImages.size} intercepted images`);
      console.log(`[ChatImporter] Downloading ${totalImages} images from ${rawMessages.length} messages...`);

      const messages = [];
      for (let i = 0; i < rawMessages.length; i++) {
        const msg = rawMessages[i];
        const messageData = {
          role: msg.role,
          content: msg.content
        };

        if (msg.imageUrls && msg.imageUrls.length > 0) {
          console.log(`[ChatImporter] Message ${i} has ${msg.imageUrls.length} images`);
          const attachments = [];
          for (const imageUrl of msg.imageUrls) {
            const attachment = await this.downloadImage(page, imageUrl, i, interceptedImages);
            if (attachment) {
              attachments.push(attachment);
            }
          }
          if (attachments.length > 0) {
            messageData.attachments = attachments;
            console.log(`[ChatImporter] Message ${i} saved ${attachments.length} attachments`);
          }
        }

        messages.push(messageData);
      }

      const totalSaved = messages.reduce((sum, msg) => sum + (msg.attachments?.length || 0), 0);
      console.log(`[ChatImporter] Successfully saved ${totalSaved} out of ${totalImages} images`);

      await page.close();

      return {
        platform: 'chatgpt',
        title,
        messages,
        importedAt: new Date().toISOString(),
        sourceUrl: url
      };

    } catch (error) {
      await page.close();
      throw new Error(`Failed to scrape ChatGPT conversation: ${error.message}`);
    }
  }
}

// Export singleton instance
export const chatImporter = new ChatImporter();

// Cleanup on process exit
process.on('exit', async () => {
  await chatImporter.closeBrowser();
});

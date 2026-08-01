// Ollama AI Service — Chat layer with tool calling support
// Uses the LLM provider abstraction for backend communication.

import prisma from '../config/database.js';
import llmService from './llm.js';
import { WEB_SEARCH_TOOL, executeWebSearch } from './webSearch.js';

const MAX_TOOL_ROUNDS = 3;

class OllamaService {
  async getDefaultModel() {
    return llmService.getDefaultModel();
  }

  /**
   * Extract tool calls from response — handles both native tool_calls
   * and models that return tool calls as JSON in content (e.g. Qwen)
   */
  _extractToolCalls(message, availableTools) {
    if (message.tool_calls && message.tool_calls.length > 0) {
      return message.tool_calls;
    }

    const content = (message.content || '').trim();
    if (!content.startsWith('{') && !content.startsWith('[')) return [];

    try {
      const parsed = JSON.parse(content);
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      const toolNames = new Set(availableTools.map(t => t.function.name));

      const validCalls = calls
        .filter(c => c.name && toolNames.has(c.name) && c.arguments)
        .map(c => ({ function: { name: c.name, arguments: c.arguments } }));

      return validCalls;
    } catch {
      return [];
    }
  }

  async _executeTool(toolCall) {
    const { name, arguments: rawArgs } = toolCall.function;
    // OpenAI format sends arguments as a JSON string; Ollama native sends an object
    const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;

    if (name === 'web_search') {
      const result = await executeWebSearch(args.query);
      return {
        query: args.query,
        resultCount: result.results.length,
        content: result.summary,
      };
    }

    return { error: `Unknown tool: ${name}` };
  }

  async generateResponse(messages, model, options = {}) {
    if (!model) model = await this.getDefaultModel();
    const tools = [WEB_SEARCH_TOOL];
    const toolsUsed = [];

    try {
      let conversationMessages = [...messages];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const data = await llmService.chatCompletion({
          model,
          messages: conversationMessages,
          tools: tools.map(t => t),
          temperature: options.temperature || 0.7,
        });

        const assistantMsg = data.choices?.[0]?.message || {};
        const toolCalls = this._extractToolCalls(assistantMsg, tools);

        if (toolCalls.length === 0) {
          return {
            content: assistantMsg.content || '',
            model: data.model,
            toolsUsed,
          };
        }

        conversationMessages.push({
          role: 'assistant',
          content: assistantMsg.content || '',
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          const rawArgs = toolCall.function.arguments;
          const parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
          console.log(`[Tool] ${toolCall.function.name}(${JSON.stringify(parsedArgs)})`);
          const result = await this._executeTool(toolCall);
          toolsUsed.push({
            tool: toolCall.function.name,
            args: parsedArgs,
            resultCount: result.resultCount,
          });

          conversationMessages.push({
            role: 'tool',
            content: JSON.stringify(result),
          });
        }
      }

      // Exhausted tool rounds — final call without tools
      const finalData = await llmService.chatCompletion({
        model,
        messages: conversationMessages,
        temperature: options.temperature || 0.7,
      });

      return {
        content: finalData.choices?.[0]?.message?.content || '',
        model: finalData.model,
        toolsUsed,
      };
    } catch (error) {
      console.error('Chat generation error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  /**
   * Streaming variant of generateResponse.
   * Tool rounds happen non-streaming (fast); the final LLM response streams
   * content deltas to the provided onChunk callback. Returns full content +
   * model + toolsUsed at the end, just like generateResponse.
   */
  async generateResponseStream(messages, model, options = {}, onChunk) {
    if (!model) model = await this.getDefaultModel();
    const tools = [WEB_SEARCH_TOOL];
    const toolsUsed = [];
    let conversationMessages = [...messages];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const data = await llmService.chatCompletion({
          model,
          messages: conversationMessages,
          tools: tools.map(t => t),
          temperature: options.temperature || 0.7,
        });

        const assistantMsg = data.choices?.[0]?.message || {};
        const toolCalls = this._extractToolCalls(assistantMsg, tools);

        if (toolCalls.length === 0) {
          // No tools requested — stream this round's response to the client.
          // Re-issue as streaming to preserve token-by-token delivery.
          return await this._streamFinalResponse({
            model,
            messages: conversationMessages,
            temperature: options.temperature,
            toolsUsed,
            onChunk,
          });
        }

        // Tool calls present — execute them, loop for another round
        conversationMessages.push({
          role: 'assistant',
          content: assistantMsg.content || '',
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          const rawArgs = toolCall.function.arguments;
          const parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
          console.log(`[Tool] ${toolCall.function.name}(${JSON.stringify(parsedArgs)})`);
          const result = await this._executeTool(toolCall);
          toolsUsed.push({
            tool: toolCall.function.name,
            args: parsedArgs,
            resultCount: result.resultCount,
          });
          conversationMessages.push({
            role: 'tool',
            content: JSON.stringify(result),
          });
        }
      }

      // Exhausted tool rounds — stream final response without tools
      return await this._streamFinalResponse({
        model,
        messages: conversationMessages,
        temperature: options.temperature,
        toolsUsed,
        onChunk,
      });
    } catch (error) {
      console.error('Chat stream generation error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  async _streamFinalResponse({ model, messages, temperature, toolsUsed, onChunk }) {
    const { body, model: streamModel } = await llmService.chatCompletionStream({
      model,
      messages,
      temperature: temperature || 0.7,
    });

    // body is a Web ReadableStream (Node 20 native fetch) — read via getReader()
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              onChunk(delta);
            }
          } catch {
            // Ignore unparseable SSE chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: accumulated,
      model: streamModel,
      toolsUsed,
    };
  }

  async generateCompletion(prompt, model, options = {}) {
    try {
      const result = await llmService.generate({
        model,
        prompt,
        system: options.systemPrompt,
        temperature: options.temperature || 0.7,
      });
      return result.content;
    } catch (error) {
      console.error('Completion error:', error);
      throw new Error('Failed to generate completion');
    }
  }

  async analyzeNotesForBooks(notes) {
    const notesText = notes.map((note, idx) => {
      const title = note.title || 'Untitled';
      const content = note.message?.content || '';
      const userNote = note.note || '';
      return `Note ${idx + 1}: "${title}"\nContent: ${content.substring(0, 200)}...\nUser notes: ${userNote}`;
    }).join('\n\n');

    const systemPrompt = `You are a knowledge organization assistant. Analyze notes and suggest how to group them into books by topic.

Your task:
1. Identify common topics/themes across notes
2. Suggest book titles and descriptions for each group
3. List which notes (by number) belong in each book
4. Return ONLY valid JSON, no other text

Required JSON format:
{
  "books": [
    {
      "title": "Book Title",
      "description": "Brief description",
      "noteIndices": [1, 3, 5]
    }
  ],
  "uncategorized": [2, 4]
}`;

    const prompt = `Analyze these notes and suggest book groupings:\n\n${notesText}\n\nReturn only the JSON response.`;

    try {
      const response = await this.generateCompletion(prompt, null, {
        systemPrompt,
        temperature: 0.3,
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Note analysis error:', error);
      throw new Error('Failed to analyze notes for grouping');
    }
  }

  async getGPUForService(service) {
    try {
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      if (!settings) return null;

      switch (service) {
        case 'chat': return settings.chatGPU || null;
        case 'imageGen': return settings.imageGenGPU || null;
        case 'knowledgeBase': return settings.knowledgeBaseGPU || null;
        default: return null;
      }
    } catch (error) {
      console.error('Failed to get GPU assignment:', error);
      return null;
    }
  }

  async listModels() {
    return llmService.listModels();
  }

  async checkHealth() {
    return llmService.checkHealth();
  }
}

export default new OllamaService();

# HAL Import Extension (experimental)

> ⚠️ **EXPERIMENTAL / in development.** The importer works by scraping the DOM of
> claude.ai / chatgpt.com conversation pages, which change without notice —
> expect selector breakage and rough edges. Bug reports welcome.

A Chrome extension that imports your existing Claude.ai and ChatGPT conversations into HAL, converting them to clean markdown (code fences, tables, and images preserved) so your chat history lives on your own server.

## Install

1. Open `chrome://extensions/`, enable **Developer mode**
2. **Load unpacked** → select this `extension/` directory
3. Click the HAL icon → settings → set your HAL server URL (e.g. `http://your-hal-server:3000`) and log in

## Use

1. Open a conversation on claude.ai or chatgpt.com
2. Click the HAL extension icon → **Import this conversation**
3. The conversation appears in HAL under an "Imported" source tag

Share-URL import (paste a public share link into HAL's Import page) is also available server-side and doesn't need this extension.

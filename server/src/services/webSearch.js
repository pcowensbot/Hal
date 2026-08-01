// Web Search Service — DuckDuckGo integration for HAL chat
import { search as ddgSearch } from 'ddg-search';

/**
 * Tool definition for Ollama function calling
 */
export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the internet for current information. Use this when the user asks about recent events, current data, real-time information, or anything you don\'t have reliable knowledge about.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on the internet',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * Execute a web search and return formatted results
 */
export async function executeWebSearch(query, maxResults = 6) {
  try {
    const data = await ddgSearch(query, { maxPages: 1 });
    const results = (data.results || []).slice(0, maxResults);

    if (results.length === 0) {
      return { query, results: [], summary: 'No results found.' };
    }

    const formatted = results.map((r, i) => ({
      position: i + 1,
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));

    // Build a text summary the model can reason over
    const summary = formatted
      .map((r) => `[${r.position}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
      .join('\n\n');

    return { query, results: formatted, summary };
  } catch (error) {
    console.error('Web search error:', error);
    return {
      query,
      results: [],
      summary: `Search failed: ${error.message}. Answer based on your existing knowledge and let the user know the search didn't work.`,
    };
  }
}

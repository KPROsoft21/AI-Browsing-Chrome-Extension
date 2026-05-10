// AI Page Assistant — Background Service Worker

const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are an AI assistant embedded in a web browser extension. You can see and interact with the current web page.

You have these tools:
- read_page: Get the page URL, title, visible text, and list of interactive elements with unique IDs
- click_element: Click any button, link, or interactive element on the page
- type_text: Fill text inputs, textareas, and select dropdown options
- scroll_page: Scroll the page up, down, to top, or to bottom
- take_screenshot: Capture a screenshot to see the page's visual state

Guidelines:
1. Call read_page first to understand what's on the page before acting
2. Use element IDs from read_page results for precise targeting (most reliable)
3. You can chain multiple tool calls to complete multi-step tasks
4. Take a screenshot when you need to verify visual state
5. After completing actions, confirm what you did and the result`;

const TOOLS = [
  {
    name: 'read_page',
    description: 'Read the current web page. Returns the URL, title, visible text (up to 3000 chars), and a list of interactive elements (buttons, links, inputs, selects) with unique IDs you can use to target them precisely.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'click_element',
    description: 'Click an element on the page. Prefer using element_id from read_page results for reliability. Fallback to selector (CSS selector) or text (visible label/text of the element).',
    input_schema: {
      type: 'object',
      properties: {
        element_id: { type: 'string', description: 'Element ID from read_page (e.g. "el_0", "el_12")' },
        selector:   { type: 'string', description: 'CSS selector, e.g. "#submit-btn", ".nav-link"' },
        text:       { type: 'string', description: 'Visible text of the element, e.g. "Submit", "Sign in"' }
      }
    }
  },
  {
    name: 'type_text',
    description: 'Type text into an input field, textarea, or select a dropdown option. For select elements, set value to the option text or value to select.',
    input_schema: {
      type: 'object',
      properties: {
        element_id:  { type: 'string',  description: 'Element ID from read_page results' },
        selector:    { type: 'string',  description: 'CSS selector for the input' },
        text:        { type: 'string',  description: 'Label, placeholder, or description of the input' },
        value:       { type: 'string',  description: 'The text to type or option to select' },
        clear_first: { type: 'boolean', description: 'Clear existing content first (default: true)' },
        press_enter: { type: 'boolean', description: 'Press Enter after typing (default: false)' }
      },
      required: ['value']
    }
  },
  {
    name: 'scroll_page',
    description: 'Scroll the page in a given direction.',
    input_schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'top', 'bottom'],
          description: 'Scroll direction'
        },
        pixels:   { type: 'number', description: 'Pixels to scroll for up/down (default 400)' },
        selector: { type: 'string', description: 'CSS selector to scroll into view' }
      },
      required: ['direction']
    }
  },
  {
    name: 'take_screenshot',
    description: 'Take a screenshot of the current visible page to see its visual state and layout.',
    input_schema: { type: 'object', properties: {}, required: [] }
  }
];

const TOOL_LABELS = {
  read_page:      '📖 Reading page',
  click_element:  '👆 Clicking element',
  type_text:      '⌨️  Typing text',
  scroll_page:    '↕️  Scrolling',
  take_screenshot:'📸 Taking screenshot'
};

// ── Tab Communication ─────────────────────────────────────────────────────────

async function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: 'No response from content script' });
      }
    });
  });
}

async function ensureContentScript(tabId) {
  const ping = await sendToTab(tabId, { action: 'ping' });
  if (ping.success) return true;

  // Try injecting the content script
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (e) {
    return false;
  }
}

// ── Tool Execution ────────────────────────────────────────────────────────────

async function executeTool(tabId, toolName, input) {
  try {
    switch (toolName) {
      case 'read_page': {
        const r = await sendToTab(tabId, { action: 'getPageSnapshot' });
        return r.success ? r.data : r;
      }
      case 'click_element': {
        return await sendToTab(tabId, {
          action:    'click',
          elementId: input.element_id,
          selector:  input.selector,
          text:      input.text
        });
      }
      case 'type_text': {
        return await sendToTab(tabId, {
          action:    'type',
          elementId: input.element_id,
          selector:  input.selector,
          text:      input.text,
          value:     input.value,
          clearFirst: input.clear_first !== false,
          pressEnter: input.press_enter || false
        });
      }
      case 'scroll_page': {
        return await sendToTab(tabId, {
          action:    'scroll',
          direction: input.direction,
          selector:  input.selector,
          pixels:    input.pixels
        });
      }
      case 'take_screenshot': {
        return await new Promise((resolve) => {
          chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve({ success: true, dataUrl });
            }
          });
        });
      }
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Progress Updates ──────────────────────────────────────────────────────────

function sendProgress(data) {
  chrome.runtime.sendMessage({ type: 'progress', ...data }).catch(() => {});
}

// ── Agent Loop ────────────────────────────────────────────────────────────────

async function runAgentLoop(apiKey, model, messages, tabId) {
  let msgs = [...messages];
  const MAX_ITERS = 12;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    sendProgress({ status: 'Thinking...' });

    const reqBody = {
      model,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      tools: TOOLS,
      messages: msgs
    };

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(reqBody)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();

    // Append assistant turn
    msgs.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'end_turn') {
      const finalText = data.content.find(b => b.type === 'text')?.text || 'Done.';
      return { messages: msgs, finalResponse: finalText };
    }

    if (data.stop_reason !== 'tool_use') break;

    // Process tool calls
    const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const tu of toolUseBlocks) {
      sendProgress({ status: TOOL_LABELS[tu.name] || tu.name + '...' });

      const result = await executeTool(tabId, tu.name, tu.input);

      if (tu.name === 'take_screenshot' && result.success && result.dataUrl) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: [{
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: result.dataUrl.split(',')[1]
            }
          }]
        });
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result)
        });
      }
    }

    msgs.push({ role: 'user', content: toolResults });
  }

  return { messages: msgs, finalResponse: 'Task completed.' };
}

// ── Message Handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'chat') return false;

  (async () => {
    try {
      const { apiKey, model, messages, tabId } = msg;

      // Make sure content script is alive
      const ready = await ensureContentScript(tabId);
      if (!ready) {
        sendResponse({
          success: false,
          error: 'Cannot access this page. Try a regular web page (not chrome:// or extensions pages).'
        });
        return;
      }

      const result = await runAgentLoop(apiKey, model, messages, tabId);
      sendResponse({ success: true, ...result });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();

  return true; // Keep message channel open for async response
});

# AI-Browsing-Tool

A Chrome extension that lets Claude see and interact with any web page. Ask it to do something on the current tab — read content, fill forms, click through flows, scroll, take screenshots — and it will plan and execute the steps for you.

## Features

- **Sees the page** — extracts visible text and a list of interactive elements with stable IDs.
- **Acts on the page** — click, type, scroll, and capture screenshots through a small set of tools.
- **Multi-step reasoning** — chains tool calls in an agent loop until the task is done.
- **Model picker** — switch between Claude Opus, Sonnet, and Haiku from the settings panel.
- **Local-only key storage** — your Anthropic API key stays in `chrome.storage` on your machine.

## How it works

The extension is built on Manifest V3 and three coordinated scripts:

| File | Role |
|------|------|
| `popup.html` / `popup.css` / `popup.js` | Chat UI, settings, and message rendering |
| `background.js` | Service worker that calls the Anthropic API and runs the agent/tool loop |
| `content.js` | Injected into the active tab; reads the DOM and performs clicks/typing/scrolling |

The agent has five tools: `read_page`, `click_element`, `type_text`, `scroll_page`, and `take_screenshot`. The loop runs until Claude returns a final answer or hits the iteration cap.

## Installation

1. Clone this repo.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Pin the extension and open the popup.
6. Click the gear icon, paste your Anthropic API key (`sk-ant-…`), pick a model, and **Save**.

## Usage

Open the popup on any tab and tell it what to do:

- *"Summarize this article."*
- *"Find the contact form and fill in my name and email."*
- *"Scroll to the pricing section and screenshot it."*
- *"Click the first result and read the page."*

The status bar shows which tool is running. Click **+** to start a new conversation.

## Permissions

Declared in `manifest.json`:

- `activeTab`, `scripting`, `tabs` — inject the content script and read/act on the current page.
- `storage` — persist your API key and model choice locally.
- `<all_urls>` — required so the assistant can work on any site you open it on.
- `https://api.anthropic.com/*` — outbound API calls.

No data is sent anywhere except to the Anthropic API.

## Requirements

- A Chromium-based browser with Manifest V3 support.
- An [Anthropic API key](https://console.anthropic.com/).

## Project layout

```
.
├── manifest.json     # MV3 manifest
├── background.js     # Service worker + agent loop + tool dispatch
├── content.js        # In-page DOM reader and action executor
├── popup.html        # Popup markup
├── popup.css         # Popup styles
└── popup.js          # Popup logic and message rendering
```

// AI Page Assistant — Content Script
// Provides page reading and interaction capabilities

const AI_ID_ATTR = 'data-ai-id';
let elementCounter = 0;

// ── Page Snapshot ────────────────────────────────────────────────────────────

function getPageSnapshot() {
  // Clear previous AI IDs
  document.querySelectorAll(`[${AI_ID_ATTR}]`).forEach(el => el.removeAttribute(AI_ID_ATTR));
  elementCounter = 0;

  const interactiveEls = [];
  const seen = new WeakSet();

  const selectors = [
    'a[href]', 'button', 'input:not([type="hidden"])',
    'textarea', 'select', '[role="button"]', '[role="link"]',
    '[role="tab"]', '[role="menuitem"]', '[role="checkbox"]',
    '[role="radio"]', '[role="combobox"]', '[role="textbox"]',
    '[contenteditable="true"]', 'label[for]'
  ];

  document.querySelectorAll(selectors.join(', ')).forEach(el => {
    if (seen.has(el)) return;
    seen.add(el);

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const id = `el_${elementCounter++}`;
    el.setAttribute(AI_ID_ATTR, id);

    const text = (
      el.innerText ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.value ||
      el.getAttribute('alt') ||
      el.getAttribute('name') ||
      ''
    ).trim().substring(0, 100);

    const entry = {
      id,
      tag: el.tagName.toLowerCase(),
      text: text || undefined,
      href: el.getAttribute('href') || undefined,
      name: el.name || el.id || undefined,
      placeholder: el.placeholder || undefined,
      value: el.value !== undefined ? el.value : undefined,
      disabled: el.disabled || undefined,
      role: el.getAttribute('role') || undefined,
      type: el.type || undefined,
      inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight
    };

    // Remove undefined fields for cleaner output
    Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);
    interactiveEls.push(entry);
  });

  // Prefer in-viewport elements, limit to 100
  interactiveEls.sort((a, b) => {
    if (a.inViewport && !b.inViewport) return -1;
    if (!a.inViewport && b.inViewport) return 1;
    return 0;
  });

  return {
    url: window.location.href,
    title: document.title,
    bodyText: document.body.innerText.substring(0, 3000),
    elements: interactiveEls.slice(0, 100),
    scrollY: Math.round(window.scrollY),
    totalHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight
  };
}

// ── Element Finding ───────────────────────────────────────────────────────────

function findElement(elementId, selector, text) {
  if (elementId) {
    const el = document.querySelector(`[${AI_ID_ATTR}="${elementId}"]`);
    if (el) return el;
  }

  if (selector) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch (e) {}
  }

  if (text) {
    const lowerText = text.toLowerCase().trim();
    const candidates = document.querySelectorAll(
      'a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"]'
    );

    let best = null;
    let bestScore = -1;

    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const elText = (
        el.innerText ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        el.value ||
        ''
      ).toLowerCase().trim();

      if (!elText) continue;

      let score = 0;
      if (elText === lowerText) score = 3;
      else if (elText.startsWith(lowerText)) score = 2;
      else if (elText.includes(lowerText)) score = 1;

      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }

    if (bestScore > 0) return best;
  }

  return null;
}

// ── Visual Feedback ───────────────────────────────────────────────────────────

function highlightElement(el) {
  if (!el) return;
  const prev = {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    transition: el.style.transition
  };
  el.style.transition = 'outline 0.15s ease';
  el.style.outline = '2px solid #6d63e8';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = prev.outline;
    el.style.outlineOffset = prev.outlineOffset;
    el.style.transition = prev.transition;
  }, 2000);
}

// ── Click ─────────────────────────────────────────────────────────────────────

function clickElement({ elementId, selector, text }) {
  const el = findElement(elementId, selector, text);
  if (!el) return {
    success: false,
    error: `Element not found (id=${elementId}, selector=${selector}, text=${text})`
  };

  highlightElement(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false }));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
  el.click();
  el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));

  // For links, also try focus
  if (el.tagName === 'A' || el.tagName === 'BUTTON') el.focus();

  return {
    success: true,
    element: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`,
    text: (el.innerText || el.value || '').trim().substring(0, 60)
  };
}

// ── Type ──────────────────────────────────────────────────────────────────────

function typeIntoElement({ elementId, selector, text, value, clearFirst, pressEnter }) {
  const el = findElement(elementId, selector, text);
  if (!el) return {
    success: false,
    error: `Element not found (id=${elementId}, selector=${selector}, text=${text})`
  };

  highlightElement(el);
  el.focus();
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Handle <select>
  if (el.tagName === 'SELECT') {
    const options = Array.from(el.options);
    const match = options.find(o =>
      o.value === value ||
      o.text.toLowerCase() === value.toLowerCase() ||
      o.text.toLowerCase().includes(value.toLowerCase())
    );
    if (!match) return { success: false, error: `Option "${value}" not found` };
    el.value = match.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, selected: match.text };
  }

  // Handle contenteditable
  if (el.isContentEditable) {
    if (clearFirst !== false) el.innerHTML = '';
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (pressEnter) pressEnterKey(el);
    return { success: true };
  }

  // Use native setter for React/Vue/Angular compatibility
  const proto = el.tagName === 'TEXTAREA'
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

  if (clearFirst !== false) {
    if (nativeSetter) nativeSetter.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  if (pressEnter) pressEnterKey(el);

  return { success: true };
}

function pressEnterKey(el) {
  ['keydown', 'keypress', 'keyup'].forEach(type => {
    el.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
    }));
  });
}

// ── Scroll ────────────────────────────────────────────────────────────────────

function scrollPage({ direction, selector, pixels }) {
  if (selector) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true };
      }
    } catch (e) {}
  }

  const px = pixels || 400;
  switch (direction) {
    case 'top':    window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'bottom': window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break;
    case 'down':   window.scrollBy({ top: px,  behavior: 'smooth' }); break;
    case 'up':     window.scrollBy({ top: -px, behavior: 'smooth' }); break;
    default:       return { success: false, error: `Unknown direction: ${direction}` };
  }
  return { success: true, scrollY: Math.round(window.scrollY) };
}

// ── Message Listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    let result;
    switch (msg.action) {
      case 'ping':            result = { success: true }; break;
      case 'getPageSnapshot': result = { success: true, data: getPageSnapshot() }; break;
      case 'click':           result = clickElement(msg); break;
      case 'type':            result = typeIntoElement(msg); break;
      case 'scroll':          result = scrollPage(msg); break;
      default:                result = { success: false, error: `Unknown action: ${msg.action}` };
    }
    sendResponse(result);
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
  return true;
});

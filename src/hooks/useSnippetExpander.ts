import { useEffect, useRef } from 'react';
import type { Snippet } from '../components/ExpanderFileList';
import { resolveSnippet } from '../components/SuperExpander';

const BUFFER_SIZE = 64;

/**
 * Global snippet expander hook.
 * Monitors keystrokes across all text inputs/textareas in the app.
 * When a snippet keyword (e.g. "/sig") is typed, it replaces the keyword
 * with the resolved snippet content (placeholders expanded).
 */
export function useSnippetExpander(snippets: Snippet[]) {
  const bufferRef = useRef('');
  const expandingRef = useRef(false);
  const snippetsRef = useRef(snippets);
  snippetsRef.current = snippets;

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      // Skip if we're currently expanding (prevent re-trigger)
      if (expandingRef.current) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Only work in editable elements
      const isInput = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text';
      const isTextarea = target.tagName === 'TEXTAREA';
      const isContentEditable = target.isContentEditable;
      if (!isInput && !isTextarea && !isContentEditable) return;

      // Handle special keys
      if (e.key === 'Backspace') {
        bufferRef.current = bufferRef.current.slice(0, -1);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
        bufferRef.current = '';
        return;
      }

      // Skip modifier-only keys and non-character keys
      if (e.key.length !== 1) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Push character to buffer
      bufferRef.current += e.key;
      if (bufferRef.current.length > BUFFER_SIZE) {
        bufferRef.current = bufferRef.current.slice(-BUFFER_SIZE);
      }

      // Check if buffer ends with any snippet keyword
      const currentSnippets = snippetsRef.current;
      for (const snippet of currentSnippets) {
        if (!snippet.keyword || snippet.keyword.length < 2) continue;
        const kw = snippet.keyword.toLowerCase();

        if (bufferRef.current.toLowerCase().endsWith(kw)) {
          // Match found! Expand after the current keystroke is processed
          e.preventDefault();
          expandingRef.current = true;
          bufferRef.current = '';

          // Use requestAnimationFrame to let the DOM settle
          requestAnimationFrame(() => {
            expandInPlace(target, snippet, kw.length - 1).finally(() => {
              expandingRef.current = false;
            });
          });
          return;
        }
      }
    }

    document.addEventListener('keydown', handleKeydown, true);
    return () => document.removeEventListener('keydown', handleKeydown, true);
  }, []);
}

async function expandInPlace(
  target: HTMLElement,
  snippet: Snippet,
  charsToDeleteBeforeCurrent: number,
) {
  const resolved = await resolveSnippet(snippet.content);

  if (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text')) {
    const el = target as HTMLTextAreaElement | HTMLInputElement;
    const cursorPos = el.selectionStart ?? el.value.length;
    // The last character of the keyword was just prevented, so we need to
    // delete (keyword.length - 1) characters before the cursor
    const deleteCount = charsToDeleteBeforeCurrent;
    const before = el.value.slice(0, cursorPos - deleteCount);
    const after = el.value.slice(cursorPos);
    const newValue = before + resolved + after;

    // Use native input setter to trigger React's onChange
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, newValue);
    } else {
      el.value = newValue;
    }

    // Fire input event so React picks up the change
    el.dispatchEvent(new Event('input', { bubbles: true }));

    // Restore cursor position after the inserted text
    const newPos = before.length + resolved.length;
    el.setSelectionRange(newPos, newPos);
  } else if (target.isContentEditable) {
    // For contentEditable elements (like TipTap editors)
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const textNode = node as Text;
    const offset = range.startOffset;
    const text = textNode.textContent ?? '';
    const deleteCount = charsToDeleteBeforeCurrent;
    const before = text.slice(0, offset - deleteCount);
    const after = text.slice(offset);

    textNode.textContent = before + resolved + after;

    // Set cursor after the inserted text
    const newRange = document.createRange();
    const newPos = before.length + resolved.length;
    newRange.setStart(textNode, Math.min(newPos, textNode.length));
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    // Trigger input event for frameworks
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

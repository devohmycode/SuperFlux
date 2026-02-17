import type { TextHighlight } from '../types';

export function applyHighlights(html: string, highlights: TextHighlight[]): string {
  if (!highlights.length || !html) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const fullText = doc.body.textContent || '';

  // Build a list of ranges (charStart, charEnd) + highlight metadata
  const ranges: { start: number; end: number; highlight: TextHighlight }[] = [];

  for (const hl of highlights) {
    const idx = locateText(fullText, hl.text, hl.prefix, hl.suffix);
    if (idx === -1) continue;
    ranges.push({ start: idx, end: idx + hl.text.length, highlight: hl });
  }

  // Sort by start position (earliest first), skip overlaps
  ranges.sort((a, b) => a.start - b.start);
  const filtered: typeof ranges = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start >= lastEnd) {
      filtered.push(r);
      lastEnd = r.end;
    }
  }

  if (!filtered.length) return html;

  // Walk text nodes and wrap matching ranges
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    textNodes.push(node);
  }

  let charOffset = 0;
  let rangeIdx = 0;

  for (const textNode of textNodes) {
    if (rangeIdx >= filtered.length) break;

    const nodeText = textNode.nodeValue || '';
    const nodeStart = charOffset;
    const nodeEnd = charOffset + nodeText.length;
    charOffset = nodeEnd;

    // Skip if already inside a <mark>
    if (textNode.parentElement?.closest('mark.highlight')) continue;

    // Collect all ranges that overlap this text node
    const overlapping: typeof filtered = [];
    for (let i = rangeIdx; i < filtered.length; i++) {
      const r = filtered[i];
      if (r.start >= nodeEnd) break;
      if (r.end > nodeStart) overlapping.push(r);
    }

    if (!overlapping.length) continue;

    // Split this text node into fragments
    const parent = textNode.parentNode!;
    const fragments: (string | { text: string; highlight: TextHighlight })[] = [];
    let cursor = 0;

    for (const r of overlapping) {
      const relStart = Math.max(0, r.start - nodeStart);
      const relEnd = Math.min(nodeText.length, r.end - nodeStart);

      if (relStart > cursor) {
        fragments.push(nodeText.slice(cursor, relStart));
      }
      fragments.push({ text: nodeText.slice(relStart, relEnd), highlight: r.highlight });
      cursor = relEnd;
    }

    if (cursor < nodeText.length) {
      fragments.push(nodeText.slice(cursor));
    }

    // Replace text node with fragments
    for (const frag of fragments) {
      if (typeof frag === 'string') {
        parent.insertBefore(doc.createTextNode(frag), textNode);
      } else {
        const mark = doc.createElement('mark');
        mark.className = `highlight highlight-${frag.highlight.color}`;
        mark.setAttribute('data-highlight-id', frag.highlight.id);
        mark.textContent = frag.text;
        parent.insertBefore(mark, textNode);
      }
    }
    parent.removeChild(textNode);

    // Advance rangeIdx past any ranges fully consumed
    while (rangeIdx < filtered.length && filtered[rangeIdx].end <= nodeEnd) {
      rangeIdx++;
    }
  }

  return doc.body.innerHTML;
}

function locateText(fullText: string, text: string, prefix: string, suffix: string): number {
  // Try exact match with prefix+suffix context
  if (prefix || suffix) {
    const needle = prefix + text + suffix;
    const idx = fullText.indexOf(needle);
    if (idx !== -1) return idx + prefix.length;
  }

  // Fallback: find all occurrences of text and score by context similarity
  const occurrences: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = fullText.indexOf(text, searchFrom);
    if (idx === -1) break;
    occurrences.push(idx);
    searchFrom = idx + 1;
  }

  if (occurrences.length === 0) return -1;
  if (occurrences.length === 1) return occurrences[0];

  // Score each occurrence by how well prefix/suffix match
  let bestIdx = occurrences[0];
  let bestScore = -1;

  for (const idx of occurrences) {
    let score = 0;
    if (prefix) {
      const actualPrefix = fullText.slice(Math.max(0, idx - prefix.length), idx);
      score += similarity(actualPrefix, prefix);
    }
    if (suffix) {
      const actualSuffix = fullText.slice(idx + text.length, idx + text.length + suffix.length);
      score += similarity(actualSuffix, suffix);
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }

  return bestIdx;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  let matches = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / maxLen;
}

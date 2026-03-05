import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const wikilinkRe = /\[\[([^\]]+)\]\]/g;

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    let match;
    wikilinkRe.lastIndex = 0;
    while ((match = wikilinkRe.exec(text)) !== null) {
      const start = from + match.index;
      const end = start + match[0].length;
      builder.add(start, end, Decoration.mark({ class: 'cm-wikilink' }));
    }
  }
  return builder.finish();
}

const wikilinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

function wikilinkClickHandler(onNavigate: (target: string) => void) {
  return EditorView.domEventHandlers({
    click(event: MouseEvent, view: EditorView) {
      if (!event.ctrlKey && !event.metaKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;
      const offsetInLine = pos - line.from;
      wikilinkRe.lastIndex = 0;
      let match;
      while ((match = wikilinkRe.exec(lineText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (offsetInLine >= start && offsetInLine <= end) {
          const inner = match[1];
          const target = inner.split('|')[0].trim();
          event.preventDefault();
          onNavigate(target);
          return true;
        }
      }
      return false;
    },
  });
}

export function wikilinksExtension(onNavigate: (target: string) => void) {
  return [wikilinkPlugin, wikilinkClickHandler(onNavigate)];
}

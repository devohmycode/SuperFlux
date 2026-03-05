import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ViewUpdate, DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSet } from '@codemirror/state';
import type { Range } from '@codemirror/state';

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) { super(); }
  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-lp-image-wrapper';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.className = 'cm-lp-image';
    img.onerror = () => {
      wrapper.textContent = `[Image: ${this.alt || this.src}]`;
      wrapper.className = 'cm-lp-image-placeholder';
    };
    wrapper.appendChild(img);
    return wrapper;
  }
  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt;
  }
}

function cursorOnLines(view: EditorView, from: number, to: number): boolean {
  const doc = view.state.doc;
  const fromLine = doc.lineAt(from).number;
  const toLine = doc.lineAt(to).number;
  for (const r of view.state.selection.ranges) {
    const headLine = doc.lineAt(r.head).number;
    if (headLine >= fromLine && headLine <= toLine) return true;
  }
  return false;
}

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from, to,
      enter(node) {
        const name = node.name;
        const nFrom = node.from;
        const nTo = node.to;
        if (cursorOnLines(view, nFrom, nTo)) return;

        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = parseInt(name[name.length - 1]);
          const text = doc.sliceString(nFrom, nTo);
          let hashEnd = 0;
          while (hashEnd < text.length && text[hashEnd] === '#') hashEnd++;
          if (hashEnd < text.length && text[hashEnd] === ' ') hashEnd++;
          if (hashEnd > 0 && nFrom + hashEnd < nTo) {
            decos.push(Decoration.replace({}).range(nFrom, nFrom + hashEnd));
            decos.push(Decoration.mark({ class: `cm-lp-h${level}` }).range(nFrom + hashEnd, nTo));
          }
          return false;
        }

        if (name === 'Emphasis') {
          if (nTo - nFrom > 2) {
            decos.push(Decoration.replace({}).range(nFrom, nFrom + 1));
            decos.push(Decoration.replace({}).range(nTo - 1, nTo));
            decos.push(Decoration.mark({ class: 'cm-lp-italic' }).range(nFrom + 1, nTo - 1));
          }
          return false;
        }

        if (name === 'StrongEmphasis') {
          if (nTo - nFrom > 4) {
            decos.push(Decoration.replace({}).range(nFrom, nFrom + 2));
            decos.push(Decoration.replace({}).range(nTo - 2, nTo));
            decos.push(Decoration.mark({ class: 'cm-lp-bold' }).range(nFrom + 2, nTo - 2));
          }
          return false;
        }

        if (name === 'Link') {
          const text = doc.sliceString(nFrom, nTo);
          const bracketClose = text.indexOf('](');
          if (bracketClose > 0) {
            decos.push(Decoration.replace({}).range(nFrom, nFrom + 1));
            decos.push(Decoration.mark({ class: 'cm-lp-link' }).range(nFrom + 1, nFrom + bracketClose));
            decos.push(Decoration.replace({}).range(nFrom + bracketClose, nTo));
          }
          return false;
        }

        if (name === 'Image') {
          const text = doc.sliceString(nFrom, nTo);
          const match = text.match(/^!\[([^\]]*)\]\(([^)]*)\)$/);
          if (match) {
            decos.push(Decoration.replace({ widget: new ImageWidget(match[2], match[1]) }).range(nFrom, nTo));
          }
          return false;
        }

        if (name === 'InlineCode') {
          const text = doc.sliceString(nFrom, nTo);
          let markLen = 0;
          while (markLen < text.length && text[markLen] === '`') markLen++;
          if (markLen > 0 && nFrom + markLen < nTo - markLen) {
            decos.push(Decoration.replace({}).range(nFrom, nFrom + markLen));
            decos.push(Decoration.replace({}).range(nTo - markLen, nTo));
            decos.push(Decoration.mark({ class: 'cm-lp-code' }).range(nFrom + markLen, nTo - markLen));
          }
          return false;
        }

        if (name === 'FencedCode') {
          const fromLine = doc.lineAt(nFrom).number;
          const toLine = doc.lineAt(nTo).number;
          for (let l = fromLine; l <= toLine; l++) {
            decos.push(Decoration.line({ class: 'cm-lp-codeblock' }).range(doc.line(l).from));
          }
          return false;
        }

        if (name === 'Blockquote') {
          const fromLine = doc.lineAt(nFrom).number;
          const toLine = doc.lineAt(nTo).number;
          for (let l = fromLine; l <= toLine; l++) {
            decos.push(Decoration.line({ class: 'cm-lp-blockquote' }).range(doc.line(l).from));
          }
          return false;
        }
      },
    });
  }
  return RangeSet.of(decos, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function livePreviewExtension() {
  return livePreviewPlugin;
}

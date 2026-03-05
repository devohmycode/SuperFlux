import { keymap } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

function wrapSelection(view: EditorView, before: string, after: string): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    if (
      selected.startsWith(before) &&
      selected.endsWith(after) &&
      selected.length >= before.length + after.length
    ) {
      const unwrapped = selected.slice(before.length, selected.length - after.length);
      return {
        changes: { from: range.from, to: range.to, insert: unwrapped },
        range: EditorSelection.range(range.from, range.from + unwrapped.length),
      };
    }
    const wrapped = before + selected + after;
    return {
      changes: { from: range.from, to: range.to, insert: wrapped },
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    };
  });
  view.dispatch(changes);
  return true;
}

export const markdownKeymap = keymap.of([
  { key: 'Mod-b', run: (view) => wrapSelection(view, '**', '**') },
  { key: 'Mod-i', run: (view) => wrapSelection(view, '*', '*') },
  { key: 'Mod-Shift-s', run: (view) => wrapSelection(view, '~~', '~~') },
  { key: 'Mod-e', run: (view) => wrapSelection(view, '`', '`') },
]);

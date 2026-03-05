import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';

export function wikilinkCompletion(
  getFileNames: () => string[],
  getTags?: () => { name: string }[],
) {
  function wikilinkSource(context: CompletionContext): CompletionResult | null {
    const before = context.matchBefore(/\[\[[^\]]*$/);
    if (!before) return null;
    const prefix = before.text.slice(2);
    const names = getFileNames();
    return {
      from: before.from + 2,
      options: names
        .filter((n) => n.toLowerCase().includes(prefix.toLowerCase()))
        .map((name) => ({ label: name, apply: `${name}]]`, type: 'text' })),
      filter: false,
    };
  }

  function tagSource(context: CompletionContext): CompletionResult | null {
    const before = context.matchBefore(/(?:^|(?<=\s))#[\w/\-]*/);
    if (!before) return null;
    const lineText = context.state.doc.lineAt(before.from).text;
    if (/^#{1,6}\s/.test(lineText)) return null;
    const prefix = before.text.slice(1).toLowerCase();
    const tags = getTags?.() ?? [];
    return {
      from: before.from + 1,
      options: tags
        .filter((t) => t.name.toLowerCase().includes(prefix))
        .map((t) => ({ label: t.name, type: 'keyword', boost: 1 })),
      filter: false,
    };
  }

  const sources: ((context: CompletionContext) => CompletionResult | null)[] = [wikilinkSource];
  if (getTags) sources.push(tagSource);

  return autocompletion({ override: sources, activateOnTyping: true });
}

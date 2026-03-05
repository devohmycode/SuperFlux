import { useMemo } from 'react';
import { marked } from 'marked';

interface Props {
  content: string;
}

export function MarkdownPreviewPane({ content }: Props) {
  const html = useMemo(() => {
    try {
      return marked.parse(content, { breaks: true, gfm: true }) as string;
    } catch {
      return '';
    }
  }, [content]);

  return (
    <div
      className="md-preview-pane"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

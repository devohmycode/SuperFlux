import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { themeCompartment, getThemeExtension } from './markdown-editor/theme';
import { livePreviewExtension } from './markdown-editor/live-preview';
import { markdownKeymap } from './markdown-editor/keybindings';
import { wikilinksExtension } from './markdown-editor/wikilinks';
import { wikilinkCompletion } from './markdown-editor/wikilink-completion';
import { invoke } from '@tauri-apps/api/core';
import type { MdViewMode, MdTagInfo } from './markdownTypes';
import { MarkdownPreviewPane } from './MarkdownPreviewPane';

interface Props {
  content: string;
  filePath: string | null;
  vaultPath: string;
  viewMode: MdViewMode;
  onContentChange: (content: string) => void;
  onSave: (content: string) => void;
  onCursorChange: (line: number, col: number, totalLines: number) => void;
  onNavigateWikilink: (target: string) => void;
}

export function MarkdownCodeEditor({
  content, filePath: _filePath, vaultPath, viewMode,
  onContentChange, onSave, onCursorChange, onNavigateWikilink,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const mdFileNamesRef = useRef<string[]>([]);
  const tagsRef = useRef<MdTagInfo[]>([]);
  const [previewContent, setPreviewContent] = useState(content);
  const contentRef = useRef(content);

  // Load md file names and tags for autocompletion
  useEffect(() => {
    if (!vaultPath) return;
    invoke<string[]>('md_list_md_files', { vaultPath }).then(names => {
      mdFileNamesRef.current = names;
    }).catch(() => {});
    invoke<MdTagInfo[]>('md_get_vault_tags', { vaultPath }).then(tags => {
      tagsRef.current = tags;
    }).catch(() => {});
  }, [vaultPath]);

  // Initialize CodeMirror
  useEffect(() => {
    if (!containerRef.current) return;

    const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

    const autoSave = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
        contentRef.current = newContent;
        onContentChange(newContent);
        setPreviewContent(newContent);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          onSave(newContent);
        }, 500);
      }
      // Track cursor
      const sel = update.state.selection.main;
      const line = update.state.doc.lineAt(sel.head);
      onCursorChange(line.number, sel.head - line.from + 1, update.state.doc.lines);
    });

    const editor = new EditorView({
      doc: content,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        themeCompartment.of(getThemeExtension(theme as 'dark' | 'light')),
        livePreviewExtension(),
        markdownKeymap,
        autoSave,
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        wikilinksExtension(onNavigateWikilink),
        wikilinkCompletion(
          () => mdFileNamesRef.current,
          () => tagsRef.current,
        ),
      ],
      parent: containerRef.current,
    });

    viewRef.current = editor;

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      editor.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update content when file changes (external)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (content !== contentRef.current) {
      contentRef.current = content;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
      setPreviewContent(content);
    }
  }, [content]);

  return (
    <div className={`md-editor-split ${viewMode === 'split' ? 'split-mode' : ''}`}>
      <div
        ref={containerRef}
        className={`md-editor-pane ${viewMode === 'preview' ? 'md-hidden' : ''}`}
      />
      {(viewMode === 'split' || viewMode === 'preview') && (
        <MarkdownPreviewPane content={previewContent} />
      )}
    </div>
  );
}

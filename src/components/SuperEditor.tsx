import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { EditorContent, useEditor, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Emoji, gitHubEmojis } from '@tiptap/extension-emoji';
import DragHandle from '@tiptap/extension-drag-handle-react';
import { all, createLowlight } from 'lowlight';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon, Heading1, Heading2, Heading3, Heading4,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, ListTodo, Quote, Minus, FileCode,
  Link as LinkIcon, Unlink, Image as ImageIcon,
  Undo2, Redo2, GripVertical,
  FilePlus, FolderOpen, Download, ChevronDown, FileInput, FileOutput,
} from 'lucide-react';
import { importWithPandoc, exportWithPandoc } from '../services/pandocService';

const lowlight = createLowlight(all);

// ─── Emoji suggestion renderer ───
interface EmojiItem {
  name: string;
  shortcodes: string[];
  tags: string[];
  emoji?: string;
  fallbackImage?: string;
}

const EmojiList = forwardRef<
  { onKeyDown: (props: { event: KeyboardEvent }) => boolean },
  { items: EmojiItem[]; command: (item: EmojiItem) => void }
>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => { setSelectedIndex(0); }, [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex(i => (i + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex(i => (i + 1) % props.items.length);
        return true;
      }
      if (event.key === 'Enter') {
        const item = props.items[selectedIndex];
        if (item) props.command(item);
        return true;
      }
      return false;
    },
  }));

  if (!props.items.length) {
    return (
      <div className="super-editor-emoji-popup">
        <span className="super-editor-emoji-empty">Aucun emoji</span>
      </div>
    );
  }

  return (
    <div className="super-editor-emoji-popup">
      {props.items.slice(0, 12).map((item, index) => (
        <button
          key={item.name}
          className={`super-editor-emoji-item ${index === selectedIndex ? 'active' : ''}`}
          onClick={() => props.command(item)}
        >
          <span>{item.emoji || ''}</span>
          <span className="super-editor-emoji-name">:{item.shortcodes?.[0] || item.name}:</span>
        </button>
      ))}
    </div>
  );
});
EmojiList.displayName = 'EmojiList';

const emojiSuggestion: Partial<SuggestionOptions<EmojiItem>> = {
  render: () => {
    let component: ReactRenderer<any> | null = null;
    let popup: TippyInstance[] | null = null;
    return {
      onStart: (props: SuggestionProps<EmojiItem>) => {
        component = new ReactRenderer(EmojiList, { props, editor: props.editor });
        if (!props.clientRect) return;
        popup = tippy('body', {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        });
      },
      onUpdate: (props: SuggestionProps<EmojiItem>) => {
        component?.updateProps(props);
        if (!props.clientRect) return;
        popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
      },
      onKeyDown: (props: { event: KeyboardEvent }) => {
        if (props.event.key === 'Escape') { popup?.[0]?.hide(); return true; }
        return (component?.ref as any)?.onKeyDown?.(props) ?? false;
      },
      onExit: () => { popup?.[0]?.destroy(); component?.destroy(); },
    };
  },
};

// ─── Toolbar button ───
function ToolBtn({ icon: Icon, label, active, disabled, onClick }: {
  icon: any; label: string; active?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      className={`super-editor-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      <Icon size={15} />
    </button>
  );
}

function ToolSep() {
  return <div className="super-editor-sep" />;
}

// ─── File menu dropdown ───
function FileMenu({ onNew, onOpen, onDownload, onImport, onExport }: {
  onNew: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onImport: () => void;
  onExport: (format: 'docx' | 'pdf') => void;
}) {
  const [open, setOpen] = useState(false);
  const [exportSub, setExportSub] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) setExportSub(false);
  }, [open]);

  return (
    <div className="super-editor-filemenu" ref={menuRef}>
      <button className="super-editor-filemenu-trigger" onClick={() => setOpen(o => !o)}>
        Fichier
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="super-editor-filemenu-dropdown">
          <button className="super-editor-filemenu-item" onClick={() => { onNew(); setOpen(false); }}>
            <FilePlus size={14} />
            <span>Nouveau</span>
            <kbd>Ctrl+N</kbd>
          </button>
          <button className="super-editor-filemenu-item" onClick={() => { onOpen(); setOpen(false); }}>
            <FolderOpen size={14} />
            <span>Ouvrir</span>
            <kbd>Ctrl+O</kbd>
          </button>
          <div className="super-editor-filemenu-divider" />
          <button className="super-editor-filemenu-item" onClick={() => { onImport(); setOpen(false); }}>
            <FileInput size={14} />
            <span>Importer</span>
            <kbd>.docx .pdf</kbd>
          </button>
          <div
            className="super-editor-filemenu-item super-editor-filemenu-submenu-trigger"
            onMouseEnter={() => setExportSub(true)}
            onMouseLeave={() => setExportSub(false)}
          >
            <FileOutput size={14} />
            <span>Exporter</span>
            <ChevronDown size={12} style={{ transform: 'rotate(-90deg)', marginLeft: 'auto' }} />
            {exportSub && (
              <div className="super-editor-filemenu-submenu">
                <button className="super-editor-filemenu-item" onClick={() => { onExport('docx'); setOpen(false); }}>
                  <span>Word (.docx)</span>
                </button>
                <button className="super-editor-filemenu-item" onClick={() => { onExport('pdf'); setOpen(false); }}>
                  <span>PDF (.pdf)</span>
                </button>
              </div>
            )}
          </div>
          <div className="super-editor-filemenu-divider" />
          <button className="super-editor-filemenu-item" onClick={() => { onDownload(); setOpen(false); }}>
            <Download size={14} />
            <span>Télécharger</span>
            <kbd>Ctrl+S</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───
import type { EditorDoc } from './EditorFileList';

interface SuperEditorProps {
  doc: EditorDoc | null;
  onUpdateContent?: (id: string, content: string) => void;
  onAddDoc?: () => void;
}

export function SuperEditor({ doc, onUpdateContent, onAddDoc }: SuperEditorProps) {
  const prevDocIdRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, codeBlock: false }),
      Subscript,
      Superscript,
      Underline,
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      TextStyleKit,
      Highlight.configure({ multicolor: true }),
      Color,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CharacterCount,
      CodeBlockLowlight.configure({ lowlight }),
      Emoji.configure({ emojis: gitHubEmojis, enableEmoticons: true, suggestion: emojiSuggestion }),
      Placeholder.configure({ placeholder: 'Commencez à écrire...' }),
    ],
    content: doc?.content || '',
    shouldRerenderOnTransaction: true,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (doc && onUpdateContent) onUpdateContent(doc.id, editor.getHTML());
    },
  });

  // Sync editor content when switching between documents
  useEffect(() => {
    if (!editor) return;
    const newId = doc?.id ?? null;
    if (newId !== prevDocIdRef.current) {
      prevDocIdRef.current = newId;
      editor.commands.setContent(doc?.content || '');
    }
  }, [doc?.id, doc?.content, editor]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleNew = useCallback(() => {
    if (onAddDoc) onAddDoc();
  }, [onAddDoc]);

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      let html: string;
      if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
        html = text;
      } else {
        html = text.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('');
      }
      editor.commands.setContent(html);
      if (doc && onUpdateContent) onUpdateContent(doc.id, editor.getHTML());
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [editor, doc, onUpdateContent]);

  const handleDownload = useCallback(() => {
    if (!editor) return;
    const title = doc?.title || 'supereditor-document';
    const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#1a1917}
h1,h2,h3,h4{font-weight:600}blockquote{border-left:3px solid #d4a853;padding-left:16px;color:#6b6964;font-style:italic}
pre{background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px}
code{background:#f0ede8;padding:2px 5px;border-radius:3px;font-size:0.88em}pre code{background:transparent;padding:0}
a{color:#3a7ed4}img{max-width:100%;border-radius:8px}</style>
</head>
<body>${editor.getHTML()}</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [editor, doc?.title]);

  const handleImport = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    setImportError(null);
    try {
      const html = await importWithPandoc(file);
      editor.commands.setContent(html);
      if (doc && onUpdateContent) onUpdateContent(doc.id, editor.getHTML());
    } catch (err: any) {
      setImportError(err?.message || 'Erreur lors de l\'import');
    }
    e.target.value = '';
  }, [editor, doc, onUpdateContent]);

  const handleExport = useCallback(async (format: 'docx' | 'pdf') => {
    if (!editor) return;
    setImportError(null);
    try {
      const html = editor.getHTML();
      const blob = await exportWithPandoc(html, format);
      const title = doc?.title || 'supereditor-document';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setImportError(err?.message || 'Erreur lors de l\'export');
    }
  }, [editor, doc?.title]);

  // Keyboard shortcuts for file menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editor) return;
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); handleNew(); }
      if (e.ctrlKey && e.key === 'o') { e.preventDefault(); handleOpen(); }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleDownload(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor, handleNew, handleOpen, handleDownload]);

  if (!editor) return null;

  const chars = editor.storage.characterCount?.characters?.() ?? 0;
  const words = editor.storage.characterCount?.words?.() ?? 0;

  return (
    <div className="super-editor-root">
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm,.txt,.md"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".docx,.pdf"
        style={{ display: 'none' }}
        onChange={handleImportChange}
      />
      {/* Toolbar */}
      <div className="super-editor-toolbar">
        <div className="super-editor-toolbar-row">
          <FileMenu onNew={handleNew} onOpen={handleOpen} onDownload={handleDownload} onImport={handleImport} onExport={handleExport} />
          <ToolSep />
          <ToolBtn icon={Bold} label="Gras" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolBtn icon={Italic} label="Italique" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolBtn icon={UnderlineIcon} label="Souligné" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <ToolBtn icon={Strikethrough} label="Barré" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <ToolBtn icon={Code} label="Code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} />

          <ToolSep />

          <ToolBtn icon={Heading1} label="H1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
          <ToolBtn icon={Heading2} label="H2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          <ToolBtn icon={Heading3} label="H3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
          <ToolBtn icon={Heading4} label="H4" active={editor.isActive('heading', { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} />

          <ToolSep />

          <ToolBtn icon={AlignLeft} label="Gauche" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
          <ToolBtn icon={AlignCenter} label="Centre" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
          <ToolBtn icon={AlignRight} label="Droite" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
          <ToolBtn icon={AlignJustify} label="Justifié" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} />

          <ToolSep />

          <ToolBtn icon={List} label="Liste à puces" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolBtn icon={ListOrdered} label="Liste numérotée" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
          <ToolBtn icon={ListTodo} label="Liste de tâches" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} />
          <ToolBtn icon={Quote} label="Citation" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
          <ToolBtn icon={FileCode} label="Bloc de code" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
          <ToolBtn icon={Minus} label="Séparateur" onClick={() => editor.chain().focus().setHorizontalRule().run()} />

          <ToolSep />

          <ToolBtn icon={LinkIcon} label="Lien" active={editor.isActive('link')} onClick={() => {
            const url = window.prompt('URL du lien');
            if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
          }} />
          <ToolBtn icon={Unlink} label="Supprimer lien" onClick={() => editor.chain().focus().unsetLink().run()} />
          <ToolBtn icon={ImageIcon} label="Image" onClick={() => {
            const url = window.prompt('URL de l\'image');
            if (url) editor.chain().focus().setImage({ src: url }).run();
          }} />

          <ToolSep />

          <ToolBtn icon={SubscriptIcon} label="Indice" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} />
          <ToolBtn icon={SuperscriptIcon} label="Exposant" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} />

          <ToolSep />

          <ToolBtn icon={Undo2} label="Annuler" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
          <ToolBtn icon={Redo2} label="Rétablir" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
        </div>
      </div>

      {/* Editor content with drag handle */}
      <div className="super-editor-content-wrapper">
        <DragHandle editor={editor}>
          <div className="super-editor-drag-handle">
            <GripVertical size={14} />
          </div>
        </DragHandle>
        <EditorContent editor={editor} className="super-editor-content" />
      </div>

      {/* Import/Export error toast */}
      {importError && (
        <div className="super-editor-toast" onClick={() => setImportError(null)}>
          <span>⚠ {importError}</span>
        </div>
      )}

      {/* Footer */}
      <div className="super-editor-footer">
        <span>{chars} caractères</span>
        <span>{words} mots</span>
      </div>
    </div>
  );
}

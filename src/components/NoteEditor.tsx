import { useState, useEffect, useRef, useCallback } from 'react';
import type { Note } from './NotePanel';

interface NoteEditorProps {
  note: Note | null;
  onUpdateNote: (noteId: string, updates: { title?: string; content?: string }) => void;
  onClose: () => void;
}

function formatEditorDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function NoteEditor({ note, onUpdateNote, onClose }: NoteEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteIdRef = useRef<string | null>(null);

  // Sync local state when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
      noteIdRef.current = note.id;
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleUpdate = useCallback((updates: { title?: string; content?: string }) => {
    if (!noteIdRef.current) return;
    const id = noteIdRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdateNote(id, updates);
    }, 300);
  }, [onUpdateNote]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setTitle(v);
    scheduleUpdate({ title: v, content });
  }, [scheduleUpdate, content]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setContent(v);
    scheduleUpdate({ title, content: v });
  }, [scheduleUpdate, title]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!note) {
    return (
      <div className="note-editor-empty">
        <span style={{ fontSize: 28, opacity: 0.2, marginBottom: 8 }}>✎</span>
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          Sélectionnez une note ou créez-en une nouvelle
        </span>
      </div>
    );
  }

  return (
    <div className="note-editor">
      <div className="note-editor-header">
        <div className="note-editor-title-row">
          <input
            className="note-editor-title"
            value={title}
            onChange={handleTitleChange}
            placeholder="Titre de la note"
          />
          <button className="panel-close-btn" title="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        <span className="note-editor-date">
          Modifié le {formatEditorDate(note.updatedAt)}
        </span>
      </div>
      <div className="note-editor-body">
        <textarea
          className="note-editor-content"
          value={content}
          onChange={handleContentChange}
          placeholder="Commencez à écrire..."
        />
      </div>
    </div>
  );
}

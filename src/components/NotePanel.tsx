import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import Markdown from 'react-markdown';
import GradientText from './GradientText';
import GlassIconButton from './GlassIconButton';
import { NoteStickyBoard } from './NoteStickyBoard';

export interface Note {
  id: string;
  title: string;
  content: string;
  folder?: string;
  createdAt: string;
  updatedAt: string;
  // Sticky board properties
  stickyX?: number;
  stickyY?: number;
  stickyRotation?: number;
  stickyZIndex?: number;
  stickyColor?: string;
  stickyWidth?: number;
  stickyHeight?: number;
}

interface NotePanelProps {
  notes: Note[];
  selectedNoteId: string | null;
  onSelectNote: (noteId: string | null) => void;
  onAddNote: () => void;
  onDeleteNote: (noteId: string) => void;
  onUpdateNote: (noteId: string, updates: Partial<Note>) => void;
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function NotePanel({ notes, selectedNoteId, onSelectNote, onAddNote, onDeleteNote, onUpdateNote }: NotePanelProps) {
  const [viewMode, setViewMode] = useState<'cards' | 'board'>('board');

  const handleDelete = useCallback((e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    onDeleteNote(noteId);
  }, [onDeleteNote]);

  return (
    <div className="note-panel">
      <div className="note-panel-header">
        <div className="note-panel-title-row">
          <h2 className="note-panel-title">
            <GradientText
              colors={["#5227FF","#FF9FFC","#B19EEF"]}
              animationSpeed={8}
              showBorder={false}
            >
              Notes
            </GradientText>
          </h2>
          {notes.length > 0 && (
            <span className="note-panel-count">{notes.length} note{notes.length > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="note-panel-actions">
          <GlassIconButton
            color="orange"
            icon="▦"
            title="Vue cartes"
            onClick={() => setViewMode('cards')}
            active={viewMode === 'cards'}
          />
          <GlassIconButton
            color="indigo"
            icon="▤"
            title="Vue post-its"
            onClick={() => setViewMode('board')}
            active={viewMode === 'board'}
          />
        </div>
      </div>

      {viewMode === 'board' ? (
        <NoteStickyBoard
          notes={notes}
          selectedNoteId={selectedNoteId}
          onSelectNote={onSelectNote}
          onDeleteNote={onDeleteNote}
          onUpdateNote={onUpdateNote}
          onAddNote={onAddNote}
        />
      ) : (
        <div className="note-panel-list">
          {notes.length === 0 ? (
            <div className="note-empty">
              <span className="note-empty-icon">✎</span>
              <p className="note-empty-text">Aucune note</p>
              <p className="note-empty-hint">Cliquez sur + pour créer votre première note</p>
            </div>
          ) : (
            <div className="note-cards-grid">
              {notes.map((note, idx) => (
                <motion.div
                  key={note.id}
                  className={`note-card ${selectedNoteId === note.id ? 'active' : ''}`}
                  onClick={() => onSelectNote(note.id)}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
                >
                  <div className="note-card-actions">
                    <button
                      className="note-card-delete"
                      title="Supprimer"
                      onClick={(e) => handleDelete(e, note.id)}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10">
                        <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  <span className="note-card-number">{idx + 1}</span>
                  <h3 className="note-card-title">{note.title || 'Sans titre'}</h3>
                  <span className="note-card-date">{formatNoteDate(note.updatedAt)}</span>
                  <div className="note-card-content note-card-md">
                    {note.content ? (
                      <Markdown>{note.content}</Markdown>
                    ) : (
                      <span className="note-card-empty">Note vide...</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

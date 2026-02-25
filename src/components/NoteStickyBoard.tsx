import { useRef, useState, useCallback, useEffect } from 'react';
import type { Note } from './NotePanel';

interface NoteStickyBoardProps {
  notes: Note[];
  selectedNoteId: string | null;
  onSelectNote: (noteId: string | null) => void;
  onDeleteNote: (noteId: string) => void;
  onUpdateNote: (noteId: string, updates: Partial<Note>) => void;
  onAddNote: () => void;
}

const STICKY_COLORS: Record<string, { bg: string; shadow: string; tape: string }> = {
  yellow: { bg: '#fef9c3', shadow: 'rgba(202,180,50,0.25)', tape: '#fde68a' },
  pink:   { bg: '#fce7f3', shadow: 'rgba(219,130,170,0.25)', tape: '#fbcfe8' },
  blue:   { bg: '#dbeafe', shadow: 'rgba(96,145,220,0.25)',  tape: '#bfdbfe' },
  green:  { bg: '#dcfce7', shadow: 'rgba(74,180,110,0.25)',  tape: '#bbf7d0' },
  orange: { bg: '#ffedd5', shadow: 'rgba(220,160,80,0.25)',  tape: '#fed7aa' },
  purple: { bg: '#f3e8ff', shadow: 'rgba(160,110,220,0.25)', tape: '#e9d5ff' },
};

const COLOR_SWATCHES = [
  { id: 'yellow', swatch: '#fef9c3', ring: '#facc15' },
  { id: 'pink',   swatch: '#fce7f3', ring: '#f472b6' },
  { id: 'blue',   swatch: '#dbeafe', ring: '#60a5fa' },
  { id: 'green',  swatch: '#dcfce7', ring: '#4ade80' },
  { id: 'orange', swatch: '#ffedd5', ring: '#fb923c' },
  { id: 'purple', swatch: '#f3e8ff', ring: '#c084fc' },
];

function randomRotation() {
  return (Math.random() - 0.5) * 6;
}

// ── Single Sticky Note ──

const MIN_STICKY_W = 140;
const MAX_STICKY_W = 500;
const MIN_STICKY_H = 120;
const MAX_STICKY_H = 500;
const DEFAULT_STICKY_W = 200;
const DEFAULT_STICKY_H = 180;

interface StickyNoteItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragEnd: (x: number, y: number) => void;
  onContentUpdate: (content: string) => void;
  onBringToFront: () => void;
  onResizeEnd: (w: number, h: number) => void;
  boardRef: React.RefObject<HTMLDivElement | null>;
}

function StickyNoteItem({
  note, isSelected, onSelect, onDelete, onDragEnd,
  onContentUpdate, onBringToFront, onResizeEnd, boardRef,
}: StickyNoteItemProps) {
  const color = note.stickyColor || 'yellow';
  const style = STICKY_COLORS[color] || STICKY_COLORS.yellow;
  const rotation = note.stickyRotation ?? 0;

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(note.content);
  const [position, setPosition] = useState({ x: note.stickyX ?? 40, y: note.stickyY ?? 40 });
  const [size, setSize] = useState({ w: note.stickyWidth ?? DEFAULT_STICKY_W, h: note.stickyHeight ?? DEFAULT_STICKY_H });
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ mouseX: 0, mouseY: 0, w: 0, h: 0 });
  const noteRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPosition({ x: note.stickyX ?? 40, y: note.stickyY ?? 40 });
  }, [note.stickyX, note.stickyY]);

  useEffect(() => {
    setSize({ w: note.stickyWidth ?? DEFAULT_STICKY_W, h: note.stickyHeight ?? DEFAULT_STICKY_H });
  }, [note.stickyWidth, note.stickyHeight]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isEditing) return;
    e.preventDefault();
    const rect = noteRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDragging(true);
    onBringToFront();
    onSelect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [isEditing, onBringToFront, onSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !boardRef.current) return;
    const boardRect = boardRef.current.getBoundingClientRect();
    const newX = e.clientX - boardRect.left - dragOffset.current.x;
    const newY = e.clientY - boardRect.top - dragOffset.current.y;
    setPosition({
      x: Math.max(0, Math.min(newX, boardRect.width - size.w)),
      y: Math.max(0, Math.min(newY, boardRect.height - size.h)),
    });
  }, [isDragging, boardRef, size]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
    onDragEnd(position.x, position.y);
  }, [isDragging, position, onDragEnd]);

  // ── Resize handlers ──
  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizeStart.current = { mouseX: e.clientX, mouseY: e.clientY, w: size.w, h: size.h };
    setIsResizing(true);
    onBringToFront();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [size, onBringToFront]);

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isResizing) return;
    const dx = e.clientX - resizeStart.current.mouseX;
    const dy = e.clientY - resizeStart.current.mouseY;
    setSize({
      w: Math.max(MIN_STICKY_W, Math.min(MAX_STICKY_W, resizeStart.current.w + dx)),
      h: Math.max(MIN_STICKY_H, Math.min(MAX_STICKY_H, resizeStart.current.h + dy)),
    });
  }, [isResizing]);

  const handleResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isResizing) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsResizing(false);
    onResizeEnd(size.w, size.h);
  }, [isResizing, size, onResizeEnd]);

  const handleSave = () => {
    onContentUpdate(editContent);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
    if (e.key === 'Escape') { setEditContent(note.content); setIsEditing(false); }
  };

  return (
    <div
      ref={noteRef}
      className={`sticky-note ${isDragging ? 'sticky-note--dragging' : ''} ${isResizing ? 'sticky-note--resizing' : ''} ${isSelected ? 'sticky-note--selected' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        minHeight: size.h,
        zIndex: note.stickyZIndex ?? 1,
        backgroundColor: style.bg,
        boxShadow: isDragging
          ? '0 12px 40px rgba(0,0,0,0.25)'
          : `0 4px 16px ${style.shadow}`,
        transform: `rotate(${(isDragging || isResizing) ? 0 : rotation}deg) scale(${isDragging ? 1.05 : 1})`,
        transition: (isDragging || isResizing)
          ? 'box-shadow 0.2s, transform 0.1s'
          : 'box-shadow 0.2s, transform 0.3s ease-out',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Tape */}
      <div
        className="sticky-note-tape"
        style={{
          backgroundColor: style.tape,
          transform: `translateX(-50%) rotate(${rotation > 0 ? -2 : 2}deg)`,
        }}
      />

      {/* Header */}
      <div className="sticky-note-header">
        <span className="sticky-note-grip">⠿</span>
        <div className="sticky-note-actions">
          {isEditing ? (
            <button className="sticky-note-btn sticky-note-btn--save" onClick={handleSave} title="Sauvegarder">
              ✓
            </button>
          ) : (
            <button
              className="sticky-note-btn"
              onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditContent(note.content); }}
              title="Modifier"
            >
              ✎
            </button>
          )}
          <button
            className="sticky-note-btn sticky-note-btn--delete"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Supprimer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Title */}
      <div className="sticky-note-title">{note.title || 'Sans titre'}</div>

      {/* Content */}
      <div className="sticky-note-content">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleKeyDown}
            className="sticky-note-textarea"
            placeholder="Votre note..."
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <p
            className="sticky-note-text"
            onDoubleClick={() => { setIsEditing(true); setEditContent(note.content); }}
          >
            {note.content || 'Double-cliquez pour modifier...'}
          </p>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="sticky-note-resize"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="11" y1="1" x2="1" y2="11" stroke="rgba(0,0,0,0.15)" strokeWidth="1"/>
          <line x1="11" y1="5" x2="5" y2="11" stroke="rgba(0,0,0,0.15)" strokeWidth="1"/>
          <line x1="11" y1="9" x2="9" y2="11" stroke="rgba(0,0,0,0.15)" strokeWidth="1"/>
        </svg>
      </div>
    </div>
  );
}

// ── Board ──

export function NoteStickyBoard({
  notes, selectedNoteId, onSelectNote, onDeleteNote, onUpdateNote, onAddNote,
}: NoteStickyBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [maxZ, setMaxZ] = useState(() =>
    Math.max(1, ...notes.map(n => n.stickyZIndex ?? 1))
  );
  const [selectedColor, setSelectedColor] = useState('yellow');

  const bringToFront = useCallback((noteId: string) => {
    const newZ = maxZ + 1;
    setMaxZ(newZ);
    onUpdateNote(noteId, { stickyZIndex: newZ });
  }, [maxZ, onUpdateNote]);

  const handleDragEnd = useCallback((noteId: string, x: number, y: number) => {
    onUpdateNote(noteId, { stickyX: x, stickyY: y });
  }, [onUpdateNote]);

  const handleContentUpdate = useCallback((noteId: string, content: string) => {
    onUpdateNote(noteId, { content });
  }, [onUpdateNote]);

  const handleResizeEnd = useCallback((noteId: string, w: number, h: number) => {
    onUpdateNote(noteId, { stickyWidth: w, stickyHeight: h });
  }, [onUpdateNote]);

  const handleAddStickyNote = useCallback(() => {
    onAddNote();
    // After adding, we need to set the sticky properties on the newest note
    // We'll handle this via a useEffect
  }, [onAddNote]);

  // When a new note appears without sticky props, initialize them
  useEffect(() => {
    const boardEl = boardRef.current;
    const w = boardEl?.clientWidth || 600;
    const h = boardEl?.clientHeight || 400;
    for (const note of notes) {
      if (note.stickyX === undefined) {
        onUpdateNote(note.id, {
          stickyX: Math.random() * Math.max(100, w - 260) + 30,
          stickyY: Math.random() * Math.max(100, h - 260) + 30,
          stickyRotation: randomRotation(),
          stickyZIndex: maxZ + 1,
          stickyColor: selectedColor,
        });
        setMaxZ(z => z + 1);
      }
    }
  }, [notes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sticky-board-wrapper">
      {/* Color picker */}
      <div className="sticky-board-toolbar">
        <div className="sticky-color-picker">
          {COLOR_SWATCHES.map(c => (
            <button
              key={c.id}
              className={`sticky-color-swatch ${selectedColor === c.id ? 'active' : ''}`}
              style={{
                backgroundColor: c.swatch,
                borderColor: selectedColor === c.id ? c.ring : 'transparent',
              }}
              onClick={() => setSelectedColor(c.id)}
              title={c.id}
            >
              {selectedColor === c.id && <span className="sticky-color-check">✓</span>}
            </button>
          ))}
        </div>
        <button className="sticky-add-btn" onClick={handleAddStickyNote} title="Ajouter un post-it">
          +
        </button>
      </div>

      {/* Board surface */}
      <div ref={boardRef} className="sticky-board">
        {notes.length === 0 && (
          <div className="sticky-board-empty">
            <span className="sticky-board-empty-icon">✎</span>
            <p>Aucun post-it</p>
            <p className="sticky-board-empty-hint">Cliquez + pour ajouter</p>
          </div>
        )}

        {notes.map(note => (
          <StickyNoteItem
            key={note.id}
            note={note}
            isSelected={selectedNoteId === note.id}
            onSelect={() => onSelectNote(note.id)}
            onDelete={() => onDeleteNote(note.id)}
            onDragEnd={(x, y) => handleDragEnd(note.id, x, y)}
            onContentUpdate={(content) => handleContentUpdate(note.id, content)}
            onBringToFront={() => bringToFront(note.id)}
            onResizeEnd={(w, h) => handleResizeEnd(note.id, w, h)}
            boardRef={boardRef}
          />
        ))}
      </div>
    </div>
  );
}

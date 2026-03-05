import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, FolderOpen, Star, List, ChevronDown, ChevronRight,
  Copy, Trash2, User, FolderPlus, Pencil, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PasswordEntry, PasswordFolder } from './passwordTypes';

interface PasswordEntryListProps {
  entries: PasswordEntry[];
  folders: PasswordFolder[];
  selectedEntryId: string | null;
  selectedFolderId: string | null;
  searchQuery: string;
  onSelectEntry: (id: string) => void;
  onSelectFolder: (id: string | null) => void;
  onAddEntry: () => void;
  onDeleteEntry: (id: string) => void;
  onCopyPassword: (id: string) => void;
  onCopyUsername: (id: string) => void;
  onAddFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}

type FilterMode = 'all' | 'favorites' | 'folder';

function getInitials(title: string): string {
  return (title[0] || '?').toUpperCase();
}

function getAvatarColor(title: string): string {
  const colors = [
    'bg-blue-500/20 text-blue-400',
    'bg-purple-500/20 text-purple-400',
    'bg-green-500/20 text-green-400',
    'bg-amber-500/20 text-amber-400',
    'bg-red-500/20 text-red-400',
    'bg-cyan-500/20 text-cyan-400',
    'bg-pink-500/20 text-pink-400',
    'bg-indigo-500/20 text-indigo-400',
  ];
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash << 5) - hash + title.charCodeAt(i);
  return colors[Math.abs(hash) % colors.length];
}

export function PasswordEntryList({
  entries,
  folders,
  selectedEntryId,
  selectedFolderId,
  searchQuery,
  onSelectEntry,
  onSelectFolder,
  onAddEntry,
  onDeleteEntry,
  onCopyPassword,
  onCopyUsername,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
}: PasswordEntryListProps) {
  const { t } = useTranslation();
  const [filterMode, setFilterMode] = useState<FilterMode>(selectedFolderId ? 'folder' : 'all');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entryId: string } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Close context menus on click outside
  useEffect(() => {
    const handler = () => {
      setContextMenu(null);
      setFolderContextMenu(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Filter entries
  const sq = searchQuery.toLowerCase();
  const filtered = useMemo(() => {
    let result = entries;

    // Text search
    if (sq) {
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(sq) ||
          e.username.toLowerCase().includes(sq) ||
          (e.url?.toLowerCase().includes(sq)) ||
          e.tags.some((t) => t.toLowerCase().includes(sq)),
      );
    }

    // Folder / favorites filter
    if (filterMode === 'favorites') {
      result = result.filter((e) => e.favorite);
    } else if (filterMode === 'folder' && selectedFolderId) {
      result = result.filter((e) => e.folder_id === selectedFolderId);
    }

    return result;
  }, [entries, sq, filterMode, selectedFolderId]);

  const handleSelectFolder = useCallback(
    (folderId: string) => {
      onSelectFolder(folderId);
      setFilterMode('folder');
    },
    [onSelectFolder],
  );

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, entryId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entryId });
    setFolderContextMenu(null);
  }, []);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folderId: string) => {
    e.preventDefault();
    setFolderContextMenu({ x: e.clientX, y: e.clientY, folderId });
    setContextMenu(null);
  }, []);

  const handleAddFolder = useCallback(() => {
    if (newFolderName.trim()) {
      onAddFolder(newFolderName.trim());
      setNewFolderName('');
      setAddingFolder(false);
    }
  }, [newFolderName, onAddFolder]);

  const handleRenameFolder = useCallback(() => {
    if (renamingFolderId && renameValue.trim()) {
      onRenameFolder(renamingFolderId, renameValue.trim());
      setRenamingFolderId(null);
      setRenameValue('');
    }
  }, [renamingFolderId, renameValue, onRenameFolder]);

  // Top-level folders (no parent)
  const rootFolders = useMemo(
    () => folders.filter((f) => !f.parent_id),
    [folders],
  );

  // Entries without a folder
  const unfolderedEntries = useMemo(
    () => filtered.filter((e) => !e.folder_id),
    [filtered],
  );

  // Group entries by folder
  const entriesByFolder = useMemo(() => {
    const map = new Map<string, PasswordEntry[]>();
    for (const e of filtered) {
      if (e.folder_id) {
        const list = map.get(e.folder_id) || [];
        list.push(e);
        map.set(e.folder_id, list);
      }
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-subtle)]">
        <button
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
            filterMode === 'all'
              ? 'bg-[var(--accent-glow)] text-[var(--accent)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
          )}
          onClick={() => { setFilterMode('all'); onSelectFolder(null); }}
        >
          <List size={13} />
          {t('common.all')}
        </button>
        <button
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
            filterMode === 'favorites'
              ? 'bg-[var(--accent-glow)] text-[var(--accent)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
          )}
          onClick={() => { setFilterMode('favorites'); onSelectFolder(null); }}
        >
          <Star size={13} />
          {t('password.favorites')}
        </button>
        <div className="flex-1" />
        <button
          className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          onClick={() => setAddingFolder(true)}
          title={t('common.newFolder')}
        >
          <FolderPlus size={14} />
        </button>
      </div>

      {/* Add folder input */}
      {addingFolder && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
          <input
            type="text"
            className={cn(
              'flex-1 rounded-md border px-2 py-1 text-xs outline-none',
              'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]',
              'focus:border-[var(--accent)]',
              'placeholder:text-[var(--text-tertiary)]',
            )}
            placeholder={t('common.folderName')}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddFolder();
              if (e.key === 'Escape') setAddingFolder(false);
            }}
            autoFocus
          />
          <button
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            onClick={() => setAddingFolder(false)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto" ref={listRef}>
        {/* Folder tree */}
        {filterMode === 'all' && rootFolders.map((folder) => {
          const isCollapsed = collapsedFolders.has(folder.id);
          const folderEntries = entriesByFolder.get(folder.id) || [];
          const isSelected = selectedFolderId === folder.id;

          return (
            <div key={folder.id}>
              {/* Folder header */}
              <div
                className={cn(
                  'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors',
                  'hover:bg-[var(--bg-hover)]',
                  isSelected && 'bg-[var(--accent-glow)]',
                )}
                onClick={() => toggleFolder(folder.id)}
                onDoubleClick={() => handleSelectFolder(folder.id)}
                onContextMenu={(e) => handleFolderContextMenu(e, folder.id)}
              >
                {isCollapsed
                  ? <ChevronRight size={12} className="text-[var(--text-tertiary)] shrink-0" />
                  : <ChevronDown size={12} className="text-[var(--text-tertiary)] shrink-0" />
                }
                <FolderOpen size={14} className="text-[var(--accent)] shrink-0" />

                {renamingFolderId === folder.id ? (
                  <input
                    type="text"
                    className={cn(
                      'flex-1 rounded-md border px-2 py-0.5 text-xs outline-none',
                      'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]',
                    )}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameFolder();
                      if (e.key === 'Escape') setRenamingFolderId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={handleRenameFolder}
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 text-xs font-medium text-[var(--text-primary)] truncate">
                    {folder.name}
                  </span>
                )}
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {folderEntries.length}
                </span>
              </div>

              {/* Folder entries */}
              {!isCollapsed && folderEntries.map((entry) => (
                <EntryItem
                  key={entry.id}
                  entry={entry}
                  isSelected={entry.id === selectedEntryId}
                  indented
                  onSelect={() => onSelectEntry(entry.id)}
                  onContextMenu={(e) => handleContextMenu(e, entry.id)}
                />
              ))}
            </div>
          );
        })}

        {/* Unfoldered entries (or all in favorites/folder mode) */}
        {filterMode === 'all'
          ? unfolderedEntries.map((entry) => (
              <EntryItem
                key={entry.id}
                entry={entry}
                isSelected={entry.id === selectedEntryId}
                indented={false}
                onSelect={() => onSelectEntry(entry.id)}
                onContextMenu={(e) => handleContextMenu(e, entry.id)}
              />
            ))
          : filtered.map((entry) => (
              <EntryItem
                key={entry.id}
                entry={entry}
                isSelected={entry.id === selectedEntryId}
                indented={false}
                onSelect={() => onSelectEntry(entry.id)}
                onContextMenu={(e) => handleContextMenu(e, entry.id)}
              />
            ))
        }

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="text-2xl">🔐</span>
            <p className="text-xs text-[var(--text-tertiary)]">
              {searchQuery ? t('common.noResults') : t('password.noEntries')}
            </p>
          </div>
        )}
      </div>

      {/* Floating add button */}
      <div className="relative">
        <button
          onClick={onAddEntry}
          className={cn(
            'absolute bottom-4 right-4 w-10 h-10 rounded-full shadow-lg flex items-center justify-center',
            'bg-[var(--accent)] text-[var(--text-inverse)] hover:opacity-90 transition-opacity',
          )}
          title={t('password.addEntry')}
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Context menu for entries */}
      {contextMenu && (
        <div
          className={cn(
            'fixed z-50 rounded-lg border shadow-xl py-1 min-w-[160px]',
            'bg-[var(--bg-surface)] border-[var(--border-default)]',
          )}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            onClick={() => { onCopyPassword(contextMenu.entryId); setContextMenu(null); }}
          >
            <Copy size={13} /> {t('password.copyPassword')}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            onClick={() => { onCopyUsername(contextMenu.entryId); setContextMenu(null); }}
          >
            <User size={13} /> {t('password.copyUsername')}
          </button>
          <div className="my-1 border-t border-[var(--border-subtle)]" />
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
            onClick={() => { onDeleteEntry(contextMenu.entryId); setContextMenu(null); }}
          >
            <Trash2 size={13} /> {t('common.delete')}
          </button>
        </div>
      )}

      {/* Context menu for folders */}
      {folderContextMenu && (
        <div
          className={cn(
            'fixed z-50 rounded-lg border shadow-xl py-1 min-w-[160px]',
            'bg-[var(--bg-surface)] border-[var(--border-default)]',
          )}
          style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            onClick={() => {
              const folder = folders.find((f) => f.id === folderContextMenu.folderId);
              if (folder) {
                setRenamingFolderId(folder.id);
                setRenameValue(folder.name);
              }
              setFolderContextMenu(null);
            }}
          >
            <Pencil size={13} /> {t('common.rename')}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
            onClick={() => { onDeleteFolder(folderContextMenu.folderId); setFolderContextMenu(null); }}
          >
            <Trash2 size={13} /> {t('password.deleteFolder')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Entry item sub-component ──

function EntryItem({
  entry,
  isSelected,
  indented,
  onSelect,
  onContextMenu,
}: {
  entry: PasswordEntry;
  isSelected: boolean;
  indented: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
        'hover:bg-[var(--bg-hover)]',
        isSelected && 'bg-[var(--accent-glow)] border-r-2 border-r-[var(--accent)]',
        indented && 'pl-8',
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      data-entry-id={entry.id}
    >
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0',
        getAvatarColor(entry.title),
      )}>
        {getInitials(entry.title)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-[var(--text-primary)] truncate">{entry.title}</span>
          {entry.favorite && <Star size={11} className="text-amber-400 fill-amber-400 shrink-0" />}
        </div>
        <div className="text-xs text-[var(--text-tertiary)] truncate">{entry.username}</div>
      </div>

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div className="flex gap-1 shrink-0">
          {entry.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

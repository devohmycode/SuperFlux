import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search } from 'lucide-react';
import type { MdFileEntry } from './markdownTypes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  vaultPath: string;
  onOpenFile: (path: string, name: string) => void;
}

interface FlatFile {
  path: string;
  name: string;
}

function flattenFiles(entries: MdFileEntry[]): FlatFile[] {
  const result: FlatFile[] = [];
  for (const entry of entries) {
    if (!entry.is_dir) {
      result.push({ path: entry.path, name: entry.name });
    }
    if (entry.children) {
      result.push(...flattenFiles(entry.children));
    }
  }
  return result;
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function MarkdownCommandPalette({ isOpen, onClose, vaultPath, onOpenFile }: Props) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<FlatFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    invoke<MdFileEntry[]>('md_list_md_files', { vaultPath })
      .then((entries) => setFiles(flattenFiles(entries)))
      .catch(() => setFiles([]));
    // Focus input on open
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen, vaultPath]);

  const filtered = useMemo(() => {
    if (!query) return files;
    return files.filter(f => fuzzyMatch(f.name, query));
  }, [files, query]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, query]);

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.children;
    const item = items[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback((file: FlatFile) => {
    onOpenFile(file.path, file.name);
    onClose();
  }, [onOpenFile, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[selectedIndex]) handleSelect(filtered[selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [filtered, selectedIndex, handleSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: 80,
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 480,
          maxHeight: 400,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-surface)',
          borderRadius: 10,
          border: '1px solid var(--border-default)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          fontFamily: 'var(--font-body)',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Search size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search files..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 14,
              width: '100%',
              fontFamily: 'var(--font-body)',
            }}
          />
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '16px 14px', color: 'var(--text-tertiary)', fontSize: 13 }}>
              No files found
            </div>
          ) : (
            filtered.map((file, i) => (
              <div
                key={file.path}
                onClick={() => handleSelect(file)}
                style={{
                  padding: '6px 14px',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: i === selectedIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: i === selectedIndex ? 'var(--accent-glow)' : 'transparent',
                  transition: 'background 0.08s',
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div style={{ fontWeight: i === selectedIndex ? 500 : 400 }}>{file.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {file.path}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

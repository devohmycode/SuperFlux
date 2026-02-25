import { useState, useEffect, useRef, useMemo, type MutableRefObject } from 'react';
import type { Command } from '../hooks/useCommands';

interface CommandPaletteProps {
  commands: MutableRefObject<Command[]>;
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ commands, isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const all = commands.current ?? [];
    if (!query.trim()) return all;

    const q = query.toLowerCase();
    return all.filter(cmd => {
      const text = `${cmd.label} ${cmd.category}`.toLowerCase();
      // Fuzzy: every character of query appears in order
      let qi = 0;
      for (let i = 0; i < text.length && qi < q.length; i++) {
        if (text[i] === q[qi]) qi++;
      }
      return qi === q.length;
    });
  }, [query, commands]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const cmd of filtered) {
      const group = map.get(cmd.category) || [];
      group.push(cmd);
      map.set(cmd.category, group);
    }
    return map;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    const result: Command[] = [];
    for (const cmds of grouped.values()) result.push(...cmds);
    return result;
  }, [grouped]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey)) {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey)) {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = flatList[selectedIndex];
      if (cmd) {
        onClose();
        // Run in next tick so palette closes first
        setTimeout(() => cmd.action(), 0);
      }
    }
  };

  if (!isOpen) return null;

  let flatIdx = 0;

  return (
    <div className="cmd-palette-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="cmd-palette-input-wrap">
          <span className="cmd-palette-icon">&#9655;</span>
          <input
            ref={inputRef}
            type="text"
            className="cmd-palette-input"
            placeholder="Rechercher une commande..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmd-palette-esc">Esc</kbd>
        </div>
        <div className="cmd-palette-list" ref={listRef}>
          {flatList.length === 0 ? (
            <div className="cmd-palette-empty">Aucun résultat</div>
          ) : (
            Array.from(grouped.entries()).map(([category, cmds]) => (
              <div key={category}>
                <div className="cmd-palette-group">{category}</div>
                {cmds.map((cmd) => {
                  const idx = flatIdx++;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      className={`cmd-palette-item ${isSelected ? 'cmd-palette-item--selected' : ''}`}
                      data-selected={isSelected}
                      onClick={() => {
                        onClose();
                        setTimeout(() => cmd.action(), 0);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="cmd-palette-item-label">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="cmd-palette-item-shortcut">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, type MutableRefObject } from 'react';
import type { Command } from '../hooks/useCommands';

interface ShortcutsOverlayProps {
  commands: MutableRefObject<Command[]>;
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsOverlay({ commands, isOpen, onClose }: ShortcutsOverlayProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Group commands that have shortcuts
  const grouped = new Map<string, Command[]>();
  for (const cmd of commands.current ?? []) {
    if (!cmd.shortcut) continue;
    const group = grouped.get(cmd.category) || [];
    group.push(cmd);
    grouped.set(cmd.category, group);
  }

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-overlay" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2 className="shortcuts-title">Raccourcis clavier</h2>
          <button className="shortcuts-close" onClick={onClose}>&#10005;</button>
        </div>
        <div className="shortcuts-grid">
          {Array.from(grouped.entries()).map(([category, cmds]) => (
            <div key={category} className="shortcuts-section">
              <h3 className="shortcuts-category">{category}</h3>
              {cmds.map(cmd => (
                <div key={cmd.id} className="shortcuts-row">
                  <span className="shortcuts-label">{cmd.label}</span>
                  <kbd className="shortcuts-kbd">{cmd.shortcut}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

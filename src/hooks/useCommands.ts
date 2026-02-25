import { useEffect, useCallback, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  category: string;
  shortcut?: string;         // Display string: "Ctrl+K"
  keybind?: KeyBind;         // Actual key matcher
  action: () => void;
  when?: () => boolean;       // Only active when this returns true
}

interface KeyBind {
  key: string;               // e.g. "k", "1", "/", "?"
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

function parseShortcut(shortcut: string): KeyBind {
  const parts = shortcut.toLowerCase().split('+');
  return {
    key: parts[parts.length - 1],
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta'),
  };
}

function matchesKeybind(e: KeyboardEvent, kb: KeyBind): boolean {
  const key = e.key.toLowerCase();
  // Handle special cases
  const targetKey = kb.key === ',' ? ',' : kb.key === '/' ? '/' : kb.key === '?' ? '?' : kb.key;

  if (key !== targetKey) return false;
  if (!!kb.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (!!kb.alt !== e.altKey) return false;
  if (!!kb.shift !== e.shiftKey) return false;

  return true;
}

function isInInput(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useCommands() {
  const commandsRef = useRef<Command[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const registerCommands = useCallback((commands: Command[]) => {
    // Process shortcuts into keybinds
    const processed = commands.map(cmd => ({
      ...cmd,
      keybind: cmd.shortcut ? parseShortcut(cmd.shortcut) : cmd.keybind,
    }));
    commandsRef.current = processed;
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const toggleHelp = useCallback(() => setHelpOpen(prev => !prev), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command Palette: Ctrl+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
        return;
      }

      // If palette is open, don't process other shortcuts
      if (paletteOpen) return;

      const inInput = isInInput(e);

      for (const cmd of commandsRef.current) {
        if (!cmd.keybind) continue;

        // Simple keys (no modifier) are blocked in inputs
        const hasModifier = cmd.keybind.ctrl || cmd.keybind.alt || cmd.keybind.shift || cmd.keybind.meta;
        if (!hasModifier && inInput) continue;

        if (!matchesKeybind(e, cmd.keybind)) continue;

        // Check "when" condition
        if (cmd.when && !cmd.when()) continue;

        e.preventDefault();
        cmd.action();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [paletteOpen]);

  return {
    commands: commandsRef,
    registerCommands,
    paletteOpen,
    openPalette,
    closePalette,
    helpOpen,
    toggleHelp,
    closeHelp,
  };
}

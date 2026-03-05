import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GitBranch, GitBranchPlus, RefreshCw, Eye, Split, Edit3, ChevronDown, Check } from 'lucide-react';
import type { MdViewMode, MdBranchInfo } from './markdownTypes';

interface Props {
  branch: string | null;
  line: number;
  col: number;
  totalLines: number;
  viewMode: MdViewMode;
  onViewModeChange: (mode: MdViewMode) => void;
  gitAhead: number;
  gitBehind: number;
  onSync: () => void;
  vaultPath: string | null;
  onRefreshStatus: () => void;
}

const viewModes: { mode: MdViewMode; icon: typeof Edit3; label: string }[] = [
  { mode: 'edit', icon: Edit3, label: 'Edit' },
  { mode: 'split', icon: Split, label: 'Split' },
  { mode: 'preview', icon: Eye, label: 'Preview' },
];

export function MarkdownStatusBar({
  branch,
  line,
  col,
  totalLines,
  viewMode,
  onViewModeChange,
  gitAhead,
  gitBehind,
  onSync,
  vaultPath,
  onRefreshStatus,
}: Props) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [branches, setBranches] = useState<MdBranchInfo[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadBranches = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<MdBranchInfo[]>('md_git_list_branches', { vaultPath });
      setBranches(list);
    } catch { /* empty */ }
  }, [vaultPath]);

  useEffect(() => { if (showDropdown) loadBranches(); }, [showDropdown, loadBranches]);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  // Close on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setCreating(false);
        setNewName('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  const handleCheckout = useCallback(async (name: string) => {
    if (!vaultPath) return;
    setLoading(true);
    try {
      await invoke('md_git_checkout_branch', { vaultPath, branchName: name });
      setShowDropdown(false);
      onRefreshStatus();
    } catch (e) { console.error('Checkout failed:', e); }
    setLoading(false);
  }, [vaultPath, onRefreshStatus]);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || !vaultPath) return;
    setLoading(true);
    try {
      await invoke('md_git_create_branch', { vaultPath, branchName: name });
      await invoke('md_git_checkout_branch', { vaultPath, branchName: name });
      setNewName('');
      setCreating(false);
      setShowDropdown(false);
      onRefreshStatus();
    } catch (e) { console.error('Create branch failed:', e); }
    setLoading(false);
  }, [vaultPath, newName, onRefreshStatus]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 26,
        padding: '0 10px',
        gap: 12,
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-root)',
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        color: 'var(--text-secondary)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Branch selector */}
      {branch && (
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowDropdown(o => !o)}
            title="Switch branch"
            className="md-statusbar-branch-btn"
          >
            <GitBranch size={12} />
            <span>{branch}</span>
            <ChevronDown size={10} style={{ opacity: 0.5 }} />
          </button>

          {showDropdown && (
            <div className="md-statusbar-branch-dropdown">
              {/* New branch */}
              {creating ? (
                <div className="md-statusbar-branch-new">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                    }}
                    placeholder="new-branch-name"
                    className="md-statusbar-branch-input"
                  />
                  <button
                    className="md-statusbar-branch-confirm"
                    onClick={handleCreate}
                    disabled={!newName.trim() || loading}
                    title="Create & switch"
                  >
                    <Check size={12} />
                  </button>
                </div>
              ) : (
                <button
                  className="md-statusbar-branch-item md-statusbar-branch-create"
                  onClick={() => setCreating(true)}
                >
                  <GitBranchPlus size={13} />
                  <span>New branch</span>
                </button>
              )}

              <div className="md-statusbar-branch-sep" />

              {branches.map(b => (
                <button
                  key={b.name}
                  className={`md-statusbar-branch-item${b.is_current ? ' md-statusbar-branch-active' : ''}`}
                  onClick={() => { if (!b.is_current) handleCheckout(b.name); }}
                  disabled={b.is_current || loading}
                >
                  <GitBranch size={11} />
                  <span>{b.name}</span>
                  {b.is_current && <Check size={11} style={{ marginLeft: 'auto', opacity: 0.4 }} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cursor position */}
      <div>
        Ln {line}, Col {col}
      </div>

      {/* Total lines */}
      <div style={{ color: 'var(--text-tertiary)' }}>
        {totalLines} lines
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* View mode toggles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {viewModes.map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            onClick={() => onViewModeChange(mode)}
            title={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 6px',
              background: viewMode === mode ? 'var(--accent-glow)' : 'transparent',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              color: viewMode === mode ? 'var(--accent)' : 'var(--text-tertiary)',
              transition: 'all 0.12s',
            }}
            onMouseEnter={(e) => {
              if (viewMode !== mode) e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              if (viewMode !== mode) e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon size={12} />
          </button>
        ))}
      </div>

      {/* Sync button */}
      {branch && (gitAhead > 0 || gitBehind > 0) && (
        <button
          onClick={onSync}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            background: 'transparent',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            color: 'var(--accent)',
            fontSize: 11,
            fontFamily: 'var(--font-body)',
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <RefreshCw size={11} />
          {gitAhead > 0 && <span>{gitAhead}↑</span>}
          {gitBehind > 0 && <span>{gitBehind}↓</span>}
        </button>
      )}
    </div>
  );
}

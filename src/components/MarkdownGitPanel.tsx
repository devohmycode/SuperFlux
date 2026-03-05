import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GitBranch, Plus, Minus, Check, Upload, Download, RotateCcw, ChevronDown, ChevronRight, Eye, GitBranchPlus } from 'lucide-react';
import type { MdGitStatusResult, MdGitFileStatus, MdGitLogEntry, MdDiffContent, MdBranchInfo } from './markdownTypes';

interface Props {
  vaultPath: string;
  gitStatus: MdGitStatusResult | null;
  onRefreshStatus: () => void;
  onShowDiff?: (oldContent: string, newContent: string, fileName: string) => void;
}

const statusLabels: Record<string, string> = {
  Modified: 'M', Added: 'A', Deleted: 'D', Untracked: 'U', Staged: 'S',
  StagedModified: 'SM', StagedDeleted: 'SD', StagedRenamed: 'SR', Conflicted: 'C', Renamed: 'R',
};

const statusColors: Record<string, string> = {
  Modified: '#fab387', Added: '#a6e3a1', Deleted: '#f38ba8', Untracked: '#a6e3a1',
  Staged: '#a6e3a1', StagedModified: '#f9e2af', StagedDeleted: '#f38ba8', Conflicted: '#f38ba8',
};

function isStaged(status: MdGitFileStatus): boolean {
  return status === 'Staged' || status === 'StagedModified' || status === 'StagedDeleted' || status === 'StagedRenamed';
}

export function MarkdownGitPanel({ vaultPath, gitStatus, onRefreshStatus, onShowDiff }: Props) {
  const [commitMsg, setCommitMsg] = useState('');
  const [log, setLog] = useState<MdGitLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [loading, setLoading] = useState('');
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [branches, setBranches] = useState<MdBranchInfo[]>([]);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);

  const files = gitStatus?.files ?? {};
  const info = gitStatus?.info;
  const stagedFiles = Object.entries(files).filter(([, s]) => isStaged(s));
  const unstagedFiles = Object.entries(files).filter(([, s]) => !isStaged(s) && s !== 'Ignored');

  const loadLog = useCallback(async () => {
    try {
      const entries = await invoke<MdGitLogEntry[]>('md_git_log', { vaultPath, maxCount: 20 });
      setLog(entries);
    } catch { /* empty */ }
  }, [vaultPath]);

  useEffect(() => { if (showLog) loadLog(); }, [showLog, loadLog]);

  const loadBranches = useCallback(async () => {
    try {
      const list = await invoke<MdBranchInfo[]>('md_git_list_branches', { vaultPath });
      setBranches(list);
    } catch { /* empty */ }
  }, [vaultPath]);

  useEffect(() => { if (showBranchDropdown) loadBranches(); }, [showBranchDropdown, loadBranches]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showBranchDropdown) return;
    const close = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setShowBranchDropdown(false);
        setShowNewBranchInput(false);
        setNewBranchName('');
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showBranchDropdown]);

  // Auto-focus new branch input
  useEffect(() => {
    if (showNewBranchInput) newBranchInputRef.current?.focus();
  }, [showNewBranchInput]);

  const handleCheckoutBranch = useCallback(async (branchName: string) => {
    setLoading('checkout');
    try {
      await invoke('md_git_checkout_branch', { vaultPath, branchName });
      setShowBranchDropdown(false);
      onRefreshStatus();
    } catch (e) { console.error('Checkout failed:', e); }
    setLoading('');
  }, [vaultPath, onRefreshStatus]);

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim();
    if (!name) return;
    setLoading('create-branch');
    try {
      await invoke('md_git_create_branch', { vaultPath, branchName: name });
      await invoke('md_git_checkout_branch', { vaultPath, branchName: name });
      setNewBranchName('');
      setShowNewBranchInput(false);
      setShowBranchDropdown(false);
      onRefreshStatus();
    } catch (e) { console.error('Create branch failed:', e); }
    setLoading('');
  }, [vaultPath, newBranchName, onRefreshStatus]);

  const handleStage = useCallback(async (paths: string[]) => {
    try {
      await invoke('md_git_stage', { vaultPath, filePaths: paths });
      onRefreshStatus();
    } catch (e) { console.error('Stage failed:', e); }
  }, [vaultPath, onRefreshStatus]);

  const handleUnstage = useCallback(async (paths: string[]) => {
    try {
      await invoke('md_git_unstage', { vaultPath, filePaths: paths });
      onRefreshStatus();
    } catch (e) { console.error('Unstage failed:', e); }
  }, [vaultPath, onRefreshStatus]);

  const handleDiscard = useCallback(async (path: string) => {
    if (!confirm(`Discard changes to ${path.split(/[/\\]/).pop()}?`)) return;
    try {
      await invoke('md_git_discard_changes', { vaultPath, filePath: path });
      onRefreshStatus();
    } catch (e) { console.error('Discard failed:', e); }
  }, [vaultPath, onRefreshStatus]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return;
    setLoading('commit');
    try {
      await invoke('md_git_commit', { vaultPath, message: commitMsg });
      setCommitMsg('');
      onRefreshStatus();
      loadLog();
    } catch (e) { console.error('Commit failed:', e); }
    setLoading('');
  }, [vaultPath, commitMsg, onRefreshStatus, loadLog]);

  const handlePush = useCallback(async () => {
    setLoading('push');
    try {
      await invoke('md_git_push', { vaultPath });
      onRefreshStatus();
    } catch (e) { console.error('Push failed:', e); }
    setLoading('');
  }, [vaultPath, onRefreshStatus]);

  const handlePull = useCallback(async () => {
    setLoading('pull');
    try {
      await invoke('md_git_pull', { vaultPath });
      onRefreshStatus();
    } catch (e) { console.error('Pull failed:', e); }
    setLoading('');
  }, [vaultPath, onRefreshStatus]);

  const handleViewDiff = useCallback(async (filePath: string) => {
    if (!onShowDiff) return;
    try {
      const diff = await invoke<MdDiffContent>('md_git_diff_contents', { vaultPath, filePath });
      onShowDiff(diff.old_content, diff.new_content, diff.file_name);
    } catch (e) { console.error('Diff failed:', e); }
  }, [vaultPath, onShowDiff]);

  const handleInitRepo = useCallback(async () => {
    setLoading('init');
    try {
      await invoke('md_git_init', { vaultPath });
      onRefreshStatus();
    } catch (e) { console.error('Init failed:', e); }
    setLoading('');
  }, [vaultPath, onRefreshStatus]);

  if (!info?.is_repo) {
    return (
      <div className="md-git-panel">
        <div className="md-git-empty">
          <p>Not a git repository</p>
          <button className="md-btn md-btn-primary" onClick={handleInitRepo} disabled={loading === 'init'}>
            Initialize Repository
          </button>
        </div>
      </div>
    );
  }

  const shortName = (path: string) => path.split(/[/\\]/).pop() || path;

  return (
    <div className="md-git-panel">
      <div className="md-git-branch-area" ref={branchDropdownRef}>
        <button
          className="md-git-branch-btn"
          onClick={() => setShowBranchDropdown(o => !o)}
          title="Switch branch"
        >
          <GitBranch size={14} />
          <span>{info.branch || 'HEAD'}</span>
          {info.ahead > 0 && <span className="md-git-badge md-git-ahead">{info.ahead}↑</span>}
          {info.behind > 0 && <span className="md-git-badge md-git-behind">{info.behind}↓</span>}
          <ChevronDown size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />
        </button>

        {showBranchDropdown && (
          <div className="md-git-branch-dropdown">
            {/* New branch */}
            {showNewBranchInput ? (
              <div className="md-git-branch-new-input">
                <input
                  ref={newBranchInputRef}
                  type="text"
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateBranch();
                    if (e.key === 'Escape') { setShowNewBranchInput(false); setNewBranchName(''); }
                  }}
                  placeholder="new-branch-name"
                  className="md-git-branch-name-input"
                />
                <button
                  className="md-git-action"
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim() || loading === 'create-branch'}
                  title="Create & switch"
                >
                  <Check size={14} />
                </button>
              </div>
            ) : (
              <button
                className="md-git-branch-item md-git-branch-create"
                onClick={() => setShowNewBranchInput(true)}
              >
                <GitBranchPlus size={14} />
                <span>New branch</span>
              </button>
            )}

            <div className="md-git-branch-divider" />

            {/* Branch list */}
            {branches.map(b => (
              <button
                key={b.name}
                className={`md-git-branch-item${b.is_current ? ' md-git-branch-current' : ''}`}
                onClick={() => { if (!b.is_current) handleCheckoutBranch(b.name); }}
                disabled={b.is_current || loading === 'checkout'}
              >
                <GitBranch size={12} />
                <span>{b.name}</span>
                {b.is_current && <Check size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Staged */}
      <div className="md-git-section">
        <div className="md-git-section-header" onClick={() => setStagedOpen(o => !o)}>
          {stagedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Staged ({stagedFiles.length})</span>
          {stagedFiles.length > 0 && (
            <button className="md-git-action" onClick={(e) => { e.stopPropagation(); handleUnstage(stagedFiles.map(([p]) => p)); }} title="Unstage all">
              <Minus size={12} />
            </button>
          )}
        </div>
        {stagedOpen && stagedFiles.map(([path, status]) => (
          <div key={path} className="md-git-file">
            <span className="md-git-status" style={{ color: statusColors[status] }}>{statusLabels[status]}</span>
            <span className="md-git-filename">{shortName(path)}</span>
            <div className="md-git-file-actions">
              {onShowDiff && <button className="md-git-action" onClick={() => handleViewDiff(path)} title="View diff"><Eye size={12} /></button>}
              <button className="md-git-action" onClick={() => handleUnstage([path])} title="Unstage"><Minus size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Unstaged */}
      <div className="md-git-section">
        <div className="md-git-section-header" onClick={() => setUnstagedOpen(o => !o)}>
          {unstagedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Changes ({unstagedFiles.length})</span>
          {unstagedFiles.length > 0 && (
            <button className="md-git-action" onClick={(e) => { e.stopPropagation(); handleStage(unstagedFiles.map(([p]) => p)); }} title="Stage all">
              <Plus size={12} />
            </button>
          )}
        </div>
        {unstagedOpen && unstagedFiles.map(([path, status]) => (
          <div key={path} className="md-git-file">
            <span className="md-git-status" style={{ color: statusColors[status] }}>{statusLabels[status]}</span>
            <span className="md-git-filename">{shortName(path)}</span>
            <div className="md-git-file-actions">
              {onShowDiff && <button className="md-git-action" onClick={() => handleViewDiff(path)} title="View diff"><Eye size={12} /></button>}
              <button className="md-git-action" onClick={() => handleStage([path])} title="Stage"><Plus size={12} /></button>
              <button className="md-git-action" onClick={() => handleDiscard(path)} title="Discard"><RotateCcw size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Commit */}
      <div className="md-git-commit-area">
        <textarea
          className="md-git-commit-input"
          value={commitMsg}
          onChange={e => setCommitMsg(e.target.value)}
          placeholder="Commit message..."
          rows={3}
        />
        <div className="md-git-commit-actions">
          <button className="md-btn md-btn-primary" onClick={handleCommit} disabled={!commitMsg.trim() || stagedFiles.length === 0 || loading === 'commit'}>
            <Check size={14} /> Commit
          </button>
          <button className="md-btn" onClick={handlePush} disabled={loading === 'push' || !info.has_remote}>
            <Upload size={14} /> Push
          </button>
          <button className="md-btn" onClick={handlePull} disabled={loading === 'pull' || !info.has_remote}>
            <Download size={14} /> Pull
          </button>
        </div>
      </div>

      {/* Log */}
      <div className="md-git-section">
        <div className="md-git-section-header" onClick={() => setShowLog(o => !o)}>
          {showLog ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Recent Commits</span>
        </div>
        {showLog && log.map(entry => (
          <div key={entry.id} className="md-git-log-entry">
            <span className="md-git-log-hash">{entry.id}</span>
            <span className="md-git-log-msg">{entry.summary}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

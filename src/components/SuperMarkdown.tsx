import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MarkdownCodeEditor } from './MarkdownCodeEditor';
import { MarkdownSidebar } from './MarkdownSidebar';
import { MarkdownTabBar } from './MarkdownTabBar';
import { MarkdownStatusBar } from './MarkdownStatusBar';
import { MarkdownDiffView } from './MarkdownDiffView';
import { MarkdownCommandPalette } from './MarkdownCommandPalette';
import type { MdFileEntry, MdGitStatusResult, MdTab, MdViewMode } from './markdownTypes';

const VAULT_PATH_KEY = 'supermarkdown_vault_path';

interface Props {
  searchQuery?: string;
}

export function SuperMarkdown({ searchQuery }: Props) {
  // Vault state
  const [vaultPath, setVaultPath] = useState<string | null>(() => localStorage.getItem(VAULT_PATH_KEY));
  const [fileTree, setFileTree] = useState<MdFileEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<MdGitStatusResult | null>(null);

  // Editor state
  const [tabs, setTabs] = useState<MdTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(-1);
  const [content, setContent] = useState('');
  const [viewMode, setViewMode] = useState<MdViewMode>('edit');
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [totalLines, setTotalLines] = useState(0);

  // Diff state
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffOld, setDiffOld] = useState('');
  const [diffNew, setDiffNew] = useState('');
  const [diffFileName, setDiffFileName] = useState('');

  // Command palette
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeTab = activeTabIndex >= 0 ? tabs[activeTabIndex] : null;
  const activeFilePath = activeTab?.path ?? null;
  const contentRef = useRef(content);
  contentRef.current = content;

  // Load vault files
  const refreshFileTree = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const tree = await invoke<MdFileEntry[]>('md_list_vault_files', { vaultPath });
      setFileTree(tree);
    } catch (e) { console.error('Failed to load vault:', e); }
  }, [vaultPath]);

  // Load git status
  const refreshGitStatus = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const status = await invoke<MdGitStatusResult>('md_git_status', { vaultPath });
      setGitStatus(status);
    } catch { setGitStatus(null); }
  }, [vaultPath]);

  // Initialize vault
  useEffect(() => {
    if (vaultPath) {
      refreshFileTree();
      refreshGitStatus();
    }
  }, [vaultPath, refreshFileTree, refreshGitStatus]);

  // Listen for vault-changed from SourcePanel
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (path) {
        setVaultPath(path);
      }
    };
    window.addEventListener('vault-changed', handler);
    return () => window.removeEventListener('vault-changed', handler);
  }, []);

  // Open vault dialog
  const handleSelectVault = useCallback(async () => {
    try {
      const selected = await invoke<string | null>('md_pick_folder');
      if (selected) {
        setVaultPath(selected);
        localStorage.setItem(VAULT_PATH_KEY, selected);
      }
    } catch (e) {
      console.error('Folder picker failed:', e);
    }
  }, []);

  // Open file
  const handleSelectFile = useCallback(async (filePath: string, fileName: string) => {
    try {
      const fileContent = await invoke<string>('md_read_file', { filePath });
      // Check if tab already open
      const existingIdx = tabs.findIndex(t => t.path === filePath);
      if (existingIdx >= 0) {
        setActiveTabIndex(existingIdx);
        setContent(fileContent);
        return;
      }
      // Open new tab
      const newTab: MdTab = { path: filePath, name: fileName, isDirty: false };
      setTabs(prev => [...prev, newTab]);
      setActiveTabIndex(tabs.length);
      setContent(fileContent);
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }, [tabs]);

  // Tab operations
  const handleTabSwitch = useCallback(async (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    try {
      const fileContent = await invoke<string>('md_read_file', { filePath: tab.path });
      setActiveTabIndex(index);
      setContent(fileContent);
    } catch (e) { console.error('Tab switch failed:', e); }
  }, [tabs]);

  const handleTabClose = useCallback((index: number) => {
    setTabs(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (index === activeTabIndex) {
        const newIdx = Math.min(index, next.length - 1);
        setActiveTabIndex(newIdx);
        if (newIdx >= 0 && next[newIdx]) {
          invoke<string>('md_read_file', { filePath: next[newIdx].path }).then(setContent).catch(() => setContent(''));
        } else {
          setContent('');
        }
      } else if (index < activeTabIndex) {
        setActiveTabIndex(prev => prev - 1);
      }
      return next;
    });
  }, [activeTabIndex]);

  // Content changes
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setTabs(prev => prev.map((t, i) => i === activeTabIndex ? { ...t, isDirty: true } : t));
  }, [activeTabIndex]);

  const handleSave = useCallback(async (newContent: string) => {
    if (!activeTab) return;
    try {
      await invoke('md_write_file', { filePath: activeTab.path, content: newContent });
      setTabs(prev => prev.map((t, i) => i === activeTabIndex ? { ...t, isDirty: false } : t));
      refreshGitStatus();
    } catch (e) { console.error('Save failed:', e); }
  }, [activeTab, activeTabIndex, refreshGitStatus]);

  // Cursor tracking
  const handleCursorChange = useCallback((line: number, col: number, lines: number) => {
    setCursorLine(line);
    setCursorCol(col);
    setTotalLines(lines);
  }, []);

  // Wikilink navigation
  const handleNavigateWikilink = useCallback(async (target: string) => {
    if (!vaultPath) return;
    try {
      const resolved = await invoke<string | null>('md_resolve_wikilink', { vaultPath, linkName: target });
      if (resolved) {
        const name = resolved.split(/[/\\]/).pop() || resolved;
        handleSelectFile(resolved, name);
      }
    } catch (e) { console.error('Wikilink navigation failed:', e); }
  }, [vaultPath, handleSelectFile]);

  // File operations
  const handleCreateFile = useCallback(async (parentPath: string) => {
    if (!vaultPath) return;
    const name = prompt('File name (e.g. note.md):');
    if (!name) return;
    const relativePath = parentPath === vaultPath ? name : `${parentPath.replace(vaultPath, '').replace(/^[/\\]/, '')}/${name}`;
    try {
      const fullPath = await invoke<string>('md_create_file', { vaultPath, relativePath });
      refreshFileTree();
      handleSelectFile(fullPath, name);
    } catch (e) { console.error('Create file failed:', e); }
  }, [vaultPath, refreshFileTree, handleSelectFile]);

  const handleCreateFolder = useCallback(async (parentPath: string) => {
    if (!vaultPath) return;
    const name = prompt('Folder name:');
    if (!name) return;
    const relativePath = parentPath === vaultPath ? name : `${parentPath.replace(vaultPath, '').replace(/^[/\\]/, '')}/${name}`;
    try {
      await invoke<string>('md_create_folder', { vaultPath, relativePath });
      refreshFileTree();
    } catch (e) { console.error('Create folder failed:', e); }
  }, [vaultPath, refreshFileTree]);

  const handleDeleteEntry = useCallback(async (path: string) => {
    const name = path.split(/[/\\]/).pop() || path;
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await invoke('md_delete_entry', { filePath: path });
      // Close tab if open
      setTabs(prev => prev.filter(t => t.path !== path));
      refreshFileTree();
      refreshGitStatus();
    } catch (e) { console.error('Delete failed:', e); }
  }, [refreshFileTree, refreshGitStatus]);

  const handleRenameEntry = useCallback(async (path: string) => {
    const oldName = path.split(/[/\\]/).pop() || '';
    const newName = prompt('New name:', oldName);
    if (!newName || newName === oldName) return;
    try {
      const newPath = await invoke<string>('md_rename_entry', { oldPath: path, newName });
      // Update tab if open
      setTabs(prev => prev.map(t => t.path === path ? { ...t, path: newPath, name: newName } : t));
      refreshFileTree();
    } catch (e) { console.error('Rename failed:', e); }
  }, [refreshFileTree]);

  // Show diff
  const handleShowDiff = useCallback((oldContent: string, newContent: string, fileName: string) => {
    setDiffOld(oldContent);
    setDiffNew(newContent);
    setDiffFileName(fileName);
    setDiffOpen(true);
  }, []);

  // Git sync
  const handleSync = useCallback(async () => {
    if (!vaultPath) return;
    try {
      await invoke<string>('md_git_sync', { vaultPath });
      refreshGitStatus();
      refreshFileTree();
    } catch (e) { console.error('Sync failed:', e); }
  }, [vaultPath, refreshGitStatus, refreshFileTree]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="md-app">
      {diffOpen && (
        <MarkdownDiffView
          oldContent={diffOld}
          newContent={diffNew}
          fileName={diffFileName}
          onClose={() => setDiffOpen(false)}
        />
      )}
      {paletteOpen && vaultPath && (
        <MarkdownCommandPalette
          isOpen={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          vaultPath={vaultPath}
          onOpenFile={handleSelectFile}
        />
      )}
      <div className="md-main" style={{ display: diffOpen ? 'none' : 'flex' }}>
        <MarkdownSidebar
          vaultPath={vaultPath || ''}
          fileTree={fileTree}
          selectedPath={activeFilePath}
          gitStatus={gitStatus}
          onSelectFile={handleSelectFile}
          onRefresh={refreshFileTree}
          onRefreshGit={refreshGitStatus}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onDeleteEntry={handleDeleteEntry}
          onRenameEntry={handleRenameEntry}
          onShowDiff={handleShowDiff}
        />
        <div className="md-editor-area">
          <MarkdownTabBar
            tabs={tabs}
            activeIndex={activeTabIndex}
            onSwitch={handleTabSwitch}
            onClose={handleTabClose}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
          {activeTab ? (
            <MarkdownCodeEditor
              key={activeTab.path}
              content={content}
              filePath={activeFilePath}
              vaultPath={vaultPath || ''}
              viewMode={viewMode}
              onContentChange={handleContentChange}
              onSave={handleSave}
              onCursorChange={handleCursorChange}
              onNavigateWikilink={handleNavigateWikilink}
            />
          ) : (
            <div className="md-welcome">
              {vaultPath ? (
                <div className="md-welcome-content">
                  <h2>SuperMarkdown</h2>
                  <p>Select a file from the sidebar or create a new one</p>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Ctrl+P to open command palette</p>
                </div>
              ) : (
                <div className="md-welcome-content">
                  <h2>SuperMarkdown</h2>
                  <p>Open a vault folder to get started</p>
                  <button className="md-btn md-btn-primary" onClick={handleSelectVault}>
                    Open Vault
                  </button>
                </div>
              )}
            </div>
          )}
          <MarkdownStatusBar
            branch={gitStatus?.info.branch ?? null}
            line={cursorLine}
            col={cursorCol}
            totalLines={totalLines}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            gitAhead={gitStatus?.info.ahead ?? 0}
            gitBehind={gitStatus?.info.behind ?? 0}
            onSync={handleSync}
            vaultPath={vaultPath}
            onRefreshStatus={refreshGitStatus}
          />
        </div>
      </div>
    </div>
  );
}

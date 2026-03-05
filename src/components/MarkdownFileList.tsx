import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen, FilePlus, FolderPlus, RefreshCw } from 'lucide-react';
import { MarkdownFileTree } from './MarkdownFileTree';
import type { MdFileEntry, MdGitStatusResult } from './markdownTypes';

interface Props {
  vaultPath: string | null;
  onSelectVault: () => void;
  selectedPath: string | null;
  onSelectFile: (path: string, name: string) => void;
  searchQuery?: string;
}

export function MarkdownFileList({ vaultPath, onSelectVault, selectedPath, onSelectFile, searchQuery }: Props) {
  const [fileTree, setFileTree] = useState<MdFileEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<MdGitStatusResult | null>(null);

  const loadTree = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const tree = await invoke<MdFileEntry[]>('md_list_vault_files', { vaultPath });
      setFileTree(tree);
    } catch (e) {
      console.error('Failed to load vault files:', e);
    }
  }, [vaultPath]);

  const loadGitStatus = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const status = await invoke<MdGitStatusResult>('md_git_status', { vaultPath });
      setGitStatus(status);
    } catch { /* not a git repo */ }
  }, [vaultPath]);

  useEffect(() => {
    loadTree();
    loadGitStatus();
  }, [loadTree, loadGitStatus]);

  const handleCreateFile = useCallback(async () => {
    if (!vaultPath) return;
    const name = prompt('File name (e.g. note.md):');
    if (!name) return;
    try {
      await invoke<string>('md_create_file', { vaultPath, relativePath: name });
      loadTree();
    } catch (e) {
      console.error('Failed to create file:', e);
    }
  }, [vaultPath, loadTree]);

  const handleCreateFolder = useCallback(async () => {
    if (!vaultPath) return;
    const name = prompt('Folder name:');
    if (!name) return;
    try {
      await invoke<string>('md_create_folder', { vaultPath, relativePath: name });
      loadTree();
    } catch (e) {
      console.error('Failed to create folder:', e);
    }
  }, [vaultPath, loadTree]);

  const handleDelete = useCallback(async (path: string) => {
    const name = path.split(/[/\\]/).pop() || path;
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await invoke('md_delete_entry', { filePath: path });
      loadTree();
    } catch (e) {
      console.error('Failed to delete:', e);
    }
  }, [loadTree]);

  const handleRename = useCallback(async (path: string) => {
    const oldName = path.split(/[/\\]/).pop() || '';
    const newName = prompt('New name:', oldName);
    if (!newName || newName === oldName) return;
    try {
      await invoke<string>('md_rename_entry', { oldPath: path, newName });
      loadTree();
    } catch (e) {
      console.error('Failed to rename:', e);
    }
  }, [loadTree]);

  // Filter tree by search query
  const filterTree = useCallback((entries: MdFileEntry[], query: string): MdFileEntry[] => {
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.reduce<MdFileEntry[]>((acc, entry) => {
      if (entry.is_dir) {
        const filteredChildren = filterTree(entry.children || [], query);
        if (filteredChildren.length > 0) {
          acc.push({ ...entry, children: filteredChildren });
        }
      } else if (entry.name.toLowerCase().includes(q)) {
        acc.push(entry);
      }
      return acc;
    }, []);
  }, []);

  const displayTree = searchQuery ? filterTree(fileTree, searchQuery) : fileTree;

  if (!vaultPath) {
    return (
      <div className="md-file-list-empty">
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '16px 0' }}>
          Open a vault folder to start
        </p>
        <button className="md-btn md-btn-primary" onClick={onSelectVault}>
          <FolderOpen size={14} /> Open Vault
        </button>
      </div>
    );
  }

  return (
    <div className="md-file-list">
      <div className="md-file-list-header">
        <span className="md-file-list-title">{vaultPath.split(/[/\\]/).pop()}</span>
        <div className="md-file-list-actions">
          <button className="md-sidebar-action" onClick={handleCreateFile} title="New file">
            <FilePlus size={14} />
          </button>
          <button className="md-sidebar-action" onClick={handleCreateFolder} title="New folder">
            <FolderPlus size={14} />
          </button>
          <button className="md-sidebar-action" onClick={loadTree} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="md-file-list-scroll">
        <MarkdownFileTree
          entries={displayTree}
          selectedPath={selectedPath}
          gitFiles={gitStatus?.files}
          onSelectFile={onSelectFile}
          onDelete={handleDelete}
          onRename={handleRename}
        />
      </div>
    </div>
  );
}

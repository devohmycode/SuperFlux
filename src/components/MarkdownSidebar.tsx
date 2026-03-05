import { useState, useCallback } from 'react';
import { FolderTree, GitBranch, Search, Link2, Tag, FilePlus, FolderPlus, RefreshCw } from 'lucide-react';
import { MarkdownFileTree } from './MarkdownFileTree';
import { MarkdownGitPanel } from './MarkdownGitPanel';
import { MarkdownSearchPanel } from './MarkdownSearchPanel';
import { MarkdownBacklinksPanel } from './MarkdownBacklinksPanel';
import { MarkdownTagsPanel } from './MarkdownTagsPanel';
import type { MdFileEntry, MdGitStatusResult } from './markdownTypes';

type SidebarTab = 'explorer' | 'git' | 'search' | 'backlinks' | 'tags';

interface Props {
  vaultPath: string;
  fileTree: MdFileEntry[];
  selectedPath: string | null;
  gitStatus: MdGitStatusResult | null;
  onSelectFile: (path: string, name: string) => void;
  onRefresh: () => void;
  onRefreshGit: () => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onDeleteEntry: (path: string) => void;
  onRenameEntry: (path: string) => void;
  onShowDiff?: (oldContent: string, newContent: string, fileName: string) => void;
}

const tabs: { id: SidebarTab; icon: typeof FolderTree; label: string }[] = [
  { id: 'explorer', icon: FolderTree, label: 'Explorer' },
  { id: 'git', icon: GitBranch, label: 'Git' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'backlinks', icon: Link2, label: 'Backlinks' },
  { id: 'tags', icon: Tag, label: 'Tags' },
];

export function MarkdownSidebar({
  vaultPath, fileTree, selectedPath, gitStatus,
  onSelectFile, onRefresh, onRefreshGit, onCreateFile, onCreateFolder,
  onDeleteEntry, onRenameEntry, onShowDiff,
}: Props) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');

  const handleNavigate = useCallback((filePath: string, fileName: string, _line?: number) => {
    onSelectFile(filePath, fileName);
  }, [onSelectFile]);

  return (
    <div className="md-sidebar">
      <div className="md-sidebar-tabs">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`md-sidebar-tab ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
            title={label}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      <div className="md-sidebar-content">
        {activeTab === 'explorer' && (
          <>
            <div className="md-sidebar-header">
              <span>Explorer</span>
              <div className="md-sidebar-actions">
                <button className="md-sidebar-action" onClick={() => onCreateFile(vaultPath)} title="New file">
                  <FilePlus size={14} />
                </button>
                <button className="md-sidebar-action" onClick={() => onCreateFolder(vaultPath)} title="New folder">
                  <FolderPlus size={14} />
                </button>
                <button className="md-sidebar-action" onClick={onRefresh} title="Refresh">
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            <div className="md-sidebar-scroll">
              <MarkdownFileTree
                entries={fileTree}
                selectedPath={selectedPath}
                gitFiles={gitStatus?.files}
                onSelectFile={onSelectFile}
                onDelete={onDeleteEntry}
                onRename={onRenameEntry}
              />
            </div>
          </>
        )}
        {activeTab === 'git' && (
          <MarkdownGitPanel
            vaultPath={vaultPath}
            gitStatus={gitStatus}
            onRefreshStatus={onRefreshGit}
            onShowDiff={onShowDiff}
          />
        )}
        {activeTab === 'search' && (
          <MarkdownSearchPanel
            vaultPath={vaultPath}
            onNavigate={(fp, fn, line) => handleNavigate(fp, fn, line)}
          />
        )}
        {activeTab === 'backlinks' && (
          <MarkdownBacklinksPanel
            vaultPath={vaultPath}
            filePath={selectedPath}
            onNavigate={(path) => {
              const name = path.split(/[/\\]/).pop() || path;
              onSelectFile(path, name);
            }}
          />
        )}
        {activeTab === 'tags' && (
          <MarkdownTagsPanel
            vaultPath={vaultPath}
            onSelectFile={(path) => {
              const name = path.split(/[/\\]/).pop() || path;
              onSelectFile(path, name);
            }}
          />
        )}
      </div>
    </div>
  );
}

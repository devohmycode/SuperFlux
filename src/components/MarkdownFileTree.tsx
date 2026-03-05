import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import type { MdFileEntry, MdGitFileStatus } from './markdownTypes';

interface Props {
  entries: MdFileEntry[];
  selectedPath: string | null;
  gitFiles?: Record<string, MdGitFileStatus>;
  onSelectFile: (path: string, name: string) => void;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onDelete?: (path: string) => void;
  onRename?: (path: string) => void;
  depth?: number;
}

const gitStatusColors: Record<string, string> = {
  Modified: '#fab387',
  Added: '#a6e3a1',
  Deleted: '#f38ba8',
  Untracked: '#a6e3a1',
  Staged: '#a6e3a1',
  StagedModified: '#f9e2af',
  Conflicted: '#f38ba8',
};

const gitStatusLetters: Record<string, string> = {
  Modified: 'M',
  Added: 'A',
  Deleted: 'D',
  Untracked: 'U',
  Staged: 'S',
  StagedModified: 'SM',
  Conflicted: 'C',
  Renamed: 'R',
  StagedDeleted: 'SD',
  StagedRenamed: 'SR',
};

export function MarkdownFileTree({ entries, selectedPath, gitFiles, onSelectFile, onDelete, onRename, depth = 0 }: Props) {
  return (
    <div className="md-file-tree">
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          selectedPath={selectedPath}
          gitFiles={gitFiles}
          onSelectFile={onSelectFile}
          onDelete={onDelete}
          onRename={onRename}
          depth={depth}
        />
      ))}
    </div>
  );
}

function FileTreeItem({ entry, selectedPath, gitFiles, onSelectFile, onDelete, onRename, depth }: Props & { entry: MdFileEntry; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const isSelected = selectedPath === entry.path;
  const gitStatus = gitFiles?.[entry.path.replace(/\\/g, '/')];
  const statusColor = gitStatus ? gitStatusColors[gitStatus] : undefined;
  const statusLetter = gitStatus ? gitStatusLetters[gitStatus] : undefined;

  const handleClick = useCallback(() => {
    if (entry.is_dir) {
      setExpanded(e => !e);
    } else {
      onSelectFile(entry.path, entry.name);
    }
  }, [entry, onSelectFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <div>
      <div
        className={`md-tree-item ${isSelected ? 'md-tree-item--selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="md-tree-icon">
          {entry.is_dir ? (
            expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : null}
        </span>
        <span className="md-tree-icon" style={{ marginRight: 4 }}>
          {entry.is_dir ? (
            expanded ? <FolderOpen size={14} /> : <Folder size={14} />
          ) : (
            <File size={14} />
          )}
        </span>
        <span className="md-tree-name" style={{ color: statusColor }}>
          {entry.name}
        </span>
        {statusLetter && (
          <span className="md-tree-badge" style={{ color: statusColor }}>
            {statusLetter}
          </span>
        )}
      </div>
      {contextMenu && (
        <>
          <div className="md-context-backdrop" onClick={() => setContextMenu(null)} />
          <div className="md-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {onRename && <div className="md-context-item" onClick={() => { setContextMenu(null); onRename(entry.path); }}>Rename</div>}
            {onDelete && <div className="md-context-item md-context-danger" onClick={() => { setContextMenu(null); onDelete(entry.path); }}>Delete</div>}
          </div>
        </>
      )}
      {entry.is_dir && expanded && entry.children && (
        <MarkdownFileTree
          entries={entry.children}
          selectedPath={selectedPath}
          gitFiles={gitFiles}
          onSelectFile={onSelectFile}
          onDelete={onDelete}
          onRename={onRename}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

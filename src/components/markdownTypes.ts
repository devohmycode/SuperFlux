// ─── Vault File System ───────────────────────────────────────────────
export interface MdFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: MdFileEntry[];
}

// ─── Wikilinks ───────────────────────────────────────────────────────
export interface MdLinkEntry {
  source_path: string;
  source_name: string;
  link_target: string;
  line_number: number;
}

export interface MdBacklinkEntry {
  source_path: string;
  source_name: string;
  line_number: number;
  context: string;
}

// ─── Search ──────────────────────────────────────────────────────────
export interface MdSearchMatch {
  file_path: string;
  file_name: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
  context_before: string;
  context_after: string;
  score: number;
}

// ─── Git ─────────────────────────────────────────────────────────────
export interface MdGitRepoInfo {
  is_repo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  has_remote: boolean;
}

export type MdGitFileStatus =
  | 'Modified'
  | 'Added'
  | 'Deleted'
  | 'Renamed'
  | 'Untracked'
  | 'Ignored'
  | 'Conflicted'
  | 'Staged'
  | 'StagedModified'
  | 'StagedDeleted'
  | 'StagedRenamed';

export interface MdGitStatusResult {
  info: MdGitRepoInfo;
  files: Record<string, MdGitFileStatus>;
}

export interface MdGitLogEntry {
  id: string;
  summary: string;
  author: string;
  time: number;
}

export interface MdDiffContent {
  old_content: string;
  new_content: string;
  file_name: string;
}

export interface MdBranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

export interface MdConflictHunk {
  ours: string;
  theirs: string;
  ours_label: string;
  theirs_label: string;
}

export interface MdConflictFileInfo {
  file_path: string;
  hunks: MdConflictHunk[];
}

// ─── Metadata / Tags ─────────────────────────────────────────────────
export interface MdFrontmatter {
  title?: string;
  tags: string[];
  aliases: string[];
  date?: string;
  extra: Record<string, unknown>;
}

export interface MdFileMetadata {
  file_path: string;
  file_name: string;
  frontmatter: MdFrontmatter | null;
  tags: string[];
}

export interface MdTagInfo {
  name: string;
  count: number;
  files: string[];
}

// ─── Editor State ────────────────────────────────────────────────────
export type MdViewMode = 'edit' | 'split' | 'preview';

export interface MdTab {
  path: string;
  name: string;
  isDirty: boolean;
}

export interface MdVaultState {
  vaultPath: string | null;
  fileTree: MdFileEntry[];
  tabs: MdTab[];
  activeTabPath: string | null;
  viewMode: MdViewMode;
  content: string;
  gitStatus: MdGitStatusResult | null;
  sidebarTab: 'explorer' | 'git' | 'search' | 'backlinks' | 'tags';
}

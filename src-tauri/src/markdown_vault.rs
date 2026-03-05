use git2::{Repository, StatusOptions, StatusShow};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ═══════════════════════════════════════════════════════════════════════
// Folder Picker
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn md_pick_folder() -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Select Vault Folder")
        .pick_folder()
        .await;
    Ok(folder.map(|h| h.path().to_string_lossy().to_string()))
}

// ═══════════════════════════════════════════════════════════════════════
// Vault File System
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

fn build_tree(dir: &Path, depth: usize) -> Vec<FileEntry> {
    if depth > 10 {
        return vec![];
    }
    let mut entries: Vec<FileEntry> = Vec::new();
    let Ok(read_dir) = fs::read_dir(dir) else {
        return entries;
    };
    let mut items: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    items.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        b_is_dir.cmp(&a_is_dir).then_with(|| {
            a.file_name()
                .to_string_lossy()
                .to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase())
        })
    });
    for item in items {
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "__pycache__"
        {
            continue;
        }
        let path = item.path();
        let is_dir = path.is_dir();
        let children = if is_dir {
            Some(build_tree(&path, depth + 1))
        } else {
            None
        };
        entries.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }
    entries
}

fn collect_md_files(dir: &Path, depth: usize) -> Vec<PathBuf> {
    if depth > 10 {
        return vec![];
    }
    let mut files = Vec::new();
    let Ok(read_dir) = fs::read_dir(dir) else {
        return files;
    };
    for entry in read_dir.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "__pycache__"
        {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            files.extend(collect_md_files(&path, depth + 1));
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            files.push(path);
        }
    }
    files
}

#[tauri::command]
pub fn md_list_vault_files(vault_path: String) -> Result<Vec<FileEntry>, String> {
    let path = PathBuf::from(&vault_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Invalid vault path: {}", vault_path));
    }
    Ok(build_tree(&path, 0))
}

#[tauri::command]
pub fn md_read_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn md_write_file(file_path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&file_path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub fn md_create_file(vault_path: String, relative_path: String) -> Result<String, String> {
    let full_path = PathBuf::from(&vault_path).join(&relative_path);
    if full_path.exists() {
        return Err("File already exists".to_string());
    }
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&full_path, "").map_err(|e| format!("Failed to create file: {}", e))?;
    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn md_create_folder(vault_path: String, relative_path: String) -> Result<String, String> {
    let full_path = PathBuf::from(&vault_path).join(&relative_path);
    fs::create_dir_all(&full_path).map_err(|e| format!("Failed to create folder: {}", e))?;
    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn md_delete_entry(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete folder: {}", e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[tauri::command]
pub fn md_rename_entry(old_path: String, new_name: String) -> Result<String, String> {
    let old = PathBuf::from(&old_path);
    let new_path = old.parent().ok_or("Invalid path")?.join(&new_name);
    fs::rename(&old, &new_path).map_err(|e| format!("Failed to rename: {}", e))?;
    Ok(new_path.to_string_lossy().to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Wikilinks
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize)]
pub struct LinkEntry {
    pub source_path: String,
    pub source_name: String,
    pub link_target: String,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BacklinkEntry {
    pub source_path: String,
    pub source_name: String,
    pub line_number: usize,
    pub context: String,
}

fn parse_wikilinks(content: &str) -> Vec<(String, usize)> {
    let re = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    let mut links = Vec::new();
    for (i, line) in content.lines().enumerate() {
        for cap in re.captures_iter(line) {
            let target = cap[1].to_string();
            let target = target.split('|').next().unwrap_or("").trim().to_string();
            if !target.is_empty() {
                links.push((target, i + 1));
            }
        }
    }
    links
}

#[tauri::command]
pub fn md_resolve_wikilink(vault_path: String, link_name: String) -> Option<String> {
    let vault = PathBuf::from(&vault_path);
    let target = link_name.to_lowercase();
    let md_files = collect_md_files(&vault, 0);
    for file in md_files {
        let stem = file
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if stem == target {
            return Some(file.to_string_lossy().to_string());
        }
    }
    None
}

#[tauri::command]
pub fn md_list_md_files(vault_path: String) -> Result<Vec<String>, String> {
    let vault = PathBuf::from(&vault_path);
    if !vault.exists() || !vault.is_dir() {
        return Err("Invalid vault path".to_string());
    }
    let md_files = collect_md_files(&vault, 0);
    let names: Vec<String> = md_files
        .iter()
        .filter_map(|f| f.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string()))
        .collect();
    Ok(names)
}

#[tauri::command]
pub fn md_scan_vault_links(vault_path: String) -> Result<Vec<LinkEntry>, String> {
    let vault = PathBuf::from(&vault_path);
    if !vault.exists() || !vault.is_dir() {
        return Err("Invalid vault path".to_string());
    }
    let md_files = collect_md_files(&vault, 0);
    let mut entries = Vec::new();
    for file in md_files {
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        let file_path = file.to_string_lossy().to_string();
        let file_name = file
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        for (target, line_number) in parse_wikilinks(&content) {
            entries.push(LinkEntry {
                source_path: file_path.clone(),
                source_name: file_name.clone(),
                link_target: target,
                line_number,
            });
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn md_get_backlinks(vault_path: String, file_path: String) -> Result<Vec<BacklinkEntry>, String> {
    let vault = PathBuf::from(&vault_path);
    if !vault.exists() || !vault.is_dir() {
        return Err("Invalid vault path".to_string());
    }
    let target_stem = PathBuf::from(&file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if target_stem.is_empty() {
        return Ok(vec![]);
    }
    let md_files = collect_md_files(&vault, 0);
    let mut backlinks = Vec::new();
    for file in md_files {
        if file.to_string_lossy() == file_path {
            continue;
        }
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        let source_path = file.to_string_lossy().to_string();
        let source_name = file
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        for (target, line_number) in parse_wikilinks(&content) {
            if target.to_lowercase() == target_stem {
                let context = content
                    .lines()
                    .nth(line_number - 1)
                    .unwrap_or("")
                    .to_string();
                backlinks.push(BacklinkEntry {
                    source_path: source_path.clone(),
                    source_name: source_name.clone(),
                    line_number,
                    context,
                });
            }
        }
    }
    Ok(backlinks)
}

// ═══════════════════════════════════════════════════════════════════════
// Search
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    pub file_path: String,
    pub file_name: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
    pub context_before: String,
    pub context_after: String,
    pub score: u32,
}

fn compute_score(line: &str, match_start: usize, match_end: usize, query: &str) -> u32 {
    let mut score: u32 = 100;
    let matched_text = &line[match_start..match_end];
    if matched_text == query {
        score += 50;
    }
    let at_word_start =
        match_start == 0 || !line.as_bytes()[match_start - 1].is_ascii_alphanumeric();
    let at_word_end =
        match_end >= line.len() || !line.as_bytes()[match_end].is_ascii_alphanumeric();
    if at_word_start && at_word_end {
        score += 30;
    } else if at_word_start || at_word_end {
        score += 15;
    }
    score
}

fn search_dir(
    dir: &Path,
    query: &str,
    case_sensitive: bool,
    results: &mut Vec<SearchMatch>,
    depth: usize,
) {
    if depth > 10 {
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "__pycache__"
        {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            search_dir(&path, query, case_sensitive, results, depth + 1);
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let text_exts = [
                "md", "txt", "rs", "ts", "js", "svelte", "html", "css", "json", "toml", "yaml",
                "yml", "xml", "py", "rb", "go", "java", "c", "cpp", "h", "sh", "bat", "ps1",
                "cfg", "ini", "env", "log",
            ];
            if !text_exts.contains(&ext) && !name.ends_with(".md") {
                continue;
            }
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            let file_path = path.to_string_lossy().to_string();
            let file_name = name;
            let lines: Vec<&str> = content.lines().collect();
            let is_md = ext == "md";
            for (i, line) in lines.iter().enumerate() {
                let (haystack, needle) = if case_sensitive {
                    (line.to_string(), query.to_string())
                } else {
                    (line.to_lowercase(), query.to_lowercase())
                };
                let mut start = 0;
                while let Some(pos) = haystack[start..].find(&needle) {
                    let abs_pos = start + pos;
                    let mut score = compute_score(line, abs_pos, abs_pos + query.len(), query);
                    if is_md {
                        score += 10;
                    }
                    let context_before = if i > 0 {
                        lines[i - 1].to_string()
                    } else {
                        String::new()
                    };
                    let context_after = if i + 1 < lines.len() {
                        lines[i + 1].to_string()
                    } else {
                        String::new()
                    };
                    results.push(SearchMatch {
                        file_path: file_path.clone(),
                        file_name: file_name.clone(),
                        line_number: i + 1,
                        line_content: line.to_string(),
                        match_start: abs_pos,
                        match_end: abs_pos + query.len(),
                        context_before,
                        context_after,
                        score,
                    });
                    start = abs_pos + 1;
                    if results.len() >= 1000 {
                        return;
                    }
                }
                if results.len() >= 1000 {
                    return;
                }
            }
        }
    }
}

#[tauri::command]
pub fn md_search_in_vault(
    vault_path: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<SearchMatch>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }
    let path = PathBuf::from(&vault_path);
    if !path.exists() || !path.is_dir() {
        return Err("Invalid vault path".to_string());
    }
    let mut results = Vec::new();
    search_dir(&path, &query, case_sensitive, &mut results, 0);
    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.file_path.cmp(&b.file_path))
            .then_with(|| a.line_number.cmp(&b.line_number))
    });
    Ok(results)
}

#[tauri::command]
pub fn md_replace_in_file(
    file_path: String,
    search: String,
    replace: String,
    case_sensitive: bool,
) -> Result<usize, String> {
    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read: {}", e))?;
    let mut new_content = String::new();
    let mut count = 0;
    if case_sensitive {
        let mut rest = content.as_str();
        while let Some(pos) = rest.find(&search) {
            new_content.push_str(&rest[..pos]);
            new_content.push_str(&replace);
            rest = &rest[pos + search.len()..];
            count += 1;
        }
        new_content.push_str(rest);
    } else {
        let lower_search = search.to_lowercase();
        let mut i = 0;
        while i < content.len() {
            let remaining = &content[i..];
            let remaining_lower = remaining.to_lowercase();
            if remaining_lower.starts_with(&lower_search) {
                new_content.push_str(&replace);
                i += search.len();
                count += 1;
            } else {
                let c = content[i..].chars().next().unwrap();
                new_content.push(c);
                i += c.len_utf8();
            }
        }
    }
    if count > 0 {
        fs::write(&file_path, &new_content).map_err(|e| format!("Failed to write: {}", e))?;
    }
    Ok(count)
}

// ═══════════════════════════════════════════════════════════════════════
// Git Integration
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize)]
pub struct GitRepoInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub has_remote: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[allow(dead_code)]
pub enum GitFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Ignored,
    Conflicted,
    Staged,
    StagedModified,
    StagedDeleted,
    StagedRenamed,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitStatusResult {
    pub info: GitRepoInfo,
    pub files: HashMap<String, GitFileStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitLogEntry {
    pub id: String,
    pub summary: String,
    pub author: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffContent {
    pub old_content: String,
    pub new_content: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictHunk {
    pub ours: String,
    pub theirs: String,
    pub ours_label: String,
    pub theirs_label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConflictFileInfo {
    pub file_path: String,
    pub hunks: Vec<ConflictHunk>,
}

fn open_repo(vault_path: &str) -> Result<Repository, String> {
    Repository::discover(vault_path).map_err(|e| format!("Not a git repository: {}", e))
}

#[tauri::command]
pub fn md_git_repo_info(vault_path: String) -> Result<GitRepoInfo, String> {
    let repo = match Repository::discover(&vault_path) {
        Ok(r) => r,
        Err(_) => {
            return Ok(GitRepoInfo {
                is_repo: false,
                branch: None,
                ahead: 0,
                behind: 0,
                has_remote: false,
            });
        }
    };
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));
    let has_remote = repo.find_remote("origin").is_ok();
    let (ahead, behind) = if let (Ok(head), true) = (repo.head(), has_remote) {
        if let Some(local_oid) = head.target() {
            let upstream = head
                .resolve()
                .ok()
                .and_then(|r| {
                    let branch_name = r.shorthand()?;
                    repo.find_branch(branch_name, git2::BranchType::Local).ok()
                })
                .and_then(|b| b.upstream().ok())
                .and_then(|u| u.get().target());
            if let Some(remote_oid) = upstream {
                repo.graph_ahead_behind(local_oid, remote_oid)
                    .unwrap_or((0, 0))
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        }
    } else {
        (0, 0)
    };
    Ok(GitRepoInfo {
        is_repo: true,
        branch,
        ahead: ahead as u32,
        behind: behind as u32,
        has_remote,
    })
}

#[tauri::command]
pub fn md_git_status(vault_path: String) -> Result<GitStatusResult, String> {
    let info = md_git_repo_info(vault_path.clone())?;
    if !info.is_repo {
        return Ok(GitStatusResult {
            info,
            files: HashMap::new(),
        });
    }
    let repo = open_repo(&vault_path)?;
    let workdir = repo
        .workdir()
        .ok_or("Bare repository")?
        .to_string_lossy()
        .to_string();
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show(StatusShow::IndexAndWorkdir);
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;
    let mut files: HashMap<String, GitFileStatus> = HashMap::new();
    for entry in statuses.iter() {
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };
        let s = entry.status();
        let full_path = format!(
            "{}{}",
            workdir.trim_end_matches(['/', '\\']),
            if path.starts_with('/') || path.starts_with('\\') {
                path.clone()
            } else {
                format!("/{}", path)
            }
        );
        let normalized = full_path.replace('\\', "/");
        let status = if s.is_conflicted() {
            GitFileStatus::Conflicted
        } else if s.is_index_new() {
            GitFileStatus::Staged
        } else if s.is_index_modified() && s.is_wt_modified() {
            GitFileStatus::StagedModified
        } else if s.is_index_modified() {
            GitFileStatus::Staged
        } else if s.is_index_deleted() {
            GitFileStatus::StagedDeleted
        } else if s.is_index_renamed() {
            GitFileStatus::StagedRenamed
        } else if s.is_wt_modified() {
            GitFileStatus::Modified
        } else if s.is_wt_new() {
            GitFileStatus::Untracked
        } else if s.is_wt_deleted() {
            GitFileStatus::Deleted
        } else if s.is_wt_renamed() {
            GitFileStatus::Renamed
        } else if s.is_ignored() {
            GitFileStatus::Ignored
        } else {
            continue;
        };
        files.insert(normalized, status);
    }
    Ok(GitStatusResult { info, files })
}

#[tauri::command]
pub fn md_git_init(vault_path: String) -> Result<GitRepoInfo, String> {
    Repository::init(&vault_path).map_err(|e| format!("Failed to init repo: {}", e))?;
    md_git_repo_info(vault_path)
}

#[tauri::command]
pub fn md_git_stage(vault_path: String, file_paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&vault_path)?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    for fp in &file_paths {
        let abs_path = Path::new(fp);
        let rel_path = abs_path
            .strip_prefix(workdir)
            .map_err(|_| format!("File not in repo: {}", fp))?;
        if abs_path.exists() {
            index
                .add_path(rel_path)
                .map_err(|e| format!("Failed to stage {}: {}", fp, e))?;
        } else {
            index
                .remove_path(rel_path)
                .map_err(|e| format!("Failed to stage deletion {}: {}", fp, e))?;
        }
    }
    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn md_git_unstage(vault_path: String, file_paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&vault_path)?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    for fp in &file_paths {
        let abs_path = Path::new(fp);
        let rel_path = abs_path
            .strip_prefix(workdir)
            .map_err(|_| format!("File not in repo: {}", fp))?;
        if let Some(ref tree) = head_commit {
            if let Ok(entry) = tree.get_path(rel_path) {
                let _ = index.add(&git2::IndexEntry {
                    ctime: git2::IndexTime::new(0, 0),
                    mtime: git2::IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: entry.filemode() as u32,
                    uid: 0,
                    gid: 0,
                    file_size: 0,
                    id: entry.id(),
                    flags: 0,
                    flags_extended: 0,
                    path: rel_path.to_string_lossy().as_bytes().to_vec(),
                });
            } else {
                let _ = index.remove_path(rel_path);
            }
        } else {
            let _ = index.remove_path(rel_path);
        }
    }
    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn md_git_commit(vault_path: String, message: String) -> Result<String, String> {
    let repo = open_repo(&vault_path)?;
    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;
    let sig = repo
        .signature()
        .map_err(|e| format!("Failed to get signature (set user.name and user.email): {}", e))?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| format!("Failed to commit: {}", e))?;
    Ok(oid.to_string())
}

#[tauri::command]
pub fn md_git_log(vault_path: String, max_count: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let repo = open_repo(&vault_path)?;
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| format!("Failed to create revwalk: {}", e))?;
    revwalk
        .push_head()
        .map_err(|e| format!("Failed to push HEAD: {}", e))?;
    let limit = max_count.unwrap_or(50) as usize;
    let mut entries = Vec::new();
    for (i, oid) in revwalk.enumerate() {
        if i >= limit {
            break;
        }
        let oid = oid.map_err(|e| format!("Revwalk error: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Failed to find commit: {}", e))?;
        entries.push(GitLogEntry {
            id: oid.to_string()[..7].to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            time: commit.time().seconds(),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn md_git_diff(vault_path: String, file_path: String) -> Result<String, String> {
    let repo = open_repo(&vault_path)?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let abs_path = Path::new(&file_path);
    let rel_path = abs_path
        .strip_prefix(workdir)
        .map_err(|_| "File not in repo".to_string())?;
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(rel_path.to_string_lossy().as_ref());
    let diff = repo
        .diff_index_to_workdir(None, Some(&mut opts))
        .map_err(|e| format!("Failed to get diff: {}", e))?;
    let mut output = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let prefix = match line.origin() {
            '+' => "+",
            '-' => "-",
            ' ' => " ",
            _ => "",
        };
        output.push_str(prefix);
        output.push_str(&String::from_utf8_lossy(line.content()));
        true
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;
    Ok(output)
}

#[tauri::command]
pub fn md_git_diff_contents(vault_path: String, file_path: String) -> Result<DiffContent, String> {
    let repo = open_repo(&vault_path)?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let abs_path =
        std::fs::canonicalize(&file_path).unwrap_or_else(|_| PathBuf::from(&file_path));
    let workdir_canon =
        std::fs::canonicalize(workdir).unwrap_or_else(|_| workdir.to_path_buf());
    let rel_path = abs_path
        .strip_prefix(&workdir_canon)
        .map_err(|_| "File not in repo".to_string())?;
    let file_name = rel_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let git_rel_path = rel_path.to_string_lossy().replace('\\', "/");
    let git_path = Path::new(&git_rel_path);
    let old_content = if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            if let Ok(entry) = tree.get_path(git_path) {
                if let Ok(blob) = repo.find_blob(entry.id()) {
                    String::from_utf8_lossy(blob.content()).to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    let new_content = if abs_path.exists() {
        std::fs::read_to_string(abs_path).unwrap_or_default()
    } else {
        String::new()
    };
    Ok(DiffContent {
        old_content,
        new_content,
        file_name,
    })
}

#[tauri::command]
pub fn md_git_discard_changes(vault_path: String, file_path: String) -> Result<(), String> {
    let repo = open_repo(&vault_path)?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let abs_path =
        std::fs::canonicalize(&file_path).unwrap_or_else(|_| PathBuf::from(&file_path));
    let workdir_canon =
        std::fs::canonicalize(workdir).unwrap_or_else(|_| workdir.to_path_buf());
    let rel_path = abs_path
        .strip_prefix(&workdir_canon)
        .map_err(|_| "File not in repo".to_string())?;
    let git_rel = rel_path.to_string_lossy().replace('\\', "/");
    let in_head = if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            tree.get_path(Path::new(&git_rel)).is_ok()
        } else {
            false
        }
    } else {
        false
    };
    if !in_head {
        if abs_path.exists() {
            std::fs::remove_file(&abs_path)
                .map_err(|e| format!("Failed to delete file: {}", e))?;
        }
        return Ok(());
    }
    repo.checkout_head(Some(
        git2::build::CheckoutBuilder::default()
            .force()
            .path(&git_rel),
    ))
    .map_err(|e| format!("Failed to discard changes: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn md_git_list_branches(vault_path: String) -> Result<Vec<BranchInfo>, String> {
    let repo = open_repo(&vault_path)?;
    let mut branches = Vec::new();
    let current_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));
    for branch in repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| format!("Failed to list branches: {}", e))?
    {
        let (branch, _) = branch.map_err(|e| format!("Branch error: {}", e))?;
        if let Ok(Some(name)) = branch.name() {
            branches.push(BranchInfo {
                name: name.to_string(),
                is_current: current_branch.as_deref() == Some(name),
                is_remote: false,
            });
        }
    }
    Ok(branches)
}

#[tauri::command]
pub fn md_git_checkout_branch(vault_path: String, branch_name: String) -> Result<(), String> {
    let repo = open_repo(&vault_path)?;
    let (object, reference) = repo
        .revparse_ext(&branch_name)
        .map_err(|e| format!("Branch not found: {}", e))?;
    repo.checkout_tree(&object, None)
        .map_err(|e| format!("Failed to checkout: {}", e))?;
    if let Some(reference) = reference {
        repo.set_head(
            reference
                .name()
                .unwrap_or(&format!("refs/heads/{}", branch_name)),
        )
        .map_err(|e| format!("Failed to set HEAD: {}", e))?;
    } else {
        repo.set_head(&format!("refs/heads/{}", branch_name))
            .map_err(|e| format!("Failed to set HEAD: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn md_git_create_branch(vault_path: String, branch_name: String) -> Result<(), String> {
    let repo = open_repo(&vault_path)?;
    let head = repo.head().map_err(|e| format!("No HEAD: {}", e))?;
    let commit = head
        .peel_to_commit()
        .map_err(|e| format!("Failed to get commit: {}", e))?;
    repo.branch(&branch_name, &commit, false)
        .map_err(|e| format!("Failed to create branch: {}", e))?;
    Ok(())
}

fn git_credentials_callback(
    repo: &Repository,
) -> impl FnMut(&str, Option<&str>, git2::CredentialType) -> Result<git2::Cred, git2::Error> + '_
{
    move |_url, username_from_url, allowed_types| {
        if allowed_types.contains(git2::CredentialType::SSH_KEY) {
            git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
        } else if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            git2::Cred::credential_helper(&repo.config().unwrap(), _url, username_from_url)
        } else if allowed_types.contains(git2::CredentialType::DEFAULT) {
            git2::Cred::default()
        } else {
            Err(git2::Error::from_str("No suitable credential method"))
        }
    }
}

#[tauri::command]
pub fn md_git_push(vault_path: String) -> Result<String, String> {
    let repo = open_repo(&vault_path)?;
    let head = repo.head().map_err(|e| format!("No HEAD: {}", e))?;
    let branch_name = head
        .shorthand()
        .ok_or("Cannot determine branch name")?
        .to_string();
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("No remote 'origin': {}", e))?;
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(git_credentials_callback(&repo));
    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);
    remote
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| format!("Push failed: {}", e))?;
    Ok(format!("Pushed to origin/{}", branch_name))
}

#[tauri::command]
pub fn md_git_pull(vault_path: String) -> Result<String, String> {
    let repo = open_repo(&vault_path)?;
    let head = repo.head().map_err(|e| format!("No HEAD: {}", e))?;
    let branch_name = head
        .shorthand()
        .ok_or("Cannot determine branch name")?
        .to_string();
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("No remote 'origin': {}", e))?;
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(git_credentials_callback(&repo));
    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);
    remote
        .fetch(&[&branch_name], Some(&mut fetch_opts), None)
        .map_err(|e| format!("Fetch failed: {}", e))?;
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| format!("No FETCH_HEAD: {}", e))?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| format!("Failed to get fetch commit: {}", e))?;
    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| format!("Merge analysis failed: {}", e))?;
    if analysis.is_up_to_date() {
        return Ok("Already up to date".to_string());
    }
    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{}", branch_name);
        let mut reference = repo
            .find_reference(&refname)
            .map_err(|e| format!("Failed to find ref: {}", e))?;
        reference
            .set_target(fetch_commit.id(), "fast-forward pull")
            .map_err(|e| format!("Failed to fast-forward: {}", e))?;
        repo.set_head(&refname)
            .map_err(|e| format!("Failed to set HEAD: {}", e))?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| format!("Failed to checkout: {}", e))?;
        return Ok("Fast-forwarded".to_string());
    }
    Err("Cannot fast-forward. Please commit or stash your changes first.".to_string())
}

#[tauri::command]
pub fn md_git_parse_conflicts(file_path: String) -> Result<ConflictFileInfo, String> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let mut hunks = Vec::new();
    let mut in_conflict = false;
    let mut in_ours = true;
    let mut ours_label = String::new();
    let mut theirs_label;
    let mut ours_lines: Vec<String> = Vec::new();
    let mut theirs_lines: Vec<String> = Vec::new();
    for line in content.lines() {
        if line.starts_with("<<<<<<<") {
            in_conflict = true;
            in_ours = true;
            ours_label = line.trim_start_matches('<').trim().to_string();
            ours_lines.clear();
            theirs_lines.clear();
        } else if line.starts_with("=======") && in_conflict {
            in_ours = false;
        } else if line.starts_with(">>>>>>>") && in_conflict {
            theirs_label = line.trim_start_matches('>').trim().to_string();
            hunks.push(ConflictHunk {
                ours: ours_lines.join("\n"),
                theirs: theirs_lines.join("\n"),
                ours_label: ours_label.clone(),
                theirs_label: theirs_label.clone(),
            });
            in_conflict = false;
        } else if in_conflict {
            if in_ours {
                ours_lines.push(line.to_string());
            } else {
                theirs_lines.push(line.to_string());
            }
        }
    }
    Ok(ConflictFileInfo { file_path, hunks })
}

#[tauri::command]
pub fn md_git_resolve_conflict(
    vault_path: String,
    file_path: String,
    resolved_content: String,
    auto_stage: bool,
) -> Result<(), String> {
    std::fs::write(&file_path, &resolved_content)
        .map_err(|e| format!("Failed to write resolved file: {}", e))?;
    if auto_stage {
        md_git_stage(vault_path, vec![file_path])?;
    }
    Ok(())
}

#[tauri::command]
pub fn md_git_sync(vault_path: String) -> Result<String, String> {
    let repo = open_repo(&vault_path)?;
    if repo.find_remote("origin").is_err() {
        return Err("No remote 'origin' configured".to_string());
    }
    let pull_result = md_git_pull(vault_path.clone());
    match pull_result {
        Ok(pull_msg) => {
            let info = md_git_repo_info(vault_path.clone())?;
            if info.ahead > 0 {
                match md_git_push(vault_path) {
                    Ok(push_msg) => Ok(format!("{}, {}", pull_msg, push_msg)),
                    Err(e) => Ok(format!("{} (push failed: {})", pull_msg, e)),
                }
            } else {
                Ok(pull_msg)
            }
        }
        Err(e) => Err(format!("Sync failed: {}", e)),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Metadata & Tags
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Frontmatter {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default, flatten)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub frontmatter: Option<Frontmatter>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub name: String,
    pub count: usize,
    pub files: Vec<String>,
}

fn extract_frontmatter(content: &str) -> Option<String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    let after_first = &trimmed[3..];
    if let Some(end) = after_first.find("\n---") {
        Some(after_first[..end].to_string())
    } else {
        None
    }
}

fn extract_inline_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let body = if content.trim_start().starts_with("---") {
        let after = &content.trim_start()[3..];
        if let Some(end) = after.find("\n---") {
            &after[end + 4..]
        } else {
            content
        }
    } else {
        content
    };
    let re = Regex::new(r"(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)").unwrap();
    for cap in re.captures_iter(body) {
        let tag = cap[1].to_string();
        if !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    tags
}

#[tauri::command]
pub fn md_parse_file_metadata(file_path: String) -> Result<FileMetadata, String> {
    let path = PathBuf::from(&file_path);
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let frontmatter = extract_frontmatter(&content)
        .and_then(|yaml_str| serde_yaml::from_str::<Frontmatter>(&yaml_str).ok());
    let mut tags: Vec<String> = frontmatter
        .as_ref()
        .map(|fm| fm.tags.clone())
        .unwrap_or_default();
    let inline_tags = extract_inline_tags(&content);
    for tag in inline_tags {
        if !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    Ok(FileMetadata {
        file_path,
        file_name,
        frontmatter,
        tags,
    })
}

#[tauri::command]
pub fn md_scan_vault_metadata(vault_path: String) -> Result<Vec<FileMetadata>, String> {
    let vault = PathBuf::from(&vault_path);
    if !vault.exists() || !vault.is_dir() {
        return Err("Invalid vault path".to_string());
    }
    let md_files = collect_md_files(&vault, 0);
    let mut result = Vec::new();
    for file in md_files {
        let file_path = file.to_string_lossy().to_string();
        if let Ok(meta) = md_parse_file_metadata(file_path) {
            result.push(meta);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn md_get_vault_tags(vault_path: String) -> Result<Vec<TagInfo>, String> {
    let metadata = md_scan_vault_metadata(vault_path)?;
    let mut tag_map: HashMap<String, Vec<String>> = HashMap::new();
    for meta in metadata {
        for tag in &meta.tags {
            tag_map
                .entry(tag.clone())
                .or_default()
                .push(meta.file_path.clone());
        }
    }
    let mut tags: Vec<TagInfo> = tag_map
        .into_iter()
        .map(|(name, files)| TagInfo {
            count: files.len(),
            name,
            files,
        })
        .collect();
    tags.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    Ok(tags)
}

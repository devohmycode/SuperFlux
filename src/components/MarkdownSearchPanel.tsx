import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, Replace, CaseSensitive, X } from 'lucide-react';
import type { MdSearchMatch } from './markdownTypes';

interface Props {
  vaultPath: string;
  onNavigate: (filePath: string, fileName: string, line: number) => void;
}

export function MarkdownSearchPanel({ vaultPath, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [results, setResults] = useState<MdSearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !vaultPath) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await invoke<MdSearchMatch[]>('md_search_in_vault', {
        vaultPath, query: q, caseSensitive,
      });
      setResults(res);
      setSelectedIndex(-1);
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setSearching(false);
    }
  }, [vaultPath, caseSensitive]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }, [doSearch]);

  const handleReplace = useCallback(async (match: MdSearchMatch) => {
    if (!replaceText && replaceText !== '') return;
    try {
      await invoke<number>('md_replace_in_file', {
        filePath: match.file_path, search: query, replace: replaceText, caseSensitive,
      });
      doSearch(query);
    } catch (e) {
      console.error('Replace failed:', e);
    }
  }, [query, replaceText, caseSensitive, doSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      const match = results[selectedIndex];
      if (match) onNavigate(match.file_path, match.file_name, match.line_number);
    }
  }, [results, selectedIndex, onNavigate]);

  // Group results by file
  const grouped = results.reduce<Record<string, MdSearchMatch[]>>((acc, m) => {
    (acc[m.file_path] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="md-search-panel" onKeyDown={handleKeyDown}>
      <div className="md-search-inputs">
        <div className="md-search-row">
          <Search size={14} className="md-search-icon" />
          <input
            ref={inputRef}
            className="md-search-input"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search in vault..."
          />
          <button
            className={`md-search-btn ${caseSensitive ? 'active' : ''}`}
            onClick={() => { setCaseSensitive(c => !c); doSearch(query); }}
            title="Case sensitive"
          >
            <CaseSensitive size={14} />
          </button>
          <button
            className={`md-search-btn ${showReplace ? 'active' : ''}`}
            onClick={() => setShowReplace(r => !r)}
            title="Replace"
          >
            <Replace size={14} />
          </button>
        </div>
        {showReplace && (
          <div className="md-search-row">
            <Replace size={14} className="md-search-icon" />
            <input
              className="md-search-input"
              value={replaceText}
              onChange={e => setReplaceText(e.target.value)}
              placeholder="Replace with..."
            />
          </div>
        )}
      </div>
      <div className="md-search-count">
        {searching ? 'Searching...' : `${results.length} result${results.length !== 1 ? 's' : ''}`}
      </div>
      <div className="md-search-results">
        {Object.entries(grouped).map(([filePath, matches]) => (
          <div key={filePath} className="md-search-file-group">
            <div className="md-search-file-name">{matches[0].file_name}</div>
            {matches.map((match, i) => {
              const globalIdx = results.indexOf(match);
              return (
                <div
                  key={i}
                  className={`md-search-result ${globalIdx === selectedIndex ? 'selected' : ''}`}
                  onClick={() => onNavigate(match.file_path, match.file_name, match.line_number)}
                >
                  <span className="md-search-line-num">{match.line_number}</span>
                  <span className="md-search-line-content">
                    {match.line_content.slice(0, match.match_start)}
                    <mark>{match.line_content.slice(match.match_start, match.match_end)}</mark>
                    {match.line_content.slice(match.match_end)}
                  </span>
                  {showReplace && (
                    <button className="md-search-replace-btn" onClick={(e) => { e.stopPropagation(); handleReplace(match); }}>
                      <Replace size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

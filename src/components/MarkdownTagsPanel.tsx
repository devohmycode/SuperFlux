import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Tag, ChevronRight, ChevronDown, Search, FileText } from 'lucide-react';
import type { MdTagInfo } from './markdownTypes';

interface Props {
  vaultPath: string;
  onSelectFile: (path: string) => void;
}

export function MarkdownTagsPanel({ vaultPath, onSelectFile }: Props) {
  const [tags, setTags] = useState<MdTagInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    invoke<MdTagInfo[]>('md_get_vault_tags', { vaultPath })
      .then(setTags)
      .catch(() => setTags([]))
      .finally(() => setLoading(false));
  }, [vaultPath]);

  const filtered = useMemo(() => {
    if (!filter) return tags;
    const q = filter.toLowerCase();
    return tags.filter(t => t.name.toLowerCase().includes(q));
  }, [tags, filter]);

  const toggleTag = (name: string) => {
    setExpandedTags(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div style={{ fontFamily: 'var(--font-body)', fontSize: 12 }}>
      <div
        style={{
          padding: '6px 8px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--bg-hover)',
            borderRadius: 6,
            padding: '4px 8px',
          }}
        >
          <Search size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Filter tags..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 12,
              width: '100%',
              fontFamily: 'var(--font-body)',
            }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 12, color: 'var(--text-tertiary)' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 12, color: 'var(--text-tertiary)' }}>No tags found</div>
      ) : (
        <div>
          {filtered.map((tag) => {
            const isExpanded = expandedTags.has(tag.name);
            return (
              <div key={tag.name}>
                <div
                  onClick={() => toggleTag(tag.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 10px',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Tag size={12} style={{ color: 'var(--accent)' }} />
                  <span style={{ flex: 1 }}>{tag.name}</span>
                  <span
                    style={{
                      background: 'var(--bg-hover)',
                      borderRadius: 8,
                      padding: '1px 6px',
                      fontSize: 10,
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {tag.count}
                  </span>
                </div>
                {isExpanded && (
                  <div>
                    {tag.files.map((file) => {
                      const fileName = file.split(/[\\/]/).pop() || file;
                      return (
                        <div
                          key={file}
                          onClick={() => onSelectFile(file)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '4px 10px 4px 32px',
                            cursor: 'pointer',
                            color: 'var(--text-secondary)',
                            fontSize: 11,
                            transition: 'background 0.12s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <FileText size={11} />
                          <span>{fileName}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

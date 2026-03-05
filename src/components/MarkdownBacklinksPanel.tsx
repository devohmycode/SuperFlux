import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, FileText } from 'lucide-react';
import type { MdBacklinkEntry } from './markdownTypes';

interface Props {
  vaultPath: string;
  filePath: string | null;
  onNavigate: (path: string) => void;
}

export function MarkdownBacklinksPanel({ vaultPath, filePath, onNavigate }: Props) {
  const [backlinks, setBacklinks] = useState<MdBacklinkEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setBacklinks([]);
      return;
    }
    setLoading(true);
    invoke<MdBacklinkEntry[]>('md_get_backlinks', { vaultPath, filePath })
      .then(setBacklinks)
      .catch(() => setBacklinks([]))
      .finally(() => setLoading(false));
  }, [vaultPath, filePath]);

  if (!filePath) {
    return (
      <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
        No file selected
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'var(--font-body)', fontSize: 12 }}>
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
          fontWeight: 600,
        }}
      >
        <Link size={13} />
        <span>Backlinks</span>
        <span
          style={{
            marginLeft: 'auto',
            background: 'var(--bg-hover)',
            borderRadius: 8,
            padding: '1px 6px',
            fontSize: 10,
            color: 'var(--text-tertiary)',
          }}
        >
          {backlinks.length}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 12, color: 'var(--text-tertiary)' }}>Loading...</div>
      ) : backlinks.length === 0 ? (
        <div style={{ padding: 12, color: 'var(--text-tertiary)' }}>No backlinks found</div>
      ) : (
        <div>
          {backlinks.map((bl, i) => (
            <div
              key={`${bl.source_path}-${bl.line_number}-${i}`}
              onClick={() => onNavigate(bl.source_path)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-subtle)',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  marginBottom: 2,
                }}
              >
                <FileText size={12} style={{ color: 'var(--accent)' }} />
                <span>{bl.source_name}</span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 10, marginLeft: 'auto' }}>
                  line {bl.line_number}
                </span>
              </div>
              <div
                style={{
                  color: 'var(--text-tertiary)',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {bl.context}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

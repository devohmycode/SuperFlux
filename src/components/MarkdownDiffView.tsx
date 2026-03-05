import { useMemo } from 'react';
import { X } from 'lucide-react';

interface Props {
  oldContent: string;
  newContent: string;
  fileName: string;
  onClose: () => void;
}

interface DiffLine {
  type: 'same' | 'removed' | 'added';
  text: string;
  oldNum?: number;
  newNum?: number;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const seq: Array<[number, number]> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      seq.unshift([i - 1, j - 1]);
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  let oi = 0, ni = 0, oldNum = 1, newNum = 1;
  for (const [si, sj] of seq) {
    while (oi < si) {
      result.push({ type: 'removed', text: oldLines[oi], oldNum: oldNum++ });
      oi++;
    }
    while (ni < sj) {
      result.push({ type: 'added', text: newLines[ni], newNum: newNum++ });
      ni++;
    }
    result.push({ type: 'same', text: oldLines[oi], oldNum: oldNum++, newNum: newNum++ });
    oi++; ni++;
  }
  while (oi < m) {
    result.push({ type: 'removed', text: oldLines[oi], oldNum: oldNum++ });
    oi++;
  }
  while (ni < n) {
    result.push({ type: 'added', text: newLines[ni], newNum: newNum++ });
    ni++;
  }

  return result;
}

const lineStyles: Record<DiffLine['type'], React.CSSProperties> = {
  removed: {
    background: 'rgba(217, 69, 58, 0.15)',
    color: 'var(--red, #d9453a)',
  },
  added: {
    background: 'rgba(45, 158, 90, 0.15)',
    color: 'var(--green, #2d9e5a)',
  },
  same: {
    color: 'var(--text-secondary)',
  },
};

const prefixMap: Record<DiffLine['type'], string> = {
  removed: '-',
  added: '+',
  same: ' ',
};

export function MarkdownDiffView({ oldContent, newContent, fileName, onClose }: Props) {
  const diffLines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'var(--font-body)',
        background: 'var(--bg-root)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        <span>Diff: {fileName}</span>
        <button
          onClick={onClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-tertiary)',
            padding: 4,
            borderRadius: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Diff body */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: 12,
          lineHeight: '20px',
        }}
      >
        {diffLines.map((line, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              ...lineStyles[line.type],
              minHeight: 20,
            }}
          >
            <span
              style={{
                width: 40,
                textAlign: 'right',
                paddingRight: 8,
                color: 'var(--text-tertiary)',
                opacity: 0.6,
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              {line.oldNum ?? ''}
            </span>
            <span
              style={{
                width: 40,
                textAlign: 'right',
                paddingRight: 8,
                color: 'var(--text-tertiary)',
                opacity: 0.6,
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              {line.newNum ?? ''}
            </span>
            <span
              style={{
                width: 16,
                textAlign: 'center',
                fontWeight: 700,
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              {prefixMap[line.type]}
            </span>
            <span style={{ paddingRight: 12, whiteSpace: 'pre' }}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

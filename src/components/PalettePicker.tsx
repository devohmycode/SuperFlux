import { useState, useEffect, useRef, useCallback } from 'react';
import { palettes, applyPalette, getStoredPaletteId, type Palette } from '../themes/palettes';

interface PalettePickerProps {
  onClose?: () => void;
}

export function PalettePicker({ onClose }: PalettePickerProps) {
  const [currentId, setCurrentId] = useState(getStoredPaletteId);
  const ref = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback((palette: Palette) => {
    applyPalette(palette.id);
    setCurrentId(palette.id);
    onClose?.();
  }, [onClose]);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose?.();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div className="palette-picker" ref={ref}>
      <div className="palette-picker-title">Palette</div>
      <div className="palette-picker-list">
        {palettes.map(p => {
          const isDark = document.documentElement.classList.contains('dark') || document.documentElement.classList.contains('amoled');
          const colors = isDark ? p.dark : p.light;
          return (
            <button
              key={p.id}
              className={`palette-picker-item ${currentId === p.id ? 'active' : ''}`}
              onClick={() => handleSelect(p)}
            >
              <span className="palette-picker-dots">
                <span className="palette-dot" style={{ background: colors.accent }} />
                <span className="palette-dot" style={{ background: colors.secondary }} />
                <span className="palette-dot" style={{ background: colors.tertiary }} />
              </span>
              <span className="palette-picker-name">{p.name}</span>
              {currentId === p.id && <span className="palette-picker-check">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Inline version for SettingsModal */
export function PalettePickerInline() {
  const [currentId, setCurrentId] = useState(getStoredPaletteId);

  const handleSelect = useCallback((palette: Palette) => {
    applyPalette(palette.id);
    setCurrentId(palette.id);
  }, []);

  return (
    <div className="palette-picker-inline">
      {palettes.map(p => {
        const isDark = document.documentElement.classList.contains('dark') || document.documentElement.classList.contains('amoled');
        const colors = isDark ? p.dark : p.light;
        return (
          <button
            key={p.id}
            className={`palette-picker-item ${currentId === p.id ? 'active' : ''}`}
            onClick={() => handleSelect(p)}
            title={p.name}
          >
            <span className="palette-picker-dots">
              <span className="palette-dot" style={{ background: colors.accent }} />
              <span className="palette-dot" style={{ background: colors.secondary }} />
              <span className="palette-dot" style={{ background: colors.tertiary }} />
            </span>
            <span className="palette-picker-name">{p.name}</span>
            {currentId === p.id && <span className="palette-picker-check">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

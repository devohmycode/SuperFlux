import { useCallback } from 'react';
import { X, FileText, Columns2, Eye } from 'lucide-react';
import type { MdTab, MdViewMode } from './markdownTypes';

interface Props {
  tabs: MdTab[];
  activeIndex: number;
  onSwitch: (index: number) => void;
  onClose: (index: number) => void;
  viewMode?: MdViewMode;
  onViewModeChange?: (mode: MdViewMode) => void;
}

export function MarkdownTabBar({ tabs, activeIndex, onSwitch, onClose, viewMode = 'edit', onViewModeChange }: Props) {
  const handleClose = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    onClose(index);
  }, [onClose]);

  return (
    <div className="md-tab-bar">
      <div className="md-tab-bar-tabs">
        {tabs.map((tab, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={tab.path}
              className={`md-tab ${isActive ? 'md-tab--active' : ''}`}
              onClick={() => onSwitch(i)}
            >
              <span>{tab.name}</span>
              {tab.isDirty && <span className="md-tab-dirty" />}
              <button className="md-tab-close" onClick={(e) => handleClose(e, i)}>
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {onViewModeChange && (
        <div className="md-view-toggle">
          <button
            className={`md-view-btn ${viewMode === 'edit' ? 'active' : ''}`}
            onClick={() => onViewModeChange('edit')}
            title="Editor only"
          >
            <FileText size={14} />
          </button>
          <button
            className={`md-view-btn ${viewMode === 'split' ? 'active' : ''}`}
            onClick={() => onViewModeChange('split')}
            title="Split view"
          >
            <Columns2 size={14} />
          </button>
          <button
            className={`md-view-btn ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => onViewModeChange('preview')}
            title="Preview only"
          >
            <Eye size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type Phase = 'hidden' | 'mounting' | 'expanding' | 'content-in' | 'content-out' | 'closing';

interface ExpandingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  corner?: Corner;
}

function getCornerPercent(corner: Corner) {
  const x = corner.includes('right') ? '100%' : '0%';
  const y = corner.includes('bottom') ? '100%' : '0%';
  return { x, y };
}

export function ExpandingPanel({
  isOpen,
  onClose,
  children,
  title,
  corner = 'top-left',
}: ExpandingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('hidden');

  const { x, y } = getCornerPercent(corner);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      setPhase('mounting');
      document.addEventListener('keydown', handleKeyDown);

      const t1 = setTimeout(() => setPhase('expanding'), 30);
      const t2 = setTimeout(() => setPhase('content-in'), 900);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      if (phase === 'hidden') return;

      setPhase('content-out');

      const t1 = setTimeout(() => setPhase('closing'), 350);
      const t2 = setTimeout(() => {
        setPhase('hidden');
        document.body.style.overflow = '';
      }, 1350);

      document.removeEventListener('keydown', handleKeyDown);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, handleKeyDown]);

  useEffect(() => {
    if (phase === 'content-in' && panelRef.current) {
      const focusable = panelRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }
  }, [phase]);

  if (phase === 'hidden') return null;

  const isExpanded = phase === 'expanding' || phase === 'content-in';
  const isContentVisible = phase === 'content-in';
  const isCollapsing = phase === 'closing';
  const isContentFadingOut = phase === 'content-out';

  const clipRadius = isExpanded || isContentFadingOut ? '200%' : '0%';
  const clipPath = `circle(${clipRadius} at ${x} ${y})`;

  const clipTransition = isCollapsing
    ? 'clip-path 800ms cubic-bezier(0.55, 0, 1, 0.45)'
    : 'clip-path 1200ms cubic-bezier(0.22, 1, 0.36, 1)';

  return (
    <>
      {/* Overlay */}
      <div
        className="expanding-panel-overlay"
        style={{
          opacity: isExpanded || isContentFadingOut ? 1 : 0,
          transition: isExpanded || isContentFadingOut
            ? 'opacity 700ms ease'
            : 'opacity 500ms ease',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Panneau'}
        className="expanding-panel"
        style={{ clipPath, transition: clipTransition }}
      >
        {/* Header */}
        <header
          className="expanding-panel-header"
          style={{
            transform: isContentVisible
              ? 'translateY(0)'
              : isContentFadingOut
                ? 'translateY(0)'
                : 'translateY(-16px)',
            opacity: isContentVisible ? 1 : isContentFadingOut ? 0 : 0,
            transition: isContentVisible
              ? 'transform 700ms ease-out, opacity 700ms ease-out'
              : 'transform 300ms ease-in, opacity 300ms ease-in',
          }}
        >
          {title && <h2 className="expanding-panel-title">{title}</h2>}
          <button
            className="expanding-panel-close"
            onClick={onClose}
            aria-label="Fermer le panneau"
          >
            ✕
          </button>
        </header>

        {/* Content */}
        <div className="expanding-panel-body">
          <div
            style={{
              transform: isContentVisible
                ? 'translateY(0)'
                : isContentFadingOut
                  ? 'translateY(0)'
                  : 'translateY(32px)',
              opacity: isContentVisible ? 1 : 0,
              transition: isContentVisible
                ? 'transform 1000ms ease-out, opacity 1000ms ease-out'
                : 'transform 300ms ease-in, opacity 300ms ease-in',
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

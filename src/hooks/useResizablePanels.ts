import { useState, useCallback, useRef, useEffect } from 'react';

interface PanelConfig {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
}

interface UseResizablePanelsOptions {
  panels: [PanelConfig, PanelConfig, PanelConfig];
}

export function useResizablePanels({ panels }: UseResizablePanelsOptions) {
  const [widths, setWidths] = useState<[number, number, number]>([
    panels[0].defaultWidth,
    panels[1].defaultWidth,
    panels[2].defaultWidth,
  ]);

  const dragging = useRef<{ index: number; startX: number; startWidths: [number, number, number] } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = {
      index,
      startX: e.clientX,
      startWidths: [...widths] as [number, number, number],
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [widths]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;

      const { index, startX, startWidths } = dragging.current;
      const delta = e.clientX - startX;
      const containerWidth = containerRef.current.getBoundingClientRect().width;

      const newWidths = [...startWidths] as [number, number, number];

      // Convert pixel delta to percentage
      const deltaPercent = (delta / containerWidth) * 100;

      // Resize left panel and right neighbor
      const leftIdx = index;
      const rightIdx = index + 1;

      let newLeft = startWidths[leftIdx] + deltaPercent;
      let newRight = startWidths[rightIdx] - deltaPercent;

      // Clamp to min/max
      const leftMin = (panels[leftIdx].minWidth / containerWidth) * 100;
      const leftMax = (panels[leftIdx].maxWidth / containerWidth) * 100;
      const rightMin = (panels[rightIdx].minWidth / containerWidth) * 100;
      const rightMax = (panels[rightIdx].maxWidth / containerWidth) * 100;

      if (newLeft < leftMin) {
        newRight += newLeft - leftMin;
        newLeft = leftMin;
      }
      if (newLeft > leftMax) {
        newRight += newLeft - leftMax;
        newLeft = leftMax;
      }
      if (newRight < rightMin) {
        newLeft += newRight - rightMin;
        newRight = rightMin;
      }
      if (newRight > rightMax) {
        newLeft += newRight - rightMax;
        newRight = rightMax;
      }

      newWidths[leftIdx] = newLeft;
      newWidths[rightIdx] = newRight;

      setWidths(newWidths);
    };

    const handleMouseUp = () => {
      if (dragging.current) {
        dragging.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [panels]);

  const setWidthsOverride = useCallback((newWidths: [number, number, number]) => {
    setWidths(newWidths);
  }, []);

  return { widths, setWidths: setWidthsOverride, handleMouseDown, containerRef };
}

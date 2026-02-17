import { useState, useCallback, useEffect, useRef } from 'react';
import type { TextHighlight, HighlightColor } from '../types';

const STORAGE_KEY = 'superflux_highlights';

type HighlightMap = Record<string, TextHighlight[]>;

function loadFromStorage(): HighlightMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function useHighlightStore() {
  const [data, setData] = useState<HighlightMap>(loadFromStorage);
  const dataRef = useRef(data);
  dataRef.current = data;

  // Persist to localStorage on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const getHighlights = useCallback((itemId: string): TextHighlight[] => {
    return dataRef.current[itemId] ?? [];
  }, []);

  const addHighlight = useCallback((
    itemId: string,
    text: string,
    color: HighlightColor,
    prefix: string,
    suffix: string,
  ): TextHighlight => {
    const hl: TextHighlight = {
      id: crypto.randomUUID(),
      text,
      color,
      prefix,
      suffix,
      note: '',
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      [itemId]: [...(prev[itemId] ?? []), hl],
    }));
    return hl;
  }, []);

  const removeHighlight = useCallback((itemId: string, highlightId: string) => {
    setData(prev => {
      const list = prev[itemId];
      if (!list) return prev;
      const filtered = list.filter(h => h.id !== highlightId);
      if (filtered.length === 0) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: filtered };
    });
  }, []);

  const updateHighlightNote = useCallback((itemId: string, highlightId: string, note: string) => {
    setData(prev => {
      const list = prev[itemId];
      if (!list) return prev;
      return {
        ...prev,
        [itemId]: list.map(h => h.id === highlightId ? { ...h, note } : h),
      };
    });
  }, []);

  return { data, getHighlights, addHighlight, removeHighlight, updateHighlightNote };
}

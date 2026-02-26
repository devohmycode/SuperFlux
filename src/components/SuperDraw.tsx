import { useState, useCallback, useEffect, useRef, type MouseEvent as RMouseEvent } from 'react';

// ─── Types ───────────────────────────────────────────────────────────

type Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'freedraw' | 'text' | 'eraser';

interface DrawElement {
  id: string;
  type: 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'freedraw' | 'text';
  x: number; y: number; w: number; h: number;
  points?: number[][];
  text?: string;
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  fontSize?: number;
}

interface Camera { x: number; y: number; zoom: number; }
type Handle = 'nw' | 'ne' | 'sw' | 'se';

const STORAGE_KEY = 'superflux_draw';
const uid = () => Math.random().toString(36).slice(2, 10);

function loadData(): { elements: DrawElement[]; camera: Camera } {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch { /* */ }
  return { elements: [], camera: { x: 0, y: 0, zoom: 1 } };
}
function saveData(els: DrawElement[], cam: Camera) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ elements: els, camera: cam })); } catch { /* */ }
}

// ─── Geometry ────────────────────────────────────────────────────────

function s2w(sx: number, sy: number, c: Camera): [number, number] {
  return [(sx - c.x) / c.zoom, (sy - c.y) / c.zoom];
}

function hitTest(el: DrawElement, wx: number, wy: number): boolean {
  const m = 6;
  if (el.type === 'freedraw' && el.points) return el.points.some(([px, py]) => Math.hypot(px - wx, py - wy) < 10);
  if ((el.type === 'line' || el.type === 'arrow') && el.points && el.points.length >= 2) {
    for (let i = 0; i < el.points.length - 1; i++) {
      const [ax, ay] = el.points[i], [bx, by] = el.points[i + 1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      if (l2 === 0) { if (Math.hypot(wx - ax, wy - ay) < 8) return true; continue; }
      const t = Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / l2));
      if (Math.hypot(wx - (ax + t * dx), wy - (ay + t * dy)) < 8) return true;
    }
    return false;
  }
  return wx >= el.x - m && wx <= el.x + el.w + m && wy >= el.y - m && wy <= el.y + el.h + m;
}

function getHandles(el: DrawElement): Record<Handle, [number, number]> {
  return { nw: [el.x, el.y], ne: [el.x + el.w, el.y], sw: [el.x, el.y + el.h], se: [el.x + el.w, el.y + el.h] };
}

function hitHandle(el: DrawElement, wx: number, wy: number): Handle | null {
  for (const [k, [hx, hy]] of Object.entries(getHandles(el)))
    if (Math.hypot(wx - hx, wy - hy) < 8) return k as Handle;
  return null;
}

// ─── Paint helpers ───────────────────────────────────────────────────

function adaptColor(c: string, isDark: boolean): string {
  if (isDark && c === '#1e1e1e') return '#ffffff';
  if (!isDark && c === '#ffffff') return '#1e1e1e';
  return c;
}

function paintEl(ctx: CanvasRenderingContext2D, el: DrawElement, cam: Camera, isDark: boolean) {
  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.translate(cam.x, cam.y); ctx.scale(cam.zoom, cam.zoom);
  ctx.strokeStyle = adaptColor(el.stroke, isDark);
  ctx.fillStyle = el.fill === 'transparent' ? 'transparent' : adaptColor(el.fill, isDark);
  ctx.lineWidth = el.strokeWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  switch (el.type) {
    case 'rect':
      if (el.fill !== 'transparent') ctx.fillRect(el.x, el.y, el.w, el.h);
      ctx.strokeRect(el.x, el.y, el.w, el.h); break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
      if (el.fill !== 'transparent') ctx.fill(); ctx.stroke(); break;
    case 'diamond': {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      ctx.beginPath(); ctx.moveTo(cx, el.y); ctx.lineTo(el.x + el.w, cy); ctx.lineTo(cx, el.y + el.h); ctx.lineTo(el.x, cy); ctx.closePath();
      if (el.fill !== 'transparent') ctx.fill(); ctx.stroke(); break;
    }
    case 'freedraw':
      if (!el.points || el.points.length < 2) break;
      ctx.beginPath(); ctx.moveTo(el.points[0][0], el.points[0][1]);
      for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i][0], el.points[i][1]);
      ctx.stroke(); break;
    case 'line': case 'arrow':
      if (!el.points || el.points.length < 2) break;
      ctx.beginPath(); ctx.moveTo(el.points[0][0], el.points[0][1]);
      for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i][0], el.points[i][1]);
      ctx.stroke();
      if (el.type === 'arrow') {
        const [px, py] = el.points[el.points.length - 2], [ex, ey] = el.points[el.points.length - 1];
        const a = Math.atan2(ey - py, ex - px), hl = 12 + el.strokeWidth * 2;
        ctx.beginPath();
        ctx.moveTo(ex, ey); ctx.lineTo(ex - hl * Math.cos(a - 0.4), ey - hl * Math.sin(a - 0.4));
        ctx.moveTo(ex, ey); ctx.lineTo(ex - hl * Math.cos(a + 0.4), ey - hl * Math.sin(a + 0.4));
        ctx.stroke();
      }
      break;
    case 'text':
      ctx.font = `${el.fontSize ?? 20}px sans-serif`; ctx.fillStyle = adaptColor(el.stroke, isDark); ctx.textBaseline = 'top';
      (el.text ?? '').split('\n').forEach((l, i) => ctx.fillText(l, el.x, el.y + i * (el.fontSize ?? 20) * 1.2));
      break;
  }
  ctx.restore();
}

function paintSel(ctx: CanvasRenderingContext2D, el: DrawElement, cam: Camera) {
  ctx.save(); ctx.translate(cam.x, cam.y); ctx.scale(cam.zoom, cam.zoom);
  ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = 1.5 / cam.zoom;
  ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
  ctx.strokeRect(el.x - 2, el.y - 2, el.w + 4, el.h + 4); ctx.setLineDash([]);
  const r = 4 / cam.zoom; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = 1.5 / cam.zoom;
  for (const [hx, hy] of Object.values(getHandles(el))) { ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}

// ─── Tool config ─────────────────────────────────────────────────────

const TOOLS: { tool: Tool; icon: string; label: string; key: string }[] = [
  { tool: 'hand', icon: '✋', label: 'Déplacer', key: 'h' },
  { tool: 'select', icon: '⇱', label: 'Sélection', key: 'v' },
  { tool: 'rect', icon: '▭', label: 'Rectangle', key: 'r' },
  { tool: 'ellipse', icon: '◯', label: 'Ellipse', key: 'o' },
  { tool: 'diamond', icon: '◇', label: 'Losange', key: 'd' },
  { tool: 'line', icon: '╱', label: 'Ligne', key: 'l' },
  { tool: 'arrow', icon: '→', label: 'Flèche', key: 'a' },
  { tool: 'freedraw', icon: '✎', label: 'Crayon', key: 'p' },
  { tool: 'text', icon: 'T', label: 'Texte', key: 't' },
  { tool: 'eraser', icon: '⌫', label: 'Gomme', key: 'e' },
];
const COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#ffffff', 'transparent'];
const WIDTHS = [1, 2, 3, 5, 8];
const FONT_SIZES = [12, 16, 20, 28, 36, 48, 64];

// ═════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════

export function SuperDraw() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastPtr = useRef<[number, number]>([0, 0]);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const init = useRef(loadData());
  const [els, setEls] = useState<DrawElement[]>(init.current.elements);
  const [cam, setCam] = useState<Camera>(init.current.camera);
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sColor, setSColor] = useState('#1e1e1e');
  const [fColor, setFColor] = useState('transparent');
  const [sWidth, setSWidth] = useState(2);
  const [hist, setHist] = useState<DrawElement[][]>([init.current.elements]);
  const [hIdx, setHIdx] = useState(0);
  const [dark, setDark] = useState(false);
  const [fontSize, setFontSize] = useState(20);
  const [textEdit, setTextEdit] = useState<{ wx: number; wy: number; sx: number; sy: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Refs mirroring state for imperative paint
  const R = useRef({ els, cam, sel });
  R.current = { els, cam, sel };

  const ia = useRef<{
    type: 'none' | 'draw' | 'move' | 'resize' | 'pan' | 'selbox';
    sx: number; sy: number;
    elId?: string; handle?: Handle;
    origEls?: DrawElement[]; origCam?: Camera;
  }>({ type: 'none', sx: 0, sy: 0 });

  // ── Switch default stroke color with dark/light mode ──
  useEffect(() => {
    setSColor(dark ? '#ffffff' : '#1e1e1e');
  }, [dark]);

  // ── Auto-focus textarea when it appears ──
  useEffect(() => {
    if (textEdit) {
      // Use rAF + setTimeout to ensure DOM has rendered the textarea
      requestAnimationFrame(() => {
        setTimeout(() => textAreaRef.current?.focus(), 0);
      });
    }
  }, [textEdit]);

  // ── Autosave ──
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveData(els, cam), 400);
  }, [els, cam]);

  // ── History ──
  const push = useCallback((next: DrawElement[]) => {
    setHist(p => [...p.slice(0, hIdx + 1), next]);
    setHIdx(p => p + 1);
  }, [hIdx]);
  const undo = useCallback(() => { if (hIdx > 0) { setHIdx(hIdx - 1); setEls(hist[hIdx - 1]); setSel(new Set()); } }, [hIdx, hist]);
  const redo = useCallback(() => { if (hIdx < hist.length - 1) { setHIdx(hIdx + 1); setEls(hist[hIdx + 1]); setSel(new Set()); } }, [hIdx, hist]);
  const delSel = useCallback(() => { if (sel.size === 0) return; const n = els.filter(e => !sel.has(e.id)); setEls(n); push(n); setSel(new Set()); }, [els, sel, push]);
  const dupSel = useCallback(() => {
    if (sel.size === 0) return;
    const cl: DrawElement[] = [], ids = new Set<string>();
    els.filter(e => sel.has(e.id)).forEach(e => { const id = uid(); cl.push({ ...e, id, x: e.x + 20, y: e.y + 20 }); ids.add(id); });
    const n = [...els, ...cl]; setEls(n); push(n); setSel(ids);
  }, [els, sel, push]);

  // ── Paint (imperative — reads from R.current) ──
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);

    // Only resize buffer if CSS size changed
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = dark ? '#1e1e2e' : '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const { els: e, cam: c, sel: s } = R.current;
    e.forEach(el => paintEl(ctx, el, c, dark));
    e.filter(el => s.has(el.id)).forEach(el => paintSel(ctx, el, c));

    if (ia.current.type === 'selbox') {
      const [sx, sy] = [ia.current.sx, ia.current.sy];
      const [lx, ly] = lastPtr.current;
      ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.fillStyle = 'rgba(74,144,217,0.08)';
      const bx = Math.min(sx, lx), by = Math.min(sy, ly);
      ctx.fillRect(bx, by, Math.abs(lx - sx), Math.abs(ly - sy));
      ctx.strokeRect(bx, by, Math.abs(lx - sx), Math.abs(ly - sy));
      ctx.setLineDash([]);
    }
  }, [dark]);

  // Repaint on state change
  useEffect(() => {
    const id = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(id);
  }, [els, cam, sel, paint]);

  // Resize observer on WRAPPER only
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => requestAnimationFrame(paint));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paint]);

  // ── Pointer ──
  const onDown = useCallback((e: RMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    lastPtr.current = [sx, sy];
    const [wx, wy] = s2w(sx, sy, cam);

    // Text tool: open textarea at click position
    if (tool === 'text') {
      // If there's already a textarea open with text, submit it first
      if (textEdit && textValue.trim()) {
        const el: DrawElement = { id: uid(), type: 'text', x: textEdit.wx, y: textEdit.wy, w: 200, h: 30, text: textValue, stroke: sColor, fill: 'transparent', strokeWidth: 1, opacity: 1, fontSize };
        const n = [...els, el]; setEls(n); push(n);
      }
      setTextValue('');
      setTextEdit({ wx, wy, sx, sy });
      return;
    }

    // Use document-level listeners for drag tracking

    if (tool === 'hand') { ia.current = { type: 'pan', sx, sy, origCam: { ...cam } }; return; }
    if (tool === 'select') {
      for (const el of els.filter(x => sel.has(x.id))) {
        const h = hitHandle(el, wx, wy);
        if (h) { ia.current = { type: 'resize', sx: wx, sy: wy, elId: el.id, handle: h, origEls: els.map(x => ({ ...x })) }; return; }
      }
      const hit = [...els].reverse().find(el => hitTest(el, wx, wy));
      if (hit) {
        if (!sel.has(hit.id)) setSel(e.shiftKey ? new Set([...sel, hit.id]) : new Set([hit.id]));
        ia.current = { type: 'move', sx: wx, sy: wy, origEls: els.map(x => ({ ...x })) }; return;
      }
      setSel(new Set());
      ia.current = { type: 'selbox', sx, sy }; return;
    }
    if (tool === 'eraser') {
      const hit = [...els].reverse().find(el => hitTest(el, wx, wy));
      if (hit) { const n = els.filter(el => el.id !== hit.id); setEls(n); push(n); } return;
    }

    const newEl: DrawElement = {
      id: uid(), type: (tool === 'freedraw' ? 'freedraw' : tool === 'line' ? 'line' : tool === 'arrow' ? 'arrow' : tool) as DrawElement['type'],
      x: wx, y: wy, w: 0, h: 0, stroke: sColor, fill: fColor, strokeWidth: sWidth, opacity: 1,
      ...(tool === 'freedraw' ? { points: [[wx, wy]] } : {}),
      ...((tool === 'line' || tool === 'arrow') ? { points: [[wx, wy], [wx, wy]] } : {}),
    };
    setEls(prev => [...prev, newEl]);
    ia.current = { type: 'draw', sx: wx, sy: wy, elId: newEl.id };
  }, [tool, cam, els, sel, sColor, fColor, sWidth, push, textEdit, textValue]);

  const onMove = useCallback((e: RMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    lastPtr.current = [sx, sy];
    const [wx, wy] = s2w(sx, sy, cam);
    const cur = ia.current;

    if (cur.type === 'pan' && cur.origCam) { setCam({ x: cur.origCam.x + (sx - cur.sx), y: cur.origCam.y + (sy - cur.sy), zoom: cur.origCam.zoom }); return; }
    if (cur.type === 'draw' && cur.elId) {
      setEls(prev => prev.map(el => {
        if (el.id !== cur.elId) return el;
        if (el.type === 'freedraw') return { ...el, points: [...(el.points || []), [wx, wy]] };
        if (el.type === 'line' || el.type === 'arrow') { const pts = [...(el.points || [])]; pts[pts.length - 1] = [wx, wy]; return { ...el, points: pts }; }
        return { ...el, x: Math.min(cur.sx, wx), y: Math.min(cur.sy, wy), w: Math.abs(wx - cur.sx), h: Math.abs(wy - cur.sy) };
      })); return;
    }
    if (cur.type === 'move' && cur.origEls) {
      const dx = wx - cur.sx, dy = wy - cur.sy;
      setEls(cur.origEls.map(el => {
        if (!sel.has(el.id)) return el;
        const m = { ...el, x: el.x + dx, y: el.y + dy };
        if (el.points) m.points = el.points.map(([px, py]) => [px + dx, py + dy]);
        return m;
      })); return;
    }
    if (cur.type === 'resize' && cur.origEls && cur.elId && cur.handle) {
      setEls(cur.origEls.map(el => {
        if (el.id !== cur.elId) return el;
        const o = cur.origEls!.find(x => x.id === el.id)!;
        let { x, y, w, h } = o;
        const dx = wx - cur.sx, dy = wy - cur.sy;
        if (cur.handle === 'se') { w += dx; h += dy; }
        else if (cur.handle === 'nw') { x += dx; y += dy; w -= dx; h -= dy; }
        else if (cur.handle === 'ne') { y += dy; w += dx; h -= dy; }
        else { x += dx; w -= dx; h += dy; }
        return { ...el, x, y, w, h };
      })); return;
    }
    if (cur.type === 'selbox') requestAnimationFrame(paint);
  }, [cam, sel, paint]);

  const onUp = useCallback(() => {
    const cur = ia.current;
    if (cur.type === 'draw' || cur.type === 'move' || cur.type === 'resize') push([...els]);
    if (cur.type === 'selbox') {
      const [wx1, wy1] = s2w(Math.min(cur.sx, lastPtr.current[0]), Math.min(cur.sy, lastPtr.current[1]), cam);
      const [wx2, wy2] = s2w(Math.max(cur.sx, lastPtr.current[0]), Math.max(cur.sy, lastPtr.current[1]), cam);
      const ids = new Set<string>();
      els.forEach(el => { if (el.x >= wx1 && el.x + el.w <= wx2 && el.y >= wy1 && el.y + el.h <= wy2) ids.add(el.id); });
      setSel(ids);
    }
    ia.current = { type: 'none', sx: 0, sy: 0 };
  }, [els, cam, push]);

  // ── Wheel zoom/pan ──
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const c = R.current.cam;
      if (e.ctrlKey || e.metaKey) {
        const f = e.deltaY > 0 ? 0.92 : 1.08;
        const z = Math.max(0.1, Math.min(10, c.zoom * f));
        setCam({ x: sx - (sx - c.x) * (z / c.zoom), y: sy - (sy - c.y) * (z / c.zoom), zoom: z });
      } else {
        setCam(p => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    canvas.addEventListener('wheel', h, { passive: false });
    return () => canvas.removeEventListener('wheel', h);
  }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey && e.key === 'd') { e.preventDefault(); dupSel(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { delSel(); return; }
      if (e.ctrlKey && e.key === 'a') { e.preventDefault(); setSel(new Set(els.map(el => el.id))); return; }
      const def = TOOLS.find(t => t.key === e.key.toLowerCase());
      if (def && !e.ctrlKey && !e.metaKey) { setTool(def.tool); setSel(new Set()); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo, redo, delSel, dupSel, els]);


  const submitText = useCallback(() => {
    if (!textEdit || !textValue.trim()) return;
    const el: DrawElement = { id: uid(), type: 'text', x: textEdit.wx, y: textEdit.wy, w: 200, h: 30, text: textValue, stroke: sColor, fill: 'transparent', strokeWidth: 1, opacity: 1, fontSize };
    const n = [...els, el]; setEls(n); push(n);
    setTextValue('');
    setTextEdit(null);
  }, [textEdit, textValue, els, sColor, push, fontSize]);

  const exportPng = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const a = document.createElement('a'); a.download = 'superdraw.png'; a.href = c.toDataURL('image/png'); a.click();
  }, []);

  const clearAll = useCallback(() => { setEls([]); push([]); setSel(new Set()); setCam({ x: 0, y: 0, zoom: 1 }); }, [push]);

  // ─── Styles ────────────────────────────────────────────────────────

  const bg = dark ? 'rgba(30,30,46,0.95)' : '#f0ede8';
  const border = dark ? 'rgba(255,255,255,0.06)' : '#e8e5df';
  const txtDim = dark ? '#888' : '#9e9b96';
  const txtSec = dark ? '#aaa' : '#6b6964';
  const accent = '#d4a853';
  const accentBg = 'rgba(212,168,83,0.12)';

  const toolBtn = (active: boolean): React.CSSProperties => ({
    width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: active ? `1.5px solid ${accent}` : 'none', borderRadius: 6,
    background: active ? accentBg : 'transparent', color: active ? accent : txtSec,
    fontSize: 16, cursor: 'pointer',
  });

  const actBtn = (disabled: boolean): React.CSSProperties => ({
    width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: 6, background: 'transparent', color: txtSec,
    fontSize: 16, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
  });

  const colorBtn = (c: string, active: boolean): React.CSSProperties => ({
    width: 20, height: 20, borderRadius: '50%', cursor: 'pointer',
    border: active ? `2px solid ${accent}` : c === '#ffffff' ? '1px solid #ccc' : '2px solid transparent',
    background: c === 'transparent' ? 'repeating-conic-gradient(#ddd 0% 25%, transparent 0% 50%) 50% / 10px 10px' : c,
  });

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: bg, borderBottom: `1px solid ${border}`, flexShrink: 0, overflowX: 'auto', zIndex: 10 }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {TOOLS.map(t => (
            <button key={t.tool} title={`${t.label} (${t.key.toUpperCase()})`} style={toolBtn(tool === t.tool)}
              onClick={() => { setTool(t.tool); setSel(new Set()); }}>{t.icon}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 28, background: border, flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: txtDim, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Contour</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {COLORS.filter(c => c !== 'transparent').map(c => (
              <button key={`s-${c}`} onClick={() => setSColor(c)} style={colorBtn(c, sColor === c)} />
            ))}
          </div>
          <span style={{ fontSize: 10, color: txtDim, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Fond</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {COLORS.map(c => (
              <button key={`f-${c}`} onClick={() => setFColor(c)} style={colorBtn(c, fColor === c)} />
            ))}
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: border, flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: txtDim, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Épaisseur</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {WIDTHS.map(w => (
              <button key={w} onClick={() => setSWidth(w)} style={{ ...toolBtn(sWidth === w), width: 28, height: 28, borderRadius: 5 }}>
                <span style={{ width: 18, height: w + 1, background: dark ? '#ccc' : '#333', borderRadius: 2, display: 'block' }} />
              </button>
            ))}
          </div>
        </div>
        {tool === 'text' && (<>
          <div style={{ width: 1, height: 28, background: border, flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: txtDim, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Police</span>
            <div style={{ display: 'flex', gap: 3 }}>
              {FONT_SIZES.map(s => (
                <button key={s} onClick={() => setFontSize(s)}
                  style={{ ...toolBtn(fontSize === s), width: 28, height: 28, borderRadius: 5, fontSize: 11, fontWeight: fontSize === s ? 700 : 400 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </>)}
        <div style={{ width: 1, height: 28, background: border, flexShrink: 0 }} />
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          <button onClick={undo} disabled={hIdx <= 0} title="Annuler (Ctrl+Z)" style={actBtn(hIdx <= 0)}>↩</button>
          <button onClick={redo} disabled={hIdx >= hist.length - 1} title="Rétablir (Ctrl+Y)" style={actBtn(hIdx >= hist.length - 1)}>↪</button>
          <button onClick={delSel} disabled={sel.size === 0} title="Supprimer" style={actBtn(sel.size === 0)}>🗑</button>
          <button onClick={dupSel} disabled={sel.size === 0} title="Dupliquer (Ctrl+D)" style={actBtn(sel.size === 0)}>⧉</button>
          <button onClick={exportPng} title="Exporter PNG" style={actBtn(false)}>📷</button>
          <button onClick={clearAll} title="Tout effacer" style={actBtn(false)}>🧹</button>
          <div style={{ width: 1, height: 28, background: border, flexShrink: 0 }} />
          <button onClick={() => setDark(d => !d)} title={dark ? 'Mode clair' : 'Mode sombre'} style={actBtn(false)}>{dark ? '☀️' : '🌙'}</button>
        </div>
      </div>

      {/* Canvas wrapper */}
      <div ref={wrapRef} style={{ flex: '1 1 0px', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <canvas ref={canvasRef}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none',
            cursor: tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }} />

        {/* Textarea overlay for text tool */}
        {textEdit && (
          <textarea
            ref={textAreaRef}
            value={textValue}
            placeholder="Taper le texte..."
            onChange={e => setTextValue(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText(); }
              if (e.key === 'Escape') { e.preventDefault(); setTextValue(''); setTextEdit(null); }
            }}
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: textEdit.sx,
              top: textEdit.sy,
              minWidth: 200,
              minHeight: 28,
              padding: '4px 6px',
              border: `2px solid ${accent}`,
              borderRadius: 4,
              background: dark ? 'rgba(30,30,46,0.95)' : 'rgba(255,255,255,0.95)',
              color: dark ? '#e0e0e0' : '#1a1917',
              fontFamily: 'sans-serif',
              fontSize: `${fontSize * cam.zoom}px`,
              lineHeight: 1.2,
              resize: 'both',
              outline: 'none',
              zIndex: 20,
              boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            }}
          />
        )}

        <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: 4,
          background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '4px 8px', zIndex: 10,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <button onClick={() => setCam(p => ({ ...p, zoom: Math.max(0.1, p.zoom * 0.85) }))}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 5, background: 'transparent', color: txtSec, fontSize: 16, cursor: 'pointer' }}>−</button>
          <span style={{ fontSize: 12, color: txtSec, minWidth: 36, textAlign: 'center' as const }}>{Math.round(cam.zoom * 100)}%</span>
          <button onClick={() => setCam(p => ({ ...p, zoom: Math.min(10, p.zoom * 1.15) }))}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 5, background: 'transparent', color: txtSec, fontSize: 16, cursor: 'pointer' }}>+</button>
          <button onClick={() => setCam({ x: 0, y: 0, zoom: 1 })} title="Réinitialiser"
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 5, background: 'transparent', color: txtSec, fontSize: 16, cursor: 'pointer' }}>⊙</button>
        </div>
      </div>
    </div>
  );
}

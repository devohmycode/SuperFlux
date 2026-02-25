export interface PaletteColors {
  accent: string;
  accentDim: string;
  accentGlow: string;
  accentText: string;
  secondary: string;
  secondaryGlow: string;
  tertiary: string;
  tertiaryGlow: string;
}

export interface Palette {
  id: string;
  name: string;
  light: PaletteColors;
  dark: PaletteColors;
}

export const palettes: Palette[] = [
  {
    id: 'amber',
    name: 'Amber',
    light: {
      accent: '#d4a853',
      accentDim: '#b8923f',
      accentGlow: 'rgba(212, 168, 83, 0.12)',
      accentText: '#9a7528',
      secondary: '#c07830',
      secondaryGlow: 'rgba(192, 120, 48, 0.10)',
      tertiary: '#e8c06a',
      tertiaryGlow: 'rgba(232, 192, 106, 0.10)',
    },
    dark: {
      accent: '#d4a853',
      accentDim: '#b8923f',
      accentGlow: 'rgba(212, 168, 83, 0.12)',
      accentText: '#e8c06a',
      secondary: '#d4884a',
      secondaryGlow: 'rgba(212, 136, 74, 0.10)',
      tertiary: '#f0d080',
      tertiaryGlow: 'rgba(240, 208, 128, 0.08)',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    light: {
      accent: '#3a8fd4',
      accentDim: '#2d78b5',
      accentGlow: 'rgba(58, 143, 212, 0.12)',
      accentText: '#1e5f99',
      secondary: '#2bb5a0',
      secondaryGlow: 'rgba(43, 181, 160, 0.10)',
      tertiary: '#5bc0de',
      tertiaryGlow: 'rgba(91, 192, 222, 0.10)',
    },
    dark: {
      accent: '#4a9ee8',
      accentDim: '#3a8fd4',
      accentGlow: 'rgba(74, 158, 232, 0.12)',
      accentText: '#6cb4f0',
      secondary: '#38c9b2',
      secondaryGlow: 'rgba(56, 201, 178, 0.10)',
      tertiary: '#6dcce6',
      tertiaryGlow: 'rgba(109, 204, 230, 0.08)',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: {
      accent: '#2d9e5a',
      accentDim: '#24824a',
      accentGlow: 'rgba(45, 158, 90, 0.12)',
      accentText: '#1a6b3a',
      secondary: '#7ab648',
      secondaryGlow: 'rgba(122, 182, 72, 0.10)',
      tertiary: '#a3d977',
      tertiaryGlow: 'rgba(163, 217, 119, 0.10)',
    },
    dark: {
      accent: '#3db86c',
      accentDim: '#2d9e5a',
      accentGlow: 'rgba(61, 184, 108, 0.12)',
      accentText: '#5ccf88',
      secondary: '#8ec854',
      secondaryGlow: 'rgba(142, 200, 84, 0.10)',
      tertiary: '#b4e48c',
      tertiaryGlow: 'rgba(180, 228, 140, 0.08)',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    light: {
      accent: '#e8734a',
      accentDim: '#d05f38',
      accentGlow: 'rgba(232, 115, 74, 0.12)',
      accentText: '#b84e2a',
      secondary: '#d94f8c',
      secondaryGlow: 'rgba(217, 79, 140, 0.10)',
      tertiary: '#f5a623',
      tertiaryGlow: 'rgba(245, 166, 35, 0.10)',
    },
    dark: {
      accent: '#f08560',
      accentDim: '#e8734a',
      accentGlow: 'rgba(240, 133, 96, 0.12)',
      accentText: '#f8a080',
      secondary: '#e868a0',
      secondaryGlow: 'rgba(232, 104, 160, 0.10)',
      tertiary: '#f8b840',
      tertiaryGlow: 'rgba(248, 184, 64, 0.08)',
    },
  },
  {
    id: 'lavender',
    name: 'Lavender',
    light: {
      accent: '#7c5cbf',
      accentDim: '#6648a8',
      accentGlow: 'rgba(124, 92, 191, 0.12)',
      accentText: '#553899',
      secondary: '#9b6ddb',
      secondaryGlow: 'rgba(155, 109, 219, 0.10)',
      tertiary: '#b794f4',
      tertiaryGlow: 'rgba(183, 148, 244, 0.10)',
    },
    dark: {
      accent: '#9070d0',
      accentDim: '#7c5cbf',
      accentGlow: 'rgba(144, 112, 208, 0.12)',
      accentText: '#b494f4',
      secondary: '#ab80e8',
      secondaryGlow: 'rgba(171, 128, 232, 0.10)',
      tertiary: '#c8a8f8',
      tertiaryGlow: 'rgba(200, 168, 248, 0.08)',
    },
  },
  {
    id: 'rosewood',
    name: 'Rosewood',
    light: {
      accent: '#c44d56',
      accentDim: '#a83e48',
      accentGlow: 'rgba(196, 77, 86, 0.12)',
      accentText: '#922e38',
      secondary: '#a0522d',
      secondaryGlow: 'rgba(160, 82, 45, 0.10)',
      tertiary: '#d4836a',
      tertiaryGlow: 'rgba(212, 131, 106, 0.10)',
    },
    dark: {
      accent: '#d86068',
      accentDim: '#c44d56',
      accentGlow: 'rgba(216, 96, 104, 0.12)',
      accentText: '#f08088',
      secondary: '#b86840',
      secondaryGlow: 'rgba(184, 104, 64, 0.10)',
      tertiary: '#e09880',
      tertiaryGlow: 'rgba(224, 152, 128, 0.08)',
    },
  },
  {
    id: 'mint',
    name: 'Mint',
    light: {
      accent: '#36b5a0',
      accentDim: '#2a9a88',
      accentGlow: 'rgba(54, 181, 160, 0.12)',
      accentText: '#208070',
      secondary: '#4ac6b7',
      secondaryGlow: 'rgba(74, 198, 183, 0.10)',
      tertiary: '#7edec7',
      tertiaryGlow: 'rgba(126, 222, 199, 0.10)',
    },
    dark: {
      accent: '#44c8b0',
      accentDim: '#36b5a0',
      accentGlow: 'rgba(68, 200, 176, 0.12)',
      accentText: '#68dcc8',
      secondary: '#58d4c4',
      secondaryGlow: 'rgba(88, 212, 196, 0.10)',
      tertiary: '#90e8d4',
      tertiaryGlow: 'rgba(144, 232, 212, 0.08)',
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    light: {
      accent: '#0097a7',
      accentDim: '#00838f',
      accentGlow: 'rgba(0, 151, 167, 0.12)',
      accentText: '#006064',
      secondary: '#c2185b',
      secondaryGlow: 'rgba(194, 24, 91, 0.10)',
      tertiary: '#558b2f',
      tertiaryGlow: 'rgba(85, 139, 47, 0.10)',
    },
    dark: {
      accent: '#00e5ff',
      accentDim: '#00b8d4',
      accentGlow: 'rgba(0, 229, 255, 0.18)',
      accentText: '#40f0ff',
      secondary: '#ff2d78',
      secondaryGlow: 'rgba(255, 45, 120, 0.15)',
      tertiary: '#76ff03',
      tertiaryGlow: 'rgba(118, 255, 3, 0.12)',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    light: {
      accent: '#6882a8',
      accentDim: '#566e92',
      accentGlow: 'rgba(104, 130, 168, 0.12)',
      accentText: '#455b7c',
      secondary: '#5a7a9a',
      secondaryGlow: 'rgba(90, 122, 154, 0.10)',
      tertiary: '#8fa5c4',
      tertiaryGlow: 'rgba(143, 165, 196, 0.10)',
    },
    dark: {
      accent: '#7c96b8',
      accentDim: '#6882a8',
      accentGlow: 'rgba(124, 150, 184, 0.12)',
      accentText: '#98b0d0',
      secondary: '#6e8eae',
      secondaryGlow: 'rgba(110, 142, 174, 0.10)',
      tertiary: '#a0b8d4',
      tertiaryGlow: 'rgba(160, 184, 212, 0.08)',
    },
  },
];

const PALETTE_KEY = 'superflux_palette';

export function getStoredPaletteId(): string {
  try {
    return localStorage.getItem(PALETTE_KEY) || 'amber';
  } catch {
    return 'amber';
  }
}

export function getPaletteById(id: string): Palette {
  return palettes.find(p => p.id === id) || palettes[0];
}

export function applyPalette(id: string) {
  document.documentElement.setAttribute('data-palette', id);
  try {
    localStorage.setItem(PALETTE_KEY, id);
  } catch { /* ignore */ }
}

export function initPalette() {
  const id = getStoredPaletteId();
  document.documentElement.setAttribute('data-palette', id);
}

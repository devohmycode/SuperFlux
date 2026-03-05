import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Compartment } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

interface Palette {
  bg: { primary: string; secondary: string; surface: string; hover: string };
  fg: { primary: string; secondary: string; muted: string };
  accent: {
    blue: string; green: string; red: string; yellow: string;
    mauve: string; peach: string; teal: string; pink: string; sky: string;
  };
}

const dark: Palette = {
  bg: { primary: '#000000', secondary: '#000000', surface: '#121212', hover: '#1e1e1e' },
  fg: { primary: '#cdd6f4', secondary: '#a6adc8', muted: '#585b70' },
  accent: {
    blue: '#89b4fa', green: '#a6e3a1', red: '#f38ba8', yellow: '#f9e2af',
    mauve: '#cba6f7', peach: '#fab387', teal: '#94e2d5', pink: '#f5c2e7', sky: '#89dceb',
  },
};

const light: Palette = {
  bg: { primary: '#eff1f5', secondary: '#e6e9ef', surface: '#ccd0da', hover: '#bcc0cc' },
  fg: { primary: '#4c4f69', secondary: '#5c5f77', muted: '#8c8fa1' },
  accent: {
    blue: '#1e66f5', green: '#40a02b', red: '#d20f39', yellow: '#df8e1d',
    mauve: '#8839ef', peach: '#fe640b', teal: '#179299', pink: '#ea76cb', sky: '#04a5e5',
  },
};

export const themeCompartment = new Compartment();

function buildTheme(p: Palette, isDark: boolean): Extension {
  const editorTheme = EditorView.theme(
    {
      '&': { height: '100%', background: p.bg.primary, color: p.fg.primary },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
        fontSize: '14px', lineHeight: '1.6',
      },
      '.cm-content': { caretColor: p.accent.blue, padding: '8px 0' },
      '&.cm-focused .cm-cursor': { borderLeftColor: p.accent.blue, borderLeftWidth: '2px' },
      '.cm-gutters': { background: p.bg.primary, color: p.fg.muted, border: 'none', paddingRight: '8px' },
      '.cm-lineNumbers .cm-gutterElement': { minWidth: '3em', padding: '0 8px 0 16px' },
      '.cm-activeLineGutter': { background: p.bg.surface, color: p.fg.primary },
      '.cm-activeLine': { background: `${p.bg.surface}50` },
      '&.cm-focused .cm-activeLine': { background: `${p.bg.surface}80` },
      '.cm-selectionBackground': { background: `${p.accent.blue}30` },
      '&.cm-focused .cm-selectionBackground': { background: `${p.accent.blue}40` },
      '.cm-foldGutter .cm-gutterElement': { color: p.fg.muted, cursor: 'pointer', transition: 'color 0.15s' },
      '.cm-foldGutter .cm-gutterElement:hover': { color: p.fg.primary },
      '.cm-foldPlaceholder': { background: p.bg.surface, border: `1px solid ${p.bg.hover}`, color: p.fg.muted, padding: '0 6px', borderRadius: '3px', margin: '0 4px' },
      '.cm-matchingBracket': { background: `${p.accent.blue}30`, outline: `1px solid ${p.accent.blue}60` },
      '.cm-searchMatch': { background: `${p.accent.yellow}30`, outline: `1px solid ${p.accent.yellow}60` },
      '.cm-searchMatch.cm-searchMatch-selected': { background: `${p.accent.yellow}50` },
      '.cm-tooltip': { background: p.bg.secondary, border: `1px solid ${p.bg.hover}`, color: p.fg.primary, borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '4px 8px' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: p.bg.surface, color: p.fg.primary },
      '.cm-panels': { background: p.bg.secondary, color: p.fg.primary },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${p.bg.hover}` },
      '.cm-wikilink': { color: p.accent.blue, cursor: 'pointer', borderBottom: `1px dashed ${p.accent.blue}50`, transition: 'border-color 0.15s' },
      '.cm-wikilink:hover': { borderBottomColor: p.accent.blue, borderBottomStyle: 'solid' },
      '.cm-panel.cm-search': { padding: '8px 12px' },
      '.cm-panel.cm-search input, .cm-panel.cm-search button': { background: p.bg.surface, color: p.fg.primary, border: `1px solid ${p.bg.hover}`, borderRadius: '4px', padding: '4px 8px' },
      '.cm-lp-h1': { fontSize: '1.6em', fontWeight: '700', color: p.accent.red },
      '.cm-lp-h2': { fontSize: '1.4em', fontWeight: '700', color: p.accent.mauve },
      '.cm-lp-h3': { fontSize: '1.2em', fontWeight: '600', color: p.accent.blue },
      '.cm-lp-h4': { fontSize: '1.1em', fontWeight: '600', color: p.accent.teal },
      '.cm-lp-h5': { fontWeight: '600', color: p.accent.green },
      '.cm-lp-h6': { fontWeight: '600', color: p.accent.peach },
      '.cm-lp-italic': { fontStyle: 'italic', color: p.accent.pink },
      '.cm-lp-bold': { fontWeight: '700', color: p.accent.peach },
      '.cm-lp-link': { color: p.accent.blue, textDecoration: 'underline', cursor: 'pointer' },
      '.cm-lp-code': { fontFamily: "'JetBrains Mono', monospace", background: `${p.bg.surface}80`, padding: '1px 4px', borderRadius: '3px' },
      '.cm-lp-codeblock': { background: `${p.bg.surface}60` },
      '.cm-lp-blockquote': { borderLeft: `3px solid ${p.accent.blue}40`, paddingLeft: '12px', fontStyle: 'italic', color: p.fg.secondary },
      '.cm-lp-image': { maxWidth: '100%', borderRadius: '4px', margin: '4px 0' },
      '.cm-lp-image-wrapper': { display: 'block' },
      '.cm-lp-image-placeholder': { color: p.fg.muted, fontStyle: 'italic', fontSize: '12px' },
    },
    { dark: isDark }
  );

  const highlighting = syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.heading1, color: p.accent.red, fontWeight: '700', fontSize: '1.4em' },
      { tag: tags.heading2, color: p.accent.mauve, fontWeight: '700', fontSize: '1.2em' },
      { tag: tags.heading3, color: p.accent.blue, fontWeight: '600', fontSize: '1.1em' },
      { tag: tags.heading4, color: p.accent.teal, fontWeight: '600' },
      { tag: tags.heading5, color: p.accent.green, fontWeight: '600' },
      { tag: tags.heading6, color: p.accent.peach, fontWeight: '600' },
      { tag: tags.emphasis, color: p.accent.pink, fontStyle: 'italic' },
      { tag: tags.strong, color: p.accent.peach, fontWeight: '700' },
      { tag: tags.strikethrough, color: p.fg.muted, textDecoration: 'line-through' },
      { tag: tags.link, color: p.accent.blue, textDecoration: 'underline' },
      { tag: tags.url, color: p.accent.sky },
      { tag: tags.monospace, color: p.accent.green, fontFamily: 'inherit' },
      { tag: tags.list, color: p.accent.blue },
      { tag: tags.quote, color: p.fg.secondary, fontStyle: 'italic' },
      { tag: tags.processingInstruction, color: p.fg.muted },
      { tag: tags.meta, color: p.fg.muted },
      { tag: tags.labelName, color: p.accent.teal },
      { tag: tags.keyword, color: p.accent.mauve },
      { tag: tags.operator, color: p.accent.sky },
      { tag: tags.string, color: p.accent.green },
      { tag: tags.number, color: p.accent.peach },
      { tag: tags.bool, color: p.accent.peach },
      { tag: tags.variableName, color: p.fg.primary },
      { tag: tags.function(tags.variableName), color: p.accent.blue },
      { tag: tags.definition(tags.variableName), color: p.accent.blue },
      { tag: tags.propertyName, color: p.accent.blue },
      { tag: tags.comment, color: p.fg.muted, fontStyle: 'italic' },
      { tag: tags.typeName, color: p.accent.yellow },
      { tag: tags.className, color: p.accent.yellow },
      { tag: tags.tagName, color: p.accent.red },
      { tag: tags.attributeName, color: p.accent.blue },
      { tag: tags.attributeValue, color: p.accent.green },
      { tag: tags.regexp, color: p.accent.red },
      { tag: tags.escape, color: p.accent.pink },
      { tag: tags.invalid, color: p.accent.red, textDecoration: 'underline wavy' },
    ])
  );

  return [editorTheme, highlighting];
}

export function getThemeExtension(theme: 'dark' | 'light'): Extension {
  return buildTheme(theme === 'dark' ? dark : light, theme === 'dark');
}

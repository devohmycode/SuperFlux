import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../lib/tauriFetch';

/** Check if pandoc is available (Tauri only) */
export async function isPandocAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke<string>('pandoc_check');
    return true;
  } catch {
    return false;
  }
}

/** Convert a File (docx/pdf) to HTML via pandoc */
export async function importWithPandoc(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const base64 = uint8ToBase64(bytes);

  if (isTauri()) {
    return invoke<string>('pandoc_import', {
      base64Data: base64,
      filename: file.name,
    });
  }

  // Web fallback: only .docx via mammoth
  if (file.name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    return result.value;
  }

  throw new Error('Import PDF nécessite l\'application desktop avec pandoc installé.');
}

/** Export HTML to docx/pdf via pandoc, returns a downloadable Blob */
export async function exportWithPandoc(
  html: string,
  format: 'docx' | 'pdf',
): Promise<Blob> {
  if (!isTauri()) {
    throw new Error('L\'export nécessite l\'application desktop avec pandoc installé.');
  }

  const base64 = await invoke<string>('pandoc_export', {
    htmlContent: html,
    format,
  });

  const bytes = base64ToUint8(base64);
  const mime = format === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';
  return new Blob([bytes.buffer as ArrayBuffer], { type: mime });
}

// ── helpers ──

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

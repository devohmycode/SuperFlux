import { supabase, isSupabaseConfigured } from '../lib/supabase';

const SYNC_KEY = 'superpassword_sync_enabled';
const LAST_SYNC_KEY = 'superpassword_last_sync';

// Storage mode guard: skip Supabase calls when user chose local-only storage
const STORAGE_MODE_KEY = 'superflux_storage_mode';
function isLocalMode(): boolean {
  return localStorage.getItem(STORAGE_MODE_KEY) === 'local';
}

export function isPwSyncEnabled(): boolean {
  return localStorage.getItem(SYNC_KEY) === 'true';
}

export function setPwSyncEnabled(enabled: boolean): void {
  localStorage.setItem(SYNC_KEY, enabled ? 'true' : 'false');
}

export function getLastPwSync(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

function setLastPwSync(): void {
  localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
}

export async function uploadVault(
  userId: string,
  blob: number[],
  meta: number[]
): Promise<boolean> {
  if (isLocalMode()) return false;
  if (!isPwSyncEnabled() || !isSupabaseConfigured) return false;

  const metaObj = (() => {
    try {
      const text = new TextDecoder().decode(new Uint8Array(meta));
      return JSON.parse(text);
    } catch {
      return { raw: true };
    }
  })();

  const { error } = await supabase
    .from('password_vaults')
    .upsert(
      {
        user_id: userId,
        vault_blob: blob,
        vault_meta: metaObj,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('[pw-sync] upload error:', error);
    return false;
  }

  setLastPwSync();
  console.log('[pw-sync] vault uploaded for', userId);
  return true;
}

export async function downloadVault(
  userId: string
): Promise<{ blob: number[]; meta: string } | null> {
  if (isLocalMode()) return null;
  if (!isPwSyncEnabled() || !isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from('password_vaults')
    .select('vault_blob, vault_meta')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows — not an error for us
      console.error('[pw-sync] download error:', error);
    }
    return null;
  }

  const metaStr = typeof data.vault_meta === 'string'
    ? data.vault_meta
    : JSON.stringify(data.vault_meta);

  console.log('[pw-sync] vault downloaded for', userId);
  return { blob: data.vault_blob, meta: metaStr };
}

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { activateLicenseServer, deactivateLicenseServer } from '../services/licenseService';

interface ProContextValue {
  isPro: boolean;
  loading: boolean;
  licenseKey: string | null;
  activateLicense: (key: string) => Promise<{ success: boolean; error?: string }>;
  deactivateLicense: () => Promise<void>;
  upgradeModalOpen: boolean;
  showUpgradeModal: () => void;
  hideUpgradeModal: () => void;
}

const CACHE_KEY = 'superflux_pro_status';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

interface CachedProStatus {
  isPro: boolean;
  licenseKey: string | null;
  ts: number;
}

function readCache(): CachedProStatus | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedProStatus = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(isPro: boolean, licenseKey: string | null) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ isPro, licenseKey, ts: Date.now() }));
}

function getInstanceId(): string {
  const key = 'superflux_instance_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

async function fetchProStatus(userId: string): Promise<{ isPro: boolean; licenseKey: string | null } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('is_pro, license_key')
    .eq('id', userId)
    .single();

  if (error || !data) return null;
  return { isPro: !!data.is_pro, licenseKey: data.license_key ?? null };
}

const ProContext = createContext<ProContextValue | null>(null);

export function ProProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  // Init: fetch from profiles table, fallback to cache offline
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (user && isSupabaseConfigured) {
        const status = await fetchProStatus(user.id);
        if (cancelled) return;
        if (status) {
          setIsPro(status.isPro);
          setLicenseKey(status.licenseKey);
          writeCache(status.isPro, status.licenseKey);
        } else {
          // Network/query error — try cache
          const cached = readCache();
          if (cached) {
            setIsPro(cached.isPro);
            setLicenseKey(cached.licenseKey);
          }
        }
      } else {
        const cached = readCache();
        if (cached) {
          setIsPro(cached.isPro);
          setLicenseKey(cached.licenseKey);
        } else {
          setIsPro(false);
          setLicenseKey(null);
        }
      }
      if (!cancelled) setLoading(false);
    }

    init();
    return () => { cancelled = true; };
  }, [user]);

  const activateLicense = useCallback(async (key: string): Promise<{ success: boolean; error?: string }> => {
    const instanceId = getInstanceId();

    const result = await activateLicenseServer(key, instanceId);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Re-fetch from profiles to confirm
    if (user) {
      const status = await fetchProStatus(user.id);
      if (status) {
        setIsPro(status.isPro);
        setLicenseKey(status.licenseKey);
        writeCache(status.isPro, status.licenseKey);
        return { success: true };
      }
    }

    // Optimistic update if re-fetch fails
    setIsPro(true);
    setLicenseKey(key);
    writeCache(true, key);
    return { success: true };
  }, [user]);

  const deactivateLicense = useCallback(async () => {
    await deactivateLicenseServer();

    // Re-fetch from profiles to confirm
    if (user) {
      const status = await fetchProStatus(user.id);
      if (status) {
        setIsPro(status.isPro);
        setLicenseKey(status.licenseKey);
        writeCache(status.isPro, status.licenseKey);
        return;
      }
    }

    setIsPro(false);
    setLicenseKey(null);
    writeCache(false, null);
  }, [user]);

  const showUpgradeModal = useCallback(() => setUpgradeModalOpen(true), []);
  const hideUpgradeModal = useCallback(() => setUpgradeModalOpen(false), []);

  return (
    <ProContext.Provider
      value={{
        isPro,
        loading,
        licenseKey,
        activateLicense,
        deactivateLicense,
        upgradeModalOpen,
        showUpgradeModal,
        hideUpgradeModal,
      }}
    >
      {children}
    </ProContext.Provider>
  );
}

export function usePro(): ProContextValue {
  const ctx = useContext(ProContext);
  if (!ctx) throw new Error('usePro must be used within a ProProvider');
  return ctx;
}

// LemonSqueezy license activation via Supabase Edge Function (server-side validation)

import { supabase } from '../lib/supabase';

export const PRO_LIMITS = {
  maxFeeds: 50,
  maxFolders: 10,
} as const;

export const LEMONSQUEEZY_CHECKOUT_URL = 'https://ohmyapps.lemonsqueezy.com/checkout/buy/02f83483-8f23-408f-b960-fc550819ac44';

interface ActivateResponse {
  success: boolean;
  error?: string;
}

export async function activateLicenseServer(
  key: string,
  instanceId: string,
): Promise<ActivateResponse> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Non authentifié' };

    const { data, error } = await supabase.functions.invoke('activate-license', {
      body: { license_key: key, instance_id: instanceId, action: 'activate' },
    });

    if (error) return { success: false, error: error.message };
    return data as ActivateResponse;
  } catch {
    return { success: false, error: 'Impossible de contacter le serveur' };
  }
}

export async function deactivateLicenseServer(): Promise<ActivateResponse> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Non authentifié' };

    const { data, error } = await supabase.functions.invoke('activate-license', {
      body: { action: 'deactivate' },
    });

    if (error) return { success: false, error: error.message };
    return data as ActivateResponse;
  } catch {
    return { success: false, error: 'Impossible de contacter le serveur' };
  }
}

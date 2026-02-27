// LemonSqueezy license activation via Supabase Edge Function (server-side validation)

import { supabase } from '../lib/supabase';

export const PRO_LIMITS = {
  maxFeeds: 10,
  maxFolders: 5,
} as const;

export const LEMONSQUEEZY_CHECKOUT_URL = 'https://ohmyapps.lemonsqueezy.com/checkout/buy/02f83483-8f23-408f-b960-fc550819ac44';
export const LEMONSQUEEZY_SUBSCRIPTION_URL = 'https://ohmyapps.lemonsqueezy.com/checkout/buy/f8fe39be-3396-4184-aa0e-5b634e34b355';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activate-license`;

interface ActivateResponse {
  success: boolean;
  error?: string;
}

async function invokeFunction(body: Record<string, unknown>): Promise<ActivateResponse> {
  // Force a token refresh to avoid expired JWT being rejected by the Supabase gateway
  const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !session) return { success: false, error: 'Non authentifié' };

  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log('[activate-license]', res.status, data);
  return data as ActivateResponse;
}

export async function activateLicenseServer(
  key: string,
  instanceName: string,
): Promise<ActivateResponse> {
  try {
    return await invokeFunction({ license_key: key, instance_name: instanceName, action: 'activate' });
  } catch (err) {
    console.error('[activate-license] network error:', err);
    return { success: false, error: 'Impossible de contacter le serveur' };
  }
}

export async function deactivateLicenseServer(): Promise<ActivateResponse> {
  try {
    return await invokeFunction({ action: 'deactivate' });
  } catch (err) {
    console.error('[activate-license] network error:', err);
    return { success: false, error: 'Impossible de contacter le serveur' };
  }
}

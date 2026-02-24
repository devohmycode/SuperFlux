import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured =
  !!supabaseUrl && !!supabaseAnonKey && supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

// Create a real client only when configured; otherwise a dummy that will never be used.
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { flowType: 'pkce' },
    })
  : (null as unknown as SupabaseClient);

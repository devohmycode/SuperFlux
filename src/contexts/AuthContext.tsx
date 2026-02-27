import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (provider: 'google' | 'github') => Promise<void>;
  signOut: () => Promise<void>;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: isSupabaseConfigured,
  });

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({ user: session?.user ?? null, session, loading: false });
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, session, loading: false });
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signInWithOAuth = useCallback(async (provider: 'google' | 'github') => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        skipBrowserRedirect: true,
        redirectTo: 'http://localhost/auth/callback',
      },
    });
    if (error) throw error;
    if (!data.url) return;

    // Listen for the auth callback from the Tauri auth window
    const unlisten = await listen<string>('auth-callback', async (event) => {
      unlisten();
      // Close the auth window
      const authWindow = await WebviewWindow.getByLabel('auth');
      if (authWindow) await authWindow.close();

      // Extract PKCE code from callback URL and establish session
      try {
        const callbackUrl = new URL(event.payload);
        const code = callbackUrl.searchParams.get('code');
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          // Explicitly update auth state so downstream sync triggers immediately
          if (data.session) {
            setState({ user: data.session.user, session: data.session, loading: false });
          }
        }
      } catch (e) {
        console.error('[auth] Failed to exchange code:', e);
      }
    });

    // Open a separate Tauri window for the OAuth flow
    await invoke('open_auth_window', { url: data.url });
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    // Clear ALL user data from localStorage (every superflux_ key)
    const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith('superflux_'));
    keysToRemove.forEach(key => localStorage.removeItem(key));
    // Reload to reset all in-memory React state
    window.location.reload();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signInWithEmail,
        signUpWithEmail,
        signInWithOAuth,
        signOut,
        isConfigured: isSupabaseConfigured,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

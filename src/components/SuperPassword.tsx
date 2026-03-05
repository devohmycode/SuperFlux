import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lock, Settings, ShieldCheck, ArrowDownUp, X, Wand2 } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { PasswordVaultSetup } from './PasswordVaultSetup';
import { PasswordVaultUnlock } from './PasswordVaultUnlock';
import { PasswordEntryList } from './PasswordEntryList';
import { PasswordEntryDetail } from './PasswordEntryDetail';
import { PasswordAudit } from './PasswordAudit';
import { PasswordSettings } from './PasswordSettings';
import { PasswordImportExport } from './PasswordImportExport';
import { PasswordGenerator } from './PasswordGenerator';
import type {
  PasswordEntry,
  PasswordFolder,
  VaultSettings,
  UnlockResult,
} from './passwordTypes';
import { isPwSyncEnabled, uploadVault } from '../services/passwordSyncService';

type VaultState = 'no-vault' | 'locked' | 'unlocked';
type SidePanel = 'audit' | 'settings' | 'import-export' | 'generator' | null;

interface SuperPasswordProps {
  searchQuery: string;
  userId?: string | null;
}

const DEFAULT_SETTINGS: VaultSettings = {
  auto_lock_minutes: 5,
  clipboard_clear_seconds: 30,
  default_password_length: 20,
  default_password_options: {
    length: 20,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    exclude_ambiguous: false,
  },
};

export function SuperPassword({ searchQuery, userId }: SuperPasswordProps) {
  // ── State machine ──
  const [vaultState, setVaultState] = useState<VaultState>('locked');
  const [loading, setLoading] = useState(true);

  // ── Data ──
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [folders, setFolders] = useState<PasswordFolder[]>([]);
  const [settings, setSettings] = useState<VaultSettings>(DEFAULT_SETTINGS);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cloud sync helper (debounced 2s) ──
  const syncVaultToCloud = useCallback(() => {
    if (!userId || !isPwSyncEnabled()) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      try {
        const blob = await invoke<number[]>('pw_get_vault_blob');
        const meta = await invoke<number[]>('pw_get_vault_meta');
        await uploadVault(userId, blob, meta);
        window.dispatchEvent(new Event('pw-sync-done'));
      } catch (err) {
        console.error('[pw-sync] upload failed:', err);
      }
    }, 2000);
  }, [userId]);

  // Listen for toggle-on event from SourcePanel to trigger immediate sync
  useEffect(() => {
    const handler = () => {
      if (vaultState === 'unlocked') syncVaultToCloud();
    };
    window.addEventListener('pw-sync-toggled', handler);
    return () => window.removeEventListener('pw-sync-toggled', handler);
  }, [vaultState, syncVaultToCloud]);

  // ── Check vault existence on mount ──
  useEffect(() => {
    let active = true;
    setLoading(true);
    invoke<boolean>('pw_vault_exists')
      .then((exists) => {
        if (!active) return;
        if (exists) {
          setVaultState('locked');
        } else {
          setVaultState('no-vault');
        }
      })
      .catch(() => {
        if (active) setVaultState('no-vault');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  // ── Auto-lock polling ──
  useEffect(() => {
    if (vaultState !== 'unlocked') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const unlocked = await invoke<boolean>('pw_is_unlocked');
        if (!unlocked) {
          setVaultState('locked');
          setEntries([]);
          setFolders([]);
          setSelectedEntryId(null);
          setSidePanel(null);
        }
      } catch {
        // ignore
      }
    }, 30_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [vaultState]);

  // ── Load entries + folders ──
  const refreshData = useCallback(async () => {
    try {
      const [entryList, folderList] = await Promise.all([
        invoke<PasswordEntry[]>('pw_get_entries'),
        invoke<PasswordFolder[]>('pw_get_folders'),
      ]);
      setEntries(entryList);
      setFolders(folderList);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Erreur de chargement.');
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const s = await invoke<VaultSettings>('pw_get_settings');
      setSettings(s);
    } catch {
      // use defaults
    }
  }, []);

  // ── Vault created ──
  const handleVaultCreated = useCallback(async () => {
    setVaultState('unlocked');
    await refreshData();
    await loadSettings();
    syncVaultToCloud();
  }, [refreshData, loadSettings, syncVaultToCloud]);

  // ── Vault unlocked ──
  const handleVaultUnlocked = useCallback(
    async (_result: UnlockResult) => {
      setVaultState('unlocked');
      await refreshData();
      await loadSettings();
    },
    [refreshData, loadSettings],
  );

  // ── Lock vault ──
  const handleLock = useCallback(async () => {
    try {
      await invoke('pw_lock_vault');
    } catch {
      // ignore
    }
    setVaultState('locked');
    setEntries([]);
    setFolders([]);
    setSelectedEntryId(null);
    setSidePanel(null);
  }, []);

  // ── CRUD: Entries ──
  const handleAddEntry = useCallback(async () => {
    try {
      const newEntry = await invoke<PasswordEntry>('pw_add_entry', {
        entry: {
          id: '',
          title: 'Nouvelle entrée',
          username: '',
          password: '',
          tags: [],
          favorite: false,
          attachments: [],
          folder_id: selectedFolderId || undefined,
          created_at: '',
          updated_at: '',
          password_history: [],
        },
      });
      await refreshData();
      setSelectedEntryId(newEntry.id);
      syncVaultToCloud();
    } catch (err) {
      setError(typeof err === 'string' ? err : "Erreur lors de la création.");
    }
  }, [refreshData, selectedFolderId, syncVaultToCloud]);

  const handleUpdateEntry = useCallback(
    async (id: string, updates: Partial<PasswordEntry>) => {
      try {
        const current = entries.find((e) => e.id === id);
        if (!current) return;
        await invoke('pw_update_entry', { entry: { ...current, ...updates } });
        await refreshData();
        syncVaultToCloud();
      } catch (err) {
        setError(typeof err === 'string' ? err : 'Erreur lors de la mise à jour.');
      }
    },
    [refreshData, entries, syncVaultToCloud],
  );

  const handleDeleteEntry = useCallback(
    async (id: string) => {
      try {
        await invoke('pw_delete_entry', { id });
        if (selectedEntryId === id) setSelectedEntryId(null);
        await refreshData();
        syncVaultToCloud();
      } catch (err) {
        setError(typeof err === 'string' ? err : 'Erreur lors de la suppression.');
      }
    },
    [refreshData, selectedEntryId, syncVaultToCloud],
  );

  // ── Copy helpers ──
  const handleCopyPassword = useCallback(async (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      await navigator.clipboard.writeText(entry.password);
      // Auto-clear clipboard
      if (settings.clipboard_clear_seconds > 0) {
        setTimeout(async () => {
          try {
            const current = await navigator.clipboard.readText();
            if (current === entry.password) {
              await navigator.clipboard.writeText('');
            }
          } catch {
            // ignore
          }
        }, settings.clipboard_clear_seconds * 1000);
      }
    }
  }, [entries, settings.clipboard_clear_seconds]);

  const handleCopyUsername = useCallback(async (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      await navigator.clipboard.writeText(entry.username);
    }
  }, [entries]);

  // ── Folders ──
  const handleAddFolder = useCallback(
    async (name: string) => {
      try {
        await invoke('pw_add_folder', { folder: { id: '', name } });
        await refreshData();
        syncVaultToCloud();
      } catch (err) {
        setError(typeof err === 'string' ? err : 'Erreur lors de la création du dossier.');
      }
    },
    [refreshData, syncVaultToCloud],
  );

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      try {
        const currentFolder = folders.find((f) => f.id === id);
        await invoke('pw_update_folder', { folder: { ...currentFolder, id, name } });
        await refreshData();
        syncVaultToCloud();
      } catch (err) {
        setError(typeof err === 'string' ? err : 'Erreur lors du renommage.');
      }
    },
    [refreshData, folders, syncVaultToCloud],
  );

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      try {
        await invoke('pw_delete_folder', { id });
        if (selectedFolderId === id) setSelectedFolderId(null);
        await refreshData();
        syncVaultToCloud();
      } catch (err) {
        setError(typeof err === 'string' ? err : 'Erreur lors de la suppression du dossier.');
      }
    },
    [refreshData, selectedFolderId, syncVaultToCloud],
  );

  // ── Settings ──
  const handleSaveSettings = useCallback(
    async (newSettings: VaultSettings) => {
      try {
        await invoke('pw_update_settings', { settings: newSettings });
        setSettings(newSettings);
        syncVaultToCloud();
      } catch (err) {
        setError(typeof err === 'string' ? err : 'Erreur lors de la sauvegarde des paramètres.');
      }
    },
    [syncVaultToCloud],
  );

  // ── Audit entry select ──
  const handleAuditSelectEntry = useCallback((id: string) => {
    setSidePanel(null);
    setSelectedEntryId(id);
  }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (vaultState !== 'unlocked') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        handleAddEntry();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [vaultState, handleAddEntry]);

  // ── Selected entry object ──
  const selectedEntry = entries.find((e) => e.id === selectedEntryId) ?? null;

  // ── Loading screen ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <svg className="animate-spin h-8 w-8 text-[var(--accent)]" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  // ── No vault ──
  if (vaultState === 'no-vault') {
    return <PasswordVaultSetup onCreated={handleVaultCreated} />;
  }

  // ── Locked ──
  if (vaultState === 'locked') {
    return <PasswordVaultUnlock onUnlocked={handleVaultUnlocked} />;
  }

  // ── Unlocked: main UI ──
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          <Lock size={13} className="text-[var(--accent)]" />
          <span>{entries.length} entrée{entries.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setSidePanel(sidePanel === 'generator' ? null : 'generator')}
          title="Générateur"
        >
          <Wand2 size={13} />
          Générer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setSidePanel(sidePanel === 'audit' ? null : 'audit')}
          title="Audit de sécurité"
        >
          <ShieldCheck size={13} />
          Audit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setSidePanel(sidePanel === 'import-export' ? null : 'import-export')}
          title="Import / Export"
        >
          <ArrowDownUp size={13} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setSidePanel(sidePanel === 'settings' ? null : 'settings')}
          title="Paramètres"
        >
          <Settings size={13} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-amber-500 hover:text-amber-400"
          onClick={handleLock}
          title="Verrouiller"
        >
          <Lock size={13} />
          Verrouiller
        </Button>
      </div>

      {/* Error toast */}
      {error && (
        <div
          className="mx-3 mt-2 text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2 cursor-pointer"
          onClick={() => setError(null)}
        >
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Side panel (audit/settings/import-export/generator) */}
        {sidePanel && (
          <div className="w-80 border-r border-[var(--border-default)] flex flex-col shrink-0 overflow-hidden">
            {sidePanel === 'audit' && (
              <PasswordAudit
                onClose={() => setSidePanel(null)}
                onSelectEntry={handleAuditSelectEntry}
              />
            )}
            {sidePanel === 'settings' && (
              <PasswordSettings
                onClose={() => setSidePanel(null)}
                settings={settings}
                onSave={handleSaveSettings}
              />
            )}
            {sidePanel === 'import-export' && (
              <PasswordImportExport
                onClose={() => setSidePanel(null)}
                onImportDone={refreshData}
              />
            )}
            {sidePanel === 'generator' && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Générateur</h2>
                  <Button variant="ghost" size="icon" onClick={() => setSidePanel(null)}>
                    <X size={16} />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <PasswordGenerator
                    initialOptions={settings.default_password_options}
                    embedded
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Entry list */}
        <div className={cn(
          'border-r border-[var(--border-default)] flex flex-col shrink-0 overflow-hidden',
          sidePanel ? 'w-64' : 'w-80',
        )}>
          <PasswordEntryList
            entries={entries}
            folders={folders}
            selectedEntryId={selectedEntryId}
            selectedFolderId={selectedFolderId}
            searchQuery={searchQuery}
            onSelectEntry={setSelectedEntryId}
            onSelectFolder={setSelectedFolderId}
            onAddEntry={handleAddEntry}
            onDeleteEntry={handleDeleteEntry}
            onCopyPassword={handleCopyPassword}
            onCopyUsername={handleCopyUsername}
            onAddFolder={handleAddFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
          />
        </div>

        {/* Entry detail */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedEntry ? (
            <PasswordEntryDetail
              entry={selectedEntry}
              folders={folders}
              onUpdate={handleUpdateEntry}
              onDelete={handleDeleteEntry}
              onCopyPassword={handleCopyPassword}
              onCopyUsername={handleCopyUsername}
              isNew={selectedEntry.title === 'Nouvelle entrée' && !selectedEntry.username && !selectedEntry.password}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-tertiary)]">
              <Lock size={40} strokeWidth={1.5} />
              <p className="text-sm">Sélectionnez une entrée</p>
              <p className="text-xs">ou appuyez sur <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-[10px] font-mono">Ctrl+N</kbd> pour en créer une</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center px-3 py-1.5 border-t border-[var(--border-default)] text-[10px] text-[var(--text-tertiary)]">
        <div className="flex items-center gap-3">
          <span>🔐 SuperPassword</span>
          <span>{entries.length} entrée{entries.length !== 1 ? 's' : ''}</span>
          <span>{folders.length} dossier{folders.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <span>
            <kbd className="px-1 py-0.5 rounded bg-[var(--bg-elevated)] font-mono">Ctrl+N</kbd> Nouvelle entrée
          </span>
        </div>
      </div>
    </div>
  );
}


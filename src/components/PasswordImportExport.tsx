import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Upload, Download, FileUp, Shield } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface PasswordImportExportProps {
  onClose: () => void;
  onImportDone: () => void;
}

type ImportFormat = 'chrome' | 'bitwarden' | 'firefox' | 'generic';
type Tab = 'import' | 'export';

const FORMAT_OPTIONS: { value: ImportFormat; label: string; description: string }[] = [
  { value: 'chrome', label: 'Google Chrome', description: 'Fichier CSV exporté depuis Chrome' },
  { value: 'bitwarden', label: 'Bitwarden', description: 'Fichier CSV exporté depuis Bitwarden' },
  { value: 'firefox', label: 'Firefox', description: 'Fichier CSV exporté depuis Firefox' },
  { value: 'generic', label: 'CSV Générique', description: 'Colonnes : title, url, username, password' },
];

export function PasswordImportExport({ onClose, onImportDone }: PasswordImportExportProps) {
  const [tab, setTab] = useState<Tab>('import');
  const [format, setFormat] = useState<ImportFormat>('chrome');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vaultInputRef = useRef<HTMLInputElement>(null);

  // ── Import CSV ──
  const handleImportCsv = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const text = await file.text();
      const count = await invoke<number>('pw_import_csv', { csvContent: text, format });
      setSuccess(`${count} entrée${count > 1 ? 's' : ''} importée${count > 1 ? 's' : ''} avec succès.`);
      onImportDone();
    } catch (err) {
      setError(typeof err === 'string' ? err : "Erreur lors de l'import.");
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }, [format, onImportDone]);

  // ── Export CSV ──
  const handleExportCsv = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const csv = await invoke<string>('pw_export_csv');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'superpassword-export.csv';
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('Export CSV téléchargé.');
    } catch (err) {
      setError(typeof err === 'string' ? err : "Erreur lors de l'export.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Export encrypted vault ──
  const handleExportVault = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const blob64 = await invoke<string>('pw_get_vault_blob');
      const binary = atob(blob64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'superpassword-vault.spvault';
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('Coffre-fort chiffré exporté.');
    } catch (err) {
      setError(typeof err === 'string' ? err : "Erreur lors de l'export.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Import encrypted vault ──
  const handleImportVault = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const blob64 = btoa(binary);
      await invoke('pw_import_vault_blob', { data: blob64 });
      setSuccess('Coffre-fort importé avec succès.');
      onImportDone();
    } catch (err) {
      setError(typeof err === 'string' ? err : "Erreur lors de l'import du coffre-fort.");
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }, [onImportDone]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Import / Export</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-default)]">
        <button
          className={cn(
            'flex-1 py-2.5 text-xs font-medium text-center transition-colors',
            tab === 'import'
              ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
          )}
          onClick={() => { setTab('import'); setError(null); setSuccess(null); }}
        >
          <Upload size={14} className="inline-block mr-1.5 -mt-0.5" />
          Importer
        </button>
        <button
          className={cn(
            'flex-1 py-2.5 text-xs font-medium text-center transition-colors',
            tab === 'export'
              ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
          )}
          onClick={() => { setTab('export'); setError(null); setSuccess(null); }}
        >
          <Download size={14} className="inline-block mr-1.5 -mt-0.5" />
          Exporter
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'import' && (
          <>
            {/* CSV Import */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Importer depuis un CSV
              </h3>

              {/* Format selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-secondary)]">Format source</label>
                <div className="grid gap-2">
                  {FORMAT_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                        format === opt.value
                          ? 'border-[var(--accent)] bg-[var(--accent-glow)]'
                          : 'border-[var(--border-default)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <input
                        type="radio"
                        name="import-format"
                        value={opt.value}
                        checked={format === opt.value}
                        onChange={() => setFormat(opt.value)}
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">{opt.label}</div>
                        <div className="text-xs text-[var(--text-tertiary)]">{opt.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleImportCsv}
              />
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                <FileUp size={16} />
                {loading ? 'Import en cours...' : 'Choisir un fichier CSV'}
              </Button>
            </div>

            {/* Separator */}
            <div className="border-t border-[var(--border-default)]" />

            {/* Vault Import */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Importer un coffre-fort chiffré
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                Importez un fichier .spvault exporté depuis SuperPassword.
              </p>
              <input
                ref={vaultInputRef}
                type="file"
                accept=".spvault"
                className="hidden"
                onChange={handleImportVault}
              />
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => vaultInputRef.current?.click()}
                disabled={loading}
              >
                <Shield size={16} />
                {loading ? 'Import en cours...' : 'Choisir un fichier .spvault'}
              </Button>
            </div>
          </>
        )}

        {tab === 'export' && (
          <>
            {/* CSV Export */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Exporter en CSV
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                Exporte tous vos identifiants en texte clair. Utilisez avec prudence.
              </p>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleExportCsv}
                disabled={loading}
              >
                <Download size={16} />
                {loading ? 'Export en cours...' : 'Télécharger le CSV'}
              </Button>
            </div>

            {/* Separator */}
            <div className="border-t border-[var(--border-default)]" />

            {/* Encrypted Export */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Exporter le coffre-fort chiffré
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                Crée une sauvegarde chiffrée compatible avec SuperPassword.
              </p>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleExportVault}
                disabled={loading}
              >
                <Shield size={16} />
                {loading ? 'Export en cours...' : 'Télécharger le coffre-fort chiffré'}
              </Button>
            </div>
          </>
        )}

        {/* Feedback */}
        {error && (
          <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-500 bg-green-500/10 rounded-lg px-3 py-2">{success}</p>
        )}
      </div>
    </div>
  );
}

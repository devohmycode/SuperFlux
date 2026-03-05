import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { invoke } from '@tauri-apps/api/core';
import {
  Eye, EyeOff, Copy, Check, ExternalLink, Star, Trash2,
  Pencil, X, Plus, ChevronDown, ChevronRight, Paperclip, Wand2,
} from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { TotpDisplay } from './TotpDisplay';
import { PasswordGenerator } from './PasswordGenerator';
import type { PasswordEntry, PasswordFolder } from './passwordTypes';

interface PasswordEntryDetailProps {
  entry: PasswordEntry;
  folders: PasswordFolder[];
  onUpdate: (id: string, updates: Partial<PasswordEntry>) => void;
  onDelete: (id: string) => void;
  onCopyPassword: (id: string) => void;
  onCopyUsername: (id: string) => void;
  isNew?: boolean;
}

function getStrengthFromPassword(pw: string): { labelKey: string; color: string; percent: number } {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1;
  const percent = Math.min((score / 6) * 100, 100);
  if (score <= 2) return { labelKey: 'password.weak', color: 'bg-red-500', percent };
  if (score <= 4) return { labelKey: 'password.medium', color: 'bg-amber-500', percent };
  return { labelKey: 'password.strong', color: 'bg-green-500', percent };
}

export function PasswordEntryDetail({
  entry,
  folders,
  onUpdate,
  onDelete,
  onCopyPassword,
  onCopyUsername,
  isNew,
}: PasswordEntryDetailProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(isNew ?? false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Editable fields
  const [title, setTitle] = useState(entry.title);
  const [url, setUrl] = useState(entry.url || '');
  const [username, setUsername] = useState(entry.username);
  const [password, setPassword] = useState(entry.password);
  const [notes, setNotes] = useState(entry.notes || '');
  const [totpSecret, setTotpSecret] = useState(entry.totp_secret || '');
  const [tags, setTags] = useState(entry.tags.join(', '));
  const [folderId, setFolderId] = useState(entry.folder_id || '');
  const [favorite, setFavorite] = useState(entry.favorite);

  const attachFileRef = useRef<HTMLInputElement>(null);

  // Reset form when entry changes
  useEffect(() => {
    setTitle(entry.title);
    setUrl(entry.url || '');
    setUsername(entry.username);
    setPassword(entry.password);
    setNotes(entry.notes || '');
    setTotpSecret(entry.totp_secret || '');
    setTags(entry.tags.join(', '));
    setFolderId(entry.folder_id || '');
    setFavorite(entry.favorite);
    setEditing(isNew ?? false);
    setShowPassword(false);
    setConfirmDelete(false);
    setShowGenerator(false);
    setShowHistory(false);
  }, [entry.id]);

  const handleCopy = useCallback(async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const handleSave = useCallback(() => {
    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    onUpdate(entry.id, {
      title,
      url: url || undefined,
      username,
      password,
      notes: notes || undefined,
      totp_secret: totpSecret || undefined,
      tags: parsedTags,
      folder_id: folderId || undefined,
      favorite,
    });
    setEditing(false);
  }, [entry.id, title, url, username, password, notes, totpSecret, tags, folderId, favorite, onUpdate]);

  const handleCancel = useCallback(() => {
    setTitle(entry.title);
    setUrl(entry.url || '');
    setUsername(entry.username);
    setPassword(entry.password);
    setNotes(entry.notes || '');
    setTotpSecret(entry.totp_secret || '');
    setTags(entry.tags.join(', '));
    setFolderId(entry.folder_id || '');
    setFavorite(entry.favorite);
    setEditing(false);
    setShowGenerator(false);
  }, [entry]);

  const handleToggleFavorite = useCallback(() => {
    const next = !favorite;
    setFavorite(next);
    if (!editing) {
      onUpdate(entry.id, { favorite: next });
    }
  }, [favorite, editing, entry.id, onUpdate]);

  const handleOpenUrl = useCallback(async () => {
    if (!url) return;
    try {
      await invoke('open_external', { url });
    } catch {
      window.open(url, '_blank');
    }
  }, [url]);

  const handleGeneratedPassword = useCallback((pw: string) => {
    setPassword(pw);
    setShowGenerator(false);
  }, []);

  const handleAttachFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const data = btoa(binary);
      const newAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        data,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
      };
      onUpdate(entry.id, {
        attachments: [...entry.attachments, newAttachment],
      });
    } catch {
      // ignore
    }
    e.target.value = '';
  }, [entry.id, entry.attachments, onUpdate]);

  const handleDeleteAttachment = useCallback(
    (attachId: string) => {
      onUpdate(entry.id, {
        attachments: entry.attachments.filter((a) => a.id !== attachId),
      });
    },
    [entry.id, entry.attachments, onUpdate],
  );

  const pwStrength = getStrengthFromPassword(password);

  const inputClasses = cn(
    'w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors',
    'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]',
    'focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]',
    'placeholder:text-[var(--text-tertiary)]',
    'disabled:opacity-60 disabled:cursor-default',
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
        <h2 className="flex-1 text-sm font-semibold text-[var(--text-primary)] truncate">
          {entry.title || t('password.newEntry')}
        </h2>
        <button
          onClick={handleToggleFavorite}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            favorite
              ? 'text-amber-400 hover:bg-amber-400/10'
              : 'text-[var(--text-tertiary)] hover:text-amber-400 hover:bg-[var(--bg-hover)]',
          )}
          title={favorite ? t('password.removeFromFavorites') : t('password.addToFavorites')}
        >
          <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
            <Pencil size={13} /> {t('common.edit')}
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X size={13} />
            </Button>
            <Button size="sm" onClick={handleSave}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title */}
        <FieldRow label={t('password.titleLabel')}>
          <input
            type="text"
            className={inputClasses}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!editing}
            placeholder={t('password.entryTitle')}
          />
        </FieldRow>

        {/* URL */}
        <FieldRow label="URL">
          <div className="flex gap-1.5">
            <input
              type="text"
              className={cn(inputClasses, 'flex-1')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!editing}
              placeholder="https://..."
            />
            {url && !editing && (
              <Button variant="ghost" size="icon" onClick={handleOpenUrl} title={t('common.open')}>
                <ExternalLink size={14} />
              </Button>
            )}
          </div>
        </FieldRow>

        {/* Username */}
        <FieldRow label={t('password.usernameLabel')}>
          <div className="flex gap-1.5">
            <input
              type="text"
              className={cn(inputClasses, 'flex-1')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={!editing}
              placeholder="utilisateur@email.com"
            />
            {!editing && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { handleCopy(username, 'username'); onCopyUsername(entry.id); }}
                title={t('password.copy')}
              >
                {copiedField === 'username' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </Button>
            )}
          </div>
        </FieldRow>

        {/* Password */}
        <FieldRow label={t('password.passwordLabel')}>
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={cn(inputClasses, 'pr-10')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!editing}
                  placeholder={t('password.passwordLabel')}
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {!editing && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { handleCopy(password, 'password'); onCopyPassword(entry.id); }}
                  title={t('password.copy')}
                >
                  {copiedField === 'password' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </Button>
              )}
              {editing && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowGenerator(!showGenerator)}
                  title={t('common.generate')}
                >
                  <Wand2 size={14} />
                </Button>
              )}
            </div>
            {/* Strength indicator */}
            {password && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-300', pwStrength.color)}
                    style={{ width: `${pwStrength.percent}%` }}
                  />
                </div>
                <span className={cn(
                  'text-[10px]',
                  pwStrength.percent <= 33 ? 'text-red-500' : pwStrength.percent <= 66 ? 'text-amber-500' : 'text-green-500',
                )}>
                  {t(pwStrength.labelKey)}
                </span>
              </div>
            )}
          </div>
        </FieldRow>

        {/* Inline generator */}
        {showGenerator && editing && (
          <div className="border border-[var(--border-default)] rounded-lg overflow-hidden">
            <PasswordGenerator onGenerate={handleGeneratedPassword} embedded />
          </div>
        )}

        {/* TOTP */}
        <FieldRow label="TOTP">
          {editing ? (
            <input
              type="text"
              className={inputClasses}
              value={totpSecret}
              onChange={(e) => setTotpSecret(e.target.value)}
              placeholder="Secret TOTP (base32)"
            />
          ) : entry.totp_secret ? (
            <TotpDisplay entryId={entry.id} />
          ) : (
            <span className="text-xs text-[var(--text-tertiary)]">{t('password.notConfigured')}</span>
          )}
        </FieldRow>

        {/* Notes */}
        <FieldRow label="Notes">
          <textarea
            className={cn(inputClasses, 'min-h-[80px] resize-y')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!editing}
            placeholder={t('password.privateNotes')}
          />
        </FieldRow>

        {/* Tags */}
        <FieldRow label="Tags">
          <input
            type="text"
            className={inputClasses}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            disabled={!editing}
            placeholder="tag1, tag2, tag3"
          />
        </FieldRow>

        {/* Folder */}
        <FieldRow label={t('common.folder')}>
          {editing ? (
            <select
              className={inputClasses}
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
            >
              <option value="">{t('common.noFolder')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-[var(--text-primary)]">
              {folders.find((f) => f.id === entry.folder_id)?.name || t('password.none')}
            </span>
          )}
        </FieldRow>

        {/* Divider */}
        <div className="border-t border-[var(--border-subtle)]" />

        {/* Password history */}
        {entry.password_history.length > 0 && (
          <div>
            <button
              className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t('password.passwordHistory')} ({entry.password_history.length})
            </button>
            {showHistory && (
              <div className="mt-2 space-y-1.5">
                {entry.password_history.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--bg-elevated)]"
                  >
                    <code className="flex-1 text-xs font-mono text-[var(--text-secondary)] truncate">
                      {'*'.repeat(Math.min(h.password.length, 20))}
                    </code>
                    <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                      {new Date(h.changed_at).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US')}
                    </span>
                    <button
                      onClick={() => handleCopy(h.password, `history-${i}`)}
                      className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    >
                      {copiedField === `history-${i}` ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Attachments */}
        <div>
          <button
            className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            onClick={() => setShowAttachments(!showAttachments)}
          >
            {showAttachments ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Paperclip size={12} />
            {t('password.attachments')} ({entry.attachments.length})
          </button>
          {showAttachments && (
            <div className="mt-2 space-y-1.5">
              {entry.attachments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--bg-elevated)]"
                >
                  <Paperclip size={12} className="text-[var(--text-tertiary)] shrink-0" />
                  <span className="flex-1 text-xs text-[var(--text-primary)] truncate">{a.name}</span>
                  <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                    {a.size < 1024 ? `${a.size} o` : `${(a.size / 1024).toFixed(1)} Ko`}
                  </span>
                  {editing && (
                    <button
                      onClick={() => handleDeleteAttachment(a.id)}
                      className="text-red-500 hover:text-red-400 shrink-0"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              {editing && (
                <>
                  <input
                    ref={attachFileRef}
                    type="file"
                    className="hidden"
                    onChange={handleAttachFile}
                  />
                  <button
                    onClick={() => attachFileRef.current?.click()}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs transition-colors',
                      'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                      'border border-dashed border-[var(--border-default)]',
                    )}
                  >
                    <Plus size={12} /> {t('password.addAttachment')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="border-t border-[var(--border-subtle)] pt-3 space-y-1">
          <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
            <span>{t('password.createdAt')}</span>
            <span>{new Date(entry.created_at).toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-US')}</span>
          </div>
          <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
            <span>{t('password.modifiedAt')}</span>
            <span>{new Date(entry.updated_at).toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-US')}</span>
          </div>
        </div>

        {/* Delete */}
        <div className="border-t border-[var(--border-subtle)] pt-3">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-500">{t('password.confirmDelete')}</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(entry.id)}
              >
                {t('common.delete')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-400 hover:bg-red-500/10 gap-1.5"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={13} /> {t('password.deleteEntry')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Field row layout ──

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

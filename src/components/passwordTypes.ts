// ── SuperPassword shared types ──

export interface PasswordEntry {
  id: string;
  folder_id?: string;
  title: string;
  url?: string;
  username: string;
  password: string;
  notes?: string;
  totp_secret?: string;
  tags: string[];
  favorite: boolean;
  attachments: Attachment[];
  created_at: string;
  updated_at: string;
  password_history: { password: string; changed_at: string }[];
}

export interface PasswordFolder {
  id: string;
  name: string;
  icon?: string;
  parent_id?: string;
}

export interface VaultSettings {
  auto_lock_minutes: number;
  clipboard_clear_seconds: number;
  default_password_length: number;
  default_password_options: PasswordGenOptions;
}

export interface PasswordGenOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  exclude_ambiguous: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  data: string;
  mime_type: string;
  size: number;
}

export interface TotpResult {
  code: string;
  remaining_seconds: number;
}

export interface AuditResult {
  weak_passwords: AuditEntry[];
  duplicated_passwords: AuditEntry[][];
  old_passwords: AuditEntry[];
  score: number;
}

export interface AuditEntry {
  id: string;
  title: string;
  username: string;
  reason: string;
}

export interface UnlockResult {
  entry_count: number;
  folder_count: number;
}

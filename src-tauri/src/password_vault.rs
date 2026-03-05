use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::Argon2;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::Arc;
use tauri::State;
use zeroize::{Zeroize, Zeroizing};

// ── Data Model ───────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PasswordEntry {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub username: String,
    pub password: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totp_secret: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub password_history: Vec<PasswordHistoryEntry>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PasswordHistoryEntry {
    pub password: String,
    pub changed_at: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub data: String, // Base64 encoded
    pub mime_type: String,
    pub size: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PasswordFolder {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VaultSettings {
    pub auto_lock_minutes: u32,
    pub clipboard_clear_seconds: u32,
    pub default_password_length: u32,
    pub default_password_options: PasswordGenOptions,
}

impl Default for VaultSettings {
    fn default() -> Self {
        VaultSettings {
            auto_lock_minutes: 5,
            clipboard_clear_seconds: 30,
            default_password_length: 20,
            default_password_options: PasswordGenOptions::default(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PasswordGenOptions {
    pub length: u32,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub exclude_ambiguous: bool,
}

impl Default for PasswordGenOptions {
    fn default() -> Self {
        PasswordGenOptions {
            length: 20,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: true,
            exclude_ambiguous: false,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PasswordVault {
    pub version: u32,
    pub entries: Vec<PasswordEntry>,
    pub folders: Vec<PasswordFolder>,
    pub settings: VaultSettings,
}

impl PasswordVault {
    fn new() -> Self {
        PasswordVault {
            version: 1,
            entries: Vec::new(),
            folders: Vec::new(),
            settings: VaultSettings::default(),
        }
    }
}

/// Non-secret metadata stored alongside the vault
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VaultMeta {
    pub salt: Vec<u8>,
    pub verify_salt: Vec<u8>,
    pub verify_hash: Vec<u8>,
    pub entry_count: usize,
    pub folder_count: usize,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TotpResult {
    pub code: String,
    pub remaining_seconds: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AuditResult {
    pub weak_passwords: Vec<AuditEntry>,
    pub duplicated_passwords: Vec<Vec<AuditEntry>>,
    pub old_passwords: Vec<AuditEntry>,
    pub score: u32, // 0-100
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AuditEntry {
    pub id: String,
    pub title: String,
    pub username: String,
    pub reason: String,
}

// ── Crypto Functions ─────────────────────────────────────────────────

const ARGON2_MEM_COST: u32 = 65536; // 64 MB
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 32;

fn derive_key(password: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(ARGON2_MEM_COST, ARGON2_TIME_COST, ARGON2_PARALLELISM, Some(KEY_LEN))
            .map_err(|e| format!("Argon2 params error: {e}"))?,
    );

    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(password, salt, key.as_mut())
        .map_err(|e| format!("Argon2 derivation error: {e}"))?;
    Ok(key)
}

fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

fn encrypt_data(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("AES-256-GCM init error: {e}"))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption error: {e}"))?;

    // [nonce 12B][ciphertext + auth tag]
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);
    Ok(result)
}

fn decrypt_data(key: &[u8; KEY_LEN], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < NONCE_LEN + 16 {
        return Err("Encrypted data too short".into());
    }

    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("AES-256-GCM init error: {e}"))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed — wrong password or corrupted data".to_string())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Calculate password entropy in bits
fn password_entropy(password: &str) -> f64 {
    let mut charset_size: f64 = 0.0;
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password
        .chars()
        .any(|c| c.is_ascii_punctuation() || c == ' ');

    if has_lower {
        charset_size += 26.0;
    }
    if has_upper {
        charset_size += 26.0;
    }
    if has_digit {
        charset_size += 10.0;
    }
    if has_symbol {
        charset_size += 33.0;
    }

    if charset_size == 0.0 {
        return 0.0;
    }

    password.len() as f64 * charset_size.log2()
}

// ── Vault Store ──────────────────────────────────────────────────────

pub struct PasswordVaultStore {
    master_key: Mutex<Option<Zeroizing<[u8; KEY_LEN]>>>,
    vault: Mutex<Option<PasswordVault>>,
    meta: Mutex<Option<VaultMeta>>,
    data_dir: Mutex<Option<PathBuf>>,
    last_activity: Mutex<u64>,
}

impl PasswordVaultStore {
    pub fn new() -> Self {
        PasswordVaultStore {
            master_key: Mutex::new(None),
            vault: Mutex::new(None),
            meta: Mutex::new(None),
            data_dir: Mutex::new(None),
            last_activity: Mutex::new(now_millis()),
        }
    }

    pub fn set_data_dir(&self, dir: PathBuf) {
        let _ = std::fs::create_dir_all(&dir);
        *self.data_dir.lock().unwrap() = Some(dir);
        // Load meta if exists
        self.load_meta();
    }

    fn vault_path(&self) -> Option<PathBuf> {
        self.data_dir.lock().unwrap().as_ref().map(|d| d.join("vault.enc"))
    }

    fn meta_path(&self) -> Option<PathBuf> {
        self.data_dir.lock().unwrap().as_ref().map(|d| d.join("vault.meta"))
    }

    fn load_meta(&self) {
        if let Some(path) = self.meta_path() {
            if path.exists() {
                if let Ok(json) = std::fs::read_to_string(&path) {
                    if let Ok(meta) = serde_json::from_str::<VaultMeta>(&json) {
                        *self.meta.lock().unwrap() = Some(meta);
                        eprintln!("[password_vault] Meta loaded from disk");
                    }
                }
            }
        }
    }

    fn save_meta(&self) {
        if let Some(path) = self.meta_path() {
            if let Some(ref meta) = *self.meta.lock().unwrap() {
                if let Ok(json) = serde_json::to_string_pretty(meta) {
                    let _ = std::fs::write(&path, json);
                }
            }
        }
    }

    fn save_vault(&self) -> Result<(), String> {
        let key_guard = self.master_key.lock().unwrap();
        let key = key_guard.as_ref().ok_or("Vault is locked")?;

        let vault_guard = self.vault.lock().unwrap();
        let vault = vault_guard.as_ref().ok_or("No vault loaded")?;

        let json = serde_json::to_string(vault).map_err(|e| format!("Serialize error: {e}"))?;
        let encrypted = encrypt_data(&*key, json.as_bytes())?;

        // Update meta counts
        {
            let mut meta_guard = self.meta.lock().unwrap();
            if let Some(ref mut meta) = *meta_guard {
                meta.entry_count = vault.entries.len();
                meta.folder_count = vault.folders.len();
            }
        }
        self.save_meta();

        if let Some(path) = self.vault_path() {
            std::fs::write(&path, &encrypted)
                .map_err(|e| format!("Failed to write vault file: {e}"))?;
            eprintln!(
                "[password_vault] Vault saved ({} entries, {} folders)",
                vault.entries.len(),
                vault.folders.len()
            );
        }

        Ok(())
    }

    fn touch_activity(&self) {
        *self.last_activity.lock().unwrap() = now_millis();
    }

    fn is_unlocked(&self) -> bool {
        self.master_key.lock().unwrap().is_some()
    }

    fn vault_exists(&self) -> bool {
        self.vault_path().map(|p| p.exists()).unwrap_or(false)
    }
}

impl Drop for PasswordVaultStore {
    fn drop(&mut self) {
        // Zeroize master key on drop
        if let Ok(mut key) = self.master_key.lock() {
            if let Some(ref mut k) = *key {
                k.as_mut().zeroize();
            }
            *key = None;
        }
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn pw_vault_exists(state: State<'_, Arc<PasswordVaultStore>>) -> Result<bool, String> {
    Ok(state.vault_exists())
}

#[tauri::command]
pub fn pw_create_vault(
    password: String,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<bool, String> {
    if state.vault_exists() {
        return Err("Vault already exists".into());
    }

    let salt = generate_salt();
    let verify_salt = generate_salt();

    let key = derive_key(password.as_bytes(), &salt)?;
    let verify_hash = derive_key(password.as_bytes(), &verify_salt)?;

    let vault = PasswordVault::new();
    let meta = VaultMeta {
        salt: salt.to_vec(),
        verify_salt: verify_salt.to_vec(),
        verify_hash: verify_hash.to_vec(),
        entry_count: 0,
        folder_count: 0,
    };

    *state.master_key.lock().unwrap() = Some(key);
    *state.vault.lock().unwrap() = Some(vault);
    *state.meta.lock().unwrap() = Some(meta);
    state.touch_activity();

    state.save_vault()?;

    eprintln!("[password_vault] New vault created");
    Ok(true)
}

#[derive(Serialize)]
pub struct UnlockResult {
    pub entry_count: usize,
    pub folder_count: usize,
}

#[tauri::command]
pub fn pw_unlock_vault(
    password: String,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<UnlockResult, String> {
    let meta_guard = state.meta.lock().unwrap();
    let meta = meta_guard.as_ref().ok_or("No vault found")?;

    // Verify password
    let verify_hash = derive_key(password.as_bytes(), &meta.verify_salt)?;
    if verify_hash.as_ref() != meta.verify_hash.as_slice() {
        return Err("Wrong master password".into());
    }

    // Derive master key
    let key = derive_key(password.as_bytes(), &meta.salt)?;

    // Read and decrypt vault
    let vault_path = state.vault_path().ok_or("No data directory")?;
    let encrypted = std::fs::read(&vault_path).map_err(|e| format!("Read vault error: {e}"))?;
    let decrypted = decrypt_data(&*key, &encrypted)?;
    let vault: PasswordVault =
        serde_json::from_slice(&decrypted).map_err(|e| format!("Deserialize error: {e}"))?;

    let result = UnlockResult {
        entry_count: vault.entries.len(),
        folder_count: vault.folders.len(),
    };

    *state.master_key.lock().unwrap() = Some(key);
    *state.vault.lock().unwrap() = Some(vault);
    state.touch_activity();

    eprintln!(
        "[password_vault] Vault unlocked ({} entries)",
        result.entry_count
    );
    Ok(result)
}

#[tauri::command]
pub fn pw_lock_vault(state: State<'_, Arc<PasswordVaultStore>>) -> Result<(), String> {
    // Save before locking
    if state.is_unlocked() {
        state.save_vault()?;
    }

    // Zeroize master key
    {
        let mut key_guard = state.master_key.lock().unwrap();
        if let Some(ref mut k) = *key_guard {
            k.as_mut().zeroize();
        }
        *key_guard = None;
    }
    *state.vault.lock().unwrap() = None;

    eprintln!("[password_vault] Vault locked");
    Ok(())
}

#[tauri::command]
pub fn pw_is_unlocked(state: State<'_, Arc<PasswordVaultStore>>) -> bool {
    state.is_unlocked()
}

#[tauri::command]
pub fn pw_get_entries(
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<Vec<PasswordEntry>, String> {
    state.touch_activity();
    let vault_guard = state.vault.lock().unwrap();
    let vault = vault_guard.as_ref().ok_or("Vault is locked")?;
    Ok(vault.entries.clone())
}

#[tauri::command]
pub fn pw_add_entry(
    mut entry: PasswordEntry,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<PasswordEntry, String> {
    state.touch_activity();
    let now = now_iso();
    if entry.id.is_empty() {
        entry.id = uuid::Uuid::new_v4().to_string();
    }
    entry.created_at = now.clone();
    entry.updated_at = now;

    {
        let mut vault_guard = state.vault.lock().unwrap();
        let vault = vault_guard.as_mut().ok_or("Vault is locked")?;
        vault.entries.push(entry.clone());
    }

    state.save_vault()?;
    eprintln!("[password_vault] Entry added: {}", entry.title);
    Ok(entry)
}

#[tauri::command]
pub fn pw_update_entry(
    mut entry: PasswordEntry,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<PasswordEntry, String> {
    state.touch_activity();
    entry.updated_at = now_iso();

    {
        let mut vault_guard = state.vault.lock().unwrap();
        let vault = vault_guard.as_mut().ok_or("Vault is locked")?;

        if let Some(existing) = vault.entries.iter().find(|e| e.id == entry.id) {
            // Track password history if password changed
            if existing.password != entry.password {
                entry.password_history.push(PasswordHistoryEntry {
                    password: existing.password.clone(),
                    changed_at: existing.updated_at.clone(),
                });
            }
        }

        if let Some(pos) = vault.entries.iter().position(|e| e.id == entry.id) {
            vault.entries[pos] = entry.clone();
        } else {
            return Err("Entry not found".into());
        }
    }

    state.save_vault()?;
    Ok(entry)
}

#[tauri::command]
pub fn pw_delete_entry(
    id: String,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<(), String> {
    state.touch_activity();

    {
        let mut vault_guard = state.vault.lock().unwrap();
        let vault = vault_guard.as_mut().ok_or("Vault is locked")?;
        vault.entries.retain(|e| e.id != id);
    }

    state.save_vault()?;
    eprintln!("[password_vault] Entry deleted: {id}");
    Ok(())
}

#[tauri::command]
pub fn pw_get_folders(
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<Vec<PasswordFolder>, String> {
    state.touch_activity();
    let vault_guard = state.vault.lock().unwrap();
    let vault = vault_guard.as_ref().ok_or("Vault is locked")?;
    Ok(vault.folders.clone())
}

#[tauri::command]
pub fn pw_add_folder(
    mut folder: PasswordFolder,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<PasswordFolder, String> {
    state.touch_activity();
    if folder.id.is_empty() {
        folder.id = uuid::Uuid::new_v4().to_string();
    }

    {
        let mut vault_guard = state.vault.lock().unwrap();
        let vault = vault_guard.as_mut().ok_or("Vault is locked")?;
        vault.folders.push(folder.clone());
    }

    state.save_vault()?;
    Ok(folder)
}

#[tauri::command]
pub fn pw_update_folder(
    folder: PasswordFolder,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<PasswordFolder, String> {
    state.touch_activity();

    {
        let mut vault_guard = state.vault.lock().unwrap();
        let vault = vault_guard.as_mut().ok_or("Vault is locked")?;

        if let Some(pos) = vault.folders.iter().position(|f| f.id == folder.id) {
            vault.folders[pos] = folder.clone();
        } else {
            return Err("Folder not found".into());
        }
    }

    state.save_vault()?;
    Ok(folder)
}

#[tauri::command]
pub fn pw_delete_folder(
    id: String,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<(), String> {
    state.touch_activity();

    {
        let mut vault_guard = state.vault.lock().unwrap();
        let vault = vault_guard.as_mut().ok_or("Vault is locked")?;
        // Move entries in this folder to root
        for entry in &mut vault.entries {
            if entry.folder_id.as_deref() == Some(&id) {
                entry.folder_id = None;
            }
        }
        vault.folders.retain(|f| f.id != id);
    }

    state.save_vault()?;
    Ok(())
}

#[tauri::command]
pub fn pw_generate_password(options: PasswordGenOptions) -> Result<String, String> {
    let mut charset = Vec::new();

    let lower: Vec<u8> = if options.exclude_ambiguous {
        b"abcdefghjkmnpqrstuvwxyz".to_vec() // no l
    } else {
        b"abcdefghijklmnopqrstuvwxyz".to_vec()
    };
    let upper: Vec<u8> = if options.exclude_ambiguous {
        b"ABCDEFGHJKMNPQRSTUVWXYZ".to_vec() // no I, O
    } else {
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZ".to_vec()
    };
    let digits: Vec<u8> = if options.exclude_ambiguous {
        b"23456789".to_vec() // no 0, 1
    } else {
        b"0123456789".to_vec()
    };
    let symbols: Vec<u8> = b"!@#$%^&*()-_=+[]{}|;:,.<>?/~".to_vec();

    if options.lowercase {
        charset.extend_from_slice(&lower);
    }
    if options.uppercase {
        charset.extend_from_slice(&upper);
    }
    if options.digits {
        charset.extend_from_slice(&digits);
    }
    if options.symbols {
        charset.extend_from_slice(&symbols);
    }

    if charset.is_empty() {
        return Err("At least one character set must be enabled".into());
    }

    let len = options.length.clamp(4, 128) as usize;
    let mut password = Vec::with_capacity(len);

    for _ in 0..len {
        let idx = (OsRng.next_u32() as usize) % charset.len();
        password.push(charset[idx]);
    }

    String::from_utf8(password).map_err(|e| format!("UTF-8 error: {e}"))
}

#[tauri::command]
pub fn pw_get_totp(
    entry_id: String,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<TotpResult, String> {
    state.touch_activity();
    let vault_guard = state.vault.lock().unwrap();
    let vault = vault_guard.as_ref().ok_or("Vault is locked")?;

    let entry = vault
        .entries
        .iter()
        .find(|e| e.id == entry_id)
        .ok_or("Entry not found")?;
    let secret = entry
        .totp_secret
        .as_ref()
        .ok_or("No TOTP secret configured")?;

    let totp = if secret.starts_with("otpauth://") {
        totp_rs::TOTP::from_url(secret).map_err(|e| format!("TOTP URL error: {e}"))?
    } else {
        // Raw base32 secret
        let secret_bytes = totp_rs::Secret::Encoded(secret.clone())
            .to_bytes()
            .map_err(|e| format!("Invalid TOTP secret: {e}"))?;
        totp_rs::TOTP::new(
            totp_rs::Algorithm::SHA1,
            6,
            1,
            30,
            secret_bytes,
            None,
            "".to_string(),
        )
        .map_err(|e| format!("TOTP init error: {e}"))?
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let code = totp.generate(now);
    let remaining = 30 - (now % 30);

    Ok(TotpResult {
        code,
        remaining_seconds: remaining,
    })
}

#[tauri::command]
pub fn pw_copy_to_clipboard(text: String) -> Result<(), String> {
    crate::clipboard::write_clipboard_text(&text).map_err(|e| format!("Clipboard error: {e}"))?;

    // Spawn a thread to clear clipboard after 30 seconds
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30));
        let _ = crate::clipboard::write_clipboard_text("");
        eprintln!("[password_vault] Clipboard auto-cleared");
    });

    Ok(())
}

#[tauri::command]
pub fn pw_change_master(
    old_pw: String,
    new_pw: String,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<bool, String> {
    // Verify old password
    {
        let meta_guard = state.meta.lock().unwrap();
        let meta = meta_guard.as_ref().ok_or("No vault found")?;
        let verify_hash = derive_key(old_pw.as_bytes(), &meta.verify_salt)?;
        if verify_hash.as_ref() != meta.verify_hash.as_slice() {
            return Err("Wrong current password".into());
        }
    }

    // Generate new salts and keys
    let new_salt = generate_salt();
    let new_verify_salt = generate_salt();
    let new_key = derive_key(new_pw.as_bytes(), &new_salt)?;
    let new_verify_hash = derive_key(new_pw.as_bytes(), &new_verify_salt)?;

    // Update meta
    {
        let mut meta_guard = state.meta.lock().unwrap();
        let meta = meta_guard.as_mut().ok_or("No vault found")?;
        meta.salt = new_salt.to_vec();
        meta.verify_salt = new_verify_salt.to_vec();
        meta.verify_hash = new_verify_hash.to_vec();
    }

    // Update master key
    *state.master_key.lock().unwrap() = Some(new_key);
    state.touch_activity();

    // Re-encrypt and save vault with new key
    state.save_vault()?;

    eprintln!("[password_vault] Master password changed");
    Ok(true)
}

#[tauri::command]
pub fn pw_audit_passwords(
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<AuditResult, String> {
    state.touch_activity();
    let vault_guard = state.vault.lock().unwrap();
    let vault = vault_guard.as_ref().ok_or("Vault is locked")?;

    let mut weak = Vec::new();
    let mut old = Vec::new();
    let mut pw_map: std::collections::HashMap<String, Vec<AuditEntry>> =
        std::collections::HashMap::new();

    let one_year_ago = chrono::Utc::now() - chrono::Duration::days(365);

    for entry in &vault.entries {
        let entropy = password_entropy(&entry.password);

        // Weak password check
        if entropy < 50.0 {
            weak.push(AuditEntry {
                id: entry.id.clone(),
                title: entry.title.clone(),
                username: entry.username.clone(),
                reason: format!("Entropy: {:.0} bits (< 50)", entropy),
            });
        }

        // Old password check
        if let Ok(date) = chrono::DateTime::parse_from_rfc3339(&entry.updated_at) {
            if date < one_year_ago {
                old.push(AuditEntry {
                    id: entry.id.clone(),
                    title: entry.title.clone(),
                    username: entry.username.clone(),
                    reason: format!("Last changed: {}", entry.updated_at),
                });
            }
        }

        // Track duplicates
        let audit_entry = AuditEntry {
            id: entry.id.clone(),
            title: entry.title.clone(),
            username: entry.username.clone(),
            reason: "Duplicated password".into(),
        };
        pw_map
            .entry(entry.password.clone())
            .or_default()
            .push(audit_entry);
    }

    let duplicated: Vec<Vec<AuditEntry>> = pw_map
        .into_values()
        .filter(|group| group.len() > 1)
        .collect();

    // Calculate score (0-100)
    let total = vault.entries.len().max(1) as f64;
    let issues = weak.len() as f64 + old.len() as f64 + duplicated.iter().map(|g| g.len()).sum::<usize>() as f64;
    let score = ((1.0 - issues / total / 3.0) * 100.0).clamp(0.0, 100.0) as u32;

    Ok(AuditResult {
        weak_passwords: weak,
        duplicated_passwords: duplicated,
        old_passwords: old,
        score,
    })
}

#[tauri::command]
pub fn pw_get_settings(
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<VaultSettings, String> {
    let vault_guard = state.vault.lock().unwrap();
    let vault = vault_guard.as_ref().ok_or("Vault is locked")?;
    Ok(vault.settings.clone())
}

#[tauri::command]
pub fn pw_update_settings(
    settings: VaultSettings,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<(), String> {
    state.touch_activity();

    {
        let mut vault_guard = state.vault.lock().unwrap();
        let vault = vault_guard.as_mut().ok_or("Vault is locked")?;
        vault.settings = settings;
    }

    state.save_vault()?;
    Ok(())
}

#[tauri::command]
pub fn pw_export_csv(
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<String, String> {
    state.touch_activity();
    let vault_guard = state.vault.lock().unwrap();
    let vault = vault_guard.as_ref().ok_or("Vault is locked")?;

    let mut wtr = csv::Writer::from_writer(Vec::new());
    wtr.write_record(["title", "url", "username", "password", "notes", "totp_secret"])
        .map_err(|e| format!("CSV write error: {e}"))?;

    for entry in &vault.entries {
        wtr.write_record([
            &entry.title,
            entry.url.as_deref().unwrap_or(""),
            &entry.username,
            &entry.password,
            entry.notes.as_deref().unwrap_or(""),
            entry.totp_secret.as_deref().unwrap_or(""),
        ])
        .map_err(|e| format!("CSV write error: {e}"))?;
    }

    let data = wtr.into_inner().map_err(|e| format!("CSV flush error: {e}"))?;
    String::from_utf8(data).map_err(|e| format!("UTF-8 error: {e}"))
}

#[tauri::command]
pub fn pw_import_csv(
    csv_content: String,
    format: String,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<u32, String> {
    state.touch_activity();

    let mut reader = csv::Reader::from_reader(csv_content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| format!("CSV parse error: {e}"))?
        .clone();

    // Map column indices based on format
    let (title_col, url_col, user_col, pass_col, notes_col) = match format.as_str() {
        "chrome" => {
            // Chrome CSV: name, url, username, password
            (find_col(&headers, "name"), find_col(&headers, "url"), find_col(&headers, "username"), find_col(&headers, "password"), None)
        }
        "bitwarden" => {
            // Bitwarden CSV: name, login_uri, login_username, login_password, notes
            (find_col(&headers, "name"), find_col(&headers, "login_uri"), find_col(&headers, "login_username"), find_col(&headers, "login_password"), find_col(&headers, "notes"))
        }
        "firefox" => {
            // Firefox CSV: url, username, password
            (find_col(&headers, "url"), find_col(&headers, "url"), find_col(&headers, "username"), find_col(&headers, "password"), None)
        }
        _ => {
            // Generic: title, url, username, password, notes
            (find_col(&headers, "title"), find_col(&headers, "url"), find_col(&headers, "username"), find_col(&headers, "password"), find_col(&headers, "notes"))
        }
    };

    let mut count = 0u32;
    let now = now_iso();

    let mut vault_guard = state.vault.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or("Vault is locked")?;

    for result in reader.records() {
        let record = result.map_err(|e| format!("CSV record error: {e}"))?;

        let title = title_col
            .and_then(|i| record.get(i))
            .unwrap_or("")
            .to_string();
        let url = url_col.and_then(|i| record.get(i)).map(|s| s.to_string());
        let username = user_col
            .and_then(|i| record.get(i))
            .unwrap_or("")
            .to_string();
        let password = pass_col
            .and_then(|i| record.get(i))
            .unwrap_or("")
            .to_string();
        let notes = notes_col.and_then(|i| record.get(i)).map(|s| s.to_string());

        if username.is_empty() && password.is_empty() {
            continue;
        }

        vault.entries.push(PasswordEntry {
            id: uuid::Uuid::new_v4().to_string(),
            folder_id: None,
            title: if title.is_empty() {
                url.clone().unwrap_or_else(|| "Imported".to_string())
            } else {
                title
            },
            url,
            username,
            password,
            notes,
            totp_secret: None,
            tags: vec!["imported".to_string()],
            favorite: false,
            attachments: Vec::new(),
            created_at: now.clone(),
            updated_at: now.clone(),
            password_history: Vec::new(),
        });
        count += 1;
    }

    drop(vault_guard);
    state.save_vault()?;

    eprintln!("[password_vault] Imported {count} entries from CSV ({format})");
    Ok(count)
}

fn find_col(headers: &csv::StringRecord, name: &str) -> Option<usize> {
    headers.iter().position(|h| h.eq_ignore_ascii_case(name))
}

#[tauri::command]
pub fn pw_get_vault_blob(
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<Vec<u8>, String> {
    let vault_path = state.vault_path().ok_or("No data directory")?;
    if !vault_path.exists() {
        return Err("No vault file".into());
    }
    std::fs::read(&vault_path).map_err(|e| format!("Read vault error: {e}"))
}

#[tauri::command]
pub fn pw_import_vault_blob(
    data: Vec<u8>,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<bool, String> {
    let vault_path = state.vault_path().ok_or("No data directory")?;
    std::fs::write(&vault_path, &data).map_err(|e| format!("Write vault error: {e}"))?;

    // Lock current vault — user must re-unlock with imported data
    *state.master_key.lock().unwrap() = None;
    *state.vault.lock().unwrap() = None;

    eprintln!("[password_vault] Vault blob imported ({} bytes)", data.len());
    Ok(true)
}

#[tauri::command]
pub fn pw_get_vault_meta(
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<Vec<u8>, String> {
    let meta_path = state.meta_path().ok_or("No data directory")?;
    if !meta_path.exists() {
        return Err("No vault meta file".into());
    }
    std::fs::read(&meta_path).map_err(|e| format!("Read vault meta error: {e}"))
}

#[tauri::command]
pub fn pw_import_vault_meta(
    data: Vec<u8>,
    state: State<'_, Arc<PasswordVaultStore>>,
) -> Result<bool, String> {
    let meta_path = state.meta_path().ok_or("No data directory")?;
    std::fs::write(&meta_path, &data).map_err(|e| format!("Write vault meta error: {e}"))?;

    // Reload meta from disk
    state.load_meta();

    eprintln!("[password_vault] Vault meta imported ({} bytes)", data.len());
    Ok(true)
}

// ── Auto-lock ────────────────────────────────────────────────────────

pub fn start_auto_lock_timer(store: std::sync::Arc<PasswordVaultStore>) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));

            if !store.is_unlocked() {
                continue;
            }

            let timeout_minutes = {
                let vault_guard = store.vault.lock().unwrap();
                vault_guard
                    .as_ref()
                    .map(|v| v.settings.auto_lock_minutes)
                    .unwrap_or(5)
            };

            if timeout_minutes == 0 {
                continue; // Auto-lock disabled
            }

            let last = *store.last_activity.lock().unwrap();
            let elapsed_ms = now_millis().saturating_sub(last);
            let timeout_ms = timeout_minutes as u64 * 60_000;

            if elapsed_ms > timeout_ms {
                // Save and lock
                let _ = store.save_vault();
                {
                    let mut key_guard = store.master_key.lock().unwrap();
                    if let Some(ref mut k) = *key_guard {
                        k.as_mut().zeroize();
                    }
                    *key_guard = None;
                }
                *store.vault.lock().unwrap() = None;
                eprintln!(
                    "[password_vault] Auto-locked after {} minutes of inactivity",
                    timeout_minutes
                );
            }
        }
    });
}

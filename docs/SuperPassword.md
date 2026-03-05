# SuperPassword Security Architecture

## Encryption

- **AES-256-GCM** authenticated encryption (confidentiality + integrity)
- Random 12-byte nonce generated for each encryption operation
- Ciphertext format: `[nonce 12B][ciphertext + auth tag]`
- The entire vault is encrypted as a single blob in `vault.enc`

## Key Derivation

- **Argon2id** (resistant to both GPU and side-channel attacks)
- Memory cost: **64 MB**
- Time cost: 3 iterations
- Parallelism: 4 threads
- Random 32-byte salt (separate salts for encryption key and verification hash)
- Derived key size: 256 bits

## Master Password

- **Never stored** on disk
- Verified via a separately derived hash (dedicated salt + Argon2id)
- Only the salts and verification hash are persisted in `vault.meta` (no secrets)

## Vault Storage

| File | Contents |
|------|----------|
| `vault.enc` | AES-256-GCM encrypted JSON blob containing all entries |
| `vault.meta` | Non-secret metadata: salts, verification hash, entry/folder counts |

Both files are stored in the Tauri app data directory (`<app_data_dir>/password_vault/`).

## Auto-Lock

- Configurable timeout (default: 5 minutes, range: 0-60 minutes, 0 = disabled)
- Background thread checks every 30 seconds for inactivity
- On lock, the master key is **zeroized** in memory using the `zeroize` crate
- The frontend clears all decrypted entries from React state
- Frontend polls `pw_is_unlocked` every 30 seconds to detect backend auto-lock

## Clipboard Security

- **Auto-clear after 30 seconds** (configurable via `clipboard_clear_seconds` setting)
- Both backend (native clipboard API) and frontend implement clearing
- Verifies clipboard content hasn't changed before clearing to avoid erasing unrelated data

## TOTP

- Secrets stored **encrypted** within the vault alongside password entries
- Codes generated server-side (Rust backend), temporary (30-second window)
- Supports both `otpauth://` URIs and raw base32 secrets
- Frontend refreshes the displayed code every second

## Frontend Security

- **No sensitive data in localStorage or sessionStorage**
- React state cleared on vault lock (`entries`, `folders` set to empty)
- Passwords masked by default (`type="password"` input)
- No sensitive data in URLs or query strings
- Entry IDs used for references, never actual passwords

## Security Summary

| Feature | Implementation |
|---------|---------------|
| Encryption | AES-256-GCM |
| Key Derivation | Argon2id (64 MB, 3 iterations, 4 threads) |
| Salt | 32 random bytes, separate salts for key and verification |
| Master Password | Not stored, verified via derived hash |
| At-Rest Encryption | Encrypted `vault.enc` file |
| Auto-Lock | Configurable timeout, key zeroized from memory |
| Memory Protection | `zeroize` crate for sensitive data |
| Clipboard | Auto-clear after configurable timeout |
| TOTP | Encrypted storage, temporary codes only |
| Frontend State | No persistent sensitive storage |

## Protected Against

- Dictionary attacks (64 MB Argon2id makes brute force impractical)
- Rainbow table attacks (random salt + strong KDF)
- GPU-accelerated attacks (memory-hard Argon2id)
- Side-channel attacks (Argon2id v0x13)
- Clipboard sniffing (auto-clear)
- Memory disclosure (zeroize on lock)
- Vault tampering (GCM authentication tag)

## Compliance

- OWASP Password Storage Guidelines
- NIST SP 800-63B (Authentication)
- Industry-standard encryption practices

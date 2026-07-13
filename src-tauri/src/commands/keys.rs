//! API-key storage.
//!
//! Design (the Chrome / VS Code / Electron `safeStorage` pattern): a single random
//! 256-bit master key lives in the OS credential store; the API keys themselves are
//! stored AES-256-GCM-encrypted in an app-data file. Rationale: on macOS every
//! *data read* of a keychain item triggers an ACL prompt when the binary changed
//! (every dev rebuild, every unsigned-app update). With one master-key item and an
//! in-process cache, the keychain is touched at most ONCE per app run — and not at
//! all on startup, since key *presence* is answered from the file alone.

use crate::logger;
use crate::subtitle::types::AppError;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Service name in the OS credential store.
const KEYRING_SERVICE: &str = "com.transcriptpro.app";
/// Account name of the single master-key entry.
const MASTER_ACCOUNT: &str = "master-key";
/// Encrypted key store, in the app-data dir.
const STORE_FILE: &str = "keys.enc.json";

/// Master key, fetched from the OS credential store at most once per app run.
static MASTER_KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);

/// Serializes all store operations. Without it, two concurrent commands (e.g. the
/// startup presence checks, doubled by React StrictMode in dev) can both run the
/// one-time migration and clobber each other's read-modify-write of the file.
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn store_lock() -> Result<std::sync::MutexGuard<'static, ()>, AppError> {
    STORE_LOCK
        .lock()
        .map_err(|_| AppError::Other("Key store lock poisoned".into()))
}

fn validate_provider(provider: &str) -> Result<(), AppError> {
    match provider {
        "gemini" | "claude" => Ok(()),
        other => Err(AppError::Other(format!(
            "Unknown API key provider: '{}'",
            other
        ))),
    }
}

// ── Encrypted store file ──────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct EncEntry {
    nonce: String, // hex, 12 bytes
    data: String,  // hex, AES-256-GCM ciphertext+tag
    // Unix seconds when the key was saved. Non-secret; lets the UI show "saved on
    // <date>" so the user can confirm which key is stored without exposing it.
    // Defaults to 0 for entries written before this field existed.
    #[serde(default)]
    saved_at: u64,
}

type KeyStore = BTreeMap<String, EncEntry>;

fn store_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| AppError::Other(e.to_string()))?
        .join(STORE_FILE))
}

fn write_store(app: &AppHandle, store: &KeyStore) -> Result<(), AppError> {
    use std::io::Write;
    let path = store_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::FileError(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| AppError::Other(format!("Key store serialize error: {}", e)))?;
    // Atomic + durable: write the sidecar, fsync it so the bytes hit disk before the
    // rename, then rename over the target. Without the fsync a crash right after the
    // rename could leave an empty/torn file that later parses as "no keys".
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| AppError::FileError(e.to_string()))?;
        f.write_all(json.as_bytes())
            .map_err(|e| AppError::FileError(e.to_string()))?;
        f.sync_all().map_err(|e| AppError::FileError(e.to_string()))?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| AppError::FileError(e.to_string()))
}

/// Load the store; `None` means the file doesn't exist yet (pre-envelope install
/// or fresh install) — callers use that to trigger the one-time migration. A file
/// that exists but doesn't parse (torn write, manual edit) is quarantined and
/// treated as absent, so a corrupt store never bricks all key operations — the
/// user can just re-enter their keys.
fn read_store(app: &AppHandle) -> Result<Option<KeyStore>, AppError> {
    let path = store_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(json) => match serde_json::from_str(&json) {
            Ok(store) => Ok(Some(store)),
            Err(e) => {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let quarantine = path.with_extension(format!("json.corrupt-{}", stamp));
                let _ = std::fs::rename(&path, &quarantine);
                logger::error(
                    app,
                    "keys",
                    format!("Key store unreadable ({}) — quarantined to {:?}", e, quarantine),
                );
                Ok(None)
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::FileError(e.to_string())),
    }
}

// ── Master key ────────────────────────────────────────────────────────────────

fn master_entry() -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(KEYRING_SERVICE, MASTER_ACCOUNT)
        .map_err(|e| AppError::Other(format!("Credential store unavailable: {}", e)))
}

/// Fetch (and cache) the master key. With `create`, a missing key is generated and
/// stored — creating an item never prompts; only reads of foreign-created items do.
fn master_key(create: bool) -> Result<Option<[u8; 32]>, AppError> {
    let mut cache = MASTER_KEY
        .lock()
        .map_err(|_| AppError::Other("Master key cache poisoned".into()))?;
    if let Some(key) = *cache {
        return Ok(Some(key));
    }

    let entry = master_entry()?;
    match entry.get_password() {
        Ok(hex_key) => {
            let bytes = hex::decode(hex_key.trim())
                .map_err(|e| AppError::Other(format!("Master key corrupt: {}", e)))?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| AppError::Other("Master key has wrong length".into()))?;
            *cache = Some(key);
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) if create => {
            let key: [u8; 32] = Aes256Gcm::generate_key(&mut OsRng).into();
            entry
                .set_password(&hex::encode(key))
                .map_err(|e| AppError::Other(format!("Failed to save master key: {}", e)))?;
            *cache = Some(key);
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(format!(
            "Failed to read the encryption key from the system credential store: {}",
            e
        ))),
    }
}

// ── Crypto helpers (pure — unit-tested below) ─────────────────────────────────

fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<EncEntry, AppError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let data = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| AppError::Other("Encryption failed".into()))?;
    Ok(EncEntry {
        nonce: hex::encode(nonce),
        data: hex::encode(data),
        saved_at: 0,
    })
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn decrypt(key: &[u8; 32], entry: &EncEntry) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce_bytes = hex::decode(&entry.nonce)
        .map_err(|e| AppError::Other(format!("Key store corrupt: {}", e)))?;
    let data = hex::decode(&entry.data)
        .map_err(|e| AppError::Other(format!("Key store corrupt: {}", e)))?;
    cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), data.as_ref())
        .map_err(|_| AppError::Other("Decryption failed (master key changed?)".into()))
}

// ── One-time migration from per-provider keychain entries ─────────────────────

/// Load the store, running the one-time migration if the file doesn't exist yet:
/// early keychain-era installs kept each API key as its own keychain entry, which
/// meant one macOS prompt per key per read. Move them into the encrypted file.
/// A denied prompt (any error other than NoEntry) aborts without writing the file,
/// so the migration retries on the next launch instead of dropping keys.
fn load_store_migrating(app: &AppHandle) -> Result<KeyStore, AppError> {
    if let Some(store) = read_store(app)? {
        return Ok(store);
    }

    let mut store = KeyStore::new();
    let mut migrated_entries: Vec<keyring::Entry> = Vec::new();
    for provider in ["gemini", "claude"] {
        let entry = keyring::Entry::new(KEYRING_SERVICE, provider)
            .map_err(|e| AppError::Other(format!("Credential store unavailable: {}", e)))?;
        match entry.get_password() {
            Ok(key) => {
                let master = master_key(true)?
                    .ok_or_else(|| AppError::Other("Master key unavailable".into()))?;
                store.insert(provider.to_string(), encrypt(&master, key.as_bytes())?);
                migrated_entries.push(entry);
            }
            Err(keyring::Error::NoEntry) => {}
            Err(e) => {
                return Err(AppError::Other(format!(
                    "Could not migrate the {} API key (denied credential prompt?): {}",
                    provider, e
                )))
            }
        }
    }
    // Persist FIRST, then delete the old keychain entries. Deleting before the
    // write meant a crash in between lost the key entirely (it was gone from the
    // keychain but never made it to the file).
    write_store(app, &store)?;
    for entry in migrated_entries {
        let _ = entry.delete_credential();
    }
    if !store.is_empty() {
        logger::info(app, "keys", "Migrated API key(s) to the encrypted key store");
    }
    Ok(store)
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Result of looking up a stored API key.
pub enum KeyLookup {
    /// No key stored for this provider.
    Missing,
    /// Key present and decrypted.
    Present(String),
    /// An entry exists but can't be decrypted — the master key was wiped/rotated
    /// (new machine, reset keychain). The ciphertext is unrecoverable; the user
    /// must re-enter the key. Distinguished from Missing so the UI can say so.
    Unreadable,
}

/// Read a provider's API key. Deliberately not a Tauri command — the key is
/// consumed backend-side (translation) and never crosses IPC back to the webview.
pub fn get_api_key(app: &AppHandle, provider: &str) -> Result<KeyLookup, AppError> {
    validate_provider(provider)?;
    let _lock = store_lock()?;
    let store = load_store_migrating(app)?;
    let Some(entry) = store.get(provider) else {
        return Ok(KeyLookup::Missing);
    };
    let Some(master) = master_key(false)? else {
        return Ok(KeyLookup::Unreadable);
    };
    match decrypt(&master, entry).and_then(|p| {
        String::from_utf8(p).map_err(|e| AppError::Other(format!("Key store corrupt: {}", e)))
    }) {
        Ok(key) => Ok(KeyLookup::Present(key)),
        Err(e) => {
            logger::error(app, "keys", format!("{} key present but undecryptable: {}", provider, e));
            Ok(KeyLookup::Unreadable)
        }
    }
}

/// Store (or overwrite) a provider's API key. An empty key removes the entry.
/// Sync command on purpose: Tauri runs it on the blocking thread pool, which is
/// where blocking file/credential-store IO belongs.
#[tauri::command]
pub fn set_api_key(app: AppHandle, provider: String, key: String) -> Result<(), AppError> {
    validate_provider(&provider)?;
    let _lock = store_lock()?;
    let key = key.trim();
    if key.is_empty() {
        return delete_impl(&app, &provider);
    }
    let mut store = load_store_migrating(&app)?;
    let master = master_key(true)?
        .ok_or_else(|| AppError::Other("Master key unavailable".into()))?;
    let mut entry = encrypt(&master, key.as_bytes())?;
    entry.saved_at = now_secs();
    store.insert(provider.clone(), entry);
    write_store(&app, &store)?;
    logger::info(
        &app,
        "keys",
        format!("{} API key saved to the encrypted key store", provider),
    );
    Ok(())
}

/// Remove a provider's API key.
#[tauri::command]
pub fn delete_api_key(app: AppHandle, provider: String) -> Result<(), AppError> {
    validate_provider(&provider)?;
    let _lock = store_lock()?;
    delete_impl(&app, &provider)
}

// Callers hold STORE_LOCK.
fn delete_impl(app: &AppHandle, provider: &str) -> Result<(), AppError> {
    let mut store = load_store_migrating(app)?;
    if store.remove(provider).is_some() {
        write_store(app, &store)?;
        logger::info(
            app,
            "keys",
            format!("{} API key removed from the encrypted key store", provider),
        );
    }
    Ok(())
}

/// Whether a provider has an API key stored. Answered from the store file alone —
/// no credential-store access, so app startup never triggers a keychain prompt.
#[tauri::command]
pub fn has_api_key(app: AppHandle, provider: String) -> Result<bool, AppError> {
    validate_provider(&provider)?;
    let _lock = store_lock()?;
    Ok(load_store_migrating(&app)?.contains_key(&provider))
}

/// Unix-seconds timestamp of when the stored key was saved (None if no key, or 0
/// for keys saved before the timestamp existed). Non-secret — the key never leaves
/// the backend; this just lets the UI show "saved on <date>".
#[tauri::command]
pub fn api_key_saved_at(app: AppHandle, provider: String) -> Result<Option<u64>, AppError> {
    validate_provider(&provider)?;
    let _lock = store_lock()?;
    Ok(load_store_migrating(&app)?
        .get(&provider)
        .map(|e| e.saved_at))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key: [u8; 32] = Aes256Gcm::generate_key(&mut OsRng).into();
        let entry = encrypt(&key, b"sk-ant-api03-secret").unwrap();
        assert_eq!(decrypt(&key, &entry).unwrap(), b"sk-ant-api03-secret");
    }

    #[test]
    fn test_decrypt_with_wrong_key_fails() {
        let key: [u8; 32] = Aes256Gcm::generate_key(&mut OsRng).into();
        let other: [u8; 32] = Aes256Gcm::generate_key(&mut OsRng).into();
        let entry = encrypt(&key, b"secret").unwrap();
        assert!(decrypt(&other, &entry).is_err());
    }

    #[test]
    fn test_nonces_are_unique_per_encryption() {
        let key: [u8; 32] = Aes256Gcm::generate_key(&mut OsRng).into();
        let a = encrypt(&key, b"same").unwrap();
        let b = encrypt(&key, b"same").unwrap();
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.data, b.data);
    }

    /// Round-trip against the real OS credential store, proving the platform
    /// backend (apple-native / windows-native) is actually enabled — with no
    /// backend feature, keyring silently falls back to an in-memory mock.
    /// Uses a dedicated service name so real app entries are never touched.
    #[test]
    fn test_keyring_roundtrip() {
        let entry = keyring::Entry::new("com.transcriptpro.app.test", "smoke")
            .expect("credential store unavailable");
        entry.set_password("s3cret").expect("set_password failed");
        assert_eq!(entry.get_password().unwrap(), "s3cret");
        entry.delete_credential().expect("delete_credential failed");
        assert!(matches!(
            entry.get_password(),
            Err(keyring::Error::NoEntry)
        ));
    }
}

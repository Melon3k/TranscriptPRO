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
    let path = store_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::FileError(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| AppError::Other(format!("Key store serialize error: {}", e)))?;
    // Atomic: write sidecar, then rename over the target.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| AppError::FileError(e.to_string()))?;
    std::fs::rename(&tmp, &path).map_err(|e| AppError::FileError(e.to_string()))
}

/// Load the store; `None` means the file doesn't exist yet (pre-envelope install
/// or fresh install) — callers use that to trigger the one-time migration.
fn read_store(app: &AppHandle) -> Result<Option<KeyStore>, AppError> {
    let path = store_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| AppError::Other(format!("Key store parse error: {}", e))),
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
    })
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
    for provider in ["gemini", "claude"] {
        let entry = keyring::Entry::new(KEYRING_SERVICE, provider)
            .map_err(|e| AppError::Other(format!("Credential store unavailable: {}", e)))?;
        match entry.get_password() {
            Ok(key) => {
                let master = master_key(true)?
                    .ok_or_else(|| AppError::Other("Master key unavailable".into()))?;
                store.insert(provider.to_string(), encrypt(&master, key.as_bytes())?);
                let _ = entry.delete_credential();
                logger::info(
                    app,
                    "keys",
                    format!("{} API key migrated to the encrypted key store", provider),
                );
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
    write_store(app, &store)?;
    Ok(store)
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Read a provider's API key. Deliberately not a Tauri command — the key is
/// consumed backend-side (translation) and never crosses IPC back to the webview.
pub fn get_api_key(app: &AppHandle, provider: &str) -> Result<Option<String>, AppError> {
    validate_provider(provider)?;
    let _lock = store_lock()?;
    let store = load_store_migrating(app)?;
    let Some(entry) = store.get(provider) else {
        return Ok(None);
    };
    let Some(master) = master_key(false)? else {
        // Entries exist but the master key is gone (keychain wiped) — the
        // ciphertexts are unrecoverable; the user has to re-enter the key.
        return Ok(None);
    };
    let plaintext = decrypt(&master, entry)?;
    String::from_utf8(plaintext)
        .map(Some)
        .map_err(|e| AppError::Other(format!("Key store corrupt: {}", e)))
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
    store.insert(provider.clone(), encrypt(&master, key.as_bytes())?);
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

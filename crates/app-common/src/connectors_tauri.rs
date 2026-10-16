//! The `connector_*` commands of the three desktop shells (P8-36, feature
//! `tauri-connectors`), identical in Calc, Write and Show:
//!
//! * transport: `connector_list/stat/read/write/mkdir/delete/rename`
//!   (the [`WebDavClient`] for the [`ConnectorTarget`] the UI passes);
//! * connection records: `connector_store_load/save` – one JSON file
//!   (`connections.json`) in the app data directory, written without any
//!   `password`/`token` field ([`strip_secrets`]);
//! * secrets: `connector_secret_get/set/delete` – the OS keyring
//!   (`keyring`: macOS Keychain, Windows Credential Manager, the Secret
//!   Service on Linux), service [`KEYRING_SERVICE`], one entry per
//!   connection id; only when the user ticked "Remember password".
//!
//! Nothing here runs unless the user configured a connection (ADR 0009
//! amendment): there is no background traffic.

use std::sync::{Arc, Mutex, OnceLock};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde_json::Value;

use crate::connector::{
    ConnectorEntry, ConnectorError, ConnectorErrorKind, ConnectorFile, ConnectorTarget,
};
use crate::session::{DirStorage, Storage};
use crate::webdav::{http_client, WebDavClient};

/// Name of the connection records in the app data directory.
pub const STORE_NAME: &str = "connections.json";

/// Keyring service of the remembered passwords.
pub const KEYRING_SERVICE: &str = "Rusuite connections";

/// Removes every `password` and `token` member (any depth), so a secret
/// can never end up in the records file.
pub fn strip_secrets(v: &mut Value) {
    match v {
        Value::Object(map) => {
            map.remove("password");
            map.remove("token");
            for child in map.values_mut() {
                strip_secrets(child);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(strip_secrets),
        _ => {}
    }
}

fn storage_err(e: impl std::fmt::Display) -> ConnectorError {
    ConnectorError::new(ConnectorErrorKind::Storage, e.to_string())
}

/// Where passwords are remembered.
pub trait SecretStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<String>, ConnectorError>;
    fn set(&self, id: &str, secret: &str) -> Result<(), ConnectorError>;
    /// Deleting a missing secret is not an error.
    fn delete(&self, id: &str) -> Result<(), ConnectorError>;
}

/// The OS keyring.
pub struct KeyringSecrets;

impl KeyringSecrets {
    fn entry(id: &str) -> Result<keyring::Entry, ConnectorError> {
        check_id(id)?;
        keyring::Entry::new(KEYRING_SERVICE, id).map_err(storage_err)
    }
}

impl SecretStore for KeyringSecrets {
    fn get(&self, id: &str) -> Result<Option<String>, ConnectorError> {
        match Self::entry(id)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(storage_err(e)),
        }
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), ConnectorError> {
        Self::entry(id)?.set_password(secret).map_err(storage_err)
    }

    fn delete(&self, id: &str) -> Result<(), ConnectorError> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(storage_err(e)),
        }
    }
}

/// In-memory secrets (tests, and systems without a keyring service).
#[derive(Default)]
pub struct MemorySecrets(Mutex<std::collections::BTreeMap<String, String>>);

impl SecretStore for MemorySecrets {
    fn get(&self, id: &str) -> Result<Option<String>, ConnectorError> {
        Ok(self
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned())
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), ConnectorError> {
        check_id(id)?;
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<(), ConnectorError> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
        Ok(())
    }
}

fn check_id(id: &str) -> Result<(), ConnectorError> {
    if crate::session::valid_id(id) {
        Ok(())
    } else {
        Err(ConnectorError::new(
            ConnectorErrorKind::Invalid,
            format!("invalid connection id {id:?}"),
        ))
    }
}

/// The shells' managed state: the records file, the secrets, the HTTP client.
pub struct ConnectorState {
    storage: Mutex<DirStorage>,
    secrets: Arc<dyn SecretStore>,
    http: OnceLock<reqwest::Client>,
}

impl ConnectorState {
    /// Records in `dir` (the app data directory), secrets in the OS keyring.
    pub fn new(dir: impl Into<std::path::PathBuf>) -> Self {
        Self::with_secrets(dir, Arc::new(KeyringSecrets))
    }

    pub fn with_secrets(dir: impl Into<std::path::PathBuf>, secrets: Arc<dyn SecretStore>) -> Self {
        ConnectorState {
            storage: Mutex::new(DirStorage::new(dir)),
            secrets,
            http: OnceLock::new(),
        }
    }

    /// The stored records (JSON as the UI wrote it), `None` when there are none.
    pub fn load(&self) -> Result<Option<String>, ConnectorError> {
        self.storage
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .read(STORE_NAME)
            .map_err(storage_err)
    }

    /// Replaces the records (secrets stripped); an empty `json` or `null` removes the file.
    pub fn save(&self, json: &str) -> Result<(), ConnectorError> {
        let mut storage = self.storage.lock().unwrap_or_else(|e| e.into_inner());
        if json.trim().is_empty() || json.trim() == "null" {
            return storage.remove(STORE_NAME).map_err(storage_err);
        }
        let mut v: Value = serde_json::from_str(json).map_err(|e| {
            ConnectorError::new(ConnectorErrorKind::Invalid, format!("invalid records: {e}"))
        })?;
        strip_secrets(&mut v);
        storage
            .write(STORE_NAME, &v.to_string())
            .map_err(storage_err)
    }

    /// The secret store (shared, for blocking calls).
    pub fn secrets(&self) -> Arc<dyn SecretStore> {
        self.secrets.clone()
    }

    /// A client for `target` (shared HTTP client).
    pub fn client(&self, target: &ConnectorTarget) -> Result<WebDavClient, ConnectorError> {
        let http = match self.http.get() {
            Some(h) => h.clone(),
            None => {
                let h = http_client()?;
                self.http.get_or_init(|| h).clone()
            }
        };
        WebDavClient::new(http, target)
    }
}

type Res<T> = Result<T, ConnectorError>;
type State<'a> = tauri::State<'a, ConnectorState>;

/// The entries of a folder.
#[tauri::command]
pub async fn connector_list(
    state: State<'_>,
    target: ConnectorTarget,
    path: String,
) -> Res<Vec<ConnectorEntry>> {
    state.client(&target)?.list(&path).await
}

/// One file or folder.
#[tauri::command]
pub async fn connector_stat(
    state: State<'_>,
    target: ConnectorTarget,
    path: String,
) -> Res<ConnectorEntry> {
    state.client(&target)?.stat(&path).await
}

/// File contents (base64) and entity tag.
#[tauri::command]
pub async fn connector_read(
    state: State<'_>,
    target: ConnectorTarget,
    path: String,
) -> Res<ConnectorFile> {
    let (bytes, etag) = state.client(&target)?.read(&path).await?;
    Ok(ConnectorFile {
        bytes_base64: STANDARD.encode(bytes),
        etag,
    })
}

/// Writes a file (`ifMatch` / `ifNoneMatch` as in [`WebDavClient::write`]) → the new entity tag.
#[tauri::command]
pub async fn connector_write(
    state: State<'_>,
    target: ConnectorTarget,
    path: String,
    bytes_base64: String,
    if_match: Option<String>,
    if_none_match: Option<bool>,
) -> Res<Option<String>> {
    let bytes = STANDARD.decode(bytes_base64.as_bytes()).map_err(|e| {
        ConnectorError::new(ConnectorErrorKind::Invalid, format!("invalid base64: {e}"))
    })?;
    state
        .client(&target)?
        .write(
            &path,
            bytes,
            if_match.as_deref(),
            if_none_match.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub async fn connector_mkdir(state: State<'_>, target: ConnectorTarget, path: String) -> Res<()> {
    state.client(&target)?.mkdir(&path).await
}

#[tauri::command]
pub async fn connector_delete(state: State<'_>, target: ConnectorTarget, path: String) -> Res<()> {
    state.client(&target)?.delete(&path).await
}

#[tauri::command]
pub async fn connector_rename(
    state: State<'_>,
    target: ConnectorTarget,
    from: String,
    to: String,
    overwrite: Option<bool>,
) -> Res<()> {
    state
        .client(&target)?
        .rename(&from, &to, overwrite.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn connector_store_load(state: State<'_>) -> Res<Option<String>> {
    state.load()
}

#[tauri::command]
pub async fn connector_store_save(state: State<'_>, json: String) -> Res<()> {
    state.save(&json)
}

/// Runs a keyring call off the async runtime (D-Bus / Keychain calls block).
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(storage_err)?
}

#[tauri::command]
pub async fn connector_secret_get(state: State<'_>, id: String) -> Res<Option<String>> {
    let s = state.secrets();
    blocking(move || s.get(&id)).await
}

#[tauri::command]
pub async fn connector_secret_set(state: State<'_>, id: String, secret: String) -> Res<()> {
    let s = state.secrets();
    blocking(move || s.set(&id, &secret)).await
}

#[tauri::command]
pub async fn connector_secret_delete(state: State<'_>, id: String) -> Res<()> {
    let s = state.secrets();
    blocking(move || s.delete(&id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_never_keep_secrets() {
        let dir = std::env::temp_dir().join(format!("rusuite-connectors-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let state = ConnectorState::with_secrets(&dir, Arc::new(MemorySecrets::default()));
        assert_eq!(state.load().unwrap(), None);
        state
            .save(r#"{"connections":[{"id":"c1","auth":{"kind":"basic","username":"u","password":"pw"}},{"auth":{"kind":"bearer","token":"t"}}]}"#)
            .unwrap();
        let text = state.load().unwrap().unwrap();
        assert!(!text.contains("pw") && !text.contains("token"), "{text}");
        assert!(text.contains("\"username\":\"u\""));
        assert_eq!(
            state.save("{bad").unwrap_err().kind,
            ConnectorErrorKind::Invalid
        );
        state.save("null").unwrap();
        assert_eq!(state.load().unwrap(), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn memory_secrets_and_ids() {
        let s = MemorySecrets::default();
        s.set("c-1", "pw").unwrap();
        assert_eq!(s.get("c-1").unwrap().as_deref(), Some("pw"));
        s.delete("c-1").unwrap();
        s.delete("c-1").unwrap();
        assert_eq!(s.get("c-1").unwrap(), None);
        assert_eq!(
            s.set("../x", "pw").unwrap_err().kind,
            ConnectorErrorKind::Invalid
        );
        assert!(KeyringSecrets::entry("bad id!").is_err());
    }

    #[test]
    fn clients_check_the_target() {
        let state =
            ConnectorState::with_secrets(std::env::temp_dir(), Arc::new(MemorySecrets::default()));
        let target = ConnectorTarget {
            base_url: "http://lan".into(),
            root_path: String::new(),
            auth: crate::connector::ConnectorAuth::None,
            allow_http: false,
        };
        assert_eq!(
            state.client(&target).err().unwrap().kind,
            ConnectorErrorKind::Insecure
        );
        assert!(state
            .client(&ConnectorTarget {
                allow_http: true,
                ..target
            })
            .is_ok());
    }
}

//! The shell's secret store (P11-X1): the OS keyring, like the other desktop apps. Without a usable keyring
//! (a Linux desktop without Secret Service), the **AI key** (`rusuite-ai-<provider>`, Settings › AI) is kept in a
//! file of the app data directory instead – owner-only on Unix – and Settings › AI says so (`ai_key_info`), the same
//! rule as the sharing device keys. Every other secret behaves exactly like the keyring.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use app_common::connector::{ConnectorError, ConnectorErrorKind};
use app_common::connectors_tauri::SecretStore;

/// The AI keys' entry prefix (ui-shared's `TauriAiStore`).
pub const AI_PREFIX: &str = "rusuite-ai-";

/// The folder of the fallback files in the app data directory.
pub const FALLBACK_DIR: &str = "secrets";

/// The keyring, with a file fallback for the AI keys.
pub struct NotesSecrets {
    keyring: Arc<dyn SecretStore>,
    dir: PathBuf,
    /// The last AI key read or written is in a fallback file.
    ai_in_file: AtomicBool,
}

fn io_err(e: &std::io::Error) -> ConnectorError {
    ConnectorError::new(ConnectorErrorKind::Storage, e.to_string())
}

/// Only plain ids become file names (`rusuite-ai-anthropic`, …).
fn fallback_name(id: &str) -> Option<&str> {
    let rest = id.strip_prefix(AI_PREFIX)?;
    (!rest.is_empty()
        && rest
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'))
    .then_some(id)
}

impl NotesSecrets {
    #[must_use]
    pub fn new(keyring: Arc<dyn SecretStore>, data_dir: &Path) -> Self {
        Self {
            keyring,
            dir: data_dir.join(FALLBACK_DIR),
            ai_in_file: AtomicBool::new(false),
        }
    }

    /// Whether the AI key is in a fallback file (no usable keyring).
    pub fn ai_key_in_file(&self) -> bool {
        self.ai_in_file.load(Ordering::SeqCst)
    }

    fn file(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.key"))
    }

    fn remove_file(&self, name: &str) -> Result<(), ConnectorError> {
        match std::fs::remove_file(self.file(name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io_err(&e)),
            _ => Ok(()),
        }
    }

    fn write_file(&self, name: &str, secret: &str) -> Result<(), ConnectorError> {
        std::fs::create_dir_all(&self.dir).map_err(|e| io_err(&e))?;
        let path = self.file(name);
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            opts.mode(0o600);
        }
        use std::io::Write as _;
        let mut f = opts.open(&path).map_err(|e| io_err(&e))?;
        f.write_all(secret.as_bytes()).map_err(|e| io_err(&e))
    }
}

impl SecretStore for NotesSecrets {
    fn get(&self, id: &str) -> Result<Option<String>, ConnectorError> {
        let Some(name) = fallback_name(id) else {
            return self.keyring.get(id);
        };
        if let Ok(Some(s)) = self.keyring.get(id) {
            self.ai_in_file.store(false, Ordering::SeqCst);
            return Ok(Some(s));
        }
        match std::fs::read_to_string(self.file(name)) {
            Ok(s) => {
                self.ai_in_file.store(true, Ordering::SeqCst);
                Ok(Some(s))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.ai_in_file.store(false, Ordering::SeqCst);
                Ok(None)
            }
            Err(e) => Err(io_err(&e)),
        }
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), ConnectorError> {
        let Some(name) = fallback_name(id) else {
            return self.keyring.set(id, secret);
        };
        // A keyring that accepts the entry but cannot give it back is no keyring.
        if self.keyring.set(id, secret).is_ok()
            && self.keyring.get(id).ok().flatten().as_deref() == Some(secret)
        {
            self.remove_file(name)?;
            self.ai_in_file.store(false, Ordering::SeqCst);
            return Ok(());
        }
        self.write_file(name, secret)?;
        self.ai_in_file.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<(), ConnectorError> {
        let Some(name) = fallback_name(id) else {
            return self.keyring.delete(id);
        };
        // Without a keyring there is nothing to delete there.
        let _ = self.keyring.delete(id);
        self.remove_file(name)?;
        self.ai_in_file.store(false, Ordering::SeqCst);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_common::connectors_tauri::MemorySecrets;

    /// A keyring service that is not there.
    struct NoKeyring;
    impl SecretStore for NoKeyring {
        fn get(&self, _: &str) -> Result<Option<String>, ConnectorError> {
            Err(ConnectorError::new(
                ConnectorErrorKind::Storage,
                "no secret service",
            ))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), ConnectorError> {
            Err(ConnectorError::new(
                ConnectorErrorKind::Storage,
                "no secret service",
            ))
        }
        fn delete(&self, _: &str) -> Result<(), ConnectorError> {
            Err(ConnectorError::new(
                ConnectorErrorKind::Storage,
                "no secret service",
            ))
        }
    }

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "rusuite-notes-secrets-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn without_a_keyring_the_ai_key_goes_to_an_owner_only_file() {
        let dir = temp("file");
        let s = NotesSecrets::new(Arc::new(NoKeyring), &dir);
        s.set("rusuite-ai-anthropic", "sk-test").unwrap();
        assert!(s.ai_key_in_file());
        let path = dir.join(FALLBACK_DIR).join("rusuite-ai-anthropic.key");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "sk-test");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let again = NotesSecrets::new(Arc::new(NoKeyring), &dir);
        assert_eq!(
            again.get("rusuite-ai-anthropic").unwrap().as_deref(),
            Some("sk-test")
        );
        assert!(again.ai_key_in_file());
        again.delete("rusuite-ai-anthropic").unwrap();
        assert!(!path.exists());
        assert_eq!(again.get("rusuite-ai-anthropic").unwrap(), None);
        assert!(!again.ai_key_in_file());
        // Other secrets (connections) never fall back to a file.
        assert!(again.set("conn-1", "pw").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn with_a_keyring_nothing_is_written_and_an_old_file_is_removed() {
        let dir = temp("keyring");
        NotesSecrets::new(Arc::new(NoKeyring), &dir)
            .set("rusuite-ai-openai", "old")
            .unwrap();
        let s = NotesSecrets::new(Arc::new(MemorySecrets::default()), &dir);
        s.set("rusuite-ai-openai", "new").unwrap();
        assert!(!s.ai_key_in_file());
        assert!(!dir
            .join(FALLBACK_DIR)
            .join("rusuite-ai-openai.key")
            .exists());
        assert_eq!(s.get("rusuite-ai-openai").unwrap().as_deref(), Some("new"));
        assert!(fallback_name("rusuite-ai-../x").is_none());
        assert!(fallback_name("rusuite-ai-").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

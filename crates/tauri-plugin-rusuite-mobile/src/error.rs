/// Errors of the mobile document API.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The call needs Android or iOS (desktop builds compile the API but never use it).
    #[error("not supported on this platform")]
    Unsupported,
    /// The Kotlin/Swift side rejected the call (its message: a denied permission, a vanished file, …).
    #[error("{0}")]
    Native(String),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

#[cfg(mobile)]
impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(e: tauri::plugin::mobile::PluginInvokeError) -> Self {
        Error::Native(e.to_string())
    }
}

/// The plugin's result type.
pub type Result<T> = std::result::Result<T, Error>;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.mangatsu.amberopener";

mod commands;
mod error;

pub use error::Error;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignerQuery {
    pub r#type: String,
    pub payload: String,
    pub pubkey: String,
    pub current_user: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SignerQueryResult {
    pub status: String,
    pub result: Option<String>,
}

type Result<T> = std::result::Result<T, Error>;

pub struct AmberOpener<R: Runtime> {
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
    #[cfg(target_os = "android")]
    handle: PluginHandle<R>,
}

impl<R: Runtime> AmberOpener<R> {
    /// Launches the given `nostrsigner:` URL the same way a browser resolving
    /// an `intent://` link would, so Amber's web-app request parser (which
    /// requires the Browser.EXTRA_APPLICATION_ID extra) handles it correctly.
    pub fn open_amber_url(&self, url: String) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin("openAmberUrl", serde_json::json!({ "url": url }))
                .map_err(Into::into)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = url;
            Err(Error::UnsupportedPlatform)
        }
    }

    /// Asks the signer app for a result through its ContentResolver provider,
    /// which works without bringing it to the foreground when the user has
    /// remembered their approval. Status is "ok", "unavailable" or "rejected".
    pub fn query_signer(&self, request: SignerQuery) -> Result<SignerQueryResult> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin("querySigner", request)
                .map_err(Into::into)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = request;
            Err(Error::UnsupportedPlatform)
        }
    }
}

pub trait AmberOpenerExt<R: Runtime> {
    fn amber_opener(&self) -> &AmberOpener<R>;
}

impl<R: Runtime, T: Manager<R>> AmberOpenerExt<R> for T {
    fn amber_opener(&self) -> &AmberOpener<R> {
        self.state::<AmberOpener<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("amber-opener")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "AmberOpenerPlugin")?;

            app.manage(AmberOpener {
                #[cfg(not(target_os = "android"))]
                _marker: std::marker::PhantomData::<fn() -> R>,
                #[cfg(target_os = "android")]
                handle,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::open_amber_url, commands::query_signer])
        .build()
}

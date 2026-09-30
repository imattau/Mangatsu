use tauri::{command, AppHandle, Runtime};

use crate::AmberOpenerExt;

#[command]
pub(crate) async fn open_amber_url<R: Runtime>(app: AppHandle<R>, url: String) -> crate::Result<()> {
    app.amber_opener().open_amber_url(url)
}

use tauri::{command, AppHandle, Runtime};

use crate::AmberOpenerExt;

#[command]
pub(crate) async fn open_amber_url<R: Runtime>(app: AppHandle<R>, url: String) -> crate::Result<()> {
    app.amber_opener().open_amber_url(url)
}

#[command]
pub(crate) async fn query_signer<R: Runtime>(
    app: AppHandle<R>,
    request: crate::SignerQuery,
) -> crate::Result<crate::SignerQueryResult> {
    app.amber_opener().query_signer(request)
}

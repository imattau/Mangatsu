const COMMANDS: &[&str] = &["open_amber_url", "query_signer"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}

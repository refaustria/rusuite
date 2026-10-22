// The plugin has no webview commands (the shells call its Rust API); the builder only wires the Kotlin and Swift
// sources into the generated Android/Xcode projects.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}

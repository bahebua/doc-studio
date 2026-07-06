// Doc Studio — Tauri entry.
//
// The Tauri shell hosts the existing web UI unchanged; native features
// (file dialog, HTTP without CORS, shell open) are exposed via plugins
// and can be reached from the SPA through `@tauri-apps/api`.

fn main() {
    doc_studio_lib::run()
}

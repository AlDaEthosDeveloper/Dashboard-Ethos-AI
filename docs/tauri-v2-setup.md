# Tauri v2 setup checklist for Ethos Dashboard

This project now uses Tauri v2 runtime commands (`__TAURI_INTERNALS__.invoke`) for:
- reading/writing `ethos_config.json`
- recursive directory scanning
- reading ZIP/XML/TXT files for auto import

## 0) Install Tauri v2 prerequisites (one-time)

### JavaScript + CLI

```bash
npm install
npm install -D @tauri-apps/cli@^2
npm install @tauri-apps/api@^2 @tauri-apps/plugin-fs@^2
```

### Rust targets + toolchain

```bash
rustup update
rustup target add x86_64-pc-windows-msvc
```

(If you build only on Windows, run these in a Windows shell with Visual Studio Build Tools installed.)

## 1) Install dependencies

```bash
npm install
```

If your environment blocks npm registry access, manually add these dependencies in your own environment:
- `@tauri-apps/api`
- `@tauri-apps/plugin-fs`

## 2) Ensure Tauri project exists

At repo root:

```bash
npx tauri init
```

Expected output:
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/main.rs`

## 3) Enable FS plugin in Rust

In `src-tauri/Cargo.toml` add:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-fs = "2"
```

In `src-tauri/src/main.rs` register plugin:

```rust
fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

## 4) Add capability permissions (required)

Create/update `src-tauri/capabilities/default.json` with at least:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Main desktop capability",
  "windows": ["main"],
  "permissions": [
    "core:path:default",
    "core:path:allow-executable-dir",
    "core:path:allow-join",
    "core:path:allow-resolve-directory",

    "fs:default",
    "fs:allow-read-dir",
    "fs:allow-read-file",
    "fs:allow-read-text-file",
    "fs:allow-stat",
    "fs:allow-write-file",
    "fs:allow-write-text-file",

    "fs:scope-appconfig-recursive",
    "fs:scope-appdata-recursive",
    "fs:scope-desktop-recursive",
    "fs:scope-exe-recursive",

    "fs:scope-home-recursive"
  ]
}
```

> Why this changed: Tauri v2 does **not** have `core:path:allow-app-config-dir` / `allow-app-data-dir` / `allow-desktop-dir` / `allow-executable-dir` permissions. Use `core:path:allow-resolve-directory` and call `resolve_directory` with `directory: "Executable"` for exe-path lookup.

For tighter security, replace `fs:scope-home-recursive` with a narrower scope that matches your actual log/database location.

## 5) Run desktop app

```bash
npm run tauri:dev
```

## 6) In app UI

1. Go to **Configuration**.
2. Set **Database / log directory (auto-scan on desktop startup)**.
3. Save.
4. Restart app.

On startup, app should:
- load `ethos_config.json`
- auto scan configured folder
- continue polling every 10 seconds.

For stale monitoring, you can place `last_runCombinedprocessor.txt` in the configured database directory with a line:

`Last run: 2026-03-27 14:20:00`

Optional: you can hardcode a UNC override in `src/contexts/AppConfigContext.tsx` via `DEFAULT_UNC_CONFIG_PATH` (for example `\\\\server\\share\\ethos\\ethos_config.json`).

## 7) Debugging quick checks

- If auto-scan does not start: check capability permissions first.
- If config file not persisted: verify write permission to `$APPCONFIG`.
- If folder is scanned but nothing imports: confirm files are `.zip`, EventLog `.xml`, or combined `.txt` logs.
- If `Latest JSON modified timestamp` shows `N/A` while JSON files exist: ensure `fs:allow-stat` is present so file mtime can be read.
- If diagnostics shows `path.executable_dir not allowed` or `plugin:path|executable_dir not allowed by ACL`: do not use `plugin:path|executable_dir`; use `plugin:path|resolve_directory` with `directory: "Executable"` and keep `core:path:allow-resolve-directory`.
- If diagnostics shows `invalid args 'directory' ... expected u16`: when invoking `plugin:path|resolve_directory` directly, pass numeric base-directory codes (e.g. `Executable=19`, `Desktop=18`, `AppConfig=13`, `AppData=14`) instead of strings.
- If diagnostics shows `Unable to resolve executable dir: unknown path`: add a Rust command fallback (using `std::env::current_exe()` + `.parent()`) and call it when `resolve_directory(Executable)` fails.


## 8) Fix for your exact error

If you see:

`Permission core:path:allow-app-config-dir not found ...`

Then your capability file still uses invalid permission names.

Replace any of these invalid entries:
- `core:path:allow-app-config-dir`
- `core:path:allow-app-data-dir`
- `core:path:allow-desktop-dir`

With:
- `core:path:allow-resolve-directory`

Then clean and rebuild:

```bash
cd src-tauri
cargo clean
cd ..
npm run tauri:dev
```


## 9) Fix for your new JSON parse error ("trailing characters at line 12 column 1")

That error means `src-tauri/capabilities/default.json` is not valid JSON.

Common causes:
- two JSON objects in one file
- extra text after the closing `}`
- trailing commas
- comments (`//` or `/* */`) in JSON
- wrong file encoding with hidden garbage

### Fast fix

1. Open `src-tauri/capabilities/default.json`.
2. Delete everything.
3. Paste the exact content from `docs/tauri-v2-capabilities.default.json` in this repo.
4. Save as UTF-8 (no BOM if your editor offers that option).
5. Re-run:

```bash
cd src-tauri
cargo clean
cd ..
npm run tauri:dev
```

### Optional sanity check

If you have `jq` installed:

```bash
jq . src-tauri/capabilities/default.json
```

If `jq` fails, your JSON is still malformed.

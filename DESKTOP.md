# Desktop development status

BlueGay is a Tauri 2 desktop project with a Windows x64 release executable at `release/BlueGay.exe`. See [BUILD.md](BUILD.md) for launch and rebuild instructions. Installer bundling is disabled in `src-tauri/tauri.conf.json`; the executable embeds its frontend assets and needs no preview server.

## Work on the interface without compiling

From this directory:

```sh
node serve.mjs
```

Open `http://127.0.0.1:4173`. Refresh after editing files in `dist/`. This preview uses browser storage and browser imports; it cannot exercise the Rust filesystem backend.

Run source-only verification:

```sh
node scripts/check.mjs
node --test tests/*.test.cjs
```

These commands validate configuration/IPC wiring and exercise frontend save coordination and unsaved-change flows using a mocked native transport. They do not invoke Cargo or create executables.

## Native behavior implemented in source

- Open Folder opens the real folder; Open File and OS drag-and-drop open original files. Dropped files retain their disk paths, so Ctrl+S writes back without Save As. Drop a single folder to open a project.
- Ctrl+S writes to the original disk path. Ctrl+Shift+S invokes native Save As and adopts the selected path. Ctrl+Alt+S awaits Save All.
- New files in an open folder have a destination in that folder. Drafts outside a folder get a Save As dialog. Autosave never opens save dialogs for drafts.
- Disk files and new folders can be created. Workspace file rename changes the disk path without overwriting an existing destination. For a standalone file outside an open folder, Rename uses Save As and keeps the original.
- Delete (Explorer keyboard shortcut or context menu) asks before moving disk files or entire subfolders to the operating system's Recycle Bin. Unsaved drafts are removed only from the workspace. The project root itself cannot be deleted through this command.
- Saves use a temporary file in the same directory followed by replacement. A SHA-256 fingerprint guards against overwriting externally modified contents. A failed write leaves the editor dirty.
- Writes are serialized per document in JavaScript and across native mutations in Rust. Typing during a slow save remains unsaved until a subsequent save completes.
- Existing opened files are checked every four seconds and when the window regains focus. Clean buffers reload external changes; dirty buffers offer Reload, Save As, or explicit Overwrite. A further external edit causes another conflict.
- Startup rescans the project folder, includes newly discovered files, refreshes folders, and removes clean files that were deleted outside the app. Missing dirty buffers remain in recovery and offer Save As. Images and other unsupported files are listed without creating editable text models or sending their contents to the coding agent.
- Closing a dirty tab, replacing the workspace, and closing the app offer Save / Discard / Cancel. Failed or cancelled saves block the close.
- Editor and ChatLGBT preferences are stored in `settings.json` in the application's configuration directory (`%APPDATA%\app.bluegay.ide` on Windows), with a local WebView cache. The Node preview uses the same path. Recovery text, notes, and file history remain in local WebView storage. Authorized file/folder locations are stored separately in the configuration directory, so recovered files can reconnect on restart.
- Native ZIP/file export opens a Save dialog. The editor UI and Monaco language services remain shared with the browser preview.

## Code layout

| File | Purpose |
| --- | --- |
| `dist/app.js` | Shared editor, language services, preferences, and commands |
| `dist/desktop-io.js` | Native transport, save queue, dirty-state and conflict coordination |
| `dist/desktop.js` | Native workspace integration and unsaved-change dialogs |
| `dist/agent.js`, `dist/agent-core.js` | ChatLGBT conversation, context selection, streaming, proposal validation and review |
| `agent-server.mjs` | Browser-preview proxy; loopback only, API key remains in server memory or environment |
| `src-tauri/src/agent.rs` | Native model streaming, cancellation, Windows Credential Manager integration |
| `src-tauri/src/disk.rs` | User-selected filesystem access, dialogs, fingerprint checks, disk writes |
| `dist/debugger-core.js`, `dist/debugger.js` | DAP/LSP coordination and run/debug interface |
| `src-tauri/src/debugger.rs`, `debugger_setup.rs` | Native adapters, runtime setup, console I/O and process lifecycle |
| `dist/browser-preview.js`, `src-tauri/src/html_preview.rs` | Active/selected HTML opening and guest preview snapshots |
| `src-tauri/src/main.rs` | Window lifecycle and native command registration |
| `src-tauri/tauri.conf.json` | Desktop window, CSP, and disabled installer packaging |
| `tests/` | Node tests using an in-memory native transport; no real disk writes |

## Native verification

The release executable was compiled with the Rust MSVC toolchain and Microsoft C++ Build Tools. JavaScript and Rust dependencies are pinned in lockfiles. WebView2 is required on computers running the app.

Verified on Windows on 2026-10-19: source checks, all 76 JavaScript tests, and all 3 Rust tests passed. The release executable launched with the preview server stopped, loaded the bundled Monaco editor, opened a folder through the native Windows dialog, detected HTML, and saved a test file to its original disk path with indentation repaired. The saved contents were checked directly on disk.

Run `npm run desktop:dev` for a development window or `./build-windows.ps1 -Test` for a release build with native tests.

Broader native validation should cover unusual write permissions, Windows path edge cases, Recycle Bin behavior, close cancellation, persisted recovery, and every Monaco worker under the packaged app's content-security policy.

ChatLGBT native verification must also cover Credential Manager save/remove, environment-key fallback, streamed event delivery, cancellation before and during a request, TLS/network failures, and API authentication errors. Its browser proxy and editor review workflow can be tested without compiling; see [CHATLGBT.md](CHATLGBT.md).

## Current boundaries

UTF-8 text files up to 50 MB can be edited. Other regular files appear in Explorer with an **Open anyway** option. It bypasses the default size/type limits for UTF-8 text; binary data opens as a read-only hex preview of the first 64 KiB. The override persists through saves and disk refreshes. Large files still require sufficient memory. A native folder scan lists at most 2,000 files and 4,000 folders, up to 64 levels deep, and loads up to 128 MB of text; access restrictions and listing limits produce a warning. Dependency and hidden folders are included; symlinks are not followed. External additions and folder removals appear after restarting/reloading the editor or reopening the folder; already listed files are also checked during use. Browser imports are snapshots and cannot monitor the original disk folder. Their Open anyway option retains the import source until used; after a browser reload, reopen the original file if that source is no longer available. ZIP export is currently for text-only workspaces; projects with unsupported files should be backed up from their disk folder. Browser Write back skips unsupported entries. Recovery storage remains subject to WebView storage capacity. File permissions are preserved where supported, but specialized metadata such as NTFS alternate data streams is not preserved by replacement saves. Git remotes are not connected. Python/Java run and debug are available in the desktop app; Java project builds use Eclipse JDT LS. See [DEBUGGING.md](DEBUGGING.md) for setup and scope.

The filesystem boundary accepts only paths selected through native dialogs, descendants of selected roots, and previously persisted grants. The frontend has no unrestricted filesystem, shell, or process-execution plugin permission.

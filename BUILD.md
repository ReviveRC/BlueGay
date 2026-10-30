# Windows executable

BlueGay is an independent, unofficial parody of BlueJ IDE, with project source available under the MIT license. It is not affiliated with or endorsed by the BlueJ project or its developers. Third-party components retain their own licenses.

The release build produces `release/BlueGay.exe`. Double-click it to run BlueGay; no Node server or Rust installation is needed to run the app. Microsoft Edge WebView2 Runtime is required and is already present on the development computer.

The executable embeds the editor and its assets. Projects and settings stay outside the executable. Preferences are in `%APPDATA%\app.bluegay.ide\settings.json`; API keys use Windows Credential Manager. This is a local unsigned build, without an installer.

## Build again

Clone https://github.com/ReviveRC/BlueGay first. With Node.js 24+, the Rust MSVC toolchain, Microsoft C++ Build Tools, and WebView2 installed, run from the repository root:

```powershell
npm ci
.\build-windows.ps1 -Test
```

The script uses the project-local Rust installation under `.build-tools` when present, otherwise the Rust installation on PATH. It runs source checks, builds a release executable, optionally runs native tests, copies the result to `release/BlueGay.exe`, and writes `release/SHA256SUMS.txt`. Close a running copy before replacing it.

The underlying build command is `npm run desktop:build`. Tauri rebuilds the bundled offline diagnostics and preview assets, and copies project license notices before compiling the executable. Its original output is `src-tauri/target/release/bluegay.exe`. Installer bundling remains disabled. Building the app does not require the production signing key or a connected AI account.

JavaScript tests can also be run with `node --test tests/*.test.cjs`. Build dependencies are pinned in `package-lock.json` and `src-tauri/Cargo.lock`.

The application UI source is in `dist/*.js`, with styles and markup alongside it. Diagnostic-worker source is in `src/`; the native backend is in `src-tauri/src/`. The bundled Monaco, fflate, diagnostics, and preview files under `dist/vendor/` allow the editor to run offline.

For browser development, run `npm run preview` and open `http://127.0.0.1:4173`. Optional rendered preview checks are in `tests/previews-e2e.cjs`; they require Playwright, pdf-lib, a local preview server, and Microsoft Edge. These optional packages can be resolved from `BLUEGAY_TEST_NODE_MODULES` when installed outside the project. Other integration-fixture scripts document their setup in their source headers.

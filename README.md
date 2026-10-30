# BlueGay

**An unofficial parody of [BlueJ IDE](https://www.bluej.org/).** BlueGay is an independent project and is not affiliated with or endorsed by the BlueJ project or its developers.

BlueGay is open source under the [MIT license](LICENSE). Third-party components retain their own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

A customizable IDE with a shared Monaco interface and a Tauri 2 Windows desktop backend. A Windows release executable is available at `release/BlueGay.exe`.

Version **1.0.5** adds live web preview, image/Markdown/PDF previews, reviewable error-explanation drafts, and Windows file/folder launch handling. It also includes clearer Java assertion failures, mixed-language project documentation, and ChatLGBT usability and credential-renewal fixes. Python/Java debugging, JUnit testing, Code Together, JavaScript intelligence, configurable AI code prediction, localized tools, and signed automatic update checks remain available. See [BlueGay releases](https://github.com/ReviveRC/BlueGay/releases) and [UPDATES.md](UPDATES.md) for installing, publishing, and signing future updates.

Double-click `release/BlueGay.exe` to run it. See [BUILD.md](BUILD.md) for rebuilding and [DESKTOP.md](DESKTOP.md) for architecture, native behavior, verification, and current limits.

**ChatLGBT is included.** Use the sparkle icon for AI chat, explicit code attachments, project context search, streamed replies, and reviewable multi-file proposals. See [CHATLGBT.md](CHATLGBT.md) for API-key setup, personality settings, review/undo behavior, and limits. The default voice is Full sparkle 💅.

**Code Together:** the icon below ChatLGBT hosts your open folder or joins a collaborator's project using an invite code. Includes host-controlled permissions, live file updates, collaborator badges and colored cursor labels. Both computers need the desktop app and a shared LAN or VPN. See [CODE-TOGETHER.md](CODE-TOGETHER.md) for setup and synchronization limits.

**Run and debug:** Python and Java launch debugging, a host-controlled guest console permission, and **Ctrl+Alt+B** to open the active or Explorer-selected HTML file in your default browser. See [DEBUGGING.md](DEBUGGING.md) for runtime setup and shortcuts.

**Java compilation and tests:** **Ctrl+Shift+B** compiles the project and **Ctrl+Alt+T** runs JUnit tests. The JAVA TESTS panel shows each pass/failure/skip, assertion details, source navigation and **Rerun failed**. JUnit 4/5 and plain folders such as `TEST.java` are supported alongside imported Java projects. Right-click an Explorer folder → **New file…** creates a file directly inside it. See [JAVA-TESTING.md](JAVA-TESTING.md).

## Keep developing without compiling

Run `node serve.mjs` and open `http://127.0.0.1:4173`. The browser preview uses browser storage; run the desktop executable for native disk access.

Editor preferences and ChatLGBT model/personality/output settings save automatically to `%APPDATA%\app.bluegay.ide\settings.json` on Windows, in both the Node preview and desktop source. Existing browser preferences migrate on first launch. Preferences shows the actual path or any persistence error. Workspace files and recovery snapshots remain separate from settings. Restart the preview server after updating to enable the settings endpoint.

ChatLGBT supports **Continue with ChatGPT** in the Windows app, or your own OpenAI API key. Click the account at the bottom left for sign-in, saved accounts, connection choice, usage settings, and sign-out. ChatGPT mode uses eligible plan usage and account-specific models; credits depend on eligibility and credit-sharing settings. API-key mode is billed separately and is never selected automatically after a ChatGPT error. Login tokens are encrypted with Windows DPAPI; API keys use Windows Credential Manager. Browser preview supports session-only API keys.

Source-only verification:

```sh
node scripts/check.mjs
node --test tests/*.test.cjs
```

## Project documentation generator

Choose **Tools → Generate Project Documentation…** or **Generate Project Documentation** in the command palette. Review the file list and choose whether to also add documentation comments inside source files, then select **Generate HTML**. The default is **No — generate HTML only**. ChatLGBT uses your selected model and connection, sending each eligible file’s current editor contents in a separate request. Normal usage limits and costs apply.

The generator creates `Documentation/index.html` and one HTML page per file under `Documentation/files/`, preserving source paths (for example, `src/math.py` becomes `Documentation/files/src/math.py.html`). Open the index in a browser to browse the documentation. It uses each file’s editor language mode, or infers the language or format from its contents when unknown. It supports mixed-language projects and arbitrary text formats. Sections adapt to the contents: functions and types for code, selectors for CSS, queries for SQL, configuration keys, markup, or prose topics. Documentation descriptions and headings follow the interface language selected when generation starts (English or French Canada). Code identifiers and signatures are preserved.

Choose **Yes — add comments above functions** to also document functions, methods and constructors in the source. Comments use the file’s comment syntax and the same interface language, and are inserted above declarations, including any decorators or attributes. Already documented declarations are skipped. These are undoable editor changes; save the source files normally to write them to disk. HTML-only generation leaves source files unchanged. Invalid or ambiguous comment insertions and source conflicts are reported in the index without discarding successfully generated HTML. This is AI-generated documentation; verify it against the source.

Binary, empty, private, dependency/internal, and oversized files are skipped and listed in the dialog/index. Files exceeding the single-request context limit are not truncated. Failed or incomplete responses are listed in the index. Stop cancels remaining requests and keeps completed pages and source comments. Existing clean generated pages can be regenerated; other files and unsaved edits are protected. Both `Documentation/` and legacy `Javadoc/` output are excluded from future inputs. Browser preview stores pages in its workspace; use Export project as ZIP to download them. Generation is available for local projects outside Code Together sessions.

## Live and asset previews

Use the **Preview file** button beside the split-editor button, **View → Live preview / Preview file**, the command palette, or **Explorer → right-click → Preview file**. HTML opens beside the editor with Desktop, Tablet (768px), and Phone (390px) widths. Save HTML, CSS, JavaScript, or a referenced asset to refresh the preview; **Refresh preview** reloads it manually. The selected HTML entry stays selected while you edit its other files. Local relative stylesheets, images, fonts, JavaScript modules, and module imports are served together from a read-only snapshot. This is a static preview; it does not start framework development servers or execute server-side code. Root-relative URLs currently need to be changed to project-relative paths for the preview.

Markdown uses the same side panel and updates as you edit. Local images are supported; raw HTML and JavaScript links are disabled. Images and PDFs open directly from Explorer or File → Open file without going through the text editor's binary warning. Images show dimensions and byte size, with Fit image and Actual size controls. PDFs render locally using bundled PDF.js, with previous/next page, a page-number field, zoom, and password entry for encrypted documents. SVGs can also be switched to **Edit source**. Previewing never writes image or PDF bytes. The renderer and fonts are bundled for offline use. Asset files and combined web snapshots are limited to 64 MB. Browser imports must be reopened after restarting to restore their binary bytes.

Web preview JavaScript runs in a sandboxed iframe without access to BlueGay's DOM, account storage, or native commands. Snapshots exclude hidden/private credential paths and are served only on loopback with an unguessable URL. Closing the project clears the native preview server. Links to HTTPS resources may still load when online.

## Explain an error

Select **✦ Explain** beside a Problems entry, right-click a problem or the editor and choose **Explain this error with ChatLGBT**, or use **View → Explain this error**. Failed Java test details also have an explanation button, including expected/received values and the stack trace. BlueGay opens a ChatLGBT draft with the error and a nearby source excerpt. Review the draft and attachment, then select **Send** to use the configured AI connection. Existing drafts and running replies are preserved. No model request is sent just by choosing Explain.

## Open from Windows

Windows **Open with → BlueGay**, dropping files/folders onto the executable, and command-line paths now open the actual selection. For example, `BlueGay.exe "C:\Projects\My project"` opens that project and `BlueGay.exe "C:\Projects\hello.py"` opens that file at its original disk path. Subsequent launches focus the running updated app and deliver the new selection to that window. Opening another folder retains the normal Save/Discard/Cancel protection. This does not change Windows' default file associations or add an Explorer context-menu entry.

## Tools menu

- **Format JSON…** validates JSON and previews indentation before applying an undoable editor change. Numeric literals and duplicate keys are preserved.
- **Text statistics…** counts lines, whitespace-separated words, Unicode characters, and UTF-8 bytes for the selection or entire file.
- **SHA-256 checksum…** computes a checksum from the selection or entire file’s current UTF-8 editor text, including unsaved changes and line endings.
- **Format document** uses the editor’s language formatter.

These utilities run locally and need no AI connection.

## Editor features

- Folder/single-file opening, tabbed and split editing, nested explorer, create/rename/delete. Click a file in Explorer and press F2 to rename it; F2 in the editor still renames symbols where supported.
- Select a file or folder in Explorer and press Delete, or right-click it and choose Delete. Desktop deletions go to the Recycle Bin after confirmation; folder deletion includes its entire contents. Explorer uses smiling folder icons and keeps the project heading free of an expand arrow.
- Images, binary files, and large files appear in Explorer with an opening warning instead of a text editor. Reloading the desktop app rescans its project folder; externally deleted clean files disappear, while deleted files with unsaved edits stay available for recovery with Save As.
- Automatic language detection with a searchable status-bar language selector.
- Language-aware Ctrl+/ comments, block comments, completion, multi-cursor editing, folding, find/replace, and symbol navigation.
- JavaScript/TypeScript, HTML, CSS/SCSS/Less, and JSON language services. Offline Python syntax and lint diagnostics powered by Ruff, plus YAML, TOML, and XML validation. C#, C++, and Java have offline syntax checking using bundled Tree-sitter grammars. Errors and warnings appear as underlines and clickable Problems entries.
- JavaScript autocomplete, hover information, signature help, and definitions also work inside HTML JavaScript `<script>` blocks. Project JavaScript/TypeScript files and declarations provide shared context; module scripts keep their own scope. Properties such as `length`, `currentTarget`, and `classList` use the inferred type of the receiver. JSDoc and type narrowing help when a value's type is unknown.
- AI **Code prediction** is on by default under **Preferences → Editor → Code intelligence**, with a separate **Prediction model** setting that defaults to the ChatLGBT model. After a 700 ms pause, predictions appear as gray text: **Tab** accepts and **Escape** dismisses. Connect your selected ChatLGBT account or API key first. Predictions send bounded nearby code and directly referenced eligible files to OpenAI and consume model allowance even when ignored. They use a separate request channel from chat, cancel stale work, and leave the document unchanged until accepted. HTML predictions run inside JavaScript script blocks.
- C#, C++, and Java syntax checks cover malformed conditions/statements, missing delimiters/semicolons, and incomplete declarations. They need no compiler or SDK. They do not check types, resolve imports/includes, expand C++ macros, or apply project/compiler settings; some grammar extensions and newest syntax may differ from your compiler. Each pass reports up to 100 errors.
- Python checks include syntax/indentation errors, undefined names, unused imports and unused local variables. They are single-file checks, without Python type checking, project import resolution, or project Ruff configuration. No Python installation or API key is needed. Other languages retain word completion and snippets.
- Diagnostics refresh after edits, renames, and language changes. Additional local checks run in a background worker with a 350 ms debounce, skip files over 500,000 characters, and report initialization failures or timeouts in Problems.
- HTML tag abbreviations: type `p`, `div`, `h1`, `section`, etc., then Enter or Tab to expand. Type `html`, `html:5`, or `!` for a full HTML document. Tab steps through attributes in snippets like `img` and `a`. Use Ctrl+Space if automatic suggestions are disabled.
- `script` + Enter inserts `<script src=""></script>` with the cursor in `src`. HTML `src` attributes suggest project files and folders as you type, including `images/`, relative paths and nested directories.
- Click the active Explorer button again to hide the sidebar and expand the editor. The unused bottom-left B avatar has been removed.
- In HTML text, `lorem` + Enter inserts a placeholder paragraph. Inside an image's `src` attribute, `placeholder` + Enter inserts `https://placehold.co/` with the cursor ready for dimensions; `placeholder600x400` inserts `https://placehold.co/600x400` (any supplied dimensions work).
- Workspace search/replace, diagnostics, local checkpoint diffs, 20 history snapshots per file, and scratchpad.
- Eighteen themes (11 dark and 7 light), 24 named accent presets, custom accent colors, fonts, indentation, minimap, wrapping, guides, and save preferences. Search theme names in Preferences → Appearance. Use theme accent restores the selected theme's recommended accent.
- Native Ctrl+S, Save As, autosave, conflict detection, and unsaved-change protection in the desktop source.
- Python and Java run/debug support in the desktop app: breakpoints and conditions, stepping, pause/restart/stop, threads, call stack, variables, watches, expression evaluation, and program input. Java projects use Eclipse JDT LS for builds and dependency resolution. Configure your installed Python interpreter or JDK 21+ through **Run → Debugger settings…**.
- **Ctrl+Alt+B** opens the focused Explorer HTML file, or the active HTML editor tab, in the default browser after saving. File menus and the command palette also expose the action.

Automatic saves preserve in-progress text and completion cursors. Explicit saves apply the formatting, trailing-whitespace and final-newline preferences.

HTML indentation on save waits for the bundled HTML formatter, including on the first save. Children of `<html>` are indented too. The indentation-only option preserves existing lines, blank lines, and whitespace-sensitive `<pre>` contents; choose a tab size of 4 to use four spaces per nesting level.

Enable **Preferences → Workspace → Fix indentation on save** to repair leading indentation on Ctrl+S, Save As, and Save All, using the editor's tab size and spaces/tabs preference. This changes indentation without rearranging lines or rewriting code. It uses the bundled language formatter/rules where available (including HTML, CSS, JSON, JavaScript and TypeScript); languages without those rules are left unchanged. Save All also processes already-autosaved open tabs when this setting is enabled. The toggle defaults off and is remembered on this device.

The editor runs offline using bundled Monaco assets and system font fallbacks. ChatLGBT model requests require an internet connection and your OpenAI API key. Monaco and fflate are MIT licensed; their notices are in `dist/vendor/`.

The additional diagnostics worker and WASM are prebundled under `dist/vendor/diagnostics/`, with dependency license notices. After editing `src/diagnostics-*.mjs` or `src/syntax-diagnostics.mjs`, run `npm run build:diagnostics` to refresh those assets; this does not compile an executable. Dependencies are pinned in `package-lock.json`.

# 1.0.5 — Previews, error help, and Windows launch selection

- Published the project source under the MIT license with third-party notices and build instructions. Added an explicit unofficial BlueJ IDE parody and non-affiliation statement to the README, About screen, welcome screen, and release notes.
- Added an in-app HTML preview with desktop/tablet/phone widths and save-triggered refresh of static project files, including relative JavaScript module imports, stylesheets, images, and fonts. Preview JavaScript is isolated from the IDE and native commands.
- Added Markdown rendering and direct image/PDF opening. Image controls include dimensions, file size, fit and actual size; offline PDF controls include page navigation, page selection, zoom, and password entry. Source/binary bytes remain unchanged.
- Added reviewable ChatLGBT explanation drafts from diagnostics, the editor context menu, and failed Java test details. Nearby source, assertion values and stack traces are included; sending remains explicit.
- Handle Windows launch arguments for files/folders, including Unicode and spaces. Subsequent launches focus the existing updated window and preserve unsaved-change protection when switching projects.
- Added bundled preview libraries, local/native snapshot serving, focused regression coverage and rendered browser checks.

## Test details and ChatLGBT usability

- Show Expected and Received assertion values in Java test details, with a failure reason directly beneath each failed row and expandable stack traces. Preserve full JUnit 3/4 string comparisons and JUnit 5 values, including empty strings, null and multiline text.
- Add a remembered Hide info / Show info toggle for ChatLGBT connection and billing information.
- Prevent stopped chats or code predictions from abandoning rotating-token renewal. Save replacement credentials before identity-key requests and retry pending verification after temporary failures, while continuing to block unverified access.
- Add real JUnit assertion integration coverage and native regressions for credential rotation, cancellation, interrupted verification and terminal refresh errors.

## Project documentation

- Renamed Generate Javadoc to Generate Project Documentation in Tools and the command palette, including French labels. Output now goes to `Documentation/`; legacy `Javadoc/` output remains excluded from generation inputs.
- Adapted prompts and HTML sections to each file’s language or text format, using editor language modes and source inference for unfamiliar formats.
- Added a Yes/No choice for documentation comments above functions. Comments use the file’s syntax and the interface language captured when generation starts, preserve original source text, skip existing documentation, and appear as undoable edits for normal saving.
- Added regression coverage for mixed-language projects, dynamic HTML sections, localized source comments, source conflicts and invalid insertions.

# 1.0.4 — Python/Java debugging and JUnit testing

- Published v1.0.4 as the latest stable GitHub release with BlueGay-1.0.4.exe, the signed latest.jwt updater manifest and checksums. Verified anonymous public downloads, the production signature, executable size and SHA-256. All 244 regression tests and 37 native tests passed for the versioned release build.

- Removed the Made for your flow footer, the top-right workspace section and the bottom-right clover information button. Anchored Explorer's WORKSPACE actions above the account control, with the file list scrolling independently. Replaced the Explorer open-folder text glyph with an outline folder icon matching the adjacent controls.

- Fixed an intermittent first-run JUnit import failure in plain/BlueJ source folders: compilation now waits until JDT LS resolves the managed JUnit library, rather than starting as soon as the server announces readiness. Maven/Gradle/Eclipse projects retain their own dependency handling.
- Made Debugger settings scroll within the window, kept its heading visible, and gave Stop on entry and diagnostic-output checkboxes compact controls with visible labels and descriptions.

- Added folder/project context-menu New file actions that create and save inside the selected folder, preserve create permissions and expand the file's parent folders.
- Added explicit Java compilation and JUnit 4/5 testing with per-test pass/fail/skip results, assertion messages, stack traces, failure/source navigation, filtering, outdated-result notices and Rerun failed for TDD. Supports uppercase TEST.java, parameterized tests and imported test-scope dependencies without requiring a main method.
- Added pinned JUnit setup in the existing Java tool cache and a separate structured result channel. Compiler errors and test setup failures cannot appear as passing runs. Added plain-folder and Maven integration checks covering red-to-green, failed-test reruns and compiler failures.

- Added native Python debugpy and Java Debug Server/JDT LS launch debugging, including Java project imports/builds and dependency resolution. Added adapter setup and runtime selection without modifying installed Python environments or JDKs.
- Added a Run menu and debug console with input, evaluation, threads, stack frames, expandable/editable variables, watches, conditional breakpoints, exception settings, stepping, pause, restart and process-tree cleanup.
- Added the host's default-off Code Together console/debugging permission, enforced by the host independently of file-edit permissions. Revocation stops guest sessions; local host sessions stay separate.
- Added Ctrl+Alt+B and menu/context/command-palette actions to save and open the active or Explorer-selected HTML file in the default browser.
- Added frontend/native tests and real Python/Maven Java adapter integration checks. Setup, controls and scope are documented in DEBUGGING.md.

# 1.0.3 — JavaScript autocomplete and code prediction

- Published v1.0.3 as the latest stable GitHub release with BlueGay-1.0.3.exe, the signed latest.jwt update manifest, and checksums. Verified the public updater feed, production signature, executable size, and downloaded SHA-256.
- Connected HTML JavaScript script blocks to the bundled JavaScript language service for property completion, hover, signatures, and definitions, with correct source ranges and isolated module scopes. Kept markup, comments, external-script bodies, and JSON/data scripts out of the JavaScript bridge.
- Synced workspace JavaScript, TypeScript, and declaration files into both language services so local imports and JSDoc types remain available as files change or close.
- Added default-on AI Code prediction and a separate model selector in Preferences → Editor → Code intelligence. Gray suggestions appear after a typing pause; Tab accepts and Escape dismisses. Settings persist locally, including an explicit opt-out.
- Reused the selected ChatLGBT connection without changing billing providers. Predictions use bounded nearby/imported context, short output, cancellation, caching, and error backoff; they never apply edits before acceptance. Browser and native transports permit one chat and one prediction independently.
- Added deterministic browser fixtures and tests covering the reported properties, module/import behavior, prediction context, stale results, account selection, default settings, and separate request channels.

# 1.0.2 — Tools and localized Javadoc

- Moved Javadoc generation into a new Tools menu.
- Javadoc requests and HTML headings follow the interface language (English or French Canada), preserving source identifiers and signatures.
- Added local JSON validation and formatting with preview and undo, text statistics, and SHA-256 checksums.
- Added French labels for the new tools and documentation dialog.

# 1.0.1 — ChatLGBT Javadoc generator

- Added File → Generate Javadoc and a command palette action.
- Generates standalone HTML documentation for eligible project text files plus a linked Javadoc/index.html, using the selected ChatLGBT model and connection.
- Includes file-list review, progress, cancellation, failed/skipped-file reporting, and conflict-aware regeneration. AI text is escaped before HTML rendering.
- Preserves source files and saves generated pages directly to the desktop project folder.

# Latest changes

## Published BlueGay 1.0.0

- Published v1.0.0 as the latest release at https://github.com/ReviveRC/BlueGay/releases/tag/v1.0.0 with the EXE, signed latest.jwt manifest, and checksums. Added the repository's initial README commit because GitHub requires a nonempty repository to publish releases.
- Verified the public update feed without authentication, validated the published manifest signature and metadata, and downloaded the public EXE to confirm its size and SHA-256 match the signed manifest. The feed is live; future signed newer versions can update existing 1.0.0 installations.

## BlueGay 1.0.0 and portable automatic updates

- Set npm, Cargo, Tauri, Windows executable metadata, Preferences, and About to version 1.0.0. Added a version-setting script to keep future releases consistent.
- Added automatic signed update checks at startup and every six hours using ReviveRC/BlueGay's latest GitHub release. Newer EXEs download in the background; Restart to update protects unsaved edits and settings before replacing the running EXE at its original path. Equal and older versions are rejected. Help and Preferences expose manual checks and persistent HTTPS source configuration.
- Added pinned RSA signature validation, expiry/audience checks, bounded downloads, checksum verification, writable-folder staging, final verification before exit, and a hidden Windows replacement helper with restart, recovery backup, and rollback. Updater controls include French (Canada).
- Added a release signer and packaging script. The private production signing key is kept only in the ignored `.release-keys` folder and is never included in releases. The 1.0.0 release package contains the EXE, signed latest.jwt, checksums, release notes, and upload instructions. Publication is left to the user as requested; the feed will become live after those assets are published.
- Source checks, all 185 JavaScript/integration tests, and all 27 native tests passed. Windows tests exercised checksum/path rejection, real EXE replacement and restart, and rollback after a failing replacement. Signature tests covered tampering, wrong keys/audience, and expiry. No live model request was sent.

## Participant joins and ChatGPT connection fixes

- Fixed Windows participant joins: accepted sockets inherited nonblocking mode from the listener and could close before the authentication token/request arrived. Accepted connections now use blocking framed I/O with timeouts. Truncated connections show an actionable reconnect message in English or French instead of “failed to fill whole buffer.”
- Starting ChatGPT sign-in now selects and saves the ChatGPT connection immediately, clearing a stale API-key gate. Startup repairs saved signed-in accounts left in default API mode by earlier versions; subsequent explicit connection selections persist. Requests retain ChatGPT authentication without an API-key fallback.
- Reproduced the delayed-join failure before the fix. All 23 native tests and 176 JavaScript tests passed, including delayed real-socket joins, truncated frames, sign-in connection persistence, authenticated request routing, and explicit API-mode preservation. Source checks passed. Built `release/BlueGay-fixed.exe` with a checksum because the running main executable is locked. No live model request was sent.

## ChatLGBT and Code Together French coverage

- Translated ChatLGBT welcome content, prompt placeholder, suggestion buttons, connection and billing notices, student guidance, settings controls, review actions, model descriptions, status messages, and token estimates. Conversation text, attached code, paths, and model identifiers remain untouched.
- Translated Code Together setup, hosting and joining controls, permissions, network guidance, session status, and participant counts. Project and collaborator names are preserved.
- Localized the Preferences settings-location prefix while preserving the exact path. English restoration remains lossless. All 173 JavaScript tests and source checks passed, including rendered dialog coverage and welcome/placeholder regression checks. Built `release/BlueGay-update.exe` with a checksum because the running `BlueGay.exe` is locked.

## French translation coverage fixes

- Translated the empty-editor Open a folder/Open a file buttons, desktop workspace header, manual/automatic save indicator, empty outline guidance, and desktop sidebar footer.
- Added French translations for every directly emitted static toast and templates for filenames, counts, saves, imports, collaboration notices, and browser-launch errors. Toasts translate immediately, preserve variable details, and retain their status icons. System/provider error details remain as received.
- Added regression coverage for the reported labels, static toast coverage, dynamic messages, preserved paths and error details, and English fallback. All 169 JavaScript tests and source checks passed.

## French Canadian interface language

- Added English and Français (Canada) under Preferences → Appearance → Interface language. Translated workbench controls, menus, preferences, common account/chat controls, and recovery guidance; strings without a translation fall back to English.
- The locale is stored with preferences in settings.json and the local recovery cache, then restored at startup. Language changes apply immediately and preserve code, filenames, chat content, and input values. Settings search also recognizes translated labels.
- Added checks for saved-language restoration, switching back to English, and preserving protected content. All 166 JavaScript tests and source checks passed.

## Notification status icons

- Error notifications now show a red X, including missing remote recovery copies, failed saves, connection failures, and invalid paths. Successful actions retain the green checkmark; informational guidance uses an information icon.
- Error messages use the accessible alert role. Source checks and all 164 JavaScript tests passed; verified the recovery failure and success notification paths. Rebuilt `release/BlueGay.exe` and updated its checksum.

## ChatGPT sign-in and account settings

- Added the official local-app ChatGPT sign-in flow, a bottom-left name/email account control, and account settings for sign-in, saved accounts, plan permission, usage, connection choice, and sign-out. The compact account icon remains accessible with the sidebar hidden.
- Added encrypted Windows credential storage, validated OAuth callbacks and signed identities, serialized refresh, remote revocation with clear failure reporting, and account-specific model discovery. API-key mode remains an explicit alternative with no automatic billing fallback.
- Updated the billing/student disclosures for the selected connection. ChatGPT requests omit unsupported output-limit fields; changing accounts clears chat context while preserving an unsent draft.
- Source checks, 164 JavaScript tests, and 21 native tests passed. Built `release/BlueGay.exe`; also refreshed the `BlueGay-update.exe` copy. Verified the bottom-left control, settings layout, and browser handoff to OpenAI's sign-in page. Real account sign-in and inference require the user to complete the browser flow; no model request was sent during verification.

## ChatLGBT model dropdown, browser links, and student offer

- Replaced free-text model entry with GPT-6.1 Sol, GPT-6 Astra, and GPT-6 Luna, verified against the official catalog on October 22, 2026. Unsupported saved choices require an explicit replacement and preserve the user's draft.
- Routed billing and student-registration links through Windows' default browser using a native command limited to those two destinations. Browser preview retains normal links; failed desktop launches show a manual address.
- Added an expandable $100 student offer with U.S./Canada eligibility, verification, expiration, and a clear distinction between Codex credits and the current API-key integration.
- Source checks, 156 JavaScript tests, and 14 native tests passed. Rebuilt the Windows executable as `release/BlueGay-update.exe` because the running `release/BlueGay.exe` is locked; checksum is in `release/BlueGay-update.sha256.txt`. No paid model request was sent.

## Updated Windows release

- Rebuilt `release/BlueGay.exe` with the 18 themes, 24 accent presets, persistent API billing guidance, and actionable ChatLGBT error reporting. Updated the release SHA-256 checksum.
- Source checks and 3 native tests passed; the current frontend has 83 passing JavaScript tests. Launched the packaged executable and verified the expanded theme picker and billing notice with a connected key. No live AI request was sent during this build check.

## More themes and clear API billing setup — source only

- Expanded from 3 themes and 6 accents to 18 themes and 24 named accents, including Graphite, Obsidian, Forest floor, Deep ocean, Rose quartz, Coffeehouse, Paper, Mint cream, and Lavender milk. Theme previews, workbench surfaces, editor syntax and completion widgets use one catalog. Theme names are searchable, custom accents persist, and Use theme accent restores each theme's recommended color.
- Primary buttons automatically choose black or white text for the accent color. Verified text/syntax contrast for every preset. Added responsive swatch wrapping and accessible selected-state labels.
- Added persistent API-credit guidance to ChatLGBT and its setup dialog: ChatGPT subscriptions do not cover this API-key integration. Included API billing links and clarified that key storage does not verify credits or recharge an account.
- Source checks and 83 JavaScript tests passed. Browser verification covered light/dark switching, preview cards, accent layout, and billing onboarding. No executable was compiled for these changes.

## ChatLGBT billing error reporting

- Show the provider's error code and message for streamed API failures, including HTTP 200 streams that report `credit_balance_exhausted`. Add billing, model access, rate-limit, context, and output-limit guidance; redact credential patterns and render messages as text.
- Restore failed prompts without overwriting a newer draft. Exclude failed exchanges from retry context, preserve partial replies, and keep failed/incomplete proposals unavailable for acceptance. Requests are never retried automatically.
- Passed all 80 JavaScript tests, including the observed billing-error shape through both browser and native event transports. A minimal live diagnostic with no project context confirmed the API credit-balance error; successful generation remains blocked until API credits are available.

## First Windows executable

- Compiled the Windows x64 release to `release/BlueGay.exe` with embedded editor assets; no preview server or installer is needed. Added a repeatable `build-windows.ps1 -Test` build, dependency lockfiles, SHA-256 output, and [build instructions](BUILD.md).
- Installed the local Rust MSVC toolchain and Microsoft C++ Build Tools needed for compilation. Build tools and release outputs are excluded from version control.
- Passed source checks, 76 JavaScript tests, and 3 native Rust tests. Launched the release with the preview server stopped and verified native folder opening, HTML detection, and Ctrl+S saving indentation fixes to disk. Live AI requests remain untested.

## Local settings and AI onboarding

- Added a versioned `settings.json` in the user's app config directory, shared by the local Node preview and desktop source. Both editor and AI preferences migrate from browser storage, load before startup, and save automatically with serialized atomic writes. Preferences displays the exact path; load/write failures retain a browser copy and never replace a malformed file with defaults.
- Added same-origin, token-protected settings endpoints with size/type/key validation. API keys cannot be stored as settings fields. Native settings commands use the same schema and an atomic write under a mutex.
- Added a prominent API-key requirement, setup button, and key-first settings form. Sending without a key opens setup without sending a model request or clearing the draft. Desktop keys stay in Credential Manager; preview keys remain session-only.
- Regression tests cover disk round-trips/restarts, migration, invalid-file preservation, rejected requests, and the missing-key send flow. Native code remains uncompiled.

## Indentation on save

- Added **Preferences → Workspace → Fix indentation on save**, off by default and persisted with other preferences. Explicit Save, Save As and Save All use the selected tab width and spaces/tabs style. Save All includes open tabs already saved by autosave.
- Calculate indentation on a disposable copy using the bundled language formatter/rules, then apply only leading-whitespace edits to the real file. Preserve code, line breaks and undo history. Unsupported languages remain unchanged. Autosave continues to preserve in-progress typing.
- Added save-routing, persistence, indentation-only, private-model cleanup and autosave regression coverage. Browser verification covered HTML nesting with two spaces, four spaces and literal tabs. No executable was compiled.

## HTML abbreviation completion

- Type an HTML tag name such as `p`, `div`, `section`, `h1`, `ul`, or `table`, then accept the suggestion with Enter or Tab. Paired tags place the cursor inside; void elements such as `br`, `hr`, and `img` have no closing tag. Common attributes have Tab placeholders.
- Type `html`, `html:5`, or `!` to generate a complete HTML document with doctype, language, charset, viewport, title and body. The cursor starts inside the body. Indentation follows editor preferences.
- Abbreviations use HTML language mode and avoid attributes, comments, and embedded script/style content. Existing `<tag` and attribute suggestions remain available. If automatic suggestions are disabled, use Ctrl+Space.
- Fixed autosave interrupting completions and moving the cursor by rewriting the document to add a newline. Automatic saves now preserve the exact in-progress text; explicit saves apply format-on-save, whitespace trimming and final-newline preferences.
- Validation: 62 Node tests and source checks passed. Browser checks verified Enter expansion, body cursor placement and Tab navigation with autosave enabled. No native build was performed.

## ChatLGBT

- Added a Pride-themed assistant sidebar with Full sparkle, A little sparkle, and Keep it concise personality settings; default model `gpt-6.1-sol` with a custom model field and output limits.
- Added streaming chat, Stop, explicit file/selection attachments, local project context search, approximate input-token estimates and actual returned usage.
- Added reviewable multi-file proposals, diff selection, accept/reject, per-file checkpoints and guarded batch undo. Accepted edits are held out of autosave until manually saved. Changed source, malformed output, incomplete streams, conflicting paths and old-workspace proposals are rejected.
- Added a loopback browser proxy and uncompiled native API/credential backend. No API key is stored in browser storage. Chat and attachment state clear on project changes.
- Added source-only tests and a separate, visibly labeled synthetic-response browser fixture. No live model request or native build was performed. Setup and limitations: [CHATLGBT.md](CHATLGBT.md).

## Earlier fixes

- Fixed blank Ctrl+Space suggestions: the app's `.main` layout rule also matched Monaco suggestion content. It now targets only the workbench main panel. Completion widgets can extend outside the editor so the bottom panel does not clip them.
- Right-click the project name at the top of Explorer and choose **Close Project**, or use File → Close Project. Native mode asks to save/discard/cancel dirty files and leaves disk files in place. Browser mode keeps the last closed project, including unsaved edits and scratchpad, available through File → Reopen Closed Project. Closing is blocked if that browser recovery copy cannot be stored. An empty closed workspace stays empty on refresh when Restore last session is enabled.
- Added the Pride blue jay logo to the header, welcome screen, browser favicon and desktop icon configuration. The original transparent PNG and generation prompt are in `dist/assets`.

Validation: source checks and 26 Node tests, plus browser verification of completion rendering, project context menu, close, refresh and reopen. Native close/save paths were tested with mocked IPC; no native executable was built or tested.

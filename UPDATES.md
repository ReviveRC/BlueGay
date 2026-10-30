# Portable Windows updates

The 1.0.0 EXE checks `https://github.com/ReviveRC/BlueGay/releases/latest/download/latest.jwt` ten seconds after startup, then every six hours. It accepts only a newer stable version, signed with this project's update key. HTTPS, bounded downloads, signature expiry, audience, size, and SHA-256 checks run before staging. Equal and older versions never replace the app.

The app stages the new executable beside its current EXE, so the folder must be writable. Restart to update runs the existing unsaved-work guard, saves recovery/settings, and starts a hidden Windows helper. The helper waits for BlueGay to exit, rechecks hashes and paths, renames the old EXE into `.bluegay-update-*/previous.exe`, replaces the original EXE at the same path/name, and restarts it. If installation or startup fails, it restores the previous EXE. `update.log` in that staging folder records the outcome. Backups are deliberately retained for manual recovery.

Use Help → Check for updates or Preferences → Updates for manual checks. The source URL can be changed there and persists in `%APPDATA%\app.bluegay.ide\updater-source.json`. Changing the URL does not change the embedded signing key. The updater does not request administrator privileges or send project files/account credentials.

## Release 1.0.5

[BlueGay 1.0.5](https://github.com/ReviveRC/BlueGay/releases/tag/v1.0.5) includes **BlueGay-1.0.5.exe**, **latest.jwt**, and **SHA256SUMS.txt**. The package has a verified production signature, an executable size of 23,821,824 bytes, and SHA-256 `ee7b2806296d6bcdfc895a0c832f686c8612cdea21c51123225dd26b4f3d5a51`. The matching source is MIT licensed, and BlueGay is explicitly identified as an unofficial BlueJ IDE parody independent of the BlueJ project.

`release/BlueGay-1.0.5-release.zip` contains these files and upload instructions. Extract it first; attaching just the ZIP does not create the two asset URLs the updater needs. The first updater-enabled version must be installed manually; older EXEs cannot gain an updater without being replaced once.

## Future releases

BlueGay's source is public under the MIT license. Preserve LICENSE and third-party notices, and keep the unofficial BlueJ IDE parody/non-affiliation statement in the README and About screen. Publish the vetted source revision used to build each executable, and point its release tag at that source commit so GitHub's source archives match the binary. Keep local workspaces, account/credential files, test artifacts, build caches, and the production private signing key out of the repository.

Back up `.release-keys/updater-private.pem` securely. **Never upload that directory or private key.** It is ignored by Git and excluded from the release package. `src-tauri/updater-public.pem` is the public verification key embedded in the app. The test signing keys under `tests/fixtures/` are unrelated and cannot sign production updates.

```powershell
node scripts/set-version.mjs 1.0.6
# Edit RELEASE-NOTES.md for this release.
./build-windows.ps1
./scripts/package-release.ps1
```

Publish `release/1.0.6/BlueGay-1.0.6.exe` and `release/1.0.6/latest.jwt` under tag `v1.0.6` and mark it latest. Preserve exact asset filenames. The package script refuses to sign a binary whose Windows product version differs from the project version. If the build script cannot overwrite a currently running `release/BlueGay.exe`, the compiled binary at `src-tauri/target/release/bluegay.exe` is still used by the package script.

The manifest is an RS256 JWT containing the app/audience, version, download URL, size, SHA-256, notes, and an expiry one year after signing. The private key is required for every future release. Keep its backup; losing it requires a signing-key migration or a manual reinstall. Do not rotate it casually.

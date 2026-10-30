# Third-party notices

BlueGay's project source is released under the MIT license in LICENSE. Third-party components retain their own copyrights, licenses, and notices; the project license does not replace them.

The vendored editor and JavaScript libraries carry notices under `dist/vendor/`:

- Monaco Editor and fflate: `MONACO-LICENSE.txt` and `FFLATE-LICENSE.txt` (MIT).
- Offline diagnostics: individual license files in `dist/vendor/diagnostics/`, plus notices retained in the generated worker.
- Markdown preview: MarkdownIt and bundled dependency licenses in `dist/vendor/previews/`.
- PDF.js: `dist/vendor/previews/PDF.js-LICENSE` (Apache-2.0). Bundled CMaps, standard fonts, and WASM retain their accompanying licenses in the respective subdirectories.

Node build dependencies are recorded in `package-lock.json`; native dependencies are recorded in `src-tauri/Cargo.lock`. Refer to each package or crate for its full license terms. Optional downloaded debugger, Java language-server, and JUnit tools are configured in `src-tauri/debugger-assets.json` and are not part of the source checkout or Windows release assets.

BlueGay is an unofficial parody of BlueJ IDE. It is not affiliated with or endorsed by the BlueJ project or its developers. BlueJ's name and branding are not relicensed by BlueGay's MIT license. The original BlueJ project is at https://www.bluej.org/.

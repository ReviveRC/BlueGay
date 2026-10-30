# BlueGay 1.0.5

BlueGay is an **unofficial parody of BlueJ IDE**, independent of and not affiliated with or endorsed by the BlueJ project or its developers.

- **Now open source under MIT:** the application source, build scripts, tests, and bundled dependency notices are available at https://github.com/ReviveRC/BlueGay. Third-party components retain their own licenses.
- **Live web preview:** preview HTML beside your editor with Desktop, Tablet (768px), and Phone (390px) sizes. Saving refreshes the preview, including project-relative stylesheets, images, fonts, JavaScript modules, and module imports. Open it with the Preview file button, View menu, command palette, or Explorer context menu.
- **Image, Markdown, and PDF previews:** open images and PDFs directly from Explorer. Images show dimensions and file size, with fit and actual-size controls. PDFs render offline with page navigation, page selection, zoom, and password entry. Markdown previews update as you edit and support local images. SVGs can also be edited as source.
- **Explain this error:** prepare a ChatLGBT explanation from a Problems entry, the editor context menu, or a failed Java test. The draft includes nearby source and, for test failures, expected/received values and the stack trace. Review it and select Send when ready; choosing Explain does not send a model request automatically.
- **Open the actual Windows selection:** launching BlueGay with a file or folder now opens that selection. Subsequent launches focus the running updated app and deliver the selection to the same window. Spaces and Unicode paths are supported, and switching folders retains Save/Discard/Cancel protection.
- **Clearer Java test failures:** Expected and Received values appear in test details, with a failure reason beneath failed rows and expandable stack traces, including empty, null, and multiline values.
- **Project documentation:** the generator now adapts to mixed-language projects and writes to Documentation/. An optional setting adds undoable documentation comments above functions, methods, and constructors in English or French (Canada).
- **ChatLGBT usability and connection fixes:** remember Hide info / Show info, and preserve rotating sign-in credentials when chats or code predictions are stopped or identity verification is interrupted.

Web preview is for static projects and uses a sandbox isolated from BlueGay's native commands. It does not start framework development servers or execute server-side code. Use project-relative resource paths; root-relative URLs are not currently supported. Asset files and combined web snapshots are limited to 64 MB. PDF and image previews preserve the original files. Windows launch handling does not change your default file associations.

Validation: 259 frontend regression tests and 44 native tests passed. Rendered checks covered save refresh, responsive sizing, module imports, Markdown safety, images, multipage PDFs, zoom, and explanation drafts. The packaged Windows app was also checked for file/folder launch forwarding and native web/PDF rendering.

Download **BlueGay-1.0.5.exe**, or use **Help → Check for updates**. Settings and recovery data are preserved.

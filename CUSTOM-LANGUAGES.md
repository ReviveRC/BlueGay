# Custom languages

Open **Preferences → Languages**, **Tools → Custom languages…**, or choose
**Add or manage custom languages…** from the language selector in the status bar.

Language packs provide file associations, syntax highlighting, comments, bracket
pairs, keywords, snippets, and optional AI reference material. They are declarative
JSON files; imported packs cannot run scripts or install software.

Custom file associations take precedence over automatic built-in detection.
A file's manually selected language mode takes precedence over both.

## Add Nomix

1. Open the updated `release/BlueGay.exe`.
2. Open **Preferences → Languages** and select **Use Nomix example**.
3. Review the definition. It recognizes `.nx`, Nomix keywords, `//` comments,
   brace blocks, regular and triple-quoted strings, and `f` string prefixes.
   Expand **Brackets, strings and snippets** to inspect its snippets.
4. The **Language guide** and **Working examples** contain the Nomix README and
   dice example available on November 26, 2026. Update them here as Nomix changes.
5. Select **Add language**. Open or create a `.nx` file. The status bar should
   show **Nomix** immediately, including files that were already open.
6. Type `function`, `for`, `if`, `print`, `fetch`, or `try`, select the matching
   snippet, and press **Tab**. Subsequent Tab presses move through placeholders.
   **Ctrl+Space** opens suggestions manually.

Alternatively, select **Import language pack** and choose
`dist/language-packs/nomix.json`. Imports open a review form before saving.
Use **Export** to share a pack and **Edit** to update it.

## AI with Nomix

The example enables its AI reference and inline predictions. Chat and prediction
still require your configured ChatLGBT connection, available usage, and a selected
model. **Preferences → Editor → Code prediction** controls predictions globally.
Other new language definitions start with inline predictions off.

- In chat, attach a Nomix file or selection. The input estimate lists **Language
  reference: Nomix**, and the request includes its enabled guide and examples.
- Inline predictions receive nearby source and the enabled language reference.
  Pause while typing or press **Alt+\** to request a prediction. Press **Tab**
  to accept and **Escape** to dismiss. A selected completion menu item takes Tab
  first; snippets keep their normal placeholder navigation.
- Project documentation generation also receives the matching language reference.
- Turn off **Include this reference…** to stop sending its guide and examples.
  Turn off **Enable AI inline predictions…** to disable only that language's
  predictions. Chat remains available.

References supply context to the selected AI model; they do not train a new model.
Generated code can still be incorrect. Documentation links are not fetched: paste
the useful reference text into the guide. Attached context and references count
toward the existing request size limits and provider usage. Predictions return
no suggestion when the provider declines or cannot complete the request.

## Add another language

Select **Add language**, enter a lowercase ID such as `mylang`, a display name,
and extensions such as `.mlg`. Add keywords and built-in names separated by
spaces or commas. Set the language's comment markers, string quotes and bracket
pairs under the expandable syntax section.

Snippets use this JSON format:

```json
[
  {
    "prefix": "function",
    "description": "Function definition",
    "body": "function ${1:name}(${2:args}) {\n\t$0\n}"
  }
]
```

`${1:name}` selects the first placeholder, `${2:args}` the second, and `$0`
the final cursor position. The editor applies your indentation preferences.

Add a concise language guide and working examples before enabling predictions.
Include version-specific syntax, semantics, standard library APIs, import rules,
and differences from similar languages. The complete Nomix JSON is an exportable
example of the pack schema. Arbitrary tokenizer regular expressions, executable
plugins, remote documentation retrieval, language servers, and compiler/debugger
commands are not part of this version.

Packs are saved on this computer in the `customLanguages` field of
`%APPDATA%\app.bluegay.ide\settings.json`, with a browser recovery copy. Up to 16
packs are supported, each at most 64 KB, with a combined 512 KB limit. Guides allow
24,000 characters and examples 12,000 characters per pack. Chat references share
a bounded context budget. Removing a pack preserves source files and returns its
files to automatic language detection.

## Java and Tab suggestions

Java now has offline keyword completion and snippets for `class`, `main`, `psvm`,
`sout`, `sysout`, `for`, `foreach`, `if`, `while`, and `try`. These work without
an AI account. Automatic suggestions are controlled by **Preferences → Editor →
Automatic suggestions**; Tab completion is enabled. Other basic languages also
receive offline keywords in addition to their existing snippets.

AI predictions can extend a selected word completion, rather than being disabled
whenever a suggestion is selected. Java prediction context can also include
explicitly imported project classes. Prediction failures appear as an **AI
prediction · attention** status-bar control; click it for the reason.

These additions do not provide Java type-aware member completion or full compiler
diagnostics. Those require a Java language service. Nomix's interpreter likewise
remains external to the editor's Run/debugger integration; run `.nx` files with
your existing `nomix` command in a terminal.

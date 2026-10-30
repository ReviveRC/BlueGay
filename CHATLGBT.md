# ChatLGBT

ChatLGBT is BlueGay's project-aware coding assistant. Open it with the sparkle icon on the activity bar or **View → ChatLGBT**.

Click **Hide info** beside the model name to collapse the connection and billing information above the conversation. **Show info** brings it back. BlueGay remembers this choice on this computer; account and model settings stay available from the gear.

## Sign in with ChatGPT on Windows

Open `release/BlueGay.exe`, click **Sign in to ChatGPT** at the bottom left, then **Continue with ChatGPT**. Finish OpenAI's account selection and permission flow in your browser. BlueGay displays your verified name and email when it completes. Click that account control again for saved accounts, sign-out, and usage settings. Sign-in and permission to use your plan are separate; the app explains when plan usage has not been granted. Select your model in **Model & API settings** before sending a message.

## Start with the browser preview

1. In PowerShell, start the preview if it is not already running:

   ```powershell
   cd "C:\Users\lessa\Documents\Web Based IDE\bluegay"
   node serve.mjs
   ```

2. Open http://127.0.0.1:4173, click the sparkle icon, then the gear in ChatLGBT.
3. Enter your OpenAI API key and choose **Save settings**. It is sent once to the loopback backend, cleared from the input, and held only in that local server's memory. It is not saved to browser storage or a project file. **Clear session key** removes it. Restarting the server also clears it.
4. Choose **Current file**, **Selection**, or **Project** to attach context. Write a message and click **Send**, or press Ctrl+Enter.

Alternatively, set `OPENAI_API_KEY` in the terminal environment, or use `start-chatlgbt.ps1` instead of `node serve.mjs` for a hidden local terminal prompt. Session keys take precedence over the environment. Clearing a session key does not remove an environment key. Without a key, the editor and assistant interface still work; model requests show setup guidance. A separate OpenAI API account/key with model access is needed. The selected model and account determine API charges.

## Review and save

- Project search runs locally over filenames and file contents. Only chosen attachments are sent, alongside your message and up to eight recent chat messages. Full-file attachments use current contents at send time; selected excerpts must be reattached if their source changed.
- ChatLGBT can explain, propose replacements, and propose new files. It cannot run commands, tests, debug, delete, or rename files. It does not autonomously scan disk.
- Click **Review changes** to inspect each proposed file in Monaco's diff viewer, then **Accept all changes** or **Reject**. If any source file changed since the request, the entire proposal is blocked.
- Accepted changes are **unsaved** and excluded from autosave until you manually save them. Ctrl+S saves the active file; Ctrl+Alt+S saves all. The browser saves workspace copies; the desktop saves to disk.
- **Undo last apply** reverses the most recent accepted batch if none of its files changed again. Existing-file checkpoints also appear in File History. A newly created file already saved to disk must be removed explicitly in Explorer.
- **Stop** cancels the connection. Partial, failed and truncated responses never offer applicable edits. Requests already processed by the provider may still incur usage.
- New chat clears conversation and attachments. Closing or replacing a project also clears AI context and invalidates old proposals. Conversations are session-only and are not restored after refresh; accepted editor changes retain the normal workspace recovery behavior.

## Settings and personality

ChatLGBT has two explicit connection modes. **ChatGPT plan** opens the official browser sign-in flow and uses eligible plan allowance or credits, subject to account/workspace access and credit-sharing settings. **OpenAI API key** uses separately billed API usage: prepaid credits or an active billing arrangement. The sidebar shows which mode is in use, with links to its usage settings. Saving an API key does not check the balance or buy credits. ChatGPT errors never trigger an API-key fallback.

Click the account control at the bottom left (or the account icon when the sidebar is hidden) to sign in, switch saved accounts, enable plan permission, select the billing mode, open ChatGPT usage/account settings, or sign out. Account labels include the verified name/email and a registration suffix to distinguish workspaces. A different account clears previous chat context and attachments while retaining the unsent draft.

Desktop sign-in follows the [official local-app integration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): a loopback-only callback, PKCE, state/nonce checks, and signature/issuer/audience/expiry validation through OpenAI's JWKS. A stable host ID and distinct client registrations are retained across sign-outs. Credentials are atomically saved in `%APPDATA%/app.bluegay.ide/chatgpt-accounts.dpapi`, encrypted for the Windows user with DPAPI, never returned to JavaScript or stored in browser preferences. A process-level file lock serializes rotating-token refresh and vault updates across app instances. Sign-out cancels requests, attempts remote revocation, clears local tokens, and reports unconfirmed remote revocation. Browser preview continues to support API-key mode only.

BlueGay renews expired access automatically. Stopping a chat or code prediction lets an in-flight credential renewal finish saving before honoring cancellation. A replacement refresh token is saved before any additional identity-key requests; if those requests fail temporarily, the next attempt validates the saved identity without reusing the consumed token. Unverified replacement access remains blocked. Network errors preserve the saved account; confirmed revoked or unusable refresh tokens still require signing in again. OpenAI documents one-hour access tokens and renewable 30-day refresh tokens in its [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference).

ChatGPT mode fetches the signed-in account's visible model catalog from the documented `/v1/models` endpoint. No account-specific catalog is cached across an account switch. Requests retain `store:false` and `stream:true`; `max_output_tokens` and local account-routing fields are excluded from the ChatGPT wire request. Output length controls apply only in API-key mode.

The API-key model picker is a dropdown of current text/code models: GPT-6.1 Sol, GPT-6 Astra, and GPT-6 Luna, checked against the [official model catalog](https://developers.openai.com/api/docs/models) on October 22, 2026. Account access still applies. Saved models outside the applicable list require an explicit selection before sending; the draft is retained. Refresh the API-key catalog in `dist/agent.js` when supported models change. ChatGPT mode loads its catalog from the signed-in account instead.

The student disclosure links to [student registration](https://chatgpt.com/codex/offers/students). Eligible university students enrolled and residing in the United States or Canada can claim $100 in ChatGPT credits for Codex after verification (one offer per student, valid for 12 months). These are not API credits. Use in connected apps depends on account eligibility and credit-sharing settings; the integration does not assume student-grant eligibility. See the [official student offer](https://developers.openai.com/community/students). Registration, billing, and account links use Windows' default browser in the desktop app and normal new-tab navigation in preview. If Windows cannot launch the browser, the UI displays the address to open manually.

Use the gear in ChatLGBT, **View → ChatLGBT settings**, or the command palette. The initial model ID is `gpt-6.1-sol`; enter another Responses-compatible model ID if needed. Output limits are 3,000, 6,000 or 12,000 tokens, including reasoning. Input estimates are approximate character-based estimates; actual input/output usage appears when returned by the provider. No dollar estimate is claimed.

Model, personality and output settings are saved with editor preferences in `%APPDATA%\app.bluegay.ide\settings.json` on Windows. Existing browser settings migrate automatically. API keys are excluded from this file. Without a key, the sidebar displays **Your API key is required** and an **Enter API key** button. Attempting to send opens setup and keeps the draft; saving preferences never sends that draft automatically. You can change AI preferences before entering a key.

**Full sparkle 💅** is the default: playful, camp, warm phrases like “slay queen” and “omg yesss 💅,” with clear technical explanations. **A little sparkle** and **Keep it concise** tone it down. The personality is for conversation, not unsolicited slang in source code.

## Desktop source

The Tauri source includes native streaming HTTP requests, cancellation, and key storage in Windows Credential Manager. The desktop settings dialog can save/remove a key; `OPENAI_API_KEY` is a fallback. Removing the stored credential does not remove an environment key. Requests use the fixed OpenAI Responses endpoint and cannot redirect to arbitrary destinations.

A Windows release executable is available at `release/BlueGay.exe`. Native networking and Credential Manager integration still require live verification with a user-provided API key. The browser proxy and shared editor workflow are covered by tests using synthetic responses.

## Data and limits

The interface identifies what will be sent to OpenAI before sending. After key entry, credentials stay in the server/native backend and are never returned to the frontend. Response storage is requested off (`store: false`); that is not a claim of zero provider retention. Common secret filenames such as `.env` and private-key files cannot be attached, but code may still contain secrets: review chosen context yourself.

Context is limited to about 90,000 serialized characters. Proposals allow at most 12 files and 200,000 resulting characters. Edits require unique exact source text; ambiguous or malformed proposals fail without touching files. The local preview proxy binds only to loopback, checks Host/Origin, requires a per-process request token, disallows arbitrary provider tools, limits request sizes and time, and never returns its API key.

## Verification

Run `node scripts/check.mjs` and `node --test tests/*.test.cjs`. Tests use synthetic responses, never paid API calls. The proxy integration tests need localhost networking permissions.

For isolated browser QA, run `node scripts/agent-fixture.mjs` and open http://127.0.0.1:4175. Its replies are visibly labeled **TEST FIXTURE — no AI call**. It uses a separate browser origin and deterministic two-file proposals. Stop the fixture when finished. It is not used by the normal preview or desktop app.

Live model quality, native streaming, and Credential Manager save/remove have not been verified with a real API key.

## Implementation references

- [OpenAI Responses streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses)
- [GPT-6.1 Sol model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [Keyring Entry methods](https://docs.rs/keyring/3.6.3/keyring/struct.Entry.html)

Initial implementation tests used synthetic responses. A later minimal live diagnostic sent only “Reply with OK.” and confirmed `credit_balance_exhausted`; successful live generation remains unverified. ChatLGBT now displays this provider error and restores the prompt for a manual retry after API credits are added.

## Generate project documentation

Use **Tools → Generate Project Documentation…** to document the eligible text files in an open local project. Review the file list and its detected language modes, choose whether to also add documentation comments inside source files, and select **Generate HTML**. This uses the currently selected ChatLGBT model and connection, one request per file, and writes `Documentation/index.html` plus a corresponding page under `Documentation/files/`. The generator adapts sections to each file’s programming language, markup, configuration format or text contents, including mixed-language files and unfamiliar extensions. The file list and generated index report skipped and failed files.

**No — generate HTML only** preserves source files. **Yes — add comments above functions** also adds comments above undocumented functions, methods and constructors, using the appropriate comment syntax. Source comments, HTML prose and section headings follow the interface language captured at the start of generation (English or French Canada). Identifiers and signatures are preserved. Comments are inserted as undoable edits; save the source files to write them to disk. Exact source anchors, complete comments and unchanged source contents are required; conflicts or invalid insertions are reported in the index while retaining successful HTML output.

Use **Stop** in the dialog or ChatLGBT panel to cancel. Completed pages remain available. The generator requires a complete, validated AI response before saving each page, escapes all AI text for HTML, and protects unsaved or unrelated output files. Browser preview output can be downloaded with Export project as ZIP. AI-generated documentation should be checked against the source.

# Python and Java debugging

Run and debug are available in the Windows desktop app. No AI connection is needed.

For project compilation and JUnit test results, use **Run → Compile Java project** / **Run Java tests**. See [JAVA-TESTING.md](JAVA-TESTING.md) for the test/fix workflow and a `TEST.java` example.

## First-time setup

1. Install Python with pip, or a **JDK 21 or newer**. Select the Python environment containing your project's dependencies.
2. Open **Run → Debugger settings…**. BlueGay detects common installations; enter the full path to `python.exe` or the JDK's `bin/java.exe` if needed. A Windows Store launcher alias is not an installed Python interpreter.
3. Click **Set up Python debugger** or **Set up Java debugger**. This downloads pinned adapters into the application's settings directory. Python's packages and your JDK installation are kept separate. The first setup needs internet access; Java project dependencies and Gradle distributions can also require downloads.
4. Open a project folder and select a `.py` or `.java` source file. Standalone saved files also work. Press **F5** to debug or **Ctrl+F5** to run. Unsaved changes are saved before launching.

Python uses [debugpy](https://github.com/microsoft/debugpy). Java uses [Java Debug Server](https://github.com/microsoft/java-debug) with [Eclipse JDT Language Server](https://github.com/eclipse-jdtls/eclipse.jdt.ls). Java imports/builds supported Maven, Gradle, Eclipse and source-folder projects, resolves their classpaths, and detects main classes. If several main classes match, choose one in the launch dialog. A main-class override is available in Debugger settings. Compilation errors appear in the console and prevent launching.

The pinned versions and SHA-256 hashes for the Java downloads are in `src-tauri/debugger-assets.json`. Setup preserves the tools' bundled license notices. Runtimes are not bundled into BlueGay.exe.

Adapter startup logs are hidden during normal use; enable **Show debugger diagnostic output** in Debugger settings to inspect them. Startup failures include recent adapter details automatically. Program stdout and stderr always appear in the console.

Debugger settings scrolls within the window. **Stop on entry** pauses before the first statement when debugging; its checkbox and the diagnostic-output checkbox have descriptions beside them. In plain Java/BlueJ folders, BlueGay waits for the JUnit library to appear on the resolved project classpath before compiling, because the language server can finish starting before its library update completes.

## Controls

| Action | Shortcut |
| --- | --- |
| Debug / continue | F5 |
| Run without debugging | Ctrl+F5 |
| Stop the program and its child processes | Shift+F5 |
| Restart the last launch | Ctrl+Shift+F5 |
| Toggle breakpoint at cursor | F9 or click the editor gutter |
| Set a breakpoint condition | Shift+F9 or right-click the gutter |
| Step over | F10 |
| Step into | F11 |
| Step out | Shift+F11 |
| Pause | F6 |
| Open debug console | Ctrl+Shift+D |

Use the Run menu for the same actions. The DEBUG CONSOLE panel includes threads, call stack, expandable variable values, watch expressions, and breakpoints. Select a frame to inspect its locals; double-click a variable to edit its value when the adapter supports it. Hover over a variable while paused to inspect it. Debugger settings also provides stop-on-entry, exception behavior, a JSON array of program arguments and a JSON object of environment variables.

Select **Program input** to send a line to the running program's stdin. Select **Evaluate expression** to evaluate Python/Java expressions in the selected paused frame. This console is tied to the program/debug session; it is not a system shell. Output history is bounded. Programs run with the selected project's folder as their working directory and the current user's operating-system privileges. Stop, restarting, switching projects and closing the app clean up the associated process trees.

Breakpoints and conditions follow line insertions/deletions in the editor and are saved locally along with watches and launch options. Restart after changing a running program's source. Debugging covers launches from the editor; attaching to an existing process, hot code replacement, function/data breakpoints, GUI terminal emulation and arbitrary shell commands are not exposed. Java command-line characters outside the Windows JDK launcher's system code page can be replaced by the launcher; use program input or UTF-8 files for such data.

## Code Together

The host's **Allow console and debugging** permission defaults off and is independent of editing permission. Enabled guests run saved sources on the host and control their own sessions. Only the host can install tools or change runtime paths. Revoking the permission stops guest programs and child processes while leaving local host sessions running. See [CODE-TOGETHER.md](CODE-TOGETHER.md) for the trust and network model.

## Open HTML in your browser

Press **Ctrl+Alt+B**, or use **File → Open HTML in browser**. The focused Explorer file takes priority; otherwise BlueGay uses the active editor tab. Local desktop HTML is saved and opened as a file URL in the system browser, preserving relative disk assets. Code Together guests open a local snapshot of the shared text files, preserving relative HTML/JS/CSS links; binary images are not included in that snapshot. Browser preview uses a new blob tab and cannot resolve disk-relative assets. Pages that need HTTP, server APIs, module loading or server-side routing should use their project's development server.

## Verification

`node --test tests/*.test.cjs` covers frontend behavior and permission routing. `./build-windows.ps1 -Test` checks sources, runs native tests and builds the executable. `tests/debugger-e2e.cjs` is an explicit integration check against the ignored native `serve_debugger_fixture` test, with locally installed pinned adapters and disposable sample sources. It exercises real Python and Maven Java processes, input, variables, evaluation, stepping and program arguments; its permissions check verifies guest child-process cleanup without stopping the local session.

# Compile Java and run tests

The Windows desktop app compiles Java projects and runs **JUnit 4 and JUnit 5** tests, including parameterized, repeated, nested and disabled tests. A class named `TEST` in `TEST.java` works; test discovery does not require a particular filename pattern or a `main()` method.

Use a JDK 21 or newer, then set up Java under **Run → Debugger settings…**. The first test run downloads a pinned JUnit Platform runner from Maven Central if it is not already installed. Existing Python/JDK installations are kept separate. Testing does not use AI or an OpenAI connection.

## Commands

| Command | Shortcut | Behavior |
| --- | --- | --- |
| Run → Compile Java project | Ctrl+Shift+B | Save pending edits, import dependencies and compile; show compiler errors with source locations |
| Run → Run Java tests | Ctrl+Alt+T | Compile and discover all JUnit tests in the imported project test classpaths |
| Run → Test current Java file | Menu / results toolbar | Run the tests in the selected Java class |
| Rerun failed | Results toolbar | Recompile and rerun the exact test IDs that failed, including individual parameterized cases |
| Stop | Results toolbar | Cancel compilation/testing and stop the associated process tree |

The **JAVA TESTS** panel shows totals and individual passed, failed and skipped tests. Failed rows show the assertion reason immediately. Select a result to see separate **Expected** and **Received** values when the assertion supplies them, the full error message, and an expandable **Stack trace**. Empty strings appear as `""`; multiline values keep their line breaks. **Go to test source**, or double-click a result, jumps to the failure line or test method. Filter by status or search by test/class name. **Build and test output** contains stdout, stderr and compiler messages. Setup/container failures are reported separately from failed test methods. A run with no discovered tests is shown as **No JUnit tests found**.

Edit a Java source after running tests and the panel marks the results as outdated. Run all tests, test the current class, or rerun failed tests to continue the test/fix cycle. Test results describe the last run; they are not inferred from source text.

## A small project

Open a folder containing these two files. No Maven/Gradle build file is required; BlueGay supplies the JUnit library to ordinary source-folder projects.

`Calculator.java`:

```java
public class Calculator {
    public static int add(int a, int b) {
        return a + b;
    }
}
```

`TEST.java`:

```java
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class TEST {
    @Test
    void addsTwoNumbers() {
        assertEquals(5, Calculator.add(2, 3));
    }
}
```

Change the expected value to `6` to see a failed assertion, fix it, then choose **Rerun failed**. Existing JUnit 4 sources using `org.junit.Test` and `org.junit.Assert` run through the Vintage engine.

## Existing projects and limits

Maven/Gradle projects use Eclipse JDT LS to import their declared dependencies and resolve the **test** classpath. Declare test dependencies in the project's build file as usual; plain projects can also keep additional JARs under `lib/`. Tests run directly through the IDE's JUnit engines. Custom Maven/Gradle test task hooks, Surefire/Failsafe profiles, custom test engines requiring incompatible JUnit versions, TestNG, coverage and test debugging are not exposed by these actions. Modular dependencies are placed on the test runner's classpath.

Programs and tests execute with the current operating-system user's privileges. Code Together guests need the host's **Allow console and debugging** permission for both compilation and testing; tests execute on the host. Only the host can install tools. Results show up to 10,000 individual rows, with authoritative JUnit totals for the full run. Output history and report sizes are bounded. Initial project import may take longer while dependencies download.

## New file in a folder

Right-click an Explorer folder and choose **New file…**. Enter a filename such as `TEST.java`; BlueGay creates and opens it inside that folder, expands the containing folders, and saves it immediately in desktop projects. Nested relative names are allowed; paths containing `..` are rejected. The project heading offers the same action for the project root. Code Together file creation still requires the host's editing and create/delete permissions.

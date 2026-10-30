import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.junit.platform.engine.*;
import org.junit.platform.engine.discovery.*;
import org.junit.platform.engine.support.descriptor.*;
import org.junit.platform.launcher.*;
import org.junit.platform.launcher.core.*;
import org.junit.platform.launcher.listeners.*;

/** Runs real JUnit engines and writes structured events on a separate channel. */
public class BlueGayTestRunner implements TestExecutionListener {
    private final PrintWriter report;
    private final Map<String, Long> starts = new ConcurrentHashMap<>();
    private TestPlan plan;

    BlueGayTestRunner(Path file) throws IOException {
        report = new PrintWriter(Files.newBufferedWriter(file, StandardCharsets.UTF_8), true);
    }
    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map<?, ?> values) {
            List<String> parts = new ArrayList<>();
            values.forEach((k,v) -> parts.add(json(k.toString()) + ":" + json(v)));
            return "{" + String.join(",", parts) + "}";
        }
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toString().toCharArray()) {
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default: if (c < 32) out.append(String.format("\\u%04x", (int)c)); else out.append(c);
            }
        }
        return out.append('"').toString();
    }
    private synchronized void emit(Map<String,Object> event) { report.println(json(event)); }
    private static void assertionValues(Map<String,Object> event, Throwable error) {
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        for (Throwable cause = error; cause != null && seen.add(cause); cause = cause.getCause()) {
            if (cause instanceof org.opentest4j.AssertionFailedError assertion) {
                if (assertion.isExpectedDefined()) event.put("expected", assertion.getExpected().getStringRepresentation());
                if (assertion.isActualDefined()) event.put("actual", assertion.getActual().getStringRepresentation());
            } else if (cause instanceof org.junit.ComparisonFailure comparison) {
                event.put("expected", String.valueOf(comparison.getExpected()));
                event.put("actual", String.valueOf(comparison.getActual()));
            } else if (cause instanceof junit.framework.ComparisonFailure comparison) {
                event.put("expected", String.valueOf(comparison.getExpected()));
                event.put("actual", String.valueOf(comparison.getActual()));
            } else if (cause instanceof AssertionError && cause.getMessage() != null) {
                // JUnit 4 numeric assertions expose their values only in the message.
                var match = Pattern.compile("expected:\\s*<(.*)> but was:\\s*<(.*)>", Pattern.DOTALL).matcher(cause.getMessage());
                if (match.find()) { event.put("expected", match.group(1)); event.put("actual", match.group(2)); }
            }
            if (event.containsKey("expected") || event.containsKey("actual")) return;
        }
    }
    private Map<String,Object> entry(TestIdentifier test) {
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("event", "test"); result.put("id", test.getUniqueId()); result.put("name", test.getDisplayName());
        result.put("container", !test.isTest());
        TestIdentifier current = test;
        while (current != null) {
            TestSource source = current.getSource().orElse(null);
            if (source instanceof MethodSource method) { result.put("className", method.getClassName()); result.put("methodName", method.getMethodName()); break; }
            if (source instanceof ClassSource type) { result.put("className", type.getClassName()); break; }
            current = plan == null ? null : plan.getParent(current).orElse(null);
        }
        return result;
    }
    @Override public void testPlanExecutionStarted(TestPlan value) {
        plan = value;
        for (TestIdentifier root : value.getRoots()) for (TestIdentifier test : value.getDescendants(root)) {
            if (test.isTest()) { Map<String,Object> event = entry(test); event.put("status", "pending"); emit(event); }
        }
    }
    @Override public void executionStarted(TestIdentifier test) {
        starts.put(test.getUniqueId(), System.nanoTime());
        if (test.isTest()) { Map<String,Object> event = entry(test); event.put("status", "running"); emit(event); }
    }
    @Override public void executionSkipped(TestIdentifier test, String reason) {
        Map<String,Object> event = entry(test); event.put("status", "skipped"); event.put("message", reason);
        if (test.isTest()) emit(event);
        else if (plan != null) for (TestIdentifier child : plan.getDescendants(test)) if (child.isTest()) {
            Map<String,Object> skipped = entry(child); skipped.put("status", "skipped"); skipped.put("message", reason); emit(skipped);
        }
    }
    @Override public void executionFinished(TestIdentifier test, TestExecutionResult result) {
        if (!test.isTest() && result.getStatus() != TestExecutionResult.Status.FAILED) return;
        Map<String,Object> event = entry(test);
        event.put("status", switch (result.getStatus()) { case SUCCESSFUL -> "passed"; case FAILED -> "failed"; case ABORTED -> "skipped"; });
        event.put("duration", (System.nanoTime() - starts.getOrDefault(test.getUniqueId(), System.nanoTime())) / 1_000_000);
        result.getThrowable().ifPresent(error -> {
            event.put("message", error.toString());
            assertionValues(event, error);
            StringWriter trace = new StringWriter(); error.printStackTrace(new PrintWriter(trace));
            String text = trace.toString(); event.put("trace", text.substring(0, Math.min(32000, text.length())));
            String type = String.valueOf(event.getOrDefault("className", ""));
            for (Throwable cause = error; cause != null; cause = cause.getCause()) for (StackTraceElement frame : cause.getStackTrace()) {
                if (frame.getClassName().equals(type) || frame.getClassName().startsWith(type + "$")) {
                    if (!event.containsKey("line") && frame.getLineNumber() > 0) { event.put("line", frame.getLineNumber()); event.put("file", frame.getFileName()); }
                }
            }
        });
        emit(event);
    }
    public static void main(String[] args) throws Exception {
        BlueGayTestRunner listener = new BlueGayTestRunner(Path.of(args[0]));
        int exit = 2;
        try {
            List<DiscoverySelector> selectors = new ArrayList<>();
            if (args[1].equals("class")) selectors.add(DiscoverySelectors.selectClass(args[2]));
            else if (args[1].equals("failed")) for (int i = 3; i < args.length; i++) selectors.add(DiscoverySelectors.selectUniqueId(args[i]));
            else {
                Set<Path> roots = new LinkedHashSet<>();
                for (int i = 3; i < args.length; i++) if (Files.isDirectory(Path.of(args[i]))) roots.add(Path.of(args[i]));
                selectors.addAll(DiscoverySelectors.selectClasspathRoots(roots));
            }
            if (selectors.isEmpty()) throw new IllegalArgumentException("No compiled test roots were found.");
            LauncherDiscoveryRequest request = LauncherDiscoveryRequestBuilder.request().selectors(selectors)
                .filters(ClassNameFilter.includeClassNamePatterns(".*")).build();
            SummaryGeneratingListener summary = new SummaryGeneratingListener();
            Launcher launcher = LauncherFactory.create();
            launcher.registerTestExecutionListeners(summary, listener);
            launcher.execute(request);
            TestExecutionSummary result = summary.getSummary();
            Map<String,Object> done = new LinkedHashMap<>();
            done.put("event", "summary"); done.put("total", result.getTestsFoundCount());
            done.put("passed", result.getTestsSucceededCount()); done.put("failed", result.getTestsFailedCount());
            done.put("skipped", result.getTestsSkippedCount() + result.getTestsAbortedCount());
            done.put("containerFailures", result.getContainersFailedCount()); done.put("duration", result.getTimeFinished() - result.getTimeStarted());
            listener.emit(done);
            exit = result.getTotalFailureCount() > 0 ? 1 : result.getTestsFoundCount() == 0 ? 3 : 0;
        } catch (Throwable error) {
            listener.emit(new LinkedHashMap<>(Map.of("event", "error", "message", error.toString())));
            error.printStackTrace(System.err);
        } finally { listener.report.close(); }
        System.exit(exit);
    }
}

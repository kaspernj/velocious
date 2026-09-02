// @ts-check
import { defaultTestContext } from "@velocious/testing";
/** @typedef {(typeof defaultTestContext.registry.suites)[number]} TestingPackageSuite */
/** @type {WeakSet<TestingPackageSuite>} */
const synchronizedSuites = new WeakSet();
/**
 * Converts public-package declaration options to the legacy runner contract.
 * @param {TestingPackageSuite["options"]} options - Public declaration options.
 * @returns {import("./test-runner.js").TestArgs} - Velocious runner arguments.
 */
function runnerArguments(options) {
    const args = { ...options };
    if (args.retry === undefined && typeof args.retries === "number")
        args.retry = args.retries;
    if (args.timeoutSeconds === undefined && typeof args.timeoutMs === "number") {
        args.timeoutSeconds = args.timeoutMs / 1000;
    }
    return args;
}
/**
 * Converts one public package suite to the Velocious runner's tree shape.
 * @param {TestingPackageSuite} suite - Public suite declaration.
 * @returns {import("./test-runner.js").TestsArgument} - Velocious test tree.
 */
function runnerSuite(suite) {
    /** @type {Record<string, import("./test-runner.js").TestData>} */
    const suiteTests = {};
    /** @type {Record<string, import("./test-runner.js").TestsArgument>} */
    const nestedSuites = {};
    for (const test of suite.tests) {
        suiteTests[test.name] = {
            args: runnerArguments(test.options),
            filePath: test.location.filePath,
            function: test.callback,
            line: test.location.line
        };
    }
    for (const nestedSuite of suite.suites)
        nestedSuites[nestedSuite.name] = runnerSuite(nestedSuite);
    return {
        afterAlls: suite.hooks.afterAll.map((hook) => ({ callback: hook.callback })),
        afterEaches: suite.hooks.afterEach.map((hook) => ({ callback: hook.callback })),
        args: runnerArguments(suite.options),
        beforeAlls: suite.hooks.beforeAll.map((hook) => ({ callback: hook.callback })),
        beforeEaches: suite.hooks.beforeEach.map((hook) => ({ callback: hook.callback })),
        filePath: suite.location.filePath,
        line: suite.location.line,
        subs: nestedSuites,
        tests: suiteTests
    };
}
/**
 * Makes newly imported public-package suites visible to the Velocious runner.
 * @param {import("./test-runner.js").TestsArgument} tests - Velocious root test tree.
 * @returns {void}
 */
export function synchronizeTestingPackageTests(tests) {
    for (const suite of defaultTestContext.registry.suites) {
        if (synchronizedSuites.has(suite))
            continue;
        if (tests.subs[suite.name])
            throw new Error(`Duplicate test description: ${suite.name}`);
        tests.subs[suite.name] = runnerSuite(suite);
        synchronizedSuites.add(suite);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdGluZy1wYWNrYWdlLWFkYXB0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0aW5nLXBhY2thZ2UtYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLGtCQUFrQixFQUFDLE1BQU0sb0JBQW9CLENBQUE7QUFFckQseUZBQXlGO0FBRXpGLDJDQUEyQztBQUMzQyxNQUFNLGtCQUFrQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFeEM7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLE9BQU87SUFDOUIsTUFBTSxJQUFJLEdBQUcsRUFBQyxHQUFHLE9BQU8sRUFBQyxDQUFBO0lBRXpCLElBQUksSUFBSSxDQUFDLEtBQUssS0FBSyxTQUFTLElBQUksT0FBTyxJQUFJLENBQUMsT0FBTyxLQUFLLFFBQVE7UUFBRSxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUE7SUFDM0YsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsSUFBSSxPQUFPLElBQUksQ0FBQyxTQUFTLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDNUUsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQTtJQUM3QyxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLEtBQUs7SUFDeEIsa0VBQWtFO0lBQ2xFLE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtJQUNyQix1RUFBdUU7SUFDdkUsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFBO0lBRXZCLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQy9CLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUc7WUFDdEIsSUFBSSxFQUFFLGVBQWUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDO1lBQ25DLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVE7WUFDaEMsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3ZCLElBQUksRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUk7U0FDekIsQ0FBQTtJQUNILENBQUM7SUFFRCxLQUFLLE1BQU0sV0FBVyxJQUFJLEtBQUssQ0FBQyxNQUFNO1FBQUUsWUFBWSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsR0FBRyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUE7SUFFakcsT0FBTztRQUNMLFNBQVMsRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBQyxDQUFDLENBQUM7UUFDMUUsV0FBVyxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQztRQUM3RSxJQUFJLEVBQUUsZUFBZSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUM7UUFDcEMsVUFBVSxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQztRQUM1RSxZQUFZLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRLEVBQUMsQ0FBQyxDQUFDO1FBQy9FLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLFFBQVE7UUFDakMsSUFBSSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSTtRQUN6QixJQUFJLEVBQUUsWUFBWTtRQUNsQixLQUFLLEVBQUUsVUFBVTtLQUNsQixDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUsOEJBQThCLENBQUMsS0FBSztJQUNsRCxLQUFLLE1BQU0sS0FBSyxJQUFJLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUN2RCxJQUFJLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUM7WUFBRSxTQUFRO1FBQzNDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywrQkFBK0IsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUE7UUFFeEYsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQzNDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMvQixDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2RlZmF1bHRUZXN0Q29udGV4dH0gZnJvbSBcIkB2ZWxvY2lvdXMvdGVzdGluZ1wiXG5cbi8qKiBAdHlwZWRlZiB7KHR5cGVvZiBkZWZhdWx0VGVzdENvbnRleHQucmVnaXN0cnkuc3VpdGVzKVtudW1iZXJdfSBUZXN0aW5nUGFja2FnZVN1aXRlICovXG5cbi8qKiBAdHlwZSB7V2Vha1NldDxUZXN0aW5nUGFja2FnZVN1aXRlPn0gKi9cbmNvbnN0IHN5bmNocm9uaXplZFN1aXRlcyA9IG5ldyBXZWFrU2V0KClcblxuLyoqXG4gKiBDb252ZXJ0cyBwdWJsaWMtcGFja2FnZSBkZWNsYXJhdGlvbiBvcHRpb25zIHRvIHRoZSBsZWdhY3kgcnVubmVyIGNvbnRyYWN0LlxuICogQHBhcmFtIHtUZXN0aW5nUGFja2FnZVN1aXRlW1wib3B0aW9uc1wiXX0gb3B0aW9ucyAtIFB1YmxpYyBkZWNsYXJhdGlvbiBvcHRpb25zLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdEFyZ3N9IC0gVmVsb2Npb3VzIHJ1bm5lciBhcmd1bWVudHMuXG4gKi9cbmZ1bmN0aW9uIHJ1bm5lckFyZ3VtZW50cyhvcHRpb25zKSB7XG4gIGNvbnN0IGFyZ3MgPSB7Li4ub3B0aW9uc31cblxuICBpZiAoYXJncy5yZXRyeSA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBhcmdzLnJldHJpZXMgPT09IFwibnVtYmVyXCIpIGFyZ3MucmV0cnkgPSBhcmdzLnJldHJpZXNcbiAgaWYgKGFyZ3MudGltZW91dFNlY29uZHMgPT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgYXJncy50aW1lb3V0TXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICBhcmdzLnRpbWVvdXRTZWNvbmRzID0gYXJncy50aW1lb3V0TXMgLyAxMDAwXG4gIH1cblxuICByZXR1cm4gYXJnc1xufVxuXG4vKipcbiAqIENvbnZlcnRzIG9uZSBwdWJsaWMgcGFja2FnZSBzdWl0ZSB0byB0aGUgVmVsb2Npb3VzIHJ1bm5lcidzIHRyZWUgc2hhcGUuXG4gKiBAcGFyYW0ge1Rlc3RpbmdQYWNrYWdlU3VpdGV9IHN1aXRlIC0gUHVibGljIHN1aXRlIGRlY2xhcmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdHNBcmd1bWVudH0gLSBWZWxvY2lvdXMgdGVzdCB0cmVlLlxuICovXG5mdW5jdGlvbiBydW5uZXJTdWl0ZShzdWl0ZSkge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdERhdGE+fSAqL1xuICBjb25zdCBzdWl0ZVRlc3RzID0ge31cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3RzQXJndW1lbnQ+fSAqL1xuICBjb25zdCBuZXN0ZWRTdWl0ZXMgPSB7fVxuXG4gIGZvciAoY29uc3QgdGVzdCBvZiBzdWl0ZS50ZXN0cykge1xuICAgIHN1aXRlVGVzdHNbdGVzdC5uYW1lXSA9IHtcbiAgICAgIGFyZ3M6IHJ1bm5lckFyZ3VtZW50cyh0ZXN0Lm9wdGlvbnMpLFxuICAgICAgZmlsZVBhdGg6IHRlc3QubG9jYXRpb24uZmlsZVBhdGgsXG4gICAgICBmdW5jdGlvbjogdGVzdC5jYWxsYmFjayxcbiAgICAgIGxpbmU6IHRlc3QubG9jYXRpb24ubGluZVxuICAgIH1cbiAgfVxuXG4gIGZvciAoY29uc3QgbmVzdGVkU3VpdGUgb2Ygc3VpdGUuc3VpdGVzKSBuZXN0ZWRTdWl0ZXNbbmVzdGVkU3VpdGUubmFtZV0gPSBydW5uZXJTdWl0ZShuZXN0ZWRTdWl0ZSlcblxuICByZXR1cm4ge1xuICAgIGFmdGVyQWxsczogc3VpdGUuaG9va3MuYWZ0ZXJBbGwubWFwKChob29rKSA9PiAoe2NhbGxiYWNrOiBob29rLmNhbGxiYWNrfSkpLFxuICAgIGFmdGVyRWFjaGVzOiBzdWl0ZS5ob29rcy5hZnRlckVhY2gubWFwKChob29rKSA9PiAoe2NhbGxiYWNrOiBob29rLmNhbGxiYWNrfSkpLFxuICAgIGFyZ3M6IHJ1bm5lckFyZ3VtZW50cyhzdWl0ZS5vcHRpb25zKSxcbiAgICBiZWZvcmVBbGxzOiBzdWl0ZS5ob29rcy5iZWZvcmVBbGwubWFwKChob29rKSA9PiAoe2NhbGxiYWNrOiBob29rLmNhbGxiYWNrfSkpLFxuICAgIGJlZm9yZUVhY2hlczogc3VpdGUuaG9va3MuYmVmb3JlRWFjaC5tYXAoKGhvb2spID0+ICh7Y2FsbGJhY2s6IGhvb2suY2FsbGJhY2t9KSksXG4gICAgZmlsZVBhdGg6IHN1aXRlLmxvY2F0aW9uLmZpbGVQYXRoLFxuICAgIGxpbmU6IHN1aXRlLmxvY2F0aW9uLmxpbmUsXG4gICAgc3ViczogbmVzdGVkU3VpdGVzLFxuICAgIHRlc3RzOiBzdWl0ZVRlc3RzXG4gIH1cbn1cblxuLyoqXG4gKiBNYWtlcyBuZXdseSBpbXBvcnRlZCBwdWJsaWMtcGFja2FnZSBzdWl0ZXMgdmlzaWJsZSB0byB0aGUgVmVsb2Npb3VzIHJ1bm5lci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UZXN0c0FyZ3VtZW50fSB0ZXN0cyAtIFZlbG9jaW91cyByb290IHRlc3QgdHJlZS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5leHBvcnQgZnVuY3Rpb24gc3luY2hyb25pemVUZXN0aW5nUGFja2FnZVRlc3RzKHRlc3RzKSB7XG4gIGZvciAoY29uc3Qgc3VpdGUgb2YgZGVmYXVsdFRlc3RDb250ZXh0LnJlZ2lzdHJ5LnN1aXRlcykge1xuICAgIGlmIChzeW5jaHJvbml6ZWRTdWl0ZXMuaGFzKHN1aXRlKSkgY29udGludWVcbiAgICBpZiAodGVzdHMuc3Vic1tzdWl0ZS5uYW1lXSkgdGhyb3cgbmV3IEVycm9yKGBEdXBsaWNhdGUgdGVzdCBkZXNjcmlwdGlvbjogJHtzdWl0ZS5uYW1lfWApXG5cbiAgICB0ZXN0cy5zdWJzW3N1aXRlLm5hbWVdID0gcnVubmVyU3VpdGUoc3VpdGUpXG4gICAgc3luY2hyb25pemVkU3VpdGVzLmFkZChzdWl0ZSlcbiAgfVxufVxuIl19
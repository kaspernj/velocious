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
 * @param {import("./test-runner.js").TestArgs} inheritedArgs - Arguments inherited from the parent scope.
 * @returns {import("./test-runner.js").TestsArgument} - Velocious test tree.
 */
function runnerSuite(suite, inheritedArgs) {
    /** @type {Record<string, import("./test-runner.js").TestData>} */
    const suiteTests = {};
    /** @type {Record<string, import("./test-runner.js").TestsArgument>} */
    const nestedSuites = {};
    const suiteArgs = { ...inheritedArgs, ...runnerArguments(suite.options) };
    for (const test of suite.tests) {
        suiteTests[test.name] = {
            args: { ...suiteArgs, ...runnerArguments(test.options) },
            filePath: test.location.filePath,
            function: test.callback,
            line: test.location.line
        };
    }
    for (const nestedSuite of suite.suites)
        nestedSuites[nestedSuite.name] = runnerSuite(nestedSuite, suiteArgs);
    return {
        afterAlls: suite.hooks.afterAll.map((hook) => ({ callback: hook.callback })),
        afterEaches: suite.hooks.afterEach.map((hook) => ({ callback: hook.callback })),
        args: suiteArgs,
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
        tests.subs[suite.name] = runnerSuite(suite, tests.args);
        synchronizedSuites.add(suite);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdGluZy1wYWNrYWdlLWFkYXB0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0aW5nLXBhY2thZ2UtYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLGtCQUFrQixFQUFDLE1BQU0sb0JBQW9CLENBQUE7QUFFckQseUZBQXlGO0FBRXpGLDJDQUEyQztBQUMzQyxNQUFNLGtCQUFrQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFeEM7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLE9BQU87SUFDOUIsTUFBTSxJQUFJLEdBQUcsRUFBQyxHQUFHLE9BQU8sRUFBQyxDQUFBO0lBRXpCLElBQUksSUFBSSxDQUFDLEtBQUssS0FBSyxTQUFTLElBQUksT0FBTyxJQUFJLENBQUMsT0FBTyxLQUFLLFFBQVE7UUFBRSxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUE7SUFDM0YsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsSUFBSSxPQUFPLElBQUksQ0FBQyxTQUFTLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDNUUsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQTtJQUM3QyxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLFdBQVcsQ0FBQyxLQUFLLEVBQUUsYUFBYTtJQUN2QyxrRUFBa0U7SUFDbEUsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFBO0lBQ3JCLHVFQUF1RTtJQUN2RSxNQUFNLFlBQVksR0FBRyxFQUFFLENBQUE7SUFDdkIsTUFBTSxTQUFTLEdBQUcsRUFBQyxHQUFHLGFBQWEsRUFBRSxHQUFHLGVBQWUsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUMsQ0FBQTtJQUV2RSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMvQixVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHO1lBQ3RCLElBQUksRUFBRSxFQUFDLEdBQUcsU0FBUyxFQUFFLEdBQUcsZUFBZSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBQztZQUN0RCxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRO1lBQ2hDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtZQUN2QixJQUFJLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJO1NBQ3pCLENBQUE7SUFDSCxDQUFDO0lBRUQsS0FBSyxNQUFNLFdBQVcsSUFBSSxLQUFLLENBQUMsTUFBTTtRQUFFLFlBQVksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsV0FBVyxDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQTtJQUU1RyxPQUFPO1FBQ0wsU0FBUyxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQztRQUMxRSxXQUFXLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRLEVBQUMsQ0FBQyxDQUFDO1FBQzdFLElBQUksRUFBRSxTQUFTO1FBQ2YsVUFBVSxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQztRQUM1RSxZQUFZLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRLEVBQUMsQ0FBQyxDQUFDO1FBQy9FLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLFFBQVE7UUFDakMsSUFBSSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSTtRQUN6QixJQUFJLEVBQUUsWUFBWTtRQUNsQixLQUFLLEVBQUUsVUFBVTtLQUNsQixDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUsOEJBQThCLENBQUMsS0FBSztJQUNsRCxLQUFLLE1BQU0sS0FBSyxJQUFJLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUN2RCxJQUFJLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUM7WUFBRSxTQUFRO1FBQzNDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywrQkFBK0IsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUE7UUFFeEYsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsV0FBVyxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDdkQsa0JBQWtCLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQy9CLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZGVmYXVsdFRlc3RDb250ZXh0fSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nXCJcblxuLyoqIEB0eXBlZGVmIHsodHlwZW9mIGRlZmF1bHRUZXN0Q29udGV4dC5yZWdpc3RyeS5zdWl0ZXMpW251bWJlcl19IFRlc3RpbmdQYWNrYWdlU3VpdGUgKi9cblxuLyoqIEB0eXBlIHtXZWFrU2V0PFRlc3RpbmdQYWNrYWdlU3VpdGU+fSAqL1xuY29uc3Qgc3luY2hyb25pemVkU3VpdGVzID0gbmV3IFdlYWtTZXQoKVxuXG4vKipcbiAqIENvbnZlcnRzIHB1YmxpYy1wYWNrYWdlIGRlY2xhcmF0aW9uIG9wdGlvbnMgdG8gdGhlIGxlZ2FjeSBydW5uZXIgY29udHJhY3QuXG4gKiBAcGFyYW0ge1Rlc3RpbmdQYWNrYWdlU3VpdGVbXCJvcHRpb25zXCJdfSBvcHRpb25zIC0gUHVibGljIGRlY2xhcmF0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UZXN0QXJnc30gLSBWZWxvY2lvdXMgcnVubmVyIGFyZ3VtZW50cy5cbiAqL1xuZnVuY3Rpb24gcnVubmVyQXJndW1lbnRzKG9wdGlvbnMpIHtcbiAgY29uc3QgYXJncyA9IHsuLi5vcHRpb25zfVxuXG4gIGlmIChhcmdzLnJldHJ5ID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIGFyZ3MucmV0cmllcyA9PT0gXCJudW1iZXJcIikgYXJncy5yZXRyeSA9IGFyZ3MucmV0cmllc1xuICBpZiAoYXJncy50aW1lb3V0U2Vjb25kcyA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBhcmdzLnRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIikge1xuICAgIGFyZ3MudGltZW91dFNlY29uZHMgPSBhcmdzLnRpbWVvdXRNcyAvIDEwMDBcbiAgfVxuXG4gIHJldHVybiBhcmdzXG59XG5cbi8qKlxuICogQ29udmVydHMgb25lIHB1YmxpYyBwYWNrYWdlIHN1aXRlIHRvIHRoZSBWZWxvY2lvdXMgcnVubmVyJ3MgdHJlZSBzaGFwZS5cbiAqIEBwYXJhbSB7VGVzdGluZ1BhY2thZ2VTdWl0ZX0gc3VpdGUgLSBQdWJsaWMgc3VpdGUgZGVjbGFyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdEFyZ3N9IGluaGVyaXRlZEFyZ3MgLSBBcmd1bWVudHMgaW5oZXJpdGVkIGZyb20gdGhlIHBhcmVudCBzY29wZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3RzQXJndW1lbnR9IC0gVmVsb2Npb3VzIHRlc3QgdHJlZS5cbiAqL1xuZnVuY3Rpb24gcnVubmVyU3VpdGUoc3VpdGUsIGluaGVyaXRlZEFyZ3MpIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3REYXRhPn0gKi9cbiAgY29uc3Qgc3VpdGVUZXN0cyA9IHt9XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UZXN0c0FyZ3VtZW50Pn0gKi9cbiAgY29uc3QgbmVzdGVkU3VpdGVzID0ge31cbiAgY29uc3Qgc3VpdGVBcmdzID0gey4uLmluaGVyaXRlZEFyZ3MsIC4uLnJ1bm5lckFyZ3VtZW50cyhzdWl0ZS5vcHRpb25zKX1cblxuICBmb3IgKGNvbnN0IHRlc3Qgb2Ygc3VpdGUudGVzdHMpIHtcbiAgICBzdWl0ZVRlc3RzW3Rlc3QubmFtZV0gPSB7XG4gICAgICBhcmdzOiB7Li4uc3VpdGVBcmdzLCAuLi5ydW5uZXJBcmd1bWVudHModGVzdC5vcHRpb25zKX0sXG4gICAgICBmaWxlUGF0aDogdGVzdC5sb2NhdGlvbi5maWxlUGF0aCxcbiAgICAgIGZ1bmN0aW9uOiB0ZXN0LmNhbGxiYWNrLFxuICAgICAgbGluZTogdGVzdC5sb2NhdGlvbi5saW5lXG4gICAgfVxuICB9XG5cbiAgZm9yIChjb25zdCBuZXN0ZWRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIG5lc3RlZFN1aXRlc1tuZXN0ZWRTdWl0ZS5uYW1lXSA9IHJ1bm5lclN1aXRlKG5lc3RlZFN1aXRlLCBzdWl0ZUFyZ3MpXG5cbiAgcmV0dXJuIHtcbiAgICBhZnRlckFsbHM6IHN1aXRlLmhvb2tzLmFmdGVyQWxsLm1hcCgoaG9vaykgPT4gKHtjYWxsYmFjazogaG9vay5jYWxsYmFja30pKSxcbiAgICBhZnRlckVhY2hlczogc3VpdGUuaG9va3MuYWZ0ZXJFYWNoLm1hcCgoaG9vaykgPT4gKHtjYWxsYmFjazogaG9vay5jYWxsYmFja30pKSxcbiAgICBhcmdzOiBzdWl0ZUFyZ3MsXG4gICAgYmVmb3JlQWxsczogc3VpdGUuaG9va3MuYmVmb3JlQWxsLm1hcCgoaG9vaykgPT4gKHtjYWxsYmFjazogaG9vay5jYWxsYmFja30pKSxcbiAgICBiZWZvcmVFYWNoZXM6IHN1aXRlLmhvb2tzLmJlZm9yZUVhY2gubWFwKChob29rKSA9PiAoe2NhbGxiYWNrOiBob29rLmNhbGxiYWNrfSkpLFxuICAgIGZpbGVQYXRoOiBzdWl0ZS5sb2NhdGlvbi5maWxlUGF0aCxcbiAgICBsaW5lOiBzdWl0ZS5sb2NhdGlvbi5saW5lLFxuICAgIHN1YnM6IG5lc3RlZFN1aXRlcyxcbiAgICB0ZXN0czogc3VpdGVUZXN0c1xuICB9XG59XG5cbi8qKlxuICogTWFrZXMgbmV3bHkgaW1wb3J0ZWQgcHVibGljLXBhY2thZ2Ugc3VpdGVzIHZpc2libGUgdG8gdGhlIFZlbG9jaW91cyBydW5uZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdHNBcmd1bWVudH0gdGVzdHMgLSBWZWxvY2lvdXMgcm9vdCB0ZXN0IHRyZWUuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN5bmNocm9uaXplVGVzdGluZ1BhY2thZ2VUZXN0cyh0ZXN0cykge1xuICBmb3IgKGNvbnN0IHN1aXRlIG9mIGRlZmF1bHRUZXN0Q29udGV4dC5yZWdpc3RyeS5zdWl0ZXMpIHtcbiAgICBpZiAoc3luY2hyb25pemVkU3VpdGVzLmhhcyhzdWl0ZSkpIGNvbnRpbnVlXG4gICAgaWYgKHRlc3RzLnN1YnNbc3VpdGUubmFtZV0pIHRocm93IG5ldyBFcnJvcihgRHVwbGljYXRlIHRlc3QgZGVzY3JpcHRpb246ICR7c3VpdGUubmFtZX1gKVxuXG4gICAgdGVzdHMuc3Vic1tzdWl0ZS5uYW1lXSA9IHJ1bm5lclN1aXRlKHN1aXRlLCB0ZXN0cy5hcmdzKVxuICAgIHN5bmNocm9uaXplZFN1aXRlcy5hZGQoc3VpdGUpXG4gIH1cbn1cbiJdfQ==
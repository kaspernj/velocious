// @ts-check
import BaseCommand from "../../../../cli/base-command.js";
import fs from "fs/promises";
import path from "node:path";
import picocolors from "picocolors";
import TestFilesFinder from "../../../../testing/test-files-finder.js";
import TestProfiler from "../../../../testing/test-profiler.js";
import { formatTestProfileSummary, writeTestProfileOutputs } from "../../../../testing/test-profile-output.js";
import TestRunner from "../../../../testing/test-runner.js";
import TestSuiteSplitter from "../../../../testing/test-suite-splitter.js";
import { normalizeExamplePatterns, parseFilters } from "../../../../testing/test-filter-parser.js";
import { canonicalTimingManifestPath, timingManifestFileSetHash, validateTimingManifest } from "../../../../testing/timing-manifest.js";
import { prepareSourcePeerPackage } from "../../source-peer-package.js";
export default class VelociousCliCommandsTest extends BaseCommand {
    async execute() {
        await prepareSourcePeerPackage();
        this.getConfiguration().setEnvironment("test");
        let directory;
        const directories = [];
        if (process.env.VELOCIOUS_TEST_DIR) {
            directory = process.env.VELOCIOUS_TEST_DIR;
            directories.push(process.env.VELOCIOUS_TEST_DIR);
        }
        else {
            directory = this.directory();
            directories.push(`${this.directory()}/__tests__`);
            directories.push(`${this.directory()}/tests`);
            directories.push(`${this.directory()}/spec`);
        }
        const { includeTags, excludeTags, examplePatterns, filteredProcessArgs, groups, groupNumber, profile, profileJsonPath, timingManifestPath, timingManifestOutputPath } = parseFilters(this.processArgs || []);
        const profileOptions = resolveTestProfileOptions({
            cwd: process.cwd(),
            profile,
            profileJsonPath,
            timingManifestPath,
            timingManifestOutputPath
        });
        const selection = {
            excludeTagCount: excludeTags.length,
            hasExampleFilters: examplePatterns.length > 0,
            includeTagCount: includeTags.length,
            shard: groups !== undefined && groupNumber !== undefined ? { groups, groupNumber } : undefined
        };
        const profiler = profileOptions.profile
            ? new TestProfiler({ configuration: this.getConfiguration(), projectDirectory: directory, selection })
            : undefined;
        const testFilesFinder = new TestFilesFinder({ directory, directories, processArgs: filteredProcessArgs });
        /** @type {TestRunner | undefined} */
        let testRunner;
        let profileFinalized = false;
        /**
         * Finalizes requested outputs once for every command outcome.
         * @param {string} status - Run status.
         * @returns {Promise<void>} - Resolves after requested outputs are written.
         */
        const finalizeProfile = async (status) => {
            if (!profiler || profileFinalized)
                return;
            profileFinalized = true;
            const failed = testRunner?.getFailedTests() ?? 0;
            const passed = testRunner?.getSuccessfulTests() ?? 0;
            const profileDocument = profiler.finish({
                counts: {
                    discovered: testRunner?.getTestsCount() ?? 0,
                    executed: testRunner?.getExecutedTestsCount() ?? 0,
                    failed,
                    passed
                },
                focused: Boolean(testRunner?.anyTestsFocussed),
                status
            });
            await writeTestProfileOutputs({
                profile: profileDocument,
                profileJsonPath: profileOptions.profileJsonPath,
                timingManifestOutputPath: profileOptions.timingManifestOutputPath
            });
            console.log(`\n${formatTestProfileSummary(profileDocument, profileOptions)}`);
        };
        try {
            const discoverTestFiles = async () => {
                const timingManifest = await loadTimingManifest(profileOptions.timingManifestPath);
                let discoveredTestFiles = await testFilesFinder.findTestFiles();
                const lineFilters = testFilesFinder.getLineFiltersByFile();
                if (profiler) {
                    const discoveredFilePaths = discoveredTestFiles.map((filePath) => {
                        return canonicalTimingManifestPath(path.relative(directory, filePath));
                    });
                    profiler.setSelection({
                        discoveredFileCount: discoveredTestFiles.length,
                        hasLineFilters: Object.keys(lineFilters).length > 0,
                        pathBase: process.env.VELOCIOUS_TEST_DIR ? "test-directory" : "configuration-directory",
                        testFileSetHash: timingManifestFileSetHash(discoveredFilePaths)
                    });
                }
                if (groups !== undefined || groupNumber !== undefined) {
                    if (groups === undefined || groupNumber === undefined) {
                        throw new Error("Both --groups and --group-number must be provided together");
                    }
                    const splitter = new TestSuiteSplitter({
                        groups,
                        groupNumber,
                        testFiles: discoveredTestFiles,
                        baseDirectory: directory,
                        timingManifest
                    });
                    if (profileOptions.timingManifestPath) {
                        const coverage = splitter.getTimingManifestCoverage();
                        console.log(picocolors.cyan(`Timing manifest coverage: measured=${coverage.measuredFiles} ` +
                            `heuristic=${coverage.heuristicFiles} stale=${coverage.staleEntries}`));
                    }
                    discoveredTestFiles = splitter.getGroupFiles();
                    console.log(picocolors.cyan(`Running group ${groupNumber} of ${groups} (${discoveredTestFiles.length} files)`));
                }
                return discoveredTestFiles;
            };
            const testFiles = profiler
                ? await profiler.measurePhase("discovery", discoverTestFiles)
                : await discoverTestFiles();
            profiler?.setSelection({ fileCount: testFiles.length });
            testRunner = new TestRunner({
                configuration: this.getConfiguration(),
                excludeTags,
                includeTags,
                testFiles,
                lineFilters: testFilesFinder.getLineFiltersByFile(),
                examplePatterns: normalizeExamplePatterns(examplePatterns),
                profiler
            });
            const activeTestRunner = testRunner;
            let signalHandled = false;
            const handleSignal = async (/** @type {string} */ signal) => {
                if (signalHandled)
                    return;
                signalHandled = true;
                profiler?.interrupt();
                console.error(`\nReceived ${signal}, running afterAll hooks before exit...`);
                try {
                    await activeTestRunner.runAfterAllsForActiveScopes();
                }
                catch (error) {
                    console.error("Failed while running afterAll hooks:", error);
                }
                finally {
                    try {
                        await finalizeProfile("interrupted");
                    }
                    catch (error) {
                        console.error("Failed while writing interrupted test profile:", error);
                    }
                    process.exit(130);
                }
            };
            process.once("SIGINT", () => { void handleSignal("SIGINT"); });
            process.once("SIGTERM", () => { void handleSignal("SIGTERM"); });
            await testRunner.prepare();
            const effectiveExcludeTagCount = testRunner.getExcludeTagSet().size;
            profiler?.setSelection({ excludeTagCount: effectiveExcludeTagCount });
            if (testRunner.getTestsCount() === 0) {
                await finalizeProfile("no-tests");
                throw new Error(`${testRunner.getTestsCount()} tests was found in ${testFiles.length} file(s)`);
            }
            await testRunner.run();
            const executedTests = testRunner.getExecutedTestsCount();
            const lineFilters = testRunner.getLineFilters();
            const hasLineFilters = Object.keys(lineFilters).length > 0;
            const hasExampleFilters = examplePatterns.length > 0;
            const hasTagFilters = includeTags.length > 0 || effectiveExcludeTagCount > 0;
            if ((hasTagFilters || hasLineFilters || hasExampleFilters) && executedTests === 0 && !testRunner.isFailed()) {
                console.error(picocolors.red("\nNo tests matched the provided filters"));
                await finalizeProfile("no-tests");
                process.exit(1);
            }
            // Report the slowest tests so suite hotspots are visible every run. Defaults to
            // the top 10; tune with VELOCIOUS_SLOW_TEST_COUNT (0 disables). Skipped for
            // single-test runs where it would just be noise.
            const slowTestCount = resolveSlowTestCount(process.env.VELOCIOUS_SLOW_TEST_COUNT);
            if (slowTestCount > 0 && executedTests > 1) {
                const slowestTests = testRunner.getSlowestTests(slowTestCount);
                if (slowestTests.length > 0) {
                    console.log(picocolors.cyan(`\nSlowest ${slowestTests.length} tests:`));
                    for (const slowTest of slowestTests) {
                        const location = slowTest.filePath && slowTest.line ? ` (${slowTest.filePath}:${slowTest.line})` : "";
                        console.log(picocolors.cyan(`  ${String(slowTest.durationMs).padStart(6)}ms  ${slowTest.fullDescription}${location}`));
                    }
                }
            }
            if (testRunner.isFailed()) {
                await testRunner.persistFailedTestConsoleOutputsToAssets();
                const failedTests = testRunner.getFailedTestDetails();
                if (failedTests.length > 0) {
                    console.error(picocolors.red("\nFailed tests:"));
                    for (const failed of failedTests) {
                        const location = failed.filePath && failed.line
                            ? ` (${failed.filePath}:${failed.line})`
                            : "";
                        console.error(picocolors.red(`- ${failed.fullDescription}${location}`));
                        if (failed.consoleLogPath) {
                            console.error(picocolors.red(`  Console log: ${failed.consoleLogPath}`));
                        }
                    }
                }
                if (testRunner.getNotRunTests() > 0)
                    console.error(`${testRunner.getNotRunTests()} tests not run because a shared resource failed`);
                console.error(picocolors.red(`\nTest run failed with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`));
                await finalizeProfile("failed");
                process.exit(1);
            }
            else if (testRunner.areAnyTestsFocussed()) {
                console.error(picocolors.red(`\nFocussed run with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`));
                await finalizeProfile("focused");
                process.exit(1);
            }
            else {
                console.log(picocolors.green(`\nTest run succeeded with ${testRunner.getSuccessfulTests()} successful tests`));
                await finalizeProfile("passed");
                process.exit(0);
            }
        }
        catch (error) {
            try {
                await finalizeProfile("error");
            }
            catch (profileError) {
                throw new AggregateError([error, profileError], "Test command and profile finalization both failed", { cause: profileError });
            }
            throw error;
        }
    }
}
/**
 * Resolves and validates profiling paths before test discovery starts.
 * @param {object} args - Raw profiling options.
 * @param {string} args.cwd - Command working directory.
 * @param {boolean} args.profile - Whether console profiling was requested.
 * @param {string} [args.profileJsonPath] - Rich profile output path.
 * @param {string} [args.timingManifestPath] - Timing manifest input path.
 * @param {string} [args.timingManifestOutputPath] - Timing manifest output path.
 * @returns {{profile: boolean, profileJsonPath: string | undefined, timingManifestPath: string | undefined, timingManifestOutputPath: string | undefined}} - Resolved profiling options.
 */
export function resolveTestProfileOptions({ cwd, profile, profileJsonPath, timingManifestPath, timingManifestOutputPath }) {
    const resolvedProfileJsonPath = profileJsonPath ? path.resolve(cwd, profileJsonPath) : undefined;
    const resolvedTimingManifestPath = timingManifestPath ? path.resolve(cwd, timingManifestPath) : undefined;
    const resolvedTimingManifestOutputPath = timingManifestOutputPath
        ? path.resolve(cwd, timingManifestOutputPath)
        : undefined;
    if (resolvedProfileJsonPath && resolvedTimingManifestOutputPath && resolvedProfileJsonPath === resolvedTimingManifestOutputPath) {
        throw new Error("Test profiling output paths must be different");
    }
    if (resolvedTimingManifestPath && (resolvedProfileJsonPath === resolvedTimingManifestPath ||
        resolvedTimingManifestOutputPath === resolvedTimingManifestPath)) {
        throw new Error("Test profiling outputs must not overwrite --timing-manifest input");
    }
    return {
        profile: profile || Boolean(resolvedProfileJsonPath || resolvedTimingManifestOutputPath),
        profileJsonPath: resolvedProfileJsonPath,
        timingManifestPath: resolvedTimingManifestPath,
        timingManifestOutputPath: resolvedTimingManifestOutputPath
    };
}
/**
 * Loads and validates an explicitly supplied plain JSON timing manifest.
 * @param {string | undefined} timingManifestPath - Timing manifest path.
 * @returns {Promise<Record<string, number> | undefined>} - Canonical manifest, or undefined when not requested.
 */
export async function loadTimingManifest(timingManifestPath) {
    if (!timingManifestPath)
        return undefined;
    let content;
    try {
        content = await fs.readFile(timingManifestPath, "utf8");
    }
    catch (error) {
        throw new Error(`Failed to read timing manifest: ${timingManifestPath}`, { cause: error });
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (error) {
        throw new Error(`Failed to parse timing manifest: ${timingManifestPath}`, { cause: error });
    }
    return validateTimingManifest(parsed, { source: `Timing manifest ${timingManifestPath}` });
}
/**
 * Resolves how many slowest tests to report from the `VELOCIOUS_SLOW_TEST_COUNT`
 * env value: defaults to 10 when unset; 0 (or an unparseable value) disables the
 * report; otherwise the floored, non-negative integer.
 * @param {string | undefined} rawEnvValue - Raw env value.
 * @returns {number} - Number of slowest tests to report (0 disables).
 */
export function resolveSlowTestCount(rawEnvValue) {
    if (rawEnvValue === undefined)
        return 10;
    return Math.max(0, Math.floor(Number(rawEnvValue)) || 0);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy90ZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN6RCxPQUFPLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDNUIsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8sVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUNuQyxPQUFPLGVBQWUsTUFBTSwwQ0FBMEMsQ0FBQTtBQUN0RSxPQUFPLFlBQVksTUFBTSxzQ0FBc0MsQ0FBQTtBQUMvRCxPQUFPLEVBQUUsd0JBQXdCLEVBQUUsdUJBQXVCLEVBQUUsTUFBTSw0Q0FBNEMsQ0FBQTtBQUM5RyxPQUFPLFVBQVUsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRCxPQUFPLGlCQUFpQixNQUFNLDRDQUE0QyxDQUFBO0FBQzFFLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxZQUFZLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNsRyxPQUFPLEVBQ0wsMkJBQTJCLEVBQzNCLHlCQUF5QixFQUN6QixzQkFBc0IsRUFDdkIsTUFBTSx3Q0FBd0MsQ0FBQTtBQUMvQyxPQUFPLEVBQUUsd0JBQXdCLEVBQUUsTUFBTSw4QkFBOEIsQ0FBQTtBQUV2RSxNQUFNLENBQUMsT0FBTyxPQUFPLHdCQUF5QixTQUFRLFdBQVc7SUFDL0QsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLHdCQUF3QixFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRTlDLElBQUksU0FBUyxDQUFBO1FBQ2IsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBRXRCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lB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QUssVUFBVSxrQkFBa0IsQ0FBQyxrQkFBa0I7SUFDekQsSUFBSSxDQUFDLGtCQUFrQjtRQUFFLE9BQU8sU0FBUyxDQUFBO0lBRXpDLElBQUksT0FBTyxDQUFBO0lBRVgsSUFBSSxDQUFDO1FBQ0gsT0FBTyxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsRUFBRSxNQUFNLENBQUMsQ0FBQTtJQUN6RCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsbUNBQW1DLGtCQUFrQixFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtJQUMxRixDQUFDO0lBRUQsSUFBSSxNQUFNLENBQUE7SUFFVixJQUFJLENBQUM7UUFDSCxNQUFNLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUM5QixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLGtCQUFrQixFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtJQUMzRixDQUFDO0lBRUQsT0FBTyxzQkFBc0IsQ0FBQyxNQUFNLEVBQUUsRUFBQyxNQUFNLEVBQUUsbUJBQW1CLGtCQUFrQixFQUFFLEVBQUMsQ0FBQyxDQUFBO0FBQzFGLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxNQUFNLFVBQVUsb0JBQW9CLENBQUMsV0FBVztJQUM5QyxJQUFJLFdBQVcsS0FBSyxTQUFTO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFeEMsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0FBQzFELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi8uLi9jbGkvYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgVGVzdEZpbGVzRmluZGVyIGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3QtZmlsZXMtZmluZGVyLmpzXCJcbmltcG9ydCBUZXN0UHJvZmlsZXIgZnJvbSBcIi4uLy4uLy4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiXG5pbXBvcnQgeyBmb3JtYXRUZXN0UHJvZmlsZVN1bW1hcnksIHdyaXRlVGVzdFByb2ZpbGVPdXRwdXRzIH0gZnJvbSBcIi4uLy4uLy4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlLW91dHB1dC5qc1wiXG5pbXBvcnQgVGVzdFJ1bm5lciBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LXJ1bm5lci5qc1wiXG5pbXBvcnQgVGVzdFN1aXRlU3BsaXR0ZXIgZnJvbSBcIi4uLy4uLy4uLy4uL3Rlc3RpbmcvdGVzdC1zdWl0ZS1zcGxpdHRlci5qc1wiXG5pbXBvcnQgeyBub3JtYWxpemVFeGFtcGxlUGF0dGVybnMsIHBhcnNlRmlsdGVycyB9IGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3QtZmlsdGVyLXBhcnNlci5qc1wiXG5pbXBvcnQge1xuICBjYW5vbmljYWxUaW1pbmdNYW5pZmVzdFBhdGgsXG4gIHRpbWluZ01hbmlmZXN0RmlsZVNldEhhc2gsXG4gIHZhbGlkYXRlVGltaW5nTWFuaWZlc3Rcbn0gZnJvbSBcIi4uLy4uLy4uLy4uL3Rlc3RpbmcvdGltaW5nLW1hbmlmZXN0LmpzXCJcbmltcG9ydCB7IHByZXBhcmVTb3VyY2VQZWVyUGFja2FnZSB9IGZyb20gXCIuLi8uLi9zb3VyY2UtcGVlci1wYWNrYWdlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ2xpQ29tbWFuZHNUZXN0IGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGF3YWl0IHByZXBhcmVTb3VyY2VQZWVyUGFja2FnZSgpXG4gICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuc2V0RW52aXJvbm1lbnQoXCJ0ZXN0XCIpXG5cbiAgICBsZXQgZGlyZWN0b3J5XG4gICAgY29uc3QgZGlyZWN0b3JpZXMgPSBbXVxuXG4gICAgaWYgKHByb2Nlc3MuZW52LlZFTE9DSU9VU19URVNUX0RJUikge1xuICAgICAgZGlyZWN0b3J5ID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfRElSXG4gICAgICBkaXJlY3Rvcmllcy5wdXNoKHByb2Nlc3MuZW52LlZFTE9DSU9VU19URVNUX0RJUilcbiAgICB9IGVsc2Uge1xuICAgICAgZGlyZWN0b3J5ID0gdGhpcy5kaXJlY3RvcnkoKVxuICAgICAgZGlyZWN0b3JpZXMucHVzaChgJHt0aGlzLmRpcmVjdG9yeSgpfS9fX3Rlc3RzX19gKVxuICAgICAgZGlyZWN0b3JpZXMucHVzaChgJHt0aGlzLmRpcmVjdG9yeSgpfS90ZXN0c2ApXG4gICAgICBkaXJlY3Rvcmllcy5wdXNoKGAke3RoaXMuZGlyZWN0b3J5KCl9L3NwZWNgKVxuICAgIH1cblxuICAgIGNvbnN0IHtcbiAgICAgIGluY2x1ZGVUYWdzLFxuICAgICAgZXhjbHVkZVRhZ3MsXG4gICAgICBleGFtcGxlUGF0dGVybnMsXG4gICAgICBmaWx0ZXJlZFByb2Nlc3NBcmdzLFxuICAgICAgZ3JvdXBzLFxuICAgICAgZ3JvdXBOdW1iZXIsXG4gICAgICBwcm9maWxlLFxuICAgICAgcHJvZmlsZUpzb25QYXRoLFxuICAgICAgdGltaW5nTWFuaWZlc3RQYXRoLFxuICAgICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoXG4gICAgfSA9IHBhcnNlRmlsdGVycyh0aGlzLnByb2Nlc3NBcmdzIHx8IFtdKVxuICAgIGNvbnN0IHByb2ZpbGVPcHRpb25zID0gcmVzb2x2ZVRlc3RQcm9maWxlT3B0aW9ucyh7XG4gICAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgICBwcm9maWxlLFxuICAgICAgcHJvZmlsZUpzb25QYXRoLFxuICAgICAgdGltaW5nTWFuaWZlc3RQYXRoLFxuICAgICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoXG4gICAgfSlcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB7XG4gICAgICBleGNsdWRlVGFnQ291bnQ6IGV4Y2x1ZGVUYWdzLmxlbmd0aCxcbiAgICAgIGhhc0V4YW1wbGVGaWx0ZXJzOiBleGFtcGxlUGF0dGVybnMubGVuZ3RoID4gMCxcbiAgICAgIGluY2x1ZGVUYWdDb3VudDogaW5jbHVkZVRhZ3MubGVuZ3RoLFxuICAgICAgc2hhcmQ6IGdyb3VwcyAhPT0gdW5kZWZpbmVkICYmIGdyb3VwTnVtYmVyICE9PSB1bmRlZmluZWQgPyB7Z3JvdXBzLCBncm91cE51bWJlcn0gOiB1bmRlZmluZWRcbiAgICB9XG4gICAgY29uc3QgcHJvZmlsZXIgPSBwcm9maWxlT3B0aW9ucy5wcm9maWxlXG4gICAgICA/IG5ldyBUZXN0UHJvZmlsZXIoe2NvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLCBwcm9qZWN0RGlyZWN0b3J5OiBkaXJlY3RvcnksIHNlbGVjdGlvbn0pXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHRlc3RGaWxlc0ZpbmRlciA9IG5ldyBUZXN0RmlsZXNGaW5kZXIoe2RpcmVjdG9yeSwgZGlyZWN0b3JpZXMsIHByb2Nlc3NBcmdzOiBmaWx0ZXJlZFByb2Nlc3NBcmdzfSlcbiAgICAvKiogQHR5cGUge1Rlc3RSdW5uZXIgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRlc3RSdW5uZXJcbiAgICBsZXQgcHJvZmlsZUZpbmFsaXplZCA9IGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBGaW5hbGl6ZXMgcmVxdWVzdGVkIG91dHB1dHMgb25jZSBmb3IgZXZlcnkgY29tbWFuZCBvdXRjb21lLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBSdW4gc3RhdHVzLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlcXVlc3RlZCBvdXRwdXRzIGFyZSB3cml0dGVuLlxuICAgICAqL1xuICAgIGNvbnN0IGZpbmFsaXplUHJvZmlsZSA9IGFzeW5jIChzdGF0dXMpID0+IHtcbiAgICAgIGlmICghcHJvZmlsZXIgfHwgcHJvZmlsZUZpbmFsaXplZCkgcmV0dXJuXG5cbiAgICAgIHByb2ZpbGVGaW5hbGl6ZWQgPSB0cnVlXG4gICAgICBjb25zdCBmYWlsZWQgPSB0ZXN0UnVubmVyPy5nZXRGYWlsZWRUZXN0cygpID8/IDBcbiAgICAgIGNvbnN0IHBhc3NlZCA9IHRlc3RSdW5uZXI/LmdldFN1Y2Nlc3NmdWxUZXN0cygpID8/IDBcbiAgICAgIGNvbnN0IHByb2ZpbGVEb2N1bWVudCA9IHByb2ZpbGVyLmZpbmlzaCh7XG4gICAgICAgIGNvdW50czoge1xuICAgICAgICAgIGRpc2NvdmVyZWQ6IHRlc3RSdW5uZXI/LmdldFRlc3RzQ291bnQoKSA/PyAwLFxuICAgICAgICAgIGV4ZWN1dGVkOiB0ZXN0UnVubmVyPy5nZXRFeGVjdXRlZFRlc3RzQ291bnQoKSA/PyAwLFxuICAgICAgICAgIGZhaWxlZCxcbiAgICAgICAgICBwYXNzZWRcbiAgICAgICAgfSxcbiAgICAgICAgZm9jdXNlZDogQm9vbGVhbih0ZXN0UnVubmVyPy5hbnlUZXN0c0ZvY3Vzc2VkKSxcbiAgICAgICAgc3RhdHVzXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB3cml0ZVRlc3RQcm9maWxlT3V0cHV0cyh7XG4gICAgICAgIHByb2ZpbGU6IHByb2ZpbGVEb2N1bWVudCxcbiAgICAgICAgcHJvZmlsZUpzb25QYXRoOiBwcm9maWxlT3B0aW9ucy5wcm9maWxlSnNvblBhdGgsXG4gICAgICAgIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aDogcHJvZmlsZU9wdGlvbnMudGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoXG4gICAgICB9KVxuICAgICAgY29uc29sZS5sb2coYFxcbiR7Zm9ybWF0VGVzdFByb2ZpbGVTdW1tYXJ5KHByb2ZpbGVEb2N1bWVudCwgcHJvZmlsZU9wdGlvbnMpfWApXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpc2NvdmVyVGVzdEZpbGVzID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCB0aW1pbmdNYW5pZmVzdCA9IGF3YWl0IGxvYWRUaW1pbmdNYW5pZmVzdChwcm9maWxlT3B0aW9ucy50aW1pbmdNYW5pZmVzdFBhdGgpXG4gICAgICAgIGxldCBkaXNjb3ZlcmVkVGVzdEZpbGVzID0gYXdhaXQgdGVzdEZpbGVzRmluZGVyLmZpbmRUZXN0RmlsZXMoKVxuICAgICAgICBjb25zdCBsaW5lRmlsdGVycyA9IHRlc3RGaWxlc0ZpbmRlci5nZXRMaW5lRmlsdGVyc0J5RmlsZSgpXG5cbiAgICAgICAgaWYgKHByb2ZpbGVyKSB7XG4gICAgICAgICAgY29uc3QgZGlzY292ZXJlZEZpbGVQYXRocyA9IGRpc2NvdmVyZWRUZXN0RmlsZXMubWFwKChmaWxlUGF0aCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGNhbm9uaWNhbFRpbWluZ01hbmlmZXN0UGF0aChwYXRoLnJlbGF0aXZlKGRpcmVjdG9yeSwgZmlsZVBhdGgpKVxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBwcm9maWxlci5zZXRTZWxlY3Rpb24oe1xuICAgICAgICAgICAgZGlzY292ZXJlZEZpbGVDb3VudDogZGlzY292ZXJlZFRlc3RGaWxlcy5sZW5ndGgsXG4gICAgICAgICAgICBoYXNMaW5lRmlsdGVyczogT2JqZWN0LmtleXMobGluZUZpbHRlcnMpLmxlbmd0aCA+IDAsXG4gICAgICAgICAgICBwYXRoQmFzZTogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfRElSID8gXCJ0ZXN0LWRpcmVjdG9yeVwiIDogXCJjb25maWd1cmF0aW9uLWRpcmVjdG9yeVwiLFxuICAgICAgICAgICAgdGVzdEZpbGVTZXRIYXNoOiB0aW1pbmdNYW5pZmVzdEZpbGVTZXRIYXNoKGRpc2NvdmVyZWRGaWxlUGF0aHMpXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChncm91cHMgIT09IHVuZGVmaW5lZCB8fCBncm91cE51bWJlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKGdyb3VwcyA9PT0gdW5kZWZpbmVkIHx8IGdyb3VwTnVtYmVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkJvdGggLS1ncm91cHMgYW5kIC0tZ3JvdXAtbnVtYmVyIG11c3QgYmUgcHJvdmlkZWQgdG9nZXRoZXJcIilcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBzcGxpdHRlciA9IG5ldyBUZXN0U3VpdGVTcGxpdHRlcih7XG4gICAgICAgICAgICBncm91cHMsXG4gICAgICAgICAgICBncm91cE51bWJlcixcbiAgICAgICAgICAgIHRlc3RGaWxlczogZGlzY292ZXJlZFRlc3RGaWxlcyxcbiAgICAgICAgICAgIGJhc2VEaXJlY3Rvcnk6IGRpcmVjdG9yeSxcbiAgICAgICAgICAgIHRpbWluZ01hbmlmZXN0XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGlmIChwcm9maWxlT3B0aW9ucy50aW1pbmdNYW5pZmVzdFBhdGgpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvdmVyYWdlID0gc3BsaXR0ZXIuZ2V0VGltaW5nTWFuaWZlc3RDb3ZlcmFnZSgpXG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHBpY29jb2xvcnMuY3lhbihcbiAgICAgICAgICAgICAgYFRpbWluZyBtYW5pZmVzdCBjb3ZlcmFnZTogbWVhc3VyZWQ9JHtjb3ZlcmFnZS5tZWFzdXJlZEZpbGVzfSBgICtcbiAgICAgICAgICAgICAgYGhldXJpc3RpYz0ke2NvdmVyYWdlLmhldXJpc3RpY0ZpbGVzfSBzdGFsZT0ke2NvdmVyYWdlLnN0YWxlRW50cmllc31gXG4gICAgICAgICAgICApKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGRpc2NvdmVyZWRUZXN0RmlsZXMgPSBzcGxpdHRlci5nZXRHcm91cEZpbGVzKClcbiAgICAgICAgICBjb25zb2xlLmxvZyhwaWNvY29sb3JzLmN5YW4oYFJ1bm5pbmcgZ3JvdXAgJHtncm91cE51bWJlcn0gb2YgJHtncm91cHN9ICgke2Rpc2NvdmVyZWRUZXN0RmlsZXMubGVuZ3RofSBmaWxlcylgKSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBkaXNjb3ZlcmVkVGVzdEZpbGVzXG4gICAgICB9XG4gICAgICBjb25zdCB0ZXN0RmlsZXMgPSBwcm9maWxlclxuICAgICAgICA/IGF3YWl0IHByb2ZpbGVyLm1lYXN1cmVQaGFzZShcImRpc2NvdmVyeVwiLCBkaXNjb3ZlclRlc3RGaWxlcylcbiAgICAgICAgOiBhd2FpdCBkaXNjb3ZlclRlc3RGaWxlcygpXG5cbiAgICAgIHByb2ZpbGVyPy5zZXRTZWxlY3Rpb24oe2ZpbGVDb3VudDogdGVzdEZpbGVzLmxlbmd0aH0pXG4gICAgICB0ZXN0UnVubmVyID0gbmV3IFRlc3RSdW5uZXIoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZXhjbHVkZVRhZ3MsXG4gICAgICAgIGluY2x1ZGVUYWdzLFxuICAgICAgICB0ZXN0RmlsZXMsXG4gICAgICAgIGxpbmVGaWx0ZXJzOiB0ZXN0RmlsZXNGaW5kZXIuZ2V0TGluZUZpbHRlcnNCeUZpbGUoKSxcbiAgICAgICAgZXhhbXBsZVBhdHRlcm5zOiBub3JtYWxpemVFeGFtcGxlUGF0dGVybnMoZXhhbXBsZVBhdHRlcm5zKSxcbiAgICAgICAgcHJvZmlsZXJcbiAgICAgIH0pXG4gICAgICBjb25zdCBhY3RpdmVUZXN0UnVubmVyID0gdGVzdFJ1bm5lclxuICAgICAgbGV0IHNpZ25hbEhhbmRsZWQgPSBmYWxzZVxuXG4gICAgICBjb25zdCBoYW5kbGVTaWduYWwgPSBhc3luYyAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHNpZ25hbCkgPT4ge1xuICAgICAgICBpZiAoc2lnbmFsSGFuZGxlZCkgcmV0dXJuXG4gICAgICAgIHNpZ25hbEhhbmRsZWQgPSB0cnVlXG4gICAgICAgIHByb2ZpbGVyPy5pbnRlcnJ1cHQoKVxuICAgICAgICBjb25zb2xlLmVycm9yKGBcXG5SZWNlaXZlZCAke3NpZ25hbH0sIHJ1bm5pbmcgYWZ0ZXJBbGwgaG9va3MgYmVmb3JlIGV4aXQuLi5gKVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgYWN0aXZlVGVzdFJ1bm5lci5ydW5BZnRlckFsbHNGb3JBY3RpdmVTY29wZXMoKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgd2hpbGUgcnVubmluZyBhZnRlckFsbCBob29rczpcIiwgZXJyb3IpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcImludGVycnVwdGVkXCIpXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgd2hpbGUgd3JpdGluZyBpbnRlcnJ1cHRlZCB0ZXN0IHByb2ZpbGU6XCIsIGVycm9yKVxuICAgICAgICAgIH1cbiAgICAgICAgICBwcm9jZXNzLmV4aXQoMTMwKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHByb2Nlc3Mub25jZShcIlNJR0lOVFwiLCAoKSA9PiB7IHZvaWQgaGFuZGxlU2lnbmFsKFwiU0lHSU5UXCIpIH0pXG4gICAgICBwcm9jZXNzLm9uY2UoXCJTSUdURVJNXCIsICgpID0+IHsgdm9pZCBoYW5kbGVTaWduYWwoXCJTSUdURVJNXCIpIH0pXG5cbiAgICAgIGF3YWl0IHRlc3RSdW5uZXIucHJlcGFyZSgpXG4gICAgICBjb25zdCBlZmZlY3RpdmVFeGNsdWRlVGFnQ291bnQgPSB0ZXN0UnVubmVyLmdldEV4Y2x1ZGVUYWdTZXQoKS5zaXplXG5cbiAgICAgIHByb2ZpbGVyPy5zZXRTZWxlY3Rpb24oe2V4Y2x1ZGVUYWdDb3VudDogZWZmZWN0aXZlRXhjbHVkZVRhZ0NvdW50fSlcblxuICAgICAgaWYgKHRlc3RSdW5uZXIuZ2V0VGVzdHNDb3VudCgpID09PSAwKSB7XG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcIm5vLXRlc3RzXCIpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0ZXN0UnVubmVyLmdldFRlc3RzQ291bnQoKX0gdGVzdHMgd2FzIGZvdW5kIGluICR7dGVzdEZpbGVzLmxlbmd0aH0gZmlsZShzKWApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRlc3RSdW5uZXIucnVuKClcblxuICAgICAgY29uc3QgZXhlY3V0ZWRUZXN0cyA9IHRlc3RSdW5uZXIuZ2V0RXhlY3V0ZWRUZXN0c0NvdW50KClcbiAgICAgIGNvbnN0IGxpbmVGaWx0ZXJzID0gdGVzdFJ1bm5lci5nZXRMaW5lRmlsdGVycygpXG4gICAgICBjb25zdCBoYXNMaW5lRmlsdGVycyA9IE9iamVjdC5rZXlzKGxpbmVGaWx0ZXJzKS5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNFeGFtcGxlRmlsdGVycyA9IGV4YW1wbGVQYXR0ZXJucy5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNUYWdGaWx0ZXJzID0gaW5jbHVkZVRhZ3MubGVuZ3RoID4gMCB8fCBlZmZlY3RpdmVFeGNsdWRlVGFnQ291bnQgPiAwXG5cbiAgICAgIGlmICgoaGFzVGFnRmlsdGVycyB8fCBoYXNMaW5lRmlsdGVycyB8fCBoYXNFeGFtcGxlRmlsdGVycykgJiYgZXhlY3V0ZWRUZXN0cyA9PT0gMCAmJiAhdGVzdFJ1bm5lci5pc0ZhaWxlZCgpKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoXCJcXG5ObyB0ZXN0cyBtYXRjaGVkIHRoZSBwcm92aWRlZCBmaWx0ZXJzXCIpKVxuICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJuby10ZXN0c1wiKVxuICAgICAgICBwcm9jZXNzLmV4aXQoMSlcbiAgICAgIH1cblxuICAgICAgLy8gUmVwb3J0IHRoZSBzbG93ZXN0IHRlc3RzIHNvIHN1aXRlIGhvdHNwb3RzIGFyZSB2aXNpYmxlIGV2ZXJ5IHJ1bi4gRGVmYXVsdHMgdG9cbiAgICAgIC8vIHRoZSB0b3AgMTA7IHR1bmUgd2l0aCBWRUxPQ0lPVVNfU0xPV19URVNUX0NPVU5UICgwIGRpc2FibGVzKS4gU2tpcHBlZCBmb3JcbiAgICAgIC8vIHNpbmdsZS10ZXN0IHJ1bnMgd2hlcmUgaXQgd291bGQganVzdCBiZSBub2lzZS5cbiAgICAgIGNvbnN0IHNsb3dUZXN0Q291bnQgPSByZXNvbHZlU2xvd1Rlc3RDb3VudChwcm9jZXNzLmVudi5WRUxPQ0lPVVNfU0xPV19URVNUX0NPVU5UKVxuXG4gICAgICBpZiAoc2xvd1Rlc3RDb3VudCA+IDAgJiYgZXhlY3V0ZWRUZXN0cyA+IDEpIHtcbiAgICAgICAgY29uc3Qgc2xvd2VzdFRlc3RzID0gdGVzdFJ1bm5lci5nZXRTbG93ZXN0VGVzdHMoc2xvd1Rlc3RDb3VudClcblxuICAgICAgICBpZiAoc2xvd2VzdFRlc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhwaWNvY29sb3JzLmN5YW4oYFxcblNsb3dlc3QgJHtzbG93ZXN0VGVzdHMubGVuZ3RofSB0ZXN0czpgKSlcblxuICAgICAgICAgIGZvciAoY29uc3Qgc2xvd1Rlc3Qgb2Ygc2xvd2VzdFRlc3RzKSB7XG4gICAgICAgICAgICBjb25zdCBsb2NhdGlvbiA9IHNsb3dUZXN0LmZpbGVQYXRoICYmIHNsb3dUZXN0LmxpbmUgPyBgICgke3Nsb3dUZXN0LmZpbGVQYXRofToke3Nsb3dUZXN0LmxpbmV9KWAgOiBcIlwiXG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHBpY29jb2xvcnMuY3lhbihgICAke1N0cmluZyhzbG93VGVzdC5kdXJhdGlvbk1zKS5wYWRTdGFydCg2KX1tcyAgJHtzbG93VGVzdC5mdWxsRGVzY3JpcHRpb259JHtsb2NhdGlvbn1gKSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRlc3RSdW5uZXIuaXNGYWlsZWQoKSkge1xuICAgICAgICBhd2FpdCB0ZXN0UnVubmVyLnBlcnNpc3RGYWlsZWRUZXN0Q29uc29sZU91dHB1dHNUb0Fzc2V0cygpXG4gICAgICAgIGNvbnN0IGZhaWxlZFRlc3RzID0gdGVzdFJ1bm5lci5nZXRGYWlsZWRUZXN0RGV0YWlscygpXG5cbiAgICAgICAgaWYgKGZhaWxlZFRlc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKFwiXFxuRmFpbGVkIHRlc3RzOlwiKSlcblxuICAgICAgICAgIGZvciAoY29uc3QgZmFpbGVkIG9mIGZhaWxlZFRlc3RzKSB7XG4gICAgICAgICAgICBjb25zdCBsb2NhdGlvbiA9IGZhaWxlZC5maWxlUGF0aCAmJiBmYWlsZWQubGluZVxuICAgICAgICAgICAgICA/IGAgKCR7ZmFpbGVkLmZpbGVQYXRofToke2ZhaWxlZC5saW5lfSlgXG4gICAgICAgICAgICAgIDogXCJcIlxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgLSAke2ZhaWxlZC5mdWxsRGVzY3JpcHRpb259JHtsb2NhdGlvbn1gKSlcblxuICAgICAgICAgICAgaWYgKGZhaWxlZC5jb25zb2xlTG9nUGF0aCkge1xuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAgIENvbnNvbGUgbG9nOiAke2ZhaWxlZC5jb25zb2xlTG9nUGF0aH1gKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGVzdFJ1bm5lci5nZXROb3RSdW5UZXN0cygpID4gMCkgY29uc29sZS5lcnJvcihgJHt0ZXN0UnVubmVyLmdldE5vdFJ1blRlc3RzKCl9IHRlc3RzIG5vdCBydW4gYmVjYXVzZSBhIHNoYXJlZCByZXNvdXJjZSBmYWlsZWRgKVxuICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5UZXN0IHJ1biBmYWlsZWQgd2l0aCAke3Rlc3RSdW5uZXIuZ2V0RmFpbGVkVGVzdHMoKX0gZmFpbGVkIHRlc3RzIGFuZCAke3Rlc3RSdW5uZXIuZ2V0U3VjY2Vzc2Z1bFRlc3RzKCl9IHN1Y2Nlc3NmdWxsYCkpXG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcImZhaWxlZFwiKVxuICAgICAgICBwcm9jZXNzLmV4aXQoMSlcbiAgICAgIH0gZWxzZSBpZiAodGVzdFJ1bm5lci5hcmVBbnlUZXN0c0ZvY3Vzc2VkKCkpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuRm9jdXNzZWQgcnVuIHdpdGggJHt0ZXN0UnVubmVyLmdldEZhaWxlZFRlc3RzKCl9IGZhaWxlZCB0ZXN0cyBhbmQgJHt0ZXN0UnVubmVyLmdldFN1Y2Nlc3NmdWxUZXN0cygpfSBzdWNjZXNzZnVsbGApKVxuICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJmb2N1c2VkXCIpXG4gICAgICAgIHByb2Nlc3MuZXhpdCgxKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5sb2cocGljb2NvbG9ycy5ncmVlbihgXFxuVGVzdCBydW4gc3VjY2VlZGVkIHdpdGggJHt0ZXN0UnVubmVyLmdldFN1Y2Nlc3NmdWxUZXN0cygpfSBzdWNjZXNzZnVsIHRlc3RzYCkpXG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcInBhc3NlZFwiKVxuICAgICAgICBwcm9jZXNzLmV4aXQoMClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZmluYWxpemVQcm9maWxlKFwiZXJyb3JcIilcbiAgICAgIH0gY2F0Y2ggKHByb2ZpbGVFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCBwcm9maWxlRXJyb3JdLCBcIlRlc3QgY29tbWFuZCBhbmQgcHJvZmlsZSBmaW5hbGl6YXRpb24gYm90aCBmYWlsZWRcIiwge2NhdXNlOiBwcm9maWxlRXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIGFuZCB2YWxpZGF0ZXMgcHJvZmlsaW5nIHBhdGhzIGJlZm9yZSB0ZXN0IGRpc2NvdmVyeSBzdGFydHMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJhdyBwcm9maWxpbmcgb3B0aW9ucy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmN3ZCAtIENvbW1hbmQgd29ya2luZyBkaXJlY3RvcnkuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucHJvZmlsZSAtIFdoZXRoZXIgY29uc29sZSBwcm9maWxpbmcgd2FzIHJlcXVlc3RlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9maWxlSnNvblBhdGhdIC0gUmljaCBwcm9maWxlIG91dHB1dCBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnRpbWluZ01hbmlmZXN0UGF0aF0gLSBUaW1pbmcgbWFuaWZlc3QgaW5wdXQgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy50aW1pbmdNYW5pZmVzdE91dHB1dFBhdGhdIC0gVGltaW5nIG1hbmlmZXN0IG91dHB1dCBwYXRoLlxuICogQHJldHVybnMge3twcm9maWxlOiBib29sZWFuLCBwcm9maWxlSnNvblBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCwgdGltaW5nTWFuaWZlc3RQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBSZXNvbHZlZCBwcm9maWxpbmcgb3B0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUZXN0UHJvZmlsZU9wdGlvbnMoe2N3ZCwgcHJvZmlsZSwgcHJvZmlsZUpzb25QYXRoLCB0aW1pbmdNYW5pZmVzdFBhdGgsIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aH0pIHtcbiAgY29uc3QgcmVzb2x2ZWRQcm9maWxlSnNvblBhdGggPSBwcm9maWxlSnNvblBhdGggPyBwYXRoLnJlc29sdmUoY3dkLCBwcm9maWxlSnNvblBhdGgpIDogdW5kZWZpbmVkXG4gIGNvbnN0IHJlc29sdmVkVGltaW5nTWFuaWZlc3RQYXRoID0gdGltaW5nTWFuaWZlc3RQYXRoID8gcGF0aC5yZXNvbHZlKGN3ZCwgdGltaW5nTWFuaWZlc3RQYXRoKSA6IHVuZGVmaW5lZFxuICBjb25zdCByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCA9IHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aFxuICAgID8gcGF0aC5yZXNvbHZlKGN3ZCwgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoKVxuICAgIDogdW5kZWZpbmVkXG5cbiAgaWYgKHJlc29sdmVkUHJvZmlsZUpzb25QYXRoICYmIHJlc29sdmVkVGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoICYmIHJlc29sdmVkUHJvZmlsZUpzb25QYXRoID09PSByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlRlc3QgcHJvZmlsaW5nIG91dHB1dCBwYXRocyBtdXN0IGJlIGRpZmZlcmVudFwiKVxuICB9XG5cbiAgaWYgKHJlc29sdmVkVGltaW5nTWFuaWZlc3RQYXRoICYmIChcbiAgICByZXNvbHZlZFByb2ZpbGVKc29uUGF0aCA9PT0gcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdFBhdGggfHxcbiAgICByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCA9PT0gcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdFBhdGhcbiAgKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlRlc3QgcHJvZmlsaW5nIG91dHB1dHMgbXVzdCBub3Qgb3ZlcndyaXRlIC0tdGltaW5nLW1hbmlmZXN0IGlucHV0XCIpXG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByb2ZpbGU6IHByb2ZpbGUgfHwgQm9vbGVhbihyZXNvbHZlZFByb2ZpbGVKc29uUGF0aCB8fCByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCksXG4gICAgcHJvZmlsZUpzb25QYXRoOiByZXNvbHZlZFByb2ZpbGVKc29uUGF0aCxcbiAgICB0aW1pbmdNYW5pZmVzdFBhdGg6IHJlc29sdmVkVGltaW5nTWFuaWZlc3RQYXRoLFxuICAgIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aDogcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdE91dHB1dFBhdGhcbiAgfVxufVxuXG4vKipcbiAqIExvYWRzIGFuZCB2YWxpZGF0ZXMgYW4gZXhwbGljaXRseSBzdXBwbGllZCBwbGFpbiBKU09OIHRpbWluZyBtYW5pZmVzdC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB0aW1pbmdNYW5pZmVzdFBhdGggLSBUaW1pbmcgbWFuaWZlc3QgcGF0aC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4gfCB1bmRlZmluZWQ+fSAtIENhbm9uaWNhbCBtYW5pZmVzdCwgb3IgdW5kZWZpbmVkIHdoZW4gbm90IHJlcXVlc3RlZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRUaW1pbmdNYW5pZmVzdCh0aW1pbmdNYW5pZmVzdFBhdGgpIHtcbiAgaWYgKCF0aW1pbmdNYW5pZmVzdFBhdGgpIHJldHVybiB1bmRlZmluZWRcblxuICBsZXQgY29udGVudFxuXG4gIHRyeSB7XG4gICAgY29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKHRpbWluZ01hbmlmZXN0UGF0aCwgXCJ1dGY4XCIpXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVhZCB0aW1pbmcgbWFuaWZlc3Q6ICR7dGltaW5nTWFuaWZlc3RQYXRofWAsIHtjYXVzZTogZXJyb3J9KVxuICB9XG5cbiAgbGV0IHBhcnNlZFxuXG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShjb250ZW50KVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHBhcnNlIHRpbWluZyBtYW5pZmVzdDogJHt0aW1pbmdNYW5pZmVzdFBhdGh9YCwge2NhdXNlOiBlcnJvcn0pXG4gIH1cblxuICByZXR1cm4gdmFsaWRhdGVUaW1pbmdNYW5pZmVzdChwYXJzZWQsIHtzb3VyY2U6IGBUaW1pbmcgbWFuaWZlc3QgJHt0aW1pbmdNYW5pZmVzdFBhdGh9YH0pXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgaG93IG1hbnkgc2xvd2VzdCB0ZXN0cyB0byByZXBvcnQgZnJvbSB0aGUgYFZFTE9DSU9VU19TTE9XX1RFU1RfQ09VTlRgXG4gKiBlbnYgdmFsdWU6IGRlZmF1bHRzIHRvIDEwIHdoZW4gdW5zZXQ7IDAgKG9yIGFuIHVucGFyc2VhYmxlIHZhbHVlKSBkaXNhYmxlcyB0aGVcbiAqIHJlcG9ydDsgb3RoZXJ3aXNlIHRoZSBmbG9vcmVkLCBub24tbmVnYXRpdmUgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSByYXdFbnZWYWx1ZSAtIFJhdyBlbnYgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBzbG93ZXN0IHRlc3RzIHRvIHJlcG9ydCAoMCBkaXNhYmxlcykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU2xvd1Rlc3RDb3VudChyYXdFbnZWYWx1ZSkge1xuICBpZiAocmF3RW52VmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIDEwXG5cbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGguZmxvb3IoTnVtYmVyKHJhd0VudlZhbHVlKSkgfHwgMClcbn1cbiJdfQ==
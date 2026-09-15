// @ts-check
import BaseCommand from "../../../../cli/base-command.js";
import path from "node:path";
import picocolors from "picocolors";
import TestFilesFinder from "../../../../testing/test-files-finder.js";
import TestProfiler from "../../../../testing/test-profiler.js";
import { formatTestProfileSummary, loadTimingManifest, resolveTestProfileOptions, writeTestProfileOutputs } from "../../../../testing/test-profile-output.js";
import TestRunner from "../../../../testing/test-runner.js";
import TestSuiteSplitter from "../../../../testing/test-suite-splitter.js";
import { normalizeExamplePatterns, parseFilters } from "../../../../testing/test-filter-parser.js";
import { canonicalTimingManifestPath, timingManifestFileSetHash } from "../../../../testing/timing-manifest.js";
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
        const { includeTags, excludeTags, examplePatterns, filteredProcessArgs, groups, groupNumber, profile, profileJsonPath, retries, setupFiles, timingManifestPath, timingManifestOutputPath, timeoutMs } = parseFilters(this.processArgs || []);
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
         * @param {import("@velocious/testing/node").TestProfileStatus} status - Run status.
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
                profiler,
                retries,
                setupFiles: setupFiles.map((setupFile) => path.resolve(process.cwd(), setupFile)),
                timeoutMs
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
            if ((hasTagFilters || hasLineFilters || hasExampleFilters) && testRunner.hasNoMatches()) {
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
export { loadTimingManifest, resolveTestProfileOptions };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy90ZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN6RCxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ25DLE9BQU8sZUFBZSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3RFLE9BQU8sWUFBWSxNQUFNLHNDQUFzQyxDQUFBO0FBQy9ELE9BQU8sRUFDTCx3QkFBd0IsRUFDeEIsa0JBQWtCLEVBQ2xCLHlCQUF5QixFQUN6Qix1QkFBdUIsRUFDeEIsTUFBTSw0Q0FBNEMsQ0FBQTtBQUNuRCxPQUFPLFVBQVUsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRCxPQUFPLGlCQUFpQixNQUFNLDRDQUE0QyxDQUFBO0FBQzFFLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxZQUFZLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNsRyxPQUFPLEVBQ0wsMkJBQTJCLEVBQzNCLHlCQUF5QixFQUMxQixNQUFNLHdDQUF3QyxDQUFBO0FBQy9DLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxNQUFNLDhCQUE4QixDQUFBO0FBRXZFLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0JBQXlCLFNBQVEsV0FBVztJQUMvRCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sd0JBQXdCLEVBQUUsQ0FBQTtRQUNoQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFOUMsSUFBSSxTQUFTLENBQUE7UUFDYixNQUFNLFdBQVcsR0FBRyxFQUFFLENBQUE7UUFFdEIsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDbkMsU0FBUyxHQUFHLE9B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LGNBQWMsQ0FBQyxDQUFDLEtBQUssRUFBRSxZQUFZLENBQUMsRUFBRSxtREFBbUQsRUFBRSxFQUFDLEtBQUssRUFBRSxZQUFZLEVBQUMsQ0FBQyxDQUFBO1lBQzdILENBQUM7WUFFRCxNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFRCxPQUFPLEVBQUUsa0JBQWtCLEVBQUUseUJBQXlCLEVBQUUsQ0FBQTtBQUV4RDs7Ozs7O0dBTUc7QUFDSCxNQUFNLFVBQVUsb0JBQW9CLENBQUMsV0FBVztJQUM5QyxJQUFJLFdBQVcsS0FBSyxTQUFTO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFeEMsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0FBQzFELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi8uLi9jbGkvYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuaW1wb3J0IHBpY29jb2xvcnMgZnJvbSBcInBpY29jb2xvcnNcIlxuaW1wb3J0IFRlc3RGaWxlc0ZpbmRlciBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LWZpbGVzLWZpbmRlci5qc1wiXG5pbXBvcnQgVGVzdFByb2ZpbGVyIGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIlxuaW1wb3J0IHtcbiAgZm9ybWF0VGVzdFByb2ZpbGVTdW1tYXJ5LFxuICBsb2FkVGltaW5nTWFuaWZlc3QsXG4gIHJlc29sdmVUZXN0UHJvZmlsZU9wdGlvbnMsXG4gIHdyaXRlVGVzdFByb2ZpbGVPdXRwdXRzXG59IGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1vdXRwdXQuanNcIlxuaW1wb3J0IFRlc3RSdW5uZXIgZnJvbSBcIi4uLy4uLy4uLy4uL3Rlc3RpbmcvdGVzdC1ydW5uZXIuanNcIlxuaW1wb3J0IFRlc3RTdWl0ZVNwbGl0dGVyIGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3Qtc3VpdGUtc3BsaXR0ZXIuanNcIlxuaW1wb3J0IHsgbm9ybWFsaXplRXhhbXBsZVBhdHRlcm5zLCBwYXJzZUZpbHRlcnMgfSBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LWZpbHRlci1wYXJzZXIuanNcIlxuaW1wb3J0IHtcbiAgY2Fub25pY2FsVGltaW5nTWFuaWZlc3RQYXRoLFxuICB0aW1pbmdNYW5pZmVzdEZpbGVTZXRIYXNoXG59IGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3RpbWluZy1tYW5pZmVzdC5qc1wiXG5pbXBvcnQgeyBwcmVwYXJlU291cmNlUGVlclBhY2thZ2UgfSBmcm9tIFwiLi4vLi4vc291cmNlLXBlZXItcGFja2FnZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NsaUNvbW1hbmRzVGVzdCBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBhd2FpdCBwcmVwYXJlU291cmNlUGVlclBhY2thZ2UoKVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLnNldEVudmlyb25tZW50KFwidGVzdFwiKVxuXG4gICAgbGV0IGRpcmVjdG9yeVxuICAgIGNvbnN0IGRpcmVjdG9yaWVzID0gW11cblxuICAgIGlmIChwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9ESVIpIHtcbiAgICAgIGRpcmVjdG9yeSA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19URVNUX0RJUlxuICAgICAgZGlyZWN0b3JpZXMucHVzaChwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9ESVIpXG4gICAgfSBlbHNlIHtcbiAgICAgIGRpcmVjdG9yeSA9IHRoaXMuZGlyZWN0b3J5KClcbiAgICAgIGRpcmVjdG9yaWVzLnB1c2goYCR7dGhpcy5kaXJlY3RvcnkoKX0vX190ZXN0c19fYClcbiAgICAgIGRpcmVjdG9yaWVzLnB1c2goYCR7dGhpcy5kaXJlY3RvcnkoKX0vdGVzdHNgKVxuICAgICAgZGlyZWN0b3JpZXMucHVzaChgJHt0aGlzLmRpcmVjdG9yeSgpfS9zcGVjYClcbiAgICB9XG5cbiAgICBjb25zdCB7XG4gICAgICBpbmNsdWRlVGFncyxcbiAgICAgIGV4Y2x1ZGVUYWdzLFxuICAgICAgZXhhbXBsZVBhdHRlcm5zLFxuICAgICAgZmlsdGVyZWRQcm9jZXNzQXJncyxcbiAgICAgIGdyb3VwcyxcbiAgICAgIGdyb3VwTnVtYmVyLFxuICAgICAgcHJvZmlsZSxcbiAgICAgIHByb2ZpbGVKc29uUGF0aCxcbiAgICAgIHJldHJpZXMsXG4gICAgICBzZXR1cEZpbGVzLFxuICAgICAgdGltaW5nTWFuaWZlc3RQYXRoLFxuICAgICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoLFxuICAgICAgdGltZW91dE1zXG4gICAgfSA9IHBhcnNlRmlsdGVycyh0aGlzLnByb2Nlc3NBcmdzIHx8IFtdKVxuICAgIGNvbnN0IHByb2ZpbGVPcHRpb25zID0gcmVzb2x2ZVRlc3RQcm9maWxlT3B0aW9ucyh7XG4gICAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgICBwcm9maWxlLFxuICAgICAgcHJvZmlsZUpzb25QYXRoLFxuICAgICAgdGltaW5nTWFuaWZlc3RQYXRoLFxuICAgICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoXG4gICAgfSlcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB7XG4gICAgICBleGNsdWRlVGFnQ291bnQ6IGV4Y2x1ZGVUYWdzLmxlbmd0aCxcbiAgICAgIGhhc0V4YW1wbGVGaWx0ZXJzOiBleGFtcGxlUGF0dGVybnMubGVuZ3RoID4gMCxcbiAgICAgIGluY2x1ZGVUYWdDb3VudDogaW5jbHVkZVRhZ3MubGVuZ3RoLFxuICAgICAgc2hhcmQ6IGdyb3VwcyAhPT0gdW5kZWZpbmVkICYmIGdyb3VwTnVtYmVyICE9PSB1bmRlZmluZWQgPyB7Z3JvdXBzLCBncm91cE51bWJlcn0gOiB1bmRlZmluZWRcbiAgICB9XG4gICAgY29uc3QgcHJvZmlsZXIgPSBwcm9maWxlT3B0aW9ucy5wcm9maWxlXG4gICAgICA/IG5ldyBUZXN0UHJvZmlsZXIoe2NvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLCBwcm9qZWN0RGlyZWN0b3J5OiBkaXJlY3RvcnksIHNlbGVjdGlvbn0pXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHRlc3RGaWxlc0ZpbmRlciA9IG5ldyBUZXN0RmlsZXNGaW5kZXIoe2RpcmVjdG9yeSwgZGlyZWN0b3JpZXMsIHByb2Nlc3NBcmdzOiBmaWx0ZXJlZFByb2Nlc3NBcmdzfSlcbiAgICAvKiogQHR5cGUge1Rlc3RSdW5uZXIgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRlc3RSdW5uZXJcbiAgICBsZXQgcHJvZmlsZUZpbmFsaXplZCA9IGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBGaW5hbGl6ZXMgcmVxdWVzdGVkIG91dHB1dHMgb25jZSBmb3IgZXZlcnkgY29tbWFuZCBvdXRjb21lLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL25vZGVcIikuVGVzdFByb2ZpbGVTdGF0dXN9IHN0YXR1cyAtIFJ1biBzdGF0dXMuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVxdWVzdGVkIG91dHB1dHMgYXJlIHdyaXR0ZW4uXG4gICAgICovXG4gICAgY29uc3QgZmluYWxpemVQcm9maWxlID0gYXN5bmMgKHN0YXR1cykgPT4ge1xuICAgICAgaWYgKCFwcm9maWxlciB8fCBwcm9maWxlRmluYWxpemVkKSByZXR1cm5cblxuICAgICAgcHJvZmlsZUZpbmFsaXplZCA9IHRydWVcbiAgICAgIGNvbnN0IGZhaWxlZCA9IHRlc3RSdW5uZXI/LmdldEZhaWxlZFRlc3RzKCkgPz8gMFxuICAgICAgY29uc3QgcGFzc2VkID0gdGVzdFJ1bm5lcj8uZ2V0U3VjY2Vzc2Z1bFRlc3RzKCkgPz8gMFxuICAgICAgY29uc3QgcHJvZmlsZURvY3VtZW50ID0gcHJvZmlsZXIuZmluaXNoKHtcbiAgICAgICAgY291bnRzOiB7XG4gICAgICAgICAgZGlzY292ZXJlZDogdGVzdFJ1bm5lcj8uZ2V0VGVzdHNDb3VudCgpID8/IDAsXG4gICAgICAgICAgZXhlY3V0ZWQ6IHRlc3RSdW5uZXI/LmdldEV4ZWN1dGVkVGVzdHNDb3VudCgpID8/IDAsXG4gICAgICAgICAgZmFpbGVkLFxuICAgICAgICAgIHBhc3NlZFxuICAgICAgICB9LFxuICAgICAgICBmb2N1c2VkOiBCb29sZWFuKHRlc3RSdW5uZXI/LmFueVRlc3RzRm9jdXNzZWQpLFxuICAgICAgICBzdGF0dXNcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHdyaXRlVGVzdFByb2ZpbGVPdXRwdXRzKHtcbiAgICAgICAgcHJvZmlsZTogcHJvZmlsZURvY3VtZW50LFxuICAgICAgICBwcm9maWxlSnNvblBhdGg6IHByb2ZpbGVPcHRpb25zLnByb2ZpbGVKc29uUGF0aCxcbiAgICAgICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoOiBwcm9maWxlT3B0aW9ucy50aW1pbmdNYW5pZmVzdE91dHB1dFBhdGhcbiAgICAgIH0pXG4gICAgICBjb25zb2xlLmxvZyhgXFxuJHtmb3JtYXRUZXN0UHJvZmlsZVN1bW1hcnkocHJvZmlsZURvY3VtZW50LCBwcm9maWxlT3B0aW9ucyl9YClcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlzY292ZXJUZXN0RmlsZXMgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHRpbWluZ01hbmlmZXN0ID0gYXdhaXQgbG9hZFRpbWluZ01hbmlmZXN0KHByb2ZpbGVPcHRpb25zLnRpbWluZ01hbmlmZXN0UGF0aClcbiAgICAgICAgbGV0IGRpc2NvdmVyZWRUZXN0RmlsZXMgPSBhd2FpdCB0ZXN0RmlsZXNGaW5kZXIuZmluZFRlc3RGaWxlcygpXG4gICAgICAgIGNvbnN0IGxpbmVGaWx0ZXJzID0gdGVzdEZpbGVzRmluZGVyLmdldExpbmVGaWx0ZXJzQnlGaWxlKClcblxuICAgICAgICBpZiAocHJvZmlsZXIpIHtcbiAgICAgICAgICBjb25zdCBkaXNjb3ZlcmVkRmlsZVBhdGhzID0gZGlzY292ZXJlZFRlc3RGaWxlcy5tYXAoKGZpbGVQYXRoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gY2Fub25pY2FsVGltaW5nTWFuaWZlc3RQYXRoKHBhdGgucmVsYXRpdmUoZGlyZWN0b3J5LCBmaWxlUGF0aCkpXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIHByb2ZpbGVyLnNldFNlbGVjdGlvbih7XG4gICAgICAgICAgICBkaXNjb3ZlcmVkRmlsZUNvdW50OiBkaXNjb3ZlcmVkVGVzdEZpbGVzLmxlbmd0aCxcbiAgICAgICAgICAgIGhhc0xpbmVGaWx0ZXJzOiBPYmplY3Qua2V5cyhsaW5lRmlsdGVycykubGVuZ3RoID4gMCxcbiAgICAgICAgICAgIHBhdGhCYXNlOiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9ESVIgPyBcInRlc3QtZGlyZWN0b3J5XCIgOiBcImNvbmZpZ3VyYXRpb24tZGlyZWN0b3J5XCIsXG4gICAgICAgICAgICB0ZXN0RmlsZVNldEhhc2g6IHRpbWluZ01hbmlmZXN0RmlsZVNldEhhc2goZGlzY292ZXJlZEZpbGVQYXRocylcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGdyb3VwcyAhPT0gdW5kZWZpbmVkIHx8IGdyb3VwTnVtYmVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBpZiAoZ3JvdXBzID09PSB1bmRlZmluZWQgfHwgZ3JvdXBOdW1iZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQm90aCAtLWdyb3VwcyBhbmQgLS1ncm91cC1udW1iZXIgbXVzdCBiZSBwcm92aWRlZCB0b2dldGhlclwiKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNwbGl0dGVyID0gbmV3IFRlc3RTdWl0ZVNwbGl0dGVyKHtcbiAgICAgICAgICAgIGdyb3VwcyxcbiAgICAgICAgICAgIGdyb3VwTnVtYmVyLFxuICAgICAgICAgICAgdGVzdEZpbGVzOiBkaXNjb3ZlcmVkVGVzdEZpbGVzLFxuICAgICAgICAgICAgYmFzZURpcmVjdG9yeTogZGlyZWN0b3J5LFxuICAgICAgICAgICAgdGltaW5nTWFuaWZlc3RcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgaWYgKHByb2ZpbGVPcHRpb25zLnRpbWluZ01hbmlmZXN0UGF0aCkge1xuICAgICAgICAgICAgY29uc3QgY292ZXJhZ2UgPSBzcGxpdHRlci5nZXRUaW1pbmdNYW5pZmVzdENvdmVyYWdlKClcblxuICAgICAgICAgICAgY29uc29sZS5sb2cocGljb2NvbG9ycy5jeWFuKFxuICAgICAgICAgICAgICBgVGltaW5nIG1hbmlmZXN0IGNvdmVyYWdlOiBtZWFzdXJlZD0ke2NvdmVyYWdlLm1lYXN1cmVkRmlsZXN9IGAgK1xuICAgICAgICAgICAgICBgaGV1cmlzdGljPSR7Y292ZXJhZ2UuaGV1cmlzdGljRmlsZXN9IHN0YWxlPSR7Y292ZXJhZ2Uuc3RhbGVFbnRyaWVzfWBcbiAgICAgICAgICAgICkpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZGlzY292ZXJlZFRlc3RGaWxlcyA9IHNwbGl0dGVyLmdldEdyb3VwRmlsZXMoKVxuICAgICAgICAgIGNvbnNvbGUubG9nKHBpY29jb2xvcnMuY3lhbihgUnVubmluZyBncm91cCAke2dyb3VwTnVtYmVyfSBvZiAke2dyb3Vwc30gKCR7ZGlzY292ZXJlZFRlc3RGaWxlcy5sZW5ndGh9IGZpbGVzKWApKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRpc2NvdmVyZWRUZXN0RmlsZXNcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRlc3RGaWxlcyA9IHByb2ZpbGVyXG4gICAgICAgID8gYXdhaXQgcHJvZmlsZXIubWVhc3VyZVBoYXNlKFwiZGlzY292ZXJ5XCIsIGRpc2NvdmVyVGVzdEZpbGVzKVxuICAgICAgICA6IGF3YWl0IGRpc2NvdmVyVGVzdEZpbGVzKClcblxuICAgICAgcHJvZmlsZXI/LnNldFNlbGVjdGlvbih7ZmlsZUNvdW50OiB0ZXN0RmlsZXMubGVuZ3RofSlcbiAgICAgIHRlc3RSdW5uZXIgPSBuZXcgVGVzdFJ1bm5lcih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBleGNsdWRlVGFncyxcbiAgICAgICAgaW5jbHVkZVRhZ3MsXG4gICAgICAgIHRlc3RGaWxlcyxcbiAgICAgICAgbGluZUZpbHRlcnM6IHRlc3RGaWxlc0ZpbmRlci5nZXRMaW5lRmlsdGVyc0J5RmlsZSgpLFxuICAgICAgICBleGFtcGxlUGF0dGVybnM6IG5vcm1hbGl6ZUV4YW1wbGVQYXR0ZXJucyhleGFtcGxlUGF0dGVybnMpLFxuICAgICAgICBwcm9maWxlcixcbiAgICAgICAgcmV0cmllcyxcbiAgICAgICAgc2V0dXBGaWxlczogc2V0dXBGaWxlcy5tYXAoKHNldHVwRmlsZSkgPT4gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIHNldHVwRmlsZSkpLFxuICAgICAgICB0aW1lb3V0TXNcbiAgICAgIH0pXG4gICAgICBjb25zdCBhY3RpdmVUZXN0UnVubmVyID0gdGVzdFJ1bm5lclxuICAgICAgbGV0IHNpZ25hbEhhbmRsZWQgPSBmYWxzZVxuXG4gICAgICBjb25zdCBoYW5kbGVTaWduYWwgPSBhc3luYyAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHNpZ25hbCkgPT4ge1xuICAgICAgICBpZiAoc2lnbmFsSGFuZGxlZCkgcmV0dXJuXG4gICAgICAgIHNpZ25hbEhhbmRsZWQgPSB0cnVlXG4gICAgICAgIHByb2ZpbGVyPy5pbnRlcnJ1cHQoKVxuICAgICAgICBjb25zb2xlLmVycm9yKGBcXG5SZWNlaXZlZCAke3NpZ25hbH0sIHJ1bm5pbmcgYWZ0ZXJBbGwgaG9va3MgYmVmb3JlIGV4aXQuLi5gKVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgYWN0aXZlVGVzdFJ1bm5lci5ydW5BZnRlckFsbHNGb3JBY3RpdmVTY29wZXMoKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgd2hpbGUgcnVubmluZyBhZnRlckFsbCBob29rczpcIiwgZXJyb3IpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcImludGVycnVwdGVkXCIpXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgd2hpbGUgd3JpdGluZyBpbnRlcnJ1cHRlZCB0ZXN0IHByb2ZpbGU6XCIsIGVycm9yKVxuICAgICAgICAgIH1cbiAgICAgICAgICBwcm9jZXNzLmV4aXQoMTMwKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHByb2Nlc3Mub25jZShcIlNJR0lOVFwiLCAoKSA9PiB7IHZvaWQgaGFuZGxlU2lnbmFsKFwiU0lHSU5UXCIpIH0pXG4gICAgICBwcm9jZXNzLm9uY2UoXCJTSUdURVJNXCIsICgpID0+IHsgdm9pZCBoYW5kbGVTaWduYWwoXCJTSUdURVJNXCIpIH0pXG5cbiAgICAgIGF3YWl0IHRlc3RSdW5uZXIucHJlcGFyZSgpXG4gICAgICBjb25zdCBlZmZlY3RpdmVFeGNsdWRlVGFnQ291bnQgPSB0ZXN0UnVubmVyLmdldEV4Y2x1ZGVUYWdTZXQoKS5zaXplXG5cbiAgICAgIHByb2ZpbGVyPy5zZXRTZWxlY3Rpb24oe2V4Y2x1ZGVUYWdDb3VudDogZWZmZWN0aXZlRXhjbHVkZVRhZ0NvdW50fSlcblxuICAgICAgaWYgKHRlc3RSdW5uZXIuZ2V0VGVzdHNDb3VudCgpID09PSAwKSB7XG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcIm5vLXRlc3RzXCIpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0ZXN0UnVubmVyLmdldFRlc3RzQ291bnQoKX0gdGVzdHMgd2FzIGZvdW5kIGluICR7dGVzdEZpbGVzLmxlbmd0aH0gZmlsZShzKWApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRlc3RSdW5uZXIucnVuKClcblxuICAgICAgY29uc3QgZXhlY3V0ZWRUZXN0cyA9IHRlc3RSdW5uZXIuZ2V0RXhlY3V0ZWRUZXN0c0NvdW50KClcbiAgICAgIGNvbnN0IGxpbmVGaWx0ZXJzID0gdGVzdFJ1bm5lci5nZXRMaW5lRmlsdGVycygpXG4gICAgICBjb25zdCBoYXNMaW5lRmlsdGVycyA9IE9iamVjdC5rZXlzKGxpbmVGaWx0ZXJzKS5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNFeGFtcGxlRmlsdGVycyA9IGV4YW1wbGVQYXR0ZXJucy5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNUYWdGaWx0ZXJzID0gaW5jbHVkZVRhZ3MubGVuZ3RoID4gMCB8fCBlZmZlY3RpdmVFeGNsdWRlVGFnQ291bnQgPiAwXG5cbiAgICAgIGlmICgoaGFzVGFnRmlsdGVycyB8fCBoYXNMaW5lRmlsdGVycyB8fCBoYXNFeGFtcGxlRmlsdGVycykgJiYgdGVzdFJ1bm5lci5oYXNOb01hdGNoZXMoKSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKFwiXFxuTm8gdGVzdHMgbWF0Y2hlZCB0aGUgcHJvdmlkZWQgZmlsdGVyc1wiKSlcbiAgICAgICAgYXdhaXQgZmluYWxpemVQcm9maWxlKFwibm8tdGVzdHNcIilcbiAgICAgICAgcHJvY2Vzcy5leGl0KDEpXG4gICAgICB9XG5cbiAgICAgIC8vIFJlcG9ydCB0aGUgc2xvd2VzdCB0ZXN0cyBzbyBzdWl0ZSBob3RzcG90cyBhcmUgdmlzaWJsZSBldmVyeSBydW4uIERlZmF1bHRzIHRvXG4gICAgICAvLyB0aGUgdG9wIDEwOyB0dW5lIHdpdGggVkVMT0NJT1VTX1NMT1dfVEVTVF9DT1VOVCAoMCBkaXNhYmxlcykuIFNraXBwZWQgZm9yXG4gICAgICAvLyBzaW5nbGUtdGVzdCBydW5zIHdoZXJlIGl0IHdvdWxkIGp1c3QgYmUgbm9pc2UuXG4gICAgICBjb25zdCBzbG93VGVzdENvdW50ID0gcmVzb2x2ZVNsb3dUZXN0Q291bnQocHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1NMT1dfVEVTVF9DT1VOVClcblxuICAgICAgaWYgKHNsb3dUZXN0Q291bnQgPiAwICYmIGV4ZWN1dGVkVGVzdHMgPiAxKSB7XG4gICAgICAgIGNvbnN0IHNsb3dlc3RUZXN0cyA9IHRlc3RSdW5uZXIuZ2V0U2xvd2VzdFRlc3RzKHNsb3dUZXN0Q291bnQpXG5cbiAgICAgICAgaWYgKHNsb3dlc3RUZXN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc29sZS5sb2cocGljb2NvbG9ycy5jeWFuKGBcXG5TbG93ZXN0ICR7c2xvd2VzdFRlc3RzLmxlbmd0aH0gdGVzdHM6YCkpXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHNsb3dUZXN0IG9mIHNsb3dlc3RUZXN0cykge1xuICAgICAgICAgICAgY29uc3QgbG9jYXRpb24gPSBzbG93VGVzdC5maWxlUGF0aCAmJiBzbG93VGVzdC5saW5lID8gYCAoJHtzbG93VGVzdC5maWxlUGF0aH06JHtzbG93VGVzdC5saW5lfSlgIDogXCJcIlxuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhwaWNvY29sb3JzLmN5YW4oYCAgJHtTdHJpbmcoc2xvd1Rlc3QuZHVyYXRpb25NcykucGFkU3RhcnQoNil9bXMgICR7c2xvd1Rlc3QuZnVsbERlc2NyaXB0aW9ufSR7bG9jYXRpb259YCkpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICh0ZXN0UnVubmVyLmlzRmFpbGVkKCkpIHtcbiAgICAgICAgYXdhaXQgdGVzdFJ1bm5lci5wZXJzaXN0RmFpbGVkVGVzdENvbnNvbGVPdXRwdXRzVG9Bc3NldHMoKVxuICAgICAgICBjb25zdCBmYWlsZWRUZXN0cyA9IHRlc3RSdW5uZXIuZ2V0RmFpbGVkVGVzdERldGFpbHMoKVxuXG4gICAgICAgIGlmIChmYWlsZWRUZXN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChcIlxcbkZhaWxlZCB0ZXN0czpcIikpXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGZhaWxlZCBvZiBmYWlsZWRUZXN0cykge1xuICAgICAgICAgICAgY29uc3QgbG9jYXRpb24gPSBmYWlsZWQuZmlsZVBhdGggJiYgZmFpbGVkLmxpbmVcbiAgICAgICAgICAgICAgPyBgICgke2ZhaWxlZC5maWxlUGF0aH06JHtmYWlsZWQubGluZX0pYFxuICAgICAgICAgICAgICA6IFwiXCJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYC0gJHtmYWlsZWQuZnVsbERlc2NyaXB0aW9ufSR7bG9jYXRpb259YCkpXG5cbiAgICAgICAgICAgIGlmIChmYWlsZWQuY29uc29sZUxvZ1BhdGgpIHtcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgICBDb25zb2xlIGxvZzogJHtmYWlsZWQuY29uc29sZUxvZ1BhdGh9YCkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlc3RSdW5uZXIuZ2V0Tm90UnVuVGVzdHMoKSA+IDApIGNvbnNvbGUuZXJyb3IoYCR7dGVzdFJ1bm5lci5nZXROb3RSdW5UZXN0cygpfSB0ZXN0cyBub3QgcnVuIGJlY2F1c2UgYSBzaGFyZWQgcmVzb3VyY2UgZmFpbGVkYClcbiAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuVGVzdCBydW4gZmFpbGVkIHdpdGggJHt0ZXN0UnVubmVyLmdldEZhaWxlZFRlc3RzKCl9IGZhaWxlZCB0ZXN0cyBhbmQgJHt0ZXN0UnVubmVyLmdldFN1Y2Nlc3NmdWxUZXN0cygpfSBzdWNjZXNzZnVsbGApKVxuICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJmYWlsZWRcIilcbiAgICAgICAgcHJvY2Vzcy5leGl0KDEpXG4gICAgICB9IGVsc2UgaWYgKHRlc3RSdW5uZXIuYXJlQW55VGVzdHNGb2N1c3NlZCgpKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYFxcbkZvY3Vzc2VkIHJ1biB3aXRoICR7dGVzdFJ1bm5lci5nZXRGYWlsZWRUZXN0cygpfSBmYWlsZWQgdGVzdHMgYW5kICR7dGVzdFJ1bm5lci5nZXRTdWNjZXNzZnVsVGVzdHMoKX0gc3VjY2Vzc2Z1bGxgKSlcbiAgICAgICAgYXdhaXQgZmluYWxpemVQcm9maWxlKFwiZm9jdXNlZFwiKVxuICAgICAgICBwcm9jZXNzLmV4aXQoMSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHBpY29jb2xvcnMuZ3JlZW4oYFxcblRlc3QgcnVuIHN1Y2NlZWRlZCB3aXRoICR7dGVzdFJ1bm5lci5nZXRTdWNjZXNzZnVsVGVzdHMoKX0gc3VjY2Vzc2Z1bCB0ZXN0c2ApKVxuICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJwYXNzZWRcIilcbiAgICAgICAgcHJvY2Vzcy5leGl0KDApXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcImVycm9yXCIpXG4gICAgICB9IGNhdGNoIChwcm9maWxlRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFtlcnJvciwgcHJvZmlsZUVycm9yXSwgXCJUZXN0IGNvbW1hbmQgYW5kIHByb2ZpbGUgZmluYWxpemF0aW9uIGJvdGggZmFpbGVkXCIsIHtjYXVzZTogcHJvZmlsZUVycm9yfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IHsgbG9hZFRpbWluZ01hbmlmZXN0LCByZXNvbHZlVGVzdFByb2ZpbGVPcHRpb25zIH1cblxuLyoqXG4gKiBSZXNvbHZlcyBob3cgbWFueSBzbG93ZXN0IHRlc3RzIHRvIHJlcG9ydCBmcm9tIHRoZSBgVkVMT0NJT1VTX1NMT1dfVEVTVF9DT1VOVGBcbiAqIGVudiB2YWx1ZTogZGVmYXVsdHMgdG8gMTAgd2hlbiB1bnNldDsgMCAob3IgYW4gdW5wYXJzZWFibGUgdmFsdWUpIGRpc2FibGVzIHRoZVxuICogcmVwb3J0OyBvdGhlcndpc2UgdGhlIGZsb29yZWQsIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHJhd0VudlZhbHVlIC0gUmF3IGVudiB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIHNsb3dlc3QgdGVzdHMgdG8gcmVwb3J0ICgwIGRpc2FibGVzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTbG93VGVzdENvdW50KHJhd0VudlZhbHVlKSB7XG4gIGlmIChyYXdFbnZWYWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gMTBcblxuICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihOdW1iZXIocmF3RW52VmFsdWUpKSB8fCAwKVxufVxuIl19
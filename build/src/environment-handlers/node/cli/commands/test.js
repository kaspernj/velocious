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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy90ZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN6RCxPQUFPLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDNUIsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8sVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUNuQyxPQUFPLGVBQWUsTUFBTSwwQ0FBMEMsQ0FBQTtBQUN0RSxPQUFPLFlBQVksTUFBTSxzQ0FBc0MsQ0FBQTtBQUMvRCxPQUFPLEVBQUUsd0JBQXdCLEVBQUUsdUJBQXVCLEVBQUUsTUFBTSw0Q0FBNEMsQ0FBQTtBQUM5RyxPQUFPLFVBQVUsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRCxPQUFPLGlCQUFpQixNQUFNLDRDQUE0QyxDQUFBO0FBQzFFLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxZQUFZLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNsRyxPQUFPLEVBQ0wsMkJBQTJCLEVBQzNCLHlCQUF5QixFQUN6QixzQkFBc0IsRUFDdkIsTUFBTSx3Q0FBd0MsQ0FBQTtBQUMvQyxPQUFPLEVBQUUsd0JBQXdCLEVBQUUsTUFBTSw4QkFBOEIsQ0FBQTtBQUV2RSxNQUFNLENBQUMsT0FBTyxPQUFPLHdCQUF5QixTQUFRLFdBQVc7SUFDL0QsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLHdCQUF3QixFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRTlDLElBQUksU0FBUyxDQUFBO1FBQ2IsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBRXRCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lB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QjtJQUN6RCxJQUFJLENBQUMsa0JBQWtCO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFFekMsSUFBSSxPQUFPLENBQUE7SUFFWCxJQUFJLENBQUM7UUFDSCxPQUFPLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLGtCQUFrQixFQUFFLE1BQU0sQ0FBQyxDQUFBO0lBQ3pELENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsTUFBTSxJQUFJLEtBQUssQ0FBQyxtQ0FBbUMsa0JBQWtCLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQzFGLENBQUM7SUFFRCxJQUFJLE1BQU0sQ0FBQTtJQUVWLElBQUksQ0FBQztRQUNILE1BQU0sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQzlCLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQ0FBb0Msa0JBQWtCLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQzNGLENBQUM7SUFFRCxPQUFPLHNCQUFzQixDQUFDLE1BQU0sRUFBRSxFQUFDLE1BQU0sRUFBRSxtQkFBbUIsa0JBQWtCLEVBQUUsRUFBQyxDQUFDLENBQUE7QUFDMUYsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILE1BQU0sVUFBVSxvQkFBb0IsQ0FBQyxXQUFXO0lBQzlDLElBQUksV0FBVyxLQUFLLFNBQVM7UUFBRSxPQUFPLEVBQUUsQ0FBQTtJQUV4QyxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUE7QUFDMUQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCJcbmltcG9ydCBwaWNvY29sb3JzIGZyb20gXCJwaWNvY29sb3JzXCJcbmltcG9ydCBUZXN0RmlsZXNGaW5kZXIgZnJvbSBcIi4uLy4uLy4uLy4uL3Rlc3RpbmcvdGVzdC1maWxlcy1maW5kZXIuanNcIlxuaW1wb3J0IFRlc3RQcm9maWxlciBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCJcbmltcG9ydCB7IGZvcm1hdFRlc3RQcm9maWxlU3VtbWFyeSwgd3JpdGVUZXN0UHJvZmlsZU91dHB1dHMgfSBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGUtb3V0cHV0LmpzXCJcbmltcG9ydCBUZXN0UnVubmVyIGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3QtcnVubmVyLmpzXCJcbmltcG9ydCBUZXN0U3VpdGVTcGxpdHRlciBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LXN1aXRlLXNwbGl0dGVyLmpzXCJcbmltcG9ydCB7IG5vcm1hbGl6ZUV4YW1wbGVQYXR0ZXJucywgcGFyc2VGaWx0ZXJzIH0gZnJvbSBcIi4uLy4uLy4uLy4uL3Rlc3RpbmcvdGVzdC1maWx0ZXItcGFyc2VyLmpzXCJcbmltcG9ydCB7XG4gIGNhbm9uaWNhbFRpbWluZ01hbmlmZXN0UGF0aCxcbiAgdGltaW5nTWFuaWZlc3RGaWxlU2V0SGFzaCxcbiAgdmFsaWRhdGVUaW1pbmdNYW5pZmVzdFxufSBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90aW1pbmctbWFuaWZlc3QuanNcIlxuaW1wb3J0IHsgcHJlcGFyZVNvdXJjZVBlZXJQYWNrYWdlIH0gZnJvbSBcIi4uLy4uL3NvdXJjZS1wZWVyLXBhY2thZ2UuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNDbGlDb21tYW5kc1Rlc3QgZXh0ZW5kcyBCYXNlQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgYXdhaXQgcHJlcGFyZVNvdXJjZVBlZXJQYWNrYWdlKClcbiAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5zZXRFbnZpcm9ubWVudChcInRlc3RcIilcblxuICAgIGxldCBkaXJlY3RvcnlcbiAgICBjb25zdCBkaXJlY3RvcmllcyA9IFtdXG5cbiAgICBpZiAocHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfRElSKSB7XG4gICAgICBkaXJlY3RvcnkgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9ESVJcbiAgICAgIGRpcmVjdG9yaWVzLnB1c2gocHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfRElSKVxuICAgIH0gZWxzZSB7XG4gICAgICBkaXJlY3RvcnkgPSB0aGlzLmRpcmVjdG9yeSgpXG4gICAgICBkaXJlY3Rvcmllcy5wdXNoKGAke3RoaXMuZGlyZWN0b3J5KCl9L19fdGVzdHNfX2ApXG4gICAgICBkaXJlY3Rvcmllcy5wdXNoKGAke3RoaXMuZGlyZWN0b3J5KCl9L3Rlc3RzYClcbiAgICAgIGRpcmVjdG9yaWVzLnB1c2goYCR7dGhpcy5kaXJlY3RvcnkoKX0vc3BlY2ApXG4gICAgfVxuXG4gICAgY29uc3Qge1xuICAgICAgaW5jbHVkZVRhZ3MsXG4gICAgICBleGNsdWRlVGFncyxcbiAgICAgIGV4YW1wbGVQYXR0ZXJucyxcbiAgICAgIGZpbHRlcmVkUHJvY2Vzc0FyZ3MsXG4gICAgICBncm91cHMsXG4gICAgICBncm91cE51bWJlcixcbiAgICAgIHByb2ZpbGUsXG4gICAgICBwcm9maWxlSnNvblBhdGgsXG4gICAgICB0aW1pbmdNYW5pZmVzdFBhdGgsXG4gICAgICB0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGhcbiAgICB9ID0gcGFyc2VGaWx0ZXJzKHRoaXMucHJvY2Vzc0FyZ3MgfHwgW10pXG4gICAgY29uc3QgcHJvZmlsZU9wdGlvbnMgPSByZXNvbHZlVGVzdFByb2ZpbGVPcHRpb25zKHtcbiAgICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcbiAgICAgIHByb2ZpbGUsXG4gICAgICBwcm9maWxlSnNvblBhdGgsXG4gICAgICB0aW1pbmdNYW5pZmVzdFBhdGgsXG4gICAgICB0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGhcbiAgICB9KVxuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHtcbiAgICAgIGV4Y2x1ZGVUYWdDb3VudDogZXhjbHVkZVRhZ3MubGVuZ3RoLFxuICAgICAgaGFzRXhhbXBsZUZpbHRlcnM6IGV4YW1wbGVQYXR0ZXJucy5sZW5ndGggPiAwLFxuICAgICAgaW5jbHVkZVRhZ0NvdW50OiBpbmNsdWRlVGFncy5sZW5ndGgsXG4gICAgICBzaGFyZDogZ3JvdXBzICE9PSB1bmRlZmluZWQgJiYgZ3JvdXBOdW1iZXIgIT09IHVuZGVmaW5lZCA/IHtncm91cHMsIGdyb3VwTnVtYmVyfSA6IHVuZGVmaW5lZFxuICAgIH1cbiAgICBjb25zdCBwcm9maWxlciA9IHByb2ZpbGVPcHRpb25zLnByb2ZpbGVcbiAgICAgID8gbmV3IFRlc3RQcm9maWxlcih7Y29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksIHByb2plY3REaXJlY3Rvcnk6IGRpcmVjdG9yeSwgc2VsZWN0aW9ufSlcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgY29uc3QgdGVzdEZpbGVzRmluZGVyID0gbmV3IFRlc3RGaWxlc0ZpbmRlcih7ZGlyZWN0b3J5LCBkaXJlY3RvcmllcywgcHJvY2Vzc0FyZ3M6IGZpbHRlcmVkUHJvY2Vzc0FyZ3N9KVxuICAgIC8qKiBAdHlwZSB7VGVzdFJ1bm5lciB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgdGVzdFJ1bm5lclxuICAgIGxldCBwcm9maWxlRmluYWxpemVkID0gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIEZpbmFsaXplcyByZXF1ZXN0ZWQgb3V0cHV0cyBvbmNlIGZvciBldmVyeSBjb21tYW5kIG91dGNvbWUuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIFJ1biBzdGF0dXMuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVxdWVzdGVkIG91dHB1dHMgYXJlIHdyaXR0ZW4uXG4gICAgICovXG4gICAgY29uc3QgZmluYWxpemVQcm9maWxlID0gYXN5bmMgKHN0YXR1cykgPT4ge1xuICAgICAgaWYgKCFwcm9maWxlciB8fCBwcm9maWxlRmluYWxpemVkKSByZXR1cm5cblxuICAgICAgcHJvZmlsZUZpbmFsaXplZCA9IHRydWVcbiAgICAgIGNvbnN0IGZhaWxlZCA9IHRlc3RSdW5uZXI/LmdldEZhaWxlZFRlc3RzKCkgPz8gMFxuICAgICAgY29uc3QgcGFzc2VkID0gdGVzdFJ1bm5lcj8uZ2V0U3VjY2Vzc2Z1bFRlc3RzKCkgPz8gMFxuICAgICAgY29uc3QgcHJvZmlsZURvY3VtZW50ID0gcHJvZmlsZXIuZmluaXNoKHtcbiAgICAgICAgY291bnRzOiB7XG4gICAgICAgICAgZGlzY292ZXJlZDogdGVzdFJ1bm5lcj8uZ2V0VGVzdHNDb3VudCgpID8/IDAsXG4gICAgICAgICAgZXhlY3V0ZWQ6IHRlc3RSdW5uZXI/LmdldEV4ZWN1dGVkVGVzdHNDb3VudCgpID8/IDAsXG4gICAgICAgICAgZmFpbGVkLFxuICAgICAgICAgIHBhc3NlZFxuICAgICAgICB9LFxuICAgICAgICBmb2N1c2VkOiBCb29sZWFuKHRlc3RSdW5uZXI/LmFueVRlc3RzRm9jdXNzZWQpLFxuICAgICAgICBzdGF0dXNcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHdyaXRlVGVzdFByb2ZpbGVPdXRwdXRzKHtcbiAgICAgICAgcHJvZmlsZTogcHJvZmlsZURvY3VtZW50LFxuICAgICAgICBwcm9maWxlSnNvblBhdGg6IHByb2ZpbGVPcHRpb25zLnByb2ZpbGVKc29uUGF0aCxcbiAgICAgICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoOiBwcm9maWxlT3B0aW9ucy50aW1pbmdNYW5pZmVzdE91dHB1dFBhdGhcbiAgICAgIH0pXG4gICAgICBjb25zb2xlLmxvZyhgXFxuJHtmb3JtYXRUZXN0UHJvZmlsZVN1bW1hcnkocHJvZmlsZURvY3VtZW50LCBwcm9maWxlT3B0aW9ucyl9YClcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlzY292ZXJUZXN0RmlsZXMgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHRpbWluZ01hbmlmZXN0ID0gYXdhaXQgbG9hZFRpbWluZ01hbmlmZXN0KHByb2ZpbGVPcHRpb25zLnRpbWluZ01hbmlmZXN0UGF0aClcbiAgICAgICAgbGV0IGRpc2NvdmVyZWRUZXN0RmlsZXMgPSBhd2FpdCB0ZXN0RmlsZXNGaW5kZXIuZmluZFRlc3RGaWxlcygpXG4gICAgICAgIGNvbnN0IGxpbmVGaWx0ZXJzID0gdGVzdEZpbGVzRmluZGVyLmdldExpbmVGaWx0ZXJzQnlGaWxlKClcblxuICAgICAgICBpZiAocHJvZmlsZXIpIHtcbiAgICAgICAgICBjb25zdCBkaXNjb3ZlcmVkRmlsZVBhdGhzID0gZGlzY292ZXJlZFRlc3RGaWxlcy5tYXAoKGZpbGVQYXRoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gY2Fub25pY2FsVGltaW5nTWFuaWZlc3RQYXRoKHBhdGgucmVsYXRpdmUoZGlyZWN0b3J5LCBmaWxlUGF0aCkpXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIHByb2ZpbGVyLnNldFNlbGVjdGlvbih7XG4gICAgICAgICAgICBkaXNjb3ZlcmVkRmlsZUNvdW50OiBkaXNjb3ZlcmVkVGVzdEZpbGVzLmxlbmd0aCxcbiAgICAgICAgICAgIGhhc0xpbmVGaWx0ZXJzOiBPYmplY3Qua2V5cyhsaW5lRmlsdGVycykubGVuZ3RoID4gMCxcbiAgICAgICAgICAgIHBhdGhCYXNlOiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9ESVIgPyBcInRlc3QtZGlyZWN0b3J5XCIgOiBcImNvbmZpZ3VyYXRpb24tZGlyZWN0b3J5XCIsXG4gICAgICAgICAgICB0ZXN0RmlsZVNldEhhc2g6IHRpbWluZ01hbmlmZXN0RmlsZVNldEhhc2goZGlzY292ZXJlZEZpbGVQYXRocylcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGdyb3VwcyAhPT0gdW5kZWZpbmVkIHx8IGdyb3VwTnVtYmVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBpZiAoZ3JvdXBzID09PSB1bmRlZmluZWQgfHwgZ3JvdXBOdW1iZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQm90aCAtLWdyb3VwcyBhbmQgLS1ncm91cC1udW1iZXIgbXVzdCBiZSBwcm92aWRlZCB0b2dldGhlclwiKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNwbGl0dGVyID0gbmV3IFRlc3RTdWl0ZVNwbGl0dGVyKHtcbiAgICAgICAgICAgIGdyb3VwcyxcbiAgICAgICAgICAgIGdyb3VwTnVtYmVyLFxuICAgICAgICAgICAgdGVzdEZpbGVzOiBkaXNjb3ZlcmVkVGVzdEZpbGVzLFxuICAgICAgICAgICAgYmFzZURpcmVjdG9yeTogZGlyZWN0b3J5LFxuICAgICAgICAgICAgdGltaW5nTWFuaWZlc3RcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgaWYgKHByb2ZpbGVPcHRpb25zLnRpbWluZ01hbmlmZXN0UGF0aCkge1xuICAgICAgICAgICAgY29uc3QgY292ZXJhZ2UgPSBzcGxpdHRlci5nZXRUaW1pbmdNYW5pZmVzdENvdmVyYWdlKClcblxuICAgICAgICAgICAgY29uc29sZS5sb2cocGljb2NvbG9ycy5jeWFuKFxuICAgICAgICAgICAgICBgVGltaW5nIG1hbmlmZXN0IGNvdmVyYWdlOiBtZWFzdXJlZD0ke2NvdmVyYWdlLm1lYXN1cmVkRmlsZXN9IGAgK1xuICAgICAgICAgICAgICBgaGV1cmlzdGljPSR7Y292ZXJhZ2UuaGV1cmlzdGljRmlsZXN9IHN0YWxlPSR7Y292ZXJhZ2Uuc3RhbGVFbnRyaWVzfWBcbiAgICAgICAgICAgICkpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZGlzY292ZXJlZFRlc3RGaWxlcyA9IHNwbGl0dGVyLmdldEdyb3VwRmlsZXMoKVxuICAgICAgICAgIGNvbnNvbGUubG9nKHBpY29jb2xvcnMuY3lhbihgUnVubmluZyBncm91cCAke2dyb3VwTnVtYmVyfSBvZiAke2dyb3Vwc30gKCR7ZGlzY292ZXJlZFRlc3RGaWxlcy5sZW5ndGh9IGZpbGVzKWApKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRpc2NvdmVyZWRUZXN0RmlsZXNcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRlc3RGaWxlcyA9IHByb2ZpbGVyXG4gICAgICAgID8gYXdhaXQgcHJvZmlsZXIubWVhc3VyZVBoYXNlKFwiZGlzY292ZXJ5XCIsIGRpc2NvdmVyVGVzdEZpbGVzKVxuICAgICAgICA6IGF3YWl0IGRpc2NvdmVyVGVzdEZpbGVzKClcblxuICAgICAgcHJvZmlsZXI/LnNldFNlbGVjdGlvbih7ZmlsZUNvdW50OiB0ZXN0RmlsZXMubGVuZ3RofSlcbiAgICAgIHRlc3RSdW5uZXIgPSBuZXcgVGVzdFJ1bm5lcih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBleGNsdWRlVGFncyxcbiAgICAgICAgaW5jbHVkZVRhZ3MsXG4gICAgICAgIHRlc3RGaWxlcyxcbiAgICAgICAgbGluZUZpbHRlcnM6IHRlc3RGaWxlc0ZpbmRlci5nZXRMaW5lRmlsdGVyc0J5RmlsZSgpLFxuICAgICAgICBleGFtcGxlUGF0dGVybnM6IG5vcm1hbGl6ZUV4YW1wbGVQYXR0ZXJucyhleGFtcGxlUGF0dGVybnMpLFxuICAgICAgICBwcm9maWxlclxuICAgICAgfSlcbiAgICAgIGNvbnN0IGFjdGl2ZVRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gICAgICBsZXQgc2lnbmFsSGFuZGxlZCA9IGZhbHNlXG5cbiAgICAgIGNvbnN0IGhhbmRsZVNpZ25hbCA9IGFzeW5jICgvKiogQHR5cGUge3N0cmluZ30gKi8gc2lnbmFsKSA9PiB7XG4gICAgICAgIGlmIChzaWduYWxIYW5kbGVkKSByZXR1cm5cbiAgICAgICAgc2lnbmFsSGFuZGxlZCA9IHRydWVcbiAgICAgICAgcHJvZmlsZXI/LmludGVycnVwdCgpXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFxcblJlY2VpdmVkICR7c2lnbmFsfSwgcnVubmluZyBhZnRlckFsbCBob29rcyBiZWZvcmUgZXhpdC4uLmApXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBhY3RpdmVUZXN0UnVubmVyLnJ1bkFmdGVyQWxsc0ZvckFjdGl2ZVNjb3BlcygpXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB3aGlsZSBydW5uaW5nIGFmdGVyQWxsIGhvb2tzOlwiLCBlcnJvcilcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgZmluYWxpemVQcm9maWxlKFwiaW50ZXJydXB0ZWRcIilcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB3aGlsZSB3cml0aW5nIGludGVycnVwdGVkIHRlc3QgcHJvZmlsZTpcIiwgZXJyb3IpXG4gICAgICAgICAgfVxuICAgICAgICAgIHByb2Nlc3MuZXhpdCgxMzApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcHJvY2Vzcy5vbmNlKFwiU0lHSU5UXCIsICgpID0+IHsgdm9pZCBoYW5kbGVTaWduYWwoXCJTSUdJTlRcIikgfSlcbiAgICAgIHByb2Nlc3Mub25jZShcIlNJR1RFUk1cIiwgKCkgPT4geyB2b2lkIGhhbmRsZVNpZ25hbChcIlNJR1RFUk1cIikgfSlcblxuICAgICAgYXdhaXQgdGVzdFJ1bm5lci5wcmVwYXJlKClcbiAgICAgIGNvbnN0IGVmZmVjdGl2ZUV4Y2x1ZGVUYWdDb3VudCA9IHRlc3RSdW5uZXIuZ2V0RXhjbHVkZVRhZ1NldCgpLnNpemVcblxuICAgICAgcHJvZmlsZXI/LnNldFNlbGVjdGlvbih7ZXhjbHVkZVRhZ0NvdW50OiBlZmZlY3RpdmVFeGNsdWRlVGFnQ291bnR9KVxuXG4gICAgICBpZiAodGVzdFJ1bm5lci5nZXRUZXN0c0NvdW50KCkgPT09IDApIHtcbiAgICAgICAgYXdhaXQgZmluYWxpemVQcm9maWxlKFwibm8tdGVzdHNcIilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Rlc3RSdW5uZXIuZ2V0VGVzdHNDb3VudCgpfSB0ZXN0cyB3YXMgZm91bmQgaW4gJHt0ZXN0RmlsZXMubGVuZ3RofSBmaWxlKHMpYClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGVzdFJ1bm5lci5ydW4oKVxuXG4gICAgICBjb25zdCBleGVjdXRlZFRlc3RzID0gdGVzdFJ1bm5lci5nZXRFeGVjdXRlZFRlc3RzQ291bnQoKVxuICAgICAgY29uc3QgbGluZUZpbHRlcnMgPSB0ZXN0UnVubmVyLmdldExpbmVGaWx0ZXJzKClcbiAgICAgIGNvbnN0IGhhc0xpbmVGaWx0ZXJzID0gT2JqZWN0LmtleXMobGluZUZpbHRlcnMpLmxlbmd0aCA+IDBcbiAgICAgIGNvbnN0IGhhc0V4YW1wbGVGaWx0ZXJzID0gZXhhbXBsZVBhdHRlcm5zLmxlbmd0aCA+IDBcbiAgICAgIGNvbnN0IGhhc1RhZ0ZpbHRlcnMgPSBpbmNsdWRlVGFncy5sZW5ndGggPiAwIHx8IGVmZmVjdGl2ZUV4Y2x1ZGVUYWdDb3VudCA+IDBcblxuICAgICAgaWYgKChoYXNUYWdGaWx0ZXJzIHx8IGhhc0xpbmVGaWx0ZXJzIHx8IGhhc0V4YW1wbGVGaWx0ZXJzKSAmJiB0ZXN0UnVubmVyLmhhc05vTWF0Y2hlcygpKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoXCJcXG5ObyB0ZXN0cyBtYXRjaGVkIHRoZSBwcm92aWRlZCBmaWx0ZXJzXCIpKVxuICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJuby10ZXN0c1wiKVxuICAgICAgICBwcm9jZXNzLmV4aXQoMSlcbiAgICAgIH1cblxuICAgICAgLy8gUmVwb3J0IHRoZSBzbG93ZXN0IHRlc3RzIHNvIHN1aXRlIGhvdHNwb3RzIGFyZSB2aXNpYmxlIGV2ZXJ5IHJ1bi4gRGVmYXVsdHMgdG9cbiAgICAgIC8vIHRoZSB0b3AgMTA7IHR1bmUgd2l0aCBWRUxPQ0lPVVNfU0xPV19URVNUX0NPVU5UICgwIGRpc2FibGVzKS4gU2tpcHBlZCBmb3JcbiAgICAgIC8vIHNpbmdsZS10ZXN0IHJ1bnMgd2hlcmUgaXQgd291bGQganVzdCBiZSBub2lzZS5cbiAgICAgIGNvbnN0IHNsb3dUZXN0Q291bnQgPSByZXNvbHZlU2xvd1Rlc3RDb3VudChwcm9jZXNzLmVudi5WRUxPQ0lPVVNfU0xPV19URVNUX0NPVU5UKVxuXG4gICAgICBpZiAoc2xvd1Rlc3RDb3VudCA+IDAgJiYgZXhlY3V0ZWRUZXN0cyA+IDEpIHtcbiAgICAgICAgY29uc3Qgc2xvd2VzdFRlc3RzID0gdGVzdFJ1bm5lci5nZXRTbG93ZXN0VGVzdHMoc2xvd1Rlc3RDb3VudClcblxuICAgICAgICBpZiAoc2xvd2VzdFRlc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhwaWNvY29sb3JzLmN5YW4oYFxcblNsb3dlc3QgJHtzbG93ZXN0VGVzdHMubGVuZ3RofSB0ZXN0czpgKSlcblxuICAgICAgICAgIGZvciAoY29uc3Qgc2xvd1Rlc3Qgb2Ygc2xvd2VzdFRlc3RzKSB7XG4gICAgICAgICAgICBjb25zdCBsb2NhdGlvbiA9IHNsb3dUZXN0LmZpbGVQYXRoICYmIHNsb3dUZXN0LmxpbmUgPyBgICgke3Nsb3dUZXN0LmZpbGVQYXRofToke3Nsb3dUZXN0LmxpbmV9KWAgOiBcIlwiXG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHBpY29jb2xvcnMuY3lhbihgICAke1N0cmluZyhzbG93VGVzdC5kdXJhdGlvbk1zKS5wYWRTdGFydCg2KX1tcyAgJHtzbG93VGVzdC5mdWxsRGVzY3JpcHRpb259JHtsb2NhdGlvbn1gKSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRlc3RSdW5uZXIuaXNGYWlsZWQoKSkge1xuICAgICAgICBhd2FpdCB0ZXN0UnVubmVyLnBlcnNpc3RGYWlsZWRUZXN0Q29uc29sZU91dHB1dHNUb0Fzc2V0cygpXG4gICAgICAgIGNvbnN0IGZhaWxlZFRlc3RzID0gdGVzdFJ1bm5lci5nZXRGYWlsZWRUZXN0RGV0YWlscygpXG5cbiAgICAgICAgaWYgKGZhaWxlZFRlc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKFwiXFxuRmFpbGVkIHRlc3RzOlwiKSlcblxuICAgICAgICAgIGZvciAoY29uc3QgZmFpbGVkIG9mIGZhaWxlZFRlc3RzKSB7XG4gICAgICAgICAgICBjb25zdCBsb2NhdGlvbiA9IGZhaWxlZC5maWxlUGF0aCAmJiBmYWlsZWQubGluZVxuICAgICAgICAgICAgICA/IGAgKCR7ZmFpbGVkLmZpbGVQYXRofToke2ZhaWxlZC5saW5lfSlgXG4gICAgICAgICAgICAgIDogXCJcIlxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgLSAke2ZhaWxlZC5mdWxsRGVzY3JpcHRpb259JHtsb2NhdGlvbn1gKSlcblxuICAgICAgICAgICAgaWYgKGZhaWxlZC5jb25zb2xlTG9nUGF0aCkge1xuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAgIENvbnNvbGUgbG9nOiAke2ZhaWxlZC5jb25zb2xlTG9nUGF0aH1gKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGVzdFJ1bm5lci5nZXROb3RSdW5UZXN0cygpID4gMCkgY29uc29sZS5lcnJvcihgJHt0ZXN0UnVubmVyLmdldE5vdFJ1blRlc3RzKCl9IHRlc3RzIG5vdCBydW4gYmVjYXVzZSBhIHNoYXJlZCByZXNvdXJjZSBmYWlsZWRgKVxuICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5UZXN0IHJ1biBmYWlsZWQgd2l0aCAke3Rlc3RSdW5uZXIuZ2V0RmFpbGVkVGVzdHMoKX0gZmFpbGVkIHRlc3RzIGFuZCAke3Rlc3RSdW5uZXIuZ2V0U3VjY2Vzc2Z1bFRlc3RzKCl9IHN1Y2Nlc3NmdWxsYCkpXG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcImZhaWxlZFwiKVxuICAgICAgICBwcm9jZXNzLmV4aXQoMSlcbiAgICAgIH0gZWxzZSBpZiAodGVzdFJ1bm5lci5hcmVBbnlUZXN0c0ZvY3Vzc2VkKCkpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuRm9jdXNzZWQgcnVuIHdpdGggJHt0ZXN0UnVubmVyLmdldEZhaWxlZFRlc3RzKCl9IGZhaWxlZCB0ZXN0cyBhbmQgJHt0ZXN0UnVubmVyLmdldFN1Y2Nlc3NmdWxUZXN0cygpfSBzdWNjZXNzZnVsbGApKVxuICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJmb2N1c2VkXCIpXG4gICAgICAgIHByb2Nlc3MuZXhpdCgxKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5sb2cocGljb2NvbG9ycy5ncmVlbihgXFxuVGVzdCBydW4gc3VjY2VlZGVkIHdpdGggJHt0ZXN0UnVubmVyLmdldFN1Y2Nlc3NmdWxUZXN0cygpfSBzdWNjZXNzZnVsIHRlc3RzYCkpXG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcInBhc3NlZFwiKVxuICAgICAgICBwcm9jZXNzLmV4aXQoMClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZmluYWxpemVQcm9maWxlKFwiZXJyb3JcIilcbiAgICAgIH0gY2F0Y2ggKHByb2ZpbGVFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCBwcm9maWxlRXJyb3JdLCBcIlRlc3QgY29tbWFuZCBhbmQgcHJvZmlsZSBmaW5hbGl6YXRpb24gYm90aCBmYWlsZWRcIiwge2NhdXNlOiBwcm9maWxlRXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIGFuZCB2YWxpZGF0ZXMgcHJvZmlsaW5nIHBhdGhzIGJlZm9yZSB0ZXN0IGRpc2NvdmVyeSBzdGFydHMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJhdyBwcm9maWxpbmcgb3B0aW9ucy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmN3ZCAtIENvbW1hbmQgd29ya2luZyBkaXJlY3RvcnkuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucHJvZmlsZSAtIFdoZXRoZXIgY29uc29sZSBwcm9maWxpbmcgd2FzIHJlcXVlc3RlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9maWxlSnNvblBhdGhdIC0gUmljaCBwcm9maWxlIG91dHB1dCBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnRpbWluZ01hbmlmZXN0UGF0aF0gLSBUaW1pbmcgbWFuaWZlc3QgaW5wdXQgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy50aW1pbmdNYW5pZmVzdE91dHB1dFBhdGhdIC0gVGltaW5nIG1hbmlmZXN0IG91dHB1dCBwYXRoLlxuICogQHJldHVybnMge3twcm9maWxlOiBib29sZWFuLCBwcm9maWxlSnNvblBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCwgdGltaW5nTWFuaWZlc3RQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBSZXNvbHZlZCBwcm9maWxpbmcgb3B0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUZXN0UHJvZmlsZU9wdGlvbnMoe2N3ZCwgcHJvZmlsZSwgcHJvZmlsZUpzb25QYXRoLCB0aW1pbmdNYW5pZmVzdFBhdGgsIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aH0pIHtcbiAgY29uc3QgcmVzb2x2ZWRQcm9maWxlSnNvblBhdGggPSBwcm9maWxlSnNvblBhdGggPyBwYXRoLnJlc29sdmUoY3dkLCBwcm9maWxlSnNvblBhdGgpIDogdW5kZWZpbmVkXG4gIGNvbnN0IHJlc29sdmVkVGltaW5nTWFuaWZlc3RQYXRoID0gdGltaW5nTWFuaWZlc3RQYXRoID8gcGF0aC5yZXNvbHZlKGN3ZCwgdGltaW5nTWFuaWZlc3RQYXRoKSA6IHVuZGVmaW5lZFxuICBjb25zdCByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCA9IHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aFxuICAgID8gcGF0aC5yZXNvbHZlKGN3ZCwgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoKVxuICAgIDogdW5kZWZpbmVkXG5cbiAgaWYgKHJlc29sdmVkUHJvZmlsZUpzb25QYXRoICYmIHJlc29sdmVkVGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoICYmIHJlc29sdmVkUHJvZmlsZUpzb25QYXRoID09PSByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlRlc3QgcHJvZmlsaW5nIG91dHB1dCBwYXRocyBtdXN0IGJlIGRpZmZlcmVudFwiKVxuICB9XG5cbiAgaWYgKHJlc29sdmVkVGltaW5nTWFuaWZlc3RQYXRoICYmIChcbiAgICByZXNvbHZlZFByb2ZpbGVKc29uUGF0aCA9PT0gcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdFBhdGggfHxcbiAgICByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCA9PT0gcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdFBhdGhcbiAgKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlRlc3QgcHJvZmlsaW5nIG91dHB1dHMgbXVzdCBub3Qgb3ZlcndyaXRlIC0tdGltaW5nLW1hbmlmZXN0IGlucHV0XCIpXG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByb2ZpbGU6IHByb2ZpbGUgfHwgQm9vbGVhbihyZXNvbHZlZFByb2ZpbGVKc29uUGF0aCB8fCByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCksXG4gICAgcHJvZmlsZUpzb25QYXRoOiByZXNvbHZlZFByb2ZpbGVKc29uUGF0aCxcbiAgICB0aW1pbmdNYW5pZmVzdFBhdGg6IHJlc29sdmVkVGltaW5nTWFuaWZlc3RQYXRoLFxuICAgIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aDogcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdE91dHB1dFBhdGhcbiAgfVxufVxuXG4vKipcbiAqIExvYWRzIGFuZCB2YWxpZGF0ZXMgYW4gZXhwbGljaXRseSBzdXBwbGllZCBwbGFpbiBKU09OIHRpbWluZyBtYW5pZmVzdC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB0aW1pbmdNYW5pZmVzdFBhdGggLSBUaW1pbmcgbWFuaWZlc3QgcGF0aC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4gfCB1bmRlZmluZWQ+fSAtIENhbm9uaWNhbCBtYW5pZmVzdCwgb3IgdW5kZWZpbmVkIHdoZW4gbm90IHJlcXVlc3RlZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRUaW1pbmdNYW5pZmVzdCh0aW1pbmdNYW5pZmVzdFBhdGgpIHtcbiAgaWYgKCF0aW1pbmdNYW5pZmVzdFBhdGgpIHJldHVybiB1bmRlZmluZWRcblxuICBsZXQgY29udGVudFxuXG4gIHRyeSB7XG4gICAgY29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKHRpbWluZ01hbmlmZXN0UGF0aCwgXCJ1dGY4XCIpXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVhZCB0aW1pbmcgbWFuaWZlc3Q6ICR7dGltaW5nTWFuaWZlc3RQYXRofWAsIHtjYXVzZTogZXJyb3J9KVxuICB9XG5cbiAgbGV0IHBhcnNlZFxuXG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShjb250ZW50KVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHBhcnNlIHRpbWluZyBtYW5pZmVzdDogJHt0aW1pbmdNYW5pZmVzdFBhdGh9YCwge2NhdXNlOiBlcnJvcn0pXG4gIH1cblxuICByZXR1cm4gdmFsaWRhdGVUaW1pbmdNYW5pZmVzdChwYXJzZWQsIHtzb3VyY2U6IGBUaW1pbmcgbWFuaWZlc3QgJHt0aW1pbmdNYW5pZmVzdFBhdGh9YH0pXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgaG93IG1hbnkgc2xvd2VzdCB0ZXN0cyB0byByZXBvcnQgZnJvbSB0aGUgYFZFTE9DSU9VU19TTE9XX1RFU1RfQ09VTlRgXG4gKiBlbnYgdmFsdWU6IGRlZmF1bHRzIHRvIDEwIHdoZW4gdW5zZXQ7IDAgKG9yIGFuIHVucGFyc2VhYmxlIHZhbHVlKSBkaXNhYmxlcyB0aGVcbiAqIHJlcG9ydDsgb3RoZXJ3aXNlIHRoZSBmbG9vcmVkLCBub24tbmVnYXRpdmUgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSByYXdFbnZWYWx1ZSAtIFJhdyBlbnYgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBzbG93ZXN0IHRlc3RzIHRvIHJlcG9ydCAoMCBkaXNhYmxlcykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU2xvd1Rlc3RDb3VudChyYXdFbnZWYWx1ZSkge1xuICBpZiAocmF3RW52VmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIDEwXG5cbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGguZmxvb3IoTnVtYmVyKHJhd0VudlZhbHVlKSkgfHwgMClcbn1cbiJdfQ==
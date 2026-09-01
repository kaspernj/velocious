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
            if ((hasTagFilters || hasLineFilters || hasExampleFilters) && executedTests === 0) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy90ZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN6RCxPQUFPLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDNUIsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8sVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUNuQyxPQUFPLGVBQWUsTUFBTSwwQ0FBMEMsQ0FBQTtBQUN0RSxPQUFPLFlBQVksTUFBTSxzQ0FBc0MsQ0FBQTtBQUMvRCxPQUFPLEVBQUUsd0JBQXdCLEVBQUUsdUJBQXVCLEVBQUUsTUFBTSw0Q0FBNEMsQ0FBQTtBQUM5RyxPQUFPLFVBQVUsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRCxPQUFPLGlCQUFpQixNQUFNLDRDQUE0QyxDQUFBO0FBQzFFLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxZQUFZLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNsRyxPQUFPLEVBQ0wsMkJBQTJCLEVBQzNCLHlCQUF5QixFQUN6QixzQkFBc0IsRUFDdkIsTUFBTSx3Q0FBd0MsQ0FBQTtBQUMvQyxPQUFPLEVBQUUsd0JBQXdCLEVBQUUsTUFBTSw4QkFBOEIsQ0FBQTtBQUV2RSxNQUFNLENBQUMsT0FBTyxPQUFPLHdCQUF5QixTQUFRLFdBQVc7SUFDL0QsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLHdCQUF3QixFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRTlDLElBQUksU0FBUyxDQUFBO1FBQ2IsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBRXRCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQ25DLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFBO1lBQzFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBQ2xELENBQUM7YUFBTSxDQUFDO1lBQ04sU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtZQUM1QixXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxZQUFZLENBQUMsQ0FBQTtZQUNqRCxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQTtZQUM3QyxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM5QyxDQUFDO1FBRUQsTUFBTSxFQUNKLFdBQVcsRUFDWCxXQUFXLEVBQ1gsZUFBZSxFQUNmLG1CQUFtQixFQUNuQixNQUFNLEVBQ04sV0FBVyxFQUNYLE9BQU8sRUFDUCxlQUFlLEVBQ2Ysa0JBQWtCLEVBQ2xCLHdCQUF3QixFQUN6QixHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBQ3hDLE1BQU0sY0FBYyxHQUFHLHlCQUF5QixDQUFDO1lBQy9DLEdBQUcsRUFBRSxPQUFPLENBQUMsR0FBRyxFQUFFO1lBQ2xCLE9BQU87WUFDUCxlQUFlO1lBQ2Ysa0JBQWtCO1lBQ2xCLHdCQUF3QjtTQUN6QixDQUFDLENBQUE7UUFDRixNQUFNLFNBQVMsR0FBRztZQUNoQixlQUFlLEVBQUUsV0FBVyxDQUFDLE1BQU07WUFDbkMsaUJBQWlCLEVBQUUsZUFBZSxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQzdDLGVBQWUsRUFBRSxXQUFXLENBQUMsTUFBTTtZQUNuQyxLQUFLLEVBQUUsTUFBTSxLQUFLLFNBQVMsSUFBSSxXQUFXLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFDLE1BQU0sRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUM3RixDQUFBO1FBQ0QsTUFBTSxRQUFRLEdBQUcsY0FBYyxDQUFDLE9BQU87WUFDckMsQ0FBQyxDQUFDLElBQUksWUFBWSxDQUFDLEVBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLGdCQUFnQixFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUMsQ0FBQztZQUNwRyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ2IsTUFBTSxlQUFlLEdBQUcsSUFBSSxlQUFlLENBQUMsRUFBQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxtQkFBbUIsRUFBQyxDQUFDLENBQUE7UUFDdkcscUNBQXFDO1FBQ3JDLElBQUksVUFBVSxDQUFBO1FBQ2QsSUFBSSxnQkFBZ0IsR0FBRyxLQUFLLENBQUE7UUFFNUI7Ozs7V0FJRztRQUNILE1BQU0sZUFBZSxHQUFHLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUN2QyxJQUFJLENBQUMsUUFBUSxJQUFJLGdCQUFnQjtnQkFBRSxPQUFNO1lBRXpDLGdCQUFnQixHQUFHLElBQUksQ0FBQTtZQUN2QixNQUFNLE1BQU0sR0FBRyxVQUFVLEVBQUUsY0FBYyxFQUFFLElBQUksQ0FBQyxDQUFBO1lBQ2hELE1BQU0sTUFBTSxHQUFHLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxJQUFJLENBQUMsQ0FBQTtZQUNwRCxNQUFNLGVBQWUsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDO2dCQUN0QyxNQUFNLEVBQUU7b0JBQ04sVUFBVSxFQUFFLFVBQVUsRUFBRSxhQUFhLEVBQUUsSUFBSSxDQUFDO29CQUM1QyxRQUFRLEVBQUUsVUFBVSxFQUFFLHFCQUFxQixFQUFFLElBQUksQ0FBQztvQkFDbEQsTUFBTTtvQkFDTixNQUFNO2lCQUNQO2dCQUNELE9BQU8sRUFBRSxPQUFPLENBQUMsVUFBVSxFQUFFLGdCQUFnQixDQUFDO2dCQUM5QyxNQUFNO2FBQ1AsQ0FBQyxDQUFBO1lBRUYsTUFBTSx1QkFBdUIsQ0FBQztnQkFDNUIsT0FBTyxFQUFFLGVBQWU7Z0JBQ3hCLGVBQWUsRUFBRSxjQUFjLENBQUMsZUFBZTtnQkFDL0Msd0JBQXdCLEVBQUUsY0FBYyxDQUFDLHdCQUF3QjthQUNsRSxDQUFDLENBQUE7WUFDRixPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssd0JBQXdCLENBQUMsZUFBZSxFQUFFLGNBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMvRSxDQUFDLENBQUE7UUFFRCxJQUFJLENBQUM7WUFDSCxNQUFNLGlCQUFpQixHQUFHLEtBQUssSUFBSSxFQUFFO2dCQUNuQyxNQUFNLGNBQWMsR0FBRyxNQUFNLGtCQUFrQixDQUFDLGNBQWMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO2dCQUNsRixJQUFJLG1CQUFtQixHQUFHLE1BQU0sZUFBZSxDQUFDLGFBQWEsRUFBRSxDQUFBO2dCQUMvRCxNQUFNLFdBQVcsR0FBRyxlQUFlLENBQUMsb0JBQW9CLEVBQUUsQ0FBQTtnQkFFMUQsSUFBSSxRQUFRLEVBQUUsQ0FBQztvQkFDYixNQUFNLG1CQUFtQixHQUFHLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsRUFBRSxFQUFFO3dCQUMvRCxPQUFPLDJCQUEyQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUE7b0JBQ3hFLENBQUMsQ0FBQyxDQUFBO29CQUVGLFFBQVEsQ0FBQyxZQUFZLENBQUM7d0JBQ3BCLG1CQUFtQixFQUFFLG1CQUFtQixDQUFDLE1BQU07d0JBQy9DLGNBQWMsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDO3dCQUNuRCxRQUFRLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLHlCQUF5Qjt3QkFDdkYsZUFBZSxFQUFFLHlCQUF5QixDQUFDLG1CQUFtQixDQUFDO3FCQUNoRSxDQUFDLENBQUE7Z0JBQ0osQ0FBQztnQkFFRCxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksV0FBVyxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUN0RCxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksV0FBVyxLQUFLLFNBQVMsRUFBRSxDQUFDO3dCQUN0RCxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxDQUFDLENBQUE7b0JBQy9FLENBQUM7b0JBRUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQzt3QkFDckMsTUFBTTt3QkFDTixXQUFXO3dCQUNYLFNBQVMsRUFBRSxtQkFBbUI7d0JBQzlCLGFBQWEsRUFBRSxTQUFTO3dCQUN4QixjQUFjO3FCQUNmLENBQUMsQ0FBQTtvQkFFRixJQUFJLGNBQWMsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO3dCQUN0QyxNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMseUJBQXlCLEVBQUUsQ0FBQTt3QkFFckQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUN6QixzQ0FBc0MsUUFBUSxDQUFDLGFBQWEsR0FBRzs0QkFDL0QsYUFBYSxRQUFRLENBQUMsY0FBYyxVQUFVLFFBQVEsQ0FBQyxZQUFZLEVBQUUsQ0FDdEUsQ0FBQyxDQUFBO29CQUNKLENBQUM7b0JBRUQsbUJBQW1CLEdBQUcsUUFBUSxDQUFDLGFBQWEsRUFBRSxDQUFBO29CQUM5QyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLFdBQVcsT0FBTyxNQUFNLEtBQUssbUJBQW1CLENBQUMsTUFBTSxTQUFTLENBQUMsQ0FBQyxDQUFBO2dCQUNqSCxDQUFDO2dCQUVELE9BQU8sbUJBQW1CLENBQUE7WUFDNUIsQ0FBQyxDQUFBO1lBQ0QsTUFBTSxTQUFTLEdBQUcsUUFBUTtnQkFDeEIsQ0FBQyxDQUFDLE1BQU0sUUFBUSxDQUFDLFlBQVksQ0FBQyxXQUFXLEVBQUUsaUJBQWlCLENBQUM7Z0JBQzdELENBQUMsQ0FBQyxNQUFNLGlCQUFpQixFQUFFLENBQUE7WUFFN0IsUUFBUSxFQUFFLFlBQVksQ0FBQyxFQUFDLFNBQVMsRUFBRSxTQUFTLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUNyRCxVQUFVLEdBQUcsSUFBSSxVQUFVLENBQUM7Z0JBQzFCLGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3RDLFdBQVc7Z0JBQ1gsV0FBVztnQkFDWCxTQUFTO2dCQUNULFdBQVcsRUFBRSxlQUFlLENBQUMsb0JBQW9CLEVBQUU7Z0JBQ25ELGVBQWUsRUFBRSx3QkFBd0IsQ0FBQyxlQUFlLENBQUM7Z0JBQzFELFFBQVE7YUFDVCxDQUFDLENBQUE7WUFDRixNQUFNLGdCQUFnQixHQUFHLFVBQVUsQ0FBQTtZQUNuQyxJQUFJLGFBQWEsR0FBRyxLQUFLLENBQUE7WUFFekIsTUFBTSxZQUFZLEdBQUcsS0FBSyxFQUFFLHFCQUFxQixDQUFDLE1BQU0sRUFBRSxFQUFFO2dCQUMxRCxJQUFJLGFBQWE7b0JBQUUsT0FBTTtnQkFDekIsYUFBYSxHQUFHLElBQUksQ0FBQTtnQkFDcEIsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFBO2dCQUNyQixPQUFPLENBQUMsS0FBSyxDQUFDLGNBQWMsTUFBTSx5Q0FBeUMsQ0FBQyxDQUFBO2dCQUU1RSxJQUFJLENBQUM7b0JBQ0gsTUFBTSxnQkFBZ0IsQ0FBQywyQkFBMkIsRUFBRSxDQUFBO2dCQUN0RCxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQ0FBc0MsRUFBRSxLQUFLLENBQUMsQ0FBQTtnQkFDOUQsQ0FBQzt3QkFBUyxDQUFDO29CQUNULElBQUksQ0FBQzt3QkFDSCxNQUFNLGVBQWUsQ0FBQyxhQUFhLENBQUMsQ0FBQTtvQkFDdEMsQ0FBQztvQkFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO3dCQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsZ0RBQWdELEVBQUUsS0FBSyxDQUFDLENBQUE7b0JBQ3hFLENBQUM7b0JBQ0QsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtnQkFDbkIsQ0FBQztZQUNILENBQUMsQ0FBQTtZQUVELE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLEdBQUcsRUFBRSxHQUFHLEtBQUssWUFBWSxDQUFDLFFBQVEsQ0FBQyxDQUFBLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDN0QsT0FBTyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsR0FBRyxFQUFFLEdBQUcsS0FBSyxZQUFZLENBQUMsU0FBUyxDQUFDLENBQUEsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUUvRCxNQUFNLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtZQUMxQixNQUFNLHdCQUF3QixHQUFHLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLElBQUksQ0FBQTtZQUVuRSxRQUFRLEVBQUUsWUFBWSxDQUFDLEVBQUMsZUFBZSxFQUFFLHdCQUF3QixFQUFDLENBQUMsQ0FBQTtZQUVuRSxJQUFJLFVBQVUsQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDckMsTUFBTSxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBQ2pDLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxVQUFVLENBQUMsYUFBYSxFQUFFLHVCQUF1QixTQUFTLENBQUMsTUFBTSxVQUFVLENBQUMsQ0FBQTtZQUNqRyxDQUFDO1lBRUQsTUFBTSxVQUFVLENBQUMsR0FBRyxFQUFFLENBQUE7WUFFdEIsTUFBTSxhQUFhLEdBQUcsVUFBVSxDQUFDLHFCQUFxQixFQUFFLENBQUE7WUFDeEQsTUFBTSxXQUFXLEdBQUcsVUFBVSxDQUFDLGNBQWMsRUFBRSxDQUFBO1lBQy9DLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQTtZQUMxRCxNQUFNLGlCQUFpQixHQUFHLGVBQWUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFBO1lBQ3BELE1BQU0sYUFBYSxHQUFHLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLHdCQUF3QixHQUFHLENBQUMsQ0FBQTtZQUU1RSxJQUFJLENBQUMsYUFBYSxJQUFJLGNBQWMsSUFBSSxpQkFBaUIsQ0FBQyxJQUFJLGFBQWEsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDbEYsT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLHlDQUF5QyxDQUFDLENBQUMsQ0FBQTtnQkFDeEUsTUFBTSxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBQ2pDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDakIsQ0FBQztZQUVELGdGQUFnRjtZQUNoRiw0RUFBNEU7WUFDNUUsaURBQWlEO1lBQ2pELE1BQU0sYUFBYSxHQUFHLG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLENBQUMsQ0FBQTtZQUVqRixJQUFJLGFBQWEsR0FBRyxDQUFDLElBQUksYUFBYSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUMzQyxNQUFNLFlBQVksR0FBRyxVQUFVLENBQUMsZUFBZSxDQUFDLGFBQWEsQ0FBQyxDQUFBO2dCQUU5RCxJQUFJLFlBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQzVCLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxhQUFhLFlBQVksQ0FBQyxNQUFNLFNBQVMsQ0FBQyxDQUFDLENBQUE7b0JBRXZFLEtBQUssTUFBTSxRQUFRLElBQUksWUFBWSxFQUFFLENBQUM7d0JBQ3BDLE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxRQUFRLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsS0FBSyxRQUFRLENBQUMsUUFBUSxJQUFJLFFBQVEsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO3dCQUVyRyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsT0FBTyxRQUFRLENBQUMsZUFBZSxHQUFHLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQTtvQkFDeEgsQ0FBQztnQkFDSCxDQUFDO1lBQ0gsQ0FBQztZQUVELElBQUksVUFBVSxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUM7Z0JBQzFCLE1BQU0sVUFBVSxDQUFDLHVDQUF1QyxFQUFFLENBQUE7Z0JBQzFELE1BQU0sV0FBVyxHQUFHLFVBQVUsQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO2dCQUVyRCxJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQzNCLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUE7b0JBRWhELEtBQUssTUFBTSxNQUFNLElBQUksV0FBVyxFQUFFLENBQUM7d0JBQ2pDLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLElBQUk7NEJBQzdDLENBQUMsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLElBQUksR0FBRzs0QkFDeEMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTt3QkFDTixPQUFPLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsS0FBSyxNQUFNLENBQUMsZUFBZSxHQUFHLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQTt3QkFFdkUsSUFBSSxNQUFNLENBQUMsY0FBYyxFQUFFLENBQUM7NEJBQzFCLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsTUFBTSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUMsQ0FBQTt3QkFDMUUsQ0FBQztvQkFDSCxDQUFDO2dCQUNILENBQUM7Z0JBRUQsT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLDBCQUEwQixVQUFVLENBQUMsY0FBYyxFQUFFLHFCQUFxQixVQUFVLENBQUMsa0JBQWtCLEVBQUUsY0FBYyxDQUFDLENBQUMsQ0FBQTtnQkFDdEosTUFBTSxlQUFlLENBQUMsUUFBUSxDQUFDLENBQUE7Z0JBQy9CLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDakIsQ0FBQztpQkFBTSxJQUFJLFVBQVUsQ0FBQyxtQkFBbUIsRUFBRSxFQUFFLENBQUM7Z0JBQzVDLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsVUFBVSxDQUFDLGNBQWMsRUFBRSxxQkFBcUIsVUFBVSxDQUFDLGtCQUFrQixFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUE7Z0JBQ25KLE1BQU0sZUFBZSxDQUFDLFNBQVMsQ0FBQyxDQUFBO2dCQUNoQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQ2pCLENBQUM7aUJBQU0sQ0FBQztnQkFDTixPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsNkJBQTZCLFVBQVUsQ0FBQyxrQkFBa0IsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDLENBQUE7Z0JBQzlHLE1BQU0sZUFBZSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUMvQixPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQ2pCLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQztnQkFDSCxNQUFNLGVBQWUsQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUNoQyxDQUFDO1lBQUMsT0FBTyxZQUFZLEVBQUUsQ0FBQztnQkFDdEIsTUFBTSxJQUFJLGNBQWMsQ0FBQyxDQUFDLEtBQUssRUFBRSxZQUFZLENBQUMsRUFBRSxtREFBbUQsRUFBRSxFQUFDLEtBQUssRUFBRSxZQUFZLEVBQUMsQ0FBQyxDQUFBO1lBQzdILENBQUM7WUFFRCxNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFRDs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFNLFVBQVUseUJBQXlCLENBQUMsRUFBQyxHQUFHLEVBQUUsT0FBTyxFQUFFLGVBQWUsRUFBRSxrQkFBa0IsRUFBRSx3QkFBd0IsRUFBQztJQUNySCxNQUFNLHVCQUF1QixHQUFHLGVBQWUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtJQUNoRyxNQUFNLDBCQUEwQixHQUFHLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7SUFDekcsTUFBTSxnQ0FBZ0MsR0FBRyx3QkFBd0I7UUFDL0QsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLHdCQUF3QixDQUFDO1FBQzdDLENBQUMsQ0FBQyxTQUFTLENBQUE7SUFFYixJQUFJLHVCQUF1QixJQUFJLGdDQUFnQyxJQUFJLHVCQUF1QixLQUFLLGdDQUFnQyxFQUFFLENBQUM7UUFDaEksTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsQ0FBQyxDQUFBO0lBQ2xFLENBQUM7SUFFRCxJQUFJLDBCQUEwQixJQUFJLENBQ2hDLHVCQUF1QixLQUFLLDBCQUEwQjtRQUN0RCxnQ0FBZ0MsS0FBSywwQkFBMEIsQ0FDaEUsRUFBRSxDQUFDO1FBQ0YsTUFBTSxJQUFJLEtBQUssQ0FBQyxtRUFBbUUsQ0FBQyxDQUFBO0lBQ3RGLENBQUM7SUFFRCxPQUFPO1FBQ0wsT0FBTyxFQUFFLE9BQU8sSUFBSSxPQUFPLENBQUMsdUJBQXVCLElBQUksZ0NBQWdDLENBQUM7UUFDeEYsZUFBZSxFQUFFLHVCQUF1QjtRQUN4QyxrQkFBa0IsRUFBRSwwQkFBMEI7UUFDOUMsd0JBQXdCLEVBQUUsZ0NBQWdDO0tBQzNELENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsa0JBQWtCLENBQUMsa0JBQWtCO0lBQ3pELElBQUksQ0FBQyxrQkFBa0I7UUFBRSxPQUFPLFNBQVMsQ0FBQTtJQUV6QyxJQUFJLE9BQU8sQ0FBQTtJQUVYLElBQUksQ0FBQztRQUNILE9BQU8sR0FBRyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsa0JBQWtCLEVBQUUsTUFBTSxDQUFDLENBQUE7SUFDekQsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixNQUFNLElBQUksS0FBSyxDQUFDLG1DQUFtQyxrQkFBa0IsRUFBRSxFQUFFLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7SUFDMUYsQ0FBQztJQUVELElBQUksTUFBTSxDQUFBO0lBRVYsSUFBSSxDQUFDO1FBQ0gsTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDOUIsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxrQkFBa0IsRUFBRSxFQUFFLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7SUFDM0YsQ0FBQztJQUVELE9BQU8sc0JBQXNCLENBQUMsTUFBTSxFQUFFLEVBQUMsTUFBTSxFQUFFLG1CQUFtQixrQkFBa0IsRUFBRSxFQUFDLENBQUMsQ0FBQTtBQUMxRixDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsTUFBTSxVQUFVLG9CQUFvQixDQUFDLFdBQVc7SUFDOUMsSUFBSSxXQUFXLEtBQUssU0FBUztRQUFFLE9BQU8sRUFBRSxDQUFBO0lBRXhDLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtBQUMxRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuaW1wb3J0IHBpY29jb2xvcnMgZnJvbSBcInBpY29jb2xvcnNcIlxuaW1wb3J0IFRlc3RGaWxlc0ZpbmRlciBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LWZpbGVzLWZpbmRlci5qc1wiXG5pbXBvcnQgVGVzdFByb2ZpbGVyIGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIlxuaW1wb3J0IHsgZm9ybWF0VGVzdFByb2ZpbGVTdW1tYXJ5LCB3cml0ZVRlc3RQcm9maWxlT3V0cHV0cyB9IGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1vdXRwdXQuanNcIlxuaW1wb3J0IFRlc3RSdW5uZXIgZnJvbSBcIi4uLy4uLy4uLy4uL3Rlc3RpbmcvdGVzdC1ydW5uZXIuanNcIlxuaW1wb3J0IFRlc3RTdWl0ZVNwbGl0dGVyIGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3Rlc3Qtc3VpdGUtc3BsaXR0ZXIuanNcIlxuaW1wb3J0IHsgbm9ybWFsaXplRXhhbXBsZVBhdHRlcm5zLCBwYXJzZUZpbHRlcnMgfSBmcm9tIFwiLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LWZpbHRlci1wYXJzZXIuanNcIlxuaW1wb3J0IHtcbiAgY2Fub25pY2FsVGltaW5nTWFuaWZlc3RQYXRoLFxuICB0aW1pbmdNYW5pZmVzdEZpbGVTZXRIYXNoLFxuICB2YWxpZGF0ZVRpbWluZ01hbmlmZXN0XG59IGZyb20gXCIuLi8uLi8uLi8uLi90ZXN0aW5nL3RpbWluZy1tYW5pZmVzdC5qc1wiXG5pbXBvcnQgeyBwcmVwYXJlU291cmNlUGVlclBhY2thZ2UgfSBmcm9tIFwiLi4vLi4vc291cmNlLXBlZXItcGFja2FnZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NsaUNvbW1hbmRzVGVzdCBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBhd2FpdCBwcmVwYXJlU291cmNlUGVlclBhY2thZ2UoKVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLnNldEVudmlyb25tZW50KFwidGVzdFwiKVxuXG4gICAgbGV0IGRpcmVjdG9yeVxuICAgIGNvbnN0IGRpcmVjdG9yaWVzID0gW11cblxuICAgIGlmIChwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9ESVIpIHtcbiAgICAgIGRpcmVjdG9yeSA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19URVNUX0RJUlxuICAgICAgZGlyZWN0b3JpZXMucHVzaChwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9ESVIpXG4gICAgfSBlbHNlIHtcbiAgICAgIGRpcmVjdG9yeSA9IHRoaXMuZGlyZWN0b3J5KClcbiAgICAgIGRpcmVjdG9yaWVzLnB1c2goYCR7dGhpcy5kaXJlY3RvcnkoKX0vX190ZXN0c19fYClcbiAgICAgIGRpcmVjdG9yaWVzLnB1c2goYCR7dGhpcy5kaXJlY3RvcnkoKX0vdGVzdHNgKVxuICAgICAgZGlyZWN0b3JpZXMucHVzaChgJHt0aGlzLmRpcmVjdG9yeSgpfS9zcGVjYClcbiAgICB9XG5cbiAgICBjb25zdCB7XG4gICAgICBpbmNsdWRlVGFncyxcbiAgICAgIGV4Y2x1ZGVUYWdzLFxuICAgICAgZXhhbXBsZVBhdHRlcm5zLFxuICAgICAgZmlsdGVyZWRQcm9jZXNzQXJncyxcbiAgICAgIGdyb3VwcyxcbiAgICAgIGdyb3VwTnVtYmVyLFxuICAgICAgcHJvZmlsZSxcbiAgICAgIHByb2ZpbGVKc29uUGF0aCxcbiAgICAgIHRpbWluZ01hbmlmZXN0UGF0aCxcbiAgICAgIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aFxuICAgIH0gPSBwYXJzZUZpbHRlcnModGhpcy5wcm9jZXNzQXJncyB8fCBbXSlcbiAgICBjb25zdCBwcm9maWxlT3B0aW9ucyA9IHJlc29sdmVUZXN0UHJvZmlsZU9wdGlvbnMoe1xuICAgICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgICAgcHJvZmlsZSxcbiAgICAgIHByb2ZpbGVKc29uUGF0aCxcbiAgICAgIHRpbWluZ01hbmlmZXN0UGF0aCxcbiAgICAgIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aFxuICAgIH0pXG4gICAgY29uc3Qgc2VsZWN0aW9uID0ge1xuICAgICAgZXhjbHVkZVRhZ0NvdW50OiBleGNsdWRlVGFncy5sZW5ndGgsXG4gICAgICBoYXNFeGFtcGxlRmlsdGVyczogZXhhbXBsZVBhdHRlcm5zLmxlbmd0aCA+IDAsXG4gICAgICBpbmNsdWRlVGFnQ291bnQ6IGluY2x1ZGVUYWdzLmxlbmd0aCxcbiAgICAgIHNoYXJkOiBncm91cHMgIT09IHVuZGVmaW5lZCAmJiBncm91cE51bWJlciAhPT0gdW5kZWZpbmVkID8ge2dyb3VwcywgZ3JvdXBOdW1iZXJ9IDogdW5kZWZpbmVkXG4gICAgfVxuICAgIGNvbnN0IHByb2ZpbGVyID0gcHJvZmlsZU9wdGlvbnMucHJvZmlsZVxuICAgICAgPyBuZXcgVGVzdFByb2ZpbGVyKHtjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSwgcHJvamVjdERpcmVjdG9yeTogZGlyZWN0b3J5LCBzZWxlY3Rpb259KVxuICAgICAgOiB1bmRlZmluZWRcbiAgICBjb25zdCB0ZXN0RmlsZXNGaW5kZXIgPSBuZXcgVGVzdEZpbGVzRmluZGVyKHtkaXJlY3RvcnksIGRpcmVjdG9yaWVzLCBwcm9jZXNzQXJnczogZmlsdGVyZWRQcm9jZXNzQXJnc30pXG4gICAgLyoqIEB0eXBlIHtUZXN0UnVubmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0ZXN0UnVubmVyXG4gICAgbGV0IHByb2ZpbGVGaW5hbGl6ZWQgPSBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogRmluYWxpemVzIHJlcXVlc3RlZCBvdXRwdXRzIG9uY2UgZm9yIGV2ZXJ5IGNvbW1hbmQgb3V0Y29tZS5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RhdHVzIC0gUnVuIHN0YXR1cy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXF1ZXN0ZWQgb3V0cHV0cyBhcmUgd3JpdHRlbi5cbiAgICAgKi9cbiAgICBjb25zdCBmaW5hbGl6ZVByb2ZpbGUgPSBhc3luYyAoc3RhdHVzKSA9PiB7XG4gICAgICBpZiAoIXByb2ZpbGVyIHx8IHByb2ZpbGVGaW5hbGl6ZWQpIHJldHVyblxuXG4gICAgICBwcm9maWxlRmluYWxpemVkID0gdHJ1ZVxuICAgICAgY29uc3QgZmFpbGVkID0gdGVzdFJ1bm5lcj8uZ2V0RmFpbGVkVGVzdHMoKSA/PyAwXG4gICAgICBjb25zdCBwYXNzZWQgPSB0ZXN0UnVubmVyPy5nZXRTdWNjZXNzZnVsVGVzdHMoKSA/PyAwXG4gICAgICBjb25zdCBwcm9maWxlRG9jdW1lbnQgPSBwcm9maWxlci5maW5pc2goe1xuICAgICAgICBjb3VudHM6IHtcbiAgICAgICAgICBkaXNjb3ZlcmVkOiB0ZXN0UnVubmVyPy5nZXRUZXN0c0NvdW50KCkgPz8gMCxcbiAgICAgICAgICBleGVjdXRlZDogdGVzdFJ1bm5lcj8uZ2V0RXhlY3V0ZWRUZXN0c0NvdW50KCkgPz8gMCxcbiAgICAgICAgICBmYWlsZWQsXG4gICAgICAgICAgcGFzc2VkXG4gICAgICAgIH0sXG4gICAgICAgIGZvY3VzZWQ6IEJvb2xlYW4odGVzdFJ1bm5lcj8uYW55VGVzdHNGb2N1c3NlZCksXG4gICAgICAgIHN0YXR1c1xuICAgICAgfSlcblxuICAgICAgYXdhaXQgd3JpdGVUZXN0UHJvZmlsZU91dHB1dHMoe1xuICAgICAgICBwcm9maWxlOiBwcm9maWxlRG9jdW1lbnQsXG4gICAgICAgIHByb2ZpbGVKc29uUGF0aDogcHJvZmlsZU9wdGlvbnMucHJvZmlsZUpzb25QYXRoLFxuICAgICAgICB0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGg6IHByb2ZpbGVPcHRpb25zLnRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aFxuICAgICAgfSlcbiAgICAgIGNvbnNvbGUubG9nKGBcXG4ke2Zvcm1hdFRlc3RQcm9maWxlU3VtbWFyeShwcm9maWxlRG9jdW1lbnQsIHByb2ZpbGVPcHRpb25zKX1gKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXNjb3ZlclRlc3RGaWxlcyA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgdGltaW5nTWFuaWZlc3QgPSBhd2FpdCBsb2FkVGltaW5nTWFuaWZlc3QocHJvZmlsZU9wdGlvbnMudGltaW5nTWFuaWZlc3RQYXRoKVxuICAgICAgICBsZXQgZGlzY292ZXJlZFRlc3RGaWxlcyA9IGF3YWl0IHRlc3RGaWxlc0ZpbmRlci5maW5kVGVzdEZpbGVzKClcbiAgICAgICAgY29uc3QgbGluZUZpbHRlcnMgPSB0ZXN0RmlsZXNGaW5kZXIuZ2V0TGluZUZpbHRlcnNCeUZpbGUoKVxuXG4gICAgICAgIGlmIChwcm9maWxlcikge1xuICAgICAgICAgIGNvbnN0IGRpc2NvdmVyZWRGaWxlUGF0aHMgPSBkaXNjb3ZlcmVkVGVzdEZpbGVzLm1hcCgoZmlsZVBhdGgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBjYW5vbmljYWxUaW1pbmdNYW5pZmVzdFBhdGgocGF0aC5yZWxhdGl2ZShkaXJlY3RvcnksIGZpbGVQYXRoKSlcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgcHJvZmlsZXIuc2V0U2VsZWN0aW9uKHtcbiAgICAgICAgICAgIGRpc2NvdmVyZWRGaWxlQ291bnQ6IGRpc2NvdmVyZWRUZXN0RmlsZXMubGVuZ3RoLFxuICAgICAgICAgICAgaGFzTGluZUZpbHRlcnM6IE9iamVjdC5rZXlzKGxpbmVGaWx0ZXJzKS5sZW5ndGggPiAwLFxuICAgICAgICAgICAgcGF0aEJhc2U6IHByb2Nlc3MuZW52LlZFTE9DSU9VU19URVNUX0RJUiA/IFwidGVzdC1kaXJlY3RvcnlcIiA6IFwiY29uZmlndXJhdGlvbi1kaXJlY3RvcnlcIixcbiAgICAgICAgICAgIHRlc3RGaWxlU2V0SGFzaDogdGltaW5nTWFuaWZlc3RGaWxlU2V0SGFzaChkaXNjb3ZlcmVkRmlsZVBhdGhzKVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZ3JvdXBzICE9PSB1bmRlZmluZWQgfHwgZ3JvdXBOdW1iZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGlmIChncm91cHMgPT09IHVuZGVmaW5lZCB8fCBncm91cE51bWJlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCb3RoIC0tZ3JvdXBzIGFuZCAtLWdyb3VwLW51bWJlciBtdXN0IGJlIHByb3ZpZGVkIHRvZ2V0aGVyXCIpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc3BsaXR0ZXIgPSBuZXcgVGVzdFN1aXRlU3BsaXR0ZXIoe1xuICAgICAgICAgICAgZ3JvdXBzLFxuICAgICAgICAgICAgZ3JvdXBOdW1iZXIsXG4gICAgICAgICAgICB0ZXN0RmlsZXM6IGRpc2NvdmVyZWRUZXN0RmlsZXMsXG4gICAgICAgICAgICBiYXNlRGlyZWN0b3J5OiBkaXJlY3RvcnksXG4gICAgICAgICAgICB0aW1pbmdNYW5pZmVzdFxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBpZiAocHJvZmlsZU9wdGlvbnMudGltaW5nTWFuaWZlc3RQYXRoKSB7XG4gICAgICAgICAgICBjb25zdCBjb3ZlcmFnZSA9IHNwbGl0dGVyLmdldFRpbWluZ01hbmlmZXN0Q292ZXJhZ2UoKVxuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhwaWNvY29sb3JzLmN5YW4oXG4gICAgICAgICAgICAgIGBUaW1pbmcgbWFuaWZlc3QgY292ZXJhZ2U6IG1lYXN1cmVkPSR7Y292ZXJhZ2UubWVhc3VyZWRGaWxlc30gYCArXG4gICAgICAgICAgICAgIGBoZXVyaXN0aWM9JHtjb3ZlcmFnZS5oZXVyaXN0aWNGaWxlc30gc3RhbGU9JHtjb3ZlcmFnZS5zdGFsZUVudHJpZXN9YFxuICAgICAgICAgICAgKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBkaXNjb3ZlcmVkVGVzdEZpbGVzID0gc3BsaXR0ZXIuZ2V0R3JvdXBGaWxlcygpXG4gICAgICAgICAgY29uc29sZS5sb2cocGljb2NvbG9ycy5jeWFuKGBSdW5uaW5nIGdyb3VwICR7Z3JvdXBOdW1iZXJ9IG9mICR7Z3JvdXBzfSAoJHtkaXNjb3ZlcmVkVGVzdEZpbGVzLmxlbmd0aH0gZmlsZXMpYCkpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZGlzY292ZXJlZFRlc3RGaWxlc1xuICAgICAgfVxuICAgICAgY29uc3QgdGVzdEZpbGVzID0gcHJvZmlsZXJcbiAgICAgICAgPyBhd2FpdCBwcm9maWxlci5tZWFzdXJlUGhhc2UoXCJkaXNjb3ZlcnlcIiwgZGlzY292ZXJUZXN0RmlsZXMpXG4gICAgICAgIDogYXdhaXQgZGlzY292ZXJUZXN0RmlsZXMoKVxuXG4gICAgICBwcm9maWxlcj8uc2V0U2VsZWN0aW9uKHtmaWxlQ291bnQ6IHRlc3RGaWxlcy5sZW5ndGh9KVxuICAgICAgdGVzdFJ1bm5lciA9IG5ldyBUZXN0UnVubmVyKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGV4Y2x1ZGVUYWdzLFxuICAgICAgICBpbmNsdWRlVGFncyxcbiAgICAgICAgdGVzdEZpbGVzLFxuICAgICAgICBsaW5lRmlsdGVyczogdGVzdEZpbGVzRmluZGVyLmdldExpbmVGaWx0ZXJzQnlGaWxlKCksXG4gICAgICAgIGV4YW1wbGVQYXR0ZXJuczogbm9ybWFsaXplRXhhbXBsZVBhdHRlcm5zKGV4YW1wbGVQYXR0ZXJucyksXG4gICAgICAgIHByb2ZpbGVyXG4gICAgICB9KVxuICAgICAgY29uc3QgYWN0aXZlVGVzdFJ1bm5lciA9IHRlc3RSdW5uZXJcbiAgICAgIGxldCBzaWduYWxIYW5kbGVkID0gZmFsc2VcblxuICAgICAgY29uc3QgaGFuZGxlU2lnbmFsID0gYXN5bmMgKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHNpZ25hbEhhbmRsZWQpIHJldHVyblxuICAgICAgICBzaWduYWxIYW5kbGVkID0gdHJ1ZVxuICAgICAgICBwcm9maWxlcj8uaW50ZXJydXB0KClcbiAgICAgICAgY29uc29sZS5lcnJvcihgXFxuUmVjZWl2ZWQgJHtzaWduYWx9LCBydW5uaW5nIGFmdGVyQWxsIGhvb2tzIGJlZm9yZSBleGl0Li4uYClcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGFjdGl2ZVRlc3RSdW5uZXIucnVuQWZ0ZXJBbGxzRm9yQWN0aXZlU2NvcGVzKClcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHdoaWxlIHJ1bm5pbmcgYWZ0ZXJBbGwgaG9va3M6XCIsIGVycm9yKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJpbnRlcnJ1cHRlZFwiKVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHdoaWxlIHdyaXRpbmcgaW50ZXJydXB0ZWQgdGVzdCBwcm9maWxlOlwiLCBlcnJvcilcbiAgICAgICAgICB9XG4gICAgICAgICAgcHJvY2Vzcy5leGl0KDEzMClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBwcm9jZXNzLm9uY2UoXCJTSUdJTlRcIiwgKCkgPT4geyB2b2lkIGhhbmRsZVNpZ25hbChcIlNJR0lOVFwiKSB9KVxuICAgICAgcHJvY2Vzcy5vbmNlKFwiU0lHVEVSTVwiLCAoKSA9PiB7IHZvaWQgaGFuZGxlU2lnbmFsKFwiU0lHVEVSTVwiKSB9KVxuXG4gICAgICBhd2FpdCB0ZXN0UnVubmVyLnByZXBhcmUoKVxuICAgICAgY29uc3QgZWZmZWN0aXZlRXhjbHVkZVRhZ0NvdW50ID0gdGVzdFJ1bm5lci5nZXRFeGNsdWRlVGFnU2V0KCkuc2l6ZVxuXG4gICAgICBwcm9maWxlcj8uc2V0U2VsZWN0aW9uKHtleGNsdWRlVGFnQ291bnQ6IGVmZmVjdGl2ZUV4Y2x1ZGVUYWdDb3VudH0pXG5cbiAgICAgIGlmICh0ZXN0UnVubmVyLmdldFRlc3RzQ291bnQoKSA9PT0gMCkge1xuICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJuby10ZXN0c1wiKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGVzdFJ1bm5lci5nZXRUZXN0c0NvdW50KCl9IHRlc3RzIHdhcyBmb3VuZCBpbiAke3Rlc3RGaWxlcy5sZW5ndGh9IGZpbGUocylgKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0ZXN0UnVubmVyLnJ1bigpXG5cbiAgICAgIGNvbnN0IGV4ZWN1dGVkVGVzdHMgPSB0ZXN0UnVubmVyLmdldEV4ZWN1dGVkVGVzdHNDb3VudCgpXG4gICAgICBjb25zdCBsaW5lRmlsdGVycyA9IHRlc3RSdW5uZXIuZ2V0TGluZUZpbHRlcnMoKVxuICAgICAgY29uc3QgaGFzTGluZUZpbHRlcnMgPSBPYmplY3Qua2V5cyhsaW5lRmlsdGVycykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgaGFzRXhhbXBsZUZpbHRlcnMgPSBleGFtcGxlUGF0dGVybnMubGVuZ3RoID4gMFxuICAgICAgY29uc3QgaGFzVGFnRmlsdGVycyA9IGluY2x1ZGVUYWdzLmxlbmd0aCA+IDAgfHwgZWZmZWN0aXZlRXhjbHVkZVRhZ0NvdW50ID4gMFxuXG4gICAgICBpZiAoKGhhc1RhZ0ZpbHRlcnMgfHwgaGFzTGluZUZpbHRlcnMgfHwgaGFzRXhhbXBsZUZpbHRlcnMpICYmIGV4ZWN1dGVkVGVzdHMgPT09IDApIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChcIlxcbk5vIHRlc3RzIG1hdGNoZWQgdGhlIHByb3ZpZGVkIGZpbHRlcnNcIikpXG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcIm5vLXRlc3RzXCIpXG4gICAgICAgIHByb2Nlc3MuZXhpdCgxKVxuICAgICAgfVxuXG4gICAgICAvLyBSZXBvcnQgdGhlIHNsb3dlc3QgdGVzdHMgc28gc3VpdGUgaG90c3BvdHMgYXJlIHZpc2libGUgZXZlcnkgcnVuLiBEZWZhdWx0cyB0b1xuICAgICAgLy8gdGhlIHRvcCAxMDsgdHVuZSB3aXRoIFZFTE9DSU9VU19TTE9XX1RFU1RfQ09VTlQgKDAgZGlzYWJsZXMpLiBTa2lwcGVkIGZvclxuICAgICAgLy8gc2luZ2xlLXRlc3QgcnVucyB3aGVyZSBpdCB3b3VsZCBqdXN0IGJlIG5vaXNlLlxuICAgICAgY29uc3Qgc2xvd1Rlc3RDb3VudCA9IHJlc29sdmVTbG93VGVzdENvdW50KHByb2Nlc3MuZW52LlZFTE9DSU9VU19TTE9XX1RFU1RfQ09VTlQpXG5cbiAgICAgIGlmIChzbG93VGVzdENvdW50ID4gMCAmJiBleGVjdXRlZFRlc3RzID4gMSkge1xuICAgICAgICBjb25zdCBzbG93ZXN0VGVzdHMgPSB0ZXN0UnVubmVyLmdldFNsb3dlc3RUZXN0cyhzbG93VGVzdENvdW50KVxuXG4gICAgICAgIGlmIChzbG93ZXN0VGVzdHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnNvbGUubG9nKHBpY29jb2xvcnMuY3lhbihgXFxuU2xvd2VzdCAke3Nsb3dlc3RUZXN0cy5sZW5ndGh9IHRlc3RzOmApKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBzbG93VGVzdCBvZiBzbG93ZXN0VGVzdHMpIHtcbiAgICAgICAgICAgIGNvbnN0IGxvY2F0aW9uID0gc2xvd1Rlc3QuZmlsZVBhdGggJiYgc2xvd1Rlc3QubGluZSA/IGAgKCR7c2xvd1Rlc3QuZmlsZVBhdGh9OiR7c2xvd1Rlc3QubGluZX0pYCA6IFwiXCJcblxuICAgICAgICAgICAgY29uc29sZS5sb2cocGljb2NvbG9ycy5jeWFuKGAgICR7U3RyaW5nKHNsb3dUZXN0LmR1cmF0aW9uTXMpLnBhZFN0YXJ0KDYpfW1zICAke3Nsb3dUZXN0LmZ1bGxEZXNjcmlwdGlvbn0ke2xvY2F0aW9ufWApKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAodGVzdFJ1bm5lci5pc0ZhaWxlZCgpKSB7XG4gICAgICAgIGF3YWl0IHRlc3RSdW5uZXIucGVyc2lzdEZhaWxlZFRlc3RDb25zb2xlT3V0cHV0c1RvQXNzZXRzKClcbiAgICAgICAgY29uc3QgZmFpbGVkVGVzdHMgPSB0ZXN0UnVubmVyLmdldEZhaWxlZFRlc3REZXRhaWxzKClcblxuICAgICAgICBpZiAoZmFpbGVkVGVzdHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoXCJcXG5GYWlsZWQgdGVzdHM6XCIpKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBmYWlsZWQgb2YgZmFpbGVkVGVzdHMpIHtcbiAgICAgICAgICAgIGNvbnN0IGxvY2F0aW9uID0gZmFpbGVkLmZpbGVQYXRoICYmIGZhaWxlZC5saW5lXG4gICAgICAgICAgICAgID8gYCAoJHtmYWlsZWQuZmlsZVBhdGh9OiR7ZmFpbGVkLmxpbmV9KWBcbiAgICAgICAgICAgICAgOiBcIlwiXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAtICR7ZmFpbGVkLmZ1bGxEZXNjcmlwdGlvbn0ke2xvY2F0aW9ufWApKVxuXG4gICAgICAgICAgICBpZiAoZmFpbGVkLmNvbnNvbGVMb2dQYXRoKSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCAgQ29uc29sZSBsb2c6ICR7ZmFpbGVkLmNvbnNvbGVMb2dQYXRofWApKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYFxcblRlc3QgcnVuIGZhaWxlZCB3aXRoICR7dGVzdFJ1bm5lci5nZXRGYWlsZWRUZXN0cygpfSBmYWlsZWQgdGVzdHMgYW5kICR7dGVzdFJ1bm5lci5nZXRTdWNjZXNzZnVsVGVzdHMoKX0gc3VjY2Vzc2Z1bGxgKSlcbiAgICAgICAgYXdhaXQgZmluYWxpemVQcm9maWxlKFwiZmFpbGVkXCIpXG4gICAgICAgIHByb2Nlc3MuZXhpdCgxKVxuICAgICAgfSBlbHNlIGlmICh0ZXN0UnVubmVyLmFyZUFueVRlc3RzRm9jdXNzZWQoKSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5Gb2N1c3NlZCBydW4gd2l0aCAke3Rlc3RSdW5uZXIuZ2V0RmFpbGVkVGVzdHMoKX0gZmFpbGVkIHRlc3RzIGFuZCAke3Rlc3RSdW5uZXIuZ2V0U3VjY2Vzc2Z1bFRlc3RzKCl9IHN1Y2Nlc3NmdWxsYCkpXG4gICAgICAgIGF3YWl0IGZpbmFsaXplUHJvZmlsZShcImZvY3VzZWRcIilcbiAgICAgICAgcHJvY2Vzcy5leGl0KDEpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZyhwaWNvY29sb3JzLmdyZWVuKGBcXG5UZXN0IHJ1biBzdWNjZWVkZWQgd2l0aCAke3Rlc3RSdW5uZXIuZ2V0U3VjY2Vzc2Z1bFRlc3RzKCl9IHN1Y2Nlc3NmdWwgdGVzdHNgKSlcbiAgICAgICAgYXdhaXQgZmluYWxpemVQcm9maWxlKFwicGFzc2VkXCIpXG4gICAgICAgIHByb2Nlc3MuZXhpdCgwKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmaW5hbGl6ZVByb2ZpbGUoXCJlcnJvclwiKVxuICAgICAgfSBjYXRjaCAocHJvZmlsZUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbZXJyb3IsIHByb2ZpbGVFcnJvcl0sIFwiVGVzdCBjb21tYW5kIGFuZCBwcm9maWxlIGZpbmFsaXphdGlvbiBib3RoIGZhaWxlZFwiLCB7Y2F1c2U6IHByb2ZpbGVFcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYW5kIHZhbGlkYXRlcyBwcm9maWxpbmcgcGF0aHMgYmVmb3JlIHRlc3QgZGlzY292ZXJ5IHN0YXJ0cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmF3IHByb2ZpbGluZyBvcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY3dkIC0gQ29tbWFuZCB3b3JraW5nIGRpcmVjdG9yeS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wcm9maWxlIC0gV2hldGhlciBjb25zb2xlIHByb2ZpbGluZyB3YXMgcmVxdWVzdGVkLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnByb2ZpbGVKc29uUGF0aF0gLSBSaWNoIHByb2ZpbGUgb3V0cHV0IHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MudGltaW5nTWFuaWZlc3RQYXRoXSAtIFRpbWluZyBtYW5pZmVzdCBpbnB1dCBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aF0gLSBUaW1pbmcgbWFuaWZlc3Qgb3V0cHV0IHBhdGguXG4gKiBAcmV0dXJucyB7e3Byb2ZpbGU6IGJvb2xlYW4sIHByb2ZpbGVKc29uUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkLCB0aW1pbmdNYW5pZmVzdFBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCwgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIFJlc29sdmVkIHByb2ZpbGluZyBvcHRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRlc3RQcm9maWxlT3B0aW9ucyh7Y3dkLCBwcm9maWxlLCBwcm9maWxlSnNvblBhdGgsIHRpbWluZ01hbmlmZXN0UGF0aCwgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRofSkge1xuICBjb25zdCByZXNvbHZlZFByb2ZpbGVKc29uUGF0aCA9IHByb2ZpbGVKc29uUGF0aCA/IHBhdGgucmVzb2x2ZShjd2QsIHByb2ZpbGVKc29uUGF0aCkgOiB1bmRlZmluZWRcbiAgY29uc3QgcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdFBhdGggPSB0aW1pbmdNYW5pZmVzdFBhdGggPyBwYXRoLnJlc29sdmUoY3dkLCB0aW1pbmdNYW5pZmVzdFBhdGgpIDogdW5kZWZpbmVkXG4gIGNvbnN0IHJlc29sdmVkVGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoID0gdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoXG4gICAgPyBwYXRoLnJlc29sdmUoY3dkLCB0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGgpXG4gICAgOiB1bmRlZmluZWRcblxuICBpZiAocmVzb2x2ZWRQcm9maWxlSnNvblBhdGggJiYgcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdE91dHB1dFBhdGggJiYgcmVzb2x2ZWRQcm9maWxlSnNvblBhdGggPT09IHJlc29sdmVkVGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVGVzdCBwcm9maWxpbmcgb3V0cHV0IHBhdGhzIG11c3QgYmUgZGlmZmVyZW50XCIpXG4gIH1cblxuICBpZiAocmVzb2x2ZWRUaW1pbmdNYW5pZmVzdFBhdGggJiYgKFxuICAgIHJlc29sdmVkUHJvZmlsZUpzb25QYXRoID09PSByZXNvbHZlZFRpbWluZ01hbmlmZXN0UGF0aCB8fFxuICAgIHJlc29sdmVkVGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoID09PSByZXNvbHZlZFRpbWluZ01hbmlmZXN0UGF0aFxuICApKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVGVzdCBwcm9maWxpbmcgb3V0cHV0cyBtdXN0IG5vdCBvdmVyd3JpdGUgLS10aW1pbmctbWFuaWZlc3QgaW5wdXRcIilcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHJvZmlsZTogcHJvZmlsZSB8fCBCb29sZWFuKHJlc29sdmVkUHJvZmlsZUpzb25QYXRoIHx8IHJlc29sdmVkVGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoKSxcbiAgICBwcm9maWxlSnNvblBhdGg6IHJlc29sdmVkUHJvZmlsZUpzb25QYXRoLFxuICAgIHRpbWluZ01hbmlmZXN0UGF0aDogcmVzb2x2ZWRUaW1pbmdNYW5pZmVzdFBhdGgsXG4gICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoOiByZXNvbHZlZFRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aFxuICB9XG59XG5cbi8qKlxuICogTG9hZHMgYW5kIHZhbGlkYXRlcyBhbiBleHBsaWNpdGx5IHN1cHBsaWVkIHBsYWluIEpTT04gdGltaW5nIG1hbmlmZXN0LlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHRpbWluZ01hbmlmZXN0UGF0aCAtIFRpbWluZyBtYW5pZmVzdCBwYXRoLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPiB8IHVuZGVmaW5lZD59IC0gQ2Fub25pY2FsIG1hbmlmZXN0LCBvciB1bmRlZmluZWQgd2hlbiBub3QgcmVxdWVzdGVkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFRpbWluZ01hbmlmZXN0KHRpbWluZ01hbmlmZXN0UGF0aCkge1xuICBpZiAoIXRpbWluZ01hbmlmZXN0UGF0aCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIGxldCBjb250ZW50XG5cbiAgdHJ5IHtcbiAgICBjb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUodGltaW5nTWFuaWZlc3RQYXRoLCBcInV0ZjhcIilcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZWFkIHRpbWluZyBtYW5pZmVzdDogJHt0aW1pbmdNYW5pZmVzdFBhdGh9YCwge2NhdXNlOiBlcnJvcn0pXG4gIH1cblxuICBsZXQgcGFyc2VkXG5cbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGNvbnRlbnQpXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcGFyc2UgdGltaW5nIG1hbmlmZXN0OiAke3RpbWluZ01hbmlmZXN0UGF0aH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgfVxuXG4gIHJldHVybiB2YWxpZGF0ZVRpbWluZ01hbmlmZXN0KHBhcnNlZCwge3NvdXJjZTogYFRpbWluZyBtYW5pZmVzdCAke3RpbWluZ01hbmlmZXN0UGF0aH1gfSlcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBob3cgbWFueSBzbG93ZXN0IHRlc3RzIHRvIHJlcG9ydCBmcm9tIHRoZSBgVkVMT0NJT1VTX1NMT1dfVEVTVF9DT1VOVGBcbiAqIGVudiB2YWx1ZTogZGVmYXVsdHMgdG8gMTAgd2hlbiB1bnNldDsgMCAob3IgYW4gdW5wYXJzZWFibGUgdmFsdWUpIGRpc2FibGVzIHRoZVxuICogcmVwb3J0OyBvdGhlcndpc2UgdGhlIGZsb29yZWQsIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHJhd0VudlZhbHVlIC0gUmF3IGVudiB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIHNsb3dlc3QgdGVzdHMgdG8gcmVwb3J0ICgwIGRpc2FibGVzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTbG93VGVzdENvdW50KHJhd0VudlZhbHVlKSB7XG4gIGlmIChyYXdFbnZWYWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gMTBcblxuICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihOdW1iZXIocmF3RW52VmFsdWUpKSB8fCAwKVxufVxuIl19
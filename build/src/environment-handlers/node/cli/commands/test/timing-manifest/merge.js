// @ts-check
import BaseCommand from "../../../../../../cli/base-command.js";
import fs from "node:fs/promises";
import path from "node:path";
import { writeTimingManifest } from "../../../../../../testing/test-profile-output.js";
import { mergeTestProfileTimingManifests } from "../../../../../../testing/timing-manifest.js";
/**
 * @typedef {object} TimingManifestMergeArguments
 * @property {string[]} inputPaths - Rich profile input paths.
 * @property {string} outputPath - Plain timing manifest output path.
 */
/** Node implementation for timing-manifest aggregation. */
export default class TestTimingManifestMerge extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<Record<string, number>>} - Complete merged timing manifest.
     */
    async execute() {
        const { inputPaths, outputPath } = parseTimingManifestMergeArguments(this.processArgs || [], process.cwd());
        const inputs = [];
        for (const inputPath of inputPaths) {
            let content;
            try {
                content = await fs.readFile(inputPath, "utf8");
            }
            catch (error) {
                throw new Error(`Failed to read test profile: ${inputPath}`, { cause: error });
            }
            let profile;
            try {
                profile = JSON.parse(content);
            }
            catch (error) {
                throw new Error(`Failed to parse test profile: ${inputPath}`, { cause: error });
            }
            inputs.push({ profile, source: inputPath });
        }
        const timingManifest = mergeTestProfileTimingManifests(inputs);
        await writeTimingManifest({ outputPath, timingManifest });
        console.log(`Merged ${inputPaths.length} test profile shards into ${outputPath} (${Object.keys(timingManifest).length} files)`);
        return timingManifest;
    }
}
/**
 * Recognizes one output option spelling.
 * @param {string} argument - Current argument.
 * @param {string | undefined} nextArgument - Following argument.
 * @returns {{matched: boolean, skipNext: boolean, value: string | undefined}} - Parsed output option.
 */
function timingManifestOutputArgument(argument, nextArgument) {
    if (argument === "--output") {
        return { matched: true, skipNext: true, value: nextArgument };
    }
    if (argument.startsWith("--output=")) {
        return { matched: true, skipNext: false, value: argument.slice("--output=".length) };
    }
    return { matched: false, skipNext: false, value: undefined };
}
/**
 * Parses strict merge arguments and resolves their paths.
 * @param {string[]} processArgs - Raw CLI arguments, including command name.
 * @param {string} cwd - Command working directory.
 * @returns {TimingManifestMergeArguments} - Validated resolved paths.
 */
export function parseTimingManifestMergeArguments(processArgs, cwd) {
    const commandName = processArgs[0] || "test:timing-manifest:merge";
    const inputPaths = [];
    let outputPath;
    for (let index = 1; index < processArgs.length; index++) {
        const argument = processArgs[index];
        const outputArgument = timingManifestOutputArgument(argument, processArgs[index + 1]);
        if (outputArgument.matched) {
            if (!outputArgument.value || outputArgument.value.startsWith("-"))
                throw new Error("Missing value for --output");
            if (outputPath)
                throw new Error("--output may only be provided once");
            outputPath = path.resolve(cwd, outputArgument.value);
            if (outputArgument.skipNext)
                index++;
            continue;
        }
        if (argument.startsWith("-"))
            throw new Error(`Unknown argument for ${commandName}: ${argument}`);
        inputPaths.push(path.resolve(cwd, argument));
    }
    if (!outputPath)
        throw new Error("--output is required");
    if (inputPaths.length === 0)
        throw new Error("At least one rich test profile input is required");
    const uniqueInputPaths = new Set(inputPaths);
    if (uniqueInputPaths.size !== inputPaths.length)
        throw new Error("Each rich test profile input must be provided once");
    if (uniqueInputPaths.has(outputPath))
        throw new Error("Timing manifest output must not overwrite an input profile");
    return { inputPaths, outputPath };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVyZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9zcmMvZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS9jbGkvY29tbWFuZHMvdGVzdC90aW1pbmctbWFuaWZlc3QvbWVyZ2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sV0FBVyxNQUFNLHVDQUF1QyxDQUFBO0FBQy9ELE9BQU8sRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ2pDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxrREFBa0QsQ0FBQTtBQUN0RixPQUFPLEVBQUUsK0JBQStCLEVBQUUsTUFBTSw4Q0FBOEMsQ0FBQTtBQUU5Rjs7OztHQUlHO0FBRUgsMkRBQTJEO0FBQzNELE1BQU0sQ0FBQyxPQUFPLE9BQU8sdUJBQXdCLFNBQVEsV0FBVztJQUM5RDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sRUFBQyxVQUFVLEVBQUUsVUFBVSxFQUFDLEdBQUcsaUNBQWlDLENBQUMsSUFBSSxDQUFDLFdBQVcsSUFBSSxFQUFFLEVBQUUsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUE7UUFDekcsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO1FBRWpCLEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7WUFDbkMsSUFBSSxPQUFPLENBQUE7WUFFWCxJQUFJLENBQUM7Z0JBQ0gsT0FBTyxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUE7WUFDaEQsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsU0FBUyxFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUM5RSxDQUFDO1lBRUQsSUFBSSxPQUFPLENBQUE7WUFFWCxJQUFJLENBQUM7Z0JBQ0gsT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDL0IsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsU0FBUyxFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUMvRSxDQUFDO1lBRUQsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtRQUMzQyxDQUFDO1FBRUQsTUFBTSxjQUFjLEdBQUcsK0JBQStCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFOUQsTUFBTSxtQkFBbUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFBO1FBQ3ZELE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxVQUFVLENBQUMsTUFBTSw2QkFBNkIsVUFBVSxLQUFLLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsTUFBTSxTQUFTLENBQUMsQ0FBQTtRQUUvSCxPQUFPLGNBQWMsQ0FBQTtJQUN2QixDQUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsNEJBQTRCLENBQUMsUUFBUSxFQUFFLFlBQVk7SUFDMUQsSUFBSSxRQUFRLEtBQUssVUFBVSxFQUFFLENBQUM7UUFDNUIsT0FBTyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFDLENBQUE7SUFDN0QsQ0FBQztJQUVELElBQUksUUFBUSxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1FBQ3JDLE9BQU8sRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxFQUFDLENBQUE7SUFDcEYsQ0FBQztJQUVELE9BQU8sRUFBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBQyxDQUFBO0FBQzVELENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSxpQ0FBaUMsQ0FBQyxXQUFXLEVBQUUsR0FBRztJQUNoRSxNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLElBQUksNEJBQTRCLENBQUE7SUFDbEUsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFBO0lBQ3JCLElBQUksVUFBVSxDQUFBO0lBRWQsS0FBSyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsS0FBSyxHQUFHLFdBQVcsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQztRQUN4RCxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDbkMsTUFBTSxjQUFjLEdBQUcsNEJBQTRCLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUVyRixJQUFJLGNBQWMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUMzQixJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssSUFBSSxjQUFjLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUM7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1lBQ2hILElBQUksVUFBVTtnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUE7WUFDckUsVUFBVSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNwRCxJQUFJLGNBQWMsQ0FBQyxRQUFRO2dCQUFFLEtBQUssRUFBRSxDQUFBO1lBQ3BDLFNBQVE7UUFDVixDQUFDO1FBRUQsSUFBSSxRQUFRLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLFdBQVcsS0FBSyxRQUFRLEVBQUUsQ0FBQyxDQUFBO1FBQ2pHLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQTtJQUM5QyxDQUFDO0lBRUQsSUFBSSxDQUFDLFVBQVU7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixDQUFDLENBQUE7SUFDeEQsSUFBSSxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUM7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUE7SUFFaEcsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUU1QyxJQUFJLGdCQUFnQixDQUFDLElBQUksS0FBSyxVQUFVLENBQUMsTUFBTTtRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQTtJQUN0SCxJQUFJLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUM7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxDQUFDLENBQUE7SUFFbkgsT0FBTyxFQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUMsQ0FBQTtBQUNqQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgeyB3cml0ZVRpbWluZ01hbmlmZXN0IH0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlLW91dHB1dC5qc1wiXG5pbXBvcnQgeyBtZXJnZVRlc3RQcm9maWxlVGltaW5nTWFuaWZlc3RzIH0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uLy4uL3Rlc3RpbmcvdGltaW5nLW1hbmlmZXN0LmpzXCJcblxuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUaW1pbmdNYW5pZmVzdE1lcmdlQXJndW1lbnRzXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBpbnB1dFBhdGhzIC0gUmljaCBwcm9maWxlIGlucHV0IHBhdGhzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG91dHB1dFBhdGggLSBQbGFpbiB0aW1pbmcgbWFuaWZlc3Qgb3V0cHV0IHBhdGguXG4gKi9cblxuLyoqIE5vZGUgaW1wbGVtZW50YXRpb24gZm9yIHRpbWluZy1tYW5pZmVzdCBhZ2dyZWdhdGlvbi4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RUaW1pbmdNYW5pZmVzdE1lcmdlIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBDb21wbGV0ZSBtZXJnZWQgdGltaW5nIG1hbmlmZXN0LlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCB7aW5wdXRQYXRocywgb3V0cHV0UGF0aH0gPSBwYXJzZVRpbWluZ01hbmlmZXN0TWVyZ2VBcmd1bWVudHModGhpcy5wcm9jZXNzQXJncyB8fCBbXSwgcHJvY2Vzcy5jd2QoKSlcbiAgICBjb25zdCBpbnB1dHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBpbnB1dFBhdGggb2YgaW5wdXRQYXRocykge1xuICAgICAgbGV0IGNvbnRlbnRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKGlucHV0UGF0aCwgXCJ1dGY4XCIpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZWFkIHRlc3QgcHJvZmlsZTogJHtpbnB1dFBhdGh9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIGxldCBwcm9maWxlXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHByb2ZpbGUgPSBKU09OLnBhcnNlKGNvbnRlbnQpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBwYXJzZSB0ZXN0IHByb2ZpbGU6ICR7aW5wdXRQYXRofWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuXG4gICAgICBpbnB1dHMucHVzaCh7cHJvZmlsZSwgc291cmNlOiBpbnB1dFBhdGh9KVxuICAgIH1cblxuICAgIGNvbnN0IHRpbWluZ01hbmlmZXN0ID0gbWVyZ2VUZXN0UHJvZmlsZVRpbWluZ01hbmlmZXN0cyhpbnB1dHMpXG5cbiAgICBhd2FpdCB3cml0ZVRpbWluZ01hbmlmZXN0KHtvdXRwdXRQYXRoLCB0aW1pbmdNYW5pZmVzdH0pXG4gICAgY29uc29sZS5sb2coYE1lcmdlZCAke2lucHV0UGF0aHMubGVuZ3RofSB0ZXN0IHByb2ZpbGUgc2hhcmRzIGludG8gJHtvdXRwdXRQYXRofSAoJHtPYmplY3Qua2V5cyh0aW1pbmdNYW5pZmVzdCkubGVuZ3RofSBmaWxlcylgKVxuXG4gICAgcmV0dXJuIHRpbWluZ01hbmlmZXN0XG4gIH1cbn1cblxuLyoqXG4gKiBSZWNvZ25pemVzIG9uZSBvdXRwdXQgb3B0aW9uIHNwZWxsaW5nLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3VtZW50IC0gQ3VycmVudCBhcmd1bWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBuZXh0QXJndW1lbnQgLSBGb2xsb3dpbmcgYXJndW1lbnQuXG4gKiBAcmV0dXJucyB7e21hdGNoZWQ6IGJvb2xlYW4sIHNraXBOZXh0OiBib29sZWFuLCB2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBQYXJzZWQgb3V0cHV0IG9wdGlvbi5cbiAqL1xuZnVuY3Rpb24gdGltaW5nTWFuaWZlc3RPdXRwdXRBcmd1bWVudChhcmd1bWVudCwgbmV4dEFyZ3VtZW50KSB7XG4gIGlmIChhcmd1bWVudCA9PT0gXCItLW91dHB1dFwiKSB7XG4gICAgcmV0dXJuIHttYXRjaGVkOiB0cnVlLCBza2lwTmV4dDogdHJ1ZSwgdmFsdWU6IG5leHRBcmd1bWVudH1cbiAgfVxuXG4gIGlmIChhcmd1bWVudC5zdGFydHNXaXRoKFwiLS1vdXRwdXQ9XCIpKSB7XG4gICAgcmV0dXJuIHttYXRjaGVkOiB0cnVlLCBza2lwTmV4dDogZmFsc2UsIHZhbHVlOiBhcmd1bWVudC5zbGljZShcIi0tb3V0cHV0PVwiLmxlbmd0aCl9XG4gIH1cblxuICByZXR1cm4ge21hdGNoZWQ6IGZhbHNlLCBza2lwTmV4dDogZmFsc2UsIHZhbHVlOiB1bmRlZmluZWR9XG59XG5cbi8qKlxuICogUGFyc2VzIHN0cmljdCBtZXJnZSBhcmd1bWVudHMgYW5kIHJlc29sdmVzIHRoZWlyIHBhdGhzLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcHJvY2Vzc0FyZ3MgLSBSYXcgQ0xJIGFyZ3VtZW50cywgaW5jbHVkaW5nIGNvbW1hbmQgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjd2QgLSBDb21tYW5kIHdvcmtpbmcgZGlyZWN0b3J5LlxuICogQHJldHVybnMge1RpbWluZ01hbmlmZXN0TWVyZ2VBcmd1bWVudHN9IC0gVmFsaWRhdGVkIHJlc29sdmVkIHBhdGhzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VUaW1pbmdNYW5pZmVzdE1lcmdlQXJndW1lbnRzKHByb2Nlc3NBcmdzLCBjd2QpIHtcbiAgY29uc3QgY29tbWFuZE5hbWUgPSBwcm9jZXNzQXJnc1swXSB8fCBcInRlc3Q6dGltaW5nLW1hbmlmZXN0Om1lcmdlXCJcbiAgY29uc3QgaW5wdXRQYXRocyA9IFtdXG4gIGxldCBvdXRwdXRQYXRoXG5cbiAgZm9yIChsZXQgaW5kZXggPSAxOyBpbmRleCA8IHByb2Nlc3NBcmdzLmxlbmd0aDsgaW5kZXgrKykge1xuICAgIGNvbnN0IGFyZ3VtZW50ID0gcHJvY2Vzc0FyZ3NbaW5kZXhdXG4gICAgY29uc3Qgb3V0cHV0QXJndW1lbnQgPSB0aW1pbmdNYW5pZmVzdE91dHB1dEFyZ3VtZW50KGFyZ3VtZW50LCBwcm9jZXNzQXJnc1tpbmRleCArIDFdKVxuXG4gICAgaWYgKG91dHB1dEFyZ3VtZW50Lm1hdGNoZWQpIHtcbiAgICAgIGlmICghb3V0cHV0QXJndW1lbnQudmFsdWUgfHwgb3V0cHV0QXJndW1lbnQudmFsdWUuc3RhcnRzV2l0aChcIi1cIikpIHRocm93IG5ldyBFcnJvcihcIk1pc3NpbmcgdmFsdWUgZm9yIC0tb3V0cHV0XCIpXG4gICAgICBpZiAob3V0cHV0UGF0aCkgdGhyb3cgbmV3IEVycm9yKFwiLS1vdXRwdXQgbWF5IG9ubHkgYmUgcHJvdmlkZWQgb25jZVwiKVxuICAgICAgb3V0cHV0UGF0aCA9IHBhdGgucmVzb2x2ZShjd2QsIG91dHB1dEFyZ3VtZW50LnZhbHVlKVxuICAgICAgaWYgKG91dHB1dEFyZ3VtZW50LnNraXBOZXh0KSBpbmRleCsrXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChhcmd1bWVudC5zdGFydHNXaXRoKFwiLVwiKSkgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGFyZ3VtZW50IGZvciAke2NvbW1hbmROYW1lfTogJHthcmd1bWVudH1gKVxuICAgIGlucHV0UGF0aHMucHVzaChwYXRoLnJlc29sdmUoY3dkLCBhcmd1bWVudCkpXG4gIH1cblxuICBpZiAoIW91dHB1dFBhdGgpIHRocm93IG5ldyBFcnJvcihcIi0tb3V0cHV0IGlzIHJlcXVpcmVkXCIpXG4gIGlmIChpbnB1dFBhdGhzLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKFwiQXQgbGVhc3Qgb25lIHJpY2ggdGVzdCBwcm9maWxlIGlucHV0IGlzIHJlcXVpcmVkXCIpXG5cbiAgY29uc3QgdW5pcXVlSW5wdXRQYXRocyA9IG5ldyBTZXQoaW5wdXRQYXRocylcblxuICBpZiAodW5pcXVlSW5wdXRQYXRocy5zaXplICE9PSBpbnB1dFBhdGhzLmxlbmd0aCkgdGhyb3cgbmV3IEVycm9yKFwiRWFjaCByaWNoIHRlc3QgcHJvZmlsZSBpbnB1dCBtdXN0IGJlIHByb3ZpZGVkIG9uY2VcIilcbiAgaWYgKHVuaXF1ZUlucHV0UGF0aHMuaGFzKG91dHB1dFBhdGgpKSB0aHJvdyBuZXcgRXJyb3IoXCJUaW1pbmcgbWFuaWZlc3Qgb3V0cHV0IG11c3Qgbm90IG92ZXJ3cml0ZSBhbiBpbnB1dCBwcm9maWxlXCIpXG5cbiAgcmV0dXJuIHtpbnB1dFBhdGhzLCBvdXRwdXRQYXRofVxufVxuIl19
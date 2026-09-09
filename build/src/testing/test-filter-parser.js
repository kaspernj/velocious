/**
 * ParseFiltersResult type.
 * @typedef {object} ParseFiltersResult
 * @property {string[]} includeTags - Tags to include.
 * @property {string[]} excludeTags - Tags to exclude.
 * @property {string[]} examplePatterns - Example name patterns.
 * @property {string[]} filteredProcessArgs - Remaining process args with filter flags removed.
 * @property {number | undefined} groups - Total number of groups for test splitting.
 * @property {number | undefined} groupNumber - Which group to run (1-indexed).
 * @property {boolean} profile - Whether test profiling is enabled.
 * @property {string | undefined} profileJsonPath - Rich profile output path.
 * @property {string | undefined} timingManifestPath - JSON timing manifest path.
 * @property {string | undefined} timingManifestOutputPath - Timing manifest output path.
 */
// @ts-check
const INCLUDE_TAG_FLAGS = new Set(["--tag", "--include-tag", "-t"]);
const EXCLUDE_TAG_FLAGS = new Set(["--exclude-tag", "--skip-tag", "-x"]);
const EXAMPLE_FLAGS = new Set(["--example", "--name", "-e"]);
const GROUPS_FLAGS = new Set(["--groups"]);
const GROUP_NUMBER_FLAGS = new Set(["--group-number"]);
const TIMING_MANIFEST_FLAGS = new Set(["--timing-manifest"]);
const PROFILE_JSON_FLAGS = new Set(["--profile-json"]);
const TIMING_MANIFEST_OUTPUT_FLAGS = new Set(["--timing-manifest-output"]);
/**
 * Runs split tags.
 * @param {string | undefined} value - Tag argument value.
 * @returns {string[]} - Tags list.
 */
function splitTags(value) {
    if (!value)
        return [];
    return value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}
/**
 * Runs escape reg exp.
 * @param {string} value - Value.
 * @returns {string} - Escaped value for regex.
 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Runs the normalizeExamplePatterns helper.
 * @param {string[]} patterns - Patterns.
 * @returns {RegExp[]} - Normalized patterns.
 */
export function normalizeExamplePatterns(patterns) {
    const normalized = [];
    for (const pattern of patterns) {
        const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
        if (regexMatch) {
            normalized.push(new RegExp(regexMatch[1], regexMatch[2]));
        }
        else {
            normalized.push(new RegExp(escapeRegExp(pattern)));
        }
    }
    return normalized;
}
/**
 * Runs the parseFilters helper.
 * @param {string[]} processArgs - Process args.
 * @returns {ParseFiltersResult} - Parsed tags, group options, and process args.
 */
export function parseFilters(processArgs) {
    const includeTags = [];
    const excludeTags = [];
    const filteredProcessArgs = processArgs.length > 0 ? [processArgs[0]] : [];
    const examplePatterns = [];
    /**
     * Defines groups.
     * @type {number | undefined} */
    let groups;
    /**
     * Defines groupNumber.
     * @type {number | undefined} */
    let groupNumber;
    let profile = false;
    /** @type {string | undefined} */
    let profileJsonPath;
    /** @type {string | undefined} */
    let timingManifestPath;
    /** @type {string | undefined} */
    let timingManifestOutputPath;
    let inRestArgs = false;
    for (let i = 1; i < processArgs.length; i++) {
        const arg = processArgs[i];
        if (arg === "--") {
            inRestArgs = true;
            filteredProcessArgs.push(arg);
            continue;
        }
        if (!inRestArgs) {
            if (INCLUDE_TAG_FLAGS.has(arg)) {
                const nextValue = processArgs[i + 1];
                if (nextValue && !nextValue.startsWith("-")) {
                    includeTags.push(...splitTags(nextValue));
                    i++;
                }
                continue;
            }
            if (EXCLUDE_TAG_FLAGS.has(arg)) {
                const nextValue = processArgs[i + 1];
                if (nextValue && !nextValue.startsWith("-")) {
                    excludeTags.push(...splitTags(nextValue));
                    i++;
                }
                continue;
            }
            if (arg.startsWith("--tag=")) {
                includeTags.push(...splitTags(arg.slice("--tag=".length)));
                continue;
            }
            if (arg.startsWith("--include-tag=")) {
                includeTags.push(...splitTags(arg.slice("--include-tag=".length)));
                continue;
            }
            if (arg.startsWith("--exclude-tag=")) {
                excludeTags.push(...splitTags(arg.slice("--exclude-tag=".length)));
                continue;
            }
            if (arg.startsWith("--skip-tag=")) {
                excludeTags.push(...splitTags(arg.slice("--skip-tag=".length)));
                continue;
            }
            if (EXAMPLE_FLAGS.has(arg)) {
                const nextValue = processArgs[i + 1];
                if (nextValue && !nextValue.startsWith("-")) {
                    examplePatterns.push(nextValue);
                    i++;
                }
                continue;
            }
            if (arg.startsWith("--example=")) {
                examplePatterns.push(arg.slice("--example=".length));
                continue;
            }
            if (arg.startsWith("--name=")) {
                examplePatterns.push(arg.slice("--name=".length));
                continue;
            }
            if (GROUPS_FLAGS.has(arg)) {
                const nextValue = processArgs[i + 1];
                if (nextValue && !nextValue.startsWith("-")) {
                    groups = parseInt(nextValue, 10);
                    i++;
                }
                continue;
            }
            if (arg.startsWith("--groups=")) {
                groups = parseInt(arg.slice("--groups=".length), 10);
                continue;
            }
            if (GROUP_NUMBER_FLAGS.has(arg)) {
                const nextValue = processArgs[i + 1];
                if (nextValue && !nextValue.startsWith("-")) {
                    groupNumber = parseInt(nextValue, 10);
                    i++;
                }
                continue;
            }
            if (arg.startsWith("--group-number=")) {
                groupNumber = parseInt(arg.slice("--group-number=".length), 10);
                continue;
            }
            if (TIMING_MANIFEST_FLAGS.has(arg)) {
                const nextValue = processArgs[i + 1];
                if (!nextValue || nextValue.startsWith("-"))
                    throw new Error("--timing-manifest requires a path");
                timingManifestPath = nextValue;
                i++;
                continue;
            }
            if (arg.startsWith("--timing-manifest=")) {
                timingManifestPath = arg.slice("--timing-manifest=".length);
                if (!timingManifestPath)
                    throw new Error("--timing-manifest requires a path");
                continue;
            }
            if (arg === "--profile") {
                profile = true;
                continue;
            }
            if (PROFILE_JSON_FLAGS.has(arg)) {
                const nextValue = processArgs[i + 1];
                if (!nextValue || nextValue.startsWith("-"))
                    throw new Error("--profile-json requires a path");
                profileJsonPath = nextValue;
                profile = true;
                i++;
                continue;
            }
            if (arg.startsWith("--profile-json=")) {
                profileJsonPath = arg.slice("--profile-json=".length);
                if (!profileJsonPath)
                    throw new Error("--profile-json requires a path");
                profile = true;
                continue;
            }
            if (TIMING_MANIFEST_OUTPUT_FLAGS.has(arg)) {
                const nextValue = processArgs[i + 1];
                if (!nextValue || nextValue.startsWith("-"))
                    throw new Error("--timing-manifest-output requires a path");
                timingManifestOutputPath = nextValue;
                profile = true;
                i++;
                continue;
            }
            if (arg.startsWith("--timing-manifest-output=")) {
                timingManifestOutputPath = arg.slice("--timing-manifest-output=".length);
                if (!timingManifestOutputPath)
                    throw new Error("--timing-manifest-output requires a path");
                profile = true;
                continue;
            }
        }
        filteredProcessArgs.push(arg);
    }
    return {
        includeTags: Array.from(new Set(includeTags)),
        excludeTags: Array.from(new Set(excludeTags)),
        examplePatterns,
        filteredProcessArgs,
        groups,
        groupNumber,
        profile,
        profileJsonPath,
        timingManifestPath,
        timingManifestOutputPath
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1maWx0ZXItcGFyc2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3RpbmcvdGVzdC1maWx0ZXItcGFyc2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7Ozs7Ozs7O0dBYUc7QUFDSCxZQUFZO0FBRVosTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxlQUFlLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQTtBQUNuRSxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsZUFBZSxFQUFFLFlBQVksRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFBO0FBQ3hFLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFBO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQTtBQUMxQyxNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFBO0FBQ3RELE1BQU0scUJBQXFCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUE7QUFDNUQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQTtBQUN0RCxNQUFNLDRCQUE0QixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxDQUFBO0FBRTFFOzs7O0dBSUc7QUFDSCxTQUFTLFNBQVMsQ0FBQyxLQUFLO0lBQ3RCLElBQUksQ0FBQyxLQUFLO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFckIsT0FBTyxLQUFLO1NBQ1QsS0FBSyxDQUFDLEdBQUcsQ0FBQztTQUNWLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMs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QUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUE7Z0JBQ3hHLHdCQUF3QixHQUFHLFNBQVMsQ0FBQTtnQkFDcEMsT0FBTyxHQUFHLElBQUksQ0FBQTtnQkFDZCxDQUFDLEVBQUUsQ0FBQTtnQkFDSCxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQywyQkFBMkIsQ0FBQyxFQUFFLENBQUM7Z0JBQ2hELHdCQUF3QixHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsMkJBQTJCLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQ3hFLElBQUksQ0FBQyx3QkFBd0I7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxDQUFBO2dCQUMxRixPQUFPLEdBQUcsSUFBSSxDQUFBO2dCQUNkLFNBQVE7WUFDVixDQUFDO1FBQ0gsQ0FBQztRQUVELG1CQUFtQixDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUMvQixDQUFDO0lBRUQsT0FBTztRQUNMLFdBQVcsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQzdDLFdBQVcsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQzdDLGVBQWU7UUFDZixtQkFBbUI7UUFDbkIsTUFBTTtRQUNOLFdBQVc7UUFDWCxPQUFPO1FBQ1AsZUFBZTtRQUNmLGtCQUFrQjtRQUNsQix3QkFBd0I7S0FDekIsQ0FBQTtBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFBhcnNlRmlsdGVyc1Jlc3VsdCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUGFyc2VGaWx0ZXJzUmVzdWx0XG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBpbmNsdWRlVGFncyAtIFRhZ3MgdG8gaW5jbHVkZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGV4Y2x1ZGVUYWdzIC0gVGFncyB0byBleGNsdWRlLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gZXhhbXBsZVBhdHRlcm5zIC0gRXhhbXBsZSBuYW1lIHBhdHRlcm5zLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gZmlsdGVyZWRQcm9jZXNzQXJncyAtIFJlbWFpbmluZyBwcm9jZXNzIGFyZ3Mgd2l0aCBmaWx0ZXIgZmxhZ3MgcmVtb3ZlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBncm91cHMgLSBUb3RhbCBudW1iZXIgb2YgZ3JvdXBzIGZvciB0ZXN0IHNwbGl0dGluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBncm91cE51bWJlciAtIFdoaWNoIGdyb3VwIHRvIHJ1biAoMS1pbmRleGVkKS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcHJvZmlsZSAtIFdoZXRoZXIgdGVzdCBwcm9maWxpbmcgaXMgZW5hYmxlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBwcm9maWxlSnNvblBhdGggLSBSaWNoIHByb2ZpbGUgb3V0cHV0IHBhdGguXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gdGltaW5nTWFuaWZlc3RQYXRoIC0gSlNPTiB0aW1pbmcgbWFuaWZlc3QgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGggLSBUaW1pbmcgbWFuaWZlc3Qgb3V0cHV0IHBhdGguXG4gKi9cbi8vIEB0cy1jaGVja1xuXG5jb25zdCBJTkNMVURFX1RBR19GTEFHUyA9IG5ldyBTZXQoW1wiLS10YWdcIiwgXCItLWluY2x1ZGUtdGFnXCIsIFwiLXRcIl0pXG5jb25zdCBFWENMVURFX1RBR19GTEFHUyA9IG5ldyBTZXQoW1wiLS1leGNsdWRlLXRhZ1wiLCBcIi0tc2tpcC10YWdcIiwgXCIteFwiXSlcbmNvbnN0IEVYQU1QTEVfRkxBR1MgPSBuZXcgU2V0KFtcIi0tZXhhbXBsZVwiLCBcIi0tbmFtZVwiLCBcIi1lXCJdKVxuY29uc3QgR1JPVVBTX0ZMQUdTID0gbmV3IFNldChbXCItLWdyb3Vwc1wiXSlcbmNvbnN0IEdST1VQX05VTUJFUl9GTEFHUyA9IG5ldyBTZXQoW1wiLS1ncm91cC1udW1iZXJcIl0pXG5jb25zdCBUSU1JTkdfTUFOSUZFU1RfRkxBR1MgPSBuZXcgU2V0KFtcIi0tdGltaW5nLW1hbmlmZXN0XCJdKVxuY29uc3QgUFJPRklMRV9KU09OX0ZMQUdTID0gbmV3IFNldChbXCItLXByb2ZpbGUtanNvblwiXSlcbmNvbnN0IFRJTUlOR19NQU5JRkVTVF9PVVRQVVRfRkxBR1MgPSBuZXcgU2V0KFtcIi0tdGltaW5nLW1hbmlmZXN0LW91dHB1dFwiXSlcblxuLyoqXG4gKiBSdW5zIHNwbGl0IHRhZ3MuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gdmFsdWUgLSBUYWcgYXJndW1lbnQgdmFsdWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGFncyBsaXN0LlxuICovXG5mdW5jdGlvbiBzcGxpdFRhZ3ModmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSkgcmV0dXJuIFtdXG5cbiAgcmV0dXJuIHZhbHVlXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKHRhZykgPT4gdGFnLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG59XG5cbi8qKlxuICogUnVucyBlc2NhcGUgcmVnIGV4cC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBFc2NhcGVkIHZhbHVlIGZvciByZWdleC5cbiAqL1xuZnVuY3Rpb24gZXNjYXBlUmVnRXhwKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIilcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBub3JtYWxpemVFeGFtcGxlUGF0dGVybnMgaGVscGVyLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0dGVybnMgLSBQYXR0ZXJucy5cbiAqIEByZXR1cm5zIHtSZWdFeHBbXX0gLSBOb3JtYWxpemVkIHBhdHRlcm5zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplRXhhbXBsZVBhdHRlcm5zKHBhdHRlcm5zKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBbXVxuXG4gIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgIGNvbnN0IHJlZ2V4TWF0Y2ggPSBwYXR0ZXJuLm1hdGNoKC9eXFwvKC4rKVxcLyhbZ2ltc3V5XSopJC8pXG5cbiAgICBpZiAocmVnZXhNYXRjaCkge1xuICAgICAgbm9ybWFsaXplZC5wdXNoKG5ldyBSZWdFeHAocmVnZXhNYXRjaFsxXSwgcmVnZXhNYXRjaFsyXSkpXG4gICAgfSBlbHNlIHtcbiAgICAgIG5vcm1hbGl6ZWQucHVzaChuZXcgUmVnRXhwKGVzY2FwZVJlZ0V4cChwYXR0ZXJuKSkpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBwYXJzZUZpbHRlcnMgaGVscGVyLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcHJvY2Vzc0FyZ3MgLSBQcm9jZXNzIGFyZ3MuXG4gKiBAcmV0dXJucyB7UGFyc2VGaWx0ZXJzUmVzdWx0fSAtIFBhcnNlZCB0YWdzLCBncm91cCBvcHRpb25zLCBhbmQgcHJvY2VzcyBhcmdzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VGaWx0ZXJzKHByb2Nlc3NBcmdzKSB7XG4gIGNvbnN0IGluY2x1ZGVUYWdzID0gW11cbiAgY29uc3QgZXhjbHVkZVRhZ3MgPSBbXVxuICBjb25zdCBmaWx0ZXJlZFByb2Nlc3NBcmdzID0gcHJvY2Vzc0FyZ3MubGVuZ3RoID4gMCA/IFtwcm9jZXNzQXJnc1swXV0gOiBbXVxuICBjb25zdCBleGFtcGxlUGF0dGVybnMgPSBbXVxuXG4gIC8qKlxuICAgKiBEZWZpbmVzIGdyb3Vwcy5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgbGV0IGdyb3Vwc1xuICAvKipcbiAgICogRGVmaW5lcyBncm91cE51bWJlci5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgbGV0IGdyb3VwTnVtYmVyXG4gIGxldCBwcm9maWxlID0gZmFsc2VcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIGxldCBwcm9maWxlSnNvblBhdGhcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIGxldCB0aW1pbmdNYW5pZmVzdFBhdGhcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIGxldCB0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGhcblxuICBsZXQgaW5SZXN0QXJncyA9IGZhbHNlXG5cbiAgZm9yIChsZXQgaSA9IDE7IGkgPCBwcm9jZXNzQXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGFyZyA9IHByb2Nlc3NBcmdzW2ldXG5cbiAgICBpZiAoYXJnID09PSBcIi0tXCIpIHtcbiAgICAgIGluUmVzdEFyZ3MgPSB0cnVlXG4gICAgICBmaWx0ZXJlZFByb2Nlc3NBcmdzLnB1c2goYXJnKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIWluUmVzdEFyZ3MpIHtcbiAgICAgIGlmIChJTkNMVURFX1RBR19GTEFHUy5oYXMoYXJnKSkge1xuICAgICAgICBjb25zdCBuZXh0VmFsdWUgPSBwcm9jZXNzQXJnc1tpICsgMV1cblxuICAgICAgICBpZiAobmV4dFZhbHVlICYmICFuZXh0VmFsdWUuc3RhcnRzV2l0aChcIi1cIikpIHtcbiAgICAgICAgICBpbmNsdWRlVGFncy5wdXNoKC4uLnNwbGl0VGFncyhuZXh0VmFsdWUpKVxuICAgICAgICAgIGkrK1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChFWENMVURFX1RBR19GTEFHUy5oYXMoYXJnKSkge1xuICAgICAgICBjb25zdCBuZXh0VmFsdWUgPSBwcm9jZXNzQXJnc1tpICsgMV1cblxuICAgICAgICBpZiAobmV4dFZhbHVlICYmICFuZXh0VmFsdWUuc3RhcnRzV2l0aChcIi1cIikpIHtcbiAgICAgICAgICBleGNsdWRlVGFncy5wdXNoKC4uLnNwbGl0VGFncyhuZXh0VmFsdWUpKVxuICAgICAgICAgIGkrK1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhcmcuc3RhcnRzV2l0aChcIi0tdGFnPVwiKSkge1xuICAgICAgICBpbmNsdWRlVGFncy5wdXNoKC4uLnNwbGl0VGFncyhhcmcuc2xpY2UoXCItLXRhZz1cIi5sZW5ndGgpKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGFyZy5zdGFydHNXaXRoKFwiLS1pbmNsdWRlLXRhZz1cIikpIHtcbiAgICAgICAgaW5jbHVkZVRhZ3MucHVzaCguLi5zcGxpdFRhZ3MoYXJnLnNsaWNlKFwiLS1pbmNsdWRlLXRhZz1cIi5sZW5ndGgpKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGFyZy5zdGFydHNXaXRoKFwiLS1leGNsdWRlLXRhZz1cIikpIHtcbiAgICAgICAgZXhjbHVkZVRhZ3MucHVzaCguLi5zcGxpdFRhZ3MoYXJnLnNsaWNlKFwiLS1leGNsdWRlLXRhZz1cIi5sZW5ndGgpKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGFyZy5zdGFydHNXaXRoKFwiLS1za2lwLXRhZz1cIikpIHtcbiAgICAgICAgZXhjbHVkZVRhZ3MucHVzaCguLi5zcGxpdFRhZ3MoYXJnLnNsaWNlKFwiLS1za2lwLXRhZz1cIi5sZW5ndGgpKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKEVYQU1QTEVfRkxBR1MuaGFzKGFyZykpIHtcbiAgICAgICAgY29uc3QgbmV4dFZhbHVlID0gcHJvY2Vzc0FyZ3NbaSArIDFdXG5cbiAgICAgICAgaWYgKG5leHRWYWx1ZSAmJiAhbmV4dFZhbHVlLnN0YXJ0c1dpdGgoXCItXCIpKSB7XG4gICAgICAgICAgZXhhbXBsZVBhdHRlcm5zLnB1c2gobmV4dFZhbHVlKVxuICAgICAgICAgIGkrK1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhcmcuc3RhcnRzV2l0aChcIi0tZXhhbXBsZT1cIikpIHtcbiAgICAgICAgZXhhbXBsZVBhdHRlcm5zLnB1c2goYXJnLnNsaWNlKFwiLS1leGFtcGxlPVwiLmxlbmd0aCkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhcmcuc3RhcnRzV2l0aChcIi0tbmFtZT1cIikpIHtcbiAgICAgICAgZXhhbXBsZVBhdHRlcm5zLnB1c2goYXJnLnNsaWNlKFwiLS1uYW1lPVwiLmxlbmd0aCkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChHUk9VUFNfRkxBR1MuaGFzKGFyZykpIHtcbiAgICAgICAgY29uc3QgbmV4dFZhbHVlID0gcHJvY2Vzc0FyZ3NbaSArIDFdXG5cbiAgICAgICAgaWYgKG5leHRWYWx1ZSAmJiAhbmV4dFZhbHVlLnN0YXJ0c1dpdGgoXCItXCIpKSB7XG4gICAgICAgICAgZ3JvdXBzID0gcGFyc2VJbnQobmV4dFZhbHVlLCAxMClcbiAgICAgICAgICBpKytcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXJnLnN0YXJ0c1dpdGgoXCItLWdyb3Vwcz1cIikpIHtcbiAgICAgICAgZ3JvdXBzID0gcGFyc2VJbnQoYXJnLnNsaWNlKFwiLS1ncm91cHM9XCIubGVuZ3RoKSwgMTApXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChHUk9VUF9OVU1CRVJfRkxBR1MuaGFzKGFyZykpIHtcbiAgICAgICAgY29uc3QgbmV4dFZhbHVlID0gcHJvY2Vzc0FyZ3NbaSArIDFdXG5cbiAgICAgICAgaWYgKG5leHRWYWx1ZSAmJiAhbmV4dFZhbHVlLnN0YXJ0c1dpdGgoXCItXCIpKSB7XG4gICAgICAgICAgZ3JvdXBOdW1iZXIgPSBwYXJzZUludChuZXh0VmFsdWUsIDEwKVxuICAgICAgICAgIGkrK1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhcmcuc3RhcnRzV2l0aChcIi0tZ3JvdXAtbnVtYmVyPVwiKSkge1xuICAgICAgICBncm91cE51bWJlciA9IHBhcnNlSW50KGFyZy5zbGljZShcIi0tZ3JvdXAtbnVtYmVyPVwiLmxlbmd0aCksIDEwKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoVElNSU5HX01BTklGRVNUX0ZMQUdTLmhhcyhhcmcpKSB7XG4gICAgICAgIGNvbnN0IG5leHRWYWx1ZSA9IHByb2Nlc3NBcmdzW2kgKyAxXVxuXG4gICAgICAgIGlmICghbmV4dFZhbHVlIHx8IG5leHRWYWx1ZS5zdGFydHNXaXRoKFwiLVwiKSkgdGhyb3cgbmV3IEVycm9yKFwiLS10aW1pbmctbWFuaWZlc3QgcmVxdWlyZXMgYSBwYXRoXCIpXG4gICAgICAgIHRpbWluZ01hbmlmZXN0UGF0aCA9IG5leHRWYWx1ZVxuICAgICAgICBpKytcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGFyZy5zdGFydHNXaXRoKFwiLS10aW1pbmctbWFuaWZlc3Q9XCIpKSB7XG4gICAgICAgIHRpbWluZ01hbmlmZXN0UGF0aCA9IGFyZy5zbGljZShcIi0tdGltaW5nLW1hbmlmZXN0PVwiLmxlbmd0aClcbiAgICAgICAgaWYgKCF0aW1pbmdNYW5pZmVzdFBhdGgpIHRocm93IG5ldyBFcnJvcihcIi0tdGltaW5nLW1hbmlmZXN0IHJlcXVpcmVzIGEgcGF0aFwiKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXJnID09PSBcIi0tcHJvZmlsZVwiKSB7XG4gICAgICAgIHByb2ZpbGUgPSB0cnVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChQUk9GSUxFX0pTT05fRkxBR1MuaGFzKGFyZykpIHtcbiAgICAgICAgY29uc3QgbmV4dFZhbHVlID0gcHJvY2Vzc0FyZ3NbaSArIDFdXG5cbiAgICAgICAgaWYgKCFuZXh0VmFsdWUgfHwgbmV4dFZhbHVlLnN0YXJ0c1dpdGgoXCItXCIpKSB0aHJvdyBuZXcgRXJyb3IoXCItLXByb2ZpbGUtanNvbiByZXF1aXJlcyBhIHBhdGhcIilcbiAgICAgICAgcHJvZmlsZUpzb25QYXRoID0gbmV4dFZhbHVlXG4gICAgICAgIHByb2ZpbGUgPSB0cnVlXG4gICAgICAgIGkrK1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXJnLnN0YXJ0c1dpdGgoXCItLXByb2ZpbGUtanNvbj1cIikpIHtcbiAgICAgICAgcHJvZmlsZUpzb25QYXRoID0gYXJnLnNsaWNlKFwiLS1wcm9maWxlLWpzb249XCIubGVuZ3RoKVxuICAgICAgICBpZiAoIXByb2ZpbGVKc29uUGF0aCkgdGhyb3cgbmV3IEVycm9yKFwiLS1wcm9maWxlLWpzb24gcmVxdWlyZXMgYSBwYXRoXCIpXG4gICAgICAgIHByb2ZpbGUgPSB0cnVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChUSU1JTkdfTUFOSUZFU1RfT1VUUFVUX0ZMQUdTLmhhcyhhcmcpKSB7XG4gICAgICAgIGNvbnN0IG5leHRWYWx1ZSA9IHByb2Nlc3NBcmdzW2kgKyAxXVxuXG4gICAgICAgIGlmICghbmV4dFZhbHVlIHx8IG5leHRWYWx1ZS5zdGFydHNXaXRoKFwiLVwiKSkgdGhyb3cgbmV3IEVycm9yKFwiLS10aW1pbmctbWFuaWZlc3Qtb3V0cHV0IHJlcXVpcmVzIGEgcGF0aFwiKVxuICAgICAgICB0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGggPSBuZXh0VmFsdWVcbiAgICAgICAgcHJvZmlsZSA9IHRydWVcbiAgICAgICAgaSsrXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhcmcuc3RhcnRzV2l0aChcIi0tdGltaW5nLW1hbmlmZXN0LW91dHB1dD1cIikpIHtcbiAgICAgICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoID0gYXJnLnNsaWNlKFwiLS10aW1pbmctbWFuaWZlc3Qtb3V0cHV0PVwiLmxlbmd0aClcbiAgICAgICAgaWYgKCF0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGgpIHRocm93IG5ldyBFcnJvcihcIi0tdGltaW5nLW1hbmlmZXN0LW91dHB1dCByZXF1aXJlcyBhIHBhdGhcIilcbiAgICAgICAgcHJvZmlsZSA9IHRydWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmaWx0ZXJlZFByb2Nlc3NBcmdzLnB1c2goYXJnKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBpbmNsdWRlVGFnczogQXJyYXkuZnJvbShuZXcgU2V0KGluY2x1ZGVUYWdzKSksXG4gICAgZXhjbHVkZVRhZ3M6IEFycmF5LmZyb20obmV3IFNldChleGNsdWRlVGFncykpLFxuICAgIGV4YW1wbGVQYXR0ZXJucyxcbiAgICBmaWx0ZXJlZFByb2Nlc3NBcmdzLFxuICAgIGdyb3VwcyxcbiAgICBncm91cE51bWJlcixcbiAgICBwcm9maWxlLFxuICAgIHByb2ZpbGVKc29uUGF0aCxcbiAgICB0aW1pbmdNYW5pZmVzdFBhdGgsXG4gICAgdGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoXG4gIH1cbn1cbiJdfQ==
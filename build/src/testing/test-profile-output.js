// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
import { roundProfileDuration } from "./test-profiler.js";
import { validateTimingManifest } from "./timing-manifest.js";
const FORBIDDEN_PROFILE_FIELDS = new Set([
    "bind",
    "binds",
    "checkoutname",
    "credential",
    "credentials",
    "databasename",
    "error",
    "host",
    "password",
    "reusekey",
    "sql",
    "stack",
    "tenant",
    "username"
]);
const PHASE_ORDER = [
    "discovery",
    "imports",
    "testing config/global setup",
    "beforeAll",
    "beforeEach",
    "test body",
    "afterEach",
    "afterAll",
    "custom",
    "runner overhead",
    "total"
];
let atomicWriteSequence = 0;
/**
 * Recursively rejects fields that are forbidden from rich profile output.
 * @param {ReturnType<typeof JSON.parse>} value - Profile value.
 * @param {string} [pathName] - Diagnostic field path.
 * @returns {void}
 */
function assertProfilePrivacy(value, pathName = "profile") {
    if (!value || typeof value !== "object")
        return;
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
            assertProfilePrivacy(value[index], `${pathName}[${index}]`);
        }
        return;
    }
    for (const [key, childValue] of Object.entries(value)) {
        if (FORBIDDEN_PROFILE_FIELDS.has(key.toLowerCase())) {
            throw new Error(`Forbidden profile field: ${pathName}.${key}`);
        }
        assertProfilePrivacy(childValue, `${pathName}.${key}`);
    }
}
/**
 * Recursively rounds duration fields and rejects invalid duration values.
 * @param {ReturnType<typeof JSON.parse>} value - Profile value.
 * @param {string | undefined} [parentKey] - Parent field name.
 * @returns {void}
 */
function normalizeDurations(value, parentKey) {
    if (!value || typeof value !== "object")
        return;
    if (Array.isArray(value)) {
        for (const childValue of value)
            normalizeDurations(childValue, parentKey);
        return;
    }
    for (const [key, childValue] of Object.entries(value)) {
        const durationField = key.endsWith("Ms") || parentKey === "cpuMs";
        if (durationField && typeof childValue === "number") {
            if (typeof childValue !== "number" || !Number.isFinite(childValue) || childValue < 0) {
                throw new Error(`Invalid test profile duration field: ${key}`);
            }
            value[key] = roundProfileDuration(childValue);
            continue;
        }
        if (key.endsWith("Ms") && key !== "cpuMs") {
            throw new Error(`Invalid test profile duration field: ${key}`);
        }
        normalizeDurations(childValue, key);
    }
}
/**
 * Returns a normalized JSON-safe rich profile.
 * @param {ReturnType<typeof JSON.parse>} profile - Rich profile document.
 * @returns {ReturnType<typeof JSON.parse>} - Normalized document.
 */
function normalizedProfile(profile) {
    if (profile?.schema !== "velocious.test-profile" || profile?.schemaVersion !== 1) {
        throw new Error("Invalid Velocious test profile schema");
    }
    assertProfilePrivacy(profile);
    const normalized = JSON.parse(JSON.stringify(profile));
    normalizeDurations(normalized);
    return normalized;
}
/**
 * Writes text through a same-directory temporary file and atomic rename.
 * @param {string} outputPath - Final output path.
 * @param {string} content - Complete output content.
 * @returns {Promise<void>} - Resolves after rename.
 */
async function atomicWrite(outputPath, content) {
    const directory = path.dirname(outputPath);
    const sequence = ++atomicWriteSequence;
    const temporaryPath = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.${sequence}.tmp`);
    let temporaryFileCreated = false;
    await fs.mkdir(directory, { recursive: true });
    try {
        await fs.writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
        temporaryFileCreated = true;
        await fs.rename(temporaryPath, outputPath);
    }
    catch (error) {
        if (temporaryFileCreated) {
            try {
                await fs.unlink(temporaryPath);
            }
            catch (cleanupError) {
                if (!(cleanupError instanceof Error) || !("code" in cleanupError) || cleanupError.code !== "ENOENT") {
                    throw new AggregateError([error, cleanupError], `Failed to write and clean up test profile output: ${outputPath}`, { cause: cleanupError });
                }
            }
        }
        throw error;
    }
}
/**
 * Creates a sorted plain timing manifest.
 * @param {ReturnType<typeof JSON.parse>} profile - Rich profile document.
 * @returns {Record<string, number>} - Sorted file-duration map.
 */
export function timingManifestFromProfile(profile) {
    /** @type {Record<string, number>} */
    const manifest = {};
    const validatedManifest = validateTimingManifest(profile.timingManifest || {}, { source: "Test profile timing manifest" });
    for (const [filePath, durationMs] of Object.entries(validatedManifest)) {
        manifest[filePath] = roundProfileDuration(durationMs);
    }
    return manifest;
}
/**
 * Atomically writes a canonical splitter-compatible timing manifest.
 * @param {object} args - Output arguments.
 * @param {string} args.outputPath - Final output path.
 * @param {Record<string, number>} args.timingManifest - Validated or candidate timing manifest.
 * @returns {Promise<void>} - Resolves after atomic replacement.
 */
export async function writeTimingManifest({ outputPath, timingManifest }) {
    const normalized = validateTimingManifest(timingManifest);
    /** @type {Record<string, number>} */
    const rounded = {};
    for (const [filePath, durationMs] of Object.entries(normalized)) {
        rounded[filePath] = roundProfileDuration(durationMs);
    }
    await atomicWrite(outputPath, `${JSON.stringify(rounded, null, 2)}\n`);
}
/**
 * Atomically writes requested test profile outputs.
 * @param {object} args - Output options.
 * @param {ReturnType<typeof JSON.parse>} args.profile - Rich profile document.
 * @param {string} [args.profileJsonPath] - Rich JSON path.
 * @param {string} [args.timingManifestOutputPath] - Plain timing manifest path.
 * @returns {Promise<void>} - Resolves after all requested writes.
 */
export async function writeTestProfileOutputs({ profile, profileJsonPath, timingManifestOutputPath }) {
    const normalized = normalizedProfile(profile);
    const timingManifest = timingManifestFromProfile(normalized);
    normalized.timingManifest = timingManifest;
    if (profileJsonPath) {
        await atomicWrite(profileJsonPath, `${JSON.stringify(normalized, null, 2)}\n`);
    }
    if (timingManifestOutputPath) {
        await writeTimingManifest({ outputPath: timingManifestOutputPath, timingManifest });
    }
}
/**
 * Formats a compact Benchmark-style console summary.
 * @param {ReturnType<typeof JSON.parse>} profile - Rich profile document.
 * @param {{profileJsonPath?: string, timingManifestOutputPath?: string}} [outputs] - Written output paths.
 * @returns {string} - Console summary.
 */
export function formatTestProfileSummary(profile, outputs = {}) {
    const lines = [
        "Test profile",
        "Phase".padEnd(31) + "Count".padStart(5) + "Real ms".padStart(13) + "CPU ms".padStart(13)
    ];
    for (const phase of PHASE_ORDER) {
        const aggregate = profile.phases?.[phase];
        if (!aggregate)
            continue;
        lines.push(phase.padEnd(31) +
            String(aggregate.count).padStart(5) +
            aggregate.totalMs.toFixed(3).padStart(13) +
            aggregate.cpuMs.total.toFixed(3).padStart(13));
    }
    if (profile.pools?.length > 0) {
        lines.push("Pools");
        for (const pool of profile.pools) {
            lines.push(`Pool ${pool.identifier}: created=${pool.connectionCreation.count}` +
                ` failed=${pool.connectionCreation.failedCount}` +
                ` wait=${pool.checkoutWait.count}/${pool.checkoutWait.totalMs.toFixed(3)}ms` +
                ` timeouts=${pool.checkoutTimeoutCount}` +
                ` reaped=${pool.idleReap.disposalCount}` +
                ` peak=${pool.peakLiveConnections}`);
        }
    }
    if (outputs.profileJsonPath)
        lines.push(`Rich JSON: ${outputs.profileJsonPath}`);
    if (outputs.timingManifestOutputPath)
        lines.push(`Timing manifest: ${outputs.timingManifestOutputPath}`);
    return lines.join("\n");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1wcm9maWxlLW91dHB1dC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1vdXRwdXQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ2pDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSxvQkFBb0IsQ0FBQTtBQUN6RCxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSxzQkFBc0IsQ0FBQTtBQUU3RCxNQUFNLHdCQUF3QixHQUFHLElBQUksR0FBRyxDQUFDO0lBQ3ZDLE1BQU07SUFDTixPQUFPO0lBQ1AsY0FBYztJQUNkLFlBQVk7SUFDWixhQUFhO0lBQ2IsY0FBYztJQUNkLE9BQU87SUFDUCxNQUFNO0lBQ04sVUFBVTtJQUNWLFVBQVU7SUFDVixLQUFLO0lBQ0wsT0FBTztJQUNQLFFBQVE7SUFDUixVQUFVO0NBQ1gsQ0FBQyxDQUFBO0FBQ0YsTUFBTSxXQUFXLEdBQUc7SUFDbEIsV0FBVztJQUNYLFNBQVM7SUFDVCw2QkFBNkI7SUFDN0IsV0FBVztJQUNYLFlBQVk7SUFDWixXQUFXO0lBQ1gsV0FBVztJQUNYLFVBQVU7SUFDVixRQUFRO0lBQ1IsaUJBQWlCO0lBQ2pCLE9BQU87Q0FDUixDQUFBO0FBQ0QsSUFBSSxtQkFBbUIsR0FBRyxDQUFDLENBQUE7QUFFM0I7Ozs7O0dBS0c7QUFDSCxTQUFTLG9CQUFvQixDQUFDLEtBQUssRUFBRSxRQUFRLEdBQUcsU0FBUztJQUN2RCxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7UUFBRSxPQUFNO0lBRS9DLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3pCLEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLEtBQUssR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7WUFDbEQsb0JBQW9CLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLEdBQUcsUUFBUSxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUE7UUFDN0QsQ0FBQztRQUNELE9BQU07SUFDUixDQUFDO0lBRUQsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLFVBQVUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN0RCxJQUFJLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQ3BELE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLFFBQVEsSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFBO1FBQ2hFLENBQUM7UUFFRCxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsR0FBRyxRQUFRLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQTtJQUN4RCxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsU0FBUztJQUMxQyxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7UUFBRSxPQUFNO0lBRS9DLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3pCLEtBQUssTUFBTSxVQUFVLElBQUksS0FBSztZQUFFLGtCQUFrQixDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUN6RSxPQUFNO0lBQ1IsQ0FBQztJQUVELEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxVQUFVLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDdEQsTUFBTSxhQUFhLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLEtBQUssT0FBTyxDQUFBO1FBRWpFLElBQUksYUFBYSxJQUFJLE9BQU8sVUFBVSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3BELElBQUksT0FBTyxVQUFVLEtBQUssUUFBUSxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxVQUFVLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3JGLE1BQU0sSUFBSSxLQUFLLENBQUMsd0NBQXdDLEdBQUcsRUFBRSxDQUFDLENBQUE7WUFDaEUsQ0FBQztZQUVELEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUM3QyxTQUFRO1FBQ1YsQ0FBQztRQUVELElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLEtBQUssT0FBTyxFQUFFLENBQUM7WUFDMUMsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsR0FBRyxFQUFFLENBQUMsQ0FBQTtRQUNoRSxDQUFDO1FBRUQsa0JBQWtCLENBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxDQUFBO0lBQ3JDLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsaUJBQWlCLENBQUMsT0FBTztJQUNoQyxJQUFJLE9BQU8sRUFBRSxNQUFNLEtBQUssd0JBQXdCLElBQUksT0FBTyxFQUFFLGFBQWEsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNqRixNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUE7SUFDMUQsQ0FBQztJQUVELG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQzdCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFBO0lBRXRELGtCQUFrQixDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQzlCLE9BQU8sVUFBVSxDQUFBO0FBQ25CLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILEtBQUssVUFBVSxXQUFXLENBQUMsVUFBVSxFQUFFLE9BQU87SUFDNUMsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUMxQyxNQUFNLFFBQVEsR0FBRyxFQUFFLG1CQUFtQixDQUFBO0lBQ3RDLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxPQUFPLENBQUMsR0FBRyxJQUFJLFFBQVEsTUFBTSxDQUFDLENBQUE7SUFDMUcsSUFBSSxvQkFBb0IsR0FBRyxLQUFLLENBQUE7SUFFaEMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBRTVDLElBQUksQ0FBQztRQUNILE1BQU0sRUFBRSxDQUFDLFNBQVMsQ0FBQyxhQUFhLEVBQUUsT0FBTyxFQUFFLEVBQUMsUUFBUSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUMxRSxvQkFBb0IsR0FBRyxJQUFJLENBQUE7UUFDM0IsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxVQUFVLENBQUMsQ0FBQTtJQUM1QyxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLElBQUksb0JBQW9CLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1lBQ2hDLENBQUM7WUFBQyxPQUFPLFlBQVksRUFBRSxDQUFDO2dCQUN0QixJQUFJLENBQUMsQ0FBQyxZQUFZLFlBQVksS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sSUFBSSxZQUFZLENBQUMsSUFBSSxZQUFZLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO29CQUNwRyxNQUFNLElBQUksY0FBYyxDQUN0QixDQUFDLEtBQUssRUFBRSxZQUFZLENBQUMsRUFDckIscURBQXFELFVBQVUsRUFBRSxFQUNqRSxFQUFDLEtBQUssRUFBRSxZQUFZLEVBQUMsQ0FDdEIsQ0FBQTtnQkFDSCxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLEtBQUssQ0FBQTtJQUNiLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSx5QkFBeUIsQ0FBQyxPQUFPO0lBQy9DLHFDQUFxQztJQUNyQyxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUE7SUFDbkIsTUFBTSxpQkFBaUIsR0FBRyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsY0FBYyxJQUFJLEVBQUUsRUFBRSxFQUFDLE1BQU0sRUFBRSw4QkFBOEIsRUFBQyxDQUFDLENBQUE7SUFFeEgsS0FBSyxNQUFNLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDO1FBQ3ZFLFFBQVEsQ0FBQyxRQUFRLENBQUMsR0FBRyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUN2RCxDQUFDO0lBRUQsT0FBTyxRQUFRLENBQUE7QUFDakIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsbUJBQW1CLENBQUMsRUFBQyxVQUFVLEVBQUUsY0FBYyxFQUFDO0lBQ3BFLE1BQU0sVUFBVSxHQUFHLHNCQUFzQixDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBQ3pELHFDQUFxQztJQUNyQyxNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUE7SUFFbEIsS0FBSyxNQUFNLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUNoRSxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDdEQsQ0FBQztJQUVELE1BQU0sV0FBVyxDQUFDLFVBQVUsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUE7QUFDeEUsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLHVCQUF1QixDQUFDLEVBQUMsT0FBTyxFQUFFLGVBQWUsRUFBRSx3QkFBd0IsRUFBQztJQUNoRyxNQUFNLFVBQVUsR0FBRyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUM3QyxNQUFNLGNBQWMsR0FBRyx5QkFBeUIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUU1RCxVQUFVLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQTtJQUUxQyxJQUFJLGVBQWUsRUFBRSxDQUFDO1FBQ3BCLE1BQU0sV0FBVyxDQUFDLGVBQWUsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDaEYsQ0FBQztJQUVELElBQUksd0JBQXdCLEVBQUUsQ0FBQztRQUM3QixNQUFNLG1CQUFtQixDQUFDLEVBQUMsVUFBVSxFQUFFLHdCQUF3QixFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUE7SUFDbkYsQ0FBQztBQUNILENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSx3QkFBd0IsQ0FBQyxPQUFPLEVBQUUsT0FBTyxHQUFHLEVBQUU7SUFDNUQsTUFBTSxLQUFLLEdBQUc7UUFDWixjQUFjO1FBQ2QsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLEdBQUcsUUFBUSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7S0FDMUYsQ0FBQTtJQUVELEtBQUssTUFBTSxLQUFLLElBQUksV0FBVyxFQUFFLENBQUM7UUFDaEMsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRXpDLElBQUksQ0FBQyxTQUFTO1lBQUUsU0FBUTtRQUV4QixLQUFLLENBQUMsSUFBSSxDQUNSLEtBQUssQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1lBQ2hCLE1BQU0sQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztZQUNuQyxTQUFTLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQ3pDLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQzlDLENBQUE7SUFDSCxDQUFDO0lBRUQsSUFBSSxPQUFPLENBQUMsS0FBSyxFQUFFLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUM5QixLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRW5CLEtBQUssTUFBTSxJQUFJLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ2pDLEtBQUssQ0FBQyxJQUFJLENBQ1IsUUFBUSxJQUFJLENBQUMsVUFBVSxhQUFhLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLEVBQUU7Z0JBQ25FLFdBQVcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFdBQVcsRUFBRTtnQkFDaEQsU0FBUyxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUk7Z0JBQzVFLGFBQWEsSUFBSSxDQUFDLG9CQUFvQixFQUFFO2dCQUN4QyxXQUFXLElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxFQUFFO2dCQUN4QyxTQUFTLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUNwQyxDQUFBO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLE9BQU8sQ0FBQyxlQUFlO1FBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxjQUFjLE9BQU8sQ0FBQyxlQUFlLEVBQUUsQ0FBQyxDQUFBO0lBQ2hGLElBQUksT0FBTyxDQUFDLHdCQUF3QjtRQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsb0JBQW9CLE9BQU8sQ0FBQyx3QkFBd0IsRUFBRSxDQUFDLENBQUE7SUFFeEcsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQ3pCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuaW1wb3J0IHsgcm91bmRQcm9maWxlRHVyYXRpb24gfSBmcm9tIFwiLi90ZXN0LXByb2ZpbGVyLmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGltaW5nTWFuaWZlc3QgfSBmcm9tIFwiLi90aW1pbmctbWFuaWZlc3QuanNcIlxuXG5jb25zdCBGT1JCSURERU5fUFJPRklMRV9GSUVMRFMgPSBuZXcgU2V0KFtcbiAgXCJiaW5kXCIsXG4gIFwiYmluZHNcIixcbiAgXCJjaGVja291dG5hbWVcIixcbiAgXCJjcmVkZW50aWFsXCIsXG4gIFwiY3JlZGVudGlhbHNcIixcbiAgXCJkYXRhYmFzZW5hbWVcIixcbiAgXCJlcnJvclwiLFxuICBcImhvc3RcIixcbiAgXCJwYXNzd29yZFwiLFxuICBcInJldXNla2V5XCIsXG4gIFwic3FsXCIsXG4gIFwic3RhY2tcIixcbiAgXCJ0ZW5hbnRcIixcbiAgXCJ1c2VybmFtZVwiXG5dKVxuY29uc3QgUEhBU0VfT1JERVIgPSBbXG4gIFwiZGlzY292ZXJ5XCIsXG4gIFwiaW1wb3J0c1wiLFxuICBcInRlc3RpbmcgY29uZmlnL2dsb2JhbCBzZXR1cFwiLFxuICBcImJlZm9yZUFsbFwiLFxuICBcImJlZm9yZUVhY2hcIixcbiAgXCJ0ZXN0IGJvZHlcIixcbiAgXCJhZnRlckVhY2hcIixcbiAgXCJhZnRlckFsbFwiLFxuICBcImN1c3RvbVwiLFxuICBcInJ1bm5lciBvdmVyaGVhZFwiLFxuICBcInRvdGFsXCJcbl1cbmxldCBhdG9taWNXcml0ZVNlcXVlbmNlID0gMFxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IHJlamVjdHMgZmllbGRzIHRoYXQgYXJlIGZvcmJpZGRlbiBmcm9tIHJpY2ggcHJvZmlsZSBvdXRwdXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFByb2ZpbGUgdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gW3BhdGhOYW1lXSAtIERpYWdub3N0aWMgZmllbGQgcGF0aC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRQcm9maWxlUHJpdmFjeSh2YWx1ZSwgcGF0aE5hbWUgPSBcInByb2ZpbGVcIikge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IHZhbHVlLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgYXNzZXJ0UHJvZmlsZVByaXZhY3kodmFsdWVbaW5kZXhdLCBgJHtwYXRoTmFtZX1bJHtpbmRleH1dYClcbiAgICB9XG4gICAgcmV0dXJuXG4gIH1cblxuICBmb3IgKGNvbnN0IFtrZXksIGNoaWxkVmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlKSkge1xuICAgIGlmIChGT1JCSURERU5fUFJPRklMRV9GSUVMRFMuaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGb3JiaWRkZW4gcHJvZmlsZSBmaWVsZDogJHtwYXRoTmFtZX0uJHtrZXl9YClcbiAgICB9XG5cbiAgICBhc3NlcnRQcm9maWxlUHJpdmFjeShjaGlsZFZhbHVlLCBgJHtwYXRoTmFtZX0uJHtrZXl9YClcbiAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IHJvdW5kcyBkdXJhdGlvbiBmaWVsZHMgYW5kIHJlamVjdHMgaW52YWxpZCBkdXJhdGlvbiB2YWx1ZXMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFByb2ZpbGUgdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW3BhcmVudEtleV0gLSBQYXJlbnQgZmllbGQgbmFtZS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBub3JtYWxpemVEdXJhdGlvbnModmFsdWUsIHBhcmVudEtleSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgZm9yIChjb25zdCBjaGlsZFZhbHVlIG9mIHZhbHVlKSBub3JtYWxpemVEdXJhdGlvbnMoY2hpbGRWYWx1ZSwgcGFyZW50S2V5KVxuICAgIHJldHVyblxuICB9XG5cbiAgZm9yIChjb25zdCBba2V5LCBjaGlsZFZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh2YWx1ZSkpIHtcbiAgICBjb25zdCBkdXJhdGlvbkZpZWxkID0ga2V5LmVuZHNXaXRoKFwiTXNcIikgfHwgcGFyZW50S2V5ID09PSBcImNwdU1zXCJcblxuICAgIGlmIChkdXJhdGlvbkZpZWxkICYmIHR5cGVvZiBjaGlsZFZhbHVlID09PSBcIm51bWJlclwiKSB7XG4gICAgICBpZiAodHlwZW9mIGNoaWxkVmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZShjaGlsZFZhbHVlKSB8fCBjaGlsZFZhbHVlIDwgMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdGVzdCBwcm9maWxlIGR1cmF0aW9uIGZpZWxkOiAke2tleX1gKVxuICAgICAgfVxuXG4gICAgICB2YWx1ZVtrZXldID0gcm91bmRQcm9maWxlRHVyYXRpb24oY2hpbGRWYWx1ZSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGtleS5lbmRzV2l0aChcIk1zXCIpICYmIGtleSAhPT0gXCJjcHVNc1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdGVzdCBwcm9maWxlIGR1cmF0aW9uIGZpZWxkOiAke2tleX1gKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZUR1cmF0aW9ucyhjaGlsZFZhbHVlLCBrZXkpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgbm9ybWFsaXplZCBKU09OLXNhZmUgcmljaCBwcm9maWxlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcHJvZmlsZSAtIFJpY2ggcHJvZmlsZSBkb2N1bWVudC5cbiAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIGRvY3VtZW50LlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVkUHJvZmlsZShwcm9maWxlKSB7XG4gIGlmIChwcm9maWxlPy5zY2hlbWEgIT09IFwidmVsb2Npb3VzLnRlc3QtcHJvZmlsZVwiIHx8IHByb2ZpbGU/LnNjaGVtYVZlcnNpb24gIT09IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIFZlbG9jaW91cyB0ZXN0IHByb2ZpbGUgc2NoZW1hXCIpXG4gIH1cblxuICBhc3NlcnRQcm9maWxlUHJpdmFjeShwcm9maWxlKVxuICBjb25zdCBub3JtYWxpemVkID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShwcm9maWxlKSlcblxuICBub3JtYWxpemVEdXJhdGlvbnMobm9ybWFsaXplZClcbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBXcml0ZXMgdGV4dCB0aHJvdWdoIGEgc2FtZS1kaXJlY3RvcnkgdGVtcG9yYXJ5IGZpbGUgYW5kIGF0b21pYyByZW5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gb3V0cHV0UGF0aCAtIEZpbmFsIG91dHB1dCBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IGNvbnRlbnQgLSBDb21wbGV0ZSBvdXRwdXQgY29udGVudC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlbmFtZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gYXRvbWljV3JpdGUob3V0cHV0UGF0aCwgY29udGVudCkge1xuICBjb25zdCBkaXJlY3RvcnkgPSBwYXRoLmRpcm5hbWUob3V0cHV0UGF0aClcbiAgY29uc3Qgc2VxdWVuY2UgPSArK2F0b21pY1dyaXRlU2VxdWVuY2VcbiAgY29uc3QgdGVtcG9yYXJ5UGF0aCA9IHBhdGguam9pbihkaXJlY3RvcnksIGAuJHtwYXRoLmJhc2VuYW1lKG91dHB1dFBhdGgpfS4ke3Byb2Nlc3MucGlkfS4ke3NlcXVlbmNlfS50bXBgKVxuICBsZXQgdGVtcG9yYXJ5RmlsZUNyZWF0ZWQgPSBmYWxzZVxuXG4gIGF3YWl0IGZzLm1rZGlyKGRpcmVjdG9yeSwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG5cbiAgdHJ5IHtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcG9yYXJ5UGF0aCwgY29udGVudCwge2VuY29kaW5nOiBcInV0ZjhcIiwgZmxhZzogXCJ3eFwifSlcbiAgICB0ZW1wb3JhcnlGaWxlQ3JlYXRlZCA9IHRydWVcbiAgICBhd2FpdCBmcy5yZW5hbWUodGVtcG9yYXJ5UGF0aCwgb3V0cHV0UGF0aClcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAodGVtcG9yYXJ5RmlsZUNyZWF0ZWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZzLnVubGluayh0ZW1wb3JhcnlQYXRoKVxuICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIGlmICghKGNsZWFudXBFcnJvciBpbnN0YW5jZW9mIEVycm9yKSB8fCAhKFwiY29kZVwiIGluIGNsZWFudXBFcnJvcikgfHwgY2xlYW51cEVycm9yLmNvZGUgIT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgICBgRmFpbGVkIHRvIHdyaXRlIGFuZCBjbGVhbiB1cCB0ZXN0IHByb2ZpbGUgb3V0cHV0OiAke291dHB1dFBhdGh9YCxcbiAgICAgICAgICAgIHtjYXVzZTogY2xlYW51cEVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRocm93IGVycm9yXG4gIH1cbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgc29ydGVkIHBsYWluIHRpbWluZyBtYW5pZmVzdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHByb2ZpbGUgLSBSaWNoIHByb2ZpbGUgZG9jdW1lbnQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gLSBTb3J0ZWQgZmlsZS1kdXJhdGlvbiBtYXAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0aW1pbmdNYW5pZmVzdEZyb21Qcm9maWxlKHByb2ZpbGUpIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICBjb25zdCBtYW5pZmVzdCA9IHt9XG4gIGNvbnN0IHZhbGlkYXRlZE1hbmlmZXN0ID0gdmFsaWRhdGVUaW1pbmdNYW5pZmVzdChwcm9maWxlLnRpbWluZ01hbmlmZXN0IHx8IHt9LCB7c291cmNlOiBcIlRlc3QgcHJvZmlsZSB0aW1pbmcgbWFuaWZlc3RcIn0pXG5cbiAgZm9yIChjb25zdCBbZmlsZVBhdGgsIGR1cmF0aW9uTXNdIG9mIE9iamVjdC5lbnRyaWVzKHZhbGlkYXRlZE1hbmlmZXN0KSkge1xuICAgIG1hbmlmZXN0W2ZpbGVQYXRoXSA9IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGR1cmF0aW9uTXMpXG4gIH1cblxuICByZXR1cm4gbWFuaWZlc3Rcbn1cblxuLyoqXG4gKiBBdG9taWNhbGx5IHdyaXRlcyBhIGNhbm9uaWNhbCBzcGxpdHRlci1jb21wYXRpYmxlIHRpbWluZyBtYW5pZmVzdC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3V0cHV0IGFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm91dHB1dFBhdGggLSBGaW5hbCBvdXRwdXQgcGF0aC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gYXJncy50aW1pbmdNYW5pZmVzdCAtIFZhbGlkYXRlZCBvciBjYW5kaWRhdGUgdGltaW5nIG1hbmlmZXN0LlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYXRvbWljIHJlcGxhY2VtZW50LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd3JpdGVUaW1pbmdNYW5pZmVzdCh7b3V0cHV0UGF0aCwgdGltaW5nTWFuaWZlc3R9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB2YWxpZGF0ZVRpbWluZ01hbmlmZXN0KHRpbWluZ01hbmlmZXN0KVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gIGNvbnN0IHJvdW5kZWQgPSB7fVxuXG4gIGZvciAoY29uc3QgW2ZpbGVQYXRoLCBkdXJhdGlvbk1zXSBvZiBPYmplY3QuZW50cmllcyhub3JtYWxpemVkKSkge1xuICAgIHJvdW5kZWRbZmlsZVBhdGhdID0gcm91bmRQcm9maWxlRHVyYXRpb24oZHVyYXRpb25NcylcbiAgfVxuXG4gIGF3YWl0IGF0b21pY1dyaXRlKG91dHB1dFBhdGgsIGAke0pTT04uc3RyaW5naWZ5KHJvdW5kZWQsIG51bGwsIDIpfVxcbmApXG59XG5cbi8qKlxuICogQXRvbWljYWxseSB3cml0ZXMgcmVxdWVzdGVkIHRlc3QgcHJvZmlsZSBvdXRwdXRzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPdXRwdXQgb3B0aW9ucy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucHJvZmlsZSAtIFJpY2ggcHJvZmlsZSBkb2N1bWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9maWxlSnNvblBhdGhdIC0gUmljaCBKU09OIHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MudGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoXSAtIFBsYWluIHRpbWluZyBtYW5pZmVzdCBwYXRoLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIHJlcXVlc3RlZCB3cml0ZXMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3cml0ZVRlc3RQcm9maWxlT3V0cHV0cyh7cHJvZmlsZSwgcHJvZmlsZUpzb25QYXRoLCB0aW1pbmdNYW5pZmVzdE91dHB1dFBhdGh9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVkUHJvZmlsZShwcm9maWxlKVxuICBjb25zdCB0aW1pbmdNYW5pZmVzdCA9IHRpbWluZ01hbmlmZXN0RnJvbVByb2ZpbGUobm9ybWFsaXplZClcblxuICBub3JtYWxpemVkLnRpbWluZ01hbmlmZXN0ID0gdGltaW5nTWFuaWZlc3RcblxuICBpZiAocHJvZmlsZUpzb25QYXRoKSB7XG4gICAgYXdhaXQgYXRvbWljV3JpdGUocHJvZmlsZUpzb25QYXRoLCBgJHtKU09OLnN0cmluZ2lmeShub3JtYWxpemVkLCBudWxsLCAyKX1cXG5gKVxuICB9XG5cbiAgaWYgKHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCkge1xuICAgIGF3YWl0IHdyaXRlVGltaW5nTWFuaWZlc3Qoe291dHB1dFBhdGg6IHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aCwgdGltaW5nTWFuaWZlc3R9KVxuICB9XG59XG5cbi8qKlxuICogRm9ybWF0cyBhIGNvbXBhY3QgQmVuY2htYXJrLXN0eWxlIGNvbnNvbGUgc3VtbWFyeS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHByb2ZpbGUgLSBSaWNoIHByb2ZpbGUgZG9jdW1lbnQuXG4gKiBAcGFyYW0ge3twcm9maWxlSnNvblBhdGg/OiBzdHJpbmcsIHRpbWluZ01hbmlmZXN0T3V0cHV0UGF0aD86IHN0cmluZ319IFtvdXRwdXRzXSAtIFdyaXR0ZW4gb3V0cHV0IHBhdGhzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBDb25zb2xlIHN1bW1hcnkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRUZXN0UHJvZmlsZVN1bW1hcnkocHJvZmlsZSwgb3V0cHV0cyA9IHt9KSB7XG4gIGNvbnN0IGxpbmVzID0gW1xuICAgIFwiVGVzdCBwcm9maWxlXCIsXG4gICAgXCJQaGFzZVwiLnBhZEVuZCgzMSkgKyBcIkNvdW50XCIucGFkU3RhcnQoNSkgKyBcIlJlYWwgbXNcIi5wYWRTdGFydCgxMykgKyBcIkNQVSBtc1wiLnBhZFN0YXJ0KDEzKVxuICBdXG5cbiAgZm9yIChjb25zdCBwaGFzZSBvZiBQSEFTRV9PUkRFUikge1xuICAgIGNvbnN0IGFnZ3JlZ2F0ZSA9IHByb2ZpbGUucGhhc2VzPy5bcGhhc2VdXG5cbiAgICBpZiAoIWFnZ3JlZ2F0ZSkgY29udGludWVcblxuICAgIGxpbmVzLnB1c2goXG4gICAgICBwaGFzZS5wYWRFbmQoMzEpICtcbiAgICAgIFN0cmluZyhhZ2dyZWdhdGUuY291bnQpLnBhZFN0YXJ0KDUpICtcbiAgICAgIGFnZ3JlZ2F0ZS50b3RhbE1zLnRvRml4ZWQoMykucGFkU3RhcnQoMTMpICtcbiAgICAgIGFnZ3JlZ2F0ZS5jcHVNcy50b3RhbC50b0ZpeGVkKDMpLnBhZFN0YXJ0KDEzKVxuICAgIClcbiAgfVxuXG4gIGlmIChwcm9maWxlLnBvb2xzPy5sZW5ndGggPiAwKSB7XG4gICAgbGluZXMucHVzaChcIlBvb2xzXCIpXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgcHJvZmlsZS5wb29scykge1xuICAgICAgbGluZXMucHVzaChcbiAgICAgICAgYFBvb2wgJHtwb29sLmlkZW50aWZpZXJ9OiBjcmVhdGVkPSR7cG9vbC5jb25uZWN0aW9uQ3JlYXRpb24uY291bnR9YCArXG4gICAgICAgIGAgZmFpbGVkPSR7cG9vbC5jb25uZWN0aW9uQ3JlYXRpb24uZmFpbGVkQ291bnR9YCArXG4gICAgICAgIGAgd2FpdD0ke3Bvb2wuY2hlY2tvdXRXYWl0LmNvdW50fS8ke3Bvb2wuY2hlY2tvdXRXYWl0LnRvdGFsTXMudG9GaXhlZCgzKX1tc2AgK1xuICAgICAgICBgIHRpbWVvdXRzPSR7cG9vbC5jaGVja291dFRpbWVvdXRDb3VudH1gICtcbiAgICAgICAgYCByZWFwZWQ9JHtwb29sLmlkbGVSZWFwLmRpc3Bvc2FsQ291bnR9YCArXG4gICAgICAgIGAgcGVhaz0ke3Bvb2wucGVha0xpdmVDb25uZWN0aW9uc31gXG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgaWYgKG91dHB1dHMucHJvZmlsZUpzb25QYXRoKSBsaW5lcy5wdXNoKGBSaWNoIEpTT046ICR7b3V0cHV0cy5wcm9maWxlSnNvblBhdGh9YClcbiAgaWYgKG91dHB1dHMudGltaW5nTWFuaWZlc3RPdXRwdXRQYXRoKSBsaW5lcy5wdXNoKGBUaW1pbmcgbWFuaWZlc3Q6ICR7b3V0cHV0cy50aW1pbmdNYW5pZmVzdE91dHB1dFBhdGh9YClcblxuICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKVxufVxuIl19
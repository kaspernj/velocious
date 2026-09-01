/**
 * Normalizes a mount prefix: ensures a leading slash and strips any trailing
 * slash so `/velocious/jobs/` and `/velocious/jobs` behave identically.
 * @param {string} at - Raw mount prefix.
 * @returns {string} - Normalized prefix.
 */
export declare function normalizeMountPrefix(at: string): string;
/**
 * Extracts the request sub-path under a normalized mount prefix, or null when
 * the path is outside the mount. A root mount (`/`) treats the whole path as
 * the sub-path.
 * @param {object} args - Options.
 * @param {string} args.prefix - Normalized mount prefix.
 * @param {string} args.path - Request path without query string.
 * @returns {string | null} - Sub-path ("/" for the bare prefix) or null.
 */
export declare function mountSubPath({ prefix, path }: {
    prefix: string;
    path: string;
}): string | null;
//# sourceMappingURL=mount-prefix.d.ts.map
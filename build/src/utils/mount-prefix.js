// @ts-check
/**
 * Normalizes a mount prefix: ensures a leading slash and strips any trailing
 * slash so `/velocious/jobs/` and `/velocious/jobs` behave identically.
 * @param {string} at - Raw mount prefix.
 * @returns {string} - Normalized prefix.
 */
export function normalizeMountPrefix(at) {
    if (typeof at !== "string" || !at.startsWith("/")) {
        throw new Error(`mount requires an 'at' path starting with '/', got: ${String(at)}`);
    }
    if (at.length > 1 && at.endsWith("/")) {
        return at.slice(0, -1);
    }
    return at;
}
/**
 * Extracts the request sub-path under a normalized mount prefix, or null when
 * the path is outside the mount. A root mount (`/`) treats the whole path as
 * the sub-path.
 * @param {object} args - Options.
 * @param {string} args.prefix - Normalized mount prefix.
 * @param {string} args.path - Request path without query string.
 * @returns {string | null} - Sub-path ("/" for the bare prefix) or null.
 */
export function mountSubPath({ prefix, path }) {
    if (prefix === "/")
        return path;
    if (path === prefix)
        return "/";
    if (path.startsWith(`${prefix}/`))
        return path.slice(prefix.length);
    return null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW91bnQtcHJlZml4LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3V0aWxzL21vdW50LXByZWZpeC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7O0dBS0c7QUFDSCxNQUFNLFVBQVUsb0JBQW9CLENBQUMsRUFBRTtJQUNyQyxJQUFJLE9BQU8sRUFBRSxLQUFLLFFBQVEsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNsRCxNQUFNLElBQUksS0FBSyxDQUFDLHVEQUF1RCxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ3RGLENBQUM7SUFFRCxJQUFJLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN0QyxPQUFPLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDeEIsQ0FBQztJQUVELE9BQU8sRUFBRSxDQUFBO0FBQ1gsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsTUFBTSxVQUFVLFlBQVksQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUM7SUFDekMsSUFBSSxNQUFNLEtBQUssR0FBRztRQUFFLE9BQU8sSUFBSSxDQUFBO0lBQy9CLElBQUksSUFBSSxLQUFLLE1BQU07UUFBRSxPQUFPLEdBQUcsQ0FBQTtJQUMvQixJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxNQUFNLEdBQUcsQ0FBQztRQUFFLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7SUFFbkUsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogTm9ybWFsaXplcyBhIG1vdW50IHByZWZpeDogZW5zdXJlcyBhIGxlYWRpbmcgc2xhc2ggYW5kIHN0cmlwcyBhbnkgdHJhaWxpbmdcbiAqIHNsYXNoIHNvIGAvdmVsb2Npb3VzL2pvYnMvYCBhbmQgYC92ZWxvY2lvdXMvam9ic2AgYmVoYXZlIGlkZW50aWNhbGx5LlxuICogQHBhcmFtIHtzdHJpbmd9IGF0IC0gUmF3IG1vdW50IHByZWZpeC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBwcmVmaXguXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVNb3VudFByZWZpeChhdCkge1xuICBpZiAodHlwZW9mIGF0ICE9PSBcInN0cmluZ1wiIHx8ICFhdC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgbW91bnQgcmVxdWlyZXMgYW4gJ2F0JyBwYXRoIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKGF0KX1gKVxuICB9XG5cbiAgaWYgKGF0Lmxlbmd0aCA+IDEgJiYgYXQuZW5kc1dpdGgoXCIvXCIpKSB7XG4gICAgcmV0dXJuIGF0LnNsaWNlKDAsIC0xKVxuICB9XG5cbiAgcmV0dXJuIGF0XG59XG5cbi8qKlxuICogRXh0cmFjdHMgdGhlIHJlcXVlc3Qgc3ViLXBhdGggdW5kZXIgYSBub3JtYWxpemVkIG1vdW50IHByZWZpeCwgb3IgbnVsbCB3aGVuXG4gKiB0aGUgcGF0aCBpcyBvdXRzaWRlIHRoZSBtb3VudC4gQSByb290IG1vdW50IChgL2ApIHRyZWF0cyB0aGUgd2hvbGUgcGF0aCBhc1xuICogdGhlIHN1Yi1wYXRoLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJlZml4IC0gTm9ybWFsaXplZCBtb3VudCBwcmVmaXguXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wYXRoIC0gUmVxdWVzdCBwYXRoIHdpdGhvdXQgcXVlcnkgc3RyaW5nLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gU3ViLXBhdGggKFwiL1wiIGZvciB0aGUgYmFyZSBwcmVmaXgpIG9yIG51bGwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtb3VudFN1YlBhdGgoe3ByZWZpeCwgcGF0aH0pIHtcbiAgaWYgKHByZWZpeCA9PT0gXCIvXCIpIHJldHVybiBwYXRoXG4gIGlmIChwYXRoID09PSBwcmVmaXgpIHJldHVybiBcIi9cIlxuICBpZiAocGF0aC5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCkpIHJldHVybiBwYXRoLnNsaWNlKHByZWZpeC5sZW5ndGgpXG5cbiAgcmV0dXJuIG51bGxcbn1cbiJdfQ==
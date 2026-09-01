/**
 * ParsedStackFrame type.
 * @typedef {object} ParsedStackFrame
 * @property {string | undefined} methodName - Method/function name from the stack frame.
 * @property {string} sourcePath - File or URL path from the stack frame.
 * @property {number} lineNumber - Source line number.
 * @property {number | undefined} columnNumber - Source column number.
 */
// @ts-check
/**
 * Runs escape reg exp.
 * @param {string} value - Value to escape.
 * @returns {string} - Escaped value for a RegExp pattern.
 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Runs normalize path.
 * @param {string | undefined} value - Path or file URL.
 * @returns {string | undefined} - Normalized path.
 */
function normalizePath(value) {
    if (!value)
        return undefined;
    let normalized = value;
    if (normalized.startsWith("file://")) {
        try {
            normalized = new URL(normalized).pathname;
        }
        catch {
            // Keep original value when URL parsing fails.
        }
    }
    try {
        normalized = decodeURIComponent(normalized);
    }
    catch {
        // Keep encoded value when decoding fails.
    }
    return normalized.replace(/\\/g, "/");
}
/**
 * Runs normalize directory.
 * @param {string | undefined} value - Directory path.
 * @returns {string | undefined} - Normalized directory path ending with slash.
 */
function normalizeDirectory(value) {
    const normalized = normalizePath(value);
    if (!normalized)
        return undefined;
    return normalized.endsWith("/") ? normalized : `${normalized}/`;
}
/**
 * Runs parse stack frame.
 * @param {string} line - Stack line.
 * @returns {ParsedStackFrame | undefined} - Parsed frame when possible.
 */
function parseStackFrame(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at "))
        return undefined;
    const frame = trimmed.slice(3);
    const frameWithMethodMatch = frame.match(/^(.*?) \((.*)\)$/);
    const methodName = frameWithMethodMatch ? frameWithMethodMatch[1] : undefined;
    const location = frameWithMethodMatch ? frameWithMethodMatch[2] : frame;
    const locationMatch = location.match(/^(.*):(\d+):(\d+)$/) || location.match(/^(.*):(\d+)$/);
    if (!locationMatch)
        return undefined;
    const sourcePath = normalizePath(locationMatch[1]);
    const lineNumber = Number(locationMatch[2]);
    const columnNumber = locationMatch[3] === undefined ? undefined : Number(locationMatch[3]);
    if (!sourcePath || !Number.isFinite(lineNumber))
        return undefined;
    return {
        columnNumber: Number.isFinite(columnNumber) ? columnNumber : undefined,
        lineNumber,
        methodName,
        sourcePath
    };
}
/**
 * Runs relative application path.
 * @param {string} sourcePath - Source path.
 * @param {string} applicationDirectory - Application directory.
 * @returns {string} - Path relative to the application directory when possible.
 */
function relativeApplicationPath(sourcePath, applicationDirectory) {
    if (sourcePath.startsWith(applicationDirectory)) {
        return sourcePath.slice(applicationDirectory.length);
    }
    return sourcePath;
}
export default class BacktraceCleaner {
    /**
     * Framework source directory.
     * @type {string | undefined} */
    frameworkSourceDirectory = undefined;
    /**
     * Runs get cleaned stack.
     * @param {Error} error - Error instance.
     * @param {object} [args] - Options object.
     * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
     * @param {boolean} [args.includeErrorHeader] - Whether to include the `Error: ...` header line.
     * @returns {string | undefined} - The cleaned stack.
     */
    static getCleanedStack(error, args) {
        return new BacktraceCleaner(error, args).getCleanedStack(args);
    }
    /**
     * Runs get application source line.
     * @param {Error} error - Error instance.
     * @param {object} args - Options object.
     * @param {string} args.applicationDirectory - Application directory.
     * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
     * @returns {string | undefined} - Source line for the first application frame.
     */
    static getApplicationSourceLine(error, args) {
        return new BacktraceCleaner(error, args).getApplicationSourceLine(args);
    }
    /**
     * Runs constructor.
     * @param {Error} error - Error instance.
     * @param {object} [args] - Options object.
     * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
     */
    constructor(error, { frameworkSourceDirectory } = {}) {
        this.error = error;
        this.frameworkSourceDirectory = normalizeDirectory(frameworkSourceDirectory);
    }
    /**
     * Runs get cleaned stack.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.includeErrorHeader] - Whether to include the `Error: ...` header line.
     * @returns {string | undefined} - The cleaned stack.
     */
    getCleanedStack({ includeErrorHeader = true } = {}) {
        const backtrace = this.getCleanedStackLines();
        if (!backtrace || backtrace.length === 0)
            return undefined;
        if (includeErrorHeader)
            return backtrace.join("\n");
        const firstLine = backtrace[0];
        const remainingLines = this.isErrorHeaderLine(firstLine) ? backtrace.slice(1) : backtrace;
        if (remainingLines.length === 0)
            return undefined;
        return remainingLines.join("\n");
    }
    /**
     * Runs get cleaned stack lines.
     * @returns {string[] | undefined} - Filtered stack lines.
     */
    getCleanedStackLines() {
        const backtrace = this.error?.stack?.split("\n");
        return backtrace?.filter((line) => this._shouldKeepStackLine(line));
    }
    /**
     * Runs get application source line.
     * @param {object} args - Options object.
     * @param {string} args.applicationDirectory - Application directory.
     * @returns {string | undefined} - Source line for the first application frame.
     */
    getApplicationSourceLine({ applicationDirectory }) {
        const normalizedApplicationDirectory = normalizeDirectory(applicationDirectory);
        if (!normalizedApplicationDirectory)
            return undefined;
        const frame = this._firstApplicationFrame(normalizedApplicationDirectory);
        if (!frame)
            return undefined;
        const relativePath = relativeApplicationPath(frame.sourcePath, normalizedApplicationDirectory);
        const methodSuffix = frame.methodName ? `:in ${frame.methodName.replace(/^async /, "")}` : "";
        return `${relativePath}:${frame.lineNumber}${methodSuffix}`;
    }
    /**
     * Runs is error header line.
     * @param {string | undefined} line - Backtrace line.
     * @returns {boolean} - True when the line is an error header.
     */
    isErrorHeaderLine(line) {
        if (!line)
            return false;
        const trimmedLine = line.trim();
        if (!trimmedLine)
            return false;
        if (trimmedLine.startsWith("Error:"))
            return true;
        const errorNamePattern = new RegExp(`^${escapeRegExp(this.error.name)}(?:\\s*\\[[^\\]]+\\])?:`);
        return errorNamePattern.test(trimmedLine);
    }
    /**
     * Runs first application frame.
     * @param {string} applicationDirectory - Normalized application directory.
     * @returns {ParsedStackFrame | undefined} - First app-owned frame.
     */
    _firstApplicationFrame(applicationDirectory) {
        const backtrace = this.getCleanedStackLines();
        if (!backtrace)
            return undefined;
        for (const line of backtrace) {
            const frame = parseStackFrame(line);
            if (!frame)
                continue;
            if (!frame.sourcePath.startsWith(applicationDirectory))
                continue;
            if (this._frameworkSourcePath(frame.sourcePath))
                continue;
            return frame;
        }
        return undefined;
    }
    /**
     * Runs framework source path.
     * @param {string} sourcePath - Source path.
     * @returns {boolean} - Whether the path belongs to Velocious internals.
     */
    _frameworkSourcePath(sourcePath) {
        if (!this.frameworkSourceDirectory)
            return false;
        return sourcePath.startsWith(this.frameworkSourceDirectory);
    }
    /**
     * Runs should keep stack line.
     * @param {string} line - Stack line.
     * @returns {boolean} - Whether to keep the stack line.
     */
    _shouldKeepStackLine(line) {
        if (line.includes("node_modules"))
            return false;
        if (line.includes("(node:internal/"))
            return false;
        if (line.includes("(node:internal/process/"))
            return false;
        if (line.trim().startsWith("at node:internal/"))
            return false;
        return true;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja3RyYWNlLWNsZWFuZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvYmFja3RyYWNlLWNsZWFuZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7R0FPRztBQUNILFlBQVk7QUFFWjs7OztHQUlHO0FBQ0gsU0FBUyxZQUFZLENBQUMsS0FBSztJQUN6QixPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMscUJBQXFCLEVBQUUsTUFBTSxDQUFDLENBQUE7QUFDckQsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGFBQWEsQ0FBQyxLQUFLO0lBQzFCLElBQUksQ0FBQyxLQUFLO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFFNUIsSUFBSSxVQUFVLEdBQUcsS0FBSyxDQUFBO0lBRXRCLElBQUksVUFBVSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3JDLElBQUksQ0FBQztZQUNILFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxRQUFRLENBQUE7UUFDM0MsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLDhDQUE4QztRQUNoRCxDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILFVBQVUsR0FBRyxrQkFBa0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsMENBQTBDO0lBQzVDLENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQ3ZDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxLQUFLO0lBQy9CLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUV2QyxJQUFJLENBQUMsVUFBVTtRQUFFLE9BQU8sU0FBUyxDQUFBO0lBRWpDLE9BQU8sVUFBVSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMs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ZWYge29iamVjdH0gUGFyc2VkU3RhY2tGcmFtZVxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IG1ldGhvZE5hbWUgLSBNZXRob2QvZnVuY3Rpb24gbmFtZSBmcm9tIHRoZSBzdGFjayBmcmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzb3VyY2VQYXRoIC0gRmlsZSBvciBVUkwgcGF0aCBmcm9tIHRoZSBzdGFjayBmcmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBsaW5lTnVtYmVyIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCB1bmRlZmluZWR9IGNvbHVtbk51bWJlciAtIFNvdXJjZSBjb2x1bW4gbnVtYmVyLlxuICovXG4vLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBSdW5zIGVzY2FwZSByZWcgZXhwLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gZXNjYXBlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBFc2NhcGVkIHZhbHVlIGZvciBhIFJlZ0V4cCBwYXR0ZXJuLlxuICovXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gdmFsdWUgLSBQYXRoIG9yIGZpbGUgVVJMLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHBhdGguXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVBhdGgodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIGxldCBub3JtYWxpemVkID0gdmFsdWVcblxuICBpZiAobm9ybWFsaXplZC5zdGFydHNXaXRoKFwiZmlsZTovL1wiKSkge1xuICAgIHRyeSB7XG4gICAgICBub3JtYWxpemVkID0gbmV3IFVSTChub3JtYWxpemVkKS5wYXRobmFtZVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gS2VlcCBvcmlnaW5hbCB2YWx1ZSB3aGVuIFVSTCBwYXJzaW5nIGZhaWxzLlxuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgbm9ybWFsaXplZCA9IGRlY29kZVVSSUNvbXBvbmVudChub3JtYWxpemVkKVxuICB9IGNhdGNoIHtcbiAgICAvLyBLZWVwIGVuY29kZWQgdmFsdWUgd2hlbiBkZWNvZGluZyBmYWlscy5cbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZGlyZWN0b3J5LlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHZhbHVlIC0gRGlyZWN0b3J5IHBhdGguXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgZGlyZWN0b3J5IHBhdGggZW5kaW5nIHdpdGggc2xhc2guXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZURpcmVjdG9yeSh2YWx1ZSkge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUGF0aCh2YWx1ZSlcblxuICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiB1bmRlZmluZWRcblxuICByZXR1cm4gbm9ybWFsaXplZC5lbmRzV2l0aChcIi9cIikgPyBub3JtYWxpemVkIDogYCR7bm9ybWFsaXplZH0vYFxufVxuXG4vKipcbiAqIFJ1bnMgcGFyc2Ugc3RhY2sgZnJhbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIFN0YWNrIGxpbmUuXG4gKiBAcmV0dXJucyB7UGFyc2VkU3RhY2tGcmFtZSB8IHVuZGVmaW5lZH0gLSBQYXJzZWQgZnJhbWUgd2hlbiBwb3NzaWJsZS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VTdGFja0ZyYW1lKGxpbmUpIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpXG5cbiAgaWYgKCF0cmltbWVkLnN0YXJ0c1dpdGgoXCJhdCBcIikpIHJldHVybiB1bmRlZmluZWRcblxuICBjb25zdCBmcmFtZSA9IHRyaW1tZWQuc2xpY2UoMylcbiAgY29uc3QgZnJhbWVXaXRoTWV0aG9kTWF0Y2ggPSBmcmFtZS5tYXRjaCgvXiguKj8pIFxcKCguKilcXCkkLylcbiAgY29uc3QgbWV0aG9kTmFtZSA9IGZyYW1lV2l0aE1ldGhvZE1hdGNoID8gZnJhbWVXaXRoTWV0aG9kTWF0Y2hbMV0gOiB1bmRlZmluZWRcbiAgY29uc3QgbG9jYXRpb24gPSBmcmFtZVdpdGhNZXRob2RNYXRjaCA/IGZyYW1lV2l0aE1ldGhvZE1hdGNoWzJdIDogZnJhbWVcbiAgY29uc3QgbG9jYXRpb25NYXRjaCA9IGxvY2F0aW9uLm1hdGNoKC9eKC4qKTooXFxkKyk6KFxcZCspJC8pIHx8IGxvY2F0aW9uLm1hdGNoKC9eKC4qKTooXFxkKykkLylcblxuICBpZiAoIWxvY2F0aW9uTWF0Y2gpIHJldHVybiB1bmRlZmluZWRcblxuICBjb25zdCBzb3VyY2VQYXRoID0gbm9ybWFsaXplUGF0aChsb2NhdGlvbk1hdGNoWzFdKVxuICBjb25zdCBsaW5lTnVtYmVyID0gTnVtYmVyKGxvY2F0aW9uTWF0Y2hbMl0pXG4gIGNvbnN0IGNvbHVtbk51bWJlciA9IGxvY2F0aW9uTWF0Y2hbM10gPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IE51bWJlcihsb2NhdGlvbk1hdGNoWzNdKVxuXG4gIGlmICghc291cmNlUGF0aCB8fCAhTnVtYmVyLmlzRmluaXRlKGxpbmVOdW1iZXIpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHtcbiAgICBjb2x1bW5OdW1iZXI6IE51bWJlci5pc0Zpbml0ZShjb2x1bW5OdW1iZXIpID8gY29sdW1uTnVtYmVyIDogdW5kZWZpbmVkLFxuICAgIGxpbmVOdW1iZXIsXG4gICAgbWV0aG9kTmFtZSxcbiAgICBzb3VyY2VQYXRoXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHJlbGF0aXZlIGFwcGxpY2F0aW9uIHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ30gc291cmNlUGF0aCAtIFNvdXJjZSBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IGFwcGxpY2F0aW9uRGlyZWN0b3J5IC0gQXBwbGljYXRpb24gZGlyZWN0b3J5LlxuICogQHJldHVybnMge3N0cmluZ30gLSBQYXRoIHJlbGF0aXZlIHRvIHRoZSBhcHBsaWNhdGlvbiBkaXJlY3Rvcnkgd2hlbiBwb3NzaWJsZS5cbiAqL1xuZnVuY3Rpb24gcmVsYXRpdmVBcHBsaWNhdGlvblBhdGgoc291cmNlUGF0aCwgYXBwbGljYXRpb25EaXJlY3RvcnkpIHtcbiAgaWYgKHNvdXJjZVBhdGguc3RhcnRzV2l0aChhcHBsaWNhdGlvbkRpcmVjdG9yeSkpIHtcbiAgICByZXR1cm4gc291cmNlUGF0aC5zbGljZShhcHBsaWNhdGlvbkRpcmVjdG9yeS5sZW5ndGgpXG4gIH1cblxuICByZXR1cm4gc291cmNlUGF0aFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrdHJhY2VDbGVhbmVyIHtcbiAgLyoqXG4gICAqIEZyYW1ld29yayBzb3VyY2UgZGlyZWN0b3J5LlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBmcmFtZXdvcmtTb3VyY2VEaXJlY3RvcnkgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBnZXQgY2xlYW5lZCBzdGFjay5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW2FyZ3MuZnJhbWV3b3JrU291cmNlRGlyZWN0b3J5XSAtIERpcmVjdG9yeSBmb3IgVmVsb2Npb3VzIGludGVybmFscyB0byBza2lwLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmluY2x1ZGVFcnJvckhlYWRlcl0gLSBXaGV0aGVyIHRvIGluY2x1ZGUgdGhlIGBFcnJvcjogLi4uYCBoZWFkZXIgbGluZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgY2xlYW5lZCBzdGFjay5cbiAgICovXG4gIHN0YXRpYyBnZXRDbGVhbmVkU3RhY2soZXJyb3IsIGFyZ3MpIHtcbiAgICByZXR1cm4gbmV3IEJhY2t0cmFjZUNsZWFuZXIoZXJyb3IsIGFyZ3MpLmdldENsZWFuZWRTdGFjayhhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFwcGxpY2F0aW9uIHNvdXJjZSBsaW5lLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hcHBsaWNhdGlvbkRpcmVjdG9yeSAtIEFwcGxpY2F0aW9uIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFthcmdzLmZyYW1ld29ya1NvdXJjZURpcmVjdG9yeV0gLSBEaXJlY3RvcnkgZm9yIFZlbG9jaW91cyBpbnRlcm5hbHMgdG8gc2tpcC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBTb3VyY2UgbGluZSBmb3IgdGhlIGZpcnN0IGFwcGxpY2F0aW9uIGZyYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEFwcGxpY2F0aW9uU291cmNlTGluZShlcnJvciwgYXJncykge1xuICAgIHJldHVybiBuZXcgQmFja3RyYWNlQ2xlYW5lcihlcnJvciwgYXJncykuZ2V0QXBwbGljYXRpb25Tb3VyY2VMaW5lKGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW2FyZ3MuZnJhbWV3b3JrU291cmNlRGlyZWN0b3J5XSAtIERpcmVjdG9yeSBmb3IgVmVsb2Npb3VzIGludGVybmFscyB0byBza2lwLlxuICAgKi9cbiAgY29uc3RydWN0b3IoZXJyb3IsIHtmcmFtZXdvcmtTb3VyY2VEaXJlY3Rvcnl9ID0ge30pIHtcbiAgICB0aGlzLmVycm9yID0gZXJyb3JcbiAgICB0aGlzLmZyYW1ld29ya1NvdXJjZURpcmVjdG9yeSA9IG5vcm1hbGl6ZURpcmVjdG9yeShmcmFtZXdvcmtTb3VyY2VEaXJlY3RvcnkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY2xlYW5lZCBzdGFjay5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmluY2x1ZGVFcnJvckhlYWRlcl0gLSBXaGV0aGVyIHRvIGluY2x1ZGUgdGhlIGBFcnJvcjogLi4uYCBoZWFkZXIgbGluZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgY2xlYW5lZCBzdGFjay5cbiAgICovXG4gIGdldENsZWFuZWRTdGFjayh7aW5jbHVkZUVycm9ySGVhZGVyID0gdHJ1ZX0gPSB7fSkge1xuICAgIGNvbnN0IGJhY2t0cmFjZSA9IHRoaXMuZ2V0Q2xlYW5lZFN0YWNrTGluZXMoKVxuXG4gICAgaWYgKCFiYWNrdHJhY2UgfHwgYmFja3RyYWNlLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgaWYgKGluY2x1ZGVFcnJvckhlYWRlcikgcmV0dXJuIGJhY2t0cmFjZS5qb2luKFwiXFxuXCIpXG5cbiAgICBjb25zdCBmaXJzdExpbmUgPSBiYWNrdHJhY2VbMF1cbiAgICBjb25zdCByZW1haW5pbmdMaW5lcyA9IHRoaXMuaXNFcnJvckhlYWRlckxpbmUoZmlyc3RMaW5lKSA/IGJhY2t0cmFjZS5zbGljZSgxKSA6IGJhY2t0cmFjZVxuXG4gICAgaWYgKHJlbWFpbmluZ0xpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHJlbWFpbmluZ0xpbmVzLmpvaW4oXCJcXG5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjbGVhbmVkIHN0YWNrIGxpbmVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCB1bmRlZmluZWR9IC0gRmlsdGVyZWQgc3RhY2sgbGluZXMuXG4gICAqL1xuICBnZXRDbGVhbmVkU3RhY2tMaW5lcygpIHtcbiAgICBjb25zdCBiYWNrdHJhY2UgPSB0aGlzLmVycm9yPy5zdGFjaz8uc3BsaXQoXCJcXG5cIilcblxuICAgIHJldHVybiBiYWNrdHJhY2U/LmZpbHRlcigobGluZSkgPT4gdGhpcy5fc2hvdWxkS2VlcFN0YWNrTGluZShsaW5lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcHBsaWNhdGlvbiBzb3VyY2UgbGluZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXBwbGljYXRpb25EaXJlY3RvcnkgLSBBcHBsaWNhdGlvbiBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gU291cmNlIGxpbmUgZm9yIHRoZSBmaXJzdCBhcHBsaWNhdGlvbiBmcmFtZS5cbiAgICovXG4gIGdldEFwcGxpY2F0aW9uU291cmNlTGluZSh7YXBwbGljYXRpb25EaXJlY3Rvcnl9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEFwcGxpY2F0aW9uRGlyZWN0b3J5ID0gbm9ybWFsaXplRGlyZWN0b3J5KGFwcGxpY2F0aW9uRGlyZWN0b3J5KVxuXG4gICAgaWYgKCFub3JtYWxpemVkQXBwbGljYXRpb25EaXJlY3RvcnkpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IGZyYW1lID0gdGhpcy5fZmlyc3RBcHBsaWNhdGlvbkZyYW1lKG5vcm1hbGl6ZWRBcHBsaWNhdGlvbkRpcmVjdG9yeSlcblxuICAgIGlmICghZnJhbWUpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHJlbGF0aXZlQXBwbGljYXRpb25QYXRoKGZyYW1lLnNvdXJjZVBhdGgsIG5vcm1hbGl6ZWRBcHBsaWNhdGlvbkRpcmVjdG9yeSlcbiAgICBjb25zdCBtZXRob2RTdWZmaXggPSBmcmFtZS5tZXRob2ROYW1lID8gYDppbiAke2ZyYW1lLm1ldGhvZE5hbWUucmVwbGFjZSgvXmFzeW5jIC8sIFwiXCIpfWAgOiBcIlwiXG5cbiAgICByZXR1cm4gYCR7cmVsYXRpdmVQYXRofToke2ZyYW1lLmxpbmVOdW1iZXJ9JHttZXRob2RTdWZmaXh9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZXJyb3IgaGVhZGVyIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBsaW5lIC0gQmFja3RyYWNlIGxpbmUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFRydWUgd2hlbiB0aGUgbGluZSBpcyBhbiBlcnJvciBoZWFkZXIuXG4gICAqL1xuICBpc0Vycm9ySGVhZGVyTGluZShsaW5lKSB7XG4gICAgaWYgKCFsaW5lKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHRyaW1tZWRMaW5lID0gbGluZS50cmltKClcblxuICAgIGlmICghdHJpbW1lZExpbmUpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKHRyaW1tZWRMaW5lLnN0YXJ0c1dpdGgoXCJFcnJvcjpcIikpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCBlcnJvck5hbWVQYXR0ZXJuID0gbmV3IFJlZ0V4cChgXiR7ZXNjYXBlUmVnRXhwKHRoaXMuZXJyb3IubmFtZSl9KD86XFxcXHMqXFxcXFtbXlxcXFxdXStcXFxcXSk/OmApXG5cbiAgICByZXR1cm4gZXJyb3JOYW1lUGF0dGVybi50ZXN0KHRyaW1tZWRMaW5lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyc3QgYXBwbGljYXRpb24gZnJhbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcHBsaWNhdGlvbkRpcmVjdG9yeSAtIE5vcm1hbGl6ZWQgYXBwbGljYXRpb24gZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7UGFyc2VkU3RhY2tGcmFtZSB8IHVuZGVmaW5lZH0gLSBGaXJzdCBhcHAtb3duZWQgZnJhbWUuXG4gICAqL1xuICBfZmlyc3RBcHBsaWNhdGlvbkZyYW1lKGFwcGxpY2F0aW9uRGlyZWN0b3J5KSB7XG4gICAgY29uc3QgYmFja3RyYWNlID0gdGhpcy5nZXRDbGVhbmVkU3RhY2tMaW5lcygpXG5cbiAgICBpZiAoIWJhY2t0cmFjZSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGJhY2t0cmFjZSkge1xuICAgICAgY29uc3QgZnJhbWUgPSBwYXJzZVN0YWNrRnJhbWUobGluZSlcblxuICAgICAgaWYgKCFmcmFtZSkgY29udGludWVcbiAgICAgIGlmICghZnJhbWUuc291cmNlUGF0aC5zdGFydHNXaXRoKGFwcGxpY2F0aW9uRGlyZWN0b3J5KSkgY29udGludWVcbiAgICAgIGlmICh0aGlzLl9mcmFtZXdvcmtTb3VyY2VQYXRoKGZyYW1lLnNvdXJjZVBhdGgpKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4gZnJhbWVcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcmFtZXdvcmsgc291cmNlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzb3VyY2VQYXRoIC0gU291cmNlIHBhdGguXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHBhdGggYmVsb25ncyB0byBWZWxvY2lvdXMgaW50ZXJuYWxzLlxuICAgKi9cbiAgX2ZyYW1ld29ya1NvdXJjZVBhdGgoc291cmNlUGF0aCkge1xuICAgIGlmICghdGhpcy5mcmFtZXdvcmtTb3VyY2VEaXJlY3RvcnkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHNvdXJjZVBhdGguc3RhcnRzV2l0aCh0aGlzLmZyYW1ld29ya1NvdXJjZURpcmVjdG9yeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBrZWVwIHN0YWNrIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gU3RhY2sgbGluZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBrZWVwIHRoZSBzdGFjayBsaW5lLlxuICAgKi9cbiAgX3Nob3VsZEtlZXBTdGFja0xpbmUobGluZSkge1xuICAgIGlmIChsaW5lLmluY2x1ZGVzKFwibm9kZV9tb2R1bGVzXCIpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAobGluZS5pbmNsdWRlcyhcIihub2RlOmludGVybmFsL1wiKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKGxpbmUuaW5jbHVkZXMoXCIobm9kZTppbnRlcm5hbC9wcm9jZXNzL1wiKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKGxpbmUudHJpbSgpLnN0YXJ0c1dpdGgoXCJhdCBub2RlOmludGVybmFsL1wiKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG59XG4iXX0=
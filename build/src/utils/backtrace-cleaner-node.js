// @ts-check
import BacktraceCleaner from "./backtrace-cleaner.js";
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
 * Runs framework source directory.
 * @returns {string | undefined} - The Velocious source directory for Node runtimes.
 */
function frameworkSourceDirectory() {
    try {
        const sourceUrl = new URL("../", import.meta.url);
        if (sourceUrl.protocol !== "file:")
            return undefined;
        return normalizePath(sourceUrl.pathname);
    }
    catch {
        return undefined;
    }
}
export const FRAMEWORK_SOURCE_DIRECTORY = frameworkSourceDirectory();
export default class NodeBacktraceCleaner extends BacktraceCleaner {
    /**
     * Runs get cleaned stack.
     * @param {Error} error - Error instance.
     * @param {object} [args] - Options object.
     * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
     * @param {boolean} [args.includeErrorHeader] - Whether to include the `Error: ...` header line.
     * @returns {string | undefined} - The cleaned stack.
     */
    static getCleanedStack(error, args) {
        return new NodeBacktraceCleaner(error, args).getCleanedStack(args);
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
        return new NodeBacktraceCleaner(error, args).getApplicationSourceLine(args);
    }
    /**
     * Runs constructor.
     * @param {Error} error - Error instance.
     * @param {object} [args] - Options object.
     * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
     */
    constructor(error, args = {}) {
        super(error, {
            ...args,
            frameworkSourceDirectory: args.frameworkSourceDirectory || FRAMEWORK_SOURCE_DIRECTORY
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja3RyYWNlLWNsZWFuZXItbm9kZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy91dGlscy9iYWNrdHJhY2UtY2xlYW5lci1ub2RlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGdCQUFnQixNQUFNLHdCQUF3QixDQUFBO0FBRXJEOzs7O0dBSUc7QUFDSCxTQUFTLGFBQWEsQ0FBQyxLQUFLO0lBQzFCLElBQUksQ0FBQyxLQUFLO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFFNUIsSUFBSSxVQUFVLEdBQUcsS0FBSyxDQUFBO0lBRXRCLElBQUksVUFBVSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3JDLElBQUksQ0FBQztZQUNILFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxRQUFRLENBQUE7UUFDM0MsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLDhDQUE4QztRQUNoRCxDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILFVBQVUsR0FBRyxrQkFBa0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsMENBQTBDO0lBQzVDLENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQ3ZDLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLHdCQUF3QjtJQUMvQixJQUFJLENBQUM7UUFDSCxNQUFNLFNBQVMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLEVBQUUsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7UUFFakQsSUFBSSxTQUFTLENBQUMsUUFBUSxLQUFLLE9BQU87WUFBRSxPQUFPLFNBQVMsQ0FBQTtRQUVwRCxPQUFPLGFBQWEsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDMUMsQ0FBQztJQUFDLE1BQU0sQ0FBQztRQUNQLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7QUFDSCxDQUFDO0FBRUQsTUFBTSxDQUFDLE1BQU0sMEJBQTBCLEdBQUcsd0JBQXdCLEVBQUUsQ0FBQTtBQUVwRSxNQUFNLENBQUMsT0FBTyxPQUFPLG9CQUFxQixTQUFRLGdCQUFnQjtJQUNoRTs7Ozs7OztPQU9HO0lBQ0gsTUFBTSxDQUFDLGVBQWUsQ0FBQyxLQUFLLEVBQUUsSUFBSTtRQUNoQyxPQUFPLElBQUksb0JBQW9CLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNwRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLEVBQUUsSUFBSTtRQUN6QyxPQUFPLElBQUksb0JBQW9CLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDLHdCQUF3QixDQUFDLElBQUksQ0FBQyxDQUFBO0lBQzdFLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFlBQVksS0FBSyxFQUFFLElBQUksR0FBRyxFQUFFO1FBQzFCLEtBQUssQ0FBQyxLQUFLLEVBQUU7WUFDWCxHQUFHLElBQUk7WUFDUCx3QkFBd0IsRUFBRSxJQUFJLENBQUMsd0JBQXdCLElBQUksMEJBQTBCO1NBQ3RGLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFja3RyYWNlQ2xlYW5lciBmcm9tIFwiLi9iYWNrdHJhY2UtY2xlYW5lci5qc1wiXG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIFBhdGggb3IgZmlsZSBVUkwuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgcGF0aC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUGF0aCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgbGV0IG5vcm1hbGl6ZWQgPSB2YWx1ZVxuXG4gIGlmIChub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJmaWxlOi8vXCIpKSB7XG4gICAgdHJ5IHtcbiAgICAgIG5vcm1hbGl6ZWQgPSBuZXcgVVJMKG5vcm1hbGl6ZWQpLnBhdGhuYW1lXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBLZWVwIG9yaWdpbmFsIHZhbHVlIHdoZW4gVVJMIHBhcnNpbmcgZmFpbHMuXG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBub3JtYWxpemVkID0gZGVjb2RlVVJJQ29tcG9uZW50KG5vcm1hbGl6ZWQpXG4gIH0gY2F0Y2gge1xuICAgIC8vIEtlZXAgZW5jb2RlZCB2YWx1ZSB3aGVuIGRlY29kaW5nIGZhaWxzLlxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWQucmVwbGFjZSgvXFxcXC9nLCBcIi9cIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyYW1ld29yayBzb3VyY2UgZGlyZWN0b3J5LlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgVmVsb2Npb3VzIHNvdXJjZSBkaXJlY3RvcnkgZm9yIE5vZGUgcnVudGltZXMuXG4gKi9cbmZ1bmN0aW9uIGZyYW1ld29ya1NvdXJjZURpcmVjdG9yeSgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzb3VyY2VVcmwgPSBuZXcgVVJMKFwiLi4vXCIsIGltcG9ydC5tZXRhLnVybClcblxuICAgIGlmIChzb3VyY2VVcmwucHJvdG9jb2wgIT09IFwiZmlsZTpcIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgoc291cmNlVXJsLnBhdGhuYW1lKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IEZSQU1FV09SS19TT1VSQ0VfRElSRUNUT1JZID0gZnJhbWV3b3JrU291cmNlRGlyZWN0b3J5KClcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTm9kZUJhY2t0cmFjZUNsZWFuZXIgZXh0ZW5kcyBCYWNrdHJhY2VDbGVhbmVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNsZWFuZWQgc3RhY2suXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFthcmdzLmZyYW1ld29ya1NvdXJjZURpcmVjdG9yeV0gLSBEaXJlY3RvcnkgZm9yIFZlbG9jaW91cyBpbnRlcm5hbHMgdG8gc2tpcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pbmNsdWRlRXJyb3JIZWFkZXJdIC0gV2hldGhlciB0byBpbmNsdWRlIHRoZSBgRXJyb3I6IC4uLmAgaGVhZGVyIGxpbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGNsZWFuZWQgc3RhY2suXG4gICAqL1xuICBzdGF0aWMgZ2V0Q2xlYW5lZFN0YWNrKGVycm9yLCBhcmdzKSB7XG4gICAgcmV0dXJuIG5ldyBOb2RlQmFja3RyYWNlQ2xlYW5lcihlcnJvciwgYXJncykuZ2V0Q2xlYW5lZFN0YWNrKGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXBwbGljYXRpb24gc291cmNlIGxpbmUuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFwcGxpY2F0aW9uRGlyZWN0b3J5IC0gQXBwbGljYXRpb24gZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW2FyZ3MuZnJhbWV3b3JrU291cmNlRGlyZWN0b3J5XSAtIERpcmVjdG9yeSBmb3IgVmVsb2Npb3VzIGludGVybmFscyB0byBza2lwLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFNvdXJjZSBsaW5lIGZvciB0aGUgZmlyc3QgYXBwbGljYXRpb24gZnJhbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0QXBwbGljYXRpb25Tb3VyY2VMaW5lKGVycm9yLCBhcmdzKSB7XG4gICAgcmV0dXJuIG5ldyBOb2RlQmFja3RyYWNlQ2xlYW5lcihlcnJvciwgYXJncykuZ2V0QXBwbGljYXRpb25Tb3VyY2VMaW5lKGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW2FyZ3MuZnJhbWV3b3JrU291cmNlRGlyZWN0b3J5XSAtIERpcmVjdG9yeSBmb3IgVmVsb2Npb3VzIGludGVybmFscyB0byBza2lwLlxuICAgKi9cbiAgY29uc3RydWN0b3IoZXJyb3IsIGFyZ3MgPSB7fSkge1xuICAgIHN1cGVyKGVycm9yLCB7XG4gICAgICAuLi5hcmdzLFxuICAgICAgZnJhbWV3b3JrU291cmNlRGlyZWN0b3J5OiBhcmdzLmZyYW1ld29ya1NvdXJjZURpcmVjdG9yeSB8fCBGUkFNRVdPUktfU09VUkNFX0RJUkVDVE9SWVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==
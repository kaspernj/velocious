// @ts-check
import { discoverTestFiles, lineFiltersFromCandidates } from "@velocious/testing/node";
import restArgsError from "../utils/rest-args-error.js";
const VELOCIOUS_NODE_TEST_PATTERN = /(?<!\.browser)-(?:spec|test)\.(?:m)?js$/u;
/** Compatibility facade for Velocious's published test-file finder path. */
export default class TestFilesFinder {
    /**
     * Creates a Velocious-compatible package discovery adapter.
     * @param {object} args - Discovery options.
     * @param {string} args.directory - Discovery base directory.
     * @param {string[]} [args.directories] - Default directories.
     * @param {RegExp} [args.filePattern] - Test-file pattern override.
     * @param {string[]} args.processArgs - Process arguments including the command name.
     */
    constructor({ directory, directories, filePattern, processArgs, ...restArgs }) {
        restArgsError(restArgs);
        this.directory = directory;
        this.directories = directories;
        this.filePattern = filePattern;
        this.candidates = processArgs.slice(1).filter((argument) => argument !== "--");
        /** @type {Record<string, number[]>} */
        this.lineFiltersByFile = lineFiltersFromCandidates({
            cwd: directory,
            candidates: this.candidates
        });
    }
    /**
     * Discovers test files through the package implementation.
     * @returns {Promise<string[]>} - Discovered absolute file paths.
     */
    async findTestFiles() {
        return await discoverTestFiles({
            cwd: this.directory,
            candidates: this.candidates,
            directories: this.directories,
            filePattern: this.filePattern || VELOCIOUS_NODE_TEST_PATTERN
        });
    }
    /**
     * Gets candidate-derived line filters.
     * @returns {Record<string, number[]>} - Line filters keyed by absolute file path.
     */
    getLineFiltersByFile() { return this.lineFiltersByFile; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1maWxlcy1maW5kZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LWZpbGVzLWZpbmRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUNMLGlCQUFpQixFQUNqQix5QkFBeUIsRUFDMUIsTUFBTSx5QkFBeUIsQ0FBQTtBQUVoQyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RCxNQUFNLDJCQUEyQixHQUFHLDBDQUEwQyxDQUFBO0FBRTlFLDRFQUE0RTtBQUM1RSxNQUFNLENBQUMsT0FBTyxPQUFPLGVBQWU7SUFDbEM7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDekUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBQzFCLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFBO1FBQzlCLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFBO1FBQzlCLElBQUksQ0FBQyxVQUFVLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLEVBQUUsRUFBRSxDQUFDLFFBQVEsS0FBSyxJQUFJLENBQUMsQ0FBQTtRQUM5RSx1Q0FBdUM7UUFDdkMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLHlCQUF5QixDQUFDO1lBQ2pELEdBQUcsRUFBRSxTQUFTO1lBQ2QsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO1NBQzVCLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsYUFBYTtRQUNqQixPQUFPLE1BQU0saUJBQWlCLENBQUM7WUFDN0IsR0FBRyxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ25CLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUMzQixXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7WUFDN0IsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLElBQUksMkJBQTJCO1NBQzdELENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxvQkFBb0IsS0FBSyxPQUFPLElBQUksQ0FBQyxpQkFBaUIsQ0FBQSxDQUFDLENBQUM7Q0FDekQiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtcbiAgZGlzY292ZXJUZXN0RmlsZXMsXG4gIGxpbmVGaWx0ZXJzRnJvbUNhbmRpZGF0ZXNcbn0gZnJvbSBcIkB2ZWxvY2lvdXMvdGVzdGluZy9ub2RlXCJcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmNvbnN0IFZFTE9DSU9VU19OT0RFX1RFU1RfUEFUVEVSTiA9IC8oPzwhXFwuYnJvd3NlciktKD86c3BlY3x0ZXN0KVxcLig/Om0pP2pzJC91XG5cbi8qKiBDb21wYXRpYmlsaXR5IGZhY2FkZSBmb3IgVmVsb2Npb3VzJ3MgcHVibGlzaGVkIHRlc3QtZmlsZSBmaW5kZXIgcGF0aC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RGaWxlc0ZpbmRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgVmVsb2Npb3VzLWNvbXBhdGlibGUgcGFja2FnZSBkaXNjb3ZlcnkgYWRhcHRlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBEaXNjb3Zlcnkgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGlyZWN0b3J5IC0gRGlzY292ZXJ5IGJhc2UgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5kaXJlY3Rvcmllc10gLSBEZWZhdWx0IGRpcmVjdG9yaWVzLlxuICAgKiBAcGFyYW0ge1JlZ0V4cH0gW2FyZ3MuZmlsZVBhdHRlcm5dIC0gVGVzdC1maWxlIHBhdHRlcm4gb3ZlcnJpZGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucHJvY2Vzc0FyZ3MgLSBQcm9jZXNzIGFyZ3VtZW50cyBpbmNsdWRpbmcgdGhlIGNvbW1hbmQgbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtkaXJlY3RvcnksIGRpcmVjdG9yaWVzLCBmaWxlUGF0dGVybiwgcHJvY2Vzc0FyZ3MsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgdGhpcy5kaXJlY3RvcnkgPSBkaXJlY3RvcnlcbiAgICB0aGlzLmRpcmVjdG9yaWVzID0gZGlyZWN0b3JpZXNcbiAgICB0aGlzLmZpbGVQYXR0ZXJuID0gZmlsZVBhdHRlcm5cbiAgICB0aGlzLmNhbmRpZGF0ZXMgPSBwcm9jZXNzQXJncy5zbGljZSgxKS5maWx0ZXIoKGFyZ3VtZW50KSA9PiBhcmd1bWVudCAhPT0gXCItLVwiKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyW10+fSAqL1xuICAgIHRoaXMubGluZUZpbHRlcnNCeUZpbGUgPSBsaW5lRmlsdGVyc0Zyb21DYW5kaWRhdGVzKHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgY2FuZGlkYXRlczogdGhpcy5jYW5kaWRhdGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb3ZlcnMgdGVzdCBmaWxlcyB0aHJvdWdoIHRoZSBwYWNrYWdlIGltcGxlbWVudGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gRGlzY292ZXJlZCBhYnNvbHV0ZSBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgZmluZFRlc3RGaWxlcygpIHtcbiAgICByZXR1cm4gYXdhaXQgZGlzY292ZXJUZXN0RmlsZXMoe1xuICAgICAgY3dkOiB0aGlzLmRpcmVjdG9yeSxcbiAgICAgIGNhbmRpZGF0ZXM6IHRoaXMuY2FuZGlkYXRlcyxcbiAgICAgIGRpcmVjdG9yaWVzOiB0aGlzLmRpcmVjdG9yaWVzLFxuICAgICAgZmlsZVBhdHRlcm46IHRoaXMuZmlsZVBhdHRlcm4gfHwgVkVMT0NJT1VTX05PREVfVEVTVF9QQVRURVJOXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIGNhbmRpZGF0ZS1kZXJpdmVkIGxpbmUgZmlsdGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gLSBMaW5lIGZpbHRlcnMga2V5ZWQgYnkgYWJzb2x1dGUgZmlsZSBwYXRoLlxuICAgKi9cbiAgZ2V0TGluZUZpbHRlcnNCeUZpbGUoKSB7IHJldHVybiB0aGlzLmxpbmVGaWx0ZXJzQnlGaWxlIH1cbn1cbiJdfQ==
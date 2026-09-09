// @ts-check
import fs from "fs/promises";
import path from "path";
import fileExists from "../utils/file-exists.js";
import Logger from "../logger.js";
import restArgsError from "../utils/rest-args-error.js";
// Incredibly complex class to find files in multiple simultanious running promises to do it as fast as possible.
export default class TestFilesFinder {
    static IGNORED_NAMES = [".git", "node_modules"];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.directory - Directory path.
     * @param {string[]} [args.directories] - Directories.
     * @param {string[]} args.processArgs - Process args.
     */
    constructor({ directory, directories, processArgs, ...restArgs }) {
        restArgsError(restArgs);
        this.directory = path.resolve(directory);
        this.logger = new Logger(this);
        if (directories) {
            this.directories = directories.map((entry) => path.resolve(entry));
        }
        else {
            this.directories = [
                `${this.directory}/__tests__`,
                `${this.directory}/tests`,
                `${this.directory}/spec`
            ];
        }
        this.findingCount = 0;
        this.processArgs = processArgs;
        /**
         * Narrows the runtime value to the documented type.
         * @type {string[]} */
        this.foundFiles = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<number, Promise<void>>} */
        this.findingPromises = {};
        /**
         * Narrows the runtime value to the documented type.
         * @type {string[]} */
        this.testArgs = this.processArgs.filter((processArg, index) => index != 0);
        /**
         * Narrows the runtime value to the documented type.
         * @type {string[]} */
        this.directoryArgs = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {string[]} */
        this.directoryFullPaths = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {string[]} */
        this.fileArgs = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {string[]} */
        this.explicitFiles = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, number[]>} */
        this.lineFiltersByFile = {};
        this._argsPrepared = false;
    }
    /**
     * Runs find test files.
     * @returns {Promise<string[]>} - Resolves with the test files.
     */
    async findTestFiles() {
        await this.prepareArgs();
        if (this.explicitFiles.length > 0 && this.directoryArgs.length === 0) {
            return Array.from(new Set(this.explicitFiles));
        }
        await this.withFindingCount(async () => {
            const hasExplicitArgs = this.directoryFullPaths.length > 0 || this.fileArgs.length > 0;
            const directoriesToScan = hasExplicitArgs ? this.directoryFullPaths : this.directories;
            for (const directory of directoriesToScan) {
                if (await fileExists(directory)) {
                    await this.findTestFilesInDir(directory);
                }
            }
        });
        await this.waitForFindingPromises();
        if (this.explicitFiles.length > 0) {
            this.foundFiles.push(...this.explicitFiles);
        }
        return Array.from(new Set(this.foundFiles));
    }
    /**
     * Runs get line filters by file.
     * @returns {Record<string, number[]>} - Line filters by file.
     */
    getLineFiltersByFile() { return this.lineFiltersByFile; }
    /**
     * Runs finding promises length.
     * @returns {number} - The ing promises length.
     */
    findingPromisesLength() { return Object.keys(this.findingPromises).length; }
    async waitForFindingPromises() {
        while (this.findingPromisesLength() > 0) {
            await this.waitForFindingPromisesIteration();
        }
    }
    /**
     * Runs wait for finding promises iteration.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async waitForFindingPromisesIteration() {
        const unfinishedPromises = [];
        for (const findingPromiseId in this.findingPromises) {
            const findingPromise = this.findingPromises[findingPromiseId];
            unfinishedPromises.push(findingPromise);
        }
        await Promise.all(unfinishedPromises);
    }
    /**
     * Runs with finding count.
     * @param {() => Promise<void>} callback - Callback function.
     * @returns {Promise<void>} - Resolves when complete.
     */
    withFindingCount(callback) {
        return new Promise((resolve) => {
            const findingPromise = callback();
            const findingCount = this.findingCount;
            this.findingCount += 1;
            this.findingPromises[findingCount] = findingPromise;
            findingPromise.finally(() => {
                delete this.findingPromises[findingCount];
                resolve(undefined);
            });
        });
    }
    /**
     * Runs find test files in dir.
     * @param {string} dir - Dir.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async findTestFilesInDir(dir) {
        await this.withFindingCount(async () => {
            const files = await fs.readdir(dir);
            for (const file of files) {
                if (TestFilesFinder.IGNORED_NAMES.includes(file)) {
                    continue;
                }
                const fullPath = `${dir}/${file}`;
                const localPath = fullPath.replace(`${this.directory}/`, "");
                const isDir = (await fs.stat(fullPath)).isDirectory();
                if (isDir) {
                    this.findTestFilesInDir(fullPath);
                }
                else {
                    if (this.isFileMatchingRequirements(file, localPath)) {
                        this.foundFiles.push(fullPath);
                    }
                }
            }
        });
    }
    /**
     * Runs is file matching requirements.
     * @param {string} file - File.
     * @param {string} localPath - Local path.
     * @returns {boolean} - Whether file matching requirements.
     */
    isFileMatchingRequirements(file, localPath) {
        if (this.directoryArgs.length > 0) {
            for (const directoryArg of this.directoryArgs) {
                if (localPath.startsWith(directoryArg) && this.looksLikeTestFile(file)) {
                    this.logger.debug("Found test file because matching dir and looks like this file:", file);
                    return true;
                }
            }
        }
        if (this.fileArgs.length > 0) {
            for (const fileArg of this.fileArgs) {
                if (fileArg == localPath) {
                    this.logger.debug("Found test file because matching file arg:", file);
                    return true;
                }
            }
        }
        if (this.fileArgs.length == 0 && this.directoryArgs.length == 0 && this.looksLikeTestFile(file)) {
            this.logger.debug("Found test file because looks like this file:", file);
            return true;
        }
        return false;
    }
    /**
     * Runs looks like test file.
     * @param {string} file - File.
     * @returns {boolean} - Whether looks like test file.
     */
    looksLikeTestFile(file) {
        return Boolean(file.match(/-(spec|test)\.(m|)js$/));
    }
    /**
     * Runs prepare args.
     * @returns {Promise<void>} - Resolves when test args are prepared.
     */
    async prepareArgs() {
        if (this._argsPrepared)
            return;
        for (const testArg of this.testArgs) {
            if (testArg === "--")
                continue;
            const { cleanArg, line } = this.splitLineArg(testArg);
            const forceDirectory = testArg.endsWith("/") || testArg.endsWith(path.sep);
            const fullPath = path.isAbsolute(cleanArg) ? cleanArg : path.resolve(this.directory, cleanArg);
            const baseName = path.basename(this.directory);
            const hasBasePrefix = cleanArg === baseName || cleanArg.startsWith(`${baseName}/`) || cleanArg.startsWith(`${baseName}${path.sep}`);
            const basePrefixedFullPath = (!path.isAbsolute(cleanArg) && hasBasePrefix) ? path.resolve(path.dirname(this.directory), cleanArg) : null;
            const fullPathCandidates = basePrefixedFullPath ? [basePrefixedFullPath] : [fullPath];
            if (forceDirectory) {
                const preferredLocalPath = this.toLocalPath(basePrefixedFullPath || fullPath);
                this.directoryArgs.push(this.ensureTrailingSlash(preferredLocalPath));
                this.directoryFullPaths.push(path.resolve(basePrefixedFullPath || fullPath));
                continue;
            }
            try {
                let stats;
                let resolvedFullPath;
                for (const candidatePath of fullPathCandidates) {
                    try {
                        stats = await fs.stat(candidatePath);
                        resolvedFullPath = candidatePath;
                        break;
                    }
                    catch {
                        // Keep searching
                    }
                }
                if (!stats || !resolvedFullPath)
                    throw new Error("Path not found");
                const localPath = this.toLocalPath(resolvedFullPath);
                if (stats.isDirectory()) {
                    this.directoryArgs.push(this.ensureTrailingSlash(localPath));
                    this.directoryFullPaths.push(resolvedFullPath);
                }
                else if (stats.isFile()) {
                    this.fileArgs.push(localPath);
                    this.explicitFiles.push(resolvedFullPath);
                    if (line) {
                        this.addLineFilter(resolvedFullPath, line);
                    }
                }
            }
            catch {
                const fallbackLocalPath = this.toLocalPath(basePrefixedFullPath || fullPath);
                this.fileArgs.push(fallbackLocalPath);
                if (line) {
                    this.addLineFilter(basePrefixedFullPath || fullPath, line);
                }
            }
        }
        this._argsPrepared = true;
    }
    /**
     * Runs add line filter.
     * @param {string} filePath - File path.
     * @param {number} line - Line number.
     * @returns {void} - No return value.
     */
    addLineFilter(filePath, line) {
        const fullPath = path.resolve(filePath);
        if (!this.lineFiltersByFile[fullPath]) {
            this.lineFiltersByFile[fullPath] = [];
        }
        if (!this.lineFiltersByFile[fullPath].includes(line)) {
            this.lineFiltersByFile[fullPath].push(line);
        }
    }
    /**
     * Runs split line arg.
     * @param {string} testArg - Test arg.
     * @returns {{cleanArg: string, line?: number}} - Cleaned arg and line.
     */
    splitLineArg(testArg) {
        const match = testArg.match(/^(.*):(\d+)$/);
        if (!match) {
            return { cleanArg: testArg };
        }
        const line = Number(match[2]);
        if (!Number.isFinite(line)) {
            return { cleanArg: testArg };
        }
        return { cleanArg: match[1], line };
    }
    /**
     * Runs ensure trailing slash.
     * @param {string} localPath - Local path.
     * @returns {string} - Normalized local path with trailing slash.
     */
    ensureTrailingSlash(localPath) {
        if (localPath === "")
            return localPath;
        return localPath.endsWith("/") ? localPath : `${localPath}/`;
    }
    /**
     * Runs to local path.
     * @param {string} fullPath - Full path.
     * @returns {string} - Local path relative to the base directory.
     */
    toLocalPath(fullPath) {
        const relativePath = path.relative(this.directory, fullPath);
        return relativePath.split(path.sep).join("/");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1maWxlcy1maW5kZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LWZpbGVzLWZpbmRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sSUFBSSxNQUFNLE1BQU0sQ0FBQTtBQUV2QixPQUFPLFVBQVUsTUFBTSx5QkFBeUIsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFFdkQsaUhBQWlIO0FBQ2pILE1BQU0sQ0FBQyxPQUFPLE9BQU8sZUFBZTtJQUNsQyxNQUFNLENBQUMsYUFBYSxHQUFHLENBQUMsTUFBTSxFQUFFLGNBQWMsQ0FBQyxDQUFBO0lBRS9DOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUM1RCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ3hDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFOUIsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUNwRSxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxXQUFXLEdBQUc7Z0JBQ2pCLEdBQUcsSUFBSSxDQUFDLFNBQVMsWUFBWTtnQkFDN0IsR0FBRyxJQUFJLENBQUMsU0FBUyxRQUFRO2dCQUN6QixHQUFHLElBQUksQ0FBQyxT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UUFDbEIsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUUzQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWCxPQUFPLEVBQUMsUUFBUSxFQUFFLE9BQU8sRUFBQyxDQUFBO1FBQzVCLENBQUM7UUFFRCxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFN0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUMzQixPQUFPLEVBQUMsUUFBUSxFQUFFLE9BQU8sRUFBQyxDQUFBO1FBQzVCLENBQUM7UUFFRCxPQUFPLEVBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUMsQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG1CQUFtQixDQUFDLFNBQVM7UUFDM0IsSUFBSSxTQUFTLEtBQUssRUFBRTtZQUFFLE9BQU8sU0FBUyxDQUFBO1FBQ3RDLE9BQU8sU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxHQUFHLFNBQVMsR0FBRyxDQUFBO0lBQzlELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsV0FBVyxDQUFDLFFBQVE7UUFDbEIsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQzVELE9BQU8sWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQy9DLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCJcblxuaW1wb3J0IGZpbGVFeGlzdHMgZnJvbSBcIi4uL3V0aWxzL2ZpbGUtZXhpc3RzLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuLy8gSW5jcmVkaWJseSBjb21wbGV4IGNsYXNzIHRvIGZpbmQgZmlsZXMgaW4gbXVsdGlwbGUgc2ltdWx0YW5pb3VzIHJ1bm5pbmcgcHJvbWlzZXMgdG8gZG8gaXQgYXMgZmFzdCBhcyBwb3NzaWJsZS5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RGaWxlc0ZpbmRlciB7XG4gIHN0YXRpYyBJR05PUkVEX05BTUVTID0gW1wiLmdpdFwiLCBcIm5vZGVfbW9kdWxlc1wiXVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kaXJlY3RvcnkgLSBEaXJlY3RvcnkgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3MuZGlyZWN0b3JpZXNdIC0gRGlyZWN0b3JpZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucHJvY2Vzc0FyZ3MgLSBQcm9jZXNzIGFyZ3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZGlyZWN0b3J5LCBkaXJlY3RvcmllcywgcHJvY2Vzc0FyZ3MsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLmRpcmVjdG9yeSA9IHBhdGgucmVzb2x2ZShkaXJlY3RvcnkpXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG5cbiAgICBpZiAoZGlyZWN0b3JpZXMpIHtcbiAgICAgIHRoaXMuZGlyZWN0b3JpZXMgPSBkaXJlY3Rvcmllcy5tYXAoKGVudHJ5KSA9PiBwYXRoLnJlc29sdmUoZW50cnkpKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmRpcmVjdG9yaWVzID0gW1xuICAgICAgICBgJHt0aGlzLmRpcmVjdG9yeX0vX190ZXN0c19fYCxcbiAgICAgICAgYCR7dGhpcy5kaXJlY3Rvcnl9L3Rlc3RzYCxcbiAgICAgICAgYCR7dGhpcy5kaXJlY3Rvcnl9L3NwZWNgXG4gICAgICBdXG4gICAgfVxuXG4gICAgdGhpcy5maW5kaW5nQ291bnQgPSAwXG4gICAgdGhpcy5wcm9jZXNzQXJncyA9IHByb2Nlc3NBcmdzXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIHRoaXMuZm91bmRGaWxlcyA9IFtdXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxudW1iZXIsIFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuZmluZGluZ1Byb21pc2VzID0ge31cblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgdGhpcy50ZXN0QXJncyA9IHRoaXMucHJvY2Vzc0FyZ3MuZmlsdGVyKChwcm9jZXNzQXJnLCBpbmRleCkgPT4gaW5kZXggIT0gMClcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgdGhpcy5kaXJlY3RvcnlBcmdzID0gW11cblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgdGhpcy5kaXJlY3RvcnlGdWxsUGF0aHMgPSBbXVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICB0aGlzLmZpbGVBcmdzID0gW11cblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgdGhpcy5leHBsaWNpdEZpbGVzID0gW11cblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyW10+fSAqL1xuICAgIHRoaXMubGluZUZpbHRlcnNCeUZpbGUgPSB7fVxuXG4gICAgdGhpcy5fYXJnc1ByZXBhcmVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgdGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRlc3QgZmlsZXMuXG4gICAqL1xuICBhc3luYyBmaW5kVGVzdEZpbGVzKCkge1xuICAgIGF3YWl0IHRoaXMucHJlcGFyZUFyZ3MoKVxuXG4gICAgaWYgKHRoaXMuZXhwbGljaXRGaWxlcy5sZW5ndGggPiAwICYmIHRoaXMuZGlyZWN0b3J5QXJncy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBBcnJheS5mcm9tKG5ldyBTZXQodGhpcy5leHBsaWNpdEZpbGVzKSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLndpdGhGaW5kaW5nQ291bnQoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaGFzRXhwbGljaXRBcmdzID0gdGhpcy5kaXJlY3RvcnlGdWxsUGF0aHMubGVuZ3RoID4gMCB8fCB0aGlzLmZpbGVBcmdzLmxlbmd0aCA+IDBcbiAgICAgIGNvbnN0IGRpcmVjdG9yaWVzVG9TY2FuID0gaGFzRXhwbGljaXRBcmdzID8gdGhpcy5kaXJlY3RvcnlGdWxsUGF0aHMgOiB0aGlzLmRpcmVjdG9yaWVzXG5cbiAgICAgIGZvciAoY29uc3QgZGlyZWN0b3J5IG9mIGRpcmVjdG9yaWVzVG9TY2FuKSB7XG4gICAgICAgIGlmIChhd2FpdCBmaWxlRXhpc3RzKGRpcmVjdG9yeSkpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmZpbmRUZXN0RmlsZXNJbkRpcihkaXJlY3RvcnkpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy53YWl0Rm9yRmluZGluZ1Byb21pc2VzKClcblxuICAgIGlmICh0aGlzLmV4cGxpY2l0RmlsZXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5mb3VuZEZpbGVzLnB1c2goLi4udGhpcy5leHBsaWNpdEZpbGVzKVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5mcm9tKG5ldyBTZXQodGhpcy5mb3VuZEZpbGVzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsaW5lIGZpbHRlcnMgYnkgZmlsZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gLSBMaW5lIGZpbHRlcnMgYnkgZmlsZS5cbiAgICovXG4gIGdldExpbmVGaWx0ZXJzQnlGaWxlKCkgeyByZXR1cm4gdGhpcy5saW5lRmlsdGVyc0J5RmlsZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZGluZyBwcm9taXNlcyBsZW5ndGguXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGluZyBwcm9taXNlcyBsZW5ndGguXG4gICAqL1xuICBmaW5kaW5nUHJvbWlzZXNMZW5ndGgoKSB7IHJldHVybiBPYmplY3Qua2V5cyh0aGlzLmZpbmRpbmdQcm9taXNlcykubGVuZ3RoIH1cblxuICBhc3luYyB3YWl0Rm9yRmluZGluZ1Byb21pc2VzKCkge1xuICAgIHdoaWxlICh0aGlzLmZpbmRpbmdQcm9taXNlc0xlbmd0aCgpID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yRmluZGluZ1Byb21pc2VzSXRlcmF0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0IGZvciBmaW5kaW5nIHByb21pc2VzIGl0ZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JGaW5kaW5nUHJvbWlzZXNJdGVyYXRpb24oKSB7XG4gICAgY29uc3QgdW5maW5pc2hlZFByb21pc2VzID0gW11cblxuICAgIGZvciAoY29uc3QgZmluZGluZ1Byb21pc2VJZCBpbiB0aGlzLmZpbmRpbmdQcm9taXNlcykge1xuICAgICAgY29uc3QgZmluZGluZ1Byb21pc2UgPSB0aGlzLmZpbmRpbmdQcm9taXNlc1tmaW5kaW5nUHJvbWlzZUlkXVxuXG4gICAgICB1bmZpbmlzaGVkUHJvbWlzZXMucHVzaChmaW5kaW5nUHJvbWlzZSlcbiAgICB9XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbCh1bmZpbmlzaGVkUHJvbWlzZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGZpbmRpbmcgY291bnQuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIHdpdGhGaW5kaW5nQ291bnQoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNvbnN0IGZpbmRpbmdQcm9taXNlID0gY2FsbGJhY2soKVxuICAgICAgY29uc3QgZmluZGluZ0NvdW50ID0gdGhpcy5maW5kaW5nQ291bnRcblxuICAgICAgdGhpcy5maW5kaW5nQ291bnQgKz0gMVxuICAgICAgdGhpcy5maW5kaW5nUHJvbWlzZXNbZmluZGluZ0NvdW50XSA9IGZpbmRpbmdQcm9taXNlXG5cbiAgICAgIGZpbmRpbmdQcm9taXNlLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy5maW5kaW5nUHJvbWlzZXNbZmluZGluZ0NvdW50XVxuXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCB0ZXN0IGZpbGVzIGluIGRpci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpciAtIERpci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGZpbmRUZXN0RmlsZXNJbkRpcihkaXIpIHtcbiAgICBhd2FpdCB0aGlzLndpdGhGaW5kaW5nQ291bnQoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsZXMgPSBhd2FpdCBmcy5yZWFkZGlyKGRpcilcblxuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICAgIGlmIChUZXN0RmlsZXNGaW5kZXIuSUdOT1JFRF9OQU1FUy5pbmNsdWRlcyhmaWxlKSkge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBmdWxsUGF0aCA9IGAke2Rpcn0vJHtmaWxlfWBcbiAgICAgICAgY29uc3QgbG9jYWxQYXRoID0gZnVsbFBhdGgucmVwbGFjZShgJHt0aGlzLmRpcmVjdG9yeX0vYCwgXCJcIilcbiAgICAgICAgY29uc3QgaXNEaXIgPSAoYXdhaXQgZnMuc3RhdChmdWxsUGF0aCkpLmlzRGlyZWN0b3J5KClcblxuICAgICAgICBpZiAoaXNEaXIpIHtcbiAgICAgICAgICB0aGlzLmZpbmRUZXN0RmlsZXNJbkRpcihmdWxsUGF0aClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAodGhpcy5pc0ZpbGVNYXRjaGluZ1JlcXVpcmVtZW50cyhmaWxlLCBsb2NhbFBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLmZvdW5kRmlsZXMucHVzaChmdWxsUGF0aClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZmlsZSBtYXRjaGluZyByZXF1aXJlbWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlIC0gRmlsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsUGF0aCAtIExvY2FsIHBhdGguXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZmlsZSBtYXRjaGluZyByZXF1aXJlbWVudHMuXG4gICAqL1xuICBpc0ZpbGVNYXRjaGluZ1JlcXVpcmVtZW50cyhmaWxlLCBsb2NhbFBhdGgpIHtcbiAgICBpZiAodGhpcy5kaXJlY3RvcnlBcmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAoY29uc3QgZGlyZWN0b3J5QXJnIG9mIHRoaXMuZGlyZWN0b3J5QXJncykge1xuICAgICAgICBpZiAobG9jYWxQYXRoLnN0YXJ0c1dpdGgoZGlyZWN0b3J5QXJnKSAmJiB0aGlzLmxvb2tzTGlrZVRlc3RGaWxlKGZpbGUpKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJGb3VuZCB0ZXN0IGZpbGUgYmVjYXVzZSBtYXRjaGluZyBkaXIgYW5kIGxvb2tzIGxpa2UgdGhpcyBmaWxlOlwiLCBmaWxlKVxuICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5maWxlQXJncy5sZW5ndGggPiAwKSB7XG4gICAgICBmb3IgKGNvbnN0IGZpbGVBcmcgb2YgdGhpcy5maWxlQXJncykge1xuICAgICAgICBpZiAoZmlsZUFyZyA9PSBsb2NhbFBhdGgpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkZvdW5kIHRlc3QgZmlsZSBiZWNhdXNlIG1hdGNoaW5nIGZpbGUgYXJnOlwiLCBmaWxlKVxuICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5maWxlQXJncy5sZW5ndGggPT0gMCAmJiB0aGlzLmRpcmVjdG9yeUFyZ3MubGVuZ3RoID09IDAgJiYgdGhpcy5sb29rc0xpa2VUZXN0RmlsZShmaWxlKSkge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJGb3VuZCB0ZXN0IGZpbGUgYmVjYXVzZSBsb29rcyBsaWtlIHRoaXMgZmlsZTpcIiwgZmlsZSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb29rcyBsaWtlIHRlc3QgZmlsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGUgLSBGaWxlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGxvb2tzIGxpa2UgdGVzdCBmaWxlLlxuICAgKi9cbiAgbG9va3NMaWtlVGVzdEZpbGUoZmlsZSkge1xuICAgIHJldHVybiBCb29sZWFuKGZpbGUubWF0Y2goLy0oc3BlY3x0ZXN0KVxcLihtfClqcyQvKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZXBhcmUgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0ZXN0IGFyZ3MgYXJlIHByZXBhcmVkLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZUFyZ3MoKSB7XG4gICAgaWYgKHRoaXMuX2FyZ3NQcmVwYXJlZCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHRlc3RBcmcgb2YgdGhpcy50ZXN0QXJncykge1xuICAgICAgaWYgKHRlc3RBcmcgPT09IFwiLS1cIikgY29udGludWVcblxuICAgICAgY29uc3Qge2NsZWFuQXJnLCBsaW5lfSA9IHRoaXMuc3BsaXRMaW5lQXJnKHRlc3RBcmcpXG4gICAgICBjb25zdCBmb3JjZURpcmVjdG9yeSA9IHRlc3RBcmcuZW5kc1dpdGgoXCIvXCIpIHx8IHRlc3RBcmcuZW5kc1dpdGgocGF0aC5zZXApXG4gICAgICBjb25zdCBmdWxsUGF0aCA9IHBhdGguaXNBYnNvbHV0ZShjbGVhbkFyZykgPyBjbGVhbkFyZyA6IHBhdGgucmVzb2x2ZSh0aGlzLmRpcmVjdG9yeSwgY2xlYW5BcmcpXG4gICAgICBjb25zdCBiYXNlTmFtZSA9IHBhdGguYmFzZW5hbWUodGhpcy5kaXJlY3RvcnkpXG4gICAgICBjb25zdCBoYXNCYXNlUHJlZml4ID0gY2xlYW5BcmcgPT09IGJhc2VOYW1lIHx8IGNsZWFuQXJnLnN0YXJ0c1dpdGgoYCR7YmFzZU5hbWV9L2ApIHx8IGNsZWFuQXJnLnN0YXJ0c1dpdGgoYCR7YmFzZU5hbWV9JHtwYXRoLnNlcH1gKVxuICAgICAgY29uc3QgYmFzZVByZWZpeGVkRnVsbFBhdGggPSAoIXBhdGguaXNBYnNvbHV0ZShjbGVhbkFyZykgJiYgaGFzQmFzZVByZWZpeCkgPyBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHRoaXMuZGlyZWN0b3J5KSwgY2xlYW5BcmcpIDogbnVsbFxuICAgICAgY29uc3QgZnVsbFBhdGhDYW5kaWRhdGVzID0gYmFzZVByZWZpeGVkRnVsbFBhdGggPyBbYmFzZVByZWZpeGVkRnVsbFBhdGhdIDogW2Z1bGxQYXRoXVxuXG4gICAgICBpZiAoZm9yY2VEaXJlY3RvcnkpIHtcbiAgICAgICAgY29uc3QgcHJlZmVycmVkTG9jYWxQYXRoID0gdGhpcy50b0xvY2FsUGF0aChiYXNlUHJlZml4ZWRGdWxsUGF0aCB8fCBmdWxsUGF0aClcbiAgICAgICAgdGhpcy5kaXJlY3RvcnlBcmdzLnB1c2godGhpcy5lbnN1cmVUcmFpbGluZ1NsYXNoKHByZWZlcnJlZExvY2FsUGF0aCkpXG4gICAgICAgIHRoaXMuZGlyZWN0b3J5RnVsbFBhdGhzLnB1c2gocGF0aC5yZXNvbHZlKGJhc2VQcmVmaXhlZEZ1bGxQYXRoIHx8IGZ1bGxQYXRoKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IHN0YXRzXG4gICAgICAgIGxldCByZXNvbHZlZEZ1bGxQYXRoXG5cbiAgICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGVQYXRoIG9mIGZ1bGxQYXRoQ2FuZGlkYXRlcykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBzdGF0cyA9IGF3YWl0IGZzLnN0YXQoY2FuZGlkYXRlUGF0aClcbiAgICAgICAgICAgIHJlc29sdmVkRnVsbFBhdGggPSBjYW5kaWRhdGVQYXRoXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgLy8gS2VlcCBzZWFyY2hpbmdcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXN0YXRzIHx8ICFyZXNvbHZlZEZ1bGxQYXRoKSB0aHJvdyBuZXcgRXJyb3IoXCJQYXRoIG5vdCBmb3VuZFwiKVxuICAgICAgICBjb25zdCBsb2NhbFBhdGggPSB0aGlzLnRvTG9jYWxQYXRoKHJlc29sdmVkRnVsbFBhdGgpXG5cbiAgICAgICAgaWYgKHN0YXRzLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICB0aGlzLmRpcmVjdG9yeUFyZ3MucHVzaCh0aGlzLmVuc3VyZVRyYWlsaW5nU2xhc2gobG9jYWxQYXRoKSlcbiAgICAgICAgICB0aGlzLmRpcmVjdG9yeUZ1bGxQYXRocy5wdXNoKHJlc29sdmVkRnVsbFBhdGgpXG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdHMuaXNGaWxlKCkpIHtcbiAgICAgICAgICB0aGlzLmZpbGVBcmdzLnB1c2gobG9jYWxQYXRoKVxuICAgICAgICAgIHRoaXMuZXhwbGljaXRGaWxlcy5wdXNoKHJlc29sdmVkRnVsbFBhdGgpXG5cbiAgICAgICAgICBpZiAobGluZSkge1xuICAgICAgICAgICAgdGhpcy5hZGRMaW5lRmlsdGVyKHJlc29sdmVkRnVsbFBhdGgsIGxpbmUpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29uc3QgZmFsbGJhY2tMb2NhbFBhdGggPSB0aGlzLnRvTG9jYWxQYXRoKGJhc2VQcmVmaXhlZEZ1bGxQYXRoIHx8IGZ1bGxQYXRoKVxuICAgICAgICB0aGlzLmZpbGVBcmdzLnB1c2goZmFsbGJhY2tMb2NhbFBhdGgpXG5cbiAgICAgICAgaWYgKGxpbmUpIHtcbiAgICAgICAgICB0aGlzLmFkZExpbmVGaWx0ZXIoYmFzZVByZWZpeGVkRnVsbFBhdGggfHwgZnVsbFBhdGgsIGxpbmUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9hcmdzUHJlcGFyZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgbGluZSBmaWx0ZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGxpbmUgLSBMaW5lIG51bWJlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWRkTGluZUZpbHRlcihmaWxlUGF0aCwgbGluZSkge1xuICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aC5yZXNvbHZlKGZpbGVQYXRoKVxuXG4gICAgaWYgKCF0aGlzLmxpbmVGaWx0ZXJzQnlGaWxlW2Z1bGxQYXRoXSkge1xuICAgICAgdGhpcy5saW5lRmlsdGVyc0J5RmlsZVtmdWxsUGF0aF0gPSBbXVxuICAgIH1cblxuICAgIGlmICghdGhpcy5saW5lRmlsdGVyc0J5RmlsZVtmdWxsUGF0aF0uaW5jbHVkZXMobGluZSkpIHtcbiAgICAgIHRoaXMubGluZUZpbHRlcnNCeUZpbGVbZnVsbFBhdGhdLnB1c2gobGluZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzcGxpdCBsaW5lIGFyZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRlc3RBcmcgLSBUZXN0IGFyZy5cbiAgICogQHJldHVybnMge3tjbGVhbkFyZzogc3RyaW5nLCBsaW5lPzogbnVtYmVyfX0gLSBDbGVhbmVkIGFyZyBhbmQgbGluZS5cbiAgICovXG4gIHNwbGl0TGluZUFyZyh0ZXN0QXJnKSB7XG4gICAgY29uc3QgbWF0Y2ggPSB0ZXN0QXJnLm1hdGNoKC9eKC4qKTooXFxkKykkLylcblxuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHJldHVybiB7Y2xlYW5Bcmc6IHRlc3RBcmd9XG4gICAgfVxuXG4gICAgY29uc3QgbGluZSA9IE51bWJlcihtYXRjaFsyXSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGxpbmUpKSB7XG4gICAgICByZXR1cm4ge2NsZWFuQXJnOiB0ZXN0QXJnfVxuICAgIH1cblxuICAgIHJldHVybiB7Y2xlYW5Bcmc6IG1hdGNoWzFdLCBsaW5lfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHRyYWlsaW5nIHNsYXNoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9jYWxQYXRoIC0gTG9jYWwgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIGxvY2FsIHBhdGggd2l0aCB0cmFpbGluZyBzbGFzaC5cbiAgICovXG4gIGVuc3VyZVRyYWlsaW5nU2xhc2gobG9jYWxQYXRoKSB7XG4gICAgaWYgKGxvY2FsUGF0aCA9PT0gXCJcIikgcmV0dXJuIGxvY2FsUGF0aFxuICAgIHJldHVybiBsb2NhbFBhdGguZW5kc1dpdGgoXCIvXCIpID8gbG9jYWxQYXRoIDogYCR7bG9jYWxQYXRofS9gXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBsb2NhbCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZnVsbFBhdGggLSBGdWxsIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTG9jYWwgcGF0aCByZWxhdGl2ZSB0byB0aGUgYmFzZSBkaXJlY3RvcnkuXG4gICAqL1xuICB0b0xvY2FsUGF0aChmdWxsUGF0aCkge1xuICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHBhdGgucmVsYXRpdmUodGhpcy5kaXJlY3RvcnksIGZ1bGxQYXRoKVxuICAgIHJldHVybiByZWxhdGl2ZVBhdGguc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpXG4gIH1cbn1cbiJdfQ==
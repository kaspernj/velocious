import Logger from "../logger.js";
export default class TestFilesFinder {
    directory: string;
    logger: Logger;
    directories: string[];
    findingCount: number;
    processArgs: string[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {string[]} */
    foundFiles: string[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<number, Promise<void>>} */
    findingPromises: Record<number, Promise<void>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string[]} */
    testArgs: string[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {string[]} */
    directoryArgs: string[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {string[]} */
    directoryFullPaths: string[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {string[]} */
    fileArgs: string[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {string[]} */
    explicitFiles: string[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, number[]>} */
    lineFiltersByFile: Record<string, number[]>;
    _argsPrepared: boolean;
    static IGNORED_NAMES: string[];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.directory - Directory path.
     * @param {string[]} [args.directories] - Directories.
     * @param {string[]} args.processArgs - Process args.
     */
    constructor({ directory, directories, processArgs, ...restArgs }: {
        directory: string;
        directories?: string[];
        processArgs: string[];
    });
    /**
     * Runs find test files.
     * @returns {Promise<string[]>} - Resolves with the test files.
     */
    findTestFiles(): Promise<string[]>;
    /**
     * Runs get line filters by file.
     * @returns {Record<string, number[]>} - Line filters by file.
     */
    getLineFiltersByFile(): Record<string, number[]>;
    /**
     * Runs finding promises length.
     * @returns {number} - The ing promises length.
     */
    findingPromisesLength(): number;
    waitForFindingPromises(): Promise<void>;
    /**
     * Runs wait for finding promises iteration.
     * @returns {Promise<void>} - Resolves when complete.
     */
    waitForFindingPromisesIteration(): Promise<void>;
    /**
     * Runs with finding count.
     * @param {() => Promise<void>} callback - Callback function.
     * @returns {Promise<void>} - Resolves when complete.
     */
    withFindingCount(callback: () => Promise<void>): Promise<void>;
    /**
     * Runs find test files in dir.
     * @param {string} dir - Dir.
     * @returns {Promise<void>} - Resolves when complete.
     */
    findTestFilesInDir(dir: string): Promise<void>;
    /**
     * Runs is file matching requirements.
     * @param {string} file - File.
     * @param {string} localPath - Local path.
     * @returns {boolean} - Whether file matching requirements.
     */
    isFileMatchingRequirements(file: string, localPath: string): boolean;
    /**
     * Runs looks like test file.
     * @param {string} file - File.
     * @returns {boolean} - Whether looks like test file.
     */
    looksLikeTestFile(file: string): boolean;
    /**
     * Runs prepare args.
     * @returns {Promise<void>} - Resolves when test args are prepared.
     */
    prepareArgs(): Promise<void>;
    /**
     * Runs add line filter.
     * @param {string} filePath - File path.
     * @param {number} line - Line number.
     * @returns {void} - No return value.
     */
    addLineFilter(filePath: string, line: number): void;
    /**
     * Runs split line arg.
     * @param {string} testArg - Test arg.
     * @returns {{cleanArg: string, line?: number}} - Cleaned arg and line.
     */
    splitLineArg(testArg: string): {
        cleanArg: string;
        line?: number;
    };
    /**
     * Runs ensure trailing slash.
     * @param {string} localPath - Local path.
     * @returns {string} - Normalized local path with trailing slash.
     */
    ensureTrailingSlash(localPath: string): string;
    /**
     * Runs to local path.
     * @param {string} fullPath - Full path.
     * @returns {string} - Local path relative to the base directory.
     */
    toLocalPath(fullPath: string): string;
}
//# sourceMappingURL=test-files-finder.d.ts.map
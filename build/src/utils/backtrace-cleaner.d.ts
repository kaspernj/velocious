/**
 * ParsedStackFrame type.
 * @typedef {object} ParsedStackFrame
 * @property {string | undefined} methodName - Method/function name from the stack frame.
 * @property {string} sourcePath - File or URL path from the stack frame.
 * @property {number} lineNumber - Source line number.
 * @property {number | undefined} columnNumber - Source column number.
 */
export type ParsedStackFrame = {
    /**
     * - Method/function name from the stack frame.
     */
    methodName: string | undefined;
    /**
     * - File or URL path from the stack frame.
     */
    sourcePath: string;
    /**
     * - Source line number.
     */
    lineNumber: number;
    /**
     * - Source column number.
     */
    columnNumber: number | undefined;
};
export default class BacktraceCleaner {
    error: Error;
    /**
     * Framework source directory.
     * @type {string | undefined} */
    frameworkSourceDirectory: string | undefined;
    /**
     * Runs get cleaned stack.
     * @param {Error} error - Error instance.
     * @param {object} [args] - Options object.
     * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
     * @param {boolean} [args.includeErrorHeader] - Whether to include the `Error: ...` header line.
     * @returns {string | undefined} - The cleaned stack.
     */
    static getCleanedStack(error: Error, args?: {
        frameworkSourceDirectory?: string | undefined;
        includeErrorHeader?: boolean;
    }): string | undefined;
    /**
     * Runs get application source line.
     * @param {Error} error - Error instance.
     * @param {object} args - Options object.
     * @param {string} args.applicationDirectory - Application directory.
     * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
     * @returns {string | undefined} - Source line for the first application frame.
     */
    static getApplicationSourceLine(error: Error, args: {
        applicationDirectory: string;
        frameworkSourceDirectory?: string | undefined;
    }): string | undefined;
    /**
     * Runs constructor.
     * @param {Error} error - Error instance.
     * @param {object} [args] - Options object.
     * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
     */
    constructor(error: Error, { frameworkSourceDirectory }?: {
        frameworkSourceDirectory?: string | undefined;
    });
    /**
     * Runs get cleaned stack.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.includeErrorHeader] - Whether to include the `Error: ...` header line.
     * @returns {string | undefined} - The cleaned stack.
     */
    getCleanedStack({ includeErrorHeader }?: {
        includeErrorHeader?: boolean;
    }): string | undefined;
    /**
     * Runs get cleaned stack lines.
     * @returns {string[] | undefined} - Filtered stack lines.
     */
    getCleanedStackLines(): string[] | undefined;
    /**
     * Runs get application source line.
     * @param {object} args - Options object.
     * @param {string} args.applicationDirectory - Application directory.
     * @returns {string | undefined} - Source line for the first application frame.
     */
    getApplicationSourceLine({ applicationDirectory }: {
        applicationDirectory: string;
    }): string | undefined;
    /**
     * Runs is error header line.
     * @param {string | undefined} line - Backtrace line.
     * @returns {boolean} - True when the line is an error header.
     */
    isErrorHeaderLine(line: string | undefined): boolean;
    /**
     * Runs first application frame.
     * @param {string} applicationDirectory - Normalized application directory.
     * @returns {ParsedStackFrame | undefined} - First app-owned frame.
     */
    _firstApplicationFrame(applicationDirectory: string): ParsedStackFrame | undefined;
    /**
     * Runs framework source path.
     * @param {string} sourcePath - Source path.
     * @returns {boolean} - Whether the path belongs to Velocious internals.
     */
    _frameworkSourcePath(sourcePath: string): boolean;
    /**
     * Runs should keep stack line.
     * @param {string} line - Stack line.
     * @returns {boolean} - Whether to keep the stack line.
     */
    _shouldKeepStackLine(line: string): boolean;
}
//# sourceMappingURL=backtrace-cleaner.d.ts.map
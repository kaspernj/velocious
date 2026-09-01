import BacktraceCleaner from "./backtrace-cleaner.js";
export declare const FRAMEWORK_SOURCE_DIRECTORY: string | undefined;
export default class NodeBacktraceCleaner extends BacktraceCleaner {
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
    constructor(error: Error, args?: {
        frameworkSourceDirectory?: string | undefined;
    });
}
//# sourceMappingURL=backtrace-cleaner-node.d.ts.map
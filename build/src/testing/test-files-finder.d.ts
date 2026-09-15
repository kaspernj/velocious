/** Compatibility facade for Velocious's published test-file finder path. */
export default class TestFilesFinder {
    directory: string;
    directories: string[] | undefined;
    filePattern: RegExp | undefined;
    candidates: string[];
    /** @type {Record<string, number[]>} */
    lineFiltersByFile: Record<string, number[]>;
    /**
     * Creates a Velocious-compatible package discovery adapter.
     * @param {object} args - Discovery options.
     * @param {string} args.directory - Discovery base directory.
     * @param {string[]} [args.directories] - Default directories.
     * @param {RegExp} [args.filePattern] - Test-file pattern override.
     * @param {string[]} args.processArgs - Process arguments including the command name.
     */
    constructor({ directory, directories, filePattern, processArgs, ...restArgs }: {
        directory: string;
        directories?: string[];
        filePattern?: RegExp;
        processArgs: string[];
    });
    /**
     * Discovers test files through the package implementation.
     * @returns {Promise<string[]>} - Discovered absolute file paths.
     */
    findTestFiles(): Promise<string[]>;
    /**
     * Gets candidate-derived line filters.
     * @returns {Record<string, number[]>} - Line filters keyed by absolute file path.
     */
    getLineFiltersByFile(): Record<string, number[]>;
}
//# sourceMappingURL=test-files-finder.d.ts.map
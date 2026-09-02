export type SourcePeerPackage = {
    /**
     * - Removes only this invocation's shim.
     */
    cleanup: () => Promise<void>;
    /**
     * - Whether this invocation created the shim.
     */
    created: boolean;
    /**
     * - Package path used for peer resolution.
     */
    packageDirectory: string;
};
/**
 * Invocation-owned source peer package shim.
 * @typedef {object} SourcePeerPackage
 * @property {() => Promise<void>} cleanup - Removes only this invocation's shim.
 * @property {boolean} created - Whether this invocation created the shim.
 * @property {string} packageDirectory - Package path used for peer resolution.
 */
declare const SOURCE_PEER_SHIM_MARKER_FILE = ".velocious-source-peer-shim";
/**
 * Resolves the Velocious package directory from source or compiled execution.
 * @returns {Promise<string>} - Velocious package directory.
 */
declare function frameworkPackageDirectory(): Promise<string>;
/**
 * Exposes this checkout to published peer packages without loading duplicate
 * classes from generated build output.
 * @param {string} [projectDirectory] - Velocious source checkout.
 * @returns {Promise<SourcePeerPackage>} - Invocation-owned shim handle.
 */
declare function prepareSourcePeerPackage(projectDirectory?: string): Promise<SourcePeerPackage>;
/**
 * Runs work while the source peer package is available.
 * @template Result
 * @param {string} projectDirectory - Velocious source checkout.
 * @param {() => Promise<Result>} callback - Work requiring source peer resolution.
 * @returns {Promise<Result>} - Callback result.
 */
declare function withSourcePeerPackage<Result>(projectDirectory: string, callback: () => Promise<Result>): Promise<Result>;
export { SOURCE_PEER_SHIM_MARKER_FILE, frameworkPackageDirectory, prepareSourcePeerPackage, withSourcePeerPackage };
//# sourceMappingURL=source-peer-package.d.ts.map
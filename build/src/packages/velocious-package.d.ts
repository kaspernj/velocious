/**
 * A Velocious package (engine): an external npm package that contributes data
 * models, frontend-model resources and migrations to a consuming app. The app
 * lists packages in `Configuration({packages: [...]})`; the framework then loads
 * the package's `src/models`, discovers its `src/resources`, runs its
 * `src/database/migrations`, and generates its frontend models into the app.
 */
export default class VelociousPackage {
    _name: string;
    _path: string;
    _modelsPath: string | undefined;
    _resourcesPath: string | undefined;
    _migrationsPath: string | undefined;
    /**
     * Wraps a plain descriptor as a VelociousPackage (or returns it unchanged when
     * it already is one), so packages can be listed without importing this class.
     * @param {VelociousPackage | import("../configuration-types.js").VelociousPackageDescriptor} descriptor - Package or plain descriptor.
     * @returns {VelociousPackage} - The package instance.
     */
    static from(descriptor: VelociousPackage | import("../configuration-types.js").VelociousPackageDescriptor): VelociousPackage;
    /**
     * Derives the containing directory of a module url without Node's `path`/`url`
     * modules, so this class stays safe to import in browser/Expo bundles.
     * @param {string} url - A module url (usually `import.meta.url`).
     * @returns {string} - The directory path that contains the module.
     */
    static _directoryFromUrl(url: string): string;
    /**
     * Runs constructor.
     * @param {import("../configuration-types.js").VelociousPackageDescriptor} args - Package descriptor.
     */
    constructor({ name, url, path, modelsPath, resourcesPath, migrationsPath, ...restArgs }: import("../configuration-types.js").VelociousPackageDescriptor);
    /**
     * Runs get name.
     * @returns {string} - The package name.
     */
    getName(): string;
    /**
     * Runs get path.
     * @returns {string} - The package root directory (the one that contains `src`).
     */
    getPath(): string;
    /**
     * Runs get models path.
     * @returns {string} - The package's models directory.
     */
    getModelsPath(): string;
    /**
     * Runs get resources path.
     * @returns {string} - The package's frontend-model resources directory.
     */
    getResourcesPath(): string;
    /**
     * Runs get migrations path.
     * @returns {string} - The package's migrations directory.
     */
    getMigrationsPath(): string;
    /**
     * Derives the internal backend-project entry the framework appends so the
     * existing resource-discovery + frontend-model generation machinery picks up
     * this package. Generated frontend models are written to the app's output.
     * @param {{frontendModelsOutputPath: string | undefined}} args - The app's frontend-models output path.
     * @returns {import("../configuration-types.js").BackendProjectConfiguration} - The derived backend project.
     */
    toBackendProjectConfiguration({ frontendModelsOutputPath }: {
        frontendModelsOutputPath: string | undefined;
    }): import("../configuration-types.js").BackendProjectConfiguration;
}
//# sourceMappingURL=velocious-package.d.ts.map
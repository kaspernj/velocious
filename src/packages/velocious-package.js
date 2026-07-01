// @ts-check

import {dirname} from "path"
import {fileURLToPath} from "url"

import restArgsError from "../utils/rest-args-error.js"

/**
 * A Velocious package (engine): an external npm package that contributes data
 * models, frontend-model resources and migrations to a consuming app. The app
 * lists packages in `Configuration({packages: [...]})`; the framework then loads
 * the package's `src/models`, discovers its `src/resources`, runs its
 * `src/database/migrations`, and generates its frontend models into the app.
 */
export default class VelociousPackage {
  /**
   * Wraps a plain descriptor as a VelociousPackage (or returns it unchanged when
   * it already is one), so packages can be listed without importing this class.
   * @param {VelociousPackage | import("../configuration-types.js").VelociousPackageDescriptor} descriptor - Package or plain descriptor.
   * @returns {VelociousPackage} - The package instance.
   */
  static from(descriptor) {
    if (descriptor instanceof VelociousPackage) {
      return descriptor
    }

    return new VelociousPackage(descriptor)
  }

  /**
   * Runs constructor.
   * @param {import("../configuration-types.js").VelociousPackageDescriptor} args - Package descriptor.
   */
  constructor({name, url, path, modelsPath, resourcesPath, migrationsPath, ...restArgs}) {
    restArgsError(restArgs)

    if (!name) {
      throw new Error("A velocious package requires a name.")
    }

    if (!path && !url) {
      throw new Error(`Velocious package "${name}" requires a "path" or a "url" (usually import.meta.url).`)
    }

    this._name = name
    this._path = path || dirname(fileURLToPath(/** @type {string} */ (url)))
    this._modelsPath = modelsPath
    this._resourcesPath = resourcesPath
    this._migrationsPath = migrationsPath
  }

  /**
   * Runs get name.
   * @returns {string} - The package name.
   */
  getName() {
    return this._name
  }

  /**
   * Runs get path.
   * @returns {string} - The package root directory (the one that contains `src`).
   */
  getPath() {
    return this._path
  }

  /**
   * Runs get models path.
   * @returns {string} - The package's models directory.
   */
  getModelsPath() {
    return this._modelsPath || `${this._path}/src/models`
  }

  /**
   * Runs get resources path.
   * @returns {string} - The package's frontend-model resources directory.
   */
  getResourcesPath() {
    return this._resourcesPath || `${this._path}/src/resources`
  }

  /**
   * Runs get migrations path.
   * @returns {string} - The package's migrations directory.
   */
  getMigrationsPath() {
    return this._migrationsPath || `${this._path}/src/database/migrations`
  }

  /**
   * Derives the internal backend-project entry the framework appends so the
   * existing resource-discovery + frontend-model generation machinery picks up
   * this package. Generated frontend models are written to the app's output.
   * @param {{frontendModelsOutputPath: string | undefined}} args - The app's frontend-models output path.
   * @returns {import("../configuration-types.js").BackendProjectConfiguration} - The derived backend project.
   */
  toBackendProjectConfiguration({frontendModelsOutputPath}) {
    return {
      frontendModelsOutputPath,
      path: this.getPath()
    }
  }
}

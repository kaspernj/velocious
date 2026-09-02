import {randomUUID} from "node:crypto"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"

/**
 * Invocation-owned source peer package shim.
 * @typedef {object} SourcePeerPackage
 * @property {() => Promise<void>} cleanup - Removes only this invocation's shim.
 * @property {boolean} created - Whether this invocation created the shim.
 * @property {string} packageDirectory - Package path used for peer resolution.
 */

const SOURCE_PEER_SHIM_MARKER_FILE = ".velocious-source-peer-shim"

/**
 * Checks a filesystem error code.
 * @param {unknown} error - Filesystem error.
 * @param {string} code - Expected Node error code.
 * @returns {boolean} - Whether the error has the expected code.
 */
function errorHasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

/**
 * Resolves the Velocious package directory from source or compiled execution.
 * @returns {Promise<string>} - Velocious package directory.
 */
async function frameworkPackageDirectory() {
  const helperDirectory = path.dirname(fileURLToPath(import.meta.url))
  const sourceLayoutDirectory = path.resolve(helperDirectory, "..", "..", "..")

  try {
    await fs.access(path.join(sourceLayoutDirectory, "package.json"))

    return sourceLayoutDirectory
  } catch (error) {
    if (!errorHasCode(error, "ENOENT")) throw error

    return path.dirname(sourceLayoutDirectory)
  }
}

/**
 * Removes an invocation-owned shim asynchronously.
 * @param {object} args - Cleanup ownership.
 * @param {string} args.markerPath - Marker file path.
 * @param {string} args.packageDirectory - Synthetic package directory.
 * @param {string} args.token - Invocation ownership token.
 * @returns {Promise<void>} - Resolves after owned cleanup.
 */
async function cleanupOwnedShim({markerPath, packageDirectory, token}) {
  let marker

  try {
    marker = await fs.readFile(markerPath, "utf8")
  } catch (error) {
    if (errorHasCode(error, "ENOENT")) return

    throw error
  }

  if (marker !== `${token}\n`) return

  await fs.rm(packageDirectory, {recursive: true, force: true})
}

/**
 * Removes an invocation-owned shim during process exit.
 * @param {object} args - Cleanup ownership.
 * @param {string} args.markerPath - Marker file path.
 * @param {string} args.packageDirectory - Synthetic package directory.
 * @param {string} args.token - Invocation ownership token.
 * @returns {void} - No return value.
 */
function cleanupOwnedShimSync({markerPath, packageDirectory, token}) {
  let marker

  try {
    marker = fsSync.readFileSync(markerPath, "utf8")
  } catch (error) {
    if (errorHasCode(error, "ENOENT")) return

    throw error
  }

  if (marker !== `${token}\n`) return

  fsSync.rmSync(packageDirectory, {recursive: true, force: true})
}

/**
 * Exposes this checkout to published peer packages without loading duplicate
 * classes from generated build output.
 * @param {string} [projectDirectory] - Velocious source checkout.
 * @returns {Promise<SourcePeerPackage>} - Invocation-owned shim handle.
 */
async function prepareSourcePeerPackage(projectDirectory) {
  const resolvedProjectDirectory = projectDirectory ?? await frameworkPackageDirectory()
  const nodeModulesDirectory = path.join(resolvedProjectDirectory, "node_modules")
  const packageDirectory = path.join(nodeModulesDirectory, "velocious")

  await fs.mkdir(nodeModulesDirectory, {recursive: true})

  try {
    await fs.mkdir(packageDirectory)
  } catch (error) {
    if (!errorHasCode(error, "EEXIST")) throw error

    return {
      cleanup: async () => {},
      created: false,
      packageDirectory
    }
  }

  const token = randomUUID()
  const markerPath = path.join(packageDirectory, SOURCE_PEER_SHIM_MARKER_FILE)
  const cleanupOnExit = () => cleanupOwnedShimSync({markerPath, packageDirectory, token})
  let cleanupPromise
  const cleanup = () => {
    cleanupPromise ??= cleanupOwnedShim({markerPath, packageDirectory, token})
      .then(() => process.removeListener("exit", cleanupOnExit))

    return cleanupPromise
  }

  try {
    const buildDirectory = path.join(packageDirectory, "build")

    await fs.writeFile(markerPath, `${token}\n`, {encoding: "utf8", flag: "wx"})
    process.once("exit", cleanupOnExit)
    await fs.mkdir(buildDirectory)
    await fs.writeFile(
      path.join(packageDirectory, "package.json"),
      `${JSON.stringify({name: "velocious", private: true, type: "module"}, null, 2)}\n`,
      "utf8"
    )
    await fs.symlink(
      path.join(resolvedProjectDirectory, "src"),
      path.join(buildDirectory, "src"),
      process.platform === "win32" ? "junction" : "dir"
    )
  } catch (error) {
    process.removeListener("exit", cleanupOnExit)
    await fs.rm(packageDirectory, {recursive: true, force: true})
    throw error
  }

  return {cleanup, created: true, packageDirectory}
}

/**
 * Runs work while the source peer package is available.
 * @template Result
 * @param {string} projectDirectory - Velocious source checkout.
 * @param {() => Promise<Result>} callback - Work requiring source peer resolution.
 * @returns {Promise<Result>} - Callback result.
 */
async function withSourcePeerPackage(projectDirectory, callback) {
  const sourcePeerPackage = await prepareSourcePeerPackage(projectDirectory)

  try {
    return await callback()
  } finally {
    await sourcePeerPackage.cleanup()
  }
}

export {SOURCE_PEER_SHIM_MARKER_FILE, frameworkPackageDirectory, prepareSourcePeerPackage, withSourcePeerPackage}

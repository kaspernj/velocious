import {randomUUID} from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * @typedef {object} SourcePeerPackage
 * @property {() => Promise<void>} cleanup - Removes only this invocation's shim.
 * @property {boolean} created - Whether this invocation created the shim.
 * @property {string} packageDirectory - Package path used for peer resolution.
 */

const SOURCE_PEER_SHIM_MARKER_FILE = ".velocious-source-peer-shim"

/**
 * @param {unknown} error - Filesystem error.
 * @param {string} code - Expected Node error code.
 * @returns {boolean} - Whether the error has the expected code.
 */
function errorHasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

/**
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
 * Exposes this checkout to published peer packages without loading duplicate
 * classes from generated build output.
 * @param {string} projectDirectory - Velocious source checkout.
 * @returns {Promise<SourcePeerPackage>} - Invocation-owned shim handle.
 */
async function prepareSourcePeerPackage(projectDirectory) {
  const nodeModulesDirectory = path.join(projectDirectory, "node_modules")
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
  let cleanupPromise
  const cleanup = () => {
    cleanupPromise ??= cleanupOwnedShim({markerPath, packageDirectory, token})

    return cleanupPromise
  }

  try {
    const buildDirectory = path.join(packageDirectory, "build")

    await fs.writeFile(markerPath, `${token}\n`, {encoding: "utf8", flag: "wx"})
    await fs.mkdir(buildDirectory)
    await fs.writeFile(
      path.join(packageDirectory, "package.json"),
      `${JSON.stringify({name: "velocious", private: true, type: "module"}, null, 2)}\n`,
      "utf8"
    )
    await fs.symlink(
      path.join(projectDirectory, "src"),
      path.join(buildDirectory, "src"),
      process.platform === "win32" ? "junction" : "dir"
    )
  } catch (error) {
    await fs.rm(packageDirectory, {recursive: true, force: true})
    throw error
  }

  return {cleanup, created: true, packageDirectory}
}

export {SOURCE_PEER_SHIM_MARKER_FILE, prepareSourcePeerPackage}

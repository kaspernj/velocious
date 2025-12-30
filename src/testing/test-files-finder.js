// @ts-check

import fs from "fs/promises"
import path from "path"

import fileExists from "../utils/file-exists.js"
import {Logger} from "../logger.js"
import restArgsError from "../utils/rest-args-error.js"

// Incredibly complex class to find files in multiple simultanious running promises to do it as fast as possible.
export default class TestFilesFinder {
  static IGNORED_NAMES = [".git", "node_modules"]

  /**
   * @param {object} args - Options object.
   * @param {string} args.directory - Directory path.
   * @param {string[]} [args.directories] - Directories.
   * @param {string[]} args.processArgs - Process args.
   */
  constructor({directory, directories, processArgs, ...restArgs}) {
    restArgsError(restArgs)

    this.directory = path.resolve(directory)
    this.logger = new Logger(this)

    if (directories) {
      this.directories = directories.map((entry) => path.resolve(entry))
    } else {
      this.directories = [
        `${this.directory}/__tests__`,
        `${this.directory}/tests`,
        `${this.directory}/spec`
      ]
    }

    this.findingCount = 0
    this.processArgs = processArgs

    /** @type {string[]} */
    this.foundFiles = []

    /** @type {Record<number, Promise<void>>} */
    this.findingPromises = {}

    /** @type {string[]} */
    this.testArgs = this.processArgs.filter((processArg, index) => index != 0)

    /** @type {string[]} */
    this.directoryArgs = []

    /** @type {string[]} */
    this.fileArgs = []

    /** @type {string[]} */
    this.explicitFiles = []

    this._argsPrepared = false
  }

  /**
   * @returns {Promise<string[]>} - Resolves with the test files.
   */
  async findTestFiles() {
    await this.prepareArgs()

    if (this.explicitFiles.length > 0 && this.directoryArgs.length === 0) {
      return Array.from(new Set(this.explicitFiles))
    }

    await this.withFindingCount(async () => {
      for (const directory of this.directories) {
        if (await fileExists(directory)) {
          await this.findTestFilesInDir(directory)
        }
      }
    })

    await this.waitForFindingPromises()

    if (this.explicitFiles.length > 0) {
      this.foundFiles.push(...this.explicitFiles)
    }

    return Array.from(new Set(this.foundFiles))
  }

  /**
   * @returns {number} - The ing promises length.
   */
  findingPromisesLength() { return Object.keys(this.findingPromises).length }

  async waitForFindingPromises() {
    while (this.findingPromisesLength() > 0) {
      await this.waitForFindingPromisesIteration()
    }
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async waitForFindingPromisesIteration() {
    const unfinishedPromises = []

    for (const findingPromiseId in this.findingPromises) {
      const findingPromise = this.findingPromises[findingPromiseId]

      unfinishedPromises.push(findingPromise)
    }

    await Promise.all(unfinishedPromises)
  }

  /**
   * @param {function() : Promise<void>} callback - Callback function.
   * @returns {Promise<void>} - Resolves when complete.
   */
  withFindingCount(callback) {
    return new Promise((resolve) => {
      const findingPromise = callback()
      const findingCount = this.findingCount

      this.findingCount += 1
      this.findingPromises[findingCount] = findingPromise

      findingPromise.finally(() => {
        delete this.findingPromises[findingCount]

        resolve(undefined)
      })
    })
  }

  /**
   * @param {string} dir - Dir.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async findTestFilesInDir(dir) {
    await this.withFindingCount(async () => {
      const files = await fs.readdir(dir)

      for (const file of files) {
        if (TestFilesFinder.IGNORED_NAMES.includes(file)) {
          continue
        }

        const fullPath = `${dir}/${file}`
        const localPath = fullPath.replace(`${this.directory}/`, "")
        const isDir = (await fs.stat(fullPath)).isDirectory()

        if (isDir) {
          this.findTestFilesInDir(fullPath)
        } else {
          if (this.isFileMatchingRequirements(file, localPath)) {
            this.foundFiles.push(fullPath)
          }
        }
      }
    })
  }

  /**
   * @param {string} file - File.
   * @param {string} localPath - Local path.
   * @returns {boolean} - Whether file matching requirements.
   */
  isFileMatchingRequirements(file, localPath) {
    if (this.directoryArgs.length > 0) {
      for (const directoryArg of this.directoryArgs) {
        if (localPath.startsWith(directoryArg) && this.looksLikeTestFile(file)) {
          this.logger.debug("Found test file because matching dir and looks like this file:", file)
          return true
        }
      }
    }

    if (this.fileArgs.length > 0) {
      for (const fileArg of this.fileArgs) {
        if (fileArg == localPath) {
          this.logger.debug("Found test file because matching file arg:", file)
          return true
        }
      }
    }

    if (this.fileArgs.length == 0 && this.directoryArgs.length == 0 && this.looksLikeTestFile(file)) {
      this.logger.debug("Found test file because looks like this file:", file)
      return true
    }

    return false
  }

  /**
   * @param {string} file - File.
   * @returns {boolean} - Whether looks like test file.
   */
  looksLikeTestFile(file) {
    return Boolean(file.match(/-(spec|test)\.(m|)js$/))
  }

  /**
   * @returns {Promise<void>} - Resolves when test args are prepared.
   */
  async prepareArgs() {
    if (this._argsPrepared) return

    for (const testArg of this.testArgs) {
      if (testArg === "--") continue

      const forceDirectory = testArg.endsWith("/") || testArg.endsWith(path.sep)
      const fullPath = path.isAbsolute(testArg) ? testArg : path.resolve(this.directory, testArg)
      const baseName = path.basename(this.directory)
      const hasBasePrefix = testArg === baseName || testArg.startsWith(`${baseName}/`) || testArg.startsWith(`${baseName}${path.sep}`)
      const basePrefixedFullPath = (!path.isAbsolute(testArg) && hasBasePrefix) ? path.resolve(path.dirname(this.directory), testArg) : null
      const fullPathCandidates = basePrefixedFullPath ? [basePrefixedFullPath] : [fullPath]

      if (forceDirectory) {
        const preferredLocalPath = this.toLocalPath(basePrefixedFullPath || fullPath)
        this.directoryArgs.push(this.ensureTrailingSlash(preferredLocalPath))
        continue
      }

      try {
        let stats
        let resolvedFullPath

        for (const candidatePath of fullPathCandidates) {
          try {
            stats = await fs.stat(candidatePath)
            resolvedFullPath = candidatePath
            break
          } catch {
            // Keep searching
          }
        }

        if (!stats || !resolvedFullPath) throw new Error("Path not found")
        const localPath = this.toLocalPath(resolvedFullPath)

        if (stats.isDirectory()) {
          this.directoryArgs.push(this.ensureTrailingSlash(localPath))
        } else if (stats.isFile()) {
          this.fileArgs.push(localPath)
          this.explicitFiles.push(resolvedFullPath)
        }
      } catch {
        const fallbackLocalPath = this.toLocalPath(basePrefixedFullPath || fullPath)
        this.fileArgs.push(fallbackLocalPath)
      }
    }

    this._argsPrepared = true
  }

  /**
   * @param {string} localPath - Local path.
   * @returns {string} - Normalized local path with trailing slash.
   */
  ensureTrailingSlash(localPath) {
    if (localPath === "") return localPath
    return localPath.endsWith("/") ? localPath : `${localPath}/`
  }

  /**
   * @param {string} fullPath - Full path.
   * @returns {string} - Local path relative to the base directory.
   */
  toLocalPath(fullPath) {
    const relativePath = path.relative(this.directory, fullPath)
    return relativePath.split(path.sep).join("/")
  }
}

// @ts-check

import fs from "fs/promises"

import fileExists from "../utils/file-exists.js"
import {Logger} from "../logger.js"
import restArgsError from "../utils/rest-args-error.js"

// Incredibly complex class to find files in multiple simultanious running promises to do it as fast as possible.
export default class TestFilesFinder {
  static IGNORED_NAMES = [".git", "node_modules"]

  /**
   * @param {object} args
   * @param {string} args.directory
   * @param {string[]} args.directories
   * @param {string[]} args.processArgs
   */
  constructor({directory, directories, processArgs, ...restArgs}) {
    restArgsError(restArgs)

    this.directory = directory
    this.logger = new Logger(this)

    if (directories) {
      this.directories = directories
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

    for (const testArg of this.testArgs) {
      if (testArg.endsWith("/")) {
        this.directoryArgs.push(testArg)
      } else {
        this.fileArgs.push(testArg)
      }
    }
  }

  /**
   * @returns {Promise<string[]>}
   */
  async findTestFiles() {
    await this.withFindingCount(async () => {
      for (const directory of this.directories) {
        if (await fileExists(directory)) {
          await this.findTestFilesInDir(directory)
        }
      }
    })

    await this.waitForFindingPromises()

    return this.foundFiles
  }

  /**
   * @returns {number}
   */
  findingPromisesLength() { return Object.keys(this.findingPromises).length }

  async waitForFindingPromises() {
    while (this.findingPromisesLength() > 0) {
      await this.waitForFindingPromisesIteration()
    }
  }

  /**
   * @returns {Promise<void>}
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
   * @param {function() : Promise<void>} callback
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
   * @param {string} dir
   * @returns {Promise<void>}
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
   * @param {string} file
   * @param {string} localPath
   * @returns {boolean}
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
   * @param {string} file
   * @returns {boolean}
   */
  looksLikeTestFile(file) {
    return Boolean(file.match(/-(spec|test)\.(m|)js$/))
  }
}

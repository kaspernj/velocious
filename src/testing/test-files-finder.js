// @ts-check

import fs from "fs/promises"

import fileExists from "../utils/file-exists.js"
import restArgsError from "../utils/rest-args-error.js"

// Incredibly complex class to find files in multiple simultanious running promises to do it as fast as possible.
export default class TestFilesFinder {
  static IGNORED_NAMES = [".git", "node_modules"]

  /**
   * @param {object} args
   * @param {string} args.directory
   * @param {string[]} args.processArgs
   */
  constructor({directory, processArgs, ...restArgs}) {
    restArgsError(restArgs)

    this.directory = directory
    this.directories = [
      `${directory}/__tests__`,
      `${directory}/spec`,
      `${directory}/tests`
    ]

    /** @type {string[]} */
    this.foundFiles = []

    this.findingCount = 0

    /** @type {Record<number, Promise<void>>} */
    this.findingPromises = {}

    this.processArgs = processArgs

    /** @type {string[]} */
    this.testArgs = this.processArgs.filter((processArg, index) => index != 0)

    /** @type {Array<{arg: string, type: string}>} */
    this.parsedTestArgs = this.testArgs.map((testArg) => {
      if (testArg.endsWith("/")) {
        return {
          arg: testArg,
          type: "directory"
        }
      }

      return {
        arg: testArg,
        type: "file"
      }
    })
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
    if (this.parsedTestArgs.length > 0) {
      for (const parsedTestArg of this.parsedTestArgs) {
        if (parsedTestArg.type == "file") {
          if (parsedTestArg.arg == localPath) {
            return true
          }
        } else if (parsedTestArg.type == "directory") {
          if (localPath.startsWith(parsedTestArg.arg)) {
            return true
          }
        } else {
          throw new Error(`Unknown arg type: ${parsedTestArg.type}`)
        }
      }
    } else if (file.match(/-(spec|test)\.(m|)js$/)) {
      return true
    }

    return false
  }
}

import fs from "fs/promises"

// Incredibly complex class to find files in multiple simultanious running promises to do it as fast as possible.
export default class TestFilesFinder {
  static IGNORED_NAMES = [".git", "node_modules"]

  constructor({directory, processArgs}) {
    this.directory = directory
    this.foundFiles = []
    this.findingCount = 0
    this.findingPromises = {}
    this.processArgs = processArgs
    this.testArgs = this.processArgs.filter((processArg, index) => index != 0)
  }

  async findTestFiles() {
    await this.withFindingCount(async () => {
      await this.findTestFilesInDir(this.directory)
    })

    await this.waitForFindingPromises()

    return this.foundFiles
  }

  findingPromisesLength() { return Object.keys(this.findingPromises).length }

  async waitForFindingPromises() {
    while (this.findingPromisesLength() > 0) {
      await this.waitForFindingPromisesIteration()
    }
  }

  async waitForFindingPromisesIteration() {
    const unfinishedPromises = []

    for (const findingPromiseId in this.findingPromises) {
      const findingPromise = this.findingPromises[findingPromiseId]

      unfinishedPromises.push(findingPromise)
    }

    await Promise.all(unfinishedPromises)
  }

  withFindingCount(callback) {
    return new Promise((resolve) => {
      const findingPromise = callback()
      const findingCount = this.findingCount

      this.findingCount += 1
      this.findingPromises[findingCount] = findingPromise

      findingPromise.finally(() => {
        delete this.findingPromises[findingCount]

        resolve()
      })
    })
  }

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

  isFileMatchingRequirements(file, localPath) {
    if (this.testArgs.length > 0) {
      for (const testArg of this.testArgs) {
        if (testArg == localPath) {
          return true
        }
      }
    } else if (file.match(/-(spec|test)\.(m|)js$/)) {
      return true
    }

    return false
  }
}

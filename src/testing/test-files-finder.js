// @ts-check

import {
  discoverTestFiles,
  lineFiltersFromCandidates
} from "@velocious/testing/node"

import restArgsError from "../utils/rest-args-error.js"

const VELOCIOUS_NODE_TEST_PATTERN = /(?<!\.browser)-(?:spec|test)\.(?:m)?js$/u

/** Compatibility facade for Velocious's published test-file finder path. */
export default class TestFilesFinder {
  /**
   * Creates a Velocious-compatible package discovery adapter.
   * @param {object} args - Discovery options.
   * @param {string} args.directory - Discovery base directory.
   * @param {string[]} [args.directories] - Default directories.
   * @param {RegExp} [args.filePattern] - Test-file pattern override.
   * @param {string[]} args.processArgs - Process arguments including the command name.
   */
  constructor({directory, directories, filePattern, processArgs, ...restArgs}) {
    restArgsError(restArgs)
    this.directory = directory
    this.directories = directories
    this.filePattern = filePattern
    this.candidates = processArgs.slice(1).filter((argument) => argument !== "--")
    /** @type {Record<string, number[]>} */
    this.lineFiltersByFile = lineFiltersFromCandidates({
      cwd: directory,
      candidates: this.candidates
    })
  }

  /**
   * Discovers test files through the package implementation.
   * @returns {Promise<string[]>} - Discovered absolute file paths.
   */
  async findTestFiles() {
    return await discoverTestFiles({
      cwd: this.directory,
      candidates: this.candidates,
      directories: this.directories,
      filePattern: this.filePattern || VELOCIOUS_NODE_TEST_PATTERN
    })
  }

  /**
   * Gets candidate-derived line filters.
   * @returns {Record<string, number[]>} - Line filters keyed by absolute file path.
   */
  getLineFiltersByFile() { return this.lineFiltersByFile }
}

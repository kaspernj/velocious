// @ts-check

import TestRunner from "../../src/testing/test-runner.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @typedef {{debug: (...args: unknown[]) => void, error: (...args: unknown[]) => void, info: (...args: unknown[]) => void, log: (...args: unknown[]) => void, warn: (...args: unknown[]) => void}} ConsoleMethods
 */

const CAPTURED_METHODS = ["log", "info", "warn", "error", "debug"]

/** @type {ConsoleMethods} */
let originalMethods = {
  debug: console.debug,
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn
}

/** @returns {void} - No return value. */
function saveOriginalMethods() {
  originalMethods = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn
  }
}

/** @returns {void} - No return value. */
function restoreOriginalMethods() {
  for (const methodName of CAPTURED_METHODS) {
    console[methodName] = originalMethods[methodName]
  }
}

describe("TestRunner console capture", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  const testRunner = new TestRunner({configuration: {}, testFiles: []})

  beforeEach(() => {
    saveOriginalMethods()
  })

  afterEach(() => {
    restoreOriginalMethods()
  })

  it("returns captured output formatted with a method prefix per argument", () => {
    const stopConsoleCapture = testRunner.startConsoleCapture({passthrough: false})

    console.log("hello", 123)
    console.error("boom")
    console.warn("careful", {code: 7})
    console.debug("trace")
    console.info("note")

    const output = stopConsoleCapture()

    expect(output).toContain("[log] hello 123")
    expect(output).toContain("[error] boom")
    expect(output).toContain("[warn] careful { code: 7 }")
    expect(output).toContain("[debug] trace")
    expect(output).toContain("[info] note")
  })

  it("passes through to the original method preserving its receiver", () => {
    const originalLog = console.log
    /** @type {{args: unknown[], receiver: unknown}[]} */
    const passthroughCalls = []
    const spy = function(...args) {
      passthroughCalls.push({args, receiver: this})
    }

    console.log = spy

    try {
      const stopConsoleCapture = testRunner.startConsoleCapture({passthrough: true})

      console.log("passthrough line")

      const output = stopConsoleCapture()

      expect(output).toContain("[log] passthrough line")
      expect(passthroughCalls).toHaveLength(1)
      expect(passthroughCalls[0].args).toEqual(["passthrough line"])
      expect(passthroughCalls[0].receiver).toBe(console)
    } finally {
      console.log = originalLog
    }
  })

  it("returns the same output on repeated stops", () => {
    const stopConsoleCapture = testRunner.startConsoleCapture({passthrough: false})

    console.log("only once")

    const first = stopConsoleCapture()
    const second = stopConsoleCapture()

    expect(first).toEqual(second)
    expect(first).toContain("[log] only once")
    expect(first.split("\n")).toHaveLength(1)
  })

  it("restores the exact original console methods", () => {
    const stopConsoleCapture = testRunner.startConsoleCapture({passthrough: false})

    console.log("captured during the test")

    stopConsoleCapture()

    expect(console.log).toBe(originalMethods.log)
    expect(console.info).toBe(originalMethods.info)
    expect(console.warn).toBe(originalMethods.warn)
    expect(console.error).toBe(originalMethods.error)
    expect(console.debug).toBe(originalMethods.debug)
  })

  it("nested captures restore the exact outer wrapper and preserve output", () => {
    const stopOuterCapture = testRunner.startConsoleCapture({passthrough: false})
    const outerWrapper = console.log

    console.log("outer line")

    const stopInnerCapture = testRunner.startConsoleCapture({passthrough: false})

    console.log("inner line")

    const innerOutput = stopInnerCapture()

    expect(console.log).toBe(outerWrapper)
    expect(innerOutput).toContain("[log] inner line")
    expect(innerOutput).not.toContain("outer line")

    console.log("outer line after inner")

    const outerOutput = stopOuterCapture()

    expect(console.log).toBe(originalMethods.log)
    expect(outerOutput).toContain("[log] outer line")
    expect(outerOutput).not.toContain("[log] inner line")
    expect(outerOutput).toContain("[log] outer line after inner")
  })
})

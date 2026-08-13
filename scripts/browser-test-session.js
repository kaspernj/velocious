// @ts-check

import { spawn } from "node:child_process"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { promisify } from "node:util"
import timeout from "awaitery/build/timeout.js"
import SystemTest from "system-testing/build/system-test.js"

/**
 * @typedef {object} BrowserTestChromeRuntime
 * @property {string} browserPath - Chrome executable path.
 * @property {string} browserVersion - Chrome version.
 * @property {string} driverPath - ChromeDriver executable path.
 * @property {string} driverVersion - ChromeDriver version.
 */

/**
 * @typedef {object} BrowserTestSystemTest
 * @property {() => Promise<void>} start - Starts SystemTest.
 * @property {() => Promise<void>} stop - Stops SystemTest.
 */

/**
 * @typedef {object} BrowserTestChromeDriverService
 * @property {() => Promise<string>} start - Starts ChromeDriver and returns its URL.
 * @property {() => Promise<void>} stop - Stops ChromeDriver and its process group.
 * @property {() => Promise<string>} diagnostics - Reads retained ChromeDriver diagnostics.
 */

/**
 * @typedef {object} BrowserTestSystemTestConfig
 * @property {boolean} debug - Whether SystemTest should emit debug output.
 * @property {{type: "selenium", options: {chromeArguments: string[], chromeBinaryPath: string}}} driver - Selenium driver config.
 * @property {string} httpHost - HTTP host for the browser-test app.
 * @property {number} httpPort - HTTP port for the browser-test app.
 */

const require = createRequire(import.meta.url)
const { binaryPaths } = require("selenium-webdriver/common/seleniumManager.js")
const { CancellationError, waitForServer } = require("selenium-webdriver/http/util.js")
const { findFreePort } = require("selenium-webdriver/net/portprober.js")
const execFileAsync = promisify(execFile)
const CHROMEDRIVER_START_TIMEOUT_MS = 30000
const PROCESS_STOP_TIMEOUT_MS = 10000

/** @returns {string} - Default runtime manifest path. */
function defaultManifestPath() {
  return path.join(process.cwd(), "tmp", "browser-test-chrome-runtime.json")
}

/** @returns {string} - Default diagnostic directory. */
function defaultDiagnosticsDirectory() {
  return path.join(process.cwd(), "tmp", "browser-test-chrome")
}

/**
 * @param {string} executablePath - Executable path.
 * @returns {Promise<string>} - Version command output.
 */
async function readExecutableVersion(executablePath) {
  const { stdout, stderr } = await execFileAsync(executablePath, ["--version"])

  return `${stdout}${stderr}`.trim()
}

/**
 * @param {string} versionOutput - Version command output.
 * @param {string} executableName - Executable description.
 * @returns {string} - Parsed four-part version.
 */
function parseExecutableVersion(versionOutput, executableName) {
  const match = versionOutput.match(/\b(\d+\.\d+\.\d+\.\d+)\b/)

  if (!match) throw new Error(`Could not parse ${executableName} version from: ${versionOutput}`)

  return match[1]
}

/**
 * @param {string} executablePath - Executable path.
 * @param {string} description - Executable description.
 * @returns {Promise<void>} - Resolves when executable exists and is executable.
 */
async function assertExecutable(executablePath, description) {
  if (!path.isAbsolute(executablePath)) {
    throw new Error(`${description} path must be absolute: ${executablePath}`)
  }

  try {
    await fs.access(executablePath, fs.constants.X_OK)
  } catch (error) {
    throw new Error(`${description} is not executable: ${executablePath}`, {cause: error})
  }
}

/**
 * Resolves, validates, and persists the exact Chrome/ChromeDriver pair.
 * @param {object} [args] - Prewarm options.
 * @param {() => {browserPath?: string, driverPath?: string}} [args.binaryPathsResolver] - Selenium path resolver.
 * @param {string} [args.manifestPath] - Runtime manifest path.
 * @param {(executablePath: string) => Promise<string>} [args.versionReader] - Executable version reader.
 * @returns {Promise<BrowserTestChromeRuntime>} - Prewarmed runtime.
 */
export async function prewarmBrowserTestChromeRuntime({
  binaryPathsResolver = () => binaryPaths([
    "--browser",
    "chrome",
    "--language-binding",
    "javascript",
    "--output",
    "json",
    "--avoid-browser-download"
  ]),
  manifestPath = defaultManifestPath(),
  versionReader = readExecutableVersion
} = {}) {
  const { browserPath, driverPath } = binaryPathsResolver()

  if (!browserPath) throw new Error("Selenium Manager did not resolve a Chrome executable")
  if (!driverPath) throw new Error("Selenium Manager did not resolve a ChromeDriver executable")

  await assertExecutable(browserPath, "Chrome")
  await assertExecutable(driverPath, "ChromeDriver")

  let browserVersionOutput
  let driverVersionOutput

  try {
    browserVersionOutput = await versionReader(browserPath)
  } catch (error) {
    throw new Error(`Chrome could not report its version at ${browserPath}`, {cause: error})
  }

  try {
    driverVersionOutput = await versionReader(driverPath)
  } catch (error) {
    throw new Error(`ChromeDriver could not report its version at ${driverPath}`, {cause: error})
  }

  const browserVersion = parseExecutableVersion(browserVersionOutput, "Chrome")
  const driverVersion = parseExecutableVersion(driverVersionOutput, "ChromeDriver")

  if (browserVersion.split(".")[0] !== driverVersion.split(".")[0]) {
    throw new Error(`Chrome ${browserVersion} is incompatible with ChromeDriver ${driverVersion}`)
  }

  const runtime = {browserPath, browserVersion, driverPath, driverVersion}

  await fs.mkdir(path.dirname(manifestPath), {recursive: true})
  await fs.writeFile(manifestPath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8")

  return runtime
}

/**
 * Loads the exact runtime persisted by prewarming.
 * @param {object} [args] - Load options.
 * @param {string} [args.manifestPath] - Runtime manifest path.
 * @returns {Promise<BrowserTestChromeRuntime>} - Persisted runtime.
 */
export async function loadBrowserTestChromeRuntime({manifestPath = defaultManifestPath()} = {}) {
  const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  const browserPath = parsed?.browserPath
  const browserVersion = parsed?.browserVersion
  const driverPath = parsed?.driverPath
  const driverVersion = parsed?.driverVersion

  if (typeof browserPath !== "string" || typeof browserVersion !== "string" || typeof driverPath !== "string" || typeof driverVersion !== "string") {
    throw new Error(`Invalid browser test Chrome runtime manifest: ${manifestPath}`)
  }

  await assertExecutable(browserPath, "Chrome")
  await assertExecutable(driverPath, "ChromeDriver")

  return {browserPath, browserVersion, driverPath, driverVersion}
}

/**
 * Loads a prewarmed runtime, preparing it for direct local browser runs when absent.
 * @returns {Promise<BrowserTestChromeRuntime>} - Browser runtime.
 */
export async function loadOrPrewarmBrowserTestChromeRuntime() {
  try {
    return await loadBrowserTestChromeRuntime()
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return await prewarmBrowserTestChromeRuntime()
    }

    throw error
  }
}

/**
 * Formatted default Chrome launch arguments for every browser-test session. Mirrors the
 * Selenium driver defaults used by system-testing so supplying the list does not drop the
 * headless container requirements, and adds pipe-mode devtools transport, which ChromeDriver
 * recommends over the injected `--remote-debugging-port` and which keeps the Chrome instance
 * alive until a session is created on headless container CI.
 * @returns {string[]} - Chrome launch arguments.
 */
function browserTestChromeArguments() {
  return [
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-renderer-backgrounding",
    "--headless=new",
    "--no-sandbox",
    "--remote-debugging-pipe",
    "--window-size=1920,1080"
  ]
}

/**
 * Builds the SystemTest factory used by BrowserTestSession so the Selenium builder path
 * receives the pinned Chrome binary and the required headless container Chrome arguments.
 * @param {object} [args] - Factory options.
 * @param {string[]} [args.chromeArguments] - Chrome launch arguments.
 * @param {boolean} [args.debug] - Whether SystemTest should emit debug output.
 * @param {string} [args.httpHost] - HTTP host for the browser-test app.
 * @param {number} [args.httpPort] - HTTP port for the browser-test app.
 * @param {(config: BrowserTestSystemTestConfig) => BrowserTestSystemTest} [args.systemTestCurrent] - SystemTest factory.
 * @returns {(args: {browserPath: string, remoteUrl: string}) => BrowserTestSystemTest} - SystemTest factory.
 */
export function buildBrowserTestSystemTestFactory({
  chromeArguments = browserTestChromeArguments(),
  debug = false,
  httpHost = "127.0.0.1",
  httpPort = 1984,
  systemTestCurrent = SystemTest.current
} = {}) {
  return ({browserPath}) => systemTestCurrent({
    debug,
    driver: {
      type: "selenium",
      options: {chromeArguments, chromeBinaryPath: browserPath}
    },
    httpHost,
    httpPort
  })
}

/**
 * Formats a child process exit.
 * @param {{code: number | null, error?: Error, signal: NodeJS.Signals | null}} result - Exit result.
 * @returns {string} - Exit description.
 */
function formatProcessExit(result) {
  if (result.error) return result.error.message
  if (result.signal) return `signal ${result.signal}`

  return `exit code ${String(result.code)}`
}

export class ManagedChromeDriverProcess {
  /**
   * @param {BrowserTestChromeRuntime} runtime - Chrome runtime.
   * @param {string} [diagnosticsDirectory] - Diagnostic output directory.
   */
  constructor(runtime, diagnosticsDirectory = defaultDiagnosticsDirectory()) {
    this.runtime = runtime
    this.diagnosticsDirectory = diagnosticsDirectory
    this.driverLogPath = path.join(diagnosticsDirectory, "chromedriver.log")
    this.processOutputPath = path.join(diagnosticsDirectory, "chromedriver-process.log")
    /** @type {import("node:child_process").ChildProcess | undefined} */
    this.child = undefined
    /** @type {Promise<{code: number | null, error?: Error, signal: NodeJS.Signals | null}> | undefined} */
    this.exitResult = undefined
    /** @type {import("node:fs/promises").FileHandle | undefined} */
    this.outputFile = undefined
  }

  /** @returns {Promise<string>} - ChromeDriver service URL. */
  async start() {
    await fs.mkdir(this.diagnosticsDirectory, {recursive: true})
    await fs.rm(this.driverLogPath, {force: true})
    this.outputFile = await fs.open(this.processOutputPath, "w")

    const port = await findFreePort("127.0.0.1")
    const child = spawn(this.runtime.driverPath, [
      `--port=${port}`,
      "--verbose",
      `--log-path=${this.driverLogPath}`,
      "--enable-chrome-logs"
    ], {
      detached: process.platform !== "win32",
      stdio: ["ignore", this.outputFile.fd, this.outputFile.fd]
    })

    this.child = child
    this.exitResult = new Promise((resolve) => {
      child.once("error", (error) => resolve({code: null, error, signal: null}))
      child.once("exit", (code, signal) => resolve({code, signal}))
    })

    const serviceUrl = `http://127.0.0.1:${port}`
    const earlyExit = this.exitResult.then((result) => {
      throw new Error(`ChromeDriver terminated during startup with ${formatProcessExit(result)}`)
    })
    const exitCancellation = this.exitResult.then(() => undefined)

    try {
      await Promise.race([
        waitForServer(serviceUrl, CHROMEDRIVER_START_TIMEOUT_MS, exitCancellation),
        earlyExit
      ])
    } catch (error) {
      if (error instanceof CancellationError) await earlyExit

      throw error
    }

    return serviceUrl
  }

  /**
   * @param {NodeJS.Signals} signal - Signal to deliver.
   * @returns {void}
   */
  signalProcessGroup(signal) {
    const child = this.child

    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return

    try {
      if (process.platform === "win32") {
        child.kill(signal)
      } else {
        process.kill(-child.pid, signal)
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return

      throw error
    }
  }

  /** @returns {Promise<void>} - Stops ChromeDriver and Chrome descendants. */
  async stop() {
    let stopError

    try {
      if (this.exitResult && this.child?.exitCode === null && this.child.signalCode === null) {
        this.signalProcessGroup("SIGTERM")

        try {
          await timeout({
            timeout: PROCESS_STOP_TIMEOUT_MS,
            errorMessage: "Timed out waiting for ChromeDriver process group to stop"
          }, async () => await this.exitResult)
        } catch (error) {
          this.signalProcessGroup("SIGKILL")
          await this.exitResult
          stopError = error instanceof Error ? error : new Error(String(error))
        }
      }
    } catch (error) {
      stopError = error instanceof Error ? error : new Error(String(error))
    }

    try {
      await this.outputFile?.close()
    } catch (error) {
      const outputCloseError = error instanceof Error ? error : new Error(String(error))
      stopError = stopError
        ? new AggregateError([stopError, outputCloseError], "ChromeDriver process and output cleanup failed")
        : outputCloseError
    }

    this.outputFile = undefined

    if (stopError) throw stopError
  }

  /** @returns {Promise<string>} - Retained ChromeDriver diagnostics. */
  async diagnostics() {
    const sections = []

    for (const [label, filePath] of [
      ["ChromeDriver log", this.driverLogPath],
      ["ChromeDriver process output", this.processOutputPath]
    ]) {
      try {
        const content = await fs.readFile(filePath, "utf8")
        sections.push(`${label} (${filePath}):\n${content || "(empty)"}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sections.push(`${label} (${filePath}) unavailable: ${message}`)
      }
    }

    return sections.join("\n")
  }
}

/**
 * Captures Chrome and ChromeDriver processes for startup diagnostics.
 * @param {string} phase - Snapshot phase.
 * @returns {Promise<string>} - Process snapshot.
 */
async function browserProcessSnapshot(phase) {
  if (process.platform === "win32") return `${phase}: browser process snapshots are unavailable on Windows`

  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid,ppid,pgid,stat,etime,comm,args"])
    const processLines = stdout
      .split("\n")
      .filter((line) => /\s(?:chrome|chromedriver|google-chrome)\s/.test(line))

    return `${phase}:\n${processLines.length > 0 ? processLines.join("\n") : "(no Chrome/ChromeDriver processes)"}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `${phase}: process snapshot failed: ${message}`
  }
}

/**
 * Owns ChromeDriver and SystemTest startup as one cleanup boundary.
 */
export class BrowserTestSession {
  /**
   * @param {object} args - Session options.
   * @param {(runtime: BrowserTestChromeRuntime) => Promise<BrowserTestChromeDriverService>} [args.chromeDriverServiceFactory] - Driver service factory.
   * @param {(phase: string) => Promise<string>} [args.processSnapshot] - Process snapshot callback.
   * @param {BrowserTestChromeRuntime} args.runtime - Chrome runtime.
   * @param {(args: {browserPath: string, remoteUrl: string}) => BrowserTestSystemTest} args.systemTestFactory - SystemTest factory.
   */
  constructor({
    chromeDriverServiceFactory = async (runtime) => new ManagedChromeDriverProcess(runtime),
    processSnapshot = browserProcessSnapshot,
    runtime,
    systemTestFactory
  }) {
    this.chromeDriverServiceFactory = chromeDriverServiceFactory
    this.processSnapshot = processSnapshot
    this.runtime = runtime
    this.systemTestFactory = systemTestFactory
    /** @type {BrowserTestChromeDriverService | undefined} */
    this.chromeDriverService = undefined
    /** @type {BrowserTestSystemTest | undefined} */
    this.systemTest = undefined
    this.remoteUrlWasPresent = false
    /** @type {string | undefined} */
    this.previousRemoteUrl = undefined
    /** @type {string | undefined} */
    this.remoteUrl = undefined
    this.startupPhase = "creating ChromeDriver service"
    this.stopped = false
  }

  /** @returns {Promise<BrowserTestSystemTest>} - Started SystemTest instance. */
  async start() {
    this.remoteUrlWasPresent = Object.hasOwn(process.env, "SELENIUM_REMOTE_URL")
    this.previousRemoteUrl = process.env.SELENIUM_REMOTE_URL

    try {
      this.chromeDriverService = await this.chromeDriverServiceFactory(this.runtime)
      this.startupPhase = "starting ChromeDriver service"
      this.remoteUrl = await this.chromeDriverService.start()
      process.env.SELENIUM_REMOTE_URL = this.remoteUrl
      this.systemTest = this.systemTestFactory({browserPath: this.runtime.browserPath, remoteUrl: this.remoteUrl})
      this.startupPhase = "creating Selenium WebDriver session"
      await this.systemTest.start()

      return this.systemTest
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error))
      const beforeCleanup = await this.processSnapshot("before cleanup")
      const cleanupErrors = await this.stopResources({driverFirst: true})
      const afterCleanup = await this.processSnapshot("after cleanup")
      const driverDiagnostics = this.chromeDriverService
        ? await this.chromeDriverService.diagnostics()
        : "ChromeDriver service was not created"
      const message = [
        `Browser test startup failed while ${this.startupPhase}: ${startupError.message}`,
        `Chrome: ${this.runtime.browserVersion} (${this.runtime.browserPath})`,
        `ChromeDriver: ${this.runtime.driverVersion} (${this.runtime.driverPath})`,
        `ChromeDriver service: ${this.remoteUrl ?? "not started"}`,
        beforeCleanup,
        afterCleanup,
        driverDiagnostics
      ].join("\n")
      if (cleanupErrors.length > 0) {
        throw new AggregateError([startupError, ...cleanupErrors], message, {cause: error})
      }

      throw new Error(message, {cause: error})
    }
  }

  /**
   * @param {object} args - Cleanup options.
   * @param {boolean} args.driverFirst - Stop the driver before SystemTest during failed startup.
   * @returns {Promise<Error[]>} - Cleanup errors.
   */
  async stopResources({driverFirst}) {
    if (this.stopped) return []

    this.stopped = true
    const cleanupErrors = []
    const stopDriver = async () => {
      try {
        await this.chromeDriverService?.stop()
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const stopSystemTest = async () => {
      try {
        await this.systemTest?.stop()
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
      }
    }

    if (driverFirst) {
      await stopDriver()
      await stopSystemTest()
    } else {
      await stopSystemTest()
      await stopDriver()
    }

    if (this.remoteUrlWasPresent) {
      process.env.SELENIUM_REMOTE_URL = this.previousRemoteUrl
    } else {
      delete process.env.SELENIUM_REMOTE_URL
    }

    return cleanupErrors
  }
}

/**
 * Stops SystemTest and the managed ChromeDriver for a browser test session.
 * @param {BrowserTestSession} session - Browser test session.
 * @returns {Promise<void>} - Resolves when all session resources have stopped.
 */
export async function stopBrowserTestSession(session) {
  const cleanupErrors = await session.stopResources({driverFirst: false})

  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "Browser test session cleanup failed")
}

// @ts-check

import useEnvSense from "env-sense/build/use-env-sense.js"

/** @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */

const {isBrowser} = useEnvSense()
const isNodeRuntime = typeof process !== "undefined" && Boolean(process.versions?.node)

/**
 * @param {import("node:stream").Writable | undefined} stream - Stream to write to.
 * @param {string} message - Message to write.
 * @returns {Promise<void>} - Resolves when complete.
 */
function writeToStream(stream, message) {
  return new Promise((resolve) => {
    if (!stream || typeof stream.write !== "function") {
      resolve()
      return
    }

    stream.write(`${message}\n`, "utf8", () => resolve())
  })
}

/** Logger stdout/stderr output. */
export default class LoggerStdoutOutput {
  /** @param {LoggingOutputPayload} payload - Log payload. */
  async write({level, message}) {
    if (!isBrowser && isNodeRuntime) {
      if (level === "warn" || level === "error") {
        await writeToStream(process.stderr, message)
      } else {
        await writeToStream(process.stdout, message)
      }

      return
    }

    if (level === "error") {
      console.error(message)
      return
    }

    if (level === "warn") {
      console.warn(message)
      return
    }

    if (level === "debug" || level === "debug-low-level") {
      const debugLogger = typeof console.debug === "function" ? console.debug : console.log
      debugLogger(message)
      return
    }

    console.log(message)
  }
}

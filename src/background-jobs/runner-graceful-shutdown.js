// @ts-check

import timeout from "awaitery/build/timeout.js"

import Configuration from "../configuration.js"

/** Bounded grace for closing framework connections on shutdown before forcing exit. */
const SHUTDOWN_CLOSE_TIMEOUT_MS = 5000

/**
 * Gracefully closes a background-job runner's framework connections (beacon +
 * database) on shutdown, so the database server ends the session and releases any
 * advisory lock the runner still holds *immediately* — instead of leaving a
 * half-open session that keeps the lock (e.g. the build-planner lock) held until
 * the server's idle `wait_timeout` (hours).
 *
 * A runner child otherwise exits abruptly on shutdown (`process.exit`) and relies
 * on the OS tearing down its sockets. A named lock releases only when its owning
 * session ends, and an abrupt exit / container teardown does not reliably deliver a
 * clean disconnect to the server — so the lock leaks. Sending a real close here
 * (`COM_QUIT` via `closeDatabaseConnections`) makes the server end the session and
 * release the lock deterministically.
 *
 * Bounded by `closeTimeoutMs` so a wedged close can never block the exit; falling
 * back to the abrupt exit is no worse than the previous behavior. Errors are logged,
 * not thrown, because the caller is about to exit regardless.
 * @param {import("../configuration.js").default | null} configuration - Configuration whose connections to close; null when none is set (nothing to close).
 * @param {number} [closeTimeoutMs] - Max time to spend closing before giving up.
 * @returns {Promise<void>}
 */
export async function closeRunnerConnections(configuration, closeTimeoutMs = SHUTDOWN_CLOSE_TIMEOUT_MS) {
  if (!configuration) return

  try {
    await timeout({timeout: closeTimeoutMs}, async () => {
      try {
        await configuration.disconnectBeacon()
      } finally {
        await configuration.closeDatabaseConnections()
      }
    })
  } catch (error) {
    console.error("Failed to close background-job runner connections on shutdown:", error)
  }
}

/**
 * The current configuration, or null when none has been set yet — a runner that is
 * signalled before it runs any job holds no connections (and no locks) to close.
 * @returns {import("../configuration.js").default | null} - The current configuration, or null when none is set.
 */
export function currentConfigurationOrNull() {
  try {
    return Configuration.current()
  } catch {
    // `Configuration.current()` throws when no configuration is set yet.
    return null
  }
}

// @ts-check

export const DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS = 4000

/** Actionable failure for an unacknowledged generation hello. */
export default class BackgroundJobsGenerationHandshakeTimeoutError extends Error {
  /**
   * Creates an actionable generation-handshake deadline failure.
   * @param {object} args - Timeout context.
   * @param {string} args.endpoint - Main endpoint.
   * @param {string} args.generationId - Expected generation.
   * @param {"worker" | "client" | "reporter"} args.role - Initiating peer role.
   * @param {number} args.timeoutMs - Handshake deadline.
   */
  constructor({endpoint, generationId, role, timeoutMs}) {
    super(`Background jobs ${role} generation handshake for ${generationId} timed out after ${timeoutMs}ms at ${endpoint}`)
    this.name = "BackgroundJobsGenerationHandshakeTimeoutError"
  }
}

/**
 * Validates a generation handshake deadline.
 * @param {number} timeoutMs - Candidate deadline.
 * @returns {number} - Valid deadline.
 */
export function validateGenerationHandshakeTimeoutMs(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new TypeError("generationHandshakeTimeoutMs must be an integer between 1 and 2147483647")
  }

  return timeoutMs
}

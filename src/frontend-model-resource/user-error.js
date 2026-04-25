// @ts-check

/**
 * Throw this from a frontend-model resource (collection/member command,
 * action override, etc.) to signal an *expected user error* —
 * "invalid email or password", "email already taken", and similar
 * input-validation failures. The framework returns the message to the
 * client like any other thrown error, but skips the noisy
 * "Frontend model endpoint request failed" log line because the
 * failure is part of normal user flow, not a backend bug.
 *
 * Use a plain `Error` (or any other subclass) for unexpected failures
 * — those should still hit the error log so they show up in monitoring.
 */
export default class FrontendModelUserError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = "FrontendModelUserError"
  }
}

// @ts-check

/**
 * @param {any} error - Error instance.
 * @returns {Error} - The error.
 */
export default function ensureError(error) {
  if (error instanceof Error) {
    return error
  } else {
    return new Error(`Unknown error type ${typeof error}: ${error}`)
  }
}


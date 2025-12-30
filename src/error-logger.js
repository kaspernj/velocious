// @ts-check

/**
 * @param {(...args: any[]) => Promise<void>} callback - Callback function.
 * @returns {(...args: any[]) => Promise<void>} - The error logger.
 */
export default function errorLogger(callback) {
  /**
   * @param  {...unknown[]} args - Arguments forwarded to the callback.
   * @returns {Promise<void>} - Resolves when complete.
   */
  return async function(...args) {
    try {
      await callback(...args)
    } catch (error) {
      if (error instanceof Error) {
        console.error(`ErrorLogger: ${error.message}`)

        if (error.stack) {
          console.error("Stack", error.stack)
        } else {
          console.error("No stack")
        }
      } else {
        console.error(`ErrorLogger: ${error}`)
        console.error("No stack")
      }

      // Give console some time to write out messages before crashing
      setTimeout(() => { throw error })
    }
  }
}


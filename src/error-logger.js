// @ts-check

/**
 * @param {(...args: any[]) => Promise<void>} callback
 * @returns {(...args: any[]) => Promise<void>} - Result.
 */
export default function errorLogger(callback) {
  /**
   * @param  {...any} args
   * @returns {Promise<void>} - Result.
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

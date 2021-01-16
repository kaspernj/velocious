module.exports = function errorLogger(callback) {
  return async function(...args) {
    try {
      await callback(...args)
    } catch (error) {
      console.error(`ErrorLogger: ${error.message}`)

      if (error.stack) {
        console.error("Stack", error.stack)
      } else {
        console.error("No stack")
      }

      // Give console some time to write out messages before crashing
      setTimeout(() => { throw error })
    }
  }
}

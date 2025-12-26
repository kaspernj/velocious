/**
 * @param {Array<(next: () => Promise<void>) => void | Promise<void>>} callbacksToNestInside - Callbacks to nest inside.
 * @param {() => void | Promise<void>} callback - Callback function.
 * @returns {Promise<void>} - Resolves when complete.
 */
export default async function nestCallbacks(callbacksToNestInside, callback) {
  const baseCallback = async () => { await callback() }
  let runCallback = baseCallback

  for (const callbackToNestInside of callbacksToNestInside) {
    const actualRunCallback = runCallback

    const nextRunRequest = async () => {
      await callbackToNestInside(actualRunCallback)
    }

    runCallback = nextRunRequest
  }

  await runCallback()
}

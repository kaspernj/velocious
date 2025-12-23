/**
 * @param {Array<(next: () => Promise<void>) => void | Promise<void>>} callbacksToNestInside
 * @param {() => void | Promise<void>} callback
 * @returns {Promise<void>}
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

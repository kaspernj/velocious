export default async function nestCallbacks(callbacksToNestInside, callback) {
  let runCallback = callback

  for (const callbackToNestInside of callbacksToNestInside) {
    let actualRunCallback = runCallback

    const nextRunRequest = async () => {
      await callbackToNestInside(actualRunCallback)
    }

    runCallback = nextRunRequest
  }

  await runCallback()
}

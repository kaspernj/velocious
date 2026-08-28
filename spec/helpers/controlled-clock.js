// @ts-check

/**
 * Creates a deterministic wall clock for generation grace boundaries.
 * @param {number} [nowMs] - Initial epoch time.
 * @returns {{clearTimeout: (timerId: number | ReturnType<typeof setTimeout>) => void, now: () => number, pendingCount: () => number, runAll: () => void, setTimeout: (callback: () => void, delayMs: number) => number}} - Clock controls.
 */
export default function controlledClock(nowMs = Date.now()) {
  let nextTimerId = 0
  /** @type {Map<number, () => void>} */
  const callbacks = new Map()

  return {
    clearTimeout: (timerId) => {
      if (typeof timerId === "number") callbacks.delete(timerId)
    },
    now: () => nowMs,
    pendingCount: () => callbacks.size,
    runAll: () => {
      const scheduled = [...callbacks.values()]
      callbacks.clear()
      for (const callback of scheduled) callback()
    },
    setTimeout: (callback) => {
      nextTimerId += 1
      callbacks.set(nextTimerId, callback)
      return nextTimerId
    }
  }
}

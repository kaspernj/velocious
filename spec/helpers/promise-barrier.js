// @ts-check

/**
 * Creates a manually controlled promise barrier.
 * @returns {{blocked: Promise<void>, entered: () => void, release: () => void, waiting: Promise<void>}} - Barrier controls.
 */
export default function promiseBarrier() {
  /** @type {() => void} */
  let release = () => {}
  /** @type {() => void} */
  let entered = () => {}
  const waiting = new Promise((resolve) => { entered = resolve })
  const blocked = new Promise((resolve) => { release = resolve })

  return {blocked, entered, release, waiting}
}

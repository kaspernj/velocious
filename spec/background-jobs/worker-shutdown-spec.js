// @ts-check

import BackgroundJobsWorker from "../../src/background-jobs/worker.js"

/**
 * Builds a worker with a tracked fake forked-runner child whose `kill()` signals
 * are recorded, so shutdown tests can assert how the child was reaped.
 * @returns {{child: {kill: (signal: string) => boolean}, signals: string[], worker: BackgroundJobsWorker}}
 */
function workerWithTrackedChild() {
  /** @type {string[]} */
  const signals = []
  const child = {
    kill(signal) {
      signals.push(signal)

      return true
    }
  }
  const worker = new BackgroundJobsWorker({forkedChildSigkillGraceMs: 10})

  worker.inflightForkedChildren.add(/** @type {any} */ (child))

  return {child, signals, worker}
}

describe("Background jobs worker - shutdown", () => {
  it("terminates forked runners that outlast a bounded drain instead of orphaning them", async () => {
    const {signals, worker} = workerWithTrackedChild()

    // An in-flight forked runner whose job never finishes within the drain
    // window (e.g. a build still running when a deploy drains the worker).
    worker.inflightForkedJobs.add(new Promise(() => {}))

    await worker.stop({timeoutMs: 10})

    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it("does not terminate forked runners that finish within the drain window", async () => {
    const {child, signals, worker} = workerWithTrackedChild()

    // The runner finishes during the drain, so its child handle is removed
    // before reaping runs — no signal should be sent.
    const finished = Promise.resolve()

    worker.inflightForkedJobs.add(finished)
    void finished.then(() => worker.inflightForkedChildren.delete(/** @type {any} */ (child)))

    await worker.stop({timeoutMs: 1000})

    expect(signals).toEqual([])
  })
})

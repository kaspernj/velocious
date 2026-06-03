// @ts-check

import BackgroundJobsWorker from "../../src/background-jobs/worker.js"

describe("Background jobs worker - shutdown", () => {
  it("terminates forked runners that outlast a bounded drain instead of orphaning them", async () => {
    const worker = new BackgroundJobsWorker({forkedChildSigkillGraceMs: 10})

    /** @type {string[]} */
    const signals = []
    const fakeChild = {
      kill(signal) {
        signals.push(signal)

        return true
      }
    }

    // Simulate an in-flight forked runner whose job never finishes within the
    // drain window (e.g. a build still running when a deploy drains the worker).
    worker.inflightForkedChildren.add(/** @type {any} */ (fakeChild))
    worker.inflightForkedJobs.add(new Promise(() => {}))

    await worker.stop({timeoutMs: 10})

    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it("does not terminate forked runners that finish within the drain window", async () => {
    const worker = new BackgroundJobsWorker({forkedChildSigkillGraceMs: 10})

    /** @type {string[]} */
    const signals = []
    const fakeChild = {
      kill(signal) {
        signals.push(signal)

        return true
      }
    }

    // The runner finishes during the drain, so its child handle is removed
    // before reaping runs — no signal should be sent.
    worker.inflightForkedChildren.add(/** @type {any} */ (fakeChild))
    const finished = Promise.resolve()
    worker.inflightForkedJobs.add(finished)
    void finished.then(() => worker.inflightForkedChildren.delete(/** @type {any} */ (fakeChild)))

    await worker.stop({timeoutMs: 1000})

    expect(signals).toEqual([])
  })
})

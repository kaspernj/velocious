// @ts-check

import net from "node:net"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import LocalBackgroundJobsAdapter from "../../src/background-jobs/local-adapter.js"
import Configuration from "../../src/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @returns {JsonSocket} - Worker socket without a live network connection. */
function fakeWorkerSocket() {
  return new JsonSocket(new net.Socket())
}

describe("Local background jobs - worker handoff adoption", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("adopts only a reconnecting worker's durable local handoffs", async () => {
    const configuration = Configuration.current()
    const adapter = new LocalBackgroundJobsAdapter({configuration})
    const main = new BackgroundJobsMain({configuration, host: "127.0.0.1", port: 0})
    const worker = fakeWorkerSocket()

    main.store = adapter
    worker.workerId = "reconnecting-worker"
    main.workers.add(worker)
    main.workerHandoffs.set(worker, new Map())

    try {
      await adapter.store.clearAll()

      const ownId = await adapter.store.enqueue({jobName: "OwnJob", args: []})
      const ownHandoff = await adapter.store.markHandedOff({jobId: ownId, workerId: worker.workerId})
      const otherId = await adapter.store.enqueue({jobName: "OtherJob", args: []})

      await adapter.store.markHandedOff({jobId: otherId, workerId: "other-worker"})
      if (!ownHandoff) throw new Error("Expected the reconnecting worker's local handoff")

      await main._adoptWorkerHandoffs(worker)

      expect(main.workerHandoffs.get(worker)?.get(ownId)).toEqual(ownHandoff.handoffId)
      expect(main.workerHandoffs.get(worker)?.has(otherId)).toEqual(false)

      await main._handleWorkerSocketClosed(worker)

      expect((await adapter.store.getJob(ownId))?.status).toEqual("queued")
      expect((await adapter.store.getJob(otherId))?.status).toEqual("handed_off")
    } finally {
      await adapter.store.clearAll()
      worker.close()
    }
  })
})

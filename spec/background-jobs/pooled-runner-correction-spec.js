// @ts-check

import net from "node:net"
import { ChildProcess } from "node:child_process"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import { describe, expect, it } from "../../src/testing/test.js"

class RecordingJsonSocket extends JsonSocket {
  constructor() {
    super(new net.Socket())
    /** @type {import("../../src/background-jobs/types.js").BackgroundJobSocketMessage[]} */
    this.messages = []
  }

  /**
   * @param {import("../../src/background-jobs/types.js").BackgroundJobSocketMessage} message - Worker message.
   * @returns {void}
   */
  send(message) {
    this.messages.push(message)
  }
}

describe("Background jobs pooled-runner correction contracts", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("does not re-advertise a replacement slot when its drained predecessor exits", async () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 1})
    const socket = new RecordingJsonSocket()
    worker.jsonSocket = socket
    const retiredChild = new ChildProcess()
    const replacementChild = new ChildProcess()
    worker.inflightProcessChildren.add(retiredChild)
    worker.pooledChildStates.set(retiredChild, {
      createdAtMs: Date.now(),
      inflight: new Map(),
      jobsRun: 1,
      lastDispatchSeq: 1,
      retiring: true,
      shutdownReason: "parent_retire_drained",
      shutdownRequestedAtMs: Date.now(),
      shutdownSignal: "SIGTERM",
      started: true
    })
    worker.pooledChildren.add(replacementChild)
    worker.pooledChildStates.set(replacementChild, {
      createdAtMs: Date.now(),
      inflight: new Map(),
      jobsRun: 0,
      lastDispatchSeq: 0,
      retiring: false,
      started: true
    })

    try {
      // Completion advertised the replacement slot. Main may consume this
      // credit before its handoff reaches the replacement child.
      worker._sendReadyIfRunning()
      expect(socket.messages.length).toEqual(1)
      expect(socket.messages[0]?.availablePooledSlots).toEqual(1)

      await worker._handlePooledChildFailure({
        child: retiredChild,
        error: new Error("Drained pooled child exited"),
        exitCode: 0,
        origin: "exit",
        signal: null
      })

      expect(socket.messages.length).toEqual(1)
    } finally {
      socket.destroy()
    }
  })

  it("retains the deprecated termination reason mapping alongside exact shutdown provenance", () => {
    const worker = new BackgroundJobsWorker({})
    const child = new ChildProcess()
    /** @type {ReadonlyArray<readonly [import("../../src/background-jobs/types.js").PooledChildShutdownReason, import("../../src/background-jobs/types.js").PooledRunnerTerminationReason]>} */
    const mappings = [
      ["parent_retire_drained", "unexpected"],
      ["job_timeout", "job-timeout"],
      ["worker_stop", "worker-shutdown-timeout"],
      ["signal_sigterm", "unexpected"],
      ["signal_sigint", "unexpected"],
      ["signal_sigkill", "unexpected"],
      ["signal_other", "unexpected"],
      ["ipc_disconnect", "unexpected"],
      ["process_error", "unexpected"],
      ["unexpected_exit", "unexpected"]
    ]

    for (const [shutdownReason, terminationReason] of mappings) {
      const runnerFailure = worker._pooledRunnerFailure({
        child,
        exitCode: 1,
        origin: "exit",
        signal: null,
        state: {
          createdAtMs: Date.now(),
          inflight: new Map(),
          jobsRun: 0,
          lastDispatchSeq: 0,
          retiring: shutdownReason === "parent_retire_drained",
          shutdownReason,
          started: true
        }
      })

      expect(runnerFailure.shutdownReason).toEqual(shutdownReason)
      expect(runnerFailure.terminationReason).toEqual(terminationReason)
    }
  })
})

// @ts-check

import timeout from "awaitery/build/timeout.js"
import { startBackgroundJobsMain } from "../helpers/background-jobs-helper.js"
import { connectGenerationPeer } from "../helpers/background-jobs-generation-harness.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Background jobs generation handshake", () => {
  it("acknowledges same-generation worker, client, and reporter peers", async () => {
    const {main} = await startBackgroundJobsMain({
      backgroundJobsConfig: {generationId: "release-a", initialGenerationState: "active"}
    })
    /** @type {Awaited<ReturnType<typeof connectGenerationPeer>>[]} */
    const peers = []

    try {
      for (const role of ["worker", "client", "reporter"]) {
        const peer = await connectGenerationPeer(main.getPort())
        peers.push(peer)
        const messagePromise = peer.nextMessage()
        peer.jsonSocket.send({
          type: "hello",
          role,
          generationId: "release-a",
          ...(role === "worker" ? {workerId: "release-a:7e725e43-1887-4f19-a711-4731fe6caab2", supportsHandoffIdReporting: true} : {})
        })

        expect(await messagePromise).toEqual({
          type: "generation-accepted",
          generationId: "release-a",
          lifecycleState: "active"
        })
      }
    } finally {
      for (const peer of peers) await peer.close()
      await main.stop()
    }
  })

  it("rejects missing, malformed, unexpected, and mismatched generations without disclosure", async () => {
    const {main} = await startBackgroundJobsMain({
      backgroundJobsConfig: {generationId: "release-a", initialGenerationState: "active"}
    })
    /** @type {Awaited<ReturnType<typeof connectGenerationPeer>>[]} */
    const peers = []

    try {
      const cases = [
        {hello: {type: "hello", role: "client"}, reason: "missing-generation"},
        {hello: {type: "hello", role: "client", generationId: "bad:value"}, reason: "malformed-generation"},
        {hello: {type: "hello", role: "client", generationId: "release-b"}, reason: "generation-mismatch"}
      ]

      for (const testCase of cases) {
        const peer = await connectGenerationPeer(main.getPort())
        peers.push(peer)
        const messagePromise = peer.nextMessage()
        peer.jsonSocket.send(testCase.hello)
        const message = await messagePromise

        expect(message).toEqual({type: "generation-rejected", reason: testCase.reason})
        expect(JSON.stringify(message)).not.toMatch(/release-a/)
      }

      await main.stop()
      const legacyMain = (await startBackgroundJobsMain()).main
      const peer = await connectGenerationPeer(legacyMain.getPort())
      peers.push(peer)
      const messagePromise = peer.nextMessage()
      peer.jsonSocket.send({type: "hello", role: "client", generationId: "release-a"})
      expect(await messagePromise).toEqual({type: "generation-rejected", reason: "unexpected-generation"})
      await legacyMain.stop()
    } finally {
      for (const peer of peers) await peer.close()
      await main.stop()
    }
  })

  it("does not mutate through a client or reporter before generation acknowledgement", async () => {
    const {main, store} = await startBackgroundJobsMain({
      backgroundJobsConfig: {generationId: "release-a", initialGenerationState: "active"}
    })
    const peer = await connectGenerationPeer(main.getPort())
    const reporter = await connectGenerationPeer(main.getPort())

    try {
      peer.jsonSocket.send({type: "hello", role: "client", generationId: "release-b"})
      peer.jsonSocket.send({type: "enqueue", jobName: "GenerationHandshakeJob", args: []})
      expect(await peer.nextMessage()).toEqual({type: "generation-rejected", reason: "generation-mismatch"})

      await timeout({errorMessage: "Rejected peer mutated the durable queue", timeout: 1000}, async () => {
        expect(await store.nextAvailableJob()).toEqual(null)
      })

      const jobId = await store.enqueue({jobName: "GenerationHandshakeJob", args: [], options: {executionMode: "inline"}})
      const handoff = await store.markHandedOff({
        jobId,
        workerId: "release-a:7e725e43-1887-4f19-a711-4731fe6caab2"
      })
      if (!handoff) throw new Error("Expected a real handoff")
      const reporterAccepted = reporter.nextMessage()
      reporter.jsonSocket.send({type: "hello", role: "reporter", generationId: "release-a"})
      await reporterAccepted
      const rejectedReport = reporter.nextMessage()
      reporter.jsonSocket.send({type: "job-complete", jobId, workerId: "release-a:7e725e43-1887-4f19-a711-4731fe6caab2"})

      expect(await rejectedReport).toEqual({type: "job-update-error", jobId, error: "Generation ownership rejected"})
      expect((await store.getJob(jobId))?.status).toEqual("handed_off")
    } finally {
      await reporter.close()
      await peer.close()
      await main.stop()
    }
  })
})

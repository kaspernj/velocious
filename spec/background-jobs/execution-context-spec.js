// @ts-check

import promiseBarrier from "../helpers/promise-barrier.js"
import {
  currentBackgroundJobProducerProof,
  runWithBackgroundJobProducerProof
} from "../../src/background-jobs/execution-context.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Background job execution context", () => {
  it("keeps exact producer leases isolated across concurrent work and ordinary callbacks", async () => {
    const firstProof = {handedOffAtMs: 100, handoffId: "handoff-a", jobId: "job-a", workerId: "release-a:worker-a"}
    const secondProof = {handedOffAtMs: 200, handoffId: "handoff-b", jobId: "job-b", workerId: "release-a:worker-b"}
    const firstEntered = promiseBarrier()
    const secondEntered = promiseBarrier()
    /** @type {{first?: import("../../src/background-jobs/types.js").BackgroundJobProducerProof, second?: import("../../src/background-jobs/types.js").BackgroundJobProducerProof}} */
    const observed = {}
    const first = runWithBackgroundJobProducerProof(firstProof, async () => {
      firstEntered.entered()
      await secondEntered.waiting
      await new Promise((resolve) => queueMicrotask(resolve))
      const current = currentBackgroundJobProducerProof()
      observed.first = current
    })
    const second = runWithBackgroundJobProducerProof(secondProof, async () => {
      await firstEntered.waiting
      secondEntered.entered()
      await new Promise((resolve) => queueMicrotask(resolve))
      const current = currentBackgroundJobProducerProof()
      observed.second = current
    })

    await Promise.all([first, second])

    expect(observed).toEqual({first: firstProof, second: secondProof})
    expect(currentBackgroundJobProducerProof()).toEqual(undefined)
  })
})

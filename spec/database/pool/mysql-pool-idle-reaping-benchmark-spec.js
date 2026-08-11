// @ts-check

import { describe, expect, it } from "../../../src/testing/test.js"
import { percentile, runIdleReapingBenchmark, summarizeIdleReapingSamples } from "../../../benchmark/support/mysql-pool-idle-reaping.js"

describe("database - pool - MySQL idle reaping benchmark control flow", () => {
  it("runs every timeout against the same idle schedule and summarizes telemetry", async () => {
    const events = []
    let sequence = 0

    const samples = await runIdleReapingBenchmark({
      idleIntervalsMillis: [5001, 60001],
      idleTimeoutsMillis: [5000, 60000, null],
      prepare: async (idleTimeoutMillis) => { events.push(`prepare:${idleTimeoutMillis}`) },
      sample: async (idleTimeoutMillis) => {
        sequence++
        events.push(`sample:${idleTimeoutMillis}`)
        return {
          checkoutWaitMs: sequence,
          firstQueryMs: sequence * 10,
          idleReapDisposalCount: idleTimeoutMillis === null ? 0 : sequence,
          serverMetrics: {threadsConnected: 2, threadsCreated: sequence}
        }
      },
      sleep: async (milliseconds) => { events.push(`sleep:${milliseconds}`) }
    })

    expect(events).toEqual([
      "prepare:5000", "sleep:5001", "sample:5000", "sleep:60001", "sample:5000",
      "prepare:60000", "sleep:5001", "sample:60000", "sleep:60001", "sample:60000",
      "prepare:null", "sleep:5001", "sample:null", "sleep:60001", "sample:null"
    ])
    expect(summarizeIdleReapingSamples(samples)).toEqual([
      {checkoutWaitP95Ms: 2, firstQueryP50Ms: 10, firstQueryP95Ms: 20, idleReapDisposals: 2, idleTimeoutMillis: "5000", threadsConnectedAfter: 2, threadsCreatedAfter: 2, threadsCreatedDelta: 1},
      {checkoutWaitP95Ms: 4, firstQueryP50Ms: 30, firstQueryP95Ms: 40, idleReapDisposals: 4, idleTimeoutMillis: "60000", threadsConnectedAfter: 2, threadsCreatedAfter: 4, threadsCreatedDelta: 1},
      {checkoutWaitP95Ms: 6, firstQueryP50Ms: 50, firstQueryP95Ms: 60, idleReapDisposals: 0, idleTimeoutMillis: "disabled", threadsConnectedAfter: 2, threadsCreatedAfter: 6, threadsCreatedDelta: 1}
    ])
    expect(percentile([9, 1, 5, 3], 0.5)).toEqual(3)
  })
})

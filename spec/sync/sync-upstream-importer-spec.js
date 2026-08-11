// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import SyncUpstreamImporter from "../../src/sync/sync-upstream-importer.js"

/** @returns {SyncUpstreamImporter} Fresh importer for each example. */
function buildImporter() {
  return new SyncUpstreamImporter()
}

describe("SyncUpstreamImporter", () => {
  it("runs the importer and returns its result", async () => {
    const importer = buildImporter()
    const {imported, result} = await importer.import({key: "tickets:1", importer: async () => "done"})

    expect(imported).toBe(true)
    expect(result).toEqual("done")
  })

  it("coalesces concurrent imports for the same key onto one run", async () => {
    const importer = buildImporter()
    let runs = 0
    let release

    const gate = new Promise((resolve) => { release = resolve })
    const run = async () => {
      runs++
      await gate
      return `run-${runs}`
    }

    const first = importer.import({key: "tickets:1", importer: run})
    const second = importer.import({key: "tickets:1", importer: run})
    const third = importer.import({key: "tickets:1", importer: run})

    release()

    const [firstResult, secondResult, thirdResult] = await Promise.all([first, second, third])

    expect(runs).toEqual(1)
    expect(firstResult).toEqual({imported: true, result: "run-1"})
    expect(secondResult).toEqual({imported: true, result: "run-1"})
    expect(thirdResult).toEqual({imported: true, result: "run-1"})
  })

  it("runs separate keys independently", async () => {
    const importer = buildImporter()
    const imported = []

    await importer.import({key: "tickets:1", importer: async () => { imported.push("tickets:1") }})
    await importer.import({key: "tickets:2", importer: async () => { imported.push("tickets:2") }})

    expect(imported).toEqual(["tickets:1", "tickets:2"])
  })

  it("skips a throttled import when the last success is inside the window", async () => {
    const importer = buildImporter()
    let runs = 0
    const run = async () => { runs++ }

    await importer.import({key: "tickets:1", importer: run, throttleMs: 60000})
    const skipped = await importer.import({key: "tickets:1", importer: run, throttleMs: 60000})

    expect(runs).toEqual(1)
    expect(skipped).toEqual({imported: false, result: undefined})
  })

  it("re-runs a throttled import once the window has passed", async () => {
    let now = 1000
    const importer = new SyncUpstreamImporter({now: () => now})
    let runs = 0
    const run = async () => { runs++ }

    await importer.import({key: "tickets:1", importer: run, throttleMs: 60000})

    now += 60001

    const second = await importer.import({key: "tickets:1", importer: run, throttleMs: 60000})

    expect(runs).toEqual(2)
    expect(second.imported).toBe(true)
  })

  it("imports every time when no throttle is declared", async () => {
    const importer = buildImporter()
    let runs = 0
    const run = async () => { runs++ }

    await importer.import({key: "events:7", importer: run})
    await importer.import({key: "events:7", importer: run})

    expect(runs).toEqual(2)
  })

  it("propagates failures to every coalesced awaiter and does not start the throttle window", async () => {    const importer = buildImporter()
    let runs = 0
    const failing = async () => {
      runs++
      throw new Error("upstream down")
    }

    let firstError
    try {
      await importer.import({key: "tickets:1", importer: failing, throttleMs: 60000})
    } catch (error) {
      firstError = error
    }

    let secondError
    try {
      await importer.import({key: "tickets:1", importer: failing, throttleMs: 60000})
    } catch (error) {
      secondError = error
    }

    expect(/** @type {Error} */ (firstError).message).toEqual("upstream down")
    expect(/** @type {Error} */ (secondError).message).toEqual("upstream down")
    expect(runs).toEqual(2)
  })

  it("evicts success timestamps older than the maximum age so keys do not accumulate forever", async () => {
    let now = 1000
    const importer = new SyncUpstreamImporter({maxSuccessAgeMs: 60000, now: () => now})

    await importer.import({key: "tickets:1", importer: async () => {}})

    now += 1000

    await importer.import({key: "tickets:2", importer: async () => {}})

    expect(importer.lastSuccessAtByKey.size).toEqual(2)

    now += 60001

    // The next successful import sweeps tickets:1 and tickets:2, both older than the window.
    await importer.import({key: "tickets:3", importer: async () => {}})

    expect(importer.lastSuccessAtByKey.size).toEqual(1)
    expect(importer.lastSuccessAtByKey.has("tickets:3")).toBe(true)
  })
})

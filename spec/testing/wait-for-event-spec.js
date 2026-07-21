// @ts-check

import EventEmitter from "../../src/utils/event-emitter.js"
import waitForEvent from "../../src/testing/wait-for-event.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("waitForEvent", () => {
  it("resolves with the emitted value the moment the event fires", async () => {
    const emitter = new EventEmitter()
    const promise = waitForEvent(emitter, "ready")

    emitter.emit("ready", "value")

    expect(await promise).toEqual("value")
  })

  it("resolves with an array when the event emits multiple arguments", async () => {
    const emitter = new EventEmitter()
    const promise = waitForEvent(emitter, "pair")

    emitter.emit("pair", 1, 2)

    expect(await promise).toEqual([1, 2])
  })

  it("only resolves when the filter matches the emitted arguments", async () => {
    const emitter = new EventEmitter()
    const promise = waitForEvent(emitter, "job", {filter: (job) => job.id === 2})

    emitter.emit("job", {id: 1})
    emitter.emit("job", {id: 2})

    expect(await promise).toEqual({id: 2})
  })

  it("rejects immediately with the filter's error instead of waiting for the timeout when the filter throws", async () => {
    const emitter = new EventEmitter()
    const filterError = new Error("bad event shape")
    // A long timeout would make this test slow if the throw were swallowed and the
    // waiter left pending — it must reject on the throwing emission instead.
    const promise = waitForEvent(emitter, "job", {
      timeoutMs: 5000,
      filter: (job) => {
        if (job === undefined) throw filterError

        return job.id === 2
      }
    })

    emitter.emit("job", undefined)

    /** @type {unknown} */
    let rejected

    try {
      await promise
    } catch (error) {
      rejected = error
    }

    expect(rejected).toEqual(filterError)
    expect(emitter.listenerCount("job")).toEqual(0)
  })

  it("rejects after the timeout when the event never fires", async () => {
    const emitter = new EventEmitter()
    /** @type {unknown} */
    let rejected

    try {
      await waitForEvent(emitter, "never", {timeoutMs: 20})
    } catch (error) {
      rejected = error
    }

    expect(rejected instanceof Error).toEqual(true)
    expect(/** @type {Error} */ (rejected).message.includes("waiting for event \"never\"")).toEqual(true)
  })

  it("removes its listener after resolving and after timing out", async () => {
    const emitter = new EventEmitter()
    const resolvedPromise = waitForEvent(emitter, "ready")

    emitter.emit("ready")
    await resolvedPromise

    expect(emitter.listenerCount("ready")).toEqual(0)

    try {
      await waitForEvent(emitter, "late", {timeoutMs: 10})
    } catch {
      // expected timeout
    }

    expect(emitter.listenerCount("late")).toEqual(0)
  })
})

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

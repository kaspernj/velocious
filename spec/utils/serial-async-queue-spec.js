import {describe, expect, it} from "../../src/testing/test.js"
import SerialAsyncQueue from "../../src/utils/serial-async-queue.js"

/**
 * Resolves after the given number of milliseconds.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} - Resolves after the delay.
 */
const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

describe("SerialAsyncQueue", () => {
  it("runs queued callbacks one at a time in call order", async () => {
    const queue = new SerialAsyncQueue()
    const order = []
    let active = 0
    let maxActive = 0

    /**
     * Builds a callback that records overlap and completion order.
     * @param {number} id - Identifier recorded on completion.
     * @returns {() => Promise<number>} - Instrumented callback.
     */
    const make = (id) => async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await delay(5)
      order.push(id)
      active -= 1

      return id
    }

    const results = await Promise.all([
      queue.run(make(1)),
      queue.run(make(2)),
      queue.run(make(3))
    ])

    expect(maxActive).toEqual(1)
    expect(order.join(",")).toEqual("1,2,3")
    expect(results.join(",")).toEqual("1,2,3")
  })

  it("keeps running later callbacks after one rejects and propagates the rejection", async () => {
    const queue = new SerialAsyncQueue()
    const order = []

    const failing = queue.run(async () => {
      order.push("a")
      throw new Error("boom")
    })
    const following = queue.run(async () => {
      order.push("b")

      return "ok"
    })

    let caughtMessage

    try {
      await failing
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error)
    }

    const followingResult = await following

    expect(caughtMessage).toEqual("boom")
    expect(followingResult).toEqual("ok")
    expect(order.join(",")).toEqual("a,b")
  })
})

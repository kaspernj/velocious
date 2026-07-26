// @ts-check

import ClientDeliveryQueue from "../../src/http-server/client-delivery-queue.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @returns {{promise: Promise<void>, resolve: () => void}} - Manually resolved delivery.
 */
function deferredDelivery() {
  let resolve
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve
  })

  return {promise, resolve}
}

describe("HttpServer - client delivery queue", {databaseCleaning: {transaction: true}}, () => {
  it("preserves FIFO at both exact high-water boundaries and releases accounting on completion", async () => {
    const deliveries = []
    const first = deferredDelivery()
    const second = deferredDelivery()
    const queue = new ClientDeliveryQueue({
      clientCount: 1,
      maxBytes: 6,
      maxFrames: 2,
      onOverflow: () => {
        throw new Error("Unexpected overflow")
      }
    })
    const firstQueued = queue.enqueueFrame({
      byteLength: 3,
      delivery: async () => {
        deliveries.push("first")
        await first.promise
      }
    })
    const secondQueued = queue.enqueueFrame({
      byteLength: 3,
      delivery: async () => {
        deliveries.push("second")
        await second.promise
      }
    })

    expect(deliveries).toEqual(["first"])
    expect(queue.snapshot()).toEqual({pendingBytes: 6, pendingFrames: 2})

    first.resolve()
    await firstQueued
    expect(deliveries).toEqual(["first", "second"])
    expect(queue.snapshot()).toEqual({pendingBytes: 3, pendingFrames: 1})

    second.resolve()
    await secondQueued
    expect(queue.snapshot()).toEqual({pendingBytes: 0, pendingFrames: 0})
  })

  it("reports overflow once and explicitly releases queued and in-flight accounting", async () => {
    const blocked = deferredDelivery()
    const overflows = []
    const queue = new ClientDeliveryQueue({
      clientCount: 2,
      maxBytes: 4,
      maxFrames: 2,
      onOverflow: (error) => {
        overflows.push(error)
        queue.destroy()
      }
    })
    const active = queue.enqueueFrame({byteLength: 2, delivery: async () => await blocked.promise})
    const queued = queue.enqueueFrame({byteLength: 2, delivery: async () => {}})

    await expect(() => queue.enqueueFrame({byteLength: 1, delivery: async () => {}})).toThrow(/exceeded its outbound queue limit/u)
    await active
    await queued

    expect(overflows.length).toEqual(1)
    expect(queue.snapshot()).toEqual({pendingBytes: 0, pendingFrames: 0})

    blocked.resolve()
    queue.destroy()
    expect(overflows.length).toEqual(1)
  })

  it("isolates accounting, completion, and teardown between clients", async () => {
    const firstBlocked = deferredDelivery()
    const secondBlocked = deferredDelivery()
    const firstQueue = new ClientDeliveryQueue({clientCount: 3, maxBytes: 2, maxFrames: 1, onOverflow: () => firstQueue.destroy()})
    const secondQueue = new ClientDeliveryQueue({clientCount: 4, maxBytes: 2, maxFrames: 1, onOverflow: () => secondQueue.destroy()})
    const firstDelivery = firstQueue.enqueueFrame({byteLength: 2, delivery: async () => await firstBlocked.promise})
    const secondDelivery = secondQueue.enqueueFrame({byteLength: 2, delivery: async () => await secondBlocked.promise})

    await expect(() => firstQueue.enqueueFrame({byteLength: 1, delivery: async () => {}})).toThrow(/exceeded its outbound queue limit/u)
    expect(firstQueue.snapshot()).toEqual({pendingBytes: 0, pendingFrames: 0})
    expect(secondQueue.snapshot()).toEqual({pendingBytes: 2, pendingFrames: 1})

    secondBlocked.resolve()
    await secondDelivery
    await firstDelivery

    expect(secondQueue.snapshot()).toEqual({pendingBytes: 0, pendingFrames: 0})
    firstBlocked.resolve()
  })
})

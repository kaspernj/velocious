// @ts-check

import AdvisoryLockLockServerBackend from "../../src/database/advisory-lock-lock-server-backend.js"
import {AdvisoryLockServiceUnavailableError} from "../../src/database/advisory-lock-errors.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * Fake lock-server transport: records requests and answers synchronously from a
 * scripted response table, so the adapter's protocol handling is covered
 * without a network round trip or timer games.
 */
class FakeLockServerClient {
  /**
   * @param {{responses?: Record<string, Record<string, unknown>>}} [args] - Scripted responses per request type.
   */
  constructor({responses = {}} = {}) {
    this.responses = responses
    /** @type {Record<string, unknown>[]} */
    this.sent = []
    /** @type {((body: Record<string, unknown>) => void) | null} */
    this.onMessage = null
    this.closed = false
  }

  /** @returns {Promise<void>} - Resolves immediately. */
  async connect() {}

  /**
   * @param {string} type - Connection type.
   * @param {{onMessage: (body: Record<string, unknown>) => void}} args - Connection options.
   * @returns {{ready: Promise<void>, sendMessage: (body: Record<string, unknown>) => void}} - Fake connection.
   */
  openConnection(type, args) {
    void type
    this.onMessage = args.onMessage

    // The real server answers the connection-open frame (which carries the
    // auth token and protocol version) with a hello-ack.
    queueMicrotask(() => this.push({leaseMs: 30_000, protocolVersion: 2, type: "hello-ack"}))

    return {
      ready: Promise.resolve(),
      sendMessage: (/** @type {Record<string, unknown>} */ body) => this.handleSend(body)
    }
  }

  /** @returns {void} */
  close() {
    this.closed = true
  }

  /**
   * Answers one outbound message the way the real server would.
   * @param {Record<string, unknown>} body - Outbound message.
   * @returns {void}
   */
  handleSend(body) {
    this.sent.push(body)

    const response = this.responses[String(body.type)] ?? {status: "acquired"}

    this.push({...response, correlationId: body.correlationId, type: "response"})
  }

  /**
   * Pushes one server message into the adapter.
   * @param {Record<string, unknown>} body - Message.
   * @returns {void}
   */
  push(body) {
    if (!this.onMessage) throw new Error("Connection is not open")

    this.onMessage(body)
  }
}

describe("AdvisoryLockLockServerBackend", () => {
  it("acquires a lease, reports its epoch and releases it", async () => {
    const client = new FakeLockServerClient({responses: {
      acquire: {epoch: 41, leaseExpiresAt: Date.now() + 30_000, status: "acquired"},
      release: {status: "released"}
    }})
    const backend = new AdvisoryLockLockServerBackend({
      clientFactory: () => client,
      url: "ws://lock.test:3006/websocket"
    })

    expect(await backend.acquire("unit-acquire", {timeoutMs: 500})).toEqual(true)
    expect(backend.getHoldEpoch("unit-acquire")).toEqual(41)
    expect(backend.getStatus().connected).toEqual(true)

    await backend.release("unit-acquire")

    expect(backend.getHoldEpoch("unit-acquire")).toBeNull()
    expect(client.sent.map((message) => message.type)).toEqual(["acquire", "release"])
  })

  it("reports contention instead of waiting for an immediate try-acquire", async () => {
    const client = new FakeLockServerClient({responses: {["try-acquire"]: {status: "busy"}}})
    const backend = new AdvisoryLockLockServerBackend({clientFactory: () => client, url: "ws://lock.test:3006/websocket"})

    expect(await backend.tryAcquire("unit-busy")).toEqual(false)
    expect(backend.getHoldEpoch("unit-busy")).toBeNull()
  })

  it("marks a hold lost when the server fences it", async () => {
    const client = new FakeLockServerClient({responses: {
      ["try-acquire"]: {epoch: 7, leaseExpiresAt: Date.now() + 30_000, status: "acquired"}
    }})
    const backend = new AdvisoryLockLockServerBackend({clientFactory: () => client, url: "ws://lock.test:3006/websocket"})

    expect(await backend.tryAcquire("unit-fenced")).toEqual(true)

    client.push({epoch: 8, name: "unit-fenced", type: "lost"})

    expect(backend.getHoldEpoch("unit-fenced")).toBeNull()
    expect(backend.takeLoss("unit-fenced", 7)).toEqual({currentEpoch: 8, epoch: 7})
    expect(backend.takeLoss("unit-fenced", 7)).toBeNull()
  })

  it("fails loudly and caches the outage when the server is unreachable", async () => {
    let attempts = 0
    const backend = new AdvisoryLockLockServerBackend({
      clientFactory: () => {
        attempts++

        return {
          async connect() {
            throw new Error("ECONNREFUSED")
          },
          openConnection() {
            throw new Error("never reached")
          }
        }
      },
      reprobeCooldownMs: 60_000,
      url: "ws://lock.test:3006/websocket"
    })

    let firstError

    try {
      await backend.acquire("unit-down", {timeoutMs: 0})
    } catch (error) {
      firstError = error
    }

    expect(firstError).toBeInstanceOf(AdvisoryLockServiceUnavailableError)
    expect(/** @type {AdvisoryLockServiceUnavailableError} */ (firstError).reason).toEqual("connect-failed")
    expect(backend.getStatus().lastError).toContain("ECONNREFUSED")

    let secondError

    try {
      await backend.acquire("unit-down", {timeoutMs: 0})
    } catch (error) {
      secondError = error
    }

    expect(secondError).toBeInstanceOf(AdvisoryLockServiceUnavailableError)
    expect(/** @type {AdvisoryLockServiceUnavailableError} */ (secondError).reason).toEqual("cooldown")
    expect(attempts).toEqual(1)
  })
})

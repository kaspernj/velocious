// @ts-check

import WebSocket from "ws"

import VelociousWebsocketClient from "../http-client/websocket-client.js"
import {AdvisoryLockServiceUnavailableError} from "./advisory-lock-errors.js"

/**
 * @typedef {object} LockServerConnectionLike
 * @property {Promise<void>} ready - Resolves when the server accepted the 1:1 connection.
 * @property {(body: Record<string, unknown>) => void} sendMessage - Sends one connection message.
 * @property {() => void} [close] - Closes the connection.
 * @typedef {object} LockServerClientLike
 * @property {() => Promise<void>} connect - Opens the transport.
 * @property {(type: string, args: {onMessage: (body: Record<string, unknown>) => void, params: Record<string, unknown>, timeoutMs: number}) => LockServerConnectionLike} openConnection - Opens the 1:1 connection.
 * @property {() => Promise<void> | void} [close] - Closes the transport.
 * @typedef {{epoch: number, name: string, timer: ReturnType<typeof setInterval>, leaseExpiresAt: number}} LockServerHold
 * @typedef {{status: "acquired", epoch: number, leaseExpiresAt: number} | {status: "busy"} | {status: "timeout"}} LockServerAcquireResult
 */

/** Protocol version spoken by the centralized lock server (consens-lock v2). */
export const LOCK_SERVER_PROTOCOL_VERSION = 2

/** Connection role registered on the lock server. */
const LOCK_SERVER_CONNECTION_TYPE = "lock"

/**
 * Tier (b) backend: the centralized lock server (`consens-lock`, protocol v2).
 *
 * The server holds every lock in its own process memory, so a held lock never
 * pins a database connection — that is the whole point of this tier. Ownership
 * is bound to this process's connection: the server mints the `holderId`, so a
 * client can only renew or release its own leases, and a dropped connection
 * releases all of them immediately.
 *
 * Holds are leases renewed every third of the lease window. A fenced lease
 * (the server granted the name to another holder after an expiry or partition)
 * is recorded per lock name and surfaced by the runner as
 * `AdvisoryLockLostError` after the critical section settles.
 *
 * Unavailability is cached for `reprobeCooldownMs` so a flapping server cannot
 * turn every waiting caller into a connection attempt (design §2).
 */
export default class AdvisoryLockLockServerBackend {
  /**
   * Creates the lock-server backend. The transport is created on first use, so
   * constructing this object never performs I/O.
   * @param {object} args - Backend options.
   * @param {string} [args.authToken] - Shared secret; the server fails closed without a matching token.
   * @param {(args: {authToken: string, url: string}) => LockServerClientLike} [args.clientFactory] - Transport factory (tests inject a fake).
   * @param {number} [args.connectTimeoutMs] - Handshake timeout.
   * @param {number} [args.leaseMs] - Lease duration used until the server advertises its own.
   * @param {(error: Error) => void} [args.onError] - Async error reporter.
   * @param {number} [args.reprobeCooldownMs] - How long an unavailable server is not re-probed.
   * @param {string} args.url - Lock-server websocket URL.
   */
  constructor({authToken = "", clientFactory = defaultClientFactory, connectTimeoutMs = 3000, leaseMs = 30_000, onError, reprobeCooldownMs = 5000, url}) {
    this.url = url
    this.authToken = authToken
    this.clientFactory = clientFactory
    this.connectTimeoutMs = connectTimeoutMs
    this.leaseMs = leaseMs
    this.onError = onError
    this.reprobeCooldownMs = reprobeCooldownMs
    /** @type {LockServerClientLike | null} */
    this.client = null
    /** @type {LockServerConnectionLike | null} */
    this.connection = null
    /** @type {Promise<void> | null} */
    this.connectPromise = null
    /** @type {{reject: (error: Error) => void, resolve: () => void, timer: ReturnType<typeof setTimeout> | null} | null} */
    this.helloWaiter = null
    /** @type {Map<string, {epoch: number, name: string, timer: ReturnType<typeof setInterval>, leaseExpiresAt: number}>} */
    this.holds = new Map()
    /** @type {Map<string, {currentEpoch: number | null, epoch: number | null}>} */
    this.fencedHolds = new Map()
    /** @type {Map<string, {reject: (error: Error) => void, resolve: (message: Record<string, unknown>) => void, timer: ReturnType<typeof setTimeout> | null}>} */
    this.pending = new Map()
    /** @type {{lastError: string | null, lastProbeAt: string | null, unavailableUntil: number}} */
    this.status = {lastError: null, lastProbeAt: null, unavailableUntil: 0}
    this.requestCounter = 0
    this.closed = false
  }

  /**
   * Opens the connection if needed, honoring the re-probe cooldown.
   * @param {string} lockName - Lock name, for error messages.
   * @returns {Promise<void>} - Resolves when connected.
   */
  async ensureConnected(lockName) {
    if (this.closed) throw new AdvisoryLockServiceUnavailableError("Lock server backend is closed", {lockName, reason: "closed"})
    if (this.connection) return
    if (this.connectPromise) return await this.connectPromise

    if (Date.now() < this.status.unavailableUntil) {
      throw new AdvisoryLockServiceUnavailableError(
        `Lock server ${this.url} is marked unavailable: ${String(this.status.lastError)}`,
        {lockName, reason: "cooldown"}
      )
    }

    this.connectPromise = this.openConnection(lockName)

    try {
      await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  /**
   * Opens the transport and completes the hello handshake.
   * @param {string} lockName - Lock name, for error messages.
   * @returns {Promise<void>} - Resolves when the handshake completed.
   */
  async openConnection(lockName) {
    this.status.lastProbeAt = new Date().toISOString()

    try {
      const client = this.clientFactory({authToken: this.authToken, url: this.url})

      this.client = client
      await client.connect()

      /** @type {Promise<void>} */
      const helloPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new AdvisoryLockServiceUnavailableError(
            `Lock server ${this.url} did not answer the handshake within ${this.connectTimeoutMs}ms`,
            {lockName, reason: "handshake-timeout"}
          ))
        }, this.connectTimeoutMs)

        timer.unref?.()
        this.helloWaiter = {reject, resolve, timer}
      })

      const connection = client.openConnection(LOCK_SERVER_CONNECTION_TYPE, {
        onMessage: (body) => this.handleMessage(body),
        params: {authToken: this.authToken, protocolVersion: LOCK_SERVER_PROTOCOL_VERSION},
        timeoutMs: this.connectTimeoutMs
      })

      this.connection = connection
      await connection.ready
      await helloPromise

      this.status.lastError = null
      this.status.unavailableUntil = 0
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))

      this.markUnavailable(normalized)
      this.teardown()

      throw new AdvisoryLockServiceUnavailableError(
        `Lock server ${this.url} is unavailable: ${normalized.message}`,
        {lockName, reason: "connect-failed"}
      )
    }
  }

  /**
   * Waits for a lock through the server's FIFO queue.
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [args] - Bounded wait; the server defaults to 30s.
   * @returns {Promise<boolean>} - True when the lease was granted, false on timeout.
   */
  async acquire(name, {timeoutMs} = {}) {
    await this.ensureConnected(name)

    /** @type {LockServerAcquireResult} */
    const result = /** @type {LockServerAcquireResult} */ (await this.request("acquire", {
      name,
      timeoutMs: typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : undefined
    }, typeof timeoutMs === "number" ? timeoutMs + this.connectTimeoutMs : null))

    if (result.status === "acquired") {
      this.startRenewal(name, result.epoch)

      return true
    }

    if (result.status === "busy") return false

    return false
  }

  /**
   * Takes a lock only if the server grants it immediately.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True when granted.
   */
  async tryAcquire(name) {
    await this.ensureConnected(name)

    /** @type {LockServerAcquireResult} */
    const result = /** @type {LockServerAcquireResult} */ (await this.request("try-acquire", {name}))

    if (result.status !== "acquired") return false

    this.startRenewal(name, result.epoch)

    return true
  }

  /**
   * Releases a held lease and stops its renewal.
   * @param {string} name - Lock name.
   * @returns {Promise<void>} - Resolves when released (or when the transport is gone).
   */
  async release(name) {
    const hold = this.holds.get(name)

    if (!hold) return

    this.holds.delete(name)
    clearInterval(hold.timer)

    if (!this.connection) return

    try {
      await this.request("release", {epoch: hold.epoch, name})
    } catch (error) {
      if (!(error instanceof AdvisoryLockServiceUnavailableError)) throw error
      // The server releases every lease of a closed connection, and the lease
      // expires otherwise; both paths reclaim the name.
      this.reportError(error)
    }
  }

  /**
   * Releases every lease this process holds (shutdown path).
   * @returns {Promise<void>} - Resolves when every lease was released.
   */
  async releaseAllHeld() {
    for (const name of [...this.holds.keys()]) await this.release(name)
  }

  /**
   * Runs the server's live holder list (diagnostics).
   * @returns {Promise<Record<string, unknown>[]>} - Live holders.
   */
  async list() {
    const response = await this.request("list", {})
    const holders = response.holders

    return /** @type {Record<string, unknown>[]} */ (Array.isArray(holders) ? holders : [])
  }

  /**
   * Runs who-holds for one name (diagnostics).
   * @param {string} name - Lock name.
   * @returns {Promise<Record<string, unknown> | null>} - Holder, or null.
   */
  async whoHolds(name) {
    const response = await this.request("who-holds", {name})
    const holder = response.holder

    return /** @type {Record<string, unknown> | null} */ (holder && typeof holder === "object" ? holder : null)
  }

  /**
   * Runs the fencing epoch granted for one held lease.
   * @param {string} name - Lock name.
   * @returns {number | null} - Granted epoch, or null when the lease is not (or no longer) held.
   */
  getHoldEpoch(name) {
    return this.holds.get(name)?.epoch ?? null
  }

  /**
   * Whether this hold was fenced or lost during its critical section.
   * @param {string} name - Lock name.
   * @param {number | null} epoch - Epoch the hold was granted.
   * @returns {{currentEpoch: number | null, epoch: number | null} | null} - Fencing details when lost.
   */
  takeLoss(name, epoch) {
    const loss = this.fencedHolds.get(name)

    if (loss) {
      this.fencedHolds.delete(name)

      return loss
    }

    const hold = this.holds.get(name)

    if (hold && hold.epoch !== epoch) return {currentEpoch: hold.epoch, epoch}

    return null
  }

  /**
   * Reports connection state and the names currently leased through this
   * process, for `getAdvisoryLockBackendStatus()`.
   * @returns {{connected: boolean, lastError: string | null, lastProbeAt: string | null, leasedNames: string[]}} - Backend status for diagnostics.
   */
  getStatus() {
    return {
      connected: Boolean(this.connection),
      lastError: this.status.lastError,
      lastProbeAt: this.status.lastProbeAt,
      leasedNames: [...this.holds.keys()]
    }
  }

  /**
   * Closes the backend: explicit release first, then the transport.
   * @returns {Promise<void>} - Resolves when closed.
   */
  async close() {
    this.closed = true
    await this.releaseAllHeld()

    this.teardown()
  }

  /**
   * Dispatches one server message.
   * @param {Record<string, unknown>} body - Server message.
   * @returns {void}
   */
  handleMessage(body) {
    if (!body || typeof body !== "object") return

    if (body.type === "hello-ack") {
      const advertisedLeaseMs = Number(body.leaseMs)

      if (Number.isFinite(advertisedLeaseMs) && advertisedLeaseMs > 0) this.leaseMs = advertisedLeaseMs

      const helloWaiter = this.helloWaiter

      this.helloWaiter = null
      if (helloWaiter) {
        if (helloWaiter.timer) clearTimeout(helloWaiter.timer)
        helloWaiter.resolve()
      }

      return
    }

    if (body.type === "lost") {
      const name = String(body.name ?? "")
      const hold = this.holds.get(name)

      if (!hold) return

      this.holds.delete(name)
      clearInterval(hold.timer)
      this.fencedHolds.set(name, {currentEpoch: Number(body.epoch ?? 0), epoch: hold.epoch})

      return
    }

    if (body.type !== "response" || typeof body.correlationId !== "string") return

    const pending = this.pending.get(body.correlationId)

    if (!pending) return

    this.pending.delete(body.correlationId)
    if (pending.timer) clearTimeout(pending.timer)

    if (body.status === "error") {
      pending.reject(new Error(String(body.error || "Lock server error")))

      return
    }

    pending.resolve(body)
  }

  /**
   * Sends one request and awaits its correlated response.
   * @param {string} type - Request type.
   * @param {Record<string, unknown>} payload - Request fields.
   * @param {number | null} [timeoutMs] - Response timeout; null waits for the server.
   * @returns {Promise<Record<string, unknown>>} - Response body.
   */
  async request(type, payload, timeoutMs = null) {
    const connection = this.connection

    if (!connection) {
      throw new AdvisoryLockServiceUnavailableError("Lock server connection is not open", {lockName: String(payload.name ?? ""), reason: "not-connected"})
    }

    const correlationId = `req-${++this.requestCounter}`

    return await new Promise((resolve, reject) => {
      const timer = typeof timeoutMs === "number" && timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(correlationId)
          reject(new AdvisoryLockServiceUnavailableError(
            `Lock server request timed out: ${type} ${String(payload.name ?? "")}`,
            {lockName: String(payload.name ?? ""), reason: "request-timeout"}
          ))
        }, timeoutMs)
        : null

      timer?.unref?.()
      this.pending.set(correlationId, {reject, resolve, timer})

      try {
        connection.sendMessage({...payload, correlationId, type})
      } catch (error) {
        this.pending.delete(correlationId)
        if (timer) clearTimeout(timer)
        this.markUnavailable(error instanceof Error ? error : new Error(String(error)))
        reject(new AdvisoryLockServiceUnavailableError(
          `Lock server send failed: ${error instanceof Error ? error.message : String(error)}`,
          {lockName: String(payload.name ?? ""), reason: "send-failed"}
        ))
      }
    })
  }

  /**
   * Starts lease renewal for a granted lock.
   * @param {string} name - Lock name.
   * @param {number} epoch - Granted epoch.
   * @returns {void}
   */
  startRenewal(name, epoch) {
    const existing = this.holds.get(name)

    if (existing) clearInterval(existing.timer)

    const intervalMs = Math.max(250, Math.floor(this.leaseMs / 3))
    const timer = setInterval(() => {
      void this.renew(name, epoch)
    }, intervalMs)

    timer.unref?.()
    this.holds.set(name, {epoch, leaseExpiresAt: Date.now() + this.leaseMs, name, timer})
  }

  /**
   * Renews one lease; a fenced lease is recorded for the runner to surface.
   * @param {string} name - Lock name.
   * @param {number} epoch - Epoch the hold believes it owns.
   * @returns {Promise<void>} - Resolves after the renewal round-trip.
   */
  async renew(name, epoch) {
    const hold = this.holds.get(name)

    if (!hold || !this.connection) return

    try {
      const response = await this.request("renew", {epoch, name}, this.connectTimeoutMs * 2)
      const status = String(response.status)

      if (status === "renewed") {
        hold.leaseExpiresAt = Number(response.leaseExpiresAt)

        return
      }

      if (status === "lost" || status === "not-found") {
        this.holds.delete(name)
        clearInterval(hold.timer)
        this.fencedHolds.set(name, {currentEpoch: Number(response.currentEpoch ?? 0), epoch})
      }
    } catch (error) {
      if (!(error instanceof AdvisoryLockServiceUnavailableError)) throw error

      // A lease that cannot be renewed can no longer be proven to be ours: the
      // server may have fenced it while the transport was failing. Recording it
      // as lost is the only honest answer, and stops the renewal loop.
      this.markUnavailable(error)
      this.holds.delete(name)
      clearInterval(hold.timer)
      this.fencedHolds.set(name, {currentEpoch: null, epoch})
      this.reportError(error)
    }
  }

  /**
   * Records that the lock server is unreachable and starts the re-probe cooldown.
   * @param {Error} error - Failure.
   * @returns {void}
   */
  markUnavailable(error) {
    this.status.lastError = error.message
    this.status.lastProbeAt = new Date().toISOString()
    this.status.unavailableUntil = Date.now() + this.reprobeCooldownMs
  }

  /**
   * Drops transport state and marks every outstanding hold lost.
   * @returns {void}
   */
  teardown() {
    for (const [name, hold] of this.holds) {
      clearInterval(hold.timer)
      this.fencedHolds.set(name, {currentEpoch: null, epoch: hold.epoch})
    }

    this.holds.clear()

    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new AdvisoryLockServiceUnavailableError("Lock server connection dropped", {lockName: "", reason: "connection-dropped"}))
    }

    this.pending.clear()

    const connection = this.connection
    const client = this.client

    this.connection = null
    this.client = null

    try {
      connection?.close?.()
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)))
    }

    try {
      void client?.close?.()
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Reports a transport-side failure without breaking lock handling.
   * @param {unknown} error - Failure to report.
   * @returns {void}
   */
  reportError(error) {
    const normalized = error instanceof Error ? error : new Error(String(error))

    this.status.lastError = normalized.message

    if (this.onError) this.onError(normalized)
  }
}

/**
 * Default transport factory: the framework websocket client with the Node
 * `ws` implementation bound explicitly (no global mutation).
 * @param {{authToken: string, url: string}} args - Connection args.
 * @returns {LockServerClientLike} - Websocket client.
 */
function defaultClientFactory({url}) {
  // Node's global WebSocket is not guaranteed to exist, so the implementation is
  // bound explicitly instead of mutating `globalThis`.
  const webSocketImplementation = /** @type {typeof globalThis.WebSocket} */ (/** @type {unknown} */ (WebSocket))

  return /** @type {LockServerClientLike} */ (/** @type {unknown} */ (new VelociousWebsocketClient({
    heartbeatIntervalMs: 10_000,
    url,
    webSocketImplementation
  })))
}

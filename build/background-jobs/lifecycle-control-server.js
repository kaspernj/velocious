// @ts-check

import fs from "node:fs/promises"
import { randomUUID } from "node:crypto"
import net from "node:net"
import path from "node:path"
import JsonSocket from "./json-socket.js"
import { validateGenerationId } from "./generation-identity.js"

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Package-owned acknowledged lifecycle control server. */
export default class BackgroundJobsLifecycleControlServer {
  /**
   * Creates a lifecycle control server.
   * @param {object} args - Server options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} args.generationId - Exact generation identity.
   * @param {import("./main.js").default} args.main - Owned jobs main.
   * @param {string} args.socketPath - Release-local Unix socket path.
   */
  constructor({configuration, generationId, main, socketPath}) {
    this.configuration = configuration
    this.generationId = validateGenerationId(generationId)
    this.main = main
    this.socketPath = socketPath
    /** @type {net.Server | undefined} */
    this.server = undefined
    /** @type {{dev: number, ino: number} | undefined} */
    this.ownedSocketIdentity = undefined
    /** @type {Set<net.Socket>} */
    this.connections = new Set()
  }

  /**
   * Starts the secure local listener.
   * @returns {Promise<void>} - Resolves after secure listen.
   */
  async start() {
    await this._validateParentDirectory()
    await this._removeStaleOwnedSocket()
    const server = net.createServer((socket) => this._handleConnection(socket))
    this.server = server

    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(this.socketPath, () => resolve(undefined))
      })
      await fs.chmod(this.socketPath, 0o600)
      const stat = await fs.lstat(this.socketPath)
      this.ownedSocketIdentity = {dev: stat.dev, ino: stat.ino}
    } catch (error) {
      await this.close()
      throw error
    }
  }

  /**
   * Closes the owned listener.
   * @returns {Promise<void>} - Closes connections, listener, and only its owned path.
   */
  async close() {
    for (const socket of this.connections) socket.destroy()
    this.connections.clear()

    const server = this.server
    this.server = undefined
    const protectedReplacement = await this._protectReplacementDuringServerClose()
    try {
      if (server?.listening) await new Promise((resolve) => server.close(() => resolve(undefined)))
    } finally {
      await this._restoreProtectedReplacement(protectedReplacement)
    }
    await this._unlinkOwnedSocket()
  }

  /**
   * Moves a replacement inode aside because Node unlinks its original Unix
   * socket pathname during `server.close()` without checking the inode.
   * @returns {Promise<string | undefined>} - Protected sibling path.
   */
  async _protectReplacementDuringServerClose() {
    const identity = this.ownedSocketIdentity
    if (!identity) return undefined

    let stat
    try {
      stat = await fs.lstat(this.socketPath)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    }
    if (stat.dev === identity.dev && stat.ino === identity.ino) return undefined

    const protectedPath = `${this.socketPath}.velocious-protected-${randomUUID()}`
    await fs.rename(this.socketPath, protectedPath)

    return protectedPath
  }

  /**
   * Restores an inode protected across Node's automatic Unix-socket unlink.
   * @param {string | undefined} protectedPath - Protected sibling path.
   * @returns {Promise<void>} - Resolves after restoration.
   */
  async _restoreProtectedReplacement(protectedPath) {
    if (!protectedPath) return

    try {
      await fs.lstat(this.socketPath)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        await fs.rename(protectedPath, this.socketPath)
        return
      }
      throw error
    }

    throw new Error(`Lifecycle socket replacement preserved at ${protectedPath} because its original path was occupied during close`)
  }

  /** Validates that the parent is a process-owned real directory inside the release. */
  async _validateParentDirectory() {
    if (!path.isAbsolute(this.socketPath)) throw new TypeError("Background jobs lifecycle socket path must be absolute")

    const parentPath = path.dirname(this.socketPath)
    const parentStat = await fs.lstat(parentPath)
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new Error("Background jobs lifecycle socket parent must be a real directory")
    }
    if (typeof process.getuid === "function" && parentStat.uid !== process.getuid()) {
      throw new Error("Background jobs lifecycle socket parent must be owned by the process user")
    }

    const [releasePath, realParentPath] = await Promise.all([
      fs.realpath(this.configuration.getDirectory()),
      fs.realpath(parentPath)
    ])
    const relative = path.relative(releasePath, realParentPath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Background jobs lifecycle socket parent must be inside the release directory")
    }
  }

  /** Removes only a same-owner, unchanged, stale socket inode. */
  async _removeStaleOwnedSocket() {
    let stat
    try {
      stat = await fs.lstat(this.socketPath)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return
      throw error
    }

    if (stat.isSymbolicLink()) throw new Error("Refusing lifecycle socket symlink collision")
    if (!stat.isSocket()) throw new Error("Refusing lifecycle socket non-socket collision")
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error("Refusing lifecycle socket owned by another user")
    }
    if (await this._socketAcceptsConnections()) throw new Error("Background jobs lifecycle socket is already active")

    const current = await fs.lstat(this.socketPath)
    if (!current.isSocket() || current.dev !== stat.dev || current.ino !== stat.ino) {
      throw new Error("Lifecycle socket collision changed during stale cleanup")
    }
    await fs.unlink(this.socketPath)
  }

  /**
   * Probes a socket collision.
   * @returns {Promise<boolean>} - Whether the existing socket accepts a connection.
   */
  async _socketAcceptsConnections() {
    return await new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      socket.once("connect", () => {
        socket.end()
        resolve(true)
      })
      socket.once("error", (error) => {
        if ("code" in error && (error.code === "ECONNREFUSED" || error.code === "ENOENT")) {
          resolve(false)
        } else {
          reject(error)
        }
      })
    })
  }

  /** Unlinks the path only while it is still the inode created by this server. */
  async _unlinkOwnedSocket() {
    const identity = this.ownedSocketIdentity
    this.ownedSocketIdentity = undefined
    if (!identity) return

    let stat
    try {
      stat = await fs.lstat(this.socketPath)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return
      throw error
    }
    if (!stat.isSocket() || stat.dev !== identity.dev || stat.ino !== identity.ino) return
    await fs.unlink(this.socketPath)
  }

  /**
   * Handles a local connection.
   * @param {net.Socket} socket - Accepted local connection.
   */
  _handleConnection(socket) {
    this.connections.add(socket)
    socket.once("close", () => this.connections.delete(socket))
    const jsonSocket = new JsonSocket(socket)
    let handled = false

    jsonSocket.on("message", (message) => {
      if (handled) {
        socket.destroy()
        return
      }
      handled = true
      void this._handleRequest({message, socket})
    })
    jsonSocket.on("error", (error) => {
      this._emitLifecycleFailure({action: "invalid", error, requestId: "invalid"})
      socket.destroy()
    })
  }

  /**
   * Handles exactly one request and holds retirement open through response flush.
   * @param {object} args - Request context.
   * @param {ReturnType<typeof JSON.parse>} args.message - Parsed message.
   * @param {net.Socket} args.socket - Control socket.
   * @returns {Promise<void>} - Resolves after the response is queued.
   */
  async _handleRequest({message, socket}) {
    const action = message?.action
    const requestId = message?.requestId
    this.main.acquireLifecycleRequestLease()

    try {
      this._validateRequest(message)
      if (action === "activate") await this.main.activate()
      else await this.main.retire()

      this._writeResponse(socket, {
        type: "background-jobs-lifecycle-ack",
        action,
        generationId: this.generationId,
        lifecycleState: this.main.getLifecycleState(),
        requestId
      })
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      this._emitLifecycleFailure({action: typeof action === "string" ? action : "invalid", error: normalizedError, requestId: typeof requestId === "string" ? requestId : "invalid"})
      this._writeResponse(socket, {
        type: "background-jobs-lifecycle-error",
        action,
        generationId: typeof message?.generationId === "string" ? message.generationId : "invalid",
        requestId,
        error: {name: normalizedError.name, message: normalizedError.message, stack: normalizedError.stack}
      })
    }
  }

  /**
   * Validates one lifecycle request.
   * @param {ReturnType<typeof JSON.parse>} message - Request.
   */
  _validateRequest(message) {
    if (message?.type !== "background-jobs-lifecycle") throw new Error("Invalid background jobs lifecycle request type")
    if (message.action !== "activate" && message.action !== "retire") throw new Error("Invalid background jobs lifecycle action")
    if (message.generationId !== this.generationId) throw new Error("Background jobs lifecycle generation mismatch")
    if (typeof message.requestId !== "string" || !REQUEST_ID_PATTERN.test(message.requestId)) {
      throw new Error("Invalid background jobs lifecycle requestId")
    }
  }

  /**
   * Writes one lifecycle response.
   * @param {net.Socket} socket - Response socket.
   * @param {ReturnType<typeof JSON.parse>} response - Response.
   */
  _writeResponse(socket, response) {
    socket.write(`${JSON.stringify(response)}\n`, () => {
      this.main.releaseLifecycleRequestLease()
      socket.end()
    })
  }

  /**
   * Emits a lifecycle failure where ignored hook stdio cannot hide it.
   * @param {object} args - Failure context.
   * @param {string} args.action - Requested action.
   * @param {Error} args.error - Original error.
   * @param {string} args.requestId - Request id.
   */
  _emitLifecycleFailure({action, error, requestId}) {
    const payload = {
      context: {action, generationId: this.generationId, requestId, stage: "background-jobs-lifecycle-control"},
      error
    }
    const errorEvents = this.configuration.getErrorEvents()
    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }
}

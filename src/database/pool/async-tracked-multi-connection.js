// @ts-check

import {AsyncLocalStorage} from "async_hooks"
import BasePool from "./base.js"

export default class VelociousDatabasePoolAsyncTrackedMultiConnection extends BasePool {
  asyncLocalStorage = new AsyncLocalStorage()

  /** @type {import("../drivers/base.js").default[]} */
  connections = []

  /** @type {Record<number, import("../drivers/base.js").default>} */
  connectionsInUse = {}

  idSeq = 0

  /**
   * @param {object} args
   * @param {import("../../configuration.js").default} args.configuration
   * @param {string} args.identifier
   */
  constructor({configuration, identifier}) {
    super({configuration, identifier})
  }

  /**
   * @param {import("../drivers/base.js").default} connection
   */
  checkin(connection) {
    const id = connection.getIdSeq()

    if (typeof id !== "number") {
      throw new Error(`idSeq on connection wasn't set? '${typeof id}' = ${id}`)
    }

    if (id in this.connectionsInUse) {
      delete this.connectionsInUse[id]
    }

    connection.setIdSeq(undefined)

    this.connections.push(connection)
  }

  /**
   * @returns {Promise<import("../drivers/base.js").default>}
   */
  async checkout() {
    let connection = this.connections.shift()

    if (!connection) {
      connection = await this.spawnConnection()
    }

    if (connection.getIdSeq() !== undefined) throw new Error(`Connection already has an ID-seq - is it in use? ${connection.getIdSeq()}`)

    const id = this.idSeq++

    connection.setIdSeq(id)
    this.connectionsInUse[id] = connection

    return connection
  }

  /**
   * @param {function(import("../drivers/base.js").default) : void} callback
   */
  async withConnection(callback) {
    const connection = await this.checkout()
    const id = connection.getIdSeq()

    await this.asyncLocalStorage.run(id, async () => {
      try {
        await callback(connection)
      } finally {
        this.checkin(connection)
      }
    })
  }

  /**
   * @returns {import("../drivers/base.js").default}
   */
  getCurrentConnection() {
    const id = this.asyncLocalStorage.getStore()

    if (id === undefined) {
      throw new Error("ID hasn't been set for this async context")
    }

    if (!(id in this.connectionsInUse)) {
      throw new Error(`Connection ${id} doesn't exist any more - has it been checked in again?`)
    }

    const currentConnection = this.connectionsInUse[id]

    if (!currentConnection) {
      throw new Error(`Couldn't get current connection from that ID: ${id}`)
    }

    return currentConnection
  }
}

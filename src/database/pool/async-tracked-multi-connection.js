import {AsyncLocalStorage} from "async_hooks"
import BasePool from "./base.js"

let idSeq = 0

export default class VelociousDatabasePoolAsyncTrackedMultiConnection extends BasePool {
  static current() {
    if (!this.velociousDatabasePoolAsyncTrackedMultiConnection) {
      this.velociousDatabasePoolAsyncTrackedMultiConnection = new VelociousDatabasePoolAsyncTrackedMultiConnection()
    }

    return this.velociousDatabasePoolAsyncTrackedMultiConnection
  }

  constructor(args = {}) {
    super(args)
    this.connections = []
    this.connectionsInUse = {}
    this.asyncLocalStorage = new AsyncLocalStorage()
  }

  checkin = (connection) => {
    const id = connection.getIdSeq()

    if (id in this.connectionsInUse) {
      delete this.connectionsInUse[id]
    }

    connection.setIdSeq(undefined)

    this.connections.push(connection)
  }

  async checkout() {
    let connection = this.connections.shift()

    if (!connection) {
      connection = await this.spawnConnection()
    }

    if (connection.getIdSeq() !== undefined) throw new Error(`Connection already has an ID-seq - is it in use? ${connection.getIdSeq()}`)

    const id = idSeq++

    connection.setIdSeq(id)
    this.connectionsInUse[id] = connection

    return connection
  }

  setCurrent() {
    this.constructor.velociousDatabasePoolAsyncTrackedMultiConnection = this
  }

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

  getCurrentConnection() {
    const id = this.asyncLocalStorage.getStore()

    if (id === undefined) {
      throw new Error("ID hasn't been set for this async context")
    }

    if (!(id in this.connectionsInUse)) {
      throw new Error(`Connection ${id} doesn't exist any more - has it been checked in again?`)
    }

    return this.connectionsInUse[id]
  }
}

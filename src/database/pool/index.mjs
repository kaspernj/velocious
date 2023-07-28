import {AsyncLocalStorage} from "node:async_hooks"
import Configuration from "../../configuration.mjs"
import {digg} from "diggerize"

const asyncLocalStorage = new AsyncLocalStorage()
let idSeq = 0

class VelociousDatabasePool {
  static current() {
    if (!global.velociousDatabasePool) global.velociousDatabasePool = new VelociousDatabasePool()

    return global.velociousDatabasePool
  }

  constructor(args = {}) {
    this.configuration = args.configuration || Configuration.current()
    this.connections = []
    this.connectionsInUse = {}
  }

  checkin = (connection) => {
    const id = connection.getIdSeq()

    console.log(`Checking in ${id}`)

    if (id in this.connectionsInUse) {
      delete this.connectionsInUse[id]
    }

    this.connections.push(connection)
  }

  async checkout() {
    let connection = this.connections.shift()

    if (!connection) {
      connection = await this.spawnConnection()
    }

    const id = idSeq++

    connection.setIdSeq(id)

    this.connectionsInUse[id] = connection

    console.log(`Checking out ${id}`)

    return connection
  }

  getConfiguration = () => digg(this, "configuration", "database", "default", "master")

  setCurrent() {
    global.velociousDatabasePool = this
  }

  async spawnConnection() {
    const defaultConfig = this.getConfiguration()
    const connection = await this.spawnConnectionWithConfiguration(defaultConfig)

    return connection
  }

  async spawnConnectionWithConfiguration(config) {
    const driverPath = `../drivers/${digg(config, "type")}/index.mjs`
    const DriverClassImport = await import(driverPath)
    const DriverClass = DriverClassImport.default
    const connection = new DriverClass(config)

    await connection.connect()

    return connection
  }

  async withConnection(callback) {
    const connection = await this.checkout()
    const id = connection.getIdSeq()

    await asyncLocalStorage.run(id, async () => {
      try {
        await callback()
      } finally {
        this.checkin(connection)
      }
    })
  }

  getCurrentConnection() {
    const id = asyncLocalStorage.getStore()

    if (id === undefined) {
      throw new Error("ID hasn't been set for this async context")
    }

    return digg(this, "connectionsInUse", id)
  }
}

const forwardMethods = ["createTableSql", "deleteSql", "insertSql", "query", "quote", "updateSql"]

for (const forwardMethod of forwardMethods) {
  VelociousDatabasePool.prototype[forwardMethod] = function(...args) {
    const connection = this.getCurrentConnection()

    return connection[forwardMethod](...args)
  }
}

export default VelociousDatabasePool

import BasePool from "./base.js"

export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
  checkin(connection) { // eslint-disable-line no-unused-vars
    // Do nothing
  }

  async checkout() {
    if (!this.connection) {
      this.connection = await this.spawnConnection()
    }

    return this.connection
  }

  async withConnection(callback) {
    await this.checkout() // Ensure a connection is present
    await callback(this.connection)
  }

  getCurrentConnection() {
    if (!this.connection) {
      throw new Error("A connection hasn't been made yet")
    }

    return this.connection
  }
}

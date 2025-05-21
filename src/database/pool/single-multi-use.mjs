import BasePool from "./base.mjs"

export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
  static current() {
    if (!this.velociousDatabasePoolSingleMultiUser) {
      this.velociousDatabasePoolSingleMultiUser = new VelociousDatabasePoolSingleMultiUser()
    }

    return this.velociousDatabasePoolSingleMultiUser
  }

  checkin = (connection) => {
    // Do nothing
  }

  async checkout() {
    if (!this.connection) {
      this.connection = await this.spawnConnection()
    }

    return this.connection
  }

  setCurrent() {
    this.constructor.velociousDatabasePoolSingleMultiUser = this
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

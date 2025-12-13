// @ts-check

export default class VelociousDatabaseDriversSqliteConnectionRemote {
  /**
   * @abstract
   * @param {string} sql
   * @returns {Promise<any[]>}
   */
  async query(sql) { // eslint-disable-line no-unused-vars
    throw new Error("stub")
  }
}

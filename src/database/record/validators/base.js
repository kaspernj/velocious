// @ts-check

export default class VelociousDatabaseRecordValidatorsBase {
  /**
   * @param {object} args
   * @param {string} args.attributeName
   * @param {Record<string, any>} args.args
   */
  constructor({attributeName, args}) {
    this.attributeName = attributeName
    this.args = args
  }

  /**
   * @abstract
   * @param {object} args
   * @param {import("../index.js").default} args.model
   * @param {string} args.attributeName
   * @returns {Promise<void>} - Result.
   */
  async validate({model, attributeName}) { // eslint-disable-line no-unused-vars
    throw new Error("validate not implemented")
  }
}

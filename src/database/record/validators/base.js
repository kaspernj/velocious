export default class VelociousDatabaseRecordValidatorsBase {
  /**
   * @interface
   * @template T extends import("../index.js").default
   * @param {Object} args
   * @param {T} args.model
   * @param {string} args.attributeName
   */
  async validate({model, attributeName}) { // eslint-disable-line no-unused-vars
    throw new Error("validate not implemented")
  }
}

// @ts-check

export default class VelociousDatabaseRecordValidatorsBase {
  /**
   * @param {object} args - Options object.
   * @param {string} args.attributeName - Attribute name.
   * @param {Record<string, any>} args.args - Options object.
   */
  constructor({attributeName, args}) {
    this.attributeName = attributeName
    this.args = args
  }

  /**
   * @abstract
   * @param {object} args - Options object.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.attributeName - Attribute name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async validate({model, attributeName}) { // eslint-disable-line no-unused-vars
    throw new Error("validate not implemented")
  }
}


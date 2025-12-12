// @ts-check

import Base from "./base.js"

export default class VelociousDatabaseRecordValidatorsPresence extends Base {
  /**
   * @param {object} args
   * @param {import("../index.js").default} args.model
   * @param {string} args.attributeName
   */
  async validate({model, attributeName}) {
    const attributeValue = model.readAttribute(attributeName)?.trim()

    if (!attributeValue) {
      if (!(attributeName in model._validationErrors)) model._validationErrors[attributeName] = []

      model._validationErrors[attributeName].push({type: "presence", message: "can't be blank"})
    }
  }
}

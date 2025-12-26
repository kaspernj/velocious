// @ts-check

import Base from "./base.js"

export default class VelociousDatabaseRecordValidatorsPresence extends Base {
  /**
   * @param {object} args - Options object.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.attributeName - Attribute name.
   */
  async validate({model, attributeName}) {
    const rawValue = /** @type {string | undefined} */ (model.readAttribute(attributeName))
    const attributeValue = rawValue?.trim()

    if (!attributeValue) {
      if (!(attributeName in model._validationErrors)) model._validationErrors[attributeName] = []

      model._validationErrors[attributeName].push({type: "presence", message: "can't be blank"})
    }
  }
}

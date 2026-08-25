// @ts-check

import Base from "./base.js"
import validationMessage from "../validation-messages.js"

export default class VelociousDatabaseRecordValidatorsPresence extends Base {
  /**
   * Runs validate.
   * @param {object} args - Options object.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.attributeName - Attribute name.
   */
  async validate({model, attributeName}) {
    const rawValue = /** @type {unknown} */ (model.readAttribute(attributeName))
    const attributeValue = typeof rawValue === "string" ? rawValue.trim() : rawValue

    if (!attributeValue) {
      if (!(attributeName in model._validationErrors)) model._validationErrors[attributeName] = []

      const translator = model.getModelClass()._getConfiguration().getTranslator()

      model._validationErrors[attributeName].push({type: "presence", message: validationMessage({translator, type: "blank"})})
    }
  }
}

// @ts-check

import Base from "./base.js"
import validationMessage from "../validation-messages.js"

export default class VelociousDatabaseRecordValidatorsLength extends Base {
  /**
   * Runs validate: bounds the value's string length by the `maximum` and/or
   * `minimum` options. Absent values (null/undefined/"") are skipped — they
   * are the presence validator's concern.
   * @param {object} args - Options object.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.attributeName - Attribute name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async validate({model, attributeName}) {
    const maximum = this.args?.maximum
    const minimum = this.args?.minimum

    if (typeof maximum != "number" && typeof minimum != "number") {
      throw new Error("length validator requires a maximum and/or minimum option")
    }

    const rawValue = model.readAttribute(attributeName)

    if (rawValue === null || rawValue === undefined || rawValue === "") return

    const valueLength = String(rawValue).length
    const translator = model.getModelClass()._getConfiguration().getTranslator()

    if (typeof maximum == "number" && valueLength > maximum) {
      this._addError(model, attributeName, validationMessage({translator, type: "too_long", variables: {count: maximum}}))
    }

    if (typeof minimum == "number" && valueLength < minimum) {
      this._addError(model, attributeName, validationMessage({translator, type: "too_short", variables: {count: minimum}}))
    }
  }

  /**
   * Adds a length validation error to the model.
   * @param {import("../index.js").default} model - Model instance.
   * @param {string} attributeName - Attribute name.
   * @param {string} message - Translated message predicate.
   * @returns {void}
   */
  _addError(model, attributeName, message) {
    if (!(attributeName in model._validationErrors)) model._validationErrors[attributeName] = []

    model._validationErrors[attributeName].push({type: "length", message})
  }
}

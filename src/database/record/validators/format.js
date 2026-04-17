// @ts-check

import Base from "./base.js"

export default class VelociousDatabaseRecordValidatorsFormat extends Base {
  /**
   * @param {object} args - Options object.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.attributeName - Attribute name.
   * @returns {Promise<void>}
   */
  async validate({model, attributeName}) {
    const value = model.readAttribute(attributeName)

    // Rails parity: `allow_blank: true` skips the format check for
    // blank/null/undefined values. Default to false (same as Rails).
    const allowBlank = this.args?.allowBlank === true

    if (value == null || (typeof value === "string" && value.trim() === "")) {
      if (allowBlank) return

      if (!(attributeName in model._validationErrors)) model._validationErrors[attributeName] = []

      model._validationErrors[attributeName].push({type: "format", message: "is invalid"})

      return
    }

    const pattern = this.args?.with

    if (!(pattern instanceof RegExp)) {
      throw new Error(`validates format requires a 'with' option that is a RegExp, got: ${typeof pattern}`)
    }

    const stringValue = String(value)

    if (!pattern.test(stringValue)) {
      const message = typeof this.args?.message === "string" ? this.args.message : "is invalid"

      if (!(attributeName in model._validationErrors)) model._validationErrors[attributeName] = []

      model._validationErrors[attributeName].push({type: "format", message})
    }
  }
}

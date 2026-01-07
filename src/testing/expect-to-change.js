// @ts-check

import BaseExpect from "./base-expect.js"
import restArgsError from "../utils/rest-args-error.js"

export default class ExpectToChange extends BaseExpect {
  /**
   * @param {object} args - Options object.
   * @param {function(): Promise<number>} args.changeCallback - Change callback.
   * @param {import("./expect.js").default} args.expect - Expect.
   */
  constructor({changeCallback, expect, ...restArgs}) {
    super()
    restArgsError(restArgs)

    this.expect = expect
    this.changeCallback = changeCallback
  }

  /**
   * @param {number} count - Count value.
   * @returns {import("./expect.js").default} - The by.
   */
  by(count) {
    this.count = count

    return this.expect
  }

  async runBefore() {
    this.oldCount = await this.changeCallback()
  }

  async runAfter() {
    this.newCount = await this.changeCallback()
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async execute() {
    if (this.newCount === undefined || this.oldCount === undefined) {
      throw new Error("ExpectToChange not executed properly")
    }

    const difference = this.newCount - this.oldCount

    if (difference != this.count) {
      throw new Error(`Expected to change by ${this.count} but changed by ${difference}`)
    }
  }
}

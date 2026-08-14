// @ts-check

import restArgsError from "../utils/rest-args-error.js"

/**
 * Represents a prepared mail delivery.
 */
export default class MailerDelivery {
  /**
   * Narrows the runtime value to the documented type.
   * @type {import("./base.js").VelociousMailerBase} */
  mailer
  /**
   * Narrows the runtime value to the documented type.
   * @type {Promise<ReturnType<typeof JSON.parse>>} */
  actionPromise
  /**
   * Narrows the runtime value to the documented type.
   * @type {string} */
  actionName

  /**
   * Runs constructor.
   * @param {object} args - Constructor args.
   * @param {import("./base.js").VelociousMailerBase} args.mailer - Mailer instance.
   * @param {Promise<ReturnType<typeof JSON.parse>>} args.actionPromise - Action promise.
   * @param {string} args.actionName - Action name.
   */
  constructor({mailer, actionPromise, actionName}) {
    this.mailer = mailer
    this.actionPromise = actionPromise
    this.actionName = actionName
  }

  /**
   * Runs build payload.
   * @returns {Promise<import("./index.js").MailerDeliveryPayload>} - Rendered mailer payload.
   */
  async buildPayload() {
    await this.actionPromise

    return /** @type {import("./index.js").MailerDeliveryPayload} */ (await this.mailer._buildPayload())
  }

  /**
   * Runs deliver now.
   * @returns {Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>} - Delivered payload or handler result.
   */
  async deliverNow() {
    const payload = await this.buildPayload()

    return await this.mailer._deliverPayload(payload)
  }

  /**
   * Runs deliver later.
   * @param {import("./index.js").MailerDeliveryLaterOptions} [options] - Delivery execution options.
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async deliverLater({deliveryOperation, ...restArgs} = {}) {
    restArgsError(restArgs)
    const payload = await this.buildPayload()

    return await this.mailer._enqueuePayload(payload, {deliveryOperation})
  }

  /**
   * Runs deliver laver.
   * @param {import("./index.js").MailerDeliveryLaterOptions} [options] - Delivery execution options.
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async deliverLaver(options) {
    return await this.deliverLater(options)
  }
}

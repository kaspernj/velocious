// @ts-check

/**
 * Represents a prepared mail delivery.
 */
export default class MailerDelivery {
  /** @type {import("./base.js").VelociousMailerBase} */
  mailer
  /** @type {Promise<unknown>} */
  actionPromise
  /** @type {string} */
  actionName

  /**
   * @param {object} args - Constructor args.
   * @param {import("./base.js").VelociousMailerBase} args.mailer - Mailer instance.
   * @param {Promise<unknown>} args.actionPromise - Action promise.
   * @param {string} args.actionName - Action name.
   */
  constructor({mailer, actionPromise, actionName}) {
    this.mailer = mailer
    this.actionPromise = actionPromise
    this.actionName = actionName
  }

  /**
   * @returns {Promise<import("./index.js").MailerDeliveryPayload | unknown>} - Delivered payload or handler result.
   */
  async deliverNow() {
    await this.actionPromise
    const payload = /** @type {import("./index.js").MailerDeliveryPayload} */ (await this.mailer._buildPayload())
    const mailerClass = /** @type {typeof import("./base.js").VelociousMailerBase} */ (this.mailer.constructor)

    return await mailerClass.deliverPayload(payload)
  }

  /**
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async deliverLater() {
    await this.actionPromise
    const payload = /** @type {import("./index.js").MailerDeliveryPayload} */ (await this.mailer._buildPayload())
    const mailerClass = /** @type {typeof import("./base.js").VelociousMailerBase} */ (this.mailer.constructor)

    return await mailerClass.enqueuePayload(payload)
  }

  /**
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async deliverLaver() {
    return await this.deliverLater()
  }
}

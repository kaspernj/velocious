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
   * @returns {Promise<import("./index.js").MailerDeliveryPayload>} - Rendered mailer payload.
   */
  async buildPayload() {
    await this.actionPromise

    return /** @type {import("./index.js").MailerDeliveryPayload} */ (await this.mailer._buildPayload())
  }

  /**
   * @returns {Promise<import("./index.js").MailerDeliveryPayload | unknown>} - Delivered payload or handler result.
   */
  async deliverNow() {
    const payload = await this.buildPayload()

    return await this.mailer._deliverPayload(payload)
  }

  /**
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async deliverLater() {
    const payload = await this.buildPayload()

    return await this.mailer._enqueuePayload(payload)
  }

  /**
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async deliverLaver() {
    return await this.deliverLater()
  }
}

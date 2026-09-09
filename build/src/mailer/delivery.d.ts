/**
 * Represents a prepared mail delivery.
 */
export default class MailerDelivery {
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./base.js").VelociousMailerBase} */
    mailer: import("./base.js").VelociousMailerBase;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Promise<ReturnType<typeof JSON.parse>>} */
    actionPromise: Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string} */
    actionName: string;
    /**
     * Runs constructor.
     * @param {object} args - Constructor args.
     * @param {import("./base.js").VelociousMailerBase} args.mailer - Mailer instance.
     * @param {Promise<ReturnType<typeof JSON.parse>>} args.actionPromise - Action promise.
     * @param {string} args.actionName - Action name.
     */
    constructor({ mailer, actionPromise, actionName }: {
        mailer: import("./base.js").VelociousMailerBase;
        actionPromise: Promise<ReturnType<typeof JSON.parse>>;
        actionName: string;
    });
    /**
     * Runs build payload.
     * @returns {Promise<import("./index.js").MailerDeliveryPayload>} - Rendered mailer payload.
     */
    buildPayload(): Promise<import("./index.js").MailerDeliveryPayload>;
    /**
     * Runs deliver now.
     * @returns {Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>} - Delivered payload or handler result.
     */
    deliverNow(): Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>;
    /**
     * Runs deliver later.
     * @param {import("./index.js").MailerDeliveryLaterOptions} [options] - Delivery execution options.
     * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
     */
    deliverLater({ deliveryOperation, ...restArgs }?: import("./index.js").MailerDeliveryLaterOptions): Promise<string | import("./index.js").MailerDeliveryPayload | null>;
    /**
     * Runs deliver laver.
     * @param {import("./index.js").MailerDeliveryLaterOptions} [options] - Delivery execution options.
     * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
     */
    deliverLaver(options?: import("./index.js").MailerDeliveryLaterOptions): Promise<string | import("./index.js").MailerDeliveryPayload | null>;
}
//# sourceMappingURL=delivery.d.ts.map
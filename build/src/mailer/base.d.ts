import MailerDelivery from "./delivery.js";
/**
 * Base mailer with view rendering and delivery helpers.
 */
export declare class VelociousMailerBase {
    _actionName: string | null;
    _mailOptions: {
        to: any;
        subject: string;
        from: any;
        cc: any;
        bcc: any;
        replyTo: any;
        headers: Record<string, string> | undefined;
    } | null;
    _viewParams: {};
    _configurationPromise: Promise<import("../configuration.js").default>;
    /**
     * Runs constructor.
     * @param {object} [args] - Constructor args.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration instance.
     */
    constructor({ configuration }?: {
        configuration?: import("../configuration.js").default;
    });
    /**
     * Runs assign view.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - View params.
     * @returns {void} - No return value.
     */
    assignView(params: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs mail.
     * @param {object} args - Mail options.
     * @param {ReturnType<typeof JSON.parse>} args.to - Recipient.
     * @param {string} args.subject - Subject line.
     * @param {ReturnType<typeof JSON.parse>} [args.from] - Sender.
     * @param {ReturnType<typeof JSON.parse>} [args.cc] - CC recipients.
     * @param {ReturnType<typeof JSON.parse>} [args.bcc] - BCC recipients.
     * @param {ReturnType<typeof JSON.parse>} [args.replyTo] - Reply-to address.
     * @param {Record<string, string>} [args.headers] - Custom headers.
     * @param {string} [args.actionName] - Mailer action name.
     * @param {Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} [args.actionPromise] - Action completion promise.
     * @returns {MailerDelivery} - Delivery wrapper.
     */
    mail({ to, subject, from, cc, bcc, replyTo, headers, actionName, actionPromise, ...restArgs }: {
        to: ReturnType<typeof JSON.parse>;
        subject: string;
        from?: ReturnType<typeof JSON.parse>;
        cc?: ReturnType<typeof JSON.parse>;
        bcc?: ReturnType<typeof JSON.parse>;
        replyTo?: ReturnType<typeof JSON.parse>;
        headers?: Record<string, string>;
        actionName?: string;
        actionPromise?: Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>;
    }): MailerDelivery;
    /**
     * Runs get configuration.
     * @returns {Promise<import("../configuration.js").default>} - Configuration instance.
     */
    _getConfiguration(): Promise<import("../configuration.js").default>;
    /**
     * Runs get action name.
     * @returns {string} - Action name.
     */
    _getActionName(): string;
    /**
     * Runs build payload sync.
     * @param {string} html - Rendered HTML.
     * @returns {import("./index.js").MailerDeliveryPayload} - Delivery payload.
     */
    _buildPayloadSync(html: string): import("./index.js").MailerDeliveryPayload;
    /**
     * Runs build payload.
     * @returns {Promise<import("./index.js").MailerDeliveryPayload>} - Delivery payload.
     */
    _buildPayload(): Promise<import("./index.js").MailerDeliveryPayload>;
    /**
     * Runs render view.
     * @returns {Promise<string>} - Rendered HTML.
     */
    _renderView(): Promise<string>;
    /**
     * Runs deliver payload.
     * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
     * @returns {Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>} - Handler result.
     */
    _deliverPayload(payload: import("./index.js").MailerDeliveryPayload): Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>;
    /**
     * Runs enqueue payload.
     * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
     * @param {import("./index.js").MailerDeliveryLaterOptions} [options] - Delivery execution options.
     * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
     */
    _enqueuePayload(payload: import("./index.js").MailerDeliveryPayload, options?: import("./index.js").MailerDeliveryLaterOptions): Promise<string | import("./index.js").MailerDeliveryPayload | null>;
}
/**
 * Runs the deliveries helper.
 * @returns {import("./index.js").MailerDeliveryPayload[]} - Delivered payloads.
 */
export declare function deliveries(): import("./index.js").MailerDeliveryPayload[];
/**
 * Runs the clearDeliveries helper.
 * @returns {void} - No return value.
 */
export declare function clearDeliveries(): void;
/**
 * Runs the setDeliveryHandler helper.
 * @param {(payload: import("./index.js").MailerDeliveryPayload) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} handler - Delivery handler.
 * @returns {void} - No return value.
 */
export declare function setDeliveryHandler(handler: (payload: import("./index.js").MailerDeliveryPayload) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>): void;
/**
 * Runs the getDeliveryHandler helper.
 * @returns {((payload: import("./index.js").MailerDeliveryPayload) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>) | null} - Handler or null.
 */
export declare function getDeliveryHandler(): ((payload: import("./index.js").MailerDeliveryPayload) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>) | null;
/**
 * Runs the deliverPayload helper.
 * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
 * @returns {Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>} - Handler result.
 */
export declare function deliverPayload(payload: import("./index.js").MailerDeliveryPayload): Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>;
/**
 * Runs the enqueuePayload helper.
 * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
 * @param {object} [options] - Enqueue options.
 * @param {import("../configuration.js").default} [options.configuration] - Owning configuration.
 * @param {import("./index.js").MailerDeliveryOperationRequest} [options.deliveryOperation] - Required provider-backed operation.
 * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
 */
export declare function enqueuePayload(payload: import("./index.js").MailerDeliveryPayload, { configuration: suppliedConfiguration, deliveryOperation }?: {
    configuration?: import("../configuration.js").default;
    deliveryOperation?: import("./index.js").MailerDeliveryOperationRequest;
}): Promise<string | import("./index.js").MailerDeliveryPayload | null>;
//# sourceMappingURL=base.d.ts.map
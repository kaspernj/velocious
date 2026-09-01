export type SmtpConnectionOptions = {
    auth?: Record<string, ReturnType<typeof JSON.parse>>;
    [key: string]: ReturnType<typeof JSON.parse>;
};
/**
 * SMTP mailer backend using smtp-connection.
 */
export default class SmtpMailerBackend {
    connectionOptions: SmtpConnectionOptions;
    defaultFrom: string | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Constructor args.
     * @param {SmtpConnectionOptions} args.connectionOptions - smtp-connection options.
     * @param {string} [args.defaultFrom] - Default from address.
     */
    constructor({ connectionOptions, defaultFrom, ...restArgs }: {
        connectionOptions: SmtpConnectionOptions;
        defaultFrom?: string;
    });
    /**
     * Runs deliver.
     * @param {object} args - Delivery args.
     * @param {import("../index.js").MailerDeliveryPayload} args.payload - Mail delivery payload.
     * @param {import("../../configuration.js").default} [args.configuration] - Active configuration.
     * @returns {Promise<void>} - Resolves when complete.
     */
    deliver({ payload, configuration: _configuration, ...restArgs }: {
        payload: import("../index.js").MailerDeliveryPayload;
        configuration?: import("../../configuration.js").default;
    }): Promise<void>;
}
//# sourceMappingURL=smtp.d.ts.map
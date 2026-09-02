export default class PooledRunnerBrokerIdentity {
    closeConnections: () => Promise<void>;
    /** @type {string | undefined} */
    activeIdentity: string | undefined;
    /** @type {{identity: string, promise: Promise<void>} | undefined} */
    pending: {
        identity: string;
        promise: Promise<void>;
    } | undefined;
    activeUsers: number;
    /**
     * Creates a pooled runner identity coordinator.
     * @param {{closeConnections: () => Promise<void>}} args - Connection cleanup hook.
     */
    constructor({ closeConnections }: {
        closeConnections: () => Promise<void>;
    });
    /**
     * Gets the current prepared identity.
     * @returns {string | undefined} - Current prepared identity.
     */
    current(): string | undefined;
    /**
     * Prepares one identity, sharing an in-flight same-identity rotation.
     * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
     * @param {boolean} [admissionReserved] - Whether the caller already reserved its active-user slot.
     * @returns {Promise<void>} - Resolves after stale connections close.
     */
    prepare(config: import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig, admissionReserved?: boolean): Promise<void>;
    /**
     * Runs work while preventing a different identity from replacing its connections.
     * @template T
     * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
     * @param {() => Promise<T>} callback - Job callback.
     * @returns {Promise<T>} - Job result.
     */
    run<T>(config: import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig, callback: () => Promise<T>): Promise<T>;
    /**
     * Atomically prepares an attempt identity and reserves its active user. Without
     * this admission turn, another capability can rotate connections after `prepare`
     * resolves but before `run` increments `activeUsers`.
     * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
     * @returns {Promise<void>} - Resolves after admission is reserved.
     */
    admit(config: import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig): Promise<void>;
    /**
     * Rotates retained connection state to an identity.
     * @param {string} identity - Target identity.
     * @returns {Promise<void>} - Resolves after rotation.
     */
    rotate(identity: string): Promise<void>;
}
//# sourceMappingURL=pooled-runner-broker-identity.d.ts.map
/** @typedef {{address?: string, allowDynamicIdentities?: boolean, capability?: string, databaseIdentifiers?: string[], expected: boolean}} SharedTransactionBrokerJobConfig */
export type SharedTransactionBrokerJobConfig = {
    address?: string;
    allowDynamicIdentities?: boolean;
    capability?: string;
    databaseIdentifiers?: string[];
    expected: boolean;
};
export declare const SHARED_TRANSACTION_BROKER_ENV = "VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER";
export declare const BACKGROUND_JOB_CHILD_ENV = "VELOCIOUS_BACKGROUND_JOB_CHILD";
/**
 * Runs one pooled job with dispatch-time broker configuration.
 * @template T
 * @param {SharedTransactionBrokerJobConfig} config - Per-job broker mode and coordinates.
 * @param {() => T} callback - Job callback.
 * @returns {T} - Callback result.
 */
export declare function runWithSharedTransactionBrokerConfig<T>(config: SharedTransactionBrokerJobConfig, callback: () => T): T;
/**
 * Checks whether the current live join selects one exact session capability.
 * @param {{address: string, capability: string}} identity - Session control-message identity.
 * @returns {boolean} - Whether this async context belongs to that session.
 */
export declare function sharedTransactionBrokerContextMatches(identity: {
    address: string;
    capability: string;
}): boolean;
/**
 * Preserves legacy real tenant connections omitted by automatic TestRunner mode.
 * Explicit dynamic sessions never permit this fallback.
 * @param {string} databaseIdentifier - Logical database identifier.
 * @returns {boolean} - Whether an omitted automatic route stays independent.
 */
export declare function automaticSharedTransactionBrokerOmits(databaseIdentifier: string): boolean;
/**
 * Parses the test-runner-owned child transport configuration when this logical
 * database is registered for the active attempt.
 * @param {string} databaseIdentifier - Logical database identifier.
 * @returns {{address: string, allowDynamicIdentities?: boolean, capability: string} | undefined} - Broker coordinates.
 */
export declare function sharedTransactionBrokerConfig(databaseIdentifier: string): {
    address: string;
    allowDynamicIdentities?: boolean;
    capability: string;
} | undefined;
/**
 * Creates a concrete-driver subclass that retains all local SQL/query/model
 * builders while forwarding only physical connection actions to the parent.
 * @param {typeof import("../database/drivers/base.js").default} DriverClass - Configured concrete driver.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} config - Database configuration.
 * @param {import("../configuration.js").default} configuration - Child configuration.
 * @param {string} databaseIdentifier - Logical identifier.
 * @param {{address: string, capability: string, reuseKey?: string}} brokerConfig - Broker coordinates.
 * @returns {import("../database/drivers/base.js").default} - Unconnected physical proxy.
 */
export declare function createSharedTransactionProxyDriver(DriverClass: typeof import("../database/drivers/base.js").default, config: import("../configuration-types.js").DatabaseConfigurationType, configuration: import("../configuration.js").default, databaseIdentifier: string, brokerConfig: {
    address: string;
    capability: string;
    reuseKey?: string;
}): import("../database/drivers/base.js").default;
//# sourceMappingURL=shared-transaction-proxy-driver.d.ts.map
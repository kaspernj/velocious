/** @typedef {{address?: string, allowDynamicIdentities?: boolean, capability?: string, databaseIdentifiers?: string[], expected: boolean}} SharedTransactionBrokerJobConfig */
// @ts-check
import SharedTransactionBrokerClient from "./shared-transaction-broker-client.js";
import { AsyncLocalStorage } from "node:async_hooks";
export const SHARED_TRANSACTION_BROKER_ENV = "VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER";
export const BACKGROUND_JOB_CHILD_ENV = "VELOCIOUS_BACKGROUND_JOB_CHILD";
/** @type {AsyncLocalStorage<SharedTransactionBrokerJobConfig>} */
const pooledJobBrokerConfig = new AsyncLocalStorage();
/**
 * Returns the active live broker configuration without validating one database route.
 * @returns {SharedTransactionBrokerJobConfig | undefined} - Active live or child configuration.
 */
function activeSharedTransactionBrokerConfig() {
    const contextualConfig = pooledJobBrokerConfig.getStore();
    if (contextualConfig)
        return contextualConfig;
    if (process.env[BACKGROUND_JOB_CHILD_ENV] !== "1")
        return undefined;
    const serialized = process.env[SHARED_TRANSACTION_BROKER_ENV];
    if (!serialized)
        return undefined;
    return JSON.parse(Buffer.from(serialized, "base64url").toString("utf8"));
}
/**
 * Runs one pooled job with dispatch-time broker configuration.
 * @template T
 * @param {SharedTransactionBrokerJobConfig} config - Per-job broker mode and coordinates.
 * @param {() => T} callback - Job callback.
 * @returns {T} - Callback result.
 */
export function runWithSharedTransactionBrokerConfig(config, callback) {
    return pooledJobBrokerConfig.run(config, callback);
}
/**
 * Checks whether the current live join selects one exact session capability.
 * @param {{address: string, capability: string}} identity - Session control-message identity.
 * @returns {boolean} - Whether this async context belongs to that session.
 */
export function sharedTransactionBrokerContextMatches(identity) {
    const config = pooledJobBrokerConfig.getStore();
    return config?.expected === true && config.address === identity.address && config.capability === identity.capability;
}
/**
 * Preserves legacy real tenant connections omitted by automatic TestRunner mode.
 * Explicit dynamic sessions never permit this fallback.
 * @param {string} databaseIdentifier - Logical database identifier.
 * @returns {boolean} - Whether an omitted automatic route stays independent.
 */
export function automaticSharedTransactionBrokerOmits(databaseIdentifier) {
    const config = activeSharedTransactionBrokerConfig();
    return Boolean(config?.expected === true &&
        !config.allowDynamicIdentities &&
        typeof config.address === "string" &&
        typeof config.capability === "string" &&
        Array.isArray(config.databaseIdentifiers) &&
        !config.databaseIdentifiers.includes(databaseIdentifier));
}
/**
 * Escapes a PostgreSQL literal without requiring a live child connection.
 * @param {ReturnType<typeof JSON.parse>} value - PostgreSQL literal value.
 * @returns {string} - Quoted literal.
 */
function pgEscapeLiteral(value) {
    const string = typeof value === "string" ? value : String(value);
    let escaped = "'";
    let hasBackslash = false;
    for (const character of string) {
        if (character === "'")
            escaped += character;
        if (character === "\\") {
            escaped += character;
            hasBackslash = true;
        }
        escaped += character;
    }
    escaped += "'";
    return hasBackslash ? ` E${escaped}` : escaped;
}
/**
 * Parses the test-runner-owned child transport configuration when this logical
 * database is registered for the active attempt.
 * @param {string} databaseIdentifier - Logical database identifier.
 * @returns {{address: string, allowDynamicIdentities?: boolean, capability: string} | undefined} - Broker coordinates.
 */
export function sharedTransactionBrokerConfig(databaseIdentifier) {
    const config = activeSharedTransactionBrokerConfig();
    if (!config)
        return undefined;
    return validatedBrokerConfig(config, databaseIdentifier);
}
/**
 * Validates dispatch-time broker configuration and fails closed when expected.
 * @param {SharedTransactionBrokerJobConfig} config - Candidate configuration.
 * @param {string} databaseIdentifier - Logical database identifier.
 * @returns {{address: string, allowDynamicIdentities?: boolean, capability: string} | undefined} - Broker coordinates.
 */
function validatedBrokerConfig(config, databaseIdentifier) {
    if (config.expected && (!config.address || !config.capability || !config.databaseIdentifiers)) {
        throw new Error("Transactional pooled job expected shared transaction broker coordinates");
    }
    if (!config.expected)
        return undefined;
    if (typeof config.address !== "string" || typeof config.capability !== "string" || !Array.isArray(config.databaseIdentifiers)) {
        throw new Error("Invalid shared transaction broker child configuration");
    }
    if (!config.allowDynamicIdentities && !config.databaseIdentifiers.includes(databaseIdentifier)) {
        throw new Error(`Transactional pooled job expected broker database identifier: ${databaseIdentifier}`);
    }
    if (config.allowDynamicIdentities) {
        return { address: config.address, allowDynamicIdentities: true, capability: config.capability };
    }
    return { address: config.address, capability: config.capability };
}
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
export function createSharedTransactionProxyDriver(DriverClass, config, configuration, databaseIdentifier, brokerConfig) {
    class SharedTransactionProxyDriver extends DriverClass {
        constructor() {
            super(config, configuration);
            this.sharedTransactionClient = new SharedTransactionBrokerClient({ ...brokerConfig, databaseIdentifier });
            /** @type {string | undefined} */
            this.sharedTransactionRootSavePoint = undefined;
        }
        /**
         * Connects the proxy transport.
         * @returns {Promise<void>} - Resolves when connected.
         */
        async connect() { await this.sharedTransactionClient.connected(); }
        /**
         * Closes only the proxy transport.
         * @returns {Promise<void>} - Resolves when closed.
         */
        async _close() { await this.sharedTransactionClient.close(); }
        /**
         * Keeps a broker proxy transport alive across logical MySQL checkouts.
         * Parent TestRunner owns physical session cleanup and rollback.
         * @returns {Promise<void>} - Resolves without closing the transport.
         */
        async cleanupSessionStateAfterCheckout() { }
        /**
         * Routes a physical query.
         * @param {string} sql - SQL statement.
         * @returns {Promise<import("../database/drivers/base.js").QueryResultType>} - Rows.
         */
        async _queryActual(sql) { return await this.sharedTransactionClient.call("_queryActual", [sql]); }
        /**
         * Routes an affected-row query.
         * @param {string} sql - SQL statement.
         * @returns {Promise<number>} - Affected rows.
         */
        async _affectedRowsActual(sql) { return await this.sharedTransactionClient.call("_affectedRowsActual", [sql]); }
        /**
         * Starts a child transaction as a parent savepoint.
         * @returns {Promise<void>} - Resolves when started.
         */
        async _startTransactionAction() {
            this.sharedTransactionRootSavePoint = this.generateSavePointName();
            await this.sharedTransactionClient.call("rootTransactionStart", [this.sharedTransactionRootSavePoint]);
        }
        /**
         * Releases the child transaction savepoint.
         * @returns {Promise<void>} - Resolves when released.
         */
        async _commitTransactionAction() {
            if (!this.sharedTransactionRootSavePoint)
                throw new Error("Shared transaction proxy has no root savepoint");
            await this.sharedTransactionClient.call("rootTransactionRelease", [this.sharedTransactionRootSavePoint]);
            this.sharedTransactionRootSavePoint = undefined;
        }
        /**
         * Rolls back the child transaction savepoint.
         * @returns {Promise<void>} - Resolves when rolled back.
         */
        async _rollbackTransactionAction() {
            if (!this.sharedTransactionRootSavePoint)
                throw new Error("Shared transaction proxy has no root savepoint");
            await this.sharedTransactionClient.call("rootTransactionRollback", [this.sharedTransactionRootSavePoint]);
            this.sharedTransactionRootSavePoint = undefined;
        }
        /**
         * Escapes a local SQL value.
         * @param {ReturnType<typeof JSON.parse>} value - SQL value.
         * @returns {ReturnType<typeof JSON.parse>} - Escaped value.
         */
        escape(value) {
            if (this.getType() !== "pgsql")
                return super.escape(value);
            if (typeof value === "number")
                return value;
            const escaped = pgEscapeLiteral(this._convertValue(value));
            return escaped.slice(1, -1);
        }
        /**
         * Quotes a local SQL value.
         * @param {ReturnType<typeof JSON.parse>} value - SQL value.
         * @returns {string | number} - Quoted value.
         */
        quote(value) {
            if (this.getType() !== "pgsql")
                return super.quote(value);
            if (typeof value === "number")
                return value;
            return pgEscapeLiteral(this._convertValue(value));
        }
        /**
         * Streams brokered rows through the driver's buffered fallback.
         * @param {string} sql - SQL statement.
         * @param {import("../database/drivers/base.js").QueryOptions} [options] - Query options.
         * @yields {Record<string, ReturnType<typeof JSON.parse>>} - Result rows.
         */
        async *queryStream(sql, options = {}) {
            const rows = await this.query(sql, options);
            for (const row of rows)
                yield row;
        }
        /**
         * Keeps structure SQL on normal brokered statements.
         * @returns {Promise<boolean>} - Always false.
         */
        async execStructureScript() { return false; }
    }
    return new SharedTransactionProxyDriver();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsK0tBQStLO0FBRS9LLFlBQVk7QUFFWixPQUFPLDZCQUE2QixNQUFNLHVDQUF1QyxDQUFBO0FBQ2pGLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBRXBELE1BQU0sQ0FBQyxNQUFNLDZCQUE2QixHQUFHLDBDQUEwQyxDQUFBO0FBQ3ZGLE1BQU0sQ0FBQyxNQUFNLHdCQUF3QixHQUFHLGdDQUFnQyxDQUFBO0FBRXhFLGtFQUFrRTtBQUNsRSxNQUFNLHFCQUFxQixHQUFHLElBQUksaUJBQWlCLEVBQUUsQ0FBQTtBQUVyRDs7O0dBR0c7QUFDSCxTQUFTLG1DQUFtQztJQUMxQyxNQUFNLGdCQUFnQixHQUFHLHFCQUFxQixDQUFDLFFBQVEsRUFBRSxDQUFBO0lBQ3pELElBQUksZ0JBQWdCO1FBQUUsT0FBTyxnQkFBZ0IsQ0FBQTtJQUM3QyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLENBQUMsS0FBSyxHQUFHO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFDbkUsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO0lBQzdELElBQUksQ0FBQyxVQUFVO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFDakMsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLFdBQVcsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFBO0FBQzFFLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxNQUFNLFVBQVUsb0NBQW9DLENBQUMsTUFBTSxFQUFFLFFBQVE7SUFDbkUsT0FBTyxxQkFBcUIs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O1FBRUQ7OztXQUdHO1FBQ0gsS0FBSyxDQUFDLG1CQUFtQixLQUFLLE9BQU8sS0FBSyxDQUFBLENBQUMsQ0FBQztLQUM3QztJQUVELE9BQU8sSUFBSSw0QkFBNEIsRUFBRSxDQUFBO0FBQzNDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiogQHR5cGVkZWYge3thZGRyZXNzPzogc3RyaW5nLCBhbGxvd0R5bmFtaWNJZGVudGl0aWVzPzogYm9vbGVhbiwgY2FwYWJpbGl0eT86IHN0cmluZywgZGF0YWJhc2VJZGVudGlmaWVycz86IHN0cmluZ1tdLCBleHBlY3RlZDogYm9vbGVhbn19IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnICovXG5cbi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDbGllbnQgZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLWJyb2tlci1jbGllbnQuanNcIlxuaW1wb3J0IHsgQXN5bmNMb2NhbFN0b3JhZ2UgfSBmcm9tIFwibm9kZTphc3luY19ob29rc1wiXG5cbmV4cG9ydCBjb25zdCBTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOViA9IFwiVkVMT0NJT1VTX1RFU1RfU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUlwiXG5leHBvcnQgY29uc3QgQkFDS0dST1VORF9KT0JfQ0hJTERfRU5WID0gXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JfQ0hJTERcIlxuXG4vKiogQHR5cGUge0FzeW5jTG9jYWxTdG9yYWdlPFNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnPn0gKi9cbmNvbnN0IHBvb2xlZEpvYkJyb2tlckNvbmZpZyA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG5cbi8qKlxuICogUmV0dXJucyB0aGUgYWN0aXZlIGxpdmUgYnJva2VyIGNvbmZpZ3VyYXRpb24gd2l0aG91dCB2YWxpZGF0aW5nIG9uZSBkYXRhYmFzZSByb3V0ZS5cbiAqIEByZXR1cm5zIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckpvYkNvbmZpZyB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgbGl2ZSBvciBjaGlsZCBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBhY3RpdmVTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZygpIHtcbiAgY29uc3QgY29udGV4dHVhbENvbmZpZyA9IHBvb2xlZEpvYkJyb2tlckNvbmZpZy5nZXRTdG9yZSgpXG4gIGlmIChjb250ZXh0dWFsQ29uZmlnKSByZXR1cm4gY29udGV4dHVhbENvbmZpZ1xuICBpZiAocHJvY2Vzcy5lbnZbQkFDS0dST1VORF9KT0JfQ0hJTERfRU5WXSAhPT0gXCIxXCIpIHJldHVybiB1bmRlZmluZWRcbiAgY29uc3Qgc2VyaWFsaXplZCA9IHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXVxuICBpZiAoIXNlcmlhbGl6ZWQpIHJldHVybiB1bmRlZmluZWRcbiAgcmV0dXJuIEpTT04ucGFyc2UoQnVmZmVyLmZyb20oc2VyaWFsaXplZCwgXCJiYXNlNjR1cmxcIikudG9TdHJpbmcoXCJ1dGY4XCIpKVxufVxuXG4vKipcbiAqIFJ1bnMgb25lIHBvb2xlZCBqb2Igd2l0aCBkaXNwYXRjaC10aW1lIGJyb2tlciBjb25maWd1cmF0aW9uLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IGNvbmZpZyAtIFBlci1qb2IgYnJva2VyIG1vZGUgYW5kIGNvb3JkaW5hdGVzLlxuICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIEpvYiBjYWxsYmFjay5cbiAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJ1bldpdGhTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZyhjb25maWcsIGNhbGxiYWNrKSB7XG4gIHJldHVybiBwb29sZWRKb2JCcm9rZXJDb25maWcucnVuKGNvbmZpZywgY2FsbGJhY2spXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgdGhlIGN1cnJlbnQgbGl2ZSBqb2luIHNlbGVjdHMgb25lIGV4YWN0IHNlc3Npb24gY2FwYWJpbGl0eS5cbiAqIEBwYXJhbSB7e2FkZHJlc3M6IHN0cmluZywgY2FwYWJpbGl0eTogc3RyaW5nfX0gaWRlbnRpdHkgLSBTZXNzaW9uIGNvbnRyb2wtbWVzc2FnZSBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBhc3luYyBjb250ZXh0IGJlbG9uZ3MgdG8gdGhhdCBzZXNzaW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb250ZXh0TWF0Y2hlcyhpZGVudGl0eSkge1xuICBjb25zdCBjb25maWcgPSBwb29sZWRKb2JCcm9rZXJDb25maWcuZ2V0U3RvcmUoKVxuICByZXR1cm4gY29uZmlnPy5leHBlY3RlZCA9PT0gdHJ1ZSAmJiBjb25maWcuYWRkcmVzcyA9PT0gaWRlbnRpdHkuYWRkcmVzcyAmJiBjb25maWcuY2FwYWJpbGl0eSA9PT0gaWRlbnRpdHkuY2FwYWJpbGl0eVxufVxuXG4vKipcbiAqIFByZXNlcnZlcyBsZWdhY3kgcmVhbCB0ZW5hbnQgY29ubmVjdGlvbnMgb21pdHRlZCBieSBhdXRvbWF0aWMgVGVzdFJ1bm5lciBtb2RlLlxuICogRXhwbGljaXQgZHluYW1pYyBzZXNzaW9ucyBuZXZlciBwZXJtaXQgdGhpcyBmYWxsYmFjay5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBMb2dpY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFuIG9taXR0ZWQgYXV0b21hdGljIHJvdXRlIHN0YXlzIGluZGVwZW5kZW50LlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXV0b21hdGljU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJPbWl0cyhkYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgY29uc3QgY29uZmlnID0gYWN0aXZlU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKVxuICByZXR1cm4gQm9vbGVhbihcbiAgICBjb25maWc/LmV4cGVjdGVkID09PSB0cnVlICYmXG4gICAgIWNvbmZpZy5hbGxvd0R5bmFtaWNJZGVudGl0aWVzICYmXG4gICAgdHlwZW9mIGNvbmZpZy5hZGRyZXNzID09PSBcInN0cmluZ1wiICYmXG4gICAgdHlwZW9mIGNvbmZpZy5jYXBhYmlsaXR5ID09PSBcInN0cmluZ1wiICYmXG4gICAgQXJyYXkuaXNBcnJheShjb25maWcuZGF0YWJhc2VJZGVudGlmaWVycykgJiZcbiAgICAhY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcnMuaW5jbHVkZXMoZGF0YWJhc2VJZGVudGlmaWVyKVxuICApXG59XG5cbi8qKlxuICogRXNjYXBlcyBhIFBvc3RncmVTUUwgbGl0ZXJhbCB3aXRob3V0IHJlcXVpcmluZyBhIGxpdmUgY2hpbGQgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUG9zdGdyZVNRTCBsaXRlcmFsIHZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBRdW90ZWQgbGl0ZXJhbC5cbiAqL1xuZnVuY3Rpb24gcGdFc2NhcGVMaXRlcmFsKHZhbHVlKSB7XG4gIGNvbnN0IHN0cmluZyA9IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHZhbHVlIDogU3RyaW5nKHZhbHVlKVxuICBsZXQgZXNjYXBlZCA9IFwiJ1wiXG4gIGxldCBoYXNCYWNrc2xhc2ggPSBmYWxzZVxuXG4gIGZvciAoY29uc3QgY2hhcmFjdGVyIG9mIHN0cmluZykge1xuICAgIGlmIChjaGFyYWN0ZXIgPT09IFwiJ1wiKSBlc2NhcGVkICs9IGNoYXJhY3RlclxuICAgIGlmIChjaGFyYWN0ZXIgPT09IFwiXFxcXFwiKSB7XG4gICAgICBlc2NhcGVkICs9IGNoYXJhY3RlclxuICAgICAgaGFzQmFja3NsYXNoID0gdHJ1ZVxuICAgIH1cbiAgICBlc2NhcGVkICs9IGNoYXJhY3RlclxuICB9XG5cbiAgZXNjYXBlZCArPSBcIidcIlxuICByZXR1cm4gaGFzQmFja3NsYXNoID8gYCBFJHtlc2NhcGVkfWAgOiBlc2NhcGVkXG59XG5cbi8qKlxuICogUGFyc2VzIHRoZSB0ZXN0LXJ1bm5lci1vd25lZCBjaGlsZCB0cmFuc3BvcnQgY29uZmlndXJhdGlvbiB3aGVuIHRoaXMgbG9naWNhbFxuICogZGF0YWJhc2UgaXMgcmVnaXN0ZXJlZCBmb3IgdGhlIGFjdGl2ZSBhdHRlbXB0LlxuICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIExvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAqIEByZXR1cm5zIHt7YWRkcmVzczogc3RyaW5nLCBhbGxvd0R5bmFtaWNJZGVudGl0aWVzPzogYm9vbGVhbiwgY2FwYWJpbGl0eTogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBCcm9rZXIgY29vcmRpbmF0ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZyhkYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgY29uc3QgY29uZmlnID0gYWN0aXZlU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKVxuICBpZiAoIWNvbmZpZykgcmV0dXJuIHVuZGVmaW5lZFxuICByZXR1cm4gdmFsaWRhdGVkQnJva2VyQ29uZmlnKGNvbmZpZywgZGF0YWJhc2VJZGVudGlmaWVyKVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBkaXNwYXRjaC10aW1lIGJyb2tlciBjb25maWd1cmF0aW9uIGFuZCBmYWlscyBjbG9zZWQgd2hlbiBleHBlY3RlZC5cbiAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IGNvbmZpZyAtIENhbmRpZGF0ZSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIExvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAqIEByZXR1cm5zIHt7YWRkcmVzczogc3RyaW5nLCBhbGxvd0R5bmFtaWNJZGVudGl0aWVzPzogYm9vbGVhbiwgY2FwYWJpbGl0eTogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBCcm9rZXIgY29vcmRpbmF0ZXMuXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlZEJyb2tlckNvbmZpZyhjb25maWcsIGRhdGFiYXNlSWRlbnRpZmllcikge1xuICBpZiAoY29uZmlnLmV4cGVjdGVkICYmICghY29uZmlnLmFkZHJlc3MgfHwgIWNvbmZpZy5jYXBhYmlsaXR5IHx8ICFjb25maWcuZGF0YWJhc2VJZGVudGlmaWVycykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHBvb2xlZCBqb2IgZXhwZWN0ZWQgc2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjb29yZGluYXRlc1wiKVxuICB9XG4gIGlmICghY29uZmlnLmV4cGVjdGVkKSByZXR1cm4gdW5kZWZpbmVkXG4gIGlmICh0eXBlb2YgY29uZmlnLmFkZHJlc3MgIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGNvbmZpZy5jYXBhYmlsaXR5ICE9PSBcInN0cmluZ1wiIHx8ICFBcnJheS5pc0FycmF5KGNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXJzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgc2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjaGlsZCBjb25maWd1cmF0aW9uXCIpXG4gIH1cbiAgaWYgKCFjb25maWcuYWxsb3dEeW5hbWljSWRlbnRpdGllcyAmJiAhY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcnMuaW5jbHVkZXMoZGF0YWJhc2VJZGVudGlmaWVyKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNhY3Rpb25hbCBwb29sZWQgam9iIGV4cGVjdGVkIGJyb2tlciBkYXRhYmFzZSBpZGVudGlmaWVyOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICB9XG5cbiAgaWYgKGNvbmZpZy5hbGxvd0R5bmFtaWNJZGVudGl0aWVzKSB7XG4gICAgcmV0dXJuIHthZGRyZXNzOiBjb25maWcuYWRkcmVzcywgYWxsb3dEeW5hbWljSWRlbnRpdGllczogdHJ1ZSwgY2FwYWJpbGl0eTogY29uZmlnLmNhcGFiaWxpdHl9XG4gIH1cbiAgcmV0dXJuIHthZGRyZXNzOiBjb25maWcuYWRkcmVzcywgY2FwYWJpbGl0eTogY29uZmlnLmNhcGFiaWxpdHl9XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGNvbmNyZXRlLWRyaXZlciBzdWJjbGFzcyB0aGF0IHJldGFpbnMgYWxsIGxvY2FsIFNRTC9xdWVyeS9tb2RlbFxuICogYnVpbGRlcnMgd2hpbGUgZm9yd2FyZGluZyBvbmx5IHBoeXNpY2FsIGNvbm5lY3Rpb24gYWN0aW9ucyB0byB0aGUgcGFyZW50LlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IERyaXZlckNsYXNzIC0gQ29uZmlndXJlZCBjb25jcmV0ZSBkcml2ZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gY29uZmlnIC0gRGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ2hpbGQgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBMb2dpY2FsIGlkZW50aWZpZXIuXG4gKiBAcGFyYW0ge3thZGRyZXNzOiBzdHJpbmcsIGNhcGFiaWxpdHk6IHN0cmluZywgcmV1c2VLZXk/OiBzdHJpbmd9fSBicm9rZXJDb25maWcgLSBCcm9rZXIgY29vcmRpbmF0ZXMuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVW5jb25uZWN0ZWQgcGh5c2ljYWwgcHJveHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTaGFyZWRUcmFuc2FjdGlvblByb3h5RHJpdmVyKERyaXZlckNsYXNzLCBjb25maWcsIGNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgYnJva2VyQ29uZmlnKSB7XG4gIGNsYXNzIFNoYXJlZFRyYW5zYWN0aW9uUHJveHlEcml2ZXIgZXh0ZW5kcyBEcml2ZXJDbGFzcyB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICBzdXBlcihjb25maWcsIGNvbmZpZ3VyYXRpb24pXG4gICAgICB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ2xpZW50ID0gbmV3IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ2xpZW50KHsuLi5icm9rZXJDb25maWcsIGRhdGFiYXNlSWRlbnRpZmllcn0pXG4gICAgICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICAgIHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Sb290U2F2ZVBvaW50ID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29ubmVjdHMgdGhlIHByb3h5IHRyYW5zcG9ydC5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICAgKi9cbiAgICBhc3luYyBjb25uZWN0KCkgeyBhd2FpdCB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ2xpZW50LmNvbm5lY3RlZCgpIH1cbiAgICAvKipcbiAgICAgKiBDbG9zZXMgb25seSB0aGUgcHJveHkgdHJhbnNwb3J0LlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgICAqL1xuICAgIGFzeW5jIF9jbG9zZSgpIHsgYXdhaXQgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNsaWVudC5jbG9zZSgpIH1cbiAgICAvKipcbiAgICAgKiBLZWVwcyBhIGJyb2tlciBwcm94eSB0cmFuc3BvcnQgYWxpdmUgYWNyb3NzIGxvZ2ljYWwgTXlTUUwgY2hlY2tvdXRzLlxuICAgICAqIFBhcmVudCBUZXN0UnVubmVyIG93bnMgcGh5c2ljYWwgc2Vzc2lvbiBjbGVhbnVwIGFuZCByb2xsYmFjay5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aXRob3V0IGNsb3NpbmcgdGhlIHRyYW5zcG9ydC5cbiAgICAgKi9cbiAgICBhc3luYyBjbGVhbnVwU2Vzc2lvblN0YXRlQWZ0ZXJDaGVja291dCgpIHt9XG4gICAgLyoqXG4gICAgICogUm91dGVzIGEgcGh5c2ljYWwgcXVlcnkuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdGF0ZW1lbnQuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gUm93cy5cbiAgICAgKi9cbiAgICBhc3luYyBfcXVlcnlBY3R1YWwoc3FsKSB7IHJldHVybiBhd2FpdCB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ2xpZW50LmNhbGwoXCJfcXVlcnlBY3R1YWxcIiwgW3NxbF0pIH1cbiAgICAvKipcbiAgICAgKiBSb3V0ZXMgYW4gYWZmZWN0ZWQtcm93IHF1ZXJ5LlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RhdGVtZW50LlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93cy5cbiAgICAgKi9cbiAgICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkgeyByZXR1cm4gYXdhaXQgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNsaWVudC5jYWxsKFwiX2FmZmVjdGVkUm93c0FjdHVhbFwiLCBbc3FsXSkgfVxuXG4gICAgLyoqXG4gICAgICogU3RhcnRzIGEgY2hpbGQgdHJhbnNhY3Rpb24gYXMgYSBwYXJlbnQgc2F2ZXBvaW50LlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RhcnRlZC5cbiAgICAgKi9cbiAgICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbigpIHtcbiAgICAgIHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Sb290U2F2ZVBvaW50ID0gdGhpcy5nZW5lcmF0ZVNhdmVQb2ludE5hbWUoKVxuICAgICAgYXdhaXQgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNsaWVudC5jYWxsKFwicm9vdFRyYW5zYWN0aW9uU3RhcnRcIiwgW3RoaXMuc2hhcmVkVHJhbnNhY3Rpb25Sb290U2F2ZVBvaW50XSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWxlYXNlcyB0aGUgY2hpbGQgdHJhbnNhY3Rpb24gc2F2ZXBvaW50LlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVsZWFzZWQuXG4gICAgICovXG4gICAgYXN5bmMgX2NvbW1pdFRyYW5zYWN0aW9uQWN0aW9uKCkge1xuICAgICAgaWYgKCF0aGlzLnNoYXJlZFRyYW5zYWN0aW9uUm9vdFNhdmVQb2ludCkgdGhyb3cgbmV3IEVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIHByb3h5IGhhcyBubyByb290IHNhdmVwb2ludFwiKVxuICAgICAgYXdhaXQgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNsaWVudC5jYWxsKFwicm9vdFRyYW5zYWN0aW9uUmVsZWFzZVwiLCBbdGhpcy5zaGFyZWRUcmFuc2FjdGlvblJvb3RTYXZlUG9pbnRdKVxuICAgICAgdGhpcy5zaGFyZWRUcmFuc2FjdGlvblJvb3RTYXZlUG9pbnQgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSb2xscyBiYWNrIHRoZSBjaGlsZCB0cmFuc2FjdGlvbiBzYXZlcG9pbnQuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByb2xsZWQgYmFjay5cbiAgICAgKi9cbiAgICBhc3luYyBfcm9sbGJhY2tUcmFuc2FjdGlvbkFjdGlvbigpIHtcbiAgICAgIGlmICghdGhpcy5zaGFyZWRUcmFuc2FjdGlvblJvb3RTYXZlUG9pbnQpIHRocm93IG5ldyBFcnJvcihcIlNoYXJlZCB0cmFuc2FjdGlvbiBwcm94eSBoYXMgbm8gcm9vdCBzYXZlcG9pbnRcIilcbiAgICAgIGF3YWl0IHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25DbGllbnQuY2FsbChcInJvb3RUcmFuc2FjdGlvblJvbGxiYWNrXCIsIFt0aGlzLnNoYXJlZFRyYW5zYWN0aW9uUm9vdFNhdmVQb2ludF0pXG4gICAgICB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uUm9vdFNhdmVQb2ludCA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEVzY2FwZXMgYSBsb2NhbCBTUUwgdmFsdWUuXG4gICAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTUUwgdmFsdWUuXG4gICAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEVzY2FwZWQgdmFsdWUuXG4gICAgICovXG4gICAgZXNjYXBlKHZhbHVlKSB7XG4gICAgICBpZiAodGhpcy5nZXRUeXBlKCkgIT09IFwicGdzcWxcIikgcmV0dXJuIHN1cGVyLmVzY2FwZSh2YWx1ZSlcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuICAgICAgY29uc3QgZXNjYXBlZCA9IHBnRXNjYXBlTGl0ZXJhbCh0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpKVxuICAgICAgcmV0dXJuIGVzY2FwZWQuc2xpY2UoMSwgLTEpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUXVvdGVzIGEgbG9jYWwgU1FMIHZhbHVlLlxuICAgICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU1FMIHZhbHVlLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gUXVvdGVkIHZhbHVlLlxuICAgICAqL1xuICAgIHF1b3RlKHZhbHVlKSB7XG4gICAgICBpZiAodGhpcy5nZXRUeXBlKCkgIT09IFwicGdzcWxcIikgcmV0dXJuIHN1cGVyLnF1b3RlKHZhbHVlKVxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG4gICAgICByZXR1cm4gcGdFc2NhcGVMaXRlcmFsKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU3RyZWFtcyBicm9rZXJlZCByb3dzIHRocm91Z2ggdGhlIGRyaXZlcidzIGJ1ZmZlcmVkIGZhbGxiYWNrLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RhdGVtZW50LlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICAgKiBAeWllbGRzIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0IHJvd3MuXG4gICAgICovXG4gICAgYXN5bmMgKnF1ZXJ5U3RyZWFtKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShzcWwsIG9wdGlvbnMpXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB5aWVsZCByb3dcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBLZWVwcyBzdHJ1Y3R1cmUgU1FMIG9uIG5vcm1hbCBicm9rZXJlZCBzdGF0ZW1lbnRzLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIEFsd2F5cyBmYWxzZS5cbiAgICAgKi9cbiAgICBhc3luYyBleGVjU3RydWN0dXJlU2NyaXB0KCkgeyByZXR1cm4gZmFsc2UgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTaGFyZWRUcmFuc2FjdGlvblByb3h5RHJpdmVyKClcbn1cbiJdfQ==
import Logger from "../logger.js";
/**
 * Loads table and column metadata for a whole set of model classes up front.
 *
 * Model initialization otherwise reads each table's columns on its own, which
 * turns a boot into one catalog query per model (and per HTTP worker process).
 * Drivers that can answer for many tables in one statement are asked to do so;
 * the resulting columns are seeded into the driver's per-table schema cache, so
 * the initialization pass that follows resolves without querying at all.
 */
export default class SchemaMetadataPrefetcher {
    configuration: import("../configuration.js").default;
    concurrency: number;
    logger: Logger;
    /**
     * Builds a prefetcher for one configuration.
     * @param {object} args - Prefetcher args.
     * @param {import("../configuration.js").default} args.configuration - Configuration owning the database connections.
     * @param {number} [args.concurrency] - Concurrency for drivers that can only read one table per query.
     * @param {import("../logger.js").default} [args.logger] - Logger for debug output.
     */
    constructor({ configuration, concurrency, logger }: {
        configuration: import("../configuration.js").default;
        concurrency?: number;
        logger?: import("../logger.js").default;
    });
    /**
     * Prefetches column metadata for every model class that has a reachable table.
     *
     * Models whose table or connection is unavailable are skipped: their
     * initialization stays deferred and will initialize lazily on first use, which
     * is the same contract the per-model initialization applies.
     * @param {{modelClasses: Array<typeof import("./record/index.js").default>}} args - Model classes to prefetch for.
     * @returns {Promise<void>}
     */
    prefetch({ modelClasses }: {
        modelClasses: Array<typeof import("./record/index.js").default>;
    }): Promise<void>;
    /**
     * Resolves a model's table without initializing its record metadata.
     * @param {typeof import("./record/index.js").default} modelClass - Model class to resolve a table for.
     * @returns {Promise<import("./drivers/base-table.js").default | null>} Table, or null when it is not reachable.
     */
    tableFor(modelClass: typeof import("./record/index.js").default): Promise<import("./drivers/base-table.js").default | null>;
    /**
     * Looks a table up in the driver's table list without throwing when absent.
     * @param {import("./drivers/base.js").default} driver - Driver owning the table.
     * @param {string} tableName - Table name to resolve.
     * @returns {Promise<import("./drivers/base-table.js").default | null>} Table, or null when it does not exist.
     */
    tableByName(driver: import("./drivers/base.js").default, tableName: string): Promise<import("./drivers/base-table.js").default | null>;
}
//# sourceMappingURL=schema-metadata-prefetcher.d.ts.map
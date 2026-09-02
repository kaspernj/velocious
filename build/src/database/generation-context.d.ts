import Tenant from "../tenants/tenant.js";
/**
 * Immutable selection of one logical tenant database and one provider-resolved
 * physical tenant. Schema tools can share this contract without ambient or
 * process-global selection state.
 */
export default class DatabaseGenerationContext {
    _configuration: import("../configuration.js").default;
    _databaseIdentifier: string;
    _handle: import("../tenants/tenant-handle.js").default;
    /**
     * Resolves one tenant-only database from its provider and captures its physical identity.
     * @param {object} args - Selection arguments.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {string} args.databaseIdentifier - Logical tenant-only database identifier.
     * @returns {Promise<DatabaseGenerationContext>} - Immutable selected database context.
     */
    static resolve({ configuration, databaseIdentifier }: {
        configuration: import("../configuration.js").default;
        databaseIdentifier: string;
    }): Promise<DatabaseGenerationContext>;
    /**
     * Runs constructor.
     * @param {object} args - Captured selection.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {string} args.databaseIdentifier - Logical database identifier.
     * @param {ReturnType<typeof Tenant.handle>} args.handle - Captured tenant handle.
     */
    constructor({ configuration, databaseIdentifier, handle }: {
        configuration: import("../configuration.js").default;
        databaseIdentifier: string;
        handle: ReturnType<typeof Tenant.handle>;
    });
    /**
     * Returns the captured logical database identifier.
     * @returns {string} - Captured logical database identifier.
     */
    databaseIdentifier(): string;
    /**
     * Returns the captured physical database configuration.
     * @returns {import("../configuration-types.js").DatabaseConfigurationType} - Captured physical database configuration.
     */
    databaseConfiguration(): import("../configuration-types.js").DatabaseConfigurationType;
    /**
     * Returns the captured tenant descriptor.
     * @returns {ReturnType<ReturnType<typeof Tenant.handle>["tenant"]>} - Captured immutable tenant descriptor.
     */
    tenant(): ReturnType<ReturnType<typeof Tenant.handle>["tenant"]>;
    /**
     * Runs work on one connection pinned to the captured physical database.
     * @template T
     * @param {object} args - Work arguments.
     * @param {(connection: import("./drivers/base.js").default) => Promise<T>} args.callback - Selected database work.
     * @param {string} args.name - Checkout name.
     * @returns {Promise<T>} - Callback result.
     */
    run<T>({ callback, name }: {
        callback: (connection: import("./drivers/base.js").default) => Promise<T>;
        name: string;
    }): Promise<T>;
}
//# sourceMappingURL=generation-context.d.ts.map
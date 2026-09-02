export default class TenantDatabaseCommandHelper {
    command: import("./base-command.js").default;
    configuration: import("../configuration.js").default;
    heartbeatIntervalMs: number;
    identifier: string;
    output: (message: string) => void;
    provider: import("../configuration-types.js").TenantDatabaseProviderType;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./base-command.js").default} args.command - CLI command instance.
     * @param {number} [args.heartbeatIntervalMs] - Interval between progress heartbeats.
     * @param {string | undefined} args.identifier - Tenant database identifier.
     * @param {(message: string) => void} [args.output] - Progress output handler.
     */
    constructor({ command, heartbeatIntervalMs, identifier, output }: {
        command: import("./base-command.js").default;
        heartbeatIntervalMs?: number;
        identifier: string | undefined;
        output?: (message: string) => void;
    });
    /**
     * Runs validate tenant database identifier.
     * @returns {void} */
    validateTenantDatabaseIdentifier(): void;
    /**
     * Runs initialize runtime.
     * @returns {Promise<void>} - Resolves when app runtime is initialized.
     */
    initializeRuntime(): Promise<void>;
    /**
     * Runs list tenants.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Tenants.
     */
    listTenants(): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Runs each tenant.
     * @param {(args: {databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ReturnType<typeof JSON.parse>}) => Promise<void>} callback - Callback.
     * @returns {Promise<number>} - Number of tenants processed.
     */
    eachTenant(callback: (args: {
        databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
        tenant: ReturnType<typeof JSON.parse>;
    }) => Promise<void>): Promise<number>;
    /**
     * Runs parallel count.
     * @returns {number} - Number of tenants to process concurrently.
     */
    parallelCount(): number;
}
//# sourceMappingURL=tenant-database-command-helper.d.ts.map
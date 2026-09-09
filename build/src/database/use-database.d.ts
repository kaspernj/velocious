/**
 * Initializes either the legacy ambient frontend database or one immutable
 * tenant-bound physical database generation.
 * @param {object} args - Initialization options.
 * @param {import("../configuration.js").default} args.configuration - Current frontend configuration.
 * @param {string} [args.databaseIdentifier] - Tenant-only logical database identifier.
 * @param {() => Promise<import("./migrator/types.js").RequireMigrationContextType>} args.migrationsRequireContextCallback - Migrations loader.
 * @param {string} [args.schemaGeneration] - Tenant schema generation.
 * @param {import("../tenants/tenant-handle.js").default} [args.tenantHandle] - Immutable tenant handle.
 * @returns {Promise<void>} - Resolves when the selected database is ready.
 */
export declare function initializeFrontendDatabase({ configuration, databaseIdentifier, migrationsRequireContextCallback, schemaGeneration, tenantHandle }: {
    configuration: import("../configuration.js").default;
    databaseIdentifier?: string;
    migrationsRequireContextCallback: () => Promise<import("./migrator/types.js").RequireMigrationContextType>;
    schemaGeneration?: string;
    tenantHandle?: import("../tenants/tenant-handle.js").default;
}): Promise<void>;
/**
 * React lifecycle hook for frontend database readiness. With `tenantHandle`,
 * readiness follows that immutable physical tenant plus `schemaGeneration`;
 * changing either cancels the stale render result without cancelling shared
 * lifecycle work needed by another caller.
 * @param {object} args - Hook options.
 * @param {string} [args.databaseIdentifier] - Tenant-only logical database identifier.
 * @param {() => Promise<import("./migrator/types.js").RequireMigrationContextType>} args.migrationsRequireContextCallback - Migrations loader.
 * @param {string} [args.schemaGeneration] - Tenant schema generation.
 * @param {import("../tenants/tenant-handle.js").default} [args.tenantHandle] - Immutable tenant handle.
 * @returns {{error: Error | null, loaded: boolean}} - Selected database readiness.
 */
export default function useDatabase({ databaseIdentifier, migrationsRequireContextCallback, schemaGeneration, tenantHandle, ...restArgs }: {
    databaseIdentifier?: string;
    migrationsRequireContextCallback: () => Promise<import("./migrator/types.js").RequireMigrationContextType>;
    schemaGeneration?: string;
    tenantHandle?: import("../tenants/tenant-handle.js").default;
}): {
    error: Error | null;
    loaded: boolean;
};
//# sourceMappingURL=use-database.d.ts.map
/**
 * Exercises two durable physical tenant databases inside the real browser.
 * @returns {Promise<{alphaNames: ReturnType<typeof JSON.parse>[], betaNames: ReturnType<typeof JSON.parse>[], identitiesAreDistinct: boolean, openCount: number}>} Serializable proof result.
 */
export default function runFrontendTenantDatabasePersistenceScenario(): Promise<{
    alphaNames: ReturnType<typeof JSON.parse>[];
    betaNames: ReturnType<typeof JSON.parse>[];
    identitiesAreDistinct: boolean;
    openCount: number;
}>;
//# sourceMappingURL=browser-frontend-tenant-database-scenarios.d.ts.map
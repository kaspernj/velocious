export type MigrationExecutionPhase = "post-publication" | "pre-runtime";
/** @typedef {"post-publication" | "pre-runtime"} MigrationExecutionPhase */
/** @type {MigrationExecutionPhase} */
export declare const DEFAULT_MIGRATION_EXECUTION_PHASE: MigrationExecutionPhase;
/**
 * Validates and returns one supported migration execution phase.
 * @param {string | undefined} phase - Migration execution phase.
 * @returns {MigrationExecutionPhase} - Validated execution phase.
 */
export declare function migrationExecutionPhase(phase: string | undefined): MigrationExecutionPhase;
/**
 * Tests whether a migration class belongs to an optional selected phase.
 * @param {typeof import("./migration/index.js").default} MigrationClass - Migration class.
 * @param {MigrationExecutionPhase | undefined} executionPhase - Optional selected phase.
 * @returns {boolean} - Whether the migration belongs to the selection.
 */
export declare function migrationRunsInExecutionPhase(MigrationClass: typeof import("./migration/index.js").default, executionPhase: MigrationExecutionPhase | undefined): boolean;
//# sourceMappingURL=migration-execution-phase.d.ts.map
// @ts-check

/** @typedef {"post-publication" | "pre-runtime"} MigrationExecutionPhase */

/** @type {MigrationExecutionPhase} */
export const DEFAULT_MIGRATION_EXECUTION_PHASE = "pre-runtime"

/**
 * Validates and returns one supported migration execution phase.
 * @param {string | undefined} phase - Migration execution phase.
 * @returns {MigrationExecutionPhase} - Validated execution phase.
 */
export function migrationExecutionPhase(phase) {
  if (phase === undefined) {
    throw new Error("Missing migration execution phase. Expected one of: pre-runtime, post-publication")
  }
  if (phase !== "pre-runtime" && phase !== "post-publication") {
    throw new Error(`Unknown migration execution phase ${JSON.stringify(phase)}. Expected one of: pre-runtime, post-publication`)
  }

  return phase
}

/**
 * Tests whether a migration class belongs to an optional selected phase.
 * @param {typeof import("./migration/index.js").default} MigrationClass - Migration class.
 * @param {MigrationExecutionPhase | undefined} executionPhase - Optional selected phase.
 * @returns {boolean} - Whether the migration belongs to the selection.
 */
export function migrationRunsInExecutionPhase(MigrationClass, executionPhase) {
  if (executionPhase === undefined) return true

  return MigrationClass.getExecutionPhase() === executionPhase
}

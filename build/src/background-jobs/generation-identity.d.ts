export type GenerationValueSource = {
    /**
     * - Human-readable source name.
     */
    name: string;
    /**
     * - Whether the source was explicitly supplied.
     */
    present: boolean;
    /**
     * - Supplied value.
     */
    value: ReturnType<typeof JSON.parse> | undefined;
};
/**
 * Validates one release generation identifier.
 * @param {ReturnType<typeof JSON.parse> | undefined} value - Candidate value.
 * @param {string} [sourceName] - Source label for failures.
 * @returns {string} - Valid generation id.
 */
export declare function validateGenerationId(value: ReturnType<typeof JSON.parse> | undefined, sourceName?: string): string;
/**
 * Resolves explicitly present generation identity sources without precedence.
 * @param {GenerationValueSource[]} sources - Identity sources.
 * @returns {string | undefined} - Identical resolved identity or legacy unset.
 */
export declare function resolveGenerationId(sources: GenerationValueSource[]): string | undefined;
/**
 * Resolves the boot lifecycle state.
 * @param {GenerationValueSource[]} sources - State sources.
 * @param {string | undefined} generationId - Resolved generation identity.
 * @returns {import("./types.js").BackgroundJobsGenerationInitialState | "active"} - Boot state.
 */
export declare function resolveInitialGenerationState(sources: GenerationValueSource[], generationId: string | undefined): import("./types.js").BackgroundJobsGenerationInitialState | "active";
/**
 * Resolves the optional release-local lifecycle socket path.
 * @param {GenerationValueSource[]} sources - Path sources.
 * @param {string | undefined} generationId - Resolved generation identity.
 * @returns {string | undefined} - Absolute Unix socket path.
 */
export declare function resolveLifecycleSocketPath(sources: GenerationValueSource[], generationId: string | undefined): string | undefined;
/**
 * Creates the exact durable worker owner token.
 * @param {object} args - Owner parts.
 * @param {string} args.generationId - Release generation.
 * @param {string} args.workerInstanceId - Worker process UUID.
 * @returns {string} - Generation-qualified durable worker id.
 */
export declare function createGenerationWorkerId({ generationId, workerInstanceId }: {
    generationId: string;
    workerInstanceId: string;
}): string;
/**
 * Parses a generation-qualified durable worker id.
 * @param {ReturnType<typeof JSON.parse>} workerId - Durable worker id.
 * @returns {{generationId: string, workerInstanceId: string} | null} - Parsed owner or null.
 */
export declare function parseGenerationWorkerId(workerId: ReturnType<typeof JSON.parse>): {
    generationId: string;
    workerInstanceId: string;
} | null;
/**
 * Checks exact parsed generation ownership.
 * @param {object} args - Ownership query.
 * @param {string} args.generationId - Expected generation.
 * @param {ReturnType<typeof JSON.parse>} args.workerId - Durable worker id.
 * @returns {boolean} - Whether the parsed owner belongs to the generation.
 */
export declare function workerIdBelongsToGeneration({ generationId, workerId }: {
    generationId: string;
    workerId: ReturnType<typeof JSON.parse>;
}): boolean;
//# sourceMappingURL=generation-identity.d.ts.map
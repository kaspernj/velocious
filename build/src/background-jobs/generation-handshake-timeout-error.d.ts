export declare const DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS = 4000;
/** Actionable failure for an unacknowledged generation hello. */
export default class BackgroundJobsGenerationHandshakeTimeoutError extends Error {
    /**
     * Creates an actionable generation-handshake deadline failure.
     * @param {object} args - Timeout context.
     * @param {string} args.endpoint - Main endpoint.
     * @param {string} args.generationId - Expected generation.
     * @param {"worker" | "client" | "reporter"} args.role - Initiating peer role.
     * @param {number} args.timeoutMs - Handshake deadline.
     */
    constructor({ endpoint, generationId, role, timeoutMs }: {
        endpoint: string;
        generationId: string;
        role: "worker" | "client" | "reporter";
        timeoutMs: number;
    });
}
/**
 * Validates a generation handshake deadline.
 * @param {number} timeoutMs - Candidate deadline.
 * @returns {number} - Valid deadline.
 */
export declare function validateGenerationHandshakeTimeoutMs(timeoutMs: number): number;
//# sourceMappingURL=generation-handshake-timeout-error.d.ts.map
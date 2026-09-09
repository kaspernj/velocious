/**
 * Attempts every shutdown step and preserves failures in execution order.
 * Caught values are intentionally opaque because JavaScript permits throwing
 * values that are not `Error` instances.
 * @param {object} args - Shutdown steps.
 * @param {string} args.message - Aggregate error message.
 * @param {Array<() => void | Promise<void>>} args.steps - Ordered steps to attempt.
 * @returns {Promise<void>} - Resolves when every step succeeds.
 */
export declare function runShutdownSteps({ message, steps }: {
    message: string;
    steps: Array<() => void | Promise<void>>;
}): Promise<void>;
/**
 * Runs service shutdown and its completion hook while preserving both failures.
 * @param {object} args - Lifecycle callbacks.
 * @param {() => Promise<void>} args.shutdown - Primary service shutdown.
 * @param {() => void | Promise<void>} [args.onStopped] - Completion hook.
 * @returns {Promise<void>} - Resolves after shutdown and the hook finish.
 */
export default function shutdownLifecycle({ shutdown, onStopped }: {
    shutdown: () => Promise<void>;
    onStopped?: () => void | Promise<void>;
}): Promise<void>;
//# sourceMappingURL=shutdown-lifecycle.d.ts.map
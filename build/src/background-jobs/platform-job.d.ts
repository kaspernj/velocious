/**
 * Base class for background jobs.
 *
 * `TArgs` is the tuple of arguments the subclass's `perform` accepts, so a job that
 * needs arguments declares them as required and typed — for example
 * `class RunBuildJob extends VelociousJob<[string]>` with `async perform(buildId)`.
 * The default empty tuple keeps argument-less jobs (`extends VelociousJob`,
 * `async perform()`) working unchanged.
 * @template {Array<ReturnType<typeof JSON.parse>>} [TArgs=[]]
 */
export default class VelociousJob<TArgs extends Array<ReturnType<typeof JSON.parse>> = []> {
    /** @type {import("./types.js").BackgroundJobContext | undefined} */
    _backgroundJobContext: import("./types.js").BackgroundJobContext | undefined;
    constructor();
    /**
     * Database identifiers checked out while this job performs. Set an explicit
     * list to avoid holding unrelated configured database connections, or `[]`
     * when the job establishes any connections it needs itself. Left undefined,
     * jobs retain the existing behavior of checking out every active database.
     * @type {string[] | undefined}
     */
    static databaseIdentifiers: string[] | undefined;
    /**
     * Queue this job class runs on. Subclasses set e.g. `static queue = "builds"`
     * to route onto a queue with its own cluster-wide concurrency cap (configured
     * via `backgroundJobs.queues`). The `{queue}` enqueue option overrides it.
     * Left undefined, jobs run on the `"default"` queue.
     * @type {string | undefined}
     */
    static queue: string | undefined;
    /**
     * Optional process title shown for the runner while this job executes.
     * Velocious sets `process.title` to this for the duration of the job — so
     * `ps`/`top`/`htop` identify what a runner is doing — and restores the
     * runner's base title when the job finishes. Left undefined, the runner falls
     * back to `velocious job-runner: <JobName>`. Set e.g.
     * `static processTitle = "velocious media transcoder"` to give a job a
     * custom, human-readable title.
     * @type {string | undefined}
     */
    static processTitle: string | undefined;
    /**
     * Stops this performance and reschedules the same logical job row. This is
     * normal control flow: it does not count as a failure or consume a retry.
     * @param {number} delayMs - Non-negative safe-integer delay in milliseconds.
     * @returns {never} - This method never returns.
     */
    rescheduleIn(delayMs: number): never;
    /**
     * Runs job name.
     * @returns {string} - Job name.
     */
    static jobName(): string;
    /**
     * Folds this job class's static `queue` into the enqueue options unless the
     * caller already specified one.
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @returns {import("./types.js").BackgroundJobOptions} - Options including the resolved queue.
     */
    static _withQueue(options: import("./types.js").BackgroundJobOptions | undefined): import("./types.js").BackgroundJobOptions;
    /**
     * Resolves class-derived enqueue options on a hydrated job instance. Explicit
     * per-enqueue options take precedence over the instance concurrency key.
     * @param {object} args - Job context.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
     * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
     * @returns {import("./types.js").BackgroundJobOptions} - Resolved job options.
     */
    static _withJobContext({ jobArgs, jobOptions }: {
        jobArgs: Array<ReturnType<typeof JSON.parse>>;
        jobOptions: import("./types.js").BackgroundJobOptions | undefined;
    }): import("./types.js").BackgroundJobOptions;
    /**
     * Sets the complete context available to this hydrated job instance.
     * Framework enqueue/runner boundaries own this method.
     * @param {import("./types.js").BackgroundJobContext} context - Job context.
     * @returns {void}
     */
    _setBackgroundJobContext(context: import("./types.js").BackgroundJobContext): void;
    /**
     * Returns this hydrated job's complete enqueue or runner context.
     * @returns {import("./types.js").BackgroundJobContext} - Job context.
     */
    backgroundJobContext(): import("./types.js").BackgroundJobContext;
    /**
     * Override to derive a durable concurrency key from `backgroundJobContext()`.
     * Pair the derived key with `maxConcurrency` in enqueue options. An explicit
     * per-enqueue `concurrencyKey` takes precedence and skips this method.
     * @returns {string | undefined} - Derived concurrency key, or undefined for none.
     */
    concurrencyKey(): string | undefined;
    /**
     * Runs perform later.
     * @param {...ReturnType<typeof JSON.parse>} args - Job args.
     * @returns {Promise<string>} - Job id.
     */
    static performLater(...args: ReturnType<typeof JSON.parse>[]): Promise<string>;
    /**
     * Runs perform later with options.
     * @param {object} args - Options.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<string>} - Job id.
     */
    static performLaterWithOptions({ args, options }: {
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<string>;
    /**
     * Atomically replaces this job class's queued owner for a stable schedule key.
     * @param {object} args - Options.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    static replaceScheduled({ scheduleKey, args, options }: {
        scheduleKey: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<import("./types.js").BackgroundJobReplacementResult>;
    /**
     * Cancels or detaches the current owner of a stable schedule key.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    static cancelScheduled(scheduleKey: string): Promise<import("./types.js").BackgroundJobCancellationResult>;
    /**
     * Runs split args and options.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Job args.
     * @returns {{jobArgs: Array<ReturnType<typeof JSON.parse>>, jobOptions: import("./types.js").BackgroundJobOptions}} - Split args and options.
     */
    static _splitArgsAndOptions(args: Array<ReturnType<typeof JSON.parse>>): {
        jobArgs: Array<ReturnType<typeof JSON.parse>>;
        jobOptions: import("./types.js").BackgroundJobOptions;
    };
    /**
     * Override in subclasses.
     * @param {TArgs} _args - Job args (the tuple this job class was parameterized with).
     * @returns {Promise<void>} - Resolves when complete.
     */
    perform(..._args: TArgs): Promise<void>;
}
//# sourceMappingURL=platform-job.d.ts.map
export type TestProfileAttemptStatus = "passed" | "failed" | "interrupted" | "timed-out";
export type ProcessCpuUsage = {
    user: number;
    system: number;
};
export type ProfileDatabaseAggregate = {
    queryCount: number;
    failedQueryCount: number;
    totalMs: number;
    maxMs: number;
};
export type ProfileActionAggregate = {
    count: number;
    failedCount: number;
    totalMs: number;
    maxMs: number;
};
export type ProfilePoolAggregate = {
    identifier: string;
    connectionCreation: ProfileActionAggregate;
    checkoutWait: {
        count: number;
        totalMs: number;
        maxMs: number;
    };
    checkoutTimeoutCount: number;
    idleReap: ProfileActionAggregate & {
        disposalCount: number;
    };
    peakLiveConnections: number;
};
export type TestProfileAsyncContext = {
    /**
     * - Owning profiler.
     */
    profiler: TestProfiler;
    /**
     * - Active test attempt.
     */
    attempt: TestProfileAttemptRecord | undefined;
    /**
     * - Whether attribution is still open.
     */
    active: boolean;
    /**
     * - Contexts sharing one attempt lifetime.
     */
    attemptContexts?: Set<TestProfileAsyncContext> | undefined;
    /**
     * - Project-relative owning test file.
     */
    filePath: string | undefined;
    /**
     * - Innermost active profile span.
     */
    span?: TestProfileSpan | undefined;
    /**
     * - Span monotonic start time.
     */
    spanStartedAt?: number;
    /**
     * - Span CPU start time.
     */
    spanCpuStartedAt?: ProcessCpuUsage;
};
export type TestProfileSpan = {
    /**
     * - Profile phase.
     */
    phase: string;
    /**
     * - Monotonic span start order.
     */
    executionOrder: number;
    /**
     * - Real duration.
     */
    durationMs: number;
    /**
     * - Process CPU duration.
     */
    cpuMs: {
        user: number;
        system: number;
        total: number;
    };
    /**
     * - Validated custom activity name.
     */
    activity?: string;
    /**
     * - Hook index within its declaration scope.
     */
    declarationIndex?: number;
    /**
     * - Opaque declaration scope identifier.
     */
    declarationScopeId?: string;
    /**
     * - Project-relative source path.
     */
    file?: string;
    /**
     * - Span database aggregate.
     */
    database?: ProfileDatabaseAggregate;
    /**
     * - Span pool aggregates.
     */
    pools?: ProfilePoolAggregate[];
};
export type TestProfileAttemptRecord = {
    /**
     * - One-indexed attempt number.
     */
    number: number;
    /**
     * - Attempt result.
     */
    status: TestProfileAttemptStatus | "running";
    /**
     * - Real duration.
     */
    durationMs: number;
    /**
     * - Process CPU duration.
     */
    cpuMs: {
        user: number;
        system: number;
        total: number;
    };
    /**
     * - Attempt-owned spans.
     */
    spans: TestProfileSpan[];
};
export type TestProfileAttemptHandle = {
    /**
     * - Async attribution context.
     */
    context: TestProfileAsyncContext;
    /**
     * - Output attempt record.
     */
    attempt: TestProfileAttemptRecord;
    /**
     * - Real start time.
     */
    startedAt: number;
    /**
     * - CPU start time.
     */
    cpuStartedAt: ProcessCpuUsage;
};
export type InternalPhaseAggregate = {
    /**
     * - Invocation count.
     */
    count: number;
    /**
     * - Total real duration.
     */
    totalMs: number;
    /**
     * - Maximum real duration.
     */
    maxMs: number;
    /**
     * - Total user CPU time.
     */
    cpuUserMs: number;
    /**
     * - Total system CPU time.
     */
    cpuSystemMs: number;
};
export type InternalFileAggregate = {
    /**
     * - Project-relative path.
     */
    path: string;
    /**
     * - Import duration.
     */
    importMs: number;
    /**
     * - Hook duration.
     */
    hooksMs: number;
    /**
     * - Test body duration.
     */
    testsMs: number;
    /**
     * - Complete test-attempt duration.
     */
    attemptsMs: number;
    /**
     * - Total file weight duration.
     */
    totalMs: number;
};
export type InternalTestRecord = {
    /**
     * - Opaque stable test identifier.
     */
    id: string;
    /**
     * - Project-relative source path.
     */
    file: string;
    /**
     * - Declaration line.
     */
    line: number | undefined;
    /**
     * - Attempt records.
     */
    attempts: TestProfileAttemptRecord[];
};
/**
 * Rounds and bounds duration values for public output.
 * @param {number} durationMs - Raw duration.
 * @returns {number} - Safe duration.
 */
export declare function roundProfileDuration(durationMs: number): number;
/**
 * Collects opt-in test-run timing without retaining application payloads.
 */
export default class TestProfiler {
    _configuration: import("../configuration.js").default;
    _projectDirectory: string;
    _selection: Record<string, any>;
    _startedAt: number;
    _cpuStartedAt: NodeJS.CpuUsage;
    _executionOrder: number;
    _unattributedLateEventCount: number;
    /** @type {Map<string, InternalPhaseAggregate>} */
    _phases: Map<string, InternalPhaseAggregate>;
    /** @type {Map<string, InternalFileAggregate>} */
    _files: Map<string, InternalFileAggregate>;
    /** @type {InternalTestRecord[]} */
    _tests: InternalTestRecord[];
    /** @type {Map<string, InternalTestRecord>} */
    _testsById: Map<string, InternalTestRecord>;
    /** @type {Set<TestProfileAttemptHandle>} */
    _activeAttempts: Set<TestProfileAttemptHandle>;
    /** @type {Set<TestProfileAsyncContext>} */
    _activeSpanContexts: Set<TestProfileAsyncContext>;
    /** @type {TestProfileSpan[]} */
    _spans: TestProfileSpan[];
    /** @type {Array<{id: string, parentId: string | undefined, file: string, line: number | undefined}>} */
    _scopes: Array<{
        id: string;
        parentId: string | undefined;
        file: string;
        line: number | undefined;
    }>;
    /** @type {WeakMap<import("./test-runner.js").TestsArgument, string>} */
    _scopeIds: WeakMap<import("./test-runner.js").TestsArgument, string>;
    /** @type {Set<string>} */
    _customActivityNames: Set<string>;
    _database: ProfileDatabaseAggregate;
    /** @type {Map<string, {hash: string, operation: string, count: number, failedCount: number, totalMs: number, maxMs: number}>} */
    _queryFingerprints: Map<string, {
        hash: string;
        operation: string;
        count: number;
        failedCount: number;
        totalMs: number;
        maxMs: number;
    }>;
    _transactions: {
        start: ProfileActionAggregate;
        commit: ProfileActionAggregate;
        rollback: ProfileActionAggregate;
    };
    /** @type {Map<string, ProfilePoolAggregate>} */
    _pools: Map<string, ProfilePoolAggregate>;
    _finishedProfile: {
        schema: string;
        schemaVersion: number;
        status: string;
        selection: {
            focused: boolean;
        };
        counts: {
            discovered: number;
            executed: number;
            failed: number;
            passed: number;
            attempts: number;
        };
        durationMs: number;
        cpuMs: {
            user: number;
            system: number;
            total: number;
        };
        phases: {
            [k: string]: {
                count: number;
                totalMs: number;
                maxMs: number;
                cpuMs: {
                    user: number;
                    system: number;
                    total: number;
                };
            };
        };
        files: {
            path: string;
            importMs: number;
            hooksMs: number;
            testsMs: number;
            attemptsMs: number;
            totalMs: number;
        }[];
        scopes: {
            id: string;
            parentId: string | undefined;
            file: string;
            line: number | undefined;
        }[];
        tests: {
            id: string;
            file: string;
            line: number | undefined;
            durationMs: number;
            attempts: TestProfileAttemptRecord[];
        }[];
        spans: TestProfileSpan[];
        database: {
            queryCount: number;
            failedQueryCount: number;
            totalMs: number;
            maxMs: number;
            fingerprints: {
                hash: string;
                operation: string;
                count: number;
                failedCount: number;
                totalMs: number;
                maxMs: number;
            }[];
            transactions: {
                start: ProfileActionAggregate;
                commit: ProfileActionAggregate;
                rollback: ProfileActionAggregate;
            };
        };
        pools: ProfilePoolAggregate[];
        unattributedLateEventCount: number;
        timingManifest: {
            [k: string]: number;
        };
    } | undefined;
    /**
     * Creates an opt-in test profile collector.
     * @param {object} args - Profiler options.
     * @param {import("../configuration.js").default} args.configuration - Test configuration.
     * @param {string} args.projectDirectory - Project root used for portable paths.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.selection] - Sanitized selection metadata.
     */
    constructor({ configuration, projectDirectory, selection }: {
        configuration: import("../configuration.js").default;
        projectDirectory: string;
        selection?: Record<string, ReturnType<typeof JSON.parse>>;
    });
    /**
     * Returns the profiler's monotonic clock.
     * @returns {number} - Monotonic milliseconds.
     */
    now(): number;
    /**
     * Converts a source path to a project-relative path or an opaque hash.
     * @param {string | undefined} filePath - Source path.
     * @returns {string} - Safe source identifier.
     */
    safeSourcePath(filePath: string | undefined): string;
    /**
     * Returns a bounded opaque SHA-256 identifier.
     * @param {string} value - Value to hash.
     * @returns {string} - Opaque hash.
     */
    hash(value: string): string;
    /**
     * Adds aggregate-only selection metadata as discovery progresses.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} selection - Safe selection metadata.
     * @returns {void}
     */
    setSelection(selection: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Registers and returns a deterministic scope identifier.
     * @param {import("./test-runner.js").TestsArgument} scope - Scope object.
     * @param {object} args - Scope metadata.
     * @param {string[]} args.descriptions - Scope description path.
     * @param {string | undefined} args.filePath - Scope source path.
     * @param {number | undefined} [args.line] - Scope source line.
     * @param {string | undefined} [args.parentId] - Parent scope identifier.
     * @returns {string} - Opaque scope identifier.
     */
    scopeId(scope: import("./test-runner.js").TestsArgument, { descriptions, filePath, line, parentId }: {
        descriptions: string[];
        filePath: string | undefined;
        line?: number | undefined;
        parentId?: string | undefined;
    }): string;
    /**
     * Starts an attempt and its async attribution context.
     * @param {object} args - Attempt metadata.
     * @param {string[]} args.descriptions - Parent descriptions.
     * @param {number} args.attemptNumber - Attempt number.
     * @param {import("./test-runner.js").TestData} args.testData - Test declaration.
     * @param {string} args.testDescription - Test description.
     * @returns {TestProfileAttemptHandle} - Active attempt handle.
     */
    startAttempt({ descriptions, attemptNumber, testData, testDescription }: {
        descriptions: string[];
        attemptNumber: number;
        testData: import("./test-runner.js").TestData;
        testDescription: string;
    }): TestProfileAttemptHandle;
    /**
     * Runs work inside an attempt's async context.
     * @template T
     * @param {TestProfileAttemptHandle} handle - Attempt handle.
     * @param {() => Promise<T>} callback - Attempt lifecycle.
     * @returns {Promise<T>} - Callback result.
     */
    runAttempt<T>(handle: TestProfileAttemptHandle, callback: () => Promise<T>): Promise<T>;
    /**
     * Completes an attempt and prevents descendant late work from retaining attribution.
     * @param {TestProfileAttemptHandle} handle - Attempt handle.
     * @param {TestProfileAttemptStatus} status - Attempt result.
     * @returns {void}
     */
    finishAttempt(handle: TestProfileAttemptHandle, status: TestProfileAttemptStatus): void;
    /**
     * Closes every active attempt and nested span at the current interruption boundary.
     * @returns {void}
     */
    interrupt(): void;
    /**
     * Runs a runner-owned phase span.
     * @template T
     * @param {object} args - Span metadata.
     * @param {string} args.phase - Phase name.
     * @param {string} [args.activity] - Custom activity label.
     * @param {number} [args.declarationIndex] - Hook declaration index.
     * @param {string} [args.declarationScopeId] - Hook declaration scope.
     * @param {string} [args.filePath] - Source or owning test file.
     * @param {() => (T | Promise<T>)} callback - Timed work.
     * @returns {Promise<T>} - Callback result.
     */
    runSpan<T>({ phase, activity, declarationIndex, declarationScopeId, filePath }: {
        phase: string;
        activity?: string;
        declarationIndex?: number;
        declarationScopeId?: string;
        filePath?: string;
    }, callback: () => (T | Promise<T>)): Promise<T>;
    /**
     * Finalizes an open span, including partial work closed by a timeout.
     * @param {TestProfileAsyncContext} context - Span context.
     * @returns {void}
     */
    finishSpanContext(context: TestProfileAsyncContext): void;
    /**
     * Checks both a nested span boundary and its owning attempt boundary.
     * @param {TestProfileAsyncContext} context - Candidate profile context.
     * @returns {boolean} - Whether events may still be attributed.
     */
    contextIsActive(context: TestProfileAsyncContext): boolean;
    /**
     * Runs a validated application-defined activity.
     * @template T
     * @param {TestProfileAsyncContext} context - Captured async context.
     * @param {string} name - Validated activity name.
     * @param {() => (T | Promise<T>)} callback - Activity callback.
     * @returns {Promise<T>} - Callback result.
     */
    profileActivity<T>(context: TestProfileAsyncContext, name: string, callback: () => (T | Promise<T>)): Promise<T>;
    /**
     * Measures a command-level phase outside an attempt.
     * @template T
     * @param {string} phase - Phase name.
     * @param {() => (T | Promise<T>)} callback - Timed work.
     * @param {{filePath?: string}} [metadata] - Optional source ownership.
     * @returns {Promise<T>} - Callback result.
     */
    measurePhase<T>(phase: string, callback: () => (T | Promise<T>), metadata?: {
        filePath?: string;
    }): Promise<T>;
    /**
     * Records one successful or failed physical database query attempt.
     * @param {TestProfileAsyncContext} context - Context captured when the query began.
     * @param {{durationMs: number, failed: boolean, sqlFingerprint: string, sqlOperation: string}} args - Query aggregate values.
     * @returns {void}
     */
    recordDatabaseQuery(context: TestProfileAsyncContext, { durationMs, failed, sqlFingerprint, sqlOperation }: {
        durationMs: number;
        failed: boolean;
        sqlFingerprint: string;
        sqlOperation: string;
    }): void;
    /**
     * Records a physical transaction action.
     * @param {TestProfileAsyncContext} context - Context captured when the action began.
     * @param {{action: "start" | "commit" | "rollback", durationMs: number, failed: boolean}} args - Transaction aggregate values.
     * @returns {void}
     */
    recordDatabaseTransaction(context: TestProfileAsyncContext, { action, durationMs, failed }: {
        action: "start" | "commit" | "rollback";
        durationMs: number;
        failed: boolean;
    }): void;
    /**
     * Records one low-cardinality pool lifecycle delta.
     * @param {TestProfileAsyncContext} context - Context captured when the operation began.
     * @param {string} identifier - Logical pool identifier.
     * @param {"connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections"} metric - Metric name.
     * @param {{durationMs?: number, failed?: boolean, value?: number}} [values] - Aggregate values.
     * @returns {void}
     */
    recordPoolMetric(context: TestProfileAsyncContext, identifier: string, metric: "connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections", values?: {
        durationMs?: number;
        failed?: boolean;
        value?: number;
    }): void;
    /**
     * Builds the final privacy-safe profile document.
     * @param {object} args - Run result.
     * @param {{discovered: number, executed: number, failed: number, passed: number}} args.counts - Run counts.
     * @param {boolean} args.focused - Whether focused tests were selected.
     * @param {string} args.status - Run status.
     * @returns {ReturnType<typeof JSON.parse>} - Rich profile document.
     */
    finish({ counts, focused, status }: {
        counts: {
            discovered: number;
            executed: number;
            failed: number;
            passed: number;
        };
        focused: boolean;
        status: string;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Returns an internal phase aggregate.
     * @param {string} phase - Phase name.
     * @returns {InternalPhaseAggregate} - Aggregate.
     */
    phaseAggregate(phase: string): InternalPhaseAggregate;
    /**
     * Adds a completed span to its aggregate phase.
     * @param {string} phase - Phase name.
     * @param {number} durationMs - Real duration.
     * @param {{user: number, system: number, total: number}} cpuMs - CPU duration.
     * @returns {void}
     */
    addPhaseDuration(phase: string, durationMs: number, cpuMs: {
        user: number;
        system: number;
        total: number;
    }): void;
    /**
     * Adds an exclusive file-owned phase to timing-manifest weight.
     * @param {string | undefined} filePath - Safe project-relative path.
     * @param {string} phase - Phase name.
     * @param {number} durationMs - Real duration.
     * @param {boolean} [insideAttempt] - Whether the phase is already covered by complete attempt time.
     * @returns {void}
     */
    addFileDuration(filePath: string | undefined, phase: string, durationMs: number, insideAttempt?: boolean): void;
    /**
     * Adds the complete cost of an attempt to its owning file weight.
     * @param {string | undefined} filePath - Safe project-relative path.
     * @param {number} durationMs - Attempt duration.
     * @returns {void}
     */
    addFileAttemptDuration(filePath: string | undefined, durationMs: number): void;
    /**
     * Calculates process CPU time since a start sample.
     * @param {ProcessCpuUsage} start - CPU start sample.
     * @returns {{user: number, system: number, total: number}} - Millisecond CPU duration.
     */
    cpuDuration(start: ProcessCpuUsage): {
        user: number;
        system: number;
        total: number;
    };
    /**
     * Converts an internal aggregate to public rounded values.
     * @param {InternalPhaseAggregate} [aggregate] - Internal aggregate.
     * @returns {{count: number, totalMs: number, maxMs: number, cpuMs: {user: number, system: number, total: number}}} - Public aggregate.
     */
    publicAggregate(aggregate?: InternalPhaseAggregate): {
        count: number;
        totalMs: number;
        maxMs: number;
        cpuMs: {
            user: number;
            system: number;
            total: number;
        };
    };
    /**
     * Returns an empty query aggregate.
     * @returns {ProfileDatabaseAggregate} - Empty aggregate.
     */
    emptyDatabaseAggregate(): ProfileDatabaseAggregate;
    /**
     * Adds a query attempt to a database aggregate.
     * @param {ProfileDatabaseAggregate} aggregate - Aggregate to update.
     * @param {{durationMs: number, failed: boolean}} args - Attempt values.
     * @returns {void}
     */
    addDatabaseQueryAggregate(aggregate: ProfileDatabaseAggregate, { durationMs, failed }: {
        durationMs: number;
        failed: boolean;
    }): void;
    /**
     * Returns an empty action aggregate.
     * @returns {ProfileActionAggregate} - Empty aggregate.
     */
    phaseAggregateShape(): ProfileActionAggregate;
    /**
     * Rounds a transaction or pool action aggregate.
     * @param {ProfileActionAggregate} aggregate - Internal aggregate.
     * @returns {ProfileActionAggregate} - Public aggregate.
     */
    publicActionAggregate(aggregate: ProfileActionAggregate): ProfileActionAggregate;
    /**
     * Returns an empty pool aggregate.
     * @param {string} [identifier] - Logical pool identifier.
     * @returns {ProfilePoolAggregate} - Empty aggregate.
     */
    emptyPoolAggregate(identifier?: string): ProfilePoolAggregate;
    /**
     * Gets or creates a pool aggregate in a map.
     * @param {Map<string, ProfilePoolAggregate>} pools - Pool map.
     * @param {string} identifier - Logical pool identifier.
     * @returns {ProfilePoolAggregate} - Pool aggregate.
     */
    poolAggregate(pools: Map<string, ProfilePoolAggregate>, identifier: string): ProfilePoolAggregate;
    /**
     * Applies one pool metric delta.
     * @param {ProfilePoolAggregate} aggregate - Pool aggregate.
     * @param {"connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections"} metric - Metric name.
     * @param {{durationMs?: number, failed?: boolean, value?: number}} values - Metric values.
     * @returns {void}
     */
    addPoolMetric(aggregate: ProfilePoolAggregate, metric: "connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections", values: {
        durationMs?: number;
        failed?: boolean;
        value?: number;
    }): void;
    /**
     * Rounds a pool aggregate for output.
     * @param {ProfilePoolAggregate} aggregate - Internal aggregate.
     * @returns {ProfilePoolAggregate} - Public aggregate.
     */
    publicPoolAggregate(aggregate: ProfilePoolAggregate): ProfilePoolAggregate;
}
//# sourceMappingURL=test-profiler.d.ts.map
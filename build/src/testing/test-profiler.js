// @ts-check
import { createHash } from "node:crypto";
import path from "node:path";
import { registerTestProfileContextReader } from "./test-profile-context.js";
import { validateTestActivityName } from "./test-profile-activity.js";
import { compareTimingManifestPaths } from "./timing-manifest.js";
/** @typedef {"passed" | "failed" | "interrupted" | "timed-out"} TestProfileAttemptStatus */
/** @typedef {{user: number, system: number}} ProcessCpuUsage */
/** @typedef {{queryCount: number, failedQueryCount: number, totalMs: number, maxMs: number}} ProfileDatabaseAggregate */
/** @typedef {{count: number, failedCount: number, totalMs: number, maxMs: number}} ProfileActionAggregate */
/** @typedef {{identifier: string, connectionCreation: ProfileActionAggregate, checkoutWait: {count: number, totalMs: number, maxMs: number}, checkoutTimeoutCount: number, idleReap: ProfileActionAggregate & {disposalCount: number}, peakLiveConnections: number}} ProfilePoolAggregate */
/**
 * @typedef {object} TestProfileAsyncContext
 * @property {TestProfiler} profiler - Owning profiler.
 * @property {TestProfileAttemptRecord | undefined} attempt - Active test attempt.
 * @property {boolean} active - Whether attribution is still open.
 * @property {Set<TestProfileAsyncContext> | undefined} [attemptContexts] - Contexts sharing one attempt lifetime.
 * @property {string | undefined} filePath - Project-relative owning test file.
 * @property {TestProfileSpan | undefined} [span] - Innermost active profile span.
 * @property {number} [spanStartedAt] - Span monotonic start time.
 * @property {ProcessCpuUsage} [spanCpuStartedAt] - Span CPU start time.
 */
/**
 * @typedef {object} TestProfileSpan
 * @property {string} phase - Profile phase.
 * @property {number} executionOrder - Monotonic span start order.
 * @property {number} durationMs - Real duration.
 * @property {{user: number, system: number, total: number}} cpuMs - Process CPU duration.
 * @property {string} [activity] - Validated custom activity name.
 * @property {number} [declarationIndex] - Hook index within its declaration scope.
 * @property {string} [declarationScopeId] - Opaque declaration scope identifier.
 * @property {string} [file] - Project-relative source path.
 * @property {ProfileDatabaseAggregate} [database] - Span database aggregate.
 * @property {ProfilePoolAggregate[]} [pools] - Span pool aggregates.
 */
/**
 * @typedef {object} TestProfileAttemptRecord
 * @property {number} number - One-indexed attempt number.
 * @property {TestProfileAttemptStatus | "running"} status - Attempt result.
 * @property {number} durationMs - Real duration.
 * @property {{user: number, system: number, total: number}} cpuMs - Process CPU duration.
 * @property {TestProfileSpan[]} spans - Attempt-owned spans.
 */
/**
 * @typedef {object} TestProfileAttemptHandle
 * @property {TestProfileAsyncContext} context - Async attribution context.
 * @property {TestProfileAttemptRecord} attempt - Output attempt record.
 * @property {number} startedAt - Real start time.
 * @property {ProcessCpuUsage} cpuStartedAt - CPU start time.
 */
/**
 * @typedef {object} InternalPhaseAggregate
 * @property {number} count - Invocation count.
 * @property {number} totalMs - Total real duration.
 * @property {number} maxMs - Maximum real duration.
 * @property {number} cpuUserMs - Total user CPU time.
 * @property {number} cpuSystemMs - Total system CPU time.
 */
/**
 * @typedef {object} InternalFileAggregate
 * @property {string} path - Project-relative path.
 * @property {number} importMs - Import duration.
 * @property {number} hooksMs - Hook duration.
 * @property {number} testsMs - Test body duration.
 * @property {number} attemptsMs - Complete test-attempt duration.
 * @property {number} totalMs - Total file weight duration.
 */
/**
 * @typedef {object} InternalTestRecord
 * @property {string} id - Opaque stable test identifier.
 * @property {string} file - Project-relative source path.
 * @property {number | undefined} line - Declaration line.
 * @property {TestProfileAttemptRecord[]} attempts - Attempt records.
 */
const BUILT_IN_PHASES = [
    "discovery",
    "imports",
    "testing config/global setup",
    "beforeAll",
    "beforeEach",
    "test body",
    "afterEach",
    "afterAll"
];
const MAX_CUSTOM_ACTIVITY_NAMES = 20;
const SAFE_SQL_OPERATIONS = new Set([
    "ALTER",
    "ANALYZE",
    "BEGIN",
    "CALL",
    "COMMIT",
    "COPY",
    "CREATE",
    "DELETE",
    "DESCRIBE",
    "DROP",
    "EXEC",
    "EXECUTE",
    "EXPLAIN",
    "GRANT",
    "INSERT",
    "MERGE",
    "PRAGMA",
    "RELEASE",
    "REPLACE",
    "REVOKE",
    "ROLLBACK",
    "SAVEPOINT",
    "SELECT",
    "SET",
    "SHOW",
    "TRUNCATE",
    "UPDATE",
    "VACUUM",
    "VALUES",
    "WITH"
]);
/**
 * Rounds and bounds duration values for public output.
 * @param {number} durationMs - Raw duration.
 * @returns {number} - Safe duration.
 */
export function roundProfileDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0)
        return 0;
    return Math.round(durationMs * 1000) / 1000;
}
/**
 * Collects opt-in test-run timing without retaining application payloads.
 */
export default class TestProfiler {
    /**
     * Creates an opt-in test profile collector.
     * @param {object} args - Profiler options.
     * @param {import("../configuration.js").default} args.configuration - Test configuration.
     * @param {string} args.projectDirectory - Project root used for portable paths.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.selection] - Sanitized selection metadata.
     */
    constructor({ configuration, projectDirectory, selection = {} }) {
        this._configuration = configuration;
        this._projectDirectory = path.resolve(projectDirectory);
        this._selection = selection;
        this._startedAt = this.now();
        this._cpuStartedAt = process.cpuUsage();
        this._executionOrder = 0;
        this._unattributedLateEventCount = 0;
        /** @type {Map<string, InternalPhaseAggregate>} */
        this._phases = new Map();
        /** @type {Map<string, InternalFileAggregate>} */
        this._files = new Map();
        /** @type {InternalTestRecord[]} */
        this._tests = [];
        /** @type {Map<string, InternalTestRecord>} */
        this._testsById = new Map();
        /** @type {Set<TestProfileAttemptHandle>} */
        this._activeAttempts = new Set();
        /** @type {Set<TestProfileAsyncContext>} */
        this._activeSpanContexts = new Set();
        /** @type {TestProfileSpan[]} */
        this._spans = [];
        /** @type {Array<{id: string, parentId: string | undefined, file: string, line: number | undefined}>} */
        this._scopes = [];
        /** @type {WeakMap<import("./test-runner.js").TestsArgument, string>} */
        this._scopeIds = new WeakMap();
        /** @type {Set<string>} */
        this._customActivityNames = new Set();
        this._database = this.emptyDatabaseAggregate();
        /** @type {Map<string, {hash: string, operation: string, count: number, failedCount: number, totalMs: number, maxMs: number}>} */
        this._queryFingerprints = new Map();
        this._transactions = {
            start: this.phaseAggregateShape(),
            commit: this.phaseAggregateShape(),
            rollback: this.phaseAggregateShape()
        };
        /** @type {Map<string, ProfilePoolAggregate>} */
        this._pools = new Map();
        this._finishedProfile = undefined;
        registerTestProfileContextReader(configuration, () => {
            return configuration.getEnvironmentHandler().getCurrentTestProfileContext();
        });
        for (const phase of BUILT_IN_PHASES)
            this.phaseAggregate(phase);
    }
    /**
     * Returns the profiler's monotonic clock.
     * @returns {number} - Monotonic milliseconds.
     */
    now() {
        return globalThis.performance.now();
    }
    /**
     * Converts a source path to a project-relative path or an opaque hash.
     * @param {string | undefined} filePath - Source path.
     * @returns {string} - Safe source identifier.
     */
    safeSourcePath(filePath) {
        if (!filePath)
            return "sha256:unknown";
        const absolutePath = path.resolve(filePath);
        const relativePath = path.relative(this._projectDirectory, absolutePath);
        if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
            return relativePath.replaceAll(path.sep, "/");
        }
        if (!relativePath)
            return path.basename(absolutePath);
        return this.hash(`external-source:${absolutePath}`);
    }
    /**
     * Returns a bounded opaque SHA-256 identifier.
     * @param {string} value - Value to hash.
     * @returns {string} - Opaque hash.
     */
    hash(value) {
        return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
    }
    /**
     * Adds aggregate-only selection metadata as discovery progresses.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} selection - Safe selection metadata.
     * @returns {void}
     */
    setSelection(selection) {
        Object.assign(this._selection, selection);
    }
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
    scopeId(scope, { descriptions, filePath, line, parentId }) {
        const existing = this._scopeIds.get(scope);
        if (existing)
            return existing;
        const safeFilePath = this.safeSourcePath(filePath);
        const id = this.hash(`scope:${safeFilePath}:${line ?? 0}:${descriptions.join("\u0000")}`);
        this._scopeIds.set(scope, id);
        this._scopes.push({ id, parentId, file: safeFilePath, line });
        return id;
    }
    /**
     * Starts an attempt and its async attribution context.
     * @param {object} args - Attempt metadata.
     * @param {string[]} args.descriptions - Parent descriptions.
     * @param {number} args.attemptNumber - Attempt number.
     * @param {import("./test-runner.js").TestData} args.testData - Test declaration.
     * @param {string} args.testDescription - Test description.
     * @returns {TestProfileAttemptHandle} - Active attempt handle.
     */
    startAttempt({ descriptions, attemptNumber, testData, testDescription }) {
        const file = this.safeSourcePath(testData.ownerFilePath ?? testData.filePath);
        const id = this.hash(`test:${file}:${testData.line ?? 0}:${[...descriptions, testDescription].join("\u0000")}`);
        let testRecord = this._testsById.get(id);
        if (!testRecord) {
            testRecord = { id, file, line: testData.line, attempts: [] };
            this._testsById.set(id, testRecord);
            this._tests.push(testRecord);
        }
        /** @type {TestProfileAttemptRecord} */
        const attempt = {
            number: attemptNumber,
            status: "running",
            durationMs: 0,
            cpuMs: { user: 0, system: 0, total: 0 },
            spans: []
        };
        /** @type {Set<TestProfileAsyncContext>} */
        const attemptContexts = new Set();
        const context = { profiler: this, attempt, active: true, attemptContexts, filePath: file, span: undefined };
        attemptContexts.add(context);
        const handle = { context, attempt, startedAt: this.now(), cpuStartedAt: process.cpuUsage() };
        testRecord.attempts.push(attempt);
        this._activeAttempts.add(handle);
        return handle;
    }
    /**
     * Runs work inside an attempt's async context.
     * @template T
     * @param {TestProfileAttemptHandle} handle - Attempt handle.
     * @param {() => Promise<T>} callback - Attempt lifecycle.
     * @returns {Promise<T>} - Callback result.
     */
    async runAttempt(handle, callback) {
        return await this._configuration
            .getEnvironmentHandler()
            .runWithTestProfileContext(handle.context, callback);
    }
    /**
     * Completes an attempt and prevents descendant late work from retaining attribution.
     * @param {TestProfileAttemptHandle} handle - Attempt handle.
     * @param {TestProfileAttemptStatus} status - Attempt result.
     * @returns {void}
     */
    finishAttempt(handle, status) {
        if (handle.attempt.status !== "running")
            return;
        for (const context of handle.context.attemptContexts || []) {
            if (context.span)
                this.finishSpanContext(context);
            context.active = false;
        }
        handle.attempt.status = status;
        handle.attempt.durationMs = roundProfileDuration(this.now() - handle.startedAt);
        handle.attempt.cpuMs = this.cpuDuration(handle.cpuStartedAt);
        this.addFileAttemptDuration(handle.context.filePath, handle.attempt.durationMs);
        this._activeAttempts.delete(handle);
    }
    /**
     * Closes every active attempt and nested span at the current interruption boundary.
     * @returns {void}
     */
    interrupt() {
        for (const handle of [...this._activeAttempts]) {
            this.finishAttempt(handle, "interrupted");
        }
        for (const context of [...this._activeSpanContexts]) {
            this.finishSpanContext(context);
        }
    }
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
    async runSpan({ phase, activity, declarationIndex, declarationScopeId, filePath }, callback) {
        const currentContext = this._configuration.getEnvironmentHandler().getCurrentTestProfileContext();
        if (currentContext && !this.contextIsActive(currentContext)) {
            this._unattributedLateEventCount++;
            return await callback();
        }
        const safeFilePath = currentContext?.filePath ?? (filePath ? this.safeSourcePath(filePath) : undefined);
        const startedAt = this.now();
        const cpuStartedAt = process.cpuUsage();
        /** @type {TestProfileSpan} */
        const span = {
            phase,
            executionOrder: ++this._executionOrder,
            durationMs: 0,
            cpuMs: { user: 0, system: 0, total: 0 }
        };
        if (activity)
            span.activity = activity;
        if (declarationIndex !== undefined)
            span.declarationIndex = declarationIndex;
        if (declarationScopeId)
            span.declarationScopeId = declarationScopeId;
        if (safeFilePath)
            span.file = safeFilePath;
        if (currentContext?.attempt) {
            currentContext.attempt.spans.push(span);
        }
        else {
            this._spans.push(span);
        }
        const spanContext = {
            profiler: this,
            attempt: currentContext?.attempt,
            active: true,
            attemptContexts: currentContext?.attemptContexts,
            filePath: safeFilePath,
            span,
            spanStartedAt: startedAt,
            spanCpuStartedAt: cpuStartedAt
        };
        spanContext.attemptContexts?.add(spanContext);
        this._activeSpanContexts.add(spanContext);
        try {
            return await this._configuration
                .getEnvironmentHandler()
                .runWithTestProfileContext(spanContext, callback);
        }
        finally {
            if (spanContext.active) {
                this.finishSpanContext(spanContext);
            }
            else if (spanContext.attempt) {
                this._unattributedLateEventCount++;
            }
        }
    }
    /**
     * Finalizes an open span, including partial work closed by a timeout.
     * @param {TestProfileAsyncContext} context - Span context.
     * @returns {void}
     */
    finishSpanContext(context) {
        if (!context.active || !context.span || context.spanStartedAt === undefined || !context.spanCpuStartedAt)
            return;
        context.active = false;
        context.span.durationMs = roundProfileDuration(this.now() - context.spanStartedAt);
        context.span.cpuMs = this.cpuDuration(context.spanCpuStartedAt);
        this.addPhaseDuration(context.span.phase, context.span.durationMs, context.span.cpuMs);
        this.addFileDuration(context.filePath, context.span.phase, context.span.durationMs, Boolean(context.attempt));
        this._activeSpanContexts.delete(context);
    }
    /**
     * Checks both a nested span boundary and its owning attempt boundary.
     * @param {TestProfileAsyncContext} context - Candidate profile context.
     * @returns {boolean} - Whether events may still be attributed.
     */
    contextIsActive(context) {
        return context.active && (!context.attempt || context.attempt.status === "running");
    }
    /**
     * Runs a validated application-defined activity.
     * @template T
     * @param {TestProfileAsyncContext} context - Captured async context.
     * @param {string} name - Validated activity name.
     * @param {() => (T | Promise<T>)} callback - Activity callback.
     * @returns {Promise<T>} - Callback result.
     */
    async profileActivity(context, name, callback) {
        if (!this.contextIsActive(context)) {
            this._unattributedLateEventCount++;
            return await callback();
        }
        const validatedName = validateTestActivityName(name);
        let outputName = validatedName;
        if (!this._customActivityNames.has(validatedName)) {
            if (this._customActivityNames.size >= MAX_CUSTOM_ACTIVITY_NAMES) {
                outputName = "other";
            }
            else {
                this._customActivityNames.add(validatedName);
            }
        }
        return await this.runSpan({ phase: "custom", activity: outputName }, callback);
    }
    /**
     * Measures a command-level phase outside an attempt.
     * @template T
     * @param {string} phase - Phase name.
     * @param {() => (T | Promise<T>)} callback - Timed work.
     * @param {{filePath?: string}} [metadata] - Optional source ownership.
     * @returns {Promise<T>} - Callback result.
     */
    async measurePhase(phase, callback, metadata = {}) {
        return await this.runSpan({ phase, filePath: metadata.filePath }, callback);
    }
    /**
     * Records one successful or failed physical database query attempt.
     * @param {TestProfileAsyncContext} context - Context captured when the query began.
     * @param {{durationMs: number, failed: boolean, sqlFingerprint: string, sqlOperation: string}} args - Query aggregate values.
     * @returns {void}
     */
    recordDatabaseQuery(context, { durationMs, failed, sqlFingerprint, sqlOperation }) {
        if (!this.contextIsActive(context)) {
            this._unattributedLateEventCount++;
            return;
        }
        const safeDurationMs = roundProfileDuration(durationMs);
        this.addDatabaseQueryAggregate(this._database, { durationMs: safeDurationMs, failed });
        if (context.span) {
            context.span.database ||= this.emptyDatabaseAggregate();
            this.addDatabaseQueryAggregate(context.span.database, { durationMs: safeDurationMs, failed });
        }
        const safeOperation = SAFE_SQL_OPERATIONS.has(sqlOperation) ? sqlOperation : "UNKNOWN";
        const fingerprintKey = `${safeOperation}:${sqlFingerprint}`;
        let fingerprint = this._queryFingerprints.get(fingerprintKey);
        if (!fingerprint && this._queryFingerprints.size < 50) {
            fingerprint = {
                hash: sqlFingerprint,
                operation: safeOperation,
                count: 0,
                failedCount: 0,
                totalMs: 0,
                maxMs: 0
            };
            this._queryFingerprints.set(fingerprintKey, fingerprint);
        }
        if (fingerprint) {
            fingerprint.count++;
            if (failed)
                fingerprint.failedCount++;
            fingerprint.totalMs += safeDurationMs;
            fingerprint.maxMs = Math.max(fingerprint.maxMs, safeDurationMs);
        }
    }
    /**
     * Records a physical transaction action.
     * @param {TestProfileAsyncContext} context - Context captured when the action began.
     * @param {{action: "start" | "commit" | "rollback", durationMs: number, failed: boolean}} args - Transaction aggregate values.
     * @returns {void}
     */
    recordDatabaseTransaction(context, { action, durationMs, failed }) {
        if (!this.contextIsActive(context)) {
            this._unattributedLateEventCount++;
            return;
        }
        const aggregate = this._transactions[action];
        const safeDurationMs = roundProfileDuration(durationMs);
        aggregate.count++;
        if (failed)
            aggregate.failedCount++;
        aggregate.totalMs += safeDurationMs;
        aggregate.maxMs = Math.max(aggregate.maxMs, safeDurationMs);
    }
    /**
     * Records one low-cardinality pool lifecycle delta.
     * @param {TestProfileAsyncContext} context - Context captured when the operation began.
     * @param {string} identifier - Logical pool identifier.
     * @param {"connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections"} metric - Metric name.
     * @param {{durationMs?: number, failed?: boolean, value?: number}} [values] - Aggregate values.
     * @returns {void}
     */
    recordPoolMetric(context, identifier, metric, values = {}) {
        if (!this.contextIsActive(context)) {
            this._unattributedLateEventCount++;
            return;
        }
        const aggregate = this.poolAggregate(this._pools, identifier);
        this.addPoolMetric(aggregate, metric, values);
        if (context.span) {
            context.span.pools ||= [];
            const spanPools = new Map(context.span.pools.map((pool) => [pool.identifier, pool]));
            const spanAggregate = this.poolAggregate(spanPools, identifier);
            if (!context.span.pools.includes(spanAggregate))
                context.span.pools.push(spanAggregate);
            this.addPoolMetric(spanAggregate, metric, values);
        }
    }
    /**
     * Builds the final privacy-safe profile document.
     * @param {object} args - Run result.
     * @param {{discovered: number, executed: number, failed: number, passed: number}} args.counts - Run counts.
     * @param {boolean} args.focused - Whether focused tests were selected.
     * @param {string} args.status - Run status.
     * @returns {ReturnType<typeof JSON.parse>} - Rich profile document.
     */
    finish({ counts, focused, status }) {
        if (this._finishedProfile)
            return this._finishedProfile;
        const totalDurationMs = roundProfileDuration(this.now() - this._startedAt);
        const totalCpuMs = this.cpuDuration(this._cpuStartedAt);
        const exclusivePhaseNames = BUILT_IN_PHASES;
        const measuredDurationMs = exclusivePhaseNames.reduce((sum, phase) => sum + this.phaseAggregate(phase).totalMs, 0);
        const measuredCpuUserMs = exclusivePhaseNames.reduce((sum, phase) => sum + this.phaseAggregate(phase).cpuUserMs, 0);
        const measuredCpuSystemMs = exclusivePhaseNames.reduce((sum, phase) => sum + this.phaseAggregate(phase).cpuSystemMs, 0);
        this._phases.set("runner overhead", {
            count: 1,
            totalMs: Math.max(0, totalDurationMs - measuredDurationMs),
            maxMs: Math.max(0, totalDurationMs - measuredDurationMs),
            cpuUserMs: Math.max(0, totalCpuMs.user - measuredCpuUserMs),
            cpuSystemMs: Math.max(0, totalCpuMs.system - measuredCpuSystemMs)
        });
        this._phases.set("total", {
            count: 1,
            totalMs: totalDurationMs,
            maxMs: totalDurationMs,
            cpuUserMs: totalCpuMs.user,
            cpuSystemMs: totalCpuMs.system
        });
        const phases = Object.fromEntries([...this._phases.entries()].map(([phase, aggregate]) => [
            phase,
            this.publicAggregate(aggregate)
        ]));
        const files = [...this._files.values()]
            .map((file) => ({
            path: file.path,
            importMs: roundProfileDuration(file.importMs),
            hooksMs: roundProfileDuration(file.hooksMs),
            testsMs: roundProfileDuration(file.testsMs),
            attemptsMs: roundProfileDuration(file.attemptsMs),
            totalMs: roundProfileDuration(file.totalMs)
        }))
            .sort((fileA, fileB) => compareTimingManifestPaths(fileA.path, fileB.path));
        const timingManifest = Object.fromEntries(files.map((file) => [file.path, file.totalMs]));
        const attempts = this._tests.reduce((sum, test) => sum + test.attempts.length, 0);
        this._finishedProfile = {
            schema: "velocious.test-profile",
            schemaVersion: 1,
            status,
            selection: { ...this._selection, focused },
            counts: { ...counts, attempts },
            durationMs: totalDurationMs,
            cpuMs: totalCpuMs,
            phases,
            files,
            scopes: [...this._scopes].sort((scopeA, scopeB) => scopeA.id.localeCompare(scopeB.id)),
            tests: this._tests.map((test) => ({
                id: test.id,
                file: test.file,
                line: test.line,
                durationMs: roundProfileDuration(test.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)),
                attempts: test.attempts
            })),
            spans: this._spans,
            database: {
                queryCount: this._database.queryCount,
                failedQueryCount: this._database.failedQueryCount,
                totalMs: roundProfileDuration(this._database.totalMs),
                maxMs: roundProfileDuration(this._database.maxMs),
                fingerprints: [...this._queryFingerprints.values()]
                    .map((fingerprint) => ({
                    ...fingerprint,
                    totalMs: roundProfileDuration(fingerprint.totalMs),
                    maxMs: roundProfileDuration(fingerprint.maxMs)
                }))
                    .sort((fingerprintA, fingerprintB) => {
                    return fingerprintA.operation.localeCompare(fingerprintB.operation) || fingerprintA.hash.localeCompare(fingerprintB.hash);
                }),
                transactions: {
                    start: this.publicActionAggregate(this._transactions.start),
                    commit: this.publicActionAggregate(this._transactions.commit),
                    rollback: this.publicActionAggregate(this._transactions.rollback)
                }
            },
            pools: [...this._pools.values()]
                .map((pool) => this.publicPoolAggregate(pool))
                .sort((poolA, poolB) => poolA.identifier.localeCompare(poolB.identifier)),
            unattributedLateEventCount: this._unattributedLateEventCount,
            timingManifest
        };
        return this._finishedProfile;
    }
    /**
     * Returns an internal phase aggregate.
     * @param {string} phase - Phase name.
     * @returns {InternalPhaseAggregate} - Aggregate.
     */
    phaseAggregate(phase) {
        let aggregate = this._phases.get(phase);
        if (!aggregate) {
            aggregate = { count: 0, totalMs: 0, maxMs: 0, cpuUserMs: 0, cpuSystemMs: 0 };
            this._phases.set(phase, aggregate);
        }
        return aggregate;
    }
    /**
     * Adds a completed span to its aggregate phase.
     * @param {string} phase - Phase name.
     * @param {number} durationMs - Real duration.
     * @param {{user: number, system: number, total: number}} cpuMs - CPU duration.
     * @returns {void}
     */
    addPhaseDuration(phase, durationMs, cpuMs) {
        const aggregate = this.phaseAggregate(phase);
        aggregate.count++;
        aggregate.totalMs += durationMs;
        aggregate.maxMs = Math.max(aggregate.maxMs, durationMs);
        aggregate.cpuUserMs += cpuMs.user;
        aggregate.cpuSystemMs += cpuMs.system;
    }
    /**
     * Adds an exclusive file-owned phase to timing-manifest weight.
     * @param {string | undefined} filePath - Safe project-relative path.
     * @param {string} phase - Phase name.
     * @param {number} durationMs - Real duration.
     * @param {boolean} [insideAttempt] - Whether the phase is already covered by complete attempt time.
     * @returns {void}
     */
    addFileDuration(filePath, phase, durationMs, insideAttempt = false) {
        if (!filePath)
            return;
        if (!["imports", "beforeAll", "beforeEach", "test body", "afterEach", "afterAll"].includes(phase))
            return;
        let file = this._files.get(filePath);
        if (!file) {
            file = { path: filePath, importMs: 0, hooksMs: 0, testsMs: 0, attemptsMs: 0, totalMs: 0 };
            this._files.set(filePath, file);
        }
        if (phase === "imports")
            file.importMs += durationMs;
        if (phase === "test body")
            file.testsMs += durationMs;
        if (["beforeAll", "beforeEach", "afterEach", "afterAll"].includes(phase))
            file.hooksMs += durationMs;
        if (!insideAttempt)
            file.totalMs += durationMs;
    }
    /**
     * Adds the complete cost of an attempt to its owning file weight.
     * @param {string | undefined} filePath - Safe project-relative path.
     * @param {number} durationMs - Attempt duration.
     * @returns {void}
     */
    addFileAttemptDuration(filePath, durationMs) {
        if (!filePath)
            return;
        let file = this._files.get(filePath);
        if (!file) {
            file = { path: filePath, importMs: 0, hooksMs: 0, testsMs: 0, attemptsMs: 0, totalMs: 0 };
            this._files.set(filePath, file);
        }
        file.attemptsMs += durationMs;
        file.totalMs += durationMs;
    }
    /**
     * Calculates process CPU time since a start sample.
     * @param {ProcessCpuUsage} start - CPU start sample.
     * @returns {{user: number, system: number, total: number}} - Millisecond CPU duration.
     */
    cpuDuration(start) {
        const cpu = process.cpuUsage(start);
        const user = roundProfileDuration(cpu.user / 1000);
        const system = roundProfileDuration(cpu.system / 1000);
        return { user, system, total: roundProfileDuration(user + system) };
    }
    /**
     * Converts an internal aggregate to public rounded values.
     * @param {InternalPhaseAggregate} [aggregate] - Internal aggregate.
     * @returns {{count: number, totalMs: number, maxMs: number, cpuMs: {user: number, system: number, total: number}}} - Public aggregate.
     */
    publicAggregate(aggregate = { count: 0, totalMs: 0, maxMs: 0, cpuUserMs: 0, cpuSystemMs: 0 }) {
        const user = roundProfileDuration(aggregate.cpuUserMs);
        const system = roundProfileDuration(aggregate.cpuSystemMs);
        return {
            count: aggregate.count,
            totalMs: roundProfileDuration(aggregate.totalMs),
            maxMs: roundProfileDuration(aggregate.maxMs),
            cpuMs: { user, system, total: roundProfileDuration(user + system) }
        };
    }
    /**
     * Returns an empty query aggregate.
     * @returns {ProfileDatabaseAggregate} - Empty aggregate.
     */
    emptyDatabaseAggregate() {
        return { queryCount: 0, failedQueryCount: 0, totalMs: 0, maxMs: 0 };
    }
    /**
     * Adds a query attempt to a database aggregate.
     * @param {ProfileDatabaseAggregate} aggregate - Aggregate to update.
     * @param {{durationMs: number, failed: boolean}} args - Attempt values.
     * @returns {void}
     */
    addDatabaseQueryAggregate(aggregate, { durationMs, failed }) {
        aggregate.queryCount++;
        if (failed)
            aggregate.failedQueryCount++;
        aggregate.totalMs += durationMs;
        aggregate.maxMs = Math.max(aggregate.maxMs, durationMs);
    }
    /**
     * Returns an empty action aggregate.
     * @returns {ProfileActionAggregate} - Empty aggregate.
     */
    phaseAggregateShape() {
        return { count: 0, failedCount: 0, totalMs: 0, maxMs: 0 };
    }
    /**
     * Rounds a transaction or pool action aggregate.
     * @param {ProfileActionAggregate} aggregate - Internal aggregate.
     * @returns {ProfileActionAggregate} - Public aggregate.
     */
    publicActionAggregate(aggregate) {
        return {
            count: aggregate.count,
            failedCount: aggregate.failedCount,
            totalMs: roundProfileDuration(aggregate.totalMs),
            maxMs: roundProfileDuration(aggregate.maxMs)
        };
    }
    /**
     * Returns an empty pool aggregate.
     * @param {string} [identifier] - Logical pool identifier.
     * @returns {ProfilePoolAggregate} - Empty aggregate.
     */
    emptyPoolAggregate(identifier = "") {
        return {
            identifier,
            connectionCreation: this.phaseAggregateShape(),
            checkoutWait: { count: 0, totalMs: 0, maxMs: 0 },
            checkoutTimeoutCount: 0,
            idleReap: { ...this.phaseAggregateShape(), disposalCount: 0 },
            peakLiveConnections: 0
        };
    }
    /**
     * Gets or creates a pool aggregate in a map.
     * @param {Map<string, ProfilePoolAggregate>} pools - Pool map.
     * @param {string} identifier - Logical pool identifier.
     * @returns {ProfilePoolAggregate} - Pool aggregate.
     */
    poolAggregate(pools, identifier) {
        let aggregate = pools.get(identifier);
        if (!aggregate) {
            aggregate = this.emptyPoolAggregate(identifier);
            pools.set(identifier, aggregate);
        }
        return aggregate;
    }
    /**
     * Applies one pool metric delta.
     * @param {ProfilePoolAggregate} aggregate - Pool aggregate.
     * @param {"connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections"} metric - Metric name.
     * @param {{durationMs?: number, failed?: boolean, value?: number}} values - Metric values.
     * @returns {void}
     */
    addPoolMetric(aggregate, metric, values) {
        const durationMs = roundProfileDuration(values.durationMs ?? 0);
        if (metric === "connectionCreation" || metric === "idleReap") {
            const actionAggregate = metric === "connectionCreation" ? aggregate.connectionCreation : aggregate.idleReap;
            actionAggregate.count++;
            if (values.failed)
                actionAggregate.failedCount++;
            actionAggregate.totalMs += durationMs;
            actionAggregate.maxMs = Math.max(actionAggregate.maxMs, durationMs);
        }
        else if (metric === "checkoutWait") {
            aggregate.checkoutWait.count++;
            aggregate.checkoutWait.totalMs += durationMs;
            aggregate.checkoutWait.maxMs = Math.max(aggregate.checkoutWait.maxMs, durationMs);
        }
        else if (metric === "checkoutTimeout") {
            aggregate.checkoutTimeoutCount++;
        }
        else if (metric === "idleReapDisposal") {
            aggregate.idleReap.disposalCount++;
        }
        else if (metric === "peakLiveConnections") {
            aggregate.peakLiveConnections = Math.max(aggregate.peakLiveConnections, values.value ?? 0);
        }
    }
    /**
     * Rounds a pool aggregate for output.
     * @param {ProfilePoolAggregate} aggregate - Internal aggregate.
     * @returns {ProfilePoolAggregate} - Public aggregate.
     */
    publicPoolAggregate(aggregate) {
        return {
            identifier: aggregate.identifier,
            connectionCreation: this.publicActionAggregate(aggregate.connectionCreation),
            checkoutWait: {
                count: aggregate.checkoutWait.count,
                totalMs: roundProfileDuration(aggregate.checkoutWait.totalMs),
                maxMs: roundProfileDuration(aggregate.checkoutWait.maxMs)
            },
            checkoutTimeoutCount: aggregate.checkoutTimeoutCount,
            idleReap: {
                ...this.publicActionAggregate(aggregate.idleReap),
                disposalCount: aggregate.idleReap.disposalCount
            },
            peakLiveConnections: aggregate.peakLiveConnections
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1wcm9maWxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDeEMsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8sRUFBRSxnQ0FBZ0MsRUFBRSxNQUFNLDJCQUEyQixDQUFBO0FBQzVFLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxNQUFNLDRCQUE0QixDQUFBO0FBQ3JFLE9BQU8sRUFBRSwwQkFBMEIsRUFBRSxNQUFNLHNCQUFzQixDQUFBO0FBRWpFLDRGQUE0RjtBQUM1RixnRUFBZ0U7QUFDaEUseUhBQXlIO0FBQ3pILDZHQUE2RztBQUM3Ryw2UkFBNlI7QUFFN1I7Ozs7Ozs7Ozs7R0FVRztBQUVIOzs7Ozs7Ozs7Ozs7R0FZRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7Ozs7O0dBUUc7QUFFSDs7Ozs7O0dBTUc7QUFFSCxNQUFNLGVBQWUsR0FBRztJQUN0QixXQUFXO0lBQ1gsU0FBUztJQUNULDZCQUE2QjtJQUM3QixXQUFXO0lBQ1gsWUFBWTtJQUNaLFdBQVc7SUFDWCxXQUFXO0lBQ1gsVUFBVTtDQUNYLENBQUE7QUFDRCxNQUFNLHlCQUF5QixHQUFHLEVBQUUsQ0FBQTtBQUNwQyxNQUFNLG1CQUFtQixHQUFHLElBQUksR0FBRyxDQUFDO0lBQ2xDLE9BQU87SUFDUCxTQUFTO0lBQ1QsT0FBTztJQUNQLE1BQU07SUFDTixRQUFRO0lBQ1IsTUFBTTtJQUNOLFFBQVE7SUFDUixRQUFRO0lBQ1IsVUFBVTtJQUNWLE1BQU07SUFDTixNQUFNO0lBQ04sU0FBUztJQUNULFNBQVM7SUFDVCxPQUFPO0lBQ1AsUUFBUTtJQUNSLE9BQU87SUFDUCxRQUFRO0lBQ1IsU0FBUztJQUNU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cUJBQXFCLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDO1lBQzVFLFlBQVksRUFBRTtnQkFDWixLQUFLLEVBQUUsU0FBUyxDQUFDLFlBQVksQ0FBQyxLQUFLO2dCQUNuQyxPQUFPLEVBQUUsb0JBQW9CLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUM7Z0JBQzdELEtBQUssRUFBRSxvQkFBb0IsQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQzthQUMxRDtZQUNELG9CQUFvQixFQUFFLFNBQVMsQ0FBQyxvQkFBb0I7WUFDcEQsUUFBUSxFQUFFO2dCQUNSLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUM7Z0JBQ2pELGFBQWEsRUFBRSxTQUFTLENBQUMsUUFBUSxDQUFDLGFBQWE7YUFDaEQ7WUFDRCxtQkFBbUIsRUFBRSxTQUFTLENBQUMsbUJBQW1CO1NBQ25ELENBQUE7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCJcbmltcG9ydCB7IHJlZ2lzdGVyVGVzdFByb2ZpbGVDb250ZXh0UmVhZGVyIH0gZnJvbSBcIi4vdGVzdC1wcm9maWxlLWNvbnRleHQuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVUZXN0QWN0aXZpdHlOYW1lIH0gZnJvbSBcIi4vdGVzdC1wcm9maWxlLWFjdGl2aXR5LmpzXCJcbmltcG9ydCB7IGNvbXBhcmVUaW1pbmdNYW5pZmVzdFBhdGhzIH0gZnJvbSBcIi4vdGltaW5nLW1hbmlmZXN0LmpzXCJcblxuLyoqIEB0eXBlZGVmIHtcInBhc3NlZFwiIHwgXCJmYWlsZWRcIiB8IFwiaW50ZXJydXB0ZWRcIiB8IFwidGltZWQtb3V0XCJ9IFRlc3RQcm9maWxlQXR0ZW1wdFN0YXR1cyAqL1xuLyoqIEB0eXBlZGVmIHt7dXNlcjogbnVtYmVyLCBzeXN0ZW06IG51bWJlcn19IFByb2Nlc3NDcHVVc2FnZSAqL1xuLyoqIEB0eXBlZGVmIHt7cXVlcnlDb3VudDogbnVtYmVyLCBmYWlsZWRRdWVyeUNvdW50OiBudW1iZXIsIHRvdGFsTXM6IG51bWJlciwgbWF4TXM6IG51bWJlcn19IFByb2ZpbGVEYXRhYmFzZUFnZ3JlZ2F0ZSAqL1xuLyoqIEB0eXBlZGVmIHt7Y291bnQ6IG51bWJlciwgZmFpbGVkQ291bnQ6IG51bWJlciwgdG90YWxNczogbnVtYmVyLCBtYXhNczogbnVtYmVyfX0gUHJvZmlsZUFjdGlvbkFnZ3JlZ2F0ZSAqL1xuLyoqIEB0eXBlZGVmIHt7aWRlbnRpZmllcjogc3RyaW5nLCBjb25uZWN0aW9uQ3JlYXRpb246IFByb2ZpbGVBY3Rpb25BZ2dyZWdhdGUsIGNoZWNrb3V0V2FpdDoge2NvdW50OiBudW1iZXIsIHRvdGFsTXM6IG51bWJlciwgbWF4TXM6IG51bWJlcn0sIGNoZWNrb3V0VGltZW91dENvdW50OiBudW1iZXIsIGlkbGVSZWFwOiBQcm9maWxlQWN0aW9uQWdncmVnYXRlICYge2Rpc3Bvc2FsQ291bnQ6IG51bWJlcn0sIHBlYWtMaXZlQ29ubmVjdGlvbnM6IG51bWJlcn19IFByb2ZpbGVQb29sQWdncmVnYXRlICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdFByb2ZpbGVBc3luY0NvbnRleHRcbiAqIEBwcm9wZXJ0eSB7VGVzdFByb2ZpbGVyfSBwcm9maWxlciAtIE93bmluZyBwcm9maWxlci5cbiAqIEBwcm9wZXJ0eSB7VGVzdFByb2ZpbGVBdHRlbXB0UmVjb3JkIHwgdW5kZWZpbmVkfSBhdHRlbXB0IC0gQWN0aXZlIHRlc3QgYXR0ZW1wdC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gYWN0aXZlIC0gV2hldGhlciBhdHRyaWJ1dGlvbiBpcyBzdGlsbCBvcGVuLlxuICogQHByb3BlcnR5IHtTZXQ8VGVzdFByb2ZpbGVBc3luY0NvbnRleHQ+IHwgdW5kZWZpbmVkfSBbYXR0ZW1wdENvbnRleHRzXSAtIENvbnRleHRzIHNoYXJpbmcgb25lIGF0dGVtcHQgbGlmZXRpbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gZmlsZVBhdGggLSBQcm9qZWN0LXJlbGF0aXZlIG93bmluZyB0ZXN0IGZpbGUuXG4gKiBAcHJvcGVydHkge1Rlc3RQcm9maWxlU3BhbiB8IHVuZGVmaW5lZH0gW3NwYW5dIC0gSW5uZXJtb3N0IGFjdGl2ZSBwcm9maWxlIHNwYW4uXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3NwYW5TdGFydGVkQXRdIC0gU3BhbiBtb25vdG9uaWMgc3RhcnQgdGltZS5cbiAqIEBwcm9wZXJ0eSB7UHJvY2Vzc0NwdVVzYWdlfSBbc3BhbkNwdVN0YXJ0ZWRBdF0gLSBTcGFuIENQVSBzdGFydCB0aW1lLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdFByb2ZpbGVTcGFuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcGhhc2UgLSBQcm9maWxlIHBoYXNlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGV4ZWN1dGlvbk9yZGVyIC0gTW9ub3RvbmljIHNwYW4gc3RhcnQgb3JkZXIuXG4gKiBAcHJvcGVydHkge251bWJlcn0gZHVyYXRpb25NcyAtIFJlYWwgZHVyYXRpb24uXG4gKiBAcHJvcGVydHkge3t1c2VyOiBudW1iZXIsIHN5c3RlbTogbnVtYmVyLCB0b3RhbDogbnVtYmVyfX0gY3B1TXMgLSBQcm9jZXNzIENQVSBkdXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbYWN0aXZpdHldIC0gVmFsaWRhdGVkIGN1c3RvbSBhY3Rpdml0eSBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBkZWNsYXJhdGlvbiBzY29wZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlXSAtIFByb2plY3QtcmVsYXRpdmUgc291cmNlIHBhdGguXG4gKiBAcHJvcGVydHkge1Byb2ZpbGVEYXRhYmFzZUFnZ3JlZ2F0ZX0gW2RhdGFiYXNlXSAtIFNwYW4gZGF0YWJhc2UgYWdncmVnYXRlLlxuICogQHByb3BlcnR5IHtQcm9maWxlUG9vbEFnZ3JlZ2F0ZVtdfSBbcG9vbHNdIC0gU3BhbiBwb29sIGFnZ3JlZ2F0ZXMuXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0UHJvZmlsZUF0dGVtcHRSZWNvcmRcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBudW1iZXIgLSBPbmUtaW5kZXhlZCBhdHRlbXB0IG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7VGVzdFByb2ZpbGVBdHRlbXB0U3RhdHVzIHwgXCJydW5uaW5nXCJ9IHN0YXR1cyAtIEF0dGVtcHQgcmVzdWx0LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGR1cmF0aW9uTXMgLSBSZWFsIGR1cmF0aW9uLlxuICogQHByb3BlcnR5IHt7dXNlcjogbnVtYmVyLCBzeXN0ZW06IG51bWJlciwgdG90YWw6IG51bWJlcn19IGNwdU1zIC0gUHJvY2VzcyBDUFUgZHVyYXRpb24uXG4gKiBAcHJvcGVydHkge1Rlc3RQcm9maWxlU3BhbltdfSBzcGFucyAtIEF0dGVtcHQtb3duZWQgc3BhbnMuXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0UHJvZmlsZUF0dGVtcHRIYW5kbGVcbiAqIEBwcm9wZXJ0eSB7VGVzdFByb2ZpbGVBc3luY0NvbnRleHR9IGNvbnRleHQgLSBBc3luYyBhdHRyaWJ1dGlvbiBjb250ZXh0LlxuICogQHByb3BlcnR5IHtUZXN0UHJvZmlsZUF0dGVtcHRSZWNvcmR9IGF0dGVtcHQgLSBPdXRwdXQgYXR0ZW1wdCByZWNvcmQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0IC0gUmVhbCBzdGFydCB0aW1lLlxuICogQHByb3BlcnR5IHtQcm9jZXNzQ3B1VXNhZ2V9IGNwdVN0YXJ0ZWRBdCAtIENQVSBzdGFydCB0aW1lLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gSW50ZXJuYWxQaGFzZUFnZ3JlZ2F0ZVxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNvdW50IC0gSW52b2NhdGlvbiBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB0b3RhbE1zIC0gVG90YWwgcmVhbCBkdXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhNcyAtIE1heGltdW0gcmVhbCBkdXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcHVVc2VyTXMgLSBUb3RhbCB1c2VyIENQVSB0aW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNwdVN5c3RlbU1zIC0gVG90YWwgc3lzdGVtIENQVSB0aW1lLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gSW50ZXJuYWxGaWxlQWdncmVnYXRlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcGF0aCAtIFByb2plY3QtcmVsYXRpdmUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBpbXBvcnRNcyAtIEltcG9ydCBkdXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBob29rc01zIC0gSG9vayBkdXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB0ZXN0c01zIC0gVGVzdCBib2R5IGR1cmF0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGF0dGVtcHRzTXMgLSBDb21wbGV0ZSB0ZXN0LWF0dGVtcHQgZHVyYXRpb24uXG4gKiBAcHJvcGVydHkge251bWJlcn0gdG90YWxNcyAtIFRvdGFsIGZpbGUgd2VpZ2h0IGR1cmF0aW9uLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gSW50ZXJuYWxUZXN0UmVjb3JkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWQgLSBPcGFxdWUgc3RhYmxlIHRlc3QgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmaWxlIC0gUHJvamVjdC1yZWxhdGl2ZSBzb3VyY2UgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBsaW5lIC0gRGVjbGFyYXRpb24gbGluZS5cbiAqIEBwcm9wZXJ0eSB7VGVzdFByb2ZpbGVBdHRlbXB0UmVjb3JkW119IGF0dGVtcHRzIC0gQXR0ZW1wdCByZWNvcmRzLlxuICovXG5cbmNvbnN0IEJVSUxUX0lOX1BIQVNFUyA9IFtcbiAgXCJkaXNjb3ZlcnlcIixcbiAgXCJpbXBvcnRzXCIsXG4gIFwidGVzdGluZyBjb25maWcvZ2xvYmFsIHNldHVwXCIsXG4gIFwiYmVmb3JlQWxsXCIsXG4gIFwiYmVmb3JlRWFjaFwiLFxuICBcInRlc3QgYm9keVwiLFxuICBcImFmdGVyRWFjaFwiLFxuICBcImFmdGVyQWxsXCJcbl1cbmNvbnN0IE1BWF9DVVNUT01fQUNUSVZJVFlfTkFNRVMgPSAyMFxuY29uc3QgU0FGRV9TUUxfT1BFUkFUSU9OUyA9IG5ldyBTZXQoW1xuICBcIkFMVEVSXCIsXG4gIFwiQU5BTFlaRVwiLFxuICBcIkJFR0lOXCIsXG4gIFwiQ0FMTFwiLFxuICBcIkNPTU1JVFwiLFxuICBcIkNPUFlcIixcbiAgXCJDUkVBVEVcIixcbiAgXCJERUxFVEVcIixcbiAgXCJERVNDUklCRVwiLFxuICBcIkRST1BcIixcbiAgXCJFWEVDXCIsXG4gIFwiRVhFQ1VURVwiLFxuICBcIkVYUExBSU5cIixcbiAgXCJHUkFOVFwiLFxuICBcIklOU0VSVFwiLFxuICBcIk1FUkdFXCIsXG4gIFwiUFJBR01BXCIsXG4gIFwiUkVMRUFTRVwiLFxuICBcIlJFUExBQ0VcIixcbiAgXCJSRVZPS0VcIixcbiAgXCJST0xMQkFDS1wiLFxuICBcIlNBVkVQT0lOVFwiLFxuICBcIlNFTEVDVFwiLFxuICBcIlNFVFwiLFxuICBcIlNIT1dcIixcbiAgXCJUUlVOQ0FURVwiLFxuICBcIlVQREFURVwiLFxuICBcIlZBQ1VVTVwiLFxuICBcIlZBTFVFU1wiLFxuICBcIldJVEhcIlxuXSlcblxuLyoqXG4gKiBSb3VuZHMgYW5kIGJvdW5kcyBkdXJhdGlvbiB2YWx1ZXMgZm9yIHB1YmxpYyBvdXRwdXQuXG4gKiBAcGFyYW0ge251bWJlcn0gZHVyYXRpb25NcyAtIFJhdyBkdXJhdGlvbi5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gU2FmZSBkdXJhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJvdW5kUHJvZmlsZUR1cmF0aW9uKGR1cmF0aW9uTXMpIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoZHVyYXRpb25NcykgfHwgZHVyYXRpb25NcyA8IDApIHJldHVybiAwXG5cbiAgcmV0dXJuIE1hdGgucm91bmQoZHVyYXRpb25NcyAqIDEwMDApIC8gMTAwMFxufVxuXG4vKipcbiAqIENvbGxlY3RzIG9wdC1pbiB0ZXN0LXJ1biB0aW1pbmcgd2l0aG91dCByZXRhaW5pbmcgYXBwbGljYXRpb24gcGF5bG9hZHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RQcm9maWxlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIG9wdC1pbiB0ZXN0IHByb2ZpbGUgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFByb2ZpbGVyIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBUZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb2plY3REaXJlY3RvcnkgLSBQcm9qZWN0IHJvb3QgdXNlZCBmb3IgcG9ydGFibGUgcGF0aHMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5zZWxlY3Rpb25dIC0gU2FuaXRpemVkIHNlbGVjdGlvbiBtZXRhZGF0YS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBwcm9qZWN0RGlyZWN0b3J5LCBzZWxlY3Rpb24gPSB7fX0pIHtcbiAgICB0aGlzLl9jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuX3Byb2plY3REaXJlY3RvcnkgPSBwYXRoLnJlc29sdmUocHJvamVjdERpcmVjdG9yeSlcbiAgICB0aGlzLl9zZWxlY3Rpb24gPSBzZWxlY3Rpb25cbiAgICB0aGlzLl9zdGFydGVkQXQgPSB0aGlzLm5vdygpXG4gICAgdGhpcy5fY3B1U3RhcnRlZEF0ID0gcHJvY2Vzcy5jcHVVc2FnZSgpXG4gICAgdGhpcy5fZXhlY3V0aW9uT3JkZXIgPSAwXG4gICAgdGhpcy5fdW5hdHRyaWJ1dGVkTGF0ZUV2ZW50Q291bnQgPSAwXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBJbnRlcm5hbFBoYXNlQWdncmVnYXRlPn0gKi9cbiAgICB0aGlzLl9waGFzZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEludGVybmFsRmlsZUFnZ3JlZ2F0ZT59ICovXG4gICAgdGhpcy5fZmlsZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge0ludGVybmFsVGVzdFJlY29yZFtdfSAqL1xuICAgIHRoaXMuX3Rlc3RzID0gW11cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEludGVybmFsVGVzdFJlY29yZD59ICovXG4gICAgdGhpcy5fdGVzdHNCeUlkID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8VGVzdFByb2ZpbGVBdHRlbXB0SGFuZGxlPn0gKi9cbiAgICB0aGlzLl9hY3RpdmVBdHRlbXB0cyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7U2V0PFRlc3RQcm9maWxlQXN5bmNDb250ZXh0Pn0gKi9cbiAgICB0aGlzLl9hY3RpdmVTcGFuQ29udGV4dHMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge1Rlc3RQcm9maWxlU3BhbltdfSAqL1xuICAgIHRoaXMuX3NwYW5zID0gW11cbiAgICAvKiogQHR5cGUge0FycmF5PHtpZDogc3RyaW5nLCBwYXJlbnRJZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBmaWxlOiBzdHJpbmcsIGxpbmU6IG51bWJlciB8IHVuZGVmaW5lZH0+fSAqL1xuICAgIHRoaXMuX3Njb3BlcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdHNBcmd1bWVudCwgc3RyaW5nPn0gKi9cbiAgICB0aGlzLl9zY29wZUlkcyA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIHRoaXMuX2N1c3RvbUFjdGl2aXR5TmFtZXMgPSBuZXcgU2V0KClcbiAgICB0aGlzLl9kYXRhYmFzZSA9IHRoaXMuZW1wdHlEYXRhYmFzZUFnZ3JlZ2F0ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCB7aGFzaDogc3RyaW5nLCBvcGVyYXRpb246IHN0cmluZywgY291bnQ6IG51bWJlciwgZmFpbGVkQ291bnQ6IG51bWJlciwgdG90YWxNczogbnVtYmVyLCBtYXhNczogbnVtYmVyfT59ICovXG4gICAgdGhpcy5fcXVlcnlGaW5nZXJwcmludHMgPSBuZXcgTWFwKClcbiAgICB0aGlzLl90cmFuc2FjdGlvbnMgPSB7XG4gICAgICBzdGFydDogdGhpcy5waGFzZUFnZ3JlZ2F0ZVNoYXBlKCksXG4gICAgICBjb21taXQ6IHRoaXMucGhhc2VBZ2dyZWdhdGVTaGFwZSgpLFxuICAgICAgcm9sbGJhY2s6IHRoaXMucGhhc2VBZ2dyZWdhdGVTaGFwZSgpXG4gICAgfVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvZmlsZVBvb2xBZ2dyZWdhdGU+fSAqL1xuICAgIHRoaXMuX3Bvb2xzID0gbmV3IE1hcCgpXG4gICAgdGhpcy5fZmluaXNoZWRQcm9maWxlID0gdW5kZWZpbmVkXG5cbiAgICByZWdpc3RlclRlc3RQcm9maWxlQ29udGV4dFJlYWRlcihjb25maWd1cmF0aW9uLCAoKSA9PiB7XG4gICAgICByZXR1cm4gY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KClcbiAgICB9KVxuXG4gICAgZm9yIChjb25zdCBwaGFzZSBvZiBCVUlMVF9JTl9QSEFTRVMpIHRoaXMucGhhc2VBZ2dyZWdhdGUocGhhc2UpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcHJvZmlsZXIncyBtb25vdG9uaWMgY2xvY2suXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTW9ub3RvbmljIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIG5vdygpIHtcbiAgICByZXR1cm4gZ2xvYmFsVGhpcy5wZXJmb3JtYW5jZS5ub3coKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgc291cmNlIHBhdGggdG8gYSBwcm9qZWN0LXJlbGF0aXZlIHBhdGggb3IgYW4gb3BhcXVlIGhhc2guXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBmaWxlUGF0aCAtIFNvdXJjZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhZmUgc291cmNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBzYWZlU291cmNlUGF0aChmaWxlUGF0aCkge1xuICAgIGlmICghZmlsZVBhdGgpIHJldHVybiBcInNoYTI1Njp1bmtub3duXCJcblxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHBhdGgucmVzb2x2ZShmaWxlUGF0aClcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHRoaXMuX3Byb2plY3REaXJlY3RvcnksIGFic29sdXRlUGF0aClcblxuICAgIGlmIChyZWxhdGl2ZVBhdGggJiYgIXJlbGF0aXZlUGF0aC5zdGFydHNXaXRoKFwiLi5cIikgJiYgIXBhdGguaXNBYnNvbHV0ZShyZWxhdGl2ZVBhdGgpKSB7XG4gICAgICByZXR1cm4gcmVsYXRpdmVQYXRoLnJlcGxhY2VBbGwocGF0aC5zZXAsIFwiL1wiKVxuICAgIH1cblxuICAgIGlmICghcmVsYXRpdmVQYXRoKSByZXR1cm4gcGF0aC5iYXNlbmFtZShhYnNvbHV0ZVBhdGgpXG5cbiAgICByZXR1cm4gdGhpcy5oYXNoKGBleHRlcm5hbC1zb3VyY2U6JHthYnNvbHV0ZVBhdGh9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgYm91bmRlZCBvcGFxdWUgU0hBLTI1NiBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBWYWx1ZSB0byBoYXNoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE9wYXF1ZSBoYXNoLlxuICAgKi9cbiAgaGFzaCh2YWx1ZSkge1xuICAgIHJldHVybiBgc2hhMjU2OiR7Y3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUodmFsdWUpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAyNCl9YFxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYWdncmVnYXRlLW9ubHkgc2VsZWN0aW9uIG1ldGFkYXRhIGFzIGRpc2NvdmVyeSBwcm9ncmVzc2VzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gc2VsZWN0aW9uIC0gU2FmZSBzZWxlY3Rpb24gbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0U2VsZWN0aW9uKHNlbGVjdGlvbikge1xuICAgIE9iamVjdC5hc3NpZ24odGhpcy5fc2VsZWN0aW9uLCBzZWxlY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGFuZCByZXR1cm5zIGEgZGV0ZXJtaW5pc3RpYyBzY29wZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdHNBcmd1bWVudH0gc2NvcGUgLSBTY29wZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2NvcGUgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gU2NvcGUgZGVzY3JpcHRpb24gcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuZmlsZVBhdGggLSBTY29wZSBzb3VyY2UgcGF0aC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IFthcmdzLmxpbmVdIC0gU2NvcGUgc291cmNlIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBbYXJncy5wYXJlbnRJZF0gLSBQYXJlbnQgc2NvcGUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBPcGFxdWUgc2NvcGUgaWRlbnRpZmllci5cbiAgICovXG4gIHNjb3BlSWQoc2NvcGUsIHtkZXNjcmlwdGlvbnMsIGZpbGVQYXRoLCBsaW5lLCBwYXJlbnRJZH0pIHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuX3Njb3BlSWRzLmdldChzY29wZSlcbiAgICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZ1xuXG4gICAgY29uc3Qgc2FmZUZpbGVQYXRoID0gdGhpcy5zYWZlU291cmNlUGF0aChmaWxlUGF0aClcbiAgICBjb25zdCBpZCA9IHRoaXMuaGFzaChgc2NvcGU6JHtzYWZlRmlsZVBhdGh9OiR7bGluZSA/PyAwfToke2Rlc2NyaXB0aW9ucy5qb2luKFwiXFx1MDAwMFwiKX1gKVxuXG4gICAgdGhpcy5fc2NvcGVJZHMuc2V0KHNjb3BlLCBpZClcbiAgICB0aGlzLl9zY29wZXMucHVzaCh7aWQsIHBhcmVudElkLCBmaWxlOiBzYWZlRmlsZVBhdGgsIGxpbmV9KVxuICAgIHJldHVybiBpZFxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhbiBhdHRlbXB0IGFuZCBpdHMgYXN5bmMgYXR0cmlidXRpb24gY29udGV4dC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBdHRlbXB0IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIFBhcmVudCBkZXNjcmlwdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmF0dGVtcHROdW1iZXIgLSBBdHRlbXB0IG51bWJlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge1Rlc3RQcm9maWxlQXR0ZW1wdEhhbmRsZX0gLSBBY3RpdmUgYXR0ZW1wdCBoYW5kbGUuXG4gICAqL1xuICBzdGFydEF0dGVtcHQoe2Rlc2NyaXB0aW9ucywgYXR0ZW1wdE51bWJlciwgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbn0pIHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5zYWZlU291cmNlUGF0aCh0ZXN0RGF0YS5vd25lckZpbGVQYXRoID8/IHRlc3REYXRhLmZpbGVQYXRoKVxuICAgIGNvbnN0IGlkID0gdGhpcy5oYXNoKGB0ZXN0OiR7ZmlsZX06JHt0ZXN0RGF0YS5saW5lID8/IDB9OiR7Wy4uLmRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uXS5qb2luKFwiXFx1MDAwMFwiKX1gKVxuICAgIGxldCB0ZXN0UmVjb3JkID0gdGhpcy5fdGVzdHNCeUlkLmdldChpZClcblxuICAgIGlmICghdGVzdFJlY29yZCkge1xuICAgICAgdGVzdFJlY29yZCA9IHtpZCwgZmlsZSwgbGluZTogdGVzdERhdGEubGluZSwgYXR0ZW1wdHM6IFtdfVxuICAgICAgdGhpcy5fdGVzdHNCeUlkLnNldChpZCwgdGVzdFJlY29yZClcbiAgICAgIHRoaXMuX3Rlc3RzLnB1c2godGVzdFJlY29yZClcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1Rlc3RQcm9maWxlQXR0ZW1wdFJlY29yZH0gKi9cbiAgICBjb25zdCBhdHRlbXB0ID0ge1xuICAgICAgbnVtYmVyOiBhdHRlbXB0TnVtYmVyLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICBjcHVNczoge3VzZXI6IDAsIHN5c3RlbTogMCwgdG90YWw6IDB9LFxuICAgICAgc3BhbnM6IFtdXG4gICAgfVxuICAgIC8qKiBAdHlwZSB7U2V0PFRlc3RQcm9maWxlQXN5bmNDb250ZXh0Pn0gKi9cbiAgICBjb25zdCBhdHRlbXB0Q29udGV4dHMgPSBuZXcgU2V0KClcbiAgICBjb25zdCBjb250ZXh0ID0ge3Byb2ZpbGVyOiB0aGlzLCBhdHRlbXB0LCBhY3RpdmU6IHRydWUsIGF0dGVtcHRDb250ZXh0cywgZmlsZVBhdGg6IGZpbGUsIHNwYW46IHVuZGVmaW5lZH1cblxuICAgIGF0dGVtcHRDb250ZXh0cy5hZGQoY29udGV4dClcblxuICAgIGNvbnN0IGhhbmRsZSA9IHtjb250ZXh0LCBhdHRlbXB0LCBzdGFydGVkQXQ6IHRoaXMubm93KCksIGNwdVN0YXJ0ZWRBdDogcHJvY2Vzcy5jcHVVc2FnZSgpfVxuXG4gICAgdGVzdFJlY29yZC5hdHRlbXB0cy5wdXNoKGF0dGVtcHQpXG4gICAgdGhpcy5fYWN0aXZlQXR0ZW1wdHMuYWRkKGhhbmRsZSlcblxuICAgIHJldHVybiBoYW5kbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgaW5zaWRlIGFuIGF0dGVtcHQncyBhc3luYyBjb250ZXh0LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1Rlc3RQcm9maWxlQXR0ZW1wdEhhbmRsZX0gaGFuZGxlIC0gQXR0ZW1wdCBoYW5kbGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBBdHRlbXB0IGxpZmVjeWNsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuQXR0ZW1wdChoYW5kbGUsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NvbmZpZ3VyYXRpb25cbiAgICAgIC5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgICAgLnJ1bldpdGhUZXN0UHJvZmlsZUNvbnRleHQoaGFuZGxlLmNvbnRleHQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBsZXRlcyBhbiBhdHRlbXB0IGFuZCBwcmV2ZW50cyBkZXNjZW5kYW50IGxhdGUgd29yayBmcm9tIHJldGFpbmluZyBhdHRyaWJ1dGlvbi5cbiAgICogQHBhcmFtIHtUZXN0UHJvZmlsZUF0dGVtcHRIYW5kbGV9IGhhbmRsZSAtIEF0dGVtcHQgaGFuZGxlLlxuICAgKiBAcGFyYW0ge1Rlc3RQcm9maWxlQXR0ZW1wdFN0YXR1c30gc3RhdHVzIC0gQXR0ZW1wdCByZXN1bHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZmluaXNoQXR0ZW1wdChoYW5kbGUsIHN0YXR1cykge1xuICAgIGlmIChoYW5kbGUuYXR0ZW1wdC5zdGF0dXMgIT09IFwicnVubmluZ1wiKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY29udGV4dCBvZiBoYW5kbGUuY29udGV4dC5hdHRlbXB0Q29udGV4dHMgfHwgW10pIHtcbiAgICAgIGlmIChjb250ZXh0LnNwYW4pIHRoaXMuZmluaXNoU3BhbkNvbnRleHQoY29udGV4dClcbiAgICAgIGNvbnRleHQuYWN0aXZlID0gZmFsc2VcbiAgICB9XG5cbiAgICBoYW5kbGUuYXR0ZW1wdC5zdGF0dXMgPSBzdGF0dXNcbiAgICBoYW5kbGUuYXR0ZW1wdC5kdXJhdGlvbk1zID0gcm91bmRQcm9maWxlRHVyYXRpb24odGhpcy5ub3coKSAtIGhhbmRsZS5zdGFydGVkQXQpXG4gICAgaGFuZGxlLmF0dGVtcHQuY3B1TXMgPSB0aGlzLmNwdUR1cmF0aW9uKGhhbmRsZS5jcHVTdGFydGVkQXQpXG4gICAgdGhpcy5hZGRGaWxlQXR0ZW1wdER1cmF0aW9uKGhhbmRsZS5jb250ZXh0LmZpbGVQYXRoLCBoYW5kbGUuYXR0ZW1wdC5kdXJhdGlvbk1zKVxuICAgIHRoaXMuX2FjdGl2ZUF0dGVtcHRzLmRlbGV0ZShoYW5kbGUpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGV2ZXJ5IGFjdGl2ZSBhdHRlbXB0IGFuZCBuZXN0ZWQgc3BhbiBhdCB0aGUgY3VycmVudCBpbnRlcnJ1cHRpb24gYm91bmRhcnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgaW50ZXJydXB0KCkge1xuICAgIGZvciAoY29uc3QgaGFuZGxlIG9mIFsuLi50aGlzLl9hY3RpdmVBdHRlbXB0c10pIHtcbiAgICAgIHRoaXMuZmluaXNoQXR0ZW1wdChoYW5kbGUsIFwiaW50ZXJydXB0ZWRcIilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNvbnRleHQgb2YgWy4uLnRoaXMuX2FjdGl2ZVNwYW5Db250ZXh0c10pIHtcbiAgICAgIHRoaXMuZmluaXNoU3BhbkNvbnRleHQoY29udGV4dClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHJ1bm5lci1vd25lZCBwaGFzZSBzcGFuLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNwYW4gbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnBoYXNlIC0gUGhhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmFjdGl2aXR5XSAtIEN1c3RvbSBhY3Rpdml0eSBsYWJlbC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBkZWNsYXJhdGlvbiBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRlY2xhcmF0aW9uU2NvcGVJZF0gLSBIb29rIGRlY2xhcmF0aW9uIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZmlsZVBhdGhdIC0gU291cmNlIG9yIG93bmluZyB0ZXN0IGZpbGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gKFQgfCBQcm9taXNlPFQ+KX0gY2FsbGJhY2sgLSBUaW1lZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5TcGFuKHtwaGFzZSwgYWN0aXZpdHksIGRlY2xhcmF0aW9uSW5kZXgsIGRlY2xhcmF0aW9uU2NvcGVJZCwgZmlsZVBhdGh9LCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGN1cnJlbnRDb250ZXh0ID0gdGhpcy5fY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KClcblxuICAgIGlmIChjdXJyZW50Q29udGV4dCAmJiAhdGhpcy5jb250ZXh0SXNBY3RpdmUoY3VycmVudENvbnRleHQpKSB7XG4gICAgICB0aGlzLl91bmF0dHJpYnV0ZWRMYXRlRXZlbnRDb3VudCsrXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cblxuICAgIGNvbnN0IHNhZmVGaWxlUGF0aCA9IGN1cnJlbnRDb250ZXh0Py5maWxlUGF0aCA/PyAoZmlsZVBhdGggPyB0aGlzLnNhZmVTb3VyY2VQYXRoKGZpbGVQYXRoKSA6IHVuZGVmaW5lZClcbiAgICBjb25zdCBzdGFydGVkQXQgPSB0aGlzLm5vdygpXG4gICAgY29uc3QgY3B1U3RhcnRlZEF0ID0gcHJvY2Vzcy5jcHVVc2FnZSgpXG4gICAgLyoqIEB0eXBlIHtUZXN0UHJvZmlsZVNwYW59ICovXG4gICAgY29uc3Qgc3BhbiA9IHtcbiAgICAgIHBoYXNlLFxuICAgICAgZXhlY3V0aW9uT3JkZXI6ICsrdGhpcy5fZXhlY3V0aW9uT3JkZXIsXG4gICAgICBkdXJhdGlvbk1zOiAwLFxuICAgICAgY3B1TXM6IHt1c2VyOiAwLCBzeXN0ZW06IDAsIHRvdGFsOiAwfVxuICAgIH1cblxuICAgIGlmIChhY3Rpdml0eSkgc3Bhbi5hY3Rpdml0eSA9IGFjdGl2aXR5XG4gICAgaWYgKGRlY2xhcmF0aW9uSW5kZXggIT09IHVuZGVmaW5lZCkgc3Bhbi5kZWNsYXJhdGlvbkluZGV4ID0gZGVjbGFyYXRpb25JbmRleFxuICAgIGlmIChkZWNsYXJhdGlvblNjb3BlSWQpIHNwYW4uZGVjbGFyYXRpb25TY29wZUlkID0gZGVjbGFyYXRpb25TY29wZUlkXG4gICAgaWYgKHNhZmVGaWxlUGF0aCkgc3Bhbi5maWxlID0gc2FmZUZpbGVQYXRoXG5cbiAgICBpZiAoY3VycmVudENvbnRleHQ/LmF0dGVtcHQpIHtcbiAgICAgIGN1cnJlbnRDb250ZXh0LmF0dGVtcHQuc3BhbnMucHVzaChzcGFuKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9zcGFucy5wdXNoKHNwYW4pXG4gICAgfVxuXG4gICAgY29uc3Qgc3BhbkNvbnRleHQgPSB7XG4gICAgICBwcm9maWxlcjogdGhpcyxcbiAgICAgIGF0dGVtcHQ6IGN1cnJlbnRDb250ZXh0Py5hdHRlbXB0LFxuICAgICAgYWN0aXZlOiB0cnVlLFxuICAgICAgYXR0ZW1wdENvbnRleHRzOiBjdXJyZW50Q29udGV4dD8uYXR0ZW1wdENvbnRleHRzLFxuICAgICAgZmlsZVBhdGg6IHNhZmVGaWxlUGF0aCxcbiAgICAgIHNwYW4sXG4gICAgICBzcGFuU3RhcnRlZEF0OiBzdGFydGVkQXQsXG4gICAgICBzcGFuQ3B1U3RhcnRlZEF0OiBjcHVTdGFydGVkQXRcbiAgICB9XG5cbiAgICBzcGFuQ29udGV4dC5hdHRlbXB0Q29udGV4dHM/LmFkZChzcGFuQ29udGV4dClcbiAgICB0aGlzLl9hY3RpdmVTcGFuQ29udGV4dHMuYWRkKHNwYW5Db250ZXh0KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9jb25maWd1cmF0aW9uXG4gICAgICAgIC5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgICAgICAucnVuV2l0aFRlc3RQcm9maWxlQ29udGV4dChzcGFuQ29udGV4dCwgY2FsbGJhY2spXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChzcGFuQ29udGV4dC5hY3RpdmUpIHtcbiAgICAgICAgdGhpcy5maW5pc2hTcGFuQ29udGV4dChzcGFuQ29udGV4dClcbiAgICAgIH0gZWxzZSBpZiAoc3BhbkNvbnRleHQuYXR0ZW1wdCkge1xuICAgICAgICB0aGlzLl91bmF0dHJpYnV0ZWRMYXRlRXZlbnRDb3VudCsrXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmFsaXplcyBhbiBvcGVuIHNwYW4sIGluY2x1ZGluZyBwYXJ0aWFsIHdvcmsgY2xvc2VkIGJ5IGEgdGltZW91dC5cbiAgICogQHBhcmFtIHtUZXN0UHJvZmlsZUFzeW5jQ29udGV4dH0gY29udGV4dCAtIFNwYW4gY29udGV4dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBmaW5pc2hTcGFuQ29udGV4dChjb250ZXh0KSB7XG4gICAgaWYgKCFjb250ZXh0LmFjdGl2ZSB8fCAhY29udGV4dC5zcGFuIHx8IGNvbnRleHQuc3BhblN0YXJ0ZWRBdCA9PT0gdW5kZWZpbmVkIHx8ICFjb250ZXh0LnNwYW5DcHVTdGFydGVkQXQpIHJldHVyblxuXG4gICAgY29udGV4dC5hY3RpdmUgPSBmYWxzZVxuICAgIGNvbnRleHQuc3Bhbi5kdXJhdGlvbk1zID0gcm91bmRQcm9maWxlRHVyYXRpb24odGhpcy5ub3coKSAtIGNvbnRleHQuc3BhblN0YXJ0ZWRBdClcbiAgICBjb250ZXh0LnNwYW4uY3B1TXMgPSB0aGlzLmNwdUR1cmF0aW9uKGNvbnRleHQuc3BhbkNwdVN0YXJ0ZWRBdClcbiAgICB0aGlzLmFkZFBoYXNlRHVyYXRpb24oY29udGV4dC5zcGFuLnBoYXNlLCBjb250ZXh0LnNwYW4uZHVyYXRpb25NcywgY29udGV4dC5zcGFuLmNwdU1zKVxuICAgIHRoaXMuYWRkRmlsZUR1cmF0aW9uKGNvbnRleHQuZmlsZVBhdGgsIGNvbnRleHQuc3Bhbi5waGFzZSwgY29udGV4dC5zcGFuLmR1cmF0aW9uTXMsIEJvb2xlYW4oY29udGV4dC5hdHRlbXB0KSlcbiAgICB0aGlzLl9hY3RpdmVTcGFuQ29udGV4dHMuZGVsZXRlKGNvbnRleHQpXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGJvdGggYSBuZXN0ZWQgc3BhbiBib3VuZGFyeSBhbmQgaXRzIG93bmluZyBhdHRlbXB0IGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0ge1Rlc3RQcm9maWxlQXN5bmNDb250ZXh0fSBjb250ZXh0IC0gQ2FuZGlkYXRlIHByb2ZpbGUgY29udGV4dC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBldmVudHMgbWF5IHN0aWxsIGJlIGF0dHJpYnV0ZWQuXG4gICAqL1xuICBjb250ZXh0SXNBY3RpdmUoY29udGV4dCkge1xuICAgIHJldHVybiBjb250ZXh0LmFjdGl2ZSAmJiAoIWNvbnRleHQuYXR0ZW1wdCB8fCBjb250ZXh0LmF0dGVtcHQuc3RhdHVzID09PSBcInJ1bm5pbmdcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgdmFsaWRhdGVkIGFwcGxpY2F0aW9uLWRlZmluZWQgYWN0aXZpdHkuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7VGVzdFByb2ZpbGVBc3luY0NvbnRleHR9IGNvbnRleHQgLSBDYXB0dXJlZCBhc3luYyBjb250ZXh0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFZhbGlkYXRlZCBhY3Rpdml0eSBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IChUIHwgUHJvbWlzZTxUPil9IGNhbGxiYWNrIC0gQWN0aXZpdHkgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHByb2ZpbGVBY3Rpdml0eShjb250ZXh0LCBuYW1lLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5jb250ZXh0SXNBY3RpdmUoY29udGV4dCkpIHtcbiAgICAgIHRoaXMuX3VuYXR0cmlidXRlZExhdGVFdmVudENvdW50KytcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfVxuXG4gICAgY29uc3QgdmFsaWRhdGVkTmFtZSA9IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZShuYW1lKVxuICAgIGxldCBvdXRwdXROYW1lID0gdmFsaWRhdGVkTmFtZVxuXG4gICAgaWYgKCF0aGlzLl9jdXN0b21BY3Rpdml0eU5hbWVzLmhhcyh2YWxpZGF0ZWROYW1lKSkge1xuICAgICAgaWYgKHRoaXMuX2N1c3RvbUFjdGl2aXR5TmFtZXMuc2l6ZSA+PSBNQVhfQ1VTVE9NX0FDVElWSVRZX05BTUVTKSB7XG4gICAgICAgIG91dHB1dE5hbWUgPSBcIm90aGVyXCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuX2N1c3RvbUFjdGl2aXR5TmFtZXMuYWRkKHZhbGlkYXRlZE5hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuU3Bhbih7cGhhc2U6IFwiY3VzdG9tXCIsIGFjdGl2aXR5OiBvdXRwdXROYW1lfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogTWVhc3VyZXMgYSBjb21tYW5kLWxldmVsIHBoYXNlIG91dHNpZGUgYW4gYXR0ZW1wdC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IHBoYXNlIC0gUGhhc2UgbmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIFRpbWVkIHdvcmsuXG4gICAqIEBwYXJhbSB7e2ZpbGVQYXRoPzogc3RyaW5nfX0gW21ldGFkYXRhXSAtIE9wdGlvbmFsIHNvdXJjZSBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIG1lYXN1cmVQaGFzZShwaGFzZSwgY2FsbGJhY2ssIG1ldGFkYXRhID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5TcGFuKHtwaGFzZSwgZmlsZVBhdGg6IG1ldGFkYXRhLmZpbGVQYXRofSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgc3VjY2Vzc2Z1bCBvciBmYWlsZWQgcGh5c2ljYWwgZGF0YWJhc2UgcXVlcnkgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtUZXN0UHJvZmlsZUFzeW5jQ29udGV4dH0gY29udGV4dCAtIENvbnRleHQgY2FwdHVyZWQgd2hlbiB0aGUgcXVlcnkgYmVnYW4uXG4gICAqIEBwYXJhbSB7e2R1cmF0aW9uTXM6IG51bWJlciwgZmFpbGVkOiBib29sZWFuLCBzcWxGaW5nZXJwcmludDogc3RyaW5nLCBzcWxPcGVyYXRpb246IHN0cmluZ319IGFyZ3MgLSBRdWVyeSBhZ2dyZWdhdGUgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZERhdGFiYXNlUXVlcnkoY29udGV4dCwge2R1cmF0aW9uTXMsIGZhaWxlZCwgc3FsRmluZ2VycHJpbnQsIHNxbE9wZXJhdGlvbn0pIHtcbiAgICBpZiAoIXRoaXMuY29udGV4dElzQWN0aXZlKGNvbnRleHQpKSB7XG4gICAgICB0aGlzLl91bmF0dHJpYnV0ZWRMYXRlRXZlbnRDb3VudCsrXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBzYWZlRHVyYXRpb25NcyA9IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGR1cmF0aW9uTXMpXG5cbiAgICB0aGlzLmFkZERhdGFiYXNlUXVlcnlBZ2dyZWdhdGUodGhpcy5fZGF0YWJhc2UsIHtkdXJhdGlvbk1zOiBzYWZlRHVyYXRpb25NcywgZmFpbGVkfSlcbiAgICBpZiAoY29udGV4dC5zcGFuKSB7XG4gICAgICBjb250ZXh0LnNwYW4uZGF0YWJhc2UgfHw9IHRoaXMuZW1wdHlEYXRhYmFzZUFnZ3JlZ2F0ZSgpXG4gICAgICB0aGlzLmFkZERhdGFiYXNlUXVlcnlBZ2dyZWdhdGUoY29udGV4dC5zcGFuLmRhdGFiYXNlLCB7ZHVyYXRpb25Nczogc2FmZUR1cmF0aW9uTXMsIGZhaWxlZH0pXG4gICAgfVxuXG4gICAgY29uc3Qgc2FmZU9wZXJhdGlvbiA9IFNBRkVfU1FMX09QRVJBVElPTlMuaGFzKHNxbE9wZXJhdGlvbikgPyBzcWxPcGVyYXRpb24gOiBcIlVOS05PV05cIlxuICAgIGNvbnN0IGZpbmdlcnByaW50S2V5ID0gYCR7c2FmZU9wZXJhdGlvbn06JHtzcWxGaW5nZXJwcmludH1gXG4gICAgbGV0IGZpbmdlcnByaW50ID0gdGhpcy5fcXVlcnlGaW5nZXJwcmludHMuZ2V0KGZpbmdlcnByaW50S2V5KVxuXG4gICAgaWYgKCFmaW5nZXJwcmludCAmJiB0aGlzLl9xdWVyeUZpbmdlcnByaW50cy5zaXplIDwgNTApIHtcbiAgICAgIGZpbmdlcnByaW50ID0ge1xuICAgICAgICBoYXNoOiBzcWxGaW5nZXJwcmludCxcbiAgICAgICAgb3BlcmF0aW9uOiBzYWZlT3BlcmF0aW9uLFxuICAgICAgICBjb3VudDogMCxcbiAgICAgICAgZmFpbGVkQ291bnQ6IDAsXG4gICAgICAgIHRvdGFsTXM6IDAsXG4gICAgICAgIG1heE1zOiAwXG4gICAgICB9XG4gICAgICB0aGlzLl9xdWVyeUZpbmdlcnByaW50cy5zZXQoZmluZ2VycHJpbnRLZXksIGZpbmdlcnByaW50KVxuICAgIH1cblxuICAgIGlmIChmaW5nZXJwcmludCkge1xuICAgICAgZmluZ2VycHJpbnQuY291bnQrK1xuICAgICAgaWYgKGZhaWxlZCkgZmluZ2VycHJpbnQuZmFpbGVkQ291bnQrK1xuICAgICAgZmluZ2VycHJpbnQudG90YWxNcyArPSBzYWZlRHVyYXRpb25Nc1xuICAgICAgZmluZ2VycHJpbnQubWF4TXMgPSBNYXRoLm1heChmaW5nZXJwcmludC5tYXhNcywgc2FmZUR1cmF0aW9uTXMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBwaHlzaWNhbCB0cmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7VGVzdFByb2ZpbGVBc3luY0NvbnRleHR9IGNvbnRleHQgLSBDb250ZXh0IGNhcHR1cmVkIHdoZW4gdGhlIGFjdGlvbiBiZWdhbi5cbiAgICogQHBhcmFtIHt7YWN0aW9uOiBcInN0YXJ0XCIgfCBcImNvbW1pdFwiIHwgXCJyb2xsYmFja1wiLCBkdXJhdGlvbk1zOiBudW1iZXIsIGZhaWxlZDogYm9vbGVhbn19IGFyZ3MgLSBUcmFuc2FjdGlvbiBhZ2dyZWdhdGUgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZERhdGFiYXNlVHJhbnNhY3Rpb24oY29udGV4dCwge2FjdGlvbiwgZHVyYXRpb25NcywgZmFpbGVkfSkge1xuICAgIGlmICghdGhpcy5jb250ZXh0SXNBY3RpdmUoY29udGV4dCkpIHtcbiAgICAgIHRoaXMuX3VuYXR0cmlidXRlZExhdGVFdmVudENvdW50KytcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGFnZ3JlZ2F0ZSA9IHRoaXMuX3RyYW5zYWN0aW9uc1thY3Rpb25dXG4gICAgY29uc3Qgc2FmZUR1cmF0aW9uTXMgPSByb3VuZFByb2ZpbGVEdXJhdGlvbihkdXJhdGlvbk1zKVxuXG4gICAgYWdncmVnYXRlLmNvdW50KytcbiAgICBpZiAoZmFpbGVkKSBhZ2dyZWdhdGUuZmFpbGVkQ291bnQrK1xuICAgIGFnZ3JlZ2F0ZS50b3RhbE1zICs9IHNhZmVEdXJhdGlvbk1zXG4gICAgYWdncmVnYXRlLm1heE1zID0gTWF0aC5tYXgoYWdncmVnYXRlLm1heE1zLCBzYWZlRHVyYXRpb25NcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBsb3ctY2FyZGluYWxpdHkgcG9vbCBsaWZlY3ljbGUgZGVsdGEuXG4gICAqIEBwYXJhbSB7VGVzdFByb2ZpbGVBc3luY0NvbnRleHR9IGNvbnRleHQgLSBDb250ZXh0IGNhcHR1cmVkIHdoZW4gdGhlIG9wZXJhdGlvbiBiZWdhbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBMb2dpY2FsIHBvb2wgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtcImNvbm5lY3Rpb25DcmVhdGlvblwiIHwgXCJjaGVja291dFdhaXRcIiB8IFwiY2hlY2tvdXRUaW1lb3V0XCIgfCBcImlkbGVSZWFwXCIgfCBcImlkbGVSZWFwRGlzcG9zYWxcIiB8IFwicGVha0xpdmVDb25uZWN0aW9uc1wifSBtZXRyaWMgLSBNZXRyaWMgbmFtZS5cbiAgICogQHBhcmFtIHt7ZHVyYXRpb25Ncz86IG51bWJlciwgZmFpbGVkPzogYm9vbGVhbiwgdmFsdWU/OiBudW1iZXJ9fSBbdmFsdWVzXSAtIEFnZ3JlZ2F0ZSB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkUG9vbE1ldHJpYyhjb250ZXh0LCBpZGVudGlmaWVyLCBtZXRyaWMsIHZhbHVlcyA9IHt9KSB7XG4gICAgaWYgKCF0aGlzLmNvbnRleHRJc0FjdGl2ZShjb250ZXh0KSkge1xuICAgICAgdGhpcy5fdW5hdHRyaWJ1dGVkTGF0ZUV2ZW50Q291bnQrK1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgYWdncmVnYXRlID0gdGhpcy5wb29sQWdncmVnYXRlKHRoaXMuX3Bvb2xzLCBpZGVudGlmaWVyKVxuXG4gICAgdGhpcy5hZGRQb29sTWV0cmljKGFnZ3JlZ2F0ZSwgbWV0cmljLCB2YWx1ZXMpXG5cbiAgICBpZiAoY29udGV4dC5zcGFuKSB7XG4gICAgICBjb250ZXh0LnNwYW4ucG9vbHMgfHw9IFtdXG4gICAgICBjb25zdCBzcGFuUG9vbHMgPSBuZXcgTWFwKGNvbnRleHQuc3Bhbi5wb29scy5tYXAoKHBvb2wpID0+IFtwb29sLmlkZW50aWZpZXIsIHBvb2xdKSlcbiAgICAgIGNvbnN0IHNwYW5BZ2dyZWdhdGUgPSB0aGlzLnBvb2xBZ2dyZWdhdGUoc3BhblBvb2xzLCBpZGVudGlmaWVyKVxuXG4gICAgICBpZiAoIWNvbnRleHQuc3Bhbi5wb29scy5pbmNsdWRlcyhzcGFuQWdncmVnYXRlKSkgY29udGV4dC5zcGFuLnBvb2xzLnB1c2goc3BhbkFnZ3JlZ2F0ZSlcbiAgICAgIHRoaXMuYWRkUG9vbE1ldHJpYyhzcGFuQWdncmVnYXRlLCBtZXRyaWMsIHZhbHVlcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBmaW5hbCBwcml2YWN5LXNhZmUgcHJvZmlsZSBkb2N1bWVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSdW4gcmVzdWx0LlxuICAgKiBAcGFyYW0ge3tkaXNjb3ZlcmVkOiBudW1iZXIsIGV4ZWN1dGVkOiBudW1iZXIsIGZhaWxlZDogbnVtYmVyLCBwYXNzZWQ6IG51bWJlcn19IGFyZ3MuY291bnRzIC0gUnVuIGNvdW50cy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmZvY3VzZWQgLSBXaGV0aGVyIGZvY3VzZWQgdGVzdHMgd2VyZSBzZWxlY3RlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RhdHVzIC0gUnVuIHN0YXR1cy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFJpY2ggcHJvZmlsZSBkb2N1bWVudC5cbiAgICovXG4gIGZpbmlzaCh7Y291bnRzLCBmb2N1c2VkLCBzdGF0dXN9KSB7XG4gICAgaWYgKHRoaXMuX2ZpbmlzaGVkUHJvZmlsZSkgcmV0dXJuIHRoaXMuX2ZpbmlzaGVkUHJvZmlsZVxuXG4gICAgY29uc3QgdG90YWxEdXJhdGlvbk1zID0gcm91bmRQcm9maWxlRHVyYXRpb24odGhpcy5ub3coKSAtIHRoaXMuX3N0YXJ0ZWRBdClcbiAgICBjb25zdCB0b3RhbENwdU1zID0gdGhpcy5jcHVEdXJhdGlvbih0aGlzLl9jcHVTdGFydGVkQXQpXG4gICAgY29uc3QgZXhjbHVzaXZlUGhhc2VOYW1lcyA9IEJVSUxUX0lOX1BIQVNFU1xuICAgIGNvbnN0IG1lYXN1cmVkRHVyYXRpb25NcyA9IGV4Y2x1c2l2ZVBoYXNlTmFtZXMucmVkdWNlKChzdW0sIHBoYXNlKSA9PiBzdW0gKyB0aGlzLnBoYXNlQWdncmVnYXRlKHBoYXNlKS50b3RhbE1zLCAwKVxuICAgIGNvbnN0IG1lYXN1cmVkQ3B1VXNlck1zID0gZXhjbHVzaXZlUGhhc2VOYW1lcy5yZWR1Y2UoKHN1bSwgcGhhc2UpID0+IHN1bSArIHRoaXMucGhhc2VBZ2dyZWdhdGUocGhhc2UpLmNwdVVzZXJNcywgMClcbiAgICBjb25zdCBtZWFzdXJlZENwdVN5c3RlbU1zID0gZXhjbHVzaXZlUGhhc2VOYW1lcy5yZWR1Y2UoKHN1bSwgcGhhc2UpID0+IHN1bSArIHRoaXMucGhhc2VBZ2dyZWdhdGUocGhhc2UpLmNwdVN5c3RlbU1zLCAwKVxuXG4gICAgdGhpcy5fcGhhc2VzLnNldChcInJ1bm5lciBvdmVyaGVhZFwiLCB7XG4gICAgICBjb3VudDogMSxcbiAgICAgIHRvdGFsTXM6IE1hdGgubWF4KDAsIHRvdGFsRHVyYXRpb25NcyAtIG1lYXN1cmVkRHVyYXRpb25NcyksXG4gICAgICBtYXhNczogTWF0aC5tYXgoMCwgdG90YWxEdXJhdGlvbk1zIC0gbWVhc3VyZWREdXJhdGlvbk1zKSxcbiAgICAgIGNwdVVzZXJNczogTWF0aC5tYXgoMCwgdG90YWxDcHVNcy51c2VyIC0gbWVhc3VyZWRDcHVVc2VyTXMpLFxuICAgICAgY3B1U3lzdGVtTXM6IE1hdGgubWF4KDAsIHRvdGFsQ3B1TXMuc3lzdGVtIC0gbWVhc3VyZWRDcHVTeXN0ZW1NcylcbiAgICB9KVxuICAgIHRoaXMuX3BoYXNlcy5zZXQoXCJ0b3RhbFwiLCB7XG4gICAgICBjb3VudDogMSxcbiAgICAgIHRvdGFsTXM6IHRvdGFsRHVyYXRpb25NcyxcbiAgICAgIG1heE1zOiB0b3RhbER1cmF0aW9uTXMsXG4gICAgICBjcHVVc2VyTXM6IHRvdGFsQ3B1TXMudXNlcixcbiAgICAgIGNwdVN5c3RlbU1zOiB0b3RhbENwdU1zLnN5c3RlbVxuICAgIH0pXG5cbiAgICBjb25zdCBwaGFzZXMgPSBPYmplY3QuZnJvbUVudHJpZXMoWy4uLnRoaXMuX3BoYXNlcy5lbnRyaWVzKCldLm1hcCgoW3BoYXNlLCBhZ2dyZWdhdGVdKSA9PiBbXG4gICAgICBwaGFzZSxcbiAgICAgIHRoaXMucHVibGljQWdncmVnYXRlKGFnZ3JlZ2F0ZSlcbiAgICBdKSlcbiAgICBjb25zdCBmaWxlcyA9IFsuLi50aGlzLl9maWxlcy52YWx1ZXMoKV1cbiAgICAgIC5tYXAoKGZpbGUpID0+ICh7XG4gICAgICAgIHBhdGg6IGZpbGUucGF0aCxcbiAgICAgICAgaW1wb3J0TXM6IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGZpbGUuaW1wb3J0TXMpLFxuICAgICAgICBob29rc01zOiByb3VuZFByb2ZpbGVEdXJhdGlvbihmaWxlLmhvb2tzTXMpLFxuICAgICAgICB0ZXN0c01zOiByb3VuZFByb2ZpbGVEdXJhdGlvbihmaWxlLnRlc3RzTXMpLFxuICAgICAgICBhdHRlbXB0c01zOiByb3VuZFByb2ZpbGVEdXJhdGlvbihmaWxlLmF0dGVtcHRzTXMpLFxuICAgICAgICB0b3RhbE1zOiByb3VuZFByb2ZpbGVEdXJhdGlvbihmaWxlLnRvdGFsTXMpXG4gICAgICB9KSlcbiAgICAgIC5zb3J0KChmaWxlQSwgZmlsZUIpID0+IGNvbXBhcmVUaW1pbmdNYW5pZmVzdFBhdGhzKGZpbGVBLnBhdGgsIGZpbGVCLnBhdGgpKVxuICAgIGNvbnN0IHRpbWluZ01hbmlmZXN0ID0gT2JqZWN0LmZyb21FbnRyaWVzKGZpbGVzLm1hcCgoZmlsZSkgPT4gW2ZpbGUucGF0aCwgZmlsZS50b3RhbE1zXSkpXG4gICAgY29uc3QgYXR0ZW1wdHMgPSB0aGlzLl90ZXN0cy5yZWR1Y2UoKHN1bSwgdGVzdCkgPT4gc3VtICsgdGVzdC5hdHRlbXB0cy5sZW5ndGgsIDApXG5cbiAgICB0aGlzLl9maW5pc2hlZFByb2ZpbGUgPSB7XG4gICAgICBzY2hlbWE6IFwidmVsb2Npb3VzLnRlc3QtcHJvZmlsZVwiLFxuICAgICAgc2NoZW1hVmVyc2lvbjogMSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHNlbGVjdGlvbjogey4uLnRoaXMuX3NlbGVjdGlvbiwgZm9jdXNlZH0sXG4gICAgICBjb3VudHM6IHsuLi5jb3VudHMsIGF0dGVtcHRzfSxcbiAgICAgIGR1cmF0aW9uTXM6IHRvdGFsRHVyYXRpb25NcyxcbiAgICAgIGNwdU1zOiB0b3RhbENwdU1zLFxuICAgICAgcGhhc2VzLFxuICAgICAgZmlsZXMsXG4gICAgICBzY29wZXM6IFsuLi50aGlzLl9zY29wZXNdLnNvcnQoKHNjb3BlQSwgc2NvcGVCKSA9PiBzY29wZUEuaWQubG9jYWxlQ29tcGFyZShzY29wZUIuaWQpKSxcbiAgICAgIHRlc3RzOiB0aGlzLl90ZXN0cy5tYXAoKHRlc3QpID0+ICh7XG4gICAgICAgIGlkOiB0ZXN0LmlkLFxuICAgICAgICBmaWxlOiB0ZXN0LmZpbGUsXG4gICAgICAgIGxpbmU6IHRlc3QubGluZSxcbiAgICAgICAgZHVyYXRpb25Nczogcm91bmRQcm9maWxlRHVyYXRpb24odGVzdC5hdHRlbXB0cy5yZWR1Y2UoKHN1bSwgYXR0ZW1wdCkgPT4gc3VtICsgYXR0ZW1wdC5kdXJhdGlvbk1zLCAwKSksXG4gICAgICAgIGF0dGVtcHRzOiB0ZXN0LmF0dGVtcHRzXG4gICAgICB9KSksXG4gICAgICBzcGFuczogdGhpcy5fc3BhbnMsXG4gICAgICBkYXRhYmFzZToge1xuICAgICAgICBxdWVyeUNvdW50OiB0aGlzLl9kYXRhYmFzZS5xdWVyeUNvdW50LFxuICAgICAgICBmYWlsZWRRdWVyeUNvdW50OiB0aGlzLl9kYXRhYmFzZS5mYWlsZWRRdWVyeUNvdW50LFxuICAgICAgICB0b3RhbE1zOiByb3VuZFByb2ZpbGVEdXJhdGlvbih0aGlzLl9kYXRhYmFzZS50b3RhbE1zKSxcbiAgICAgICAgbWF4TXM6IHJvdW5kUHJvZmlsZUR1cmF0aW9uKHRoaXMuX2RhdGFiYXNlLm1heE1zKSxcbiAgICAgICAgZmluZ2VycHJpbnRzOiBbLi4udGhpcy5fcXVlcnlGaW5nZXJwcmludHMudmFsdWVzKCldXG4gICAgICAgICAgLm1hcCgoZmluZ2VycHJpbnQpID0+ICh7XG4gICAgICAgICAgICAuLi5maW5nZXJwcmludCxcbiAgICAgICAgICAgIHRvdGFsTXM6IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGZpbmdlcnByaW50LnRvdGFsTXMpLFxuICAgICAgICAgICAgbWF4TXM6IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGZpbmdlcnByaW50Lm1heE1zKVxuICAgICAgICAgIH0pKVxuICAgICAgICAgIC5zb3J0KChmaW5nZXJwcmludEEsIGZpbmdlcnByaW50QikgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGZpbmdlcnByaW50QS5vcGVyYXRpb24ubG9jYWxlQ29tcGFyZShmaW5nZXJwcmludEIub3BlcmF0aW9uKSB8fCBmaW5nZXJwcmludEEuaGFzaC5sb2NhbGVDb21wYXJlKGZpbmdlcnByaW50Qi5oYXNoKVxuICAgICAgICAgIH0pLFxuICAgICAgICB0cmFuc2FjdGlvbnM6IHtcbiAgICAgICAgICBzdGFydDogdGhpcy5wdWJsaWNBY3Rpb25BZ2dyZWdhdGUodGhpcy5fdHJhbnNhY3Rpb25zLnN0YXJ0KSxcbiAgICAgICAgICBjb21taXQ6IHRoaXMucHVibGljQWN0aW9uQWdncmVnYXRlKHRoaXMuX3RyYW5zYWN0aW9ucy5jb21taXQpLFxuICAgICAgICAgIHJvbGxiYWNrOiB0aGlzLnB1YmxpY0FjdGlvbkFnZ3JlZ2F0ZSh0aGlzLl90cmFuc2FjdGlvbnMucm9sbGJhY2spXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBwb29sczogWy4uLnRoaXMuX3Bvb2xzLnZhbHVlcygpXVxuICAgICAgICAubWFwKChwb29sKSA9PiB0aGlzLnB1YmxpY1Bvb2xBZ2dyZWdhdGUocG9vbCkpXG4gICAgICAgIC5zb3J0KChwb29sQSwgcG9vbEIpID0+IHBvb2xBLmlkZW50aWZpZXIubG9jYWxlQ29tcGFyZShwb29sQi5pZGVudGlmaWVyKSksXG4gICAgICB1bmF0dHJpYnV0ZWRMYXRlRXZlbnRDb3VudDogdGhpcy5fdW5hdHRyaWJ1dGVkTGF0ZUV2ZW50Q291bnQsXG4gICAgICB0aW1pbmdNYW5pZmVzdFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9maW5pc2hlZFByb2ZpbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGludGVybmFsIHBoYXNlIGFnZ3JlZ2F0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBoYXNlIC0gUGhhc2UgbmFtZS5cbiAgICogQHJldHVybnMge0ludGVybmFsUGhhc2VBZ2dyZWdhdGV9IC0gQWdncmVnYXRlLlxuICAgKi9cbiAgcGhhc2VBZ2dyZWdhdGUocGhhc2UpIHtcbiAgICBsZXQgYWdncmVnYXRlID0gdGhpcy5fcGhhc2VzLmdldChwaGFzZSlcblxuICAgIGlmICghYWdncmVnYXRlKSB7XG4gICAgICBhZ2dyZWdhdGUgPSB7Y291bnQ6IDAsIHRvdGFsTXM6IDAsIG1heE1zOiAwLCBjcHVVc2VyTXM6IDAsIGNwdVN5c3RlbU1zOiAwfVxuICAgICAgdGhpcy5fcGhhc2VzLnNldChwaGFzZSwgYWdncmVnYXRlKVxuICAgIH1cblxuICAgIHJldHVybiBhZ2dyZWdhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgY29tcGxldGVkIHNwYW4gdG8gaXRzIGFnZ3JlZ2F0ZSBwaGFzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBoYXNlIC0gUGhhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGR1cmF0aW9uTXMgLSBSZWFsIGR1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3t1c2VyOiBudW1iZXIsIHN5c3RlbTogbnVtYmVyLCB0b3RhbDogbnVtYmVyfX0gY3B1TXMgLSBDUFUgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkUGhhc2VEdXJhdGlvbihwaGFzZSwgZHVyYXRpb25NcywgY3B1TXMpIHtcbiAgICBjb25zdCBhZ2dyZWdhdGUgPSB0aGlzLnBoYXNlQWdncmVnYXRlKHBoYXNlKVxuXG4gICAgYWdncmVnYXRlLmNvdW50KytcbiAgICBhZ2dyZWdhdGUudG90YWxNcyArPSBkdXJhdGlvbk1zXG4gICAgYWdncmVnYXRlLm1heE1zID0gTWF0aC5tYXgoYWdncmVnYXRlLm1heE1zLCBkdXJhdGlvbk1zKVxuICAgIGFnZ3JlZ2F0ZS5jcHVVc2VyTXMgKz0gY3B1TXMudXNlclxuICAgIGFnZ3JlZ2F0ZS5jcHVTeXN0ZW1NcyArPSBjcHVNcy5zeXN0ZW1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGFuIGV4Y2x1c2l2ZSBmaWxlLW93bmVkIHBoYXNlIHRvIHRpbWluZy1tYW5pZmVzdCB3ZWlnaHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBmaWxlUGF0aCAtIFNhZmUgcHJvamVjdC1yZWxhdGl2ZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGhhc2UgLSBQaGFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZHVyYXRpb25NcyAtIFJlYWwgZHVyYXRpb24uXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2luc2lkZUF0dGVtcHRdIC0gV2hldGhlciB0aGUgcGhhc2UgaXMgYWxyZWFkeSBjb3ZlcmVkIGJ5IGNvbXBsZXRlIGF0dGVtcHQgdGltZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRGaWxlRHVyYXRpb24oZmlsZVBhdGgsIHBoYXNlLCBkdXJhdGlvbk1zLCBpbnNpZGVBdHRlbXB0ID0gZmFsc2UpIHtcbiAgICBpZiAoIWZpbGVQYXRoKSByZXR1cm5cbiAgICBpZiAoIVtcImltcG9ydHNcIiwgXCJiZWZvcmVBbGxcIiwgXCJiZWZvcmVFYWNoXCIsIFwidGVzdCBib2R5XCIsIFwiYWZ0ZXJFYWNoXCIsIFwiYWZ0ZXJBbGxcIl0uaW5jbHVkZXMocGhhc2UpKSByZXR1cm5cblxuICAgIGxldCBmaWxlID0gdGhpcy5fZmlsZXMuZ2V0KGZpbGVQYXRoKVxuXG4gICAgaWYgKCFmaWxlKSB7XG4gICAgICBmaWxlID0ge3BhdGg6IGZpbGVQYXRoLCBpbXBvcnRNczogMCwgaG9va3NNczogMCwgdGVzdHNNczogMCwgYXR0ZW1wdHNNczogMCwgdG90YWxNczogMH1cbiAgICAgIHRoaXMuX2ZpbGVzLnNldChmaWxlUGF0aCwgZmlsZSlcbiAgICB9XG5cbiAgICBpZiAocGhhc2UgPT09IFwiaW1wb3J0c1wiKSBmaWxlLmltcG9ydE1zICs9IGR1cmF0aW9uTXNcbiAgICBpZiAocGhhc2UgPT09IFwidGVzdCBib2R5XCIpIGZpbGUudGVzdHNNcyArPSBkdXJhdGlvbk1zXG4gICAgaWYgKFtcImJlZm9yZUFsbFwiLCBcImJlZm9yZUVhY2hcIiwgXCJhZnRlckVhY2hcIiwgXCJhZnRlckFsbFwiXS5pbmNsdWRlcyhwaGFzZSkpIGZpbGUuaG9va3NNcyArPSBkdXJhdGlvbk1zXG4gICAgaWYgKCFpbnNpZGVBdHRlbXB0KSBmaWxlLnRvdGFsTXMgKz0gZHVyYXRpb25Nc1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgdGhlIGNvbXBsZXRlIGNvc3Qgb2YgYW4gYXR0ZW1wdCB0byBpdHMgb3duaW5nIGZpbGUgd2VpZ2h0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gZmlsZVBhdGggLSBTYWZlIHByb2plY3QtcmVsYXRpdmUgcGF0aC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGR1cmF0aW9uTXMgLSBBdHRlbXB0IGR1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZEZpbGVBdHRlbXB0RHVyYXRpb24oZmlsZVBhdGgsIGR1cmF0aW9uTXMpIHtcbiAgICBpZiAoIWZpbGVQYXRoKSByZXR1cm5cblxuICAgIGxldCBmaWxlID0gdGhpcy5fZmlsZXMuZ2V0KGZpbGVQYXRoKVxuXG4gICAgaWYgKCFmaWxlKSB7XG4gICAgICBmaWxlID0ge3BhdGg6IGZpbGVQYXRoLCBpbXBvcnRNczogMCwgaG9va3NNczogMCwgdGVzdHNNczogMCwgYXR0ZW1wdHNNczogMCwgdG90YWxNczogMH1cbiAgICAgIHRoaXMuX2ZpbGVzLnNldChmaWxlUGF0aCwgZmlsZSlcbiAgICB9XG5cbiAgICBmaWxlLmF0dGVtcHRzTXMgKz0gZHVyYXRpb25Nc1xuICAgIGZpbGUudG90YWxNcyArPSBkdXJhdGlvbk1zXG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlcyBwcm9jZXNzIENQVSB0aW1lIHNpbmNlIGEgc3RhcnQgc2FtcGxlLlxuICAgKiBAcGFyYW0ge1Byb2Nlc3NDcHVVc2FnZX0gc3RhcnQgLSBDUFUgc3RhcnQgc2FtcGxlLlxuICAgKiBAcmV0dXJucyB7e3VzZXI6IG51bWJlciwgc3lzdGVtOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9fSAtIE1pbGxpc2Vjb25kIENQVSBkdXJhdGlvbi5cbiAgICovXG4gIGNwdUR1cmF0aW9uKHN0YXJ0KSB7XG4gICAgY29uc3QgY3B1ID0gcHJvY2Vzcy5jcHVVc2FnZShzdGFydClcbiAgICBjb25zdCB1c2VyID0gcm91bmRQcm9maWxlRHVyYXRpb24oY3B1LnVzZXIgLyAxMDAwKVxuICAgIGNvbnN0IHN5c3RlbSA9IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGNwdS5zeXN0ZW0gLyAxMDAwKVxuXG4gICAgcmV0dXJuIHt1c2VyLCBzeXN0ZW0sIHRvdGFsOiByb3VuZFByb2ZpbGVEdXJhdGlvbih1c2VyICsgc3lzdGVtKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhbiBpbnRlcm5hbCBhZ2dyZWdhdGUgdG8gcHVibGljIHJvdW5kZWQgdmFsdWVzLlxuICAgKiBAcGFyYW0ge0ludGVybmFsUGhhc2VBZ2dyZWdhdGV9IFthZ2dyZWdhdGVdIC0gSW50ZXJuYWwgYWdncmVnYXRlLlxuICAgKiBAcmV0dXJucyB7e2NvdW50OiBudW1iZXIsIHRvdGFsTXM6IG51bWJlciwgbWF4TXM6IG51bWJlciwgY3B1TXM6IHt1c2VyOiBudW1iZXIsIHN5c3RlbTogbnVtYmVyLCB0b3RhbDogbnVtYmVyfX19IC0gUHVibGljIGFnZ3JlZ2F0ZS5cbiAgICovXG4gIHB1YmxpY0FnZ3JlZ2F0ZShhZ2dyZWdhdGUgPSB7Y291bnQ6IDAsIHRvdGFsTXM6IDAsIG1heE1zOiAwLCBjcHVVc2VyTXM6IDAsIGNwdVN5c3RlbU1zOiAwfSkge1xuICAgIGNvbnN0IHVzZXIgPSByb3VuZFByb2ZpbGVEdXJhdGlvbihhZ2dyZWdhdGUuY3B1VXNlck1zKVxuICAgIGNvbnN0IHN5c3RlbSA9IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGFnZ3JlZ2F0ZS5jcHVTeXN0ZW1NcylcblxuICAgIHJldHVybiB7XG4gICAgICBjb3VudDogYWdncmVnYXRlLmNvdW50LFxuICAgICAgdG90YWxNczogcm91bmRQcm9maWxlRHVyYXRpb24oYWdncmVnYXRlLnRvdGFsTXMpLFxuICAgICAgbWF4TXM6IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGFnZ3JlZ2F0ZS5tYXhNcyksXG4gICAgICBjcHVNczoge3VzZXIsIHN5c3RlbSwgdG90YWw6IHJvdW5kUHJvZmlsZUR1cmF0aW9uKHVzZXIgKyBzeXN0ZW0pfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGVtcHR5IHF1ZXJ5IGFnZ3JlZ2F0ZS5cbiAgICogQHJldHVybnMge1Byb2ZpbGVEYXRhYmFzZUFnZ3JlZ2F0ZX0gLSBFbXB0eSBhZ2dyZWdhdGUuXG4gICAqL1xuICBlbXB0eURhdGFiYXNlQWdncmVnYXRlKCkge1xuICAgIHJldHVybiB7cXVlcnlDb3VudDogMCwgZmFpbGVkUXVlcnlDb3VudDogMCwgdG90YWxNczogMCwgbWF4TXM6IDB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIHF1ZXJ5IGF0dGVtcHQgdG8gYSBkYXRhYmFzZSBhZ2dyZWdhdGUuXG4gICAqIEBwYXJhbSB7UHJvZmlsZURhdGFiYXNlQWdncmVnYXRlfSBhZ2dyZWdhdGUgLSBBZ2dyZWdhdGUgdG8gdXBkYXRlLlxuICAgKiBAcGFyYW0ge3tkdXJhdGlvbk1zOiBudW1iZXIsIGZhaWxlZDogYm9vbGVhbn19IGFyZ3MgLSBBdHRlbXB0IHZhbHVlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGREYXRhYmFzZVF1ZXJ5QWdncmVnYXRlKGFnZ3JlZ2F0ZSwge2R1cmF0aW9uTXMsIGZhaWxlZH0pIHtcbiAgICBhZ2dyZWdhdGUucXVlcnlDb3VudCsrXG4gICAgaWYgKGZhaWxlZCkgYWdncmVnYXRlLmZhaWxlZFF1ZXJ5Q291bnQrK1xuICAgIGFnZ3JlZ2F0ZS50b3RhbE1zICs9IGR1cmF0aW9uTXNcbiAgICBhZ2dyZWdhdGUubWF4TXMgPSBNYXRoLm1heChhZ2dyZWdhdGUubWF4TXMsIGR1cmF0aW9uTXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbiBlbXB0eSBhY3Rpb24gYWdncmVnYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvZmlsZUFjdGlvbkFnZ3JlZ2F0ZX0gLSBFbXB0eSBhZ2dyZWdhdGUuXG4gICAqL1xuICBwaGFzZUFnZ3JlZ2F0ZVNoYXBlKCkge1xuICAgIHJldHVybiB7Y291bnQ6IDAsIGZhaWxlZENvdW50OiAwLCB0b3RhbE1zOiAwLCBtYXhNczogMH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSb3VuZHMgYSB0cmFuc2FjdGlvbiBvciBwb29sIGFjdGlvbiBhZ2dyZWdhdGUuXG4gICAqIEBwYXJhbSB7UHJvZmlsZUFjdGlvbkFnZ3JlZ2F0ZX0gYWdncmVnYXRlIC0gSW50ZXJuYWwgYWdncmVnYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvZmlsZUFjdGlvbkFnZ3JlZ2F0ZX0gLSBQdWJsaWMgYWdncmVnYXRlLlxuICAgKi9cbiAgcHVibGljQWN0aW9uQWdncmVnYXRlKGFnZ3JlZ2F0ZSkge1xuICAgIHJldHVybiB7XG4gICAgICBjb3VudDogYWdncmVnYXRlLmNvdW50LFxuICAgICAgZmFpbGVkQ291bnQ6IGFnZ3JlZ2F0ZS5mYWlsZWRDb3VudCxcbiAgICAgIHRvdGFsTXM6IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGFnZ3JlZ2F0ZS50b3RhbE1zKSxcbiAgICAgIG1heE1zOiByb3VuZFByb2ZpbGVEdXJhdGlvbihhZ2dyZWdhdGUubWF4TXMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gZW1wdHkgcG9vbCBhZ2dyZWdhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbaWRlbnRpZmllcl0gLSBMb2dpY2FsIHBvb2wgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb2ZpbGVQb29sQWdncmVnYXRlfSAtIEVtcHR5IGFnZ3JlZ2F0ZS5cbiAgICovXG4gIGVtcHR5UG9vbEFnZ3JlZ2F0ZShpZGVudGlmaWVyID0gXCJcIikge1xuICAgIHJldHVybiB7XG4gICAgICBpZGVudGlmaWVyLFxuICAgICAgY29ubmVjdGlvbkNyZWF0aW9uOiB0aGlzLnBoYXNlQWdncmVnYXRlU2hhcGUoKSxcbiAgICAgIGNoZWNrb3V0V2FpdDoge2NvdW50OiAwLCB0b3RhbE1zOiAwLCBtYXhNczogMH0sXG4gICAgICBjaGVja291dFRpbWVvdXRDb3VudDogMCxcbiAgICAgIGlkbGVSZWFwOiB7Li4udGhpcy5waGFzZUFnZ3JlZ2F0ZVNoYXBlKCksIGRpc3Bvc2FsQ291bnQ6IDB9LFxuICAgICAgcGVha0xpdmVDb25uZWN0aW9uczogMFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIG9yIGNyZWF0ZXMgYSBwb29sIGFnZ3JlZ2F0ZSBpbiBhIG1hcC5cbiAgICogQHBhcmFtIHtNYXA8c3RyaW5nLCBQcm9maWxlUG9vbEFnZ3JlZ2F0ZT59IHBvb2xzIC0gUG9vbCBtYXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gTG9naWNhbCBwb29sIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9maWxlUG9vbEFnZ3JlZ2F0ZX0gLSBQb29sIGFnZ3JlZ2F0ZS5cbiAgICovXG4gIHBvb2xBZ2dyZWdhdGUocG9vbHMsIGlkZW50aWZpZXIpIHtcbiAgICBsZXQgYWdncmVnYXRlID0gcG9vbHMuZ2V0KGlkZW50aWZpZXIpXG5cbiAgICBpZiAoIWFnZ3JlZ2F0ZSkge1xuICAgICAgYWdncmVnYXRlID0gdGhpcy5lbXB0eVBvb2xBZ2dyZWdhdGUoaWRlbnRpZmllcilcbiAgICAgIHBvb2xzLnNldChpZGVudGlmaWVyLCBhZ2dyZWdhdGUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGFnZ3JlZ2F0ZVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb25lIHBvb2wgbWV0cmljIGRlbHRhLlxuICAgKiBAcGFyYW0ge1Byb2ZpbGVQb29sQWdncmVnYXRlfSBhZ2dyZWdhdGUgLSBQb29sIGFnZ3JlZ2F0ZS5cbiAgICogQHBhcmFtIHtcImNvbm5lY3Rpb25DcmVhdGlvblwiIHwgXCJjaGVja291dFdhaXRcIiB8IFwiY2hlY2tvdXRUaW1lb3V0XCIgfCBcImlkbGVSZWFwXCIgfCBcImlkbGVSZWFwRGlzcG9zYWxcIiB8IFwicGVha0xpdmVDb25uZWN0aW9uc1wifSBtZXRyaWMgLSBNZXRyaWMgbmFtZS5cbiAgICogQHBhcmFtIHt7ZHVyYXRpb25Ncz86IG51bWJlciwgZmFpbGVkPzogYm9vbGVhbiwgdmFsdWU/OiBudW1iZXJ9fSB2YWx1ZXMgLSBNZXRyaWMgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFBvb2xNZXRyaWMoYWdncmVnYXRlLCBtZXRyaWMsIHZhbHVlcykge1xuICAgIGNvbnN0IGR1cmF0aW9uTXMgPSByb3VuZFByb2ZpbGVEdXJhdGlvbih2YWx1ZXMuZHVyYXRpb25NcyA/PyAwKVxuXG4gICAgaWYgKG1ldHJpYyA9PT0gXCJjb25uZWN0aW9uQ3JlYXRpb25cIiB8fCBtZXRyaWMgPT09IFwiaWRsZVJlYXBcIikge1xuICAgICAgY29uc3QgYWN0aW9uQWdncmVnYXRlID0gbWV0cmljID09PSBcImNvbm5lY3Rpb25DcmVhdGlvblwiID8gYWdncmVnYXRlLmNvbm5lY3Rpb25DcmVhdGlvbiA6IGFnZ3JlZ2F0ZS5pZGxlUmVhcFxuXG4gICAgICBhY3Rpb25BZ2dyZWdhdGUuY291bnQrK1xuICAgICAgaWYgKHZhbHVlcy5mYWlsZWQpIGFjdGlvbkFnZ3JlZ2F0ZS5mYWlsZWRDb3VudCsrXG4gICAgICBhY3Rpb25BZ2dyZWdhdGUudG90YWxNcyArPSBkdXJhdGlvbk1zXG4gICAgICBhY3Rpb25BZ2dyZWdhdGUubWF4TXMgPSBNYXRoLm1heChhY3Rpb25BZ2dyZWdhdGUubWF4TXMsIGR1cmF0aW9uTXMpXG4gICAgfSBlbHNlIGlmIChtZXRyaWMgPT09IFwiY2hlY2tvdXRXYWl0XCIpIHtcbiAgICAgIGFnZ3JlZ2F0ZS5jaGVja291dFdhaXQuY291bnQrK1xuICAgICAgYWdncmVnYXRlLmNoZWNrb3V0V2FpdC50b3RhbE1zICs9IGR1cmF0aW9uTXNcbiAgICAgIGFnZ3JlZ2F0ZS5jaGVja291dFdhaXQubWF4TXMgPSBNYXRoLm1heChhZ2dyZWdhdGUuY2hlY2tvdXRXYWl0Lm1heE1zLCBkdXJhdGlvbk1zKVxuICAgIH0gZWxzZSBpZiAobWV0cmljID09PSBcImNoZWNrb3V0VGltZW91dFwiKSB7XG4gICAgICBhZ2dyZWdhdGUuY2hlY2tvdXRUaW1lb3V0Q291bnQrK1xuICAgIH0gZWxzZSBpZiAobWV0cmljID09PSBcImlkbGVSZWFwRGlzcG9zYWxcIikge1xuICAgICAgYWdncmVnYXRlLmlkbGVSZWFwLmRpc3Bvc2FsQ291bnQrK1xuICAgIH0gZWxzZSBpZiAobWV0cmljID09PSBcInBlYWtMaXZlQ29ubmVjdGlvbnNcIikge1xuICAgICAgYWdncmVnYXRlLnBlYWtMaXZlQ29ubmVjdGlvbnMgPSBNYXRoLm1heChhZ2dyZWdhdGUucGVha0xpdmVDb25uZWN0aW9ucywgdmFsdWVzLnZhbHVlID8/IDApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJvdW5kcyBhIHBvb2wgYWdncmVnYXRlIGZvciBvdXRwdXQuXG4gICAqIEBwYXJhbSB7UHJvZmlsZVBvb2xBZ2dyZWdhdGV9IGFnZ3JlZ2F0ZSAtIEludGVybmFsIGFnZ3JlZ2F0ZS5cbiAgICogQHJldHVybnMge1Byb2ZpbGVQb29sQWdncmVnYXRlfSAtIFB1YmxpYyBhZ2dyZWdhdGUuXG4gICAqL1xuICBwdWJsaWNQb29sQWdncmVnYXRlKGFnZ3JlZ2F0ZSkge1xuICAgIHJldHVybiB7XG4gICAgICBpZGVudGlmaWVyOiBhZ2dyZWdhdGUuaWRlbnRpZmllcixcbiAgICAgIGNvbm5lY3Rpb25DcmVhdGlvbjogdGhpcy5wdWJsaWNBY3Rpb25BZ2dyZWdhdGUoYWdncmVnYXRlLmNvbm5lY3Rpb25DcmVhdGlvbiksXG4gICAgICBjaGVja291dFdhaXQ6IHtcbiAgICAgICAgY291bnQ6IGFnZ3JlZ2F0ZS5jaGVja291dFdhaXQuY291bnQsXG4gICAgICAgIHRvdGFsTXM6IHJvdW5kUHJvZmlsZUR1cmF0aW9uKGFnZ3JlZ2F0ZS5jaGVja291dFdhaXQudG90YWxNcyksXG4gICAgICAgIG1heE1zOiByb3VuZFByb2ZpbGVEdXJhdGlvbihhZ2dyZWdhdGUuY2hlY2tvdXRXYWl0Lm1heE1zKVxuICAgICAgfSxcbiAgICAgIGNoZWNrb3V0VGltZW91dENvdW50OiBhZ2dyZWdhdGUuY2hlY2tvdXRUaW1lb3V0Q291bnQsXG4gICAgICBpZGxlUmVhcDoge1xuICAgICAgICAuLi50aGlzLnB1YmxpY0FjdGlvbkFnZ3JlZ2F0ZShhZ2dyZWdhdGUuaWRsZVJlYXApLFxuICAgICAgICBkaXNwb3NhbENvdW50OiBhZ2dyZWdhdGUuaWRsZVJlYXAuZGlzcG9zYWxDb3VudFxuICAgICAgfSxcbiAgICAgIHBlYWtMaXZlQ29ubmVjdGlvbnM6IGFnZ3JlZ2F0ZS5wZWFrTGl2ZUNvbm5lY3Rpb25zXG4gICAgfVxuICB9XG59XG4iXX0=
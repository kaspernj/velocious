// @ts-check
import { createHash } from "node:crypto";
import wait from "awaitery/build/wait.js";
import fs from "fs/promises";
import os from "node:os";
import path from "node:path";
import query from "./query.js";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import Base from "./base.js";
import fileExists from "../../../utils/file-exists.js";
export default class VelociousDatabaseDriversSqliteNode extends Base {
    /**
     * Connection.
     * @type {import("sqlite").Database | undefined} */
    connection = undefined;
    /**
     * Advisory lock directory.
     * @type {string | undefined} */
    _advisoryLockDirectory = undefined;
    async connect() {
        const args = this.getArgs();
        const databaseDir = `${this.getConfiguration().getDirectory()}/db`;
        const databasePath = this.databasePath();
        if (!await fileExists(databaseDir)) {
            await fs.mkdir(databaseDir, { recursive: true });
        }
        if (args.reset) {
            await fs.unlink(databasePath);
        }
        this._advisoryLockDirectory = path.join(databaseDir, `${this.localStorageName()}.velocious-advisory-locks`);
        try {
            this.connection = await open({
                filename: databasePath,
                driver: sqlite3.Database
            });
        }
        catch (error) {
            if (error instanceof Error) {
                throw new Error(`Couldn't open database ${databasePath} because of ${error.constructor.name}: ${error.message}`, { cause: error });
            }
            else {
                throw new Error(`Couldn't open database ${databasePath} because of ${typeof error}: ${error}`, { cause: error });
            }
        }
        await this.registerVersion();
    }
    localStorageName() {
        const args = this.getArgs();
        if (!args.name)
            throw new Error("No name given for SQLite Node");
        return `VelociousDatabaseDriversSqlite---${args.name}`;
    }
    databasePath() {
        return `${this.getConfiguration().getDirectory()}/db/${this.localStorageName()}.sqlite`;
    }
    async _close() {
        await this.connection?.close();
        this.connection = undefined;
    }
    async deleteDatabaseStorage() {
        for (const suffix of ["", "-wal", "-shm", "-journal"]) {
            try {
                await fs.unlink(`${this.databasePath()}${suffix}`);
            }
            catch (error) {
                if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
                    throw error;
            }
        }
    }
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @param {import("../base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the query actual.
     */
    async _queryActual(sql, options = {}) {
        if (!this.connection)
            throw new Error("No connection");
        if (options.sqliteScript) {
            await this.connection.exec(sql);
            return [];
        }
        return await query(this.connection, sql);
    }
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    async _affectedRowsActual(sql) {
        if (!this.connection)
            throw new Error("No connection");
        const result = await this.connection.run(sql);
        return result.changes || 0;
    }
    /**
     * Layers a filesystem lock directory on top of the in-process waiter
     * queue so SQLite deployments with multiple Node processes writing to
     * the same database file see consistent advisory-lock mutual exclusion
     * across processes, not just within a single process.
     *
     * The in-process queue from the shared SQLite base class is still used
     * for the fast intra-process path (no polling, waiters wake each other
     * through the `Set<string>` + waiter queue); the filesystem lock is
     * only checked once the in-process queue has granted the caller, so
     * typical single-process traffic pays at most two `fs.mkdir` calls
     * (create and remove) per critical section.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
     * @returns {Promise<boolean>} - Whether the advisory lock was acquired.
     */
    async _acquireAdvisoryLock(name, { timeoutMs } = {}) {
        const deadline = typeof timeoutMs === "number" && timeoutMs >= 0 ? Date.now() + timeoutMs : null;
        const remainingForInProcess = deadline !== null ? Math.max(0, deadline - Date.now()) : null;
        const inProcessAcquired = await super._acquireAdvisoryLock(name, { timeoutMs: remainingForInProcess });
        if (!inProcessAcquired)
            return false;
        try {
            const remainingForFile = deadline !== null ? Math.max(0, deadline - Date.now()) : null;
            const fileAcquired = await this._acquireAdvisoryLockFile(name, { timeoutMs: remainingForFile });
            if (!fileAcquired) {
                await super._releaseAdvisoryLock(name);
                return false;
            }
        }
        catch (error) {
            await super._releaseAdvisoryLock(name);
            throw error;
        }
        return true;
    }
    /**
     * Runs try acquire advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock was acquired immediately.
     */
    async _tryAcquireAdvisoryLock(name) {
        const inProcessAcquired = await super._tryAcquireAdvisoryLock(name);
        if (!inProcessAcquired)
            return false;
        try {
            const fileAcquired = await this._tryAcquireAdvisoryLockFile(name);
            if (!fileAcquired) {
                await super._releaseAdvisoryLock(name);
                return false;
            }
        }
        catch (error) {
            await super._releaseAdvisoryLock(name);
            throw error;
        }
        return true;
    }
    /**
     * Releases the lock only if **this** driver instance acquired it, both
     * in the shared in-process owner table and in the on-disk lock
     * directory. A caller that tries to release a lock it never acquired
     * (or that was already released by another driver) gets `false` back
     * and the filesystem state is left alone so we never delete somebody
     * else's lock directory.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock was released.
     */
    async _releaseAdvisoryLock(name) {
        const inProcessReleased = await super._releaseAdvisoryLock(name);
        if (inProcessReleased) {
            await this._releaseAdvisoryLockFile(name);
        }
        return inProcessReleased;
    }
    /**
     * Runs is advisory lock held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock is held.
     */
    async isAdvisoryLockHeld(name) {
        if (await super.isAdvisoryLockHeld(name))
            return true;
        return await this._isAdvisoryLockFileHeld(name);
    }
    /**
     * The Node SQLite driver layers the opt-in file tier on top of the
     * process-local pre-filter, so telemetry reports it as `file`.
     * @returns {string} - Tier name reported on telemetry payloads.
     */
    advisoryLockBackendTier() {
        return "file";
    }
    /**
     * Attribute the named lock to the file-tier owner recorded in
     * `owner.json` (`pid@hostname`), captured at the telemetry event moment
     * (best-effort; the caller guards failures). Falls back to the
     * process-local owner when the filesystem lock is not the holder.
     * @param {string} name - Lock name.
     * @returns {Promise<string | null>} - File lock owner identity, or null when no process holds the lock.
     */
    async advisoryLockHolderConnectionId(name) {
        const lockPath = this._advisoryLockPath(name);
        try {
            const content = await fs.readFile(path.join(lockPath, "owner.json"), "utf8");
            const owner = JSON.parse(content);
            if (owner && typeof owner.pid === "number" && typeof owner.hostname === "string")
                return `${owner.pid}@${owner.hostname}`;
        }
        catch {
            // No file lock directory or unreadable metadata: fall through to the
            // in-process owner below.
        }
        return await super.advisoryLockHolderConnectionId(name);
    }
    /**
     * Runs resolve advisory lock directory.
     * @returns {string} - The advisory-lock directory.
     */
    _resolveAdvisoryLockDirectory() {
        if (!this._advisoryLockDirectory) {
            // Fall back to deriving the directory for callers that invoked
            // advisory lock methods before `connect()` wired the field in.
            const databaseDir = `${this.getConfiguration().getDirectory()}/db`;
            this._advisoryLockDirectory = path.join(databaseDir, `${this.localStorageName()}.velocious-advisory-locks`);
        }
        return this._advisoryLockDirectory;
    }
    /**
     * Runs advisory lock path.
     * @param {string} name - Lock name.
     * @returns {string} - Filesystem path for the advisory lock.
     */
    _advisoryLockPath(name) {
        const hash = createHash("sha256").update(name).digest("hex").slice(0, 16);
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
        return path.join(this._resolveAdvisoryLockDirectory(), `${safeName}-${hash}.lock`);
    }
    /**
     * Runs ensure advisory lock directory.
     * @returns {Promise<void>} */
    async _ensureAdvisoryLockDirectory() {
        await fs.mkdir(this._resolveAdvisoryLockDirectory(), { recursive: true });
    }
    /**
     * Runs write advisory lock metadata.
     * @param {string} lockDirPath - Absolute path of the lock directory.
     * @returns {Promise<void>}
     */
    async _writeAdvisoryLockMetadata(lockDirPath) {
        const ownerPath = path.join(lockDirPath, "owner.json");
        const payload = JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            acquiredAt: new Date().toISOString()
        });
        await fs.writeFile(ownerPath, payload);
    }
    /**
     * Publishes a fully initialized lock directory with one atomic rename.
     * A losing candidate is removed in the same call, so concurrent acquisition
     * cannot observe or delete another process's half-written owner metadata.
     * @param {string} lockPath - Stable advisory-lock path.
     * @returns {Promise<boolean>} - Whether this candidate became the lock owner.
     */
    async _publishAdvisoryLockDirectory(lockPath) {
        const candidatePath = await fs.mkdtemp(`${lockPath}.pending-`);
        let published = false;
        try {
            await this._writeAdvisoryLockMetadata(candidatePath);
            try {
                await fs.rename(candidatePath, lockPath);
                published = true;
                return true;
            }
            catch (error) {
                const code = /** @type {Error & {code?: string}} */ (error)?.code;
                if (code === "EEXIST" || code === "ENOTEMPTY")
                    return false;
                throw error;
            }
        }
        finally {
            if (!published)
                await fs.rm(candidatePath, { force: true, recursive: true });
        }
    }
    /**
     * Runs acquire advisory lock file.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} args - Timeout args.
     * @returns {Promise<boolean>} - Whether the advisory-lock file was acquired.
     */
    async _acquireAdvisoryLockFile(name, { timeoutMs }) {
        await this._ensureAdvisoryLockDirectory();
        const lockPath = this._advisoryLockPath(name);
        const deadline = typeof timeoutMs === "number" && timeoutMs >= 0 ? Date.now() + timeoutMs : null;
        const pollIntervalMs = 50;
        // Intentionally looping without a fixed iteration cap — either the
        // mkdir succeeds, the deadline elapses, or an unexpected error is
        // re-thrown.
        while (true) {
            if (await this._publishAdvisoryLockDirectory(lockPath))
                return true;
            if (await this._isAdvisoryLockStale(lockPath)) {
                await fs.rm(lockPath, { recursive: true, force: true });
                continue;
            }
            if (deadline !== null) {
                const remaining = deadline - Date.now();
                if (remaining <= 0)
                    return false;
                await wait(Math.min(pollIntervalMs, remaining));
            }
            else {
                await wait(pollIntervalMs);
            }
        }
    }
    /**
     * Runs try acquire advisory lock file.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory-lock file was acquired immediately.
     */
    async _tryAcquireAdvisoryLockFile(name) {
        await this._ensureAdvisoryLockDirectory();
        const lockPath = this._advisoryLockPath(name);
        if (await this._publishAdvisoryLockDirectory(lockPath))
            return true;
        if (await this._isAdvisoryLockStale(lockPath)) {
            await fs.rm(lockPath, { recursive: true, force: true });
            return await this._publishAdvisoryLockDirectory(lockPath);
        }
        return false;
    }
    /**
     * Runs release advisory lock file.
     * @param {string} name - Lock name.
     * @returns {Promise<void>}
     */
    async _releaseAdvisoryLockFile(name) {
        const lockPath = this._advisoryLockPath(name);
        try {
            await fs.rm(lockPath, { recursive: true, force: true });
        }
        catch {
            // Best-effort release; in-process state is still authoritative and
            // stale-lock cleanup on the next acquire will remove the directory
            // if it really is still lingering.
        }
    }
    /**
     * Runs is advisory lock file held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory-lock file exists and is active.
     */
    async _isAdvisoryLockFileHeld(name) {
        const lockPath = this._advisoryLockPath(name);
        try {
            await fs.stat(lockPath);
        }
        catch {
            return false;
        }
        return !await this._isAdvisoryLockStale(lockPath);
    }
    /**
     * A lock directory is considered stale when its owner metadata names a
     * PID on this host that is no longer running. Cross-host ownership (a
     * different `hostname`) is treated as live because we cannot reliably
     * probe a PID on another machine; operators in that situation should
     * remove stale lock directories by hand if they linger.
     * @param {string} lockPath - Absolute path of the lock directory.
     * @returns {Promise<boolean>} - Whether the advisory-lock file is stale.
     */
    async _isAdvisoryLockStale(lockPath) {
        /**
         * Defines rawOwner.
         * @type {string} */
        let rawOwner;
        try {
            rawOwner = await fs.readFile(path.join(lockPath, "owner.json"), "utf8");
        }
        catch {
            // Missing or unreadable metadata — treat as stale so we can reclaim.
            return true;
        }
        /**
         * Defines owner.
         * @type {{pid?: number, hostname?: string}} */
        let owner;
        try {
            owner = JSON.parse(rawOwner);
        }
        catch {
            return true;
        }
        if (!owner || typeof owner.pid !== "number")
            return true;
        if (owner.hostname && owner.hostname !== os.hostname())
            return false;
        try {
            // `kill(pid, 0)` is a no-op signal that fails with ESRCH if the
            // process is not running; permission errors still indicate the
            // process exists so we treat those as "not stale".
            process.kill(owner.pid, 0);
            return false;
        }
        catch (error) {
            return /** @type {Error & {code?: string}} */ (error)?.code === "ESRCH";
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDdEMsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUN4QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sT0FBTyxNQUFNLFNBQVMsQ0FBQTtBQUM3QixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sUUFBUSxDQUFBO0FBRTNCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLFVBQVUsTUFBTSwrQkFBK0IsQ0FBQTtBQUV0RCxNQUFNLENBQUMsT0FBTyxPQUFPLGtDQUFtQyxTQUFRLElBQUk7SUFDbEU7O3VEQUVtRDtJQUNuRCxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRXRCOztvQ0FFZ0M7SUFDaEMsc0JBQXNCLEdBQUcsU0FBUyxDQUFBO0lBRWxDLEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzNCLE1BQU0sV0FBVyxHQUFHLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQTtRQUNsRSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7UUFFeEMsSUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDbkMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJ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QyxRQUFRLEtBQUssRUFBRSxDQUFDLFFBQVEsRUFBRTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXBFLElBQUksQ0FBQztZQUNILGdFQUFnRTtZQUNoRSwrREFBK0Q7WUFDL0QsbURBQW1EO1lBQ25ELE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQTtZQUUxQixPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxzQ0FBc0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxFQUFFLElBQUksS0FBSyxPQUFPLENBQUE7UUFDekUsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZUhhc2h9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgd2FpdCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvd2FpdC5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCBvcyBmcm9tIFwibm9kZTpvc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCJcbmltcG9ydCBxdWVyeSBmcm9tIFwiLi9xdWVyeS5qc1wiXG5pbXBvcnQgc3FsaXRlMyBmcm9tIFwic3FsaXRlM1wiXG5pbXBvcnQge29wZW59IGZyb20gXCJzcWxpdGVcIlxuXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCBmaWxlRXhpc3RzIGZyb20gXCIuLi8uLi8uLi91dGlscy9maWxlLWV4aXN0cy5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZU5vZGUgZXh0ZW5kcyBCYXNlIHtcbiAgLyoqXG4gICAqIENvbm5lY3Rpb24uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCJzcWxpdGVcIikuRGF0YWJhc2UgfCB1bmRlZmluZWR9ICovXG4gIGNvbm5lY3Rpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogQWR2aXNvcnkgbG9jayBkaXJlY3RvcnkuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9hZHZpc29yeUxvY2tEaXJlY3RvcnkgPSB1bmRlZmluZWRcblxuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IGRhdGFiYXNlRGlyID0gYCR7dGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGlyZWN0b3J5KCl9L2RiYFxuICAgIGNvbnN0IGRhdGFiYXNlUGF0aCA9IHRoaXMuZGF0YWJhc2VQYXRoKClcblxuICAgIGlmICghYXdhaXQgZmlsZUV4aXN0cyhkYXRhYmFzZURpcikpIHtcbiAgICAgIGF3YWl0IGZzLm1rZGlyKGRhdGFiYXNlRGlyLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgICB9XG5cbiAgICBpZiAoYXJncy5yZXNldCkge1xuICAgICAgYXdhaXQgZnMudW5saW5rKGRhdGFiYXNlUGF0aClcbiAgICB9XG5cbiAgICB0aGlzLl9hZHZpc29yeUxvY2tEaXJlY3RvcnkgPSBwYXRoLmpvaW4oZGF0YWJhc2VEaXIsIGAke3RoaXMubG9jYWxTdG9yYWdlTmFtZSgpfS52ZWxvY2lvdXMtYWR2aXNvcnktbG9ja3NgKVxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuY29ubmVjdGlvbiA9IGF3YWl0IG9wZW4oe1xuICAgICAgICBmaWxlbmFtZTogZGF0YWJhc2VQYXRoLFxuICAgICAgICBkcml2ZXI6IHNxbGl0ZTMuRGF0YWJhc2VcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3Qgb3BlbiBkYXRhYmFzZSAke2RhdGFiYXNlUGF0aH0gYmVjYXVzZSBvZiAke2Vycm9yLmNvbnN0cnVjdG9yLm5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IG9wZW4gZGF0YWJhc2UgJHtkYXRhYmFzZVBhdGh9IGJlY2F1c2Ugb2YgJHt0eXBlb2YgZXJyb3J9OiAke2Vycm9yfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJWZXJzaW9uKClcbiAgfVxuXG4gIGxvY2FsU3RvcmFnZU5hbWUoKSB7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG5cbiAgICBpZiAoIWFyZ3MubmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gbmFtZSBnaXZlbiBmb3IgU1FMaXRlIE5vZGVcIilcblxuICAgIHJldHVybiBgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlLS0tJHthcmdzLm5hbWV9YFxuICB9XG5cbiAgZGF0YWJhc2VQYXRoKCkge1xuICAgIHJldHVybiBgJHt0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREaXJlY3RvcnkoKX0vZGIvJHt0aGlzLmxvY2FsU3RvcmFnZU5hbWUoKX0uc3FsaXRlYFxuICB9XG5cbiAgYXN5bmMgX2Nsb3NlKCkge1xuICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbj8uY2xvc2UoKVxuICAgIHRoaXMuY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICB9XG5cbiAgYXN5bmMgZGVsZXRlRGF0YWJhc2VTdG9yYWdlKCkge1xuICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIFtcIlwiLCBcIi13YWxcIiwgXCItc2htXCIsIFwiLWpvdXJuYWxcIl0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZzLnVubGluayhgJHt0aGlzLmRhdGFiYXNlUGF0aCgpfSR7c3VmZml4fWApXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIFwiY29kZVwiIGluIGVycm9yICYmIGVycm9yLmNvZGUgPT09IFwiRU5PRU5UXCIpKSB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeSBhY3R1YWwuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29ubmVjdGlvblwiKVxuXG4gICAgaWYgKG9wdGlvbnMuc3FsaXRlU2NyaXB0KSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24uZXhlYyhzcWwpXG4gICAgICByZXR1cm4gW11cbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkodGhpcy5jb25uZWN0aW9uLCBzcWwpXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiB3aXRoIGFmZmVjdGVkLXJvdyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkge1xuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25uZWN0aW9uXCIpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb25uZWN0aW9uLnJ1bihzcWwpXG4gICAgcmV0dXJuIHJlc3VsdC5jaGFuZ2VzIHx8IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBMYXllcnMgYSBmaWxlc3lzdGVtIGxvY2sgZGlyZWN0b3J5IG9uIHRvcCBvZiB0aGUgaW4tcHJvY2VzcyB3YWl0ZXJcbiAgICogcXVldWUgc28gU1FMaXRlIGRlcGxveW1lbnRzIHdpdGggbXVsdGlwbGUgTm9kZSBwcm9jZXNzZXMgd3JpdGluZyB0b1xuICAgKiB0aGUgc2FtZSBkYXRhYmFzZSBmaWxlIHNlZSBjb25zaXN0ZW50IGFkdmlzb3J5LWxvY2sgbXV0dWFsIGV4Y2x1c2lvblxuICAgKiBhY3Jvc3MgcHJvY2Vzc2VzLCBub3QganVzdCB3aXRoaW4gYSBzaW5nbGUgcHJvY2Vzcy5cbiAgICpcbiAgICogVGhlIGluLXByb2Nlc3MgcXVldWUgZnJvbSB0aGUgc2hhcmVkIFNRTGl0ZSBiYXNlIGNsYXNzIGlzIHN0aWxsIHVzZWRcbiAgICogZm9yIHRoZSBmYXN0IGludHJhLXByb2Nlc3MgcGF0aCAobm8gcG9sbGluZywgd2FpdGVycyB3YWtlIGVhY2ggb3RoZXJcbiAgICogdGhyb3VnaCB0aGUgYFNldDxzdHJpbmc+YCArIHdhaXRlciBxdWV1ZSk7IHRoZSBmaWxlc3lzdGVtIGxvY2sgaXNcbiAgICogb25seSBjaGVja2VkIG9uY2UgdGhlIGluLXByb2Nlc3MgcXVldWUgaGFzIGdyYW50ZWQgdGhlIGNhbGxlciwgc29cbiAgICogdHlwaWNhbCBzaW5nbGUtcHJvY2VzcyB0cmFmZmljIHBheXMgYXQgbW9zdCB0d28gYGZzLm1rZGlyYCBjYWxsc1xuICAgKiAoY3JlYXRlIGFuZCByZW1vdmUpIHBlciBjcml0aWNhbCBzZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyBgbnVsbGAsIGB1bmRlZmluZWRgLCBvciBuZWdhdGl2ZSBibG9ja3MgZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnkgbG9jayB3YXMgYWNxdWlyZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3QgZGVhZGxpbmUgPSB0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwID8gRGF0ZS5ub3coKSArIHRpbWVvdXRNcyA6IG51bGxcbiAgICBjb25zdCByZW1haW5pbmdGb3JJblByb2Nlc3MgPSBkZWFkbGluZSAhPT0gbnVsbCA/IE1hdGgubWF4KDAsIGRlYWRsaW5lIC0gRGF0ZS5ub3coKSkgOiBudWxsXG4gICAgY29uc3QgaW5Qcm9jZXNzQWNxdWlyZWQgPSBhd2FpdCBzdXBlci5fYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zOiByZW1haW5pbmdGb3JJblByb2Nlc3N9KVxuXG4gICAgaWYgKCFpblByb2Nlc3NBY3F1aXJlZCkgcmV0dXJuIGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVtYWluaW5nRm9yRmlsZSA9IGRlYWRsaW5lICE9PSBudWxsID8gTWF0aC5tYXgoMCwgZGVhZGxpbmUgLSBEYXRlLm5vdygpKSA6IG51bGxcbiAgICAgIGNvbnN0IGZpbGVBY3F1aXJlZCA9IGF3YWl0IHRoaXMuX2FjcXVpcmVBZHZpc29yeUxvY2tGaWxlKG5hbWUsIHt0aW1lb3V0TXM6IHJlbWFpbmluZ0ZvckZpbGV9KVxuXG4gICAgICBpZiAoIWZpbGVBY3F1aXJlZCkge1xuICAgICAgICBhd2FpdCBzdXBlci5fcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKVxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgc3VwZXIuX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyeSBhY3F1aXJlIGFkdmlzb3J5IGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeSBsb2NrIHdhcyBhY3F1aXJlZCBpbW1lZGlhdGVseS5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBpblByb2Nlc3NBY3F1aXJlZCA9IGF3YWl0IHN1cGVyLl90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICBpZiAoIWluUHJvY2Vzc0FjcXVpcmVkKSByZXR1cm4gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBmaWxlQWNxdWlyZWQgPSBhd2FpdCB0aGlzLl90cnlBY3F1aXJlQWR2aXNvcnlMb2NrRmlsZShuYW1lKVxuXG4gICAgICBpZiAoIWZpbGVBY3F1aXJlZCkge1xuICAgICAgICBhd2FpdCBzdXBlci5fcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKVxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgc3VwZXIuX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGUgbG9jayBvbmx5IGlmICoqdGhpcyoqIGRyaXZlciBpbnN0YW5jZSBhY3F1aXJlZCBpdCwgYm90aFxuICAgKiBpbiB0aGUgc2hhcmVkIGluLXByb2Nlc3Mgb3duZXIgdGFibGUgYW5kIGluIHRoZSBvbi1kaXNrIGxvY2tcbiAgICogZGlyZWN0b3J5LiBBIGNhbGxlciB0aGF0IHRyaWVzIHRvIHJlbGVhc2UgYSBsb2NrIGl0IG5ldmVyIGFjcXVpcmVkXG4gICAqIChvciB0aGF0IHdhcyBhbHJlYWR5IHJlbGVhc2VkIGJ5IGFub3RoZXIgZHJpdmVyKSBnZXRzIGBmYWxzZWAgYmFja1xuICAgKiBhbmQgdGhlIGZpbGVzeXN0ZW0gc3RhdGUgaXMgbGVmdCBhbG9uZSBzbyB3ZSBuZXZlciBkZWxldGUgc29tZWJvZHlcbiAgICogZWxzZSdzIGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnkgbG9jayB3YXMgcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3QgaW5Qcm9jZXNzUmVsZWFzZWQgPSBhd2FpdCBzdXBlci5fcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgaWYgKGluUHJvY2Vzc1JlbGVhc2VkKSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQWR2aXNvcnlMb2NrRmlsZShuYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBpblByb2Nlc3NSZWxlYXNlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgYWR2aXNvcnkgbG9jayBoZWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnkgbG9jayBpcyBoZWxkLlxuICAgKi9cbiAgYXN5bmMgaXNBZHZpc29yeUxvY2tIZWxkKG5hbWUpIHtcbiAgICBpZiAoYXdhaXQgc3VwZXIuaXNBZHZpc29yeUxvY2tIZWxkKG5hbWUpKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2lzQWR2aXNvcnlMb2NrRmlsZUhlbGQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgTm9kZSBTUUxpdGUgZHJpdmVyIGxheWVycyB0aGUgb3B0LWluIGZpbGUgdGllciBvbiB0b3Agb2YgdGhlXG4gICAqIHByb2Nlc3MtbG9jYWwgcHJlLWZpbHRlciwgc28gdGVsZW1ldHJ5IHJlcG9ydHMgaXQgYXMgYGZpbGVgLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRpZXIgbmFtZSByZXBvcnRlZCBvbiB0ZWxlbWV0cnkgcGF5bG9hZHMuXG4gICAqL1xuICBhZHZpc29yeUxvY2tCYWNrZW5kVGllcigpIHtcbiAgICByZXR1cm4gXCJmaWxlXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGUgdGhlIG5hbWVkIGxvY2sgdG8gdGhlIGZpbGUtdGllciBvd25lciByZWNvcmRlZCBpblxuICAgKiBgb3duZXIuanNvbmAgKGBwaWRAaG9zdG5hbWVgKSwgY2FwdHVyZWQgYXQgdGhlIHRlbGVtZXRyeSBldmVudCBtb21lbnRcbiAgICogKGJlc3QtZWZmb3J0OyB0aGUgY2FsbGVyIGd1YXJkcyBmYWlsdXJlcykuIEZhbGxzIGJhY2sgdG8gdGhlXG4gICAqIHByb2Nlc3MtbG9jYWwgb3duZXIgd2hlbiB0aGUgZmlsZXN5c3RlbSBsb2NrIGlzIG5vdCB0aGUgaG9sZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gRmlsZSBsb2NrIG93bmVyIGlkZW50aXR5LCBvciBudWxsIHdoZW4gbm8gcHJvY2VzcyBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIGFzeW5jIGFkdmlzb3J5TG9ja0hvbGRlckNvbm5lY3Rpb25JZChuYW1lKSB7XG4gICAgY29uc3QgbG9ja1BhdGggPSB0aGlzLl9hZHZpc29yeUxvY2tQYXRoKG5hbWUpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKHBhdGguam9pbihsb2NrUGF0aCwgXCJvd25lci5qc29uXCIpLCBcInV0ZjhcIilcbiAgICAgIGNvbnN0IG93bmVyID0gSlNPTi5wYXJzZShjb250ZW50KVxuXG4gICAgICBpZiAob3duZXIgJiYgdHlwZW9mIG93bmVyLnBpZCA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2Ygb3duZXIuaG9zdG5hbWUgPT09IFwic3RyaW5nXCIpIHJldHVybiBgJHtvd25lci5waWR9QCR7b3duZXIuaG9zdG5hbWV9YFxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTm8gZmlsZSBsb2NrIGRpcmVjdG9yeSBvciB1bnJlYWRhYmxlIG1ldGFkYXRhOiBmYWxsIHRocm91Z2ggdG8gdGhlXG4gICAgICAvLyBpbi1wcm9jZXNzIG93bmVyIGJlbG93LlxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBzdXBlci5hZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYWR2aXNvcnkgbG9jayBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGFkdmlzb3J5LWxvY2sgZGlyZWN0b3J5LlxuICAgKi9cbiAgX3Jlc29sdmVBZHZpc29yeUxvY2tEaXJlY3RvcnkoKSB7XG4gICAgaWYgKCF0aGlzLl9hZHZpc29yeUxvY2tEaXJlY3RvcnkpIHtcbiAgICAgIC8vIEZhbGwgYmFjayB0byBkZXJpdmluZyB0aGUgZGlyZWN0b3J5IGZvciBjYWxsZXJzIHRoYXQgaW52b2tlZFxuICAgICAgLy8gYWR2aXNvcnkgbG9jayBtZXRob2RzIGJlZm9yZSBgY29ubmVjdCgpYCB3aXJlZCB0aGUgZmllbGQgaW4uXG4gICAgICBjb25zdCBkYXRhYmFzZURpciA9IGAke3RoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERpcmVjdG9yeSgpfS9kYmBcblxuICAgICAgdGhpcy5fYWR2aXNvcnlMb2NrRGlyZWN0b3J5ID0gcGF0aC5qb2luKGRhdGFiYXNlRGlyLCBgJHt0aGlzLmxvY2FsU3RvcmFnZU5hbWUoKX0udmVsb2Npb3VzLWFkdmlzb3J5LWxvY2tzYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYWR2aXNvcnlMb2NrRGlyZWN0b3J5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZHZpc29yeSBsb2NrIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZpbGVzeXN0ZW0gcGF0aCBmb3IgdGhlIGFkdmlzb3J5IGxvY2suXG4gICAqL1xuICBfYWR2aXNvcnlMb2NrUGF0aChuYW1lKSB7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKG5hbWUpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNilcbiAgICBjb25zdCBzYWZlTmFtZSA9IG5hbWUucmVwbGFjZSgvW15hLXpBLVowLTkuXy1dL2csIFwiX1wiKS5zbGljZSgwLCA2NClcblxuICAgIHJldHVybiBwYXRoLmpvaW4odGhpcy5fcmVzb2x2ZUFkdmlzb3J5TG9ja0RpcmVjdG9yeSgpLCBgJHtzYWZlTmFtZX0tJHtoYXNofS5sb2NrYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBhZHZpc29yeSBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9lbnN1cmVBZHZpc29yeUxvY2tEaXJlY3RvcnkoKSB7XG4gICAgYXdhaXQgZnMubWtkaXIodGhpcy5fcmVzb2x2ZUFkdmlzb3J5TG9ja0RpcmVjdG9yeSgpLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdyaXRlIGFkdmlzb3J5IGxvY2sgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NrRGlyUGF0aCAtIEFic29sdXRlIHBhdGggb2YgdGhlIGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF93cml0ZUFkdmlzb3J5TG9ja01ldGFkYXRhKGxvY2tEaXJQYXRoKSB7XG4gICAgY29uc3Qgb3duZXJQYXRoID0gcGF0aC5qb2luKGxvY2tEaXJQYXRoLCBcIm93bmVyLmpzb25cIilcbiAgICBjb25zdCBwYXlsb2FkID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgcGlkOiBwcm9jZXNzLnBpZCxcbiAgICAgIGhvc3RuYW1lOiBvcy5ob3N0bmFtZSgpLFxuICAgICAgYWNxdWlyZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgfSlcblxuICAgIGF3YWl0IGZzLndyaXRlRmlsZShvd25lclBhdGgsIHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaGVzIGEgZnVsbHkgaW5pdGlhbGl6ZWQgbG9jayBkaXJlY3Rvcnkgd2l0aCBvbmUgYXRvbWljIHJlbmFtZS5cbiAgICogQSBsb3NpbmcgY2FuZGlkYXRlIGlzIHJlbW92ZWQgaW4gdGhlIHNhbWUgY2FsbCwgc28gY29uY3VycmVudCBhY3F1aXNpdGlvblxuICAgKiBjYW5ub3Qgb2JzZXJ2ZSBvciBkZWxldGUgYW5vdGhlciBwcm9jZXNzJ3MgaGFsZi13cml0dGVuIG93bmVyIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9ja1BhdGggLSBTdGFibGUgYWR2aXNvcnktbG9jayBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoaXMgY2FuZGlkYXRlIGJlY2FtZSB0aGUgbG9jayBvd25lci5cbiAgICovXG4gIGFzeW5jIF9wdWJsaXNoQWR2aXNvcnlMb2NrRGlyZWN0b3J5KGxvY2tQYXRoKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlUGF0aCA9IGF3YWl0IGZzLm1rZHRlbXAoYCR7bG9ja1BhdGh9LnBlbmRpbmctYClcbiAgICBsZXQgcHVibGlzaGVkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl93cml0ZUFkdmlzb3J5TG9ja01ldGFkYXRhKGNhbmRpZGF0ZVBhdGgpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZzLnJlbmFtZShjYW5kaWRhdGVQYXRoLCBsb2NrUGF0aClcbiAgICAgICAgcHVibGlzaGVkID0gdHJ1ZVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgY29kZSA9IC8qKiBAdHlwZSB7RXJyb3IgJiB7Y29kZT86IHN0cmluZ319ICovIChlcnJvcik/LmNvZGVcblxuICAgICAgICBpZiAoY29kZSA9PT0gXCJFRVhJU1RcIiB8fCBjb2RlID09PSBcIkVOT1RFTVBUWVwiKSByZXR1cm4gZmFsc2VcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCFwdWJsaXNoZWQpIGF3YWl0IGZzLnJtKGNhbmRpZGF0ZVBhdGgsIHtmb3JjZTogdHJ1ZSwgcmVjdXJzaXZlOiB0cnVlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3F1aXJlIGFkdmlzb3J5IGxvY2sgZmlsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBhcmdzIC0gVGltZW91dCBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeS1sb2NrIGZpbGUgd2FzIGFjcXVpcmVkLlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVBZHZpc29yeUxvY2tGaWxlKG5hbWUsIHt0aW1lb3V0TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KClcblxuICAgIGNvbnN0IGxvY2tQYXRoID0gdGhpcy5fYWR2aXNvcnlMb2NrUGF0aChuYW1lKVxuICAgIGNvbnN0IGRlYWRsaW5lID0gdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCA/IERhdGUubm93KCkgKyB0aW1lb3V0TXMgOiBudWxsXG4gICAgY29uc3QgcG9sbEludGVydmFsTXMgPSA1MFxuXG4gICAgLy8gSW50ZW50aW9uYWxseSBsb29waW5nIHdpdGhvdXQgYSBmaXhlZCBpdGVyYXRpb24gY2FwIOKAlCBlaXRoZXIgdGhlXG4gICAgLy8gbWtkaXIgc3VjY2VlZHMsIHRoZSBkZWFkbGluZSBlbGFwc2VzLCBvciBhbiB1bmV4cGVjdGVkIGVycm9yIGlzXG4gICAgLy8gcmUtdGhyb3duLlxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5fcHVibGlzaEFkdmlzb3J5TG9ja0RpcmVjdG9yeShsb2NrUGF0aCkpIHJldHVybiB0cnVlXG5cbiAgICAgIGlmIChhd2FpdCB0aGlzLl9pc0Fkdmlzb3J5TG9ja1N0YWxlKGxvY2tQYXRoKSkge1xuICAgICAgICBhd2FpdCBmcy5ybShsb2NrUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWV9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoZGVhZGxpbmUgIT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgcmVtYWluaW5nID0gZGVhZGxpbmUgLSBEYXRlLm5vdygpXG5cbiAgICAgICAgaWYgKHJlbWFpbmluZyA8PSAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgICBhd2FpdCB3YWl0KE1hdGgubWluKHBvbGxJbnRlcnZhbE1zLCByZW1haW5pbmcpKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgd2FpdChwb2xsSW50ZXJ2YWxNcylcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnkgYWNxdWlyZSBhZHZpc29yeSBsb2NrIGZpbGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeS1sb2NrIGZpbGUgd2FzIGFjcXVpcmVkIGltbWVkaWF0ZWx5LlxuICAgKi9cbiAgYXN5bmMgX3RyeUFjcXVpcmVBZHZpc29yeUxvY2tGaWxlKG5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVBZHZpc29yeUxvY2tEaXJlY3RvcnkoKVxuXG4gICAgY29uc3QgbG9ja1BhdGggPSB0aGlzLl9hZHZpc29yeUxvY2tQYXRoKG5hbWUpXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5fcHVibGlzaEFkdmlzb3J5TG9ja0RpcmVjdG9yeShsb2NrUGF0aCkpIHJldHVybiB0cnVlXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faXNBZHZpc29yeUxvY2tTdGFsZShsb2NrUGF0aCkpIHtcbiAgICAgIGF3YWl0IGZzLnJtKGxvY2tQYXRoLCB7cmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZX0pXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcHVibGlzaEFkdmlzb3J5TG9ja0RpcmVjdG9yeShsb2NrUGF0aClcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2UgYWR2aXNvcnkgbG9jayBmaWxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUFkdmlzb3J5TG9ja0ZpbGUobmFtZSkge1xuICAgIGNvbnN0IGxvY2tQYXRoID0gdGhpcy5fYWR2aXNvcnlMb2NrUGF0aChuYW1lKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZzLnJtKGxvY2tQYXRoLCB7cmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZX0pXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBCZXN0LWVmZm9ydCByZWxlYXNlOyBpbi1wcm9jZXNzIHN0YXRlIGlzIHN0aWxsIGF1dGhvcml0YXRpdmUgYW5kXG4gICAgICAvLyBzdGFsZS1sb2NrIGNsZWFudXAgb24gdGhlIG5leHQgYWNxdWlyZSB3aWxsIHJlbW92ZSB0aGUgZGlyZWN0b3J5XG4gICAgICAvLyBpZiBpdCByZWFsbHkgaXMgc3RpbGwgbGluZ2VyaW5nLlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGFkdmlzb3J5IGxvY2sgZmlsZSBoZWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnktbG9jayBmaWxlIGV4aXN0cyBhbmQgaXMgYWN0aXZlLlxuICAgKi9cbiAgYXN5bmMgX2lzQWR2aXNvcnlMb2NrRmlsZUhlbGQobmFtZSkge1xuICAgIGNvbnN0IGxvY2tQYXRoID0gdGhpcy5fYWR2aXNvcnlMb2NrUGF0aChuYW1lKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZzLnN0YXQobG9ja1BhdGgpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gIWF3YWl0IHRoaXMuX2lzQWR2aXNvcnlMb2NrU3RhbGUobG9ja1BhdGgpXG4gIH1cblxuICAvKipcbiAgICogQSBsb2NrIGRpcmVjdG9yeSBpcyBjb25zaWRlcmVkIHN0YWxlIHdoZW4gaXRzIG93bmVyIG1ldGFkYXRhIG5hbWVzIGFcbiAgICogUElEIG9uIHRoaXMgaG9zdCB0aGF0IGlzIG5vIGxvbmdlciBydW5uaW5nLiBDcm9zcy1ob3N0IG93bmVyc2hpcCAoYVxuICAgKiBkaWZmZXJlbnQgYGhvc3RuYW1lYCkgaXMgdHJlYXRlZCBhcyBsaXZlIGJlY2F1c2Ugd2UgY2Fubm90IHJlbGlhYmx5XG4gICAqIHByb2JlIGEgUElEIG9uIGFub3RoZXIgbWFjaGluZTsgb3BlcmF0b3JzIGluIHRoYXQgc2l0dWF0aW9uIHNob3VsZFxuICAgKiByZW1vdmUgc3RhbGUgbG9jayBkaXJlY3RvcmllcyBieSBoYW5kIGlmIHRoZXkgbGluZ2VyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9ja1BhdGggLSBBYnNvbHV0ZSBwYXRoIG9mIHRoZSBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnktbG9jayBmaWxlIGlzIHN0YWxlLlxuICAgKi9cbiAgYXN5bmMgX2lzQWR2aXNvcnlMb2NrU3RhbGUobG9ja1BhdGgpIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHJhd093bmVyLlxuICAgICAqIEB0eXBlIHtzdHJpbmd9ICovXG4gICAgbGV0IHJhd093bmVyXG5cbiAgICB0cnkge1xuICAgICAgcmF3T3duZXIgPSBhd2FpdCBmcy5yZWFkRmlsZShwYXRoLmpvaW4obG9ja1BhdGgsIFwib3duZXIuanNvblwiKSwgXCJ1dGY4XCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBNaXNzaW5nIG9yIHVucmVhZGFibGUgbWV0YWRhdGEg4oCUIHRyZWF0IGFzIHN0YWxlIHNvIHdlIGNhbiByZWNsYWltLlxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIG93bmVyLlxuICAgICAqIEB0eXBlIHt7cGlkPzogbnVtYmVyLCBob3N0bmFtZT86IHN0cmluZ319ICovXG4gICAgbGV0IG93bmVyXG5cbiAgICB0cnkge1xuICAgICAgb3duZXIgPSBKU09OLnBhcnNlKHJhd093bmVyKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoIW93bmVyIHx8IHR5cGVvZiBvd25lci5waWQgIT09IFwibnVtYmVyXCIpIHJldHVybiB0cnVlXG4gICAgaWYgKG93bmVyLmhvc3RuYW1lICYmIG93bmVyLmhvc3RuYW1lICE9PSBvcy5ob3N0bmFtZSgpKSByZXR1cm4gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICAvLyBga2lsbChwaWQsIDApYCBpcyBhIG5vLW9wIHNpZ25hbCB0aGF0IGZhaWxzIHdpdGggRVNSQ0ggaWYgdGhlXG4gICAgICAvLyBwcm9jZXNzIGlzIG5vdCBydW5uaW5nOyBwZXJtaXNzaW9uIGVycm9ycyBzdGlsbCBpbmRpY2F0ZSB0aGVcbiAgICAgIC8vIHByb2Nlc3MgZXhpc3RzIHNvIHdlIHRyZWF0IHRob3NlIGFzIFwibm90IHN0YWxlXCIuXG4gICAgICBwcm9jZXNzLmtpbGwob3duZXIucGlkLCAwKVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RXJyb3IgJiB7Y29kZT86IHN0cmluZ319ICovIChlcnJvcik/LmNvZGUgPT09IFwiRVNSQ0hcIlxuICAgIH1cbiAgfVxufVxuIl19
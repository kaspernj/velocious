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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDdEMsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUN4QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sT0FBTyxNQUFNLFNBQVMsQ0FBQTtBQUM3QixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sUUFBUSxDQUFBO0FBRTNCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLFVBQVUsTUFBTSwrQkFBK0IsQ0FBQTtBQUV0RCxNQUFNLENBQUMsT0FBTyxPQUFPLGtDQUFtQyxTQUFRLElBQUk7SUFDbEU7O3VEQUVtRDtJQUNuRCxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRXRCOztvQ0FFZ0M7SUFDaEMsc0JBQXNCLEdBQUcsU0FBUyxDQUFBO0lBRWxDLEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzNCLE1BQU0sV0FBVyxHQUFHLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQTtRQUNsRSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7UUFFeEMsSUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDbkMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJ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SUFBSSxDQUFBO1FBQ2IsQ0FBQztRQUVEOzt1REFFK0M7UUFDL0MsSUFBSSxLQUFLLENBQUE7UUFFVCxJQUFJLENBQUM7WUFDSCxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUM5QixDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1AsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO1FBRUQsSUFBSSxDQUFDLEtBQUssSUFBSSxPQUFPLEtBQUssQ0FBQyxHQUFHLEtBQUssUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQ3hELElBQUksS0FBSyxDQUFDLFFBQVEsSUFBSSxLQUFLLENBQUMsUUFBUSxLQUFLLEVBQUUsQ0FBQyxRQUFRLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUVwRSxJQUFJLENBQUM7WUFDSCxnRUFBZ0U7WUFDaEUsK0RBQStEO1lBQy9ELG1EQUFtRDtZQUNuRCxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUE7WUFFMUIsT0FBTyxLQUFLLENBQUE7UUFDZCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sc0NBQXNDLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBRSxJQUFJLEtBQUssT0FBTyxDQUFBO1FBQ3pFLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtjcmVhdGVIYXNofSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgb3MgZnJvbSBcIm5vZGU6b3NcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgcXVlcnkgZnJvbSBcIi4vcXVlcnkuanNcIlxuaW1wb3J0IHNxbGl0ZTMgZnJvbSBcInNxbGl0ZTNcIlxuaW1wb3J0IHtvcGVufSBmcm9tIFwic3FsaXRlXCJcblxuaW1wb3J0IEJhc2UgZnJvbSBcIi4vYmFzZS5qc1wiXG5pbXBvcnQgZmlsZUV4aXN0cyBmcm9tIFwiLi4vLi4vLi4vdXRpbHMvZmlsZS1leGlzdHMuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVOb2RlIGV4dGVuZHMgQmFzZSB7XG4gIC8qKlxuICAgKiBDb25uZWN0aW9uLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwic3FsaXRlXCIpLkRhdGFiYXNlIHwgdW5kZWZpbmVkfSAqL1xuICBjb25uZWN0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIEFkdmlzb3J5IGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBfYWR2aXNvcnlMb2NrRGlyZWN0b3J5ID0gdW5kZWZpbmVkXG5cbiAgYXN5bmMgY29ubmVjdCgpIHtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICBjb25zdCBkYXRhYmFzZURpciA9IGAke3RoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERpcmVjdG9yeSgpfS9kYmBcbiAgICBjb25zdCBkYXRhYmFzZVBhdGggPSB0aGlzLmRhdGFiYXNlUGF0aCgpXG5cbiAgICBpZiAoIWF3YWl0IGZpbGVFeGlzdHMoZGF0YWJhc2VEaXIpKSB7XG4gICAgICBhd2FpdCBmcy5ta2RpcihkYXRhYmFzZURpciwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgfVxuXG4gICAgaWYgKGFyZ3MucmVzZXQpIHtcbiAgICAgIGF3YWl0IGZzLnVubGluayhkYXRhYmFzZVBhdGgpXG4gICAgfVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrRGlyZWN0b3J5ID0gcGF0aC5qb2luKGRhdGFiYXNlRGlyLCBgJHt0aGlzLmxvY2FsU3RvcmFnZU5hbWUoKX0udmVsb2Npb3VzLWFkdmlzb3J5LWxvY2tzYClcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLmNvbm5lY3Rpb24gPSBhd2FpdCBvcGVuKHtcbiAgICAgICAgZmlsZW5hbWU6IGRhdGFiYXNlUGF0aCxcbiAgICAgICAgZHJpdmVyOiBzcWxpdGUzLkRhdGFiYXNlXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IG9wZW4gZGF0YWJhc2UgJHtkYXRhYmFzZVBhdGh9IGJlY2F1c2Ugb2YgJHtlcnJvci5jb25zdHJ1Y3Rvci5uYW1lfTogJHtlcnJvci5tZXNzYWdlfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBvcGVuIGRhdGFiYXNlICR7ZGF0YWJhc2VQYXRofSBiZWNhdXNlIG9mICR7dHlwZW9mIGVycm9yfTogJHtlcnJvcn1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlZ2lzdGVyVmVyc2lvbigpXG4gIH1cblxuICBsb2NhbFN0b3JhZ2VOYW1lKCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuXG4gICAgaWYgKCFhcmdzLm5hbWUpIHRocm93IG5ldyBFcnJvcihcIk5vIG5hbWUgZ2l2ZW4gZm9yIFNRTGl0ZSBOb2RlXCIpXG5cbiAgICByZXR1cm4gYFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZS0tLSR7YXJncy5uYW1lfWBcbiAgfVxuXG4gIGRhdGFiYXNlUGF0aCgpIHtcbiAgICByZXR1cm4gYCR7dGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGlyZWN0b3J5KCl9L2RiLyR7dGhpcy5sb2NhbFN0b3JhZ2VOYW1lKCl9LnNxbGl0ZWBcbiAgfVxuXG4gIGFzeW5jIF9jbG9zZSgpIHtcbiAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24/LmNsb3NlKClcbiAgICB0aGlzLmNvbm5lY3Rpb24gPSB1bmRlZmluZWRcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZURhdGFiYXNlU3RvcmFnZSgpIHtcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBbXCJcIiwgXCItd2FsXCIsIFwiLXNobVwiLCBcIi1qb3VybmFsXCJdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmcy51bmxpbmsoYCR7dGhpcy5kYXRhYmFzZVBhdGgoKX0ke3N1ZmZpeH1gKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiBlcnJvci5jb2RlID09PSBcIkVOT0VOVFwiKSkgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkgYWN0dWFsLlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbm5lY3Rpb25cIilcblxuICAgIGlmIChvcHRpb25zLnNxbGl0ZVNjcmlwdCkge1xuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uLmV4ZWMoc3FsKVxuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5KHRoaXMuY29ubmVjdGlvbiwgc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gd2l0aCBhZmZlY3RlZC1yb3cgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHtcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29ubmVjdGlvblwiKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29ubmVjdGlvbi5ydW4oc3FsKVxuICAgIHJldHVybiByZXN1bHQuY2hhbmdlcyB8fCAwXG4gIH1cblxuICAvKipcbiAgICogTGF5ZXJzIGEgZmlsZXN5c3RlbSBsb2NrIGRpcmVjdG9yeSBvbiB0b3Agb2YgdGhlIGluLXByb2Nlc3Mgd2FpdGVyXG4gICAqIHF1ZXVlIHNvIFNRTGl0ZSBkZXBsb3ltZW50cyB3aXRoIG11bHRpcGxlIE5vZGUgcHJvY2Vzc2VzIHdyaXRpbmcgdG9cbiAgICogdGhlIHNhbWUgZGF0YWJhc2UgZmlsZSBzZWUgY29uc2lzdGVudCBhZHZpc29yeS1sb2NrIG11dHVhbCBleGNsdXNpb25cbiAgICogYWNyb3NzIHByb2Nlc3Nlcywgbm90IGp1c3Qgd2l0aGluIGEgc2luZ2xlIHByb2Nlc3MuXG4gICAqXG4gICAqIFRoZSBpbi1wcm9jZXNzIHF1ZXVlIGZyb20gdGhlIHNoYXJlZCBTUUxpdGUgYmFzZSBjbGFzcyBpcyBzdGlsbCB1c2VkXG4gICAqIGZvciB0aGUgZmFzdCBpbnRyYS1wcm9jZXNzIHBhdGggKG5vIHBvbGxpbmcsIHdhaXRlcnMgd2FrZSBlYWNoIG90aGVyXG4gICAqIHRocm91Z2ggdGhlIGBTZXQ8c3RyaW5nPmAgKyB3YWl0ZXIgcXVldWUpOyB0aGUgZmlsZXN5c3RlbSBsb2NrIGlzXG4gICAqIG9ubHkgY2hlY2tlZCBvbmNlIHRoZSBpbi1wcm9jZXNzIHF1ZXVlIGhhcyBncmFudGVkIHRoZSBjYWxsZXIsIHNvXG4gICAqIHR5cGljYWwgc2luZ2xlLXByb2Nlc3MgdHJhZmZpYyBwYXlzIGF0IG1vc3QgdHdvIGBmcy5ta2RpcmAgY2FsbHNcbiAgICogKGNyZWF0ZSBhbmQgcmVtb3ZlKSBwZXIgY3JpdGljYWwgc2VjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgLCBgdW5kZWZpbmVkYCwgb3IgbmVnYXRpdmUgYmxvY2tzIGZvcmV2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5IGxvY2sgd2FzIGFjcXVpcmVkLlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IGRlYWRsaW5lID0gdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCA/IERhdGUubm93KCkgKyB0aW1lb3V0TXMgOiBudWxsXG4gICAgY29uc3QgcmVtYWluaW5nRm9ySW5Qcm9jZXNzID0gZGVhZGxpbmUgIT09IG51bGwgPyBNYXRoLm1heCgwLCBkZWFkbGluZSAtIERhdGUubm93KCkpIDogbnVsbFxuICAgIGNvbnN0IGluUHJvY2Vzc0FjcXVpcmVkID0gYXdhaXQgc3VwZXIuX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNczogcmVtYWluaW5nRm9ySW5Qcm9jZXNzfSlcblxuICAgIGlmICghaW5Qcm9jZXNzQWNxdWlyZWQpIHJldHVybiBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlbWFpbmluZ0ZvckZpbGUgPSBkZWFkbGluZSAhPT0gbnVsbCA/IE1hdGgubWF4KDAsIGRlYWRsaW5lIC0gRGF0ZS5ub3coKSkgOiBudWxsXG4gICAgICBjb25zdCBmaWxlQWNxdWlyZWQgPSBhd2FpdCB0aGlzLl9hY3F1aXJlQWR2aXNvcnlMb2NrRmlsZShuYW1lLCB7dGltZW91dE1zOiByZW1haW5pbmdGb3JGaWxlfSlcblxuICAgICAgaWYgKCFmaWxlQWNxdWlyZWQpIHtcbiAgICAgICAgYXdhaXQgc3VwZXIuX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGF3YWl0IHN1cGVyLl9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnkgYWNxdWlyZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnkgbG9jayB3YXMgYWNxdWlyZWQgaW1tZWRpYXRlbHkuXG4gICAqL1xuICBhc3luYyBfdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3QgaW5Qcm9jZXNzQWNxdWlyZWQgPSBhd2FpdCBzdXBlci5fdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgaWYgKCFpblByb2Nlc3NBY3F1aXJlZCkgcmV0dXJuIGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZmlsZUFjcXVpcmVkID0gYXdhaXQgdGhpcy5fdHJ5QWNxdWlyZUFkdmlzb3J5TG9ja0ZpbGUobmFtZSlcblxuICAgICAgaWYgKCFmaWxlQWNxdWlyZWQpIHtcbiAgICAgICAgYXdhaXQgc3VwZXIuX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGF3YWl0IHN1cGVyLl9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdGhlIGxvY2sgb25seSBpZiAqKnRoaXMqKiBkcml2ZXIgaW5zdGFuY2UgYWNxdWlyZWQgaXQsIGJvdGhcbiAgICogaW4gdGhlIHNoYXJlZCBpbi1wcm9jZXNzIG93bmVyIHRhYmxlIGFuZCBpbiB0aGUgb24tZGlzayBsb2NrXG4gICAqIGRpcmVjdG9yeS4gQSBjYWxsZXIgdGhhdCB0cmllcyB0byByZWxlYXNlIGEgbG9jayBpdCBuZXZlciBhY3F1aXJlZFxuICAgKiAob3IgdGhhdCB3YXMgYWxyZWFkeSByZWxlYXNlZCBieSBhbm90aGVyIGRyaXZlcikgZ2V0cyBgZmFsc2VgIGJhY2tcbiAgICogYW5kIHRoZSBmaWxlc3lzdGVtIHN0YXRlIGlzIGxlZnQgYWxvbmUgc28gd2UgbmV2ZXIgZGVsZXRlIHNvbWVib2R5XG4gICAqIGVsc2UncyBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5IGxvY2sgd2FzIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IGluUHJvY2Vzc1JlbGVhc2VkID0gYXdhaXQgc3VwZXIuX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSlcblxuICAgIGlmIChpblByb2Nlc3NSZWxlYXNlZCkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUFkdmlzb3J5TG9ja0ZpbGUobmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gaW5Qcm9jZXNzUmVsZWFzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGFkdmlzb3J5IGxvY2sgaGVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5IGxvY2sgaXMgaGVsZC5cbiAgICovXG4gIGFzeW5jIGlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKSB7XG4gICAgaWYgKGF3YWl0IHN1cGVyLmlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9pc0Fkdmlzb3J5TG9ja0ZpbGVIZWxkKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGFkdmlzb3J5IGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBhZHZpc29yeS1sb2NrIGRpcmVjdG9yeS5cbiAgICovXG4gIF9yZXNvbHZlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KCkge1xuICAgIGlmICghdGhpcy5fYWR2aXNvcnlMb2NrRGlyZWN0b3J5KSB7XG4gICAgICAvLyBGYWxsIGJhY2sgdG8gZGVyaXZpbmcgdGhlIGRpcmVjdG9yeSBmb3IgY2FsbGVycyB0aGF0IGludm9rZWRcbiAgICAgIC8vIGFkdmlzb3J5IGxvY2sgbWV0aG9kcyBiZWZvcmUgYGNvbm5lY3QoKWAgd2lyZWQgdGhlIGZpZWxkIGluLlxuICAgICAgY29uc3QgZGF0YWJhc2VEaXIgPSBgJHt0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREaXJlY3RvcnkoKX0vZGJgXG5cbiAgICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0RpcmVjdG9yeSA9IHBhdGguam9pbihkYXRhYmFzZURpciwgYCR7dGhpcy5sb2NhbFN0b3JhZ2VOYW1lKCl9LnZlbG9jaW91cy1hZHZpc29yeS1sb2Nrc2ApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja0RpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWR2aXNvcnkgbG9jayBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGaWxlc3lzdGVtIHBhdGggZm9yIHRoZSBhZHZpc29yeSBsb2NrLlxuICAgKi9cbiAgX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSkge1xuICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShuYW1lKS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMTYpXG4gICAgY29uc3Qgc2FmZU5hbWUgPSBuYW1lLnJlcGxhY2UoL1teYS16QS1aMC05Ll8tXS9nLCBcIl9cIikuc2xpY2UoMCwgNjQpXG5cbiAgICByZXR1cm4gcGF0aC5qb2luKHRoaXMuX3Jlc29sdmVBZHZpc29yeUxvY2tEaXJlY3RvcnkoKSwgYCR7c2FmZU5hbWV9LSR7aGFzaH0ubG9ja2ApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgYWR2aXNvcnkgbG9jayBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBfZW5zdXJlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KCkge1xuICAgIGF3YWl0IGZzLm1rZGlyKHRoaXMuX3Jlc29sdmVBZHZpc29yeUxvY2tEaXJlY3RvcnkoKSwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3cml0ZSBhZHZpc29yeSBsb2NrIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9ja0RpclBhdGggLSBBYnNvbHV0ZSBwYXRoIG9mIHRoZSBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfd3JpdGVBZHZpc29yeUxvY2tNZXRhZGF0YShsb2NrRGlyUGF0aCkge1xuICAgIGNvbnN0IG93bmVyUGF0aCA9IHBhdGguam9pbihsb2NrRGlyUGF0aCwgXCJvd25lci5qc29uXCIpXG4gICAgY29uc3QgcGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIHBpZDogcHJvY2Vzcy5waWQsXG4gICAgICBob3N0bmFtZTogb3MuaG9zdG5hbWUoKSxcbiAgICAgIGFjcXVpcmVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIH0pXG5cbiAgICBhd2FpdCBmcy53cml0ZUZpbGUob3duZXJQYXRoLCBwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyBhIGZ1bGx5IGluaXRpYWxpemVkIGxvY2sgZGlyZWN0b3J5IHdpdGggb25lIGF0b21pYyByZW5hbWUuXG4gICAqIEEgbG9zaW5nIGNhbmRpZGF0ZSBpcyByZW1vdmVkIGluIHRoZSBzYW1lIGNhbGwsIHNvIGNvbmN1cnJlbnQgYWNxdWlzaXRpb25cbiAgICogY2Fubm90IG9ic2VydmUgb3IgZGVsZXRlIGFub3RoZXIgcHJvY2VzcydzIGhhbGYtd3JpdHRlbiBvd25lciBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tQYXRoIC0gU3RhYmxlIGFkdmlzb3J5LWxvY2sgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGlzIGNhbmRpZGF0ZSBiZWNhbWUgdGhlIGxvY2sgb3duZXIuXG4gICAqL1xuICBhc3luYyBfcHVibGlzaEFkdmlzb3J5TG9ja0RpcmVjdG9yeShsb2NrUGF0aCkge1xuICAgIGNvbnN0IGNhbmRpZGF0ZVBhdGggPSBhd2FpdCBmcy5ta2R0ZW1wKGAke2xvY2tQYXRofS5wZW5kaW5nLWApXG4gICAgbGV0IHB1Ymxpc2hlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fd3JpdGVBZHZpc29yeUxvY2tNZXRhZGF0YShjYW5kaWRhdGVQYXRoKVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmcy5yZW5hbWUoY2FuZGlkYXRlUGF0aCwgbG9ja1BhdGgpXG4gICAgICAgIHB1Ymxpc2hlZCA9IHRydWVcbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGNvZGUgPSAvKiogQHR5cGUge0Vycm9yICYge2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpPy5jb2RlXG5cbiAgICAgICAgaWYgKGNvZGUgPT09IFwiRUVYSVNUXCIgfHwgY29kZSA9PT0gXCJFTk9URU1QVFlcIikgcmV0dXJuIGZhbHNlXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghcHVibGlzaGVkKSBhd2FpdCBmcy5ybShjYW5kaWRhdGVQYXRoLCB7Zm9yY2U6IHRydWUsIHJlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNxdWlyZSBhZHZpc29yeSBsb2NrIGZpbGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gYXJncyAtIFRpbWVvdXQgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnktbG9jayBmaWxlIHdhcyBhY3F1aXJlZC5cbiAgICovXG4gIGFzeW5jIF9hY3F1aXJlQWR2aXNvcnlMb2NrRmlsZShuYW1lLCB7dGltZW91dE1zfSkge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUFkdmlzb3J5TG9ja0RpcmVjdG9yeSgpXG5cbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMuX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSlcbiAgICBjb25zdCBkZWFkbGluZSA9IHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDAgPyBEYXRlLm5vdygpICsgdGltZW91dE1zIDogbnVsbFxuICAgIGNvbnN0IHBvbGxJbnRlcnZhbE1zID0gNTBcblxuICAgIC8vIEludGVudGlvbmFsbHkgbG9vcGluZyB3aXRob3V0IGEgZml4ZWQgaXRlcmF0aW9uIGNhcCDigJQgZWl0aGVyIHRoZVxuICAgIC8vIG1rZGlyIHN1Y2NlZWRzLCB0aGUgZGVhZGxpbmUgZWxhcHNlcywgb3IgYW4gdW5leHBlY3RlZCBlcnJvciBpc1xuICAgIC8vIHJlLXRocm93bi5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX3B1Ymxpc2hBZHZpc29yeUxvY2tEaXJlY3RvcnkobG9ja1BhdGgpKSByZXR1cm4gdHJ1ZVxuXG4gICAgICBpZiAoYXdhaXQgdGhpcy5faXNBZHZpc29yeUxvY2tTdGFsZShsb2NrUGF0aCkpIHtcbiAgICAgICAgYXdhaXQgZnMucm0obG9ja1BhdGgsIHtyZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGRlYWRsaW5lICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IHJlbWFpbmluZyA9IGRlYWRsaW5lIC0gRGF0ZS5ub3coKVxuXG4gICAgICAgIGlmIChyZW1haW5pbmcgPD0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICAgICAgYXdhaXQgd2FpdChNYXRoLm1pbihwb2xsSW50ZXJ2YWxNcywgcmVtYWluaW5nKSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHdhaXQocG9sbEludGVydmFsTXMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jayBmaWxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnktbG9jayBmaWxlIHdhcyBhY3F1aXJlZCBpbW1lZGlhdGVseS5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrRmlsZShuYW1lKSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KClcblxuICAgIGNvbnN0IGxvY2tQYXRoID0gdGhpcy5fYWR2aXNvcnlMb2NrUGF0aChuYW1lKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX3B1Ymxpc2hBZHZpc29yeUxvY2tEaXJlY3RvcnkobG9ja1BhdGgpKSByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2lzQWR2aXNvcnlMb2NrU3RhbGUobG9ja1BhdGgpKSB7XG4gICAgICBhd2FpdCBmcy5ybShsb2NrUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWV9KVxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3B1Ymxpc2hBZHZpc29yeUxvY2tEaXJlY3RvcnkobG9ja1BhdGgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxlYXNlIGFkdmlzb3J5IGxvY2sgZmlsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VBZHZpc29yeUxvY2tGaWxlKG5hbWUpIHtcbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMuX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5ybShsb2NrUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWV9KVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQmVzdC1lZmZvcnQgcmVsZWFzZTsgaW4tcHJvY2VzcyBzdGF0ZSBpcyBzdGlsbCBhdXRob3JpdGF0aXZlIGFuZFxuICAgICAgLy8gc3RhbGUtbG9jayBjbGVhbnVwIG9uIHRoZSBuZXh0IGFjcXVpcmUgd2lsbCByZW1vdmUgdGhlIGRpcmVjdG9yeVxuICAgICAgLy8gaWYgaXQgcmVhbGx5IGlzIHN0aWxsIGxpbmdlcmluZy5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBhZHZpc29yeSBsb2NrIGZpbGUgaGVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5LWxvY2sgZmlsZSBleGlzdHMgYW5kIGlzIGFjdGl2ZS5cbiAgICovXG4gIGFzeW5jIF9pc0Fkdmlzb3J5TG9ja0ZpbGVIZWxkKG5hbWUpIHtcbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMuX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5zdGF0KGxvY2tQYXRoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuICFhd2FpdCB0aGlzLl9pc0Fkdmlzb3J5TG9ja1N0YWxlKGxvY2tQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIEEgbG9jayBkaXJlY3RvcnkgaXMgY29uc2lkZXJlZCBzdGFsZSB3aGVuIGl0cyBvd25lciBtZXRhZGF0YSBuYW1lcyBhXG4gICAqIFBJRCBvbiB0aGlzIGhvc3QgdGhhdCBpcyBubyBsb25nZXIgcnVubmluZy4gQ3Jvc3MtaG9zdCBvd25lcnNoaXAgKGFcbiAgICogZGlmZmVyZW50IGBob3N0bmFtZWApIGlzIHRyZWF0ZWQgYXMgbGl2ZSBiZWNhdXNlIHdlIGNhbm5vdCByZWxpYWJseVxuICAgKiBwcm9iZSBhIFBJRCBvbiBhbm90aGVyIG1hY2hpbmU7IG9wZXJhdG9ycyBpbiB0aGF0IHNpdHVhdGlvbiBzaG91bGRcbiAgICogcmVtb3ZlIHN0YWxlIGxvY2sgZGlyZWN0b3JpZXMgYnkgaGFuZCBpZiB0aGV5IGxpbmdlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tQYXRoIC0gQWJzb2x1dGUgcGF0aCBvZiB0aGUgbG9jayBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5LWxvY2sgZmlsZSBpcyBzdGFsZS5cbiAgICovXG4gIGFzeW5jIF9pc0Fkdmlzb3J5TG9ja1N0YWxlKGxvY2tQYXRoKSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyByYXdPd25lci5cbiAgICAgKiBAdHlwZSB7c3RyaW5nfSAqL1xuICAgIGxldCByYXdPd25lclxuXG4gICAgdHJ5IHtcbiAgICAgIHJhd093bmVyID0gYXdhaXQgZnMucmVhZEZpbGUocGF0aC5qb2luKGxvY2tQYXRoLCBcIm93bmVyLmpzb25cIiksIFwidXRmOFwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTWlzc2luZyBvciB1bnJlYWRhYmxlIG1ldGFkYXRhIOKAlCB0cmVhdCBhcyBzdGFsZSBzbyB3ZSBjYW4gcmVjbGFpbS5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBvd25lci5cbiAgICAgKiBAdHlwZSB7e3BpZD86IG51bWJlciwgaG9zdG5hbWU/OiBzdHJpbmd9fSAqL1xuICAgIGxldCBvd25lclxuXG4gICAgdHJ5IHtcbiAgICAgIG93bmVyID0gSlNPTi5wYXJzZShyYXdPd25lcilcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFvd25lciB8fCB0eXBlb2Ygb3duZXIucGlkICE9PSBcIm51bWJlclwiKSByZXR1cm4gdHJ1ZVxuICAgIGlmIChvd25lci5ob3N0bmFtZSAmJiBvd25lci5ob3N0bmFtZSAhPT0gb3MuaG9zdG5hbWUoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgLy8gYGtpbGwocGlkLCAwKWAgaXMgYSBuby1vcCBzaWduYWwgdGhhdCBmYWlscyB3aXRoIEVTUkNIIGlmIHRoZVxuICAgICAgLy8gcHJvY2VzcyBpcyBub3QgcnVubmluZzsgcGVybWlzc2lvbiBlcnJvcnMgc3RpbGwgaW5kaWNhdGUgdGhlXG4gICAgICAvLyBwcm9jZXNzIGV4aXN0cyBzbyB3ZSB0cmVhdCB0aG9zZSBhcyBcIm5vdCBzdGFsZVwiLlxuICAgICAgcHJvY2Vzcy5raWxsKG93bmVyLnBpZCwgMClcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge0Vycm9yICYge2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpPy5jb2RlID09PSBcIkVTUkNIXCJcbiAgICB9XG4gIH1cbn1cbiJdfQ==
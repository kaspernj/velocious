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
     * The filesystem lock directory is this driver's driver-native tier on
     * top of the shared process-local pre-filter tier from the base driver,
     * so SQLite deployments with multiple Node processes writing to the same
     * database file see consistent advisory-lock mutual exclusion across
     * processes, not just within a single process.
     * @returns {boolean} - Always true for the Node SQLite driver.
     */
    supportsDriverNativeAdvisoryLock() {
        return true;
    }
    /**
     * Filesystem lock directory as the driver-native tier on top of the
     * shared process-local pre-filter tier from the base driver, so SQLite
     * deployments with multiple Node processes writing to the same database
     * file see consistent advisory-lock mutual exclusion across processes,
     * not just within a single process.
     *
     * The base driver's process-local tier serializes same-process callers
     * first (no filesystem round trip for uncontended traffic); this hook
     * is only reached once the tier has granted the caller its turn, and its
     * result is what confirms cross-process exclusion for SQLite.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
     * @returns {Promise<boolean>} - Whether the advisory lock was acquired.
     */
    async _acquireAdvisoryLock(name, { timeoutMs } = {}) {
        return await this._acquireAdvisoryLockFile(name, { timeoutMs });
    }
    /**
     * Runs try acquire advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock was acquired immediately.
     */
    async _tryAcquireAdvisoryLock(name) {
        return await this._tryAcquireAdvisoryLockFile(name);
    }
    /**
     * Releases the on-disk lock directory for a lock this driver instance
     * acquired through the base driver's two-tier chain. A caller that tries
     * to release a lock it never acquired (or that was already released by
     * another driver) gets `false` back and the filesystem state is left
     * alone so we never delete somebody else's lock directory.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock was released.
     */
    async _releaseAdvisoryLock(name) {
        const lockPath = this._advisoryLockPath(name);
        try {
            await fs.stat(lockPath);
        }
        catch {
            return false;
        }
        await this._releaseAdvisoryLockFile(name);
        return true;
    }
    /**
     * Filesystem-tier view for the base driver's `isAdvisoryLockHeld`, which
     * answers from the process-local tier first and only asks this hook when
     * the tier has no owner for the name.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock file is held.
     */
    async _isAdvisoryLockHeldNative(name) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDdEMsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUN4QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sT0FBTyxNQUFNLFNBQVMsQ0FBQTtBQUM3QixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sUUFBUSxDQUFBO0FBRTNCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLFVBQVUsTUFBTSwrQkFBK0IsQ0FBQTtBQUV0RCxNQUFNLENBQUMsT0FBTyxPQUFPLGtDQUFtQyxTQUFRLElBQUk7SUFDbEU7O3VEQUVtRDtJQUNuRCxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRXRCOztvQ0FFZ0M7SUFDaEMsc0JBQXNCLEdBQUcsU0FBUyxDQUFBO0lBRWxDLEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzNCLE1BQU0sV0FBVyxHQUFHLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQTtRQUNsRSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7UUFFeEMsSUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDbkMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJ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SUFBSSxLQUFLLENBQUMsUUFBUSxJQUFJLEtBQUssQ0FBQyxRQUFRLEtBQUssRUFBRSxDQUFDLFFBQVEsRUFBRTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXBFLElBQUksQ0FBQztZQUNILGdFQUFnRTtZQUNoRSwrREFBK0Q7WUFDL0QsbURBQW1EO1lBQ25ELE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQTtZQUUxQixPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxzQ0FBc0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxFQUFFLElBQUksS0FBSyxPQUFPLENBQUE7UUFDekUsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZUhhc2h9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgd2FpdCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvd2FpdC5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCBvcyBmcm9tIFwibm9kZTpvc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCJcbmltcG9ydCBxdWVyeSBmcm9tIFwiLi9xdWVyeS5qc1wiXG5pbXBvcnQgc3FsaXRlMyBmcm9tIFwic3FsaXRlM1wiXG5pbXBvcnQge29wZW59IGZyb20gXCJzcWxpdGVcIlxuXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCBmaWxlRXhpc3RzIGZyb20gXCIuLi8uLi8uLi91dGlscy9maWxlLWV4aXN0cy5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZU5vZGUgZXh0ZW5kcyBCYXNlIHtcbiAgLyoqXG4gICAqIENvbm5lY3Rpb24uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCJzcWxpdGVcIikuRGF0YWJhc2UgfCB1bmRlZmluZWR9ICovXG4gIGNvbm5lY3Rpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogQWR2aXNvcnkgbG9jayBkaXJlY3RvcnkuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9hZHZpc29yeUxvY2tEaXJlY3RvcnkgPSB1bmRlZmluZWRcblxuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IGRhdGFiYXNlRGlyID0gYCR7dGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGlyZWN0b3J5KCl9L2RiYFxuICAgIGNvbnN0IGRhdGFiYXNlUGF0aCA9IHRoaXMuZGF0YWJhc2VQYXRoKClcblxuICAgIGlmICghYXdhaXQgZmlsZUV4aXN0cyhkYXRhYmFzZURpcikpIHtcbiAgICAgIGF3YWl0IGZzLm1rZGlyKGRhdGFiYXNlRGlyLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgICB9XG5cbiAgICBpZiAoYXJncy5yZXNldCkge1xuICAgICAgYXdhaXQgZnMudW5saW5rKGRhdGFiYXNlUGF0aClcbiAgICB9XG5cbiAgICB0aGlzLl9hZHZpc29yeUxvY2tEaXJlY3RvcnkgPSBwYXRoLmpvaW4oZGF0YWJhc2VEaXIsIGAke3RoaXMubG9jYWxTdG9yYWdlTmFtZSgpfS52ZWxvY2lvdXMtYWR2aXNvcnktbG9ja3NgKVxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuY29ubmVjdGlvbiA9IGF3YWl0IG9wZW4oe1xuICAgICAgICBmaWxlbmFtZTogZGF0YWJhc2VQYXRoLFxuICAgICAgICBkcml2ZXI6IHNxbGl0ZTMuRGF0YWJhc2VcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3Qgb3BlbiBkYXRhYmFzZSAke2RhdGFiYXNlUGF0aH0gYmVjYXVzZSBvZiAke2Vycm9yLmNvbnN0cnVjdG9yLm5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IG9wZW4gZGF0YWJhc2UgJHtkYXRhYmFzZVBhdGh9IGJlY2F1c2Ugb2YgJHt0eXBlb2YgZXJyb3J9OiAke2Vycm9yfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJWZXJzaW9uKClcbiAgfVxuXG4gIGxvY2FsU3RvcmFnZU5hbWUoKSB7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG5cbiAgICBpZiAoIWFyZ3MubmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gbmFtZSBnaXZlbiBmb3IgU1FMaXRlIE5vZGVcIilcblxuICAgIHJldHVybiBgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlLS0tJHthcmdzLm5hbWV9YFxuICB9XG5cbiAgZGF0YWJhc2VQYXRoKCkge1xuICAgIHJldHVybiBgJHt0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREaXJlY3RvcnkoKX0vZGIvJHt0aGlzLmxvY2FsU3RvcmFnZU5hbWUoKX0uc3FsaXRlYFxuICB9XG5cbiAgYXN5bmMgX2Nsb3NlKCkge1xuICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbj8uY2xvc2UoKVxuICAgIHRoaXMuY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICB9XG5cbiAgYXN5bmMgZGVsZXRlRGF0YWJhc2VTdG9yYWdlKCkge1xuICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIFtcIlwiLCBcIi13YWxcIiwgXCItc2htXCIsIFwiLWpvdXJuYWxcIl0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZzLnVubGluayhgJHt0aGlzLmRhdGFiYXNlUGF0aCgpfSR7c3VmZml4fWApXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIFwiY29kZVwiIGluIGVycm9yICYmIGVycm9yLmNvZGUgPT09IFwiRU5PRU5UXCIpKSB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeSBhY3R1YWwuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29ubmVjdGlvblwiKVxuXG4gICAgaWYgKG9wdGlvbnMuc3FsaXRlU2NyaXB0KSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24uZXhlYyhzcWwpXG4gICAgICByZXR1cm4gW11cbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkodGhpcy5jb25uZWN0aW9uLCBzcWwpXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiB3aXRoIGFmZmVjdGVkLXJvdyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkge1xuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25uZWN0aW9uXCIpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb25uZWN0aW9uLnJ1bihzcWwpXG4gICAgcmV0dXJuIHJlc3VsdC5jaGFuZ2VzIHx8IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgZmlsZXN5c3RlbSBsb2NrIGRpcmVjdG9yeSBpcyB0aGlzIGRyaXZlcidzIGRyaXZlci1uYXRpdmUgdGllciBvblxuICAgKiB0b3Agb2YgdGhlIHNoYXJlZCBwcm9jZXNzLWxvY2FsIHByZS1maWx0ZXIgdGllciBmcm9tIHRoZSBiYXNlIGRyaXZlcixcbiAgICogc28gU1FMaXRlIGRlcGxveW1lbnRzIHdpdGggbXVsdGlwbGUgTm9kZSBwcm9jZXNzZXMgd3JpdGluZyB0byB0aGUgc2FtZVxuICAgKiBkYXRhYmFzZSBmaWxlIHNlZSBjb25zaXN0ZW50IGFkdmlzb3J5LWxvY2sgbXV0dWFsIGV4Y2x1c2lvbiBhY3Jvc3NcbiAgICogcHJvY2Vzc2VzLCBub3QganVzdCB3aXRoaW4gYSBzaW5nbGUgcHJvY2Vzcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gQWx3YXlzIHRydWUgZm9yIHRoZSBOb2RlIFNRTGl0ZSBkcml2ZXIuXG4gICAqL1xuICBzdXBwb3J0c0RyaXZlck5hdGl2ZUFkdmlzb3J5TG9jaygpIHtcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbGVzeXN0ZW0gbG9jayBkaXJlY3RvcnkgYXMgdGhlIGRyaXZlci1uYXRpdmUgdGllciBvbiB0b3Agb2YgdGhlXG4gICAqIHNoYXJlZCBwcm9jZXNzLWxvY2FsIHByZS1maWx0ZXIgdGllciBmcm9tIHRoZSBiYXNlIGRyaXZlciwgc28gU1FMaXRlXG4gICAqIGRlcGxveW1lbnRzIHdpdGggbXVsdGlwbGUgTm9kZSBwcm9jZXNzZXMgd3JpdGluZyB0byB0aGUgc2FtZSBkYXRhYmFzZVxuICAgKiBmaWxlIHNlZSBjb25zaXN0ZW50IGFkdmlzb3J5LWxvY2sgbXV0dWFsIGV4Y2x1c2lvbiBhY3Jvc3MgcHJvY2Vzc2VzLFxuICAgKiBub3QganVzdCB3aXRoaW4gYSBzaW5nbGUgcHJvY2Vzcy5cbiAgICpcbiAgICogVGhlIGJhc2UgZHJpdmVyJ3MgcHJvY2Vzcy1sb2NhbCB0aWVyIHNlcmlhbGl6ZXMgc2FtZS1wcm9jZXNzIGNhbGxlcnNcbiAgICogZmlyc3QgKG5vIGZpbGVzeXN0ZW0gcm91bmQgdHJpcCBmb3IgdW5jb250ZW5kZWQgdHJhZmZpYyk7IHRoaXMgaG9va1xuICAgKiBpcyBvbmx5IHJlYWNoZWQgb25jZSB0aGUgdGllciBoYXMgZ3JhbnRlZCB0aGUgY2FsbGVyIGl0cyB0dXJuLCBhbmQgaXRzXG4gICAqIHJlc3VsdCBpcyB3aGF0IGNvbmZpcm1zIGNyb3NzLXByb2Nlc3MgZXhjbHVzaW9uIGZvciBTUUxpdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHM7IGBudWxsYCwgYHVuZGVmaW5lZGAsIG9yIG5lZ2F0aXZlIGJsb2NrcyBmb3JldmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeSBsb2NrIHdhcyBhY3F1aXJlZC5cbiAgICovXG4gIGFzeW5jIF9hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fYWNxdWlyZUFkdmlzb3J5TG9ja0ZpbGUobmFtZSwge3RpbWVvdXRNc30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnkgYWNxdWlyZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnkgbG9jayB3YXMgYWNxdWlyZWQgaW1tZWRpYXRlbHkuXG4gICAqL1xuICBhc3luYyBfdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3RyeUFjcXVpcmVBZHZpc29yeUxvY2tGaWxlKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdGhlIG9uLWRpc2sgbG9jayBkaXJlY3RvcnkgZm9yIGEgbG9jayB0aGlzIGRyaXZlciBpbnN0YW5jZVxuICAgKiBhY3F1aXJlZCB0aHJvdWdoIHRoZSBiYXNlIGRyaXZlcidzIHR3by10aWVyIGNoYWluLiBBIGNhbGxlciB0aGF0IHRyaWVzXG4gICAqIHRvIHJlbGVhc2UgYSBsb2NrIGl0IG5ldmVyIGFjcXVpcmVkIChvciB0aGF0IHdhcyBhbHJlYWR5IHJlbGVhc2VkIGJ5XG4gICAqIGFub3RoZXIgZHJpdmVyKSBnZXRzIGBmYWxzZWAgYmFjayBhbmQgdGhlIGZpbGVzeXN0ZW0gc3RhdGUgaXMgbGVmdFxuICAgKiBhbG9uZSBzbyB3ZSBuZXZlciBkZWxldGUgc29tZWJvZHkgZWxzZSdzIGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnkgbG9jayB3YXMgcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3QgbG9ja1BhdGggPSB0aGlzLl9hZHZpc29yeUxvY2tQYXRoKG5hbWUpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZnMuc3RhdChsb2NrUGF0aClcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VBZHZpc29yeUxvY2tGaWxlKG5hbWUpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbGVzeXN0ZW0tdGllciB2aWV3IGZvciB0aGUgYmFzZSBkcml2ZXIncyBgaXNBZHZpc29yeUxvY2tIZWxkYCwgd2hpY2hcbiAgICogYW5zd2VycyBmcm9tIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgZmlyc3QgYW5kIG9ubHkgYXNrcyB0aGlzIGhvb2sgd2hlblxuICAgKiB0aGUgdGllciBoYXMgbm8gb3duZXIgZm9yIHRoZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnkgbG9jayBmaWxlIGlzIGhlbGQuXG4gICAqL1xuICBhc3luYyBfaXNBZHZpc29yeUxvY2tIZWxkTmF0aXZlKG5hbWUpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5faXNBZHZpc29yeUxvY2tGaWxlSGVsZChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBhZHZpc29yeSBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgYWR2aXNvcnktbG9jayBkaXJlY3RvcnkuXG4gICAqL1xuICBfcmVzb2x2ZUFkdmlzb3J5TG9ja0RpcmVjdG9yeSgpIHtcbiAgICBpZiAoIXRoaXMuX2Fkdmlzb3J5TG9ja0RpcmVjdG9yeSkge1xuICAgICAgLy8gRmFsbCBiYWNrIHRvIGRlcml2aW5nIHRoZSBkaXJlY3RvcnkgZm9yIGNhbGxlcnMgdGhhdCBpbnZva2VkXG4gICAgICAvLyBhZHZpc29yeSBsb2NrIG1ldGhvZHMgYmVmb3JlIGBjb25uZWN0KClgIHdpcmVkIHRoZSBmaWVsZCBpbi5cbiAgICAgIGNvbnN0IGRhdGFiYXNlRGlyID0gYCR7dGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGlyZWN0b3J5KCl9L2RiYFxuXG4gICAgICB0aGlzLl9hZHZpc29yeUxvY2tEaXJlY3RvcnkgPSBwYXRoLmpvaW4oZGF0YWJhc2VEaXIsIGAke3RoaXMubG9jYWxTdG9yYWdlTmFtZSgpfS52ZWxvY2lvdXMtYWR2aXNvcnktbG9ja3NgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hZHZpc29yeUxvY2tEaXJlY3RvcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkdmlzb3J5IGxvY2sgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRmlsZXN5c3RlbSBwYXRoIGZvciB0aGUgYWR2aXNvcnkgbG9jay5cbiAgICovXG4gIF9hZHZpc29yeUxvY2tQYXRoKG5hbWUpIHtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUobmFtZSkuZGlnZXN0KFwiaGV4XCIpLnNsaWNlKDAsIDE2KVxuICAgIGNvbnN0IHNhZmVOYW1lID0gbmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOS5fLV0vZywgXCJfXCIpLnNsaWNlKDAsIDY0KVxuXG4gICAgcmV0dXJuIHBhdGguam9pbih0aGlzLl9yZXNvbHZlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KCksIGAke3NhZmVOYW1lfS0ke2hhc2h9LmxvY2tgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGFkdmlzb3J5IGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgX2Vuc3VyZUFkdmlzb3J5TG9ja0RpcmVjdG9yeSgpIHtcbiAgICBhd2FpdCBmcy5ta2Rpcih0aGlzLl9yZXNvbHZlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KCksIHtyZWN1cnNpdmU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd3JpdGUgYWR2aXNvcnkgbG9jayBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tEaXJQYXRoIC0gQWJzb2x1dGUgcGF0aCBvZiB0aGUgbG9jayBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3dyaXRlQWR2aXNvcnlMb2NrTWV0YWRhdGEobG9ja0RpclBhdGgpIHtcbiAgICBjb25zdCBvd25lclBhdGggPSBwYXRoLmpvaW4obG9ja0RpclBhdGgsIFwib3duZXIuanNvblwiKVxuICAgIGNvbnN0IHBheWxvYWQgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBwaWQ6IHByb2Nlc3MucGlkLFxuICAgICAgaG9zdG5hbWU6IG9zLmhvc3RuYW1lKCksXG4gICAgICBhY3F1aXJlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB9KVxuXG4gICAgYXdhaXQgZnMud3JpdGVGaWxlKG93bmVyUGF0aCwgcGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBQdWJsaXNoZXMgYSBmdWxseSBpbml0aWFsaXplZCBsb2NrIGRpcmVjdG9yeSB3aXRoIG9uZSBhdG9taWMgcmVuYW1lLlxuICAgKiBBIGxvc2luZyBjYW5kaWRhdGUgaXMgcmVtb3ZlZCBpbiB0aGUgc2FtZSBjYWxsLCBzbyBjb25jdXJyZW50IGFjcXVpc2l0aW9uXG4gICAqIGNhbm5vdCBvYnNlcnZlIG9yIGRlbGV0ZSBhbm90aGVyIHByb2Nlc3MncyBoYWxmLXdyaXR0ZW4gb3duZXIgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NrUGF0aCAtIFN0YWJsZSBhZHZpc29yeS1sb2NrIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhpcyBjYW5kaWRhdGUgYmVjYW1lIHRoZSBsb2NrIG93bmVyLlxuICAgKi9cbiAgYXN5bmMgX3B1Ymxpc2hBZHZpc29yeUxvY2tEaXJlY3RvcnkobG9ja1BhdGgpIHtcbiAgICBjb25zdCBjYW5kaWRhdGVQYXRoID0gYXdhaXQgZnMubWtkdGVtcChgJHtsb2NrUGF0aH0ucGVuZGluZy1gKVxuICAgIGxldCBwdWJsaXNoZWQgPSBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dyaXRlQWR2aXNvcnlMb2NrTWV0YWRhdGEoY2FuZGlkYXRlUGF0aClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZnMucmVuYW1lKGNhbmRpZGF0ZVBhdGgsIGxvY2tQYXRoKVxuICAgICAgICBwdWJsaXNoZWQgPSB0cnVlXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBjb2RlID0gLyoqIEB0eXBlIHtFcnJvciAmIHtjb2RlPzogc3RyaW5nfX0gKi8gKGVycm9yKT8uY29kZVxuXG4gICAgICAgIGlmIChjb2RlID09PSBcIkVFWElTVFwiIHx8IGNvZGUgPT09IFwiRU5PVEVNUFRZXCIpIHJldHVybiBmYWxzZVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAoIXB1Ymxpc2hlZCkgYXdhaXQgZnMucm0oY2FuZGlkYXRlUGF0aCwge2ZvcmNlOiB0cnVlLCByZWN1cnNpdmU6IHRydWV9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjcXVpcmUgYWR2aXNvcnkgbG9jayBmaWxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IGFyZ3MgLSBUaW1lb3V0IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5LWxvY2sgZmlsZSB3YXMgYWNxdWlyZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9ja0ZpbGUobmFtZSwge3RpbWVvdXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVBZHZpc29yeUxvY2tEaXJlY3RvcnkoKVxuXG4gICAgY29uc3QgbG9ja1BhdGggPSB0aGlzLl9hZHZpc29yeUxvY2tQYXRoKG5hbWUpXG4gICAgY29uc3QgZGVhZGxpbmUgPSB0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwID8gRGF0ZS5ub3coKSArIHRpbWVvdXRNcyA6IG51bGxcbiAgICBjb25zdCBwb2xsSW50ZXJ2YWxNcyA9IDUwXG5cbiAgICAvLyBJbnRlbnRpb25hbGx5IGxvb3Bpbmcgd2l0aG91dCBhIGZpeGVkIGl0ZXJhdGlvbiBjYXAg4oCUIGVpdGhlciB0aGVcbiAgICAvLyBta2RpciBzdWNjZWVkcywgdGhlIGRlYWRsaW5lIGVsYXBzZXMsIG9yIGFuIHVuZXhwZWN0ZWQgZXJyb3IgaXNcbiAgICAvLyByZS10aHJvd24uXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9wdWJsaXNoQWR2aXNvcnlMb2NrRGlyZWN0b3J5KGxvY2tQYXRoKSkgcmV0dXJuIHRydWVcblxuICAgICAgaWYgKGF3YWl0IHRoaXMuX2lzQWR2aXNvcnlMb2NrU3RhbGUobG9ja1BhdGgpKSB7XG4gICAgICAgIGF3YWl0IGZzLnJtKGxvY2tQYXRoLCB7cmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZX0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChkZWFkbGluZSAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCByZW1haW5pbmcgPSBkZWFkbGluZSAtIERhdGUubm93KClcblxuICAgICAgICBpZiAocmVtYWluaW5nIDw9IDApIHJldHVybiBmYWxzZVxuXG4gICAgICAgIGF3YWl0IHdhaXQoTWF0aC5taW4ocG9sbEludGVydmFsTXMsIHJlbWFpbmluZykpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB3YWl0KHBvbGxJbnRlcnZhbE1zKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyeSBhY3F1aXJlIGFkdmlzb3J5IGxvY2sgZmlsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5LWxvY2sgZmlsZSB3YXMgYWNxdWlyZWQgaW1tZWRpYXRlbHkuXG4gICAqL1xuICBhc3luYyBfdHJ5QWNxdWlyZUFkdmlzb3J5TG9ja0ZpbGUobmFtZSkge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUFkdmlzb3J5TG9ja0RpcmVjdG9yeSgpXG5cbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMuX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSlcblxuICAgIGlmIChhd2FpdCB0aGlzLl9wdWJsaXNoQWR2aXNvcnlMb2NrRGlyZWN0b3J5KGxvY2tQYXRoKSkgcmV0dXJuIHRydWVcblxuICAgIGlmIChhd2FpdCB0aGlzLl9pc0Fkdmlzb3J5TG9ja1N0YWxlKGxvY2tQYXRoKSkge1xuICAgICAgYXdhaXQgZnMucm0obG9ja1BhdGgsIHtyZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlfSlcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9wdWJsaXNoQWR2aXNvcnlMb2NrRGlyZWN0b3J5KGxvY2tQYXRoKVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBhZHZpc29yeSBsb2NrIGZpbGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrRmlsZShuYW1lKSB7XG4gICAgY29uc3QgbG9ja1BhdGggPSB0aGlzLl9hZHZpc29yeUxvY2tQYXRoKG5hbWUpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZnMucm0obG9ja1BhdGgsIHtyZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlfSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIEJlc3QtZWZmb3J0IHJlbGVhc2U7IGluLXByb2Nlc3Mgc3RhdGUgaXMgc3RpbGwgYXV0aG9yaXRhdGl2ZSBhbmRcbiAgICAgIC8vIHN0YWxlLWxvY2sgY2xlYW51cCBvbiB0aGUgbmV4dCBhY3F1aXJlIHdpbGwgcmVtb3ZlIHRoZSBkaXJlY3RvcnlcbiAgICAgIC8vIGlmIGl0IHJlYWxseSBpcyBzdGlsbCBsaW5nZXJpbmcuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgYWR2aXNvcnkgbG9jayBmaWxlIGhlbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeS1sb2NrIGZpbGUgZXhpc3RzIGFuZCBpcyBhY3RpdmUuXG4gICAqL1xuICBhc3luYyBfaXNBZHZpc29yeUxvY2tGaWxlSGVsZChuYW1lKSB7XG4gICAgY29uc3QgbG9ja1BhdGggPSB0aGlzLl9hZHZpc29yeUxvY2tQYXRoKG5hbWUpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZnMuc3RhdChsb2NrUGF0aClcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiAhYXdhaXQgdGhpcy5faXNBZHZpc29yeUxvY2tTdGFsZShsb2NrUGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGxvY2sgZGlyZWN0b3J5IGlzIGNvbnNpZGVyZWQgc3RhbGUgd2hlbiBpdHMgb3duZXIgbWV0YWRhdGEgbmFtZXMgYVxuICAgKiBQSUQgb24gdGhpcyBob3N0IHRoYXQgaXMgbm8gbG9uZ2VyIHJ1bm5pbmcuIENyb3NzLWhvc3Qgb3duZXJzaGlwIChhXG4gICAqIGRpZmZlcmVudCBgaG9zdG5hbWVgKSBpcyB0cmVhdGVkIGFzIGxpdmUgYmVjYXVzZSB3ZSBjYW5ub3QgcmVsaWFibHlcbiAgICogcHJvYmUgYSBQSUQgb24gYW5vdGhlciBtYWNoaW5lOyBvcGVyYXRvcnMgaW4gdGhhdCBzaXR1YXRpb24gc2hvdWxkXG4gICAqIHJlbW92ZSBzdGFsZSBsb2NrIGRpcmVjdG9yaWVzIGJ5IGhhbmQgaWYgdGhleSBsaW5nZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NrUGF0aCAtIEFic29sdXRlIHBhdGggb2YgdGhlIGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeS1sb2NrIGZpbGUgaXMgc3RhbGUuXG4gICAqL1xuICBhc3luYyBfaXNBZHZpc29yeUxvY2tTdGFsZShsb2NrUGF0aCkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgcmF3T3duZXIuXG4gICAgICogQHR5cGUge3N0cmluZ30gKi9cbiAgICBsZXQgcmF3T3duZXJcblxuICAgIHRyeSB7XG4gICAgICByYXdPd25lciA9IGF3YWl0IGZzLnJlYWRGaWxlKHBhdGguam9pbihsb2NrUGF0aCwgXCJvd25lci5qc29uXCIpLCBcInV0ZjhcIilcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIE1pc3Npbmcgb3IgdW5yZWFkYWJsZSBtZXRhZGF0YSDigJQgdHJlYXQgYXMgc3RhbGUgc28gd2UgY2FuIHJlY2xhaW0uXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlZmluZXMgb3duZXIuXG4gICAgICogQHR5cGUge3twaWQ/OiBudW1iZXIsIGhvc3RuYW1lPzogc3RyaW5nfX0gKi9cbiAgICBsZXQgb3duZXJcblxuICAgIHRyeSB7XG4gICAgICBvd25lciA9IEpTT04ucGFyc2UocmF3T3duZXIpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmICghb3duZXIgfHwgdHlwZW9mIG93bmVyLnBpZCAhPT0gXCJudW1iZXJcIikgcmV0dXJuIHRydWVcbiAgICBpZiAob3duZXIuaG9zdG5hbWUgJiYgb3duZXIuaG9zdG5hbWUgIT09IG9zLmhvc3RuYW1lKCkpIHJldHVybiBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIGBraWxsKHBpZCwgMClgIGlzIGEgbm8tb3Agc2lnbmFsIHRoYXQgZmFpbHMgd2l0aCBFU1JDSCBpZiB0aGVcbiAgICAgIC8vIHByb2Nlc3MgaXMgbm90IHJ1bm5pbmc7IHBlcm1pc3Npb24gZXJyb3JzIHN0aWxsIGluZGljYXRlIHRoZVxuICAgICAgLy8gcHJvY2VzcyBleGlzdHMgc28gd2UgdHJlYXQgdGhvc2UgYXMgXCJub3Qgc3RhbGVcIi5cbiAgICAgIHByb2Nlc3Mua2lsbChvd25lci5waWQsIDApXG5cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtFcnJvciAmIHtjb2RlPzogc3RyaW5nfX0gKi8gKGVycm9yKT8uY29kZSA9PT0gXCJFU1JDSFwiXG4gICAgfVxuICB9XG59XG4iXX0=
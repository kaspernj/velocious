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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDdEMsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUN4QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sT0FBTyxNQUFNLFNBQVMsQ0FBQTtBQUM3QixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sUUFBUSxDQUFBO0FBRTNCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLFVBQVUsTUFBTSwrQkFBK0IsQ0FBQTtBQUV0RCxNQUFNLENBQUMsT0FBTyxPQUFPLGtDQUFtQyxTQUFRLElBQUk7SUFDbEU7O3VEQUVtRDtJQUNuRCxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRXRCOztvQ0FFZ0M7SUFDaEMsc0JBQXNCLEdBQUcsU0FBUyxDQUFBO0lBRWxDLEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzNCLE1BQU0sV0FBVyxHQUFHLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQTtRQUNsRSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7UUFFeEMsSUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDbkMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJ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QUFDLEVBQUUsSUFBSSxLQUFLLE9BQU8sQ0FBQTtRQUN6RSxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7Y3JlYXRlSGFzaH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIlxuaW1wb3J0IG9zIGZyb20gXCJub2RlOm9zXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuaW1wb3J0IHF1ZXJ5IGZyb20gXCIuL3F1ZXJ5LmpzXCJcbmltcG9ydCBzcWxpdGUzIGZyb20gXCJzcWxpdGUzXCJcbmltcG9ydCB7b3Blbn0gZnJvbSBcInNxbGl0ZVwiXG5cbmltcG9ydCBCYXNlIGZyb20gXCIuL2Jhc2UuanNcIlxuaW1wb3J0IGZpbGVFeGlzdHMgZnJvbSBcIi4uLy4uLy4uL3V0aWxzL2ZpbGUtZXhpc3RzLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlTm9kZSBleHRlbmRzIEJhc2Uge1xuICAvKipcbiAgICogQ29ubmVjdGlvbi5cbiAgICogQHR5cGUge2ltcG9ydChcInNxbGl0ZVwiKS5EYXRhYmFzZSB8IHVuZGVmaW5lZH0gKi9cbiAgY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBBZHZpc29yeSBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgX2Fkdmlzb3J5TG9ja0RpcmVjdG9yeSA9IHVuZGVmaW5lZFxuXG4gIGFzeW5jIGNvbm5lY3QoKSB7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG4gICAgY29uc3QgZGF0YWJhc2VEaXIgPSBgJHt0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREaXJlY3RvcnkoKX0vZGJgXG4gICAgY29uc3QgZGF0YWJhc2VQYXRoID0gdGhpcy5kYXRhYmFzZVBhdGgoKVxuXG4gICAgaWYgKCFhd2FpdCBmaWxlRXhpc3RzKGRhdGFiYXNlRGlyKSkge1xuICAgICAgYXdhaXQgZnMubWtkaXIoZGF0YWJhc2VEaXIsIHtyZWN1cnNpdmU6IHRydWV9KVxuICAgIH1cblxuICAgIGlmIChhcmdzLnJlc2V0KSB7XG4gICAgICBhd2FpdCBmcy51bmxpbmsoZGF0YWJhc2VQYXRoKVxuICAgIH1cblxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0RpcmVjdG9yeSA9IHBhdGguam9pbihkYXRhYmFzZURpciwgYCR7dGhpcy5sb2NhbFN0b3JhZ2VOYW1lKCl9LnZlbG9jaW91cy1hZHZpc29yeS1sb2Nrc2ApXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5jb25uZWN0aW9uID0gYXdhaXQgb3Blbih7XG4gICAgICAgIGZpbGVuYW1lOiBkYXRhYmFzZVBhdGgsXG4gICAgICAgIGRyaXZlcjogc3FsaXRlMy5EYXRhYmFzZVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBvcGVuIGRhdGFiYXNlICR7ZGF0YWJhc2VQYXRofSBiZWNhdXNlIG9mICR7ZXJyb3IuY29uc3RydWN0b3IubmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3Qgb3BlbiBkYXRhYmFzZSAke2RhdGFiYXNlUGF0aH0gYmVjYXVzZSBvZiAke3R5cGVvZiBlcnJvcn06ICR7ZXJyb3J9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5yZWdpc3RlclZlcnNpb24oKVxuICB9XG5cbiAgbG9jYWxTdG9yYWdlTmFtZSgpIHtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcblxuICAgIGlmICghYXJncy5uYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBuYW1lIGdpdmVuIGZvciBTUUxpdGUgTm9kZVwiKVxuXG4gICAgcmV0dXJuIGBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGUtLS0ke2FyZ3MubmFtZX1gXG4gIH1cblxuICBkYXRhYmFzZVBhdGgoKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERpcmVjdG9yeSgpfS9kYi8ke3RoaXMubG9jYWxTdG9yYWdlTmFtZSgpfS5zcWxpdGVgXG4gIH1cblxuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uPy5jbG9zZSgpXG4gICAgdGhpcy5jb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gIH1cblxuICBhc3luYyBkZWxldGVEYXRhYmFzZVN0b3JhZ2UoKSB7XG4gICAgZm9yIChjb25zdCBzdWZmaXggb2YgW1wiXCIsIFwiLXdhbFwiLCBcIi1zaG1cIiwgXCItam91cm5hbFwiXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZnMudW5saW5rKGAke3RoaXMuZGF0YWJhc2VQYXRoKCl9JHtzdWZmaXh9YClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgXCJjb2RlXCIgaW4gZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gXCJFTk9FTlRcIikpIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5IGFjdHVhbC5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25uZWN0aW9uXCIpXG5cbiAgICBpZiAob3B0aW9ucy5zcWxpdGVTY3JpcHQpIHtcbiAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbi5leGVjKHNxbClcbiAgICAgIHJldHVybiBbXVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBxdWVyeSh0aGlzLmNvbm5lY3Rpb24sIHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIG11dGF0aW9uIHdpdGggYWZmZWN0ZWQtcm93IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gTXV0YXRpb24gU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9hZmZlY3RlZFJvd3NBY3R1YWwoc3FsKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbm5lY3Rpb25cIilcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbm5lY3Rpb24ucnVuKHNxbClcbiAgICByZXR1cm4gcmVzdWx0LmNoYW5nZXMgfHwgMFxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBmaWxlc3lzdGVtIGxvY2sgZGlyZWN0b3J5IGlzIHRoaXMgZHJpdmVyJ3MgZHJpdmVyLW5hdGl2ZSB0aWVyIG9uXG4gICAqIHRvcCBvZiB0aGUgc2hhcmVkIHByb2Nlc3MtbG9jYWwgcHJlLWZpbHRlciB0aWVyIGZyb20gdGhlIGJhc2UgZHJpdmVyLFxuICAgKiBzbyBTUUxpdGUgZGVwbG95bWVudHMgd2l0aCBtdWx0aXBsZSBOb2RlIHByb2Nlc3NlcyB3cml0aW5nIHRvIHRoZSBzYW1lXG4gICAqIGRhdGFiYXNlIGZpbGUgc2VlIGNvbnNpc3RlbnQgYWR2aXNvcnktbG9jayBtdXR1YWwgZXhjbHVzaW9uIGFjcm9zc1xuICAgKiBwcm9jZXNzZXMsIG5vdCBqdXN0IHdpdGhpbiBhIHNpbmdsZSBwcm9jZXNzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBBbHdheXMgdHJ1ZSBmb3IgdGhlIE5vZGUgU1FMaXRlIGRyaXZlci5cbiAgICovXG4gIHN1cHBvcnRzRHJpdmVyTmF0aXZlQWR2aXNvcnlMb2NrKCkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogRmlsZXN5c3RlbSBsb2NrIGRpcmVjdG9yeSBhcyB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyIG9uIHRvcCBvZiB0aGVcbiAgICogc2hhcmVkIHByb2Nlc3MtbG9jYWwgcHJlLWZpbHRlciB0aWVyIGZyb20gdGhlIGJhc2UgZHJpdmVyLCBzbyBTUUxpdGVcbiAgICogZGVwbG95bWVudHMgd2l0aCBtdWx0aXBsZSBOb2RlIHByb2Nlc3NlcyB3cml0aW5nIHRvIHRoZSBzYW1lIGRhdGFiYXNlXG4gICAqIGZpbGUgc2VlIGNvbnNpc3RlbnQgYWR2aXNvcnktbG9jayBtdXR1YWwgZXhjbHVzaW9uIGFjcm9zcyBwcm9jZXNzZXMsXG4gICAqIG5vdCBqdXN0IHdpdGhpbiBhIHNpbmdsZSBwcm9jZXNzLlxuICAgKlxuICAgKiBUaGUgYmFzZSBkcml2ZXIncyBwcm9jZXNzLWxvY2FsIHRpZXIgc2VyaWFsaXplcyBzYW1lLXByb2Nlc3MgY2FsbGVyc1xuICAgKiBmaXJzdCAobm8gZmlsZXN5c3RlbSByb3VuZCB0cmlwIGZvciB1bmNvbnRlbmRlZCB0cmFmZmljKTsgdGhpcyBob29rXG4gICAqIGlzIG9ubHkgcmVhY2hlZCBvbmNlIHRoZSB0aWVyIGhhcyBncmFudGVkIHRoZSBjYWxsZXIgaXRzIHR1cm4sIGFuZCBpdHNcbiAgICogcmVzdWx0IGlzIHdoYXQgY29uZmlybXMgY3Jvc3MtcHJvY2VzcyBleGNsdXNpb24gZm9yIFNRTGl0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgLCBgdW5kZWZpbmVkYCwgb3IgbmVnYXRpdmUgYmxvY2tzIGZvcmV2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5IGxvY2sgd2FzIGFjcXVpcmVkLlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9hY3F1aXJlQWR2aXNvcnlMb2NrRmlsZShuYW1lLCB7dGltZW91dE1zfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyeSBhY3F1aXJlIGFkdmlzb3J5IGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeSBsb2NrIHdhcyBhY3F1aXJlZCBpbW1lZGlhdGVseS5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fdHJ5QWNxdWlyZUFkdmlzb3J5TG9ja0ZpbGUobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGUgb24tZGlzayBsb2NrIGRpcmVjdG9yeSBmb3IgYSBsb2NrIHRoaXMgZHJpdmVyIGluc3RhbmNlXG4gICAqIGFjcXVpcmVkIHRocm91Z2ggdGhlIGJhc2UgZHJpdmVyJ3MgdHdvLXRpZXIgY2hhaW4uIEEgY2FsbGVyIHRoYXQgdHJpZXNcbiAgICogdG8gcmVsZWFzZSBhIGxvY2sgaXQgbmV2ZXIgYWNxdWlyZWQgKG9yIHRoYXQgd2FzIGFscmVhZHkgcmVsZWFzZWQgYnlcbiAgICogYW5vdGhlciBkcml2ZXIpIGdldHMgYGZhbHNlYCBiYWNrIGFuZCB0aGUgZmlsZXN5c3RlbSBzdGF0ZSBpcyBsZWZ0XG4gICAqIGFsb25lIHNvIHdlIG5ldmVyIGRlbGV0ZSBzb21lYm9keSBlbHNlJ3MgbG9jayBkaXJlY3RvcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeSBsb2NrIHdhcyByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMuX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5zdGF0KGxvY2tQYXRoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZUFkdmlzb3J5TG9ja0ZpbGUobmFtZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogRmlsZXN5c3RlbS10aWVyIHZpZXcgZm9yIHRoZSBiYXNlIGRyaXZlcidzIGBpc0Fkdmlzb3J5TG9ja0hlbGRgLCB3aGljaFxuICAgKiBhbnN3ZXJzIGZyb20gdGhlIHByb2Nlc3MtbG9jYWwgdGllciBmaXJzdCBhbmQgb25seSBhc2tzIHRoaXMgaG9vayB3aGVuXG4gICAqIHRoZSB0aWVyIGhhcyBubyBvd25lciBmb3IgdGhlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeSBsb2NrIGZpbGUgaXMgaGVsZC5cbiAgICovXG4gIGFzeW5jIF9pc0Fkdmlzb3J5TG9ja0hlbGROYXRpdmUobmFtZSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9pc0Fkdmlzb3J5TG9ja0ZpbGVIZWxkKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogVGhlIE5vZGUgU1FMaXRlIGRyaXZlciBsYXllcnMgdGhlIG9wdC1pbiBmaWxlIHRpZXIgb24gdG9wIG9mIHRoZVxuICAgKiBwcm9jZXNzLWxvY2FsIHByZS1maWx0ZXIsIHNvIHRlbGVtZXRyeSByZXBvcnRzIGl0IGFzIGBmaWxlYC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaWVyIG5hbWUgcmVwb3J0ZWQgb24gdGVsZW1ldHJ5IHBheWxvYWRzLlxuICAgKi9cbiAgYWR2aXNvcnlMb2NrQmFja2VuZFRpZXIoKSB7XG4gICAgcmV0dXJuIFwiZmlsZVwiXG4gIH1cblxuICAvKipcbiAgICogQXR0cmlidXRlIHRoZSBuYW1lZCBsb2NrIHRvIHRoZSBmaWxlLXRpZXIgb3duZXIgcmVjb3JkZWQgaW5cbiAgICogYG93bmVyLmpzb25gIChgcGlkQGhvc3RuYW1lYCksIGNhcHR1cmVkIGF0IHRoZSB0ZWxlbWV0cnkgZXZlbnQgbW9tZW50XG4gICAqIChiZXN0LWVmZm9ydDsgdGhlIGNhbGxlciBndWFyZHMgZmFpbHVyZXMpLiBGYWxscyBiYWNrIHRvIHRoZVxuICAgKiBwcm9jZXNzLWxvY2FsIG93bmVyIHdoZW4gdGhlIGZpbGVzeXN0ZW0gbG9jayBpcyBub3QgdGhlIGhvbGRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIEZpbGUgbG9jayBvd25lciBpZGVudGl0eSwgb3IgbnVsbCB3aGVuIG5vIHByb2Nlc3MgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBhZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSkge1xuICAgIGNvbnN0IGxvY2tQYXRoID0gdGhpcy5fYWR2aXNvcnlMb2NrUGF0aChuYW1lKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShwYXRoLmpvaW4obG9ja1BhdGgsIFwib3duZXIuanNvblwiKSwgXCJ1dGY4XCIpXG4gICAgICBjb25zdCBvd25lciA9IEpTT04ucGFyc2UoY29udGVudClcblxuICAgICAgaWYgKG93bmVyICYmIHR5cGVvZiBvd25lci5waWQgPT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIG93bmVyLmhvc3RuYW1lID09PSBcInN0cmluZ1wiKSByZXR1cm4gYCR7b3duZXIucGlkfUAke293bmVyLmhvc3RuYW1lfWBcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIE5vIGZpbGUgbG9jayBkaXJlY3Rvcnkgb3IgdW5yZWFkYWJsZSBtZXRhZGF0YTogZmFsbCB0aHJvdWdoIHRvIHRoZVxuICAgICAgLy8gaW4tcHJvY2VzcyBvd25lciBiZWxvdy5cbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgc3VwZXIuYWR2aXNvcnlMb2NrSG9sZGVyQ29ubmVjdGlvbklkKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGFkdmlzb3J5IGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBhZHZpc29yeS1sb2NrIGRpcmVjdG9yeS5cbiAgICovXG4gIF9yZXNvbHZlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KCkge1xuICAgIGlmICghdGhpcy5fYWR2aXNvcnlMb2NrRGlyZWN0b3J5KSB7XG4gICAgICAvLyBGYWxsIGJhY2sgdG8gZGVyaXZpbmcgdGhlIGRpcmVjdG9yeSBmb3IgY2FsbGVycyB0aGF0IGludm9rZWRcbiAgICAgIC8vIGFkdmlzb3J5IGxvY2sgbWV0aG9kcyBiZWZvcmUgYGNvbm5lY3QoKWAgd2lyZWQgdGhlIGZpZWxkIGluLlxuICAgICAgY29uc3QgZGF0YWJhc2VEaXIgPSBgJHt0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREaXJlY3RvcnkoKX0vZGJgXG5cbiAgICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0RpcmVjdG9yeSA9IHBhdGguam9pbihkYXRhYmFzZURpciwgYCR7dGhpcy5sb2NhbFN0b3JhZ2VOYW1lKCl9LnZlbG9jaW91cy1hZHZpc29yeS1sb2Nrc2ApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja0RpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWR2aXNvcnkgbG9jayBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGaWxlc3lzdGVtIHBhdGggZm9yIHRoZSBhZHZpc29yeSBsb2NrLlxuICAgKi9cbiAgX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSkge1xuICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShuYW1lKS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMTYpXG4gICAgY29uc3Qgc2FmZU5hbWUgPSBuYW1lLnJlcGxhY2UoL1teYS16QS1aMC05Ll8tXS9nLCBcIl9cIikuc2xpY2UoMCwgNjQpXG5cbiAgICByZXR1cm4gcGF0aC5qb2luKHRoaXMuX3Jlc29sdmVBZHZpc29yeUxvY2tEaXJlY3RvcnkoKSwgYCR7c2FmZU5hbWV9LSR7aGFzaH0ubG9ja2ApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgYWR2aXNvcnkgbG9jayBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBfZW5zdXJlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KCkge1xuICAgIGF3YWl0IGZzLm1rZGlyKHRoaXMuX3Jlc29sdmVBZHZpc29yeUxvY2tEaXJlY3RvcnkoKSwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3cml0ZSBhZHZpc29yeSBsb2NrIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9ja0RpclBhdGggLSBBYnNvbHV0ZSBwYXRoIG9mIHRoZSBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfd3JpdGVBZHZpc29yeUxvY2tNZXRhZGF0YShsb2NrRGlyUGF0aCkge1xuICAgIGNvbnN0IG93bmVyUGF0aCA9IHBhdGguam9pbihsb2NrRGlyUGF0aCwgXCJvd25lci5qc29uXCIpXG4gICAgY29uc3QgcGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIHBpZDogcHJvY2Vzcy5waWQsXG4gICAgICBob3N0bmFtZTogb3MuaG9zdG5hbWUoKSxcbiAgICAgIGFjcXVpcmVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIH0pXG5cbiAgICBhd2FpdCBmcy53cml0ZUZpbGUob3duZXJQYXRoLCBwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyBhIGZ1bGx5IGluaXRpYWxpemVkIGxvY2sgZGlyZWN0b3J5IHdpdGggb25lIGF0b21pYyByZW5hbWUuXG4gICAqIEEgbG9zaW5nIGNhbmRpZGF0ZSBpcyByZW1vdmVkIGluIHRoZSBzYW1lIGNhbGwsIHNvIGNvbmN1cnJlbnQgYWNxdWlzaXRpb25cbiAgICogY2Fubm90IG9ic2VydmUgb3IgZGVsZXRlIGFub3RoZXIgcHJvY2VzcydzIGhhbGYtd3JpdHRlbiBvd25lciBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tQYXRoIC0gU3RhYmxlIGFkdmlzb3J5LWxvY2sgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGlzIGNhbmRpZGF0ZSBiZWNhbWUgdGhlIGxvY2sgb3duZXIuXG4gICAqL1xuICBhc3luYyBfcHVibGlzaEFkdmlzb3J5TG9ja0RpcmVjdG9yeShsb2NrUGF0aCkge1xuICAgIGNvbnN0IGNhbmRpZGF0ZVBhdGggPSBhd2FpdCBmcy5ta2R0ZW1wKGAke2xvY2tQYXRofS5wZW5kaW5nLWApXG4gICAgbGV0IHB1Ymxpc2hlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fd3JpdGVBZHZpc29yeUxvY2tNZXRhZGF0YShjYW5kaWRhdGVQYXRoKVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmcy5yZW5hbWUoY2FuZGlkYXRlUGF0aCwgbG9ja1BhdGgpXG4gICAgICAgIHB1Ymxpc2hlZCA9IHRydWVcbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGNvZGUgPSAvKiogQHR5cGUge0Vycm9yICYge2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpPy5jb2RlXG5cbiAgICAgICAgaWYgKGNvZGUgPT09IFwiRUVYSVNUXCIgfHwgY29kZSA9PT0gXCJFTk9URU1QVFlcIikgcmV0dXJuIGZhbHNlXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghcHVibGlzaGVkKSBhd2FpdCBmcy5ybShjYW5kaWRhdGVQYXRoLCB7Zm9yY2U6IHRydWUsIHJlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNxdWlyZSBhZHZpc29yeSBsb2NrIGZpbGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gYXJncyAtIFRpbWVvdXQgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnktbG9jayBmaWxlIHdhcyBhY3F1aXJlZC5cbiAgICovXG4gIGFzeW5jIF9hY3F1aXJlQWR2aXNvcnlMb2NrRmlsZShuYW1lLCB7dGltZW91dE1zfSkge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUFkdmlzb3J5TG9ja0RpcmVjdG9yeSgpXG5cbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMuX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSlcbiAgICBjb25zdCBkZWFkbGluZSA9IHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDAgPyBEYXRlLm5vdygpICsgdGltZW91dE1zIDogbnVsbFxuICAgIGNvbnN0IHBvbGxJbnRlcnZhbE1zID0gNTBcblxuICAgIC8vIEludGVudGlvbmFsbHkgbG9vcGluZyB3aXRob3V0IGEgZml4ZWQgaXRlcmF0aW9uIGNhcCDigJQgZWl0aGVyIHRoZVxuICAgIC8vIG1rZGlyIHN1Y2NlZWRzLCB0aGUgZGVhZGxpbmUgZWxhcHNlcywgb3IgYW4gdW5leHBlY3RlZCBlcnJvciBpc1xuICAgIC8vIHJlLXRocm93bi5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX3B1Ymxpc2hBZHZpc29yeUxvY2tEaXJlY3RvcnkobG9ja1BhdGgpKSByZXR1cm4gdHJ1ZVxuXG4gICAgICBpZiAoYXdhaXQgdGhpcy5faXNBZHZpc29yeUxvY2tTdGFsZShsb2NrUGF0aCkpIHtcbiAgICAgICAgYXdhaXQgZnMucm0obG9ja1BhdGgsIHtyZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGRlYWRsaW5lICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IHJlbWFpbmluZyA9IGRlYWRsaW5lIC0gRGF0ZS5ub3coKVxuXG4gICAgICAgIGlmIChyZW1haW5pbmcgPD0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICAgICAgYXdhaXQgd2FpdChNYXRoLm1pbihwb2xsSW50ZXJ2YWxNcywgcmVtYWluaW5nKSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHdhaXQocG9sbEludGVydmFsTXMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jayBmaWxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnktbG9jayBmaWxlIHdhcyBhY3F1aXJlZCBpbW1lZGlhdGVseS5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrRmlsZShuYW1lKSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQWR2aXNvcnlMb2NrRGlyZWN0b3J5KClcblxuICAgIGNvbnN0IGxvY2tQYXRoID0gdGhpcy5fYWR2aXNvcnlMb2NrUGF0aChuYW1lKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX3B1Ymxpc2hBZHZpc29yeUxvY2tEaXJlY3RvcnkobG9ja1BhdGgpKSByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2lzQWR2aXNvcnlMb2NrU3RhbGUobG9ja1BhdGgpKSB7XG4gICAgICBhd2FpdCBmcy5ybShsb2NrUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWV9KVxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3B1Ymxpc2hBZHZpc29yeUxvY2tEaXJlY3RvcnkobG9ja1BhdGgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxlYXNlIGFkdmlzb3J5IGxvY2sgZmlsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VBZHZpc29yeUxvY2tGaWxlKG5hbWUpIHtcbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMuX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5ybShsb2NrUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWV9KVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQmVzdC1lZmZvcnQgcmVsZWFzZTsgaW4tcHJvY2VzcyBzdGF0ZSBpcyBzdGlsbCBhdXRob3JpdGF0aXZlIGFuZFxuICAgICAgLy8gc3RhbGUtbG9jayBjbGVhbnVwIG9uIHRoZSBuZXh0IGFjcXVpcmUgd2lsbCByZW1vdmUgdGhlIGRpcmVjdG9yeVxuICAgICAgLy8gaWYgaXQgcmVhbGx5IGlzIHN0aWxsIGxpbmdlcmluZy5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBhZHZpc29yeSBsb2NrIGZpbGUgaGVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5LWxvY2sgZmlsZSBleGlzdHMgYW5kIGlzIGFjdGl2ZS5cbiAgICovXG4gIGFzeW5jIF9pc0Fkdmlzb3J5TG9ja0ZpbGVIZWxkKG5hbWUpIHtcbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMuX2Fkdmlzb3J5TG9ja1BhdGgobmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5zdGF0KGxvY2tQYXRoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuICFhd2FpdCB0aGlzLl9pc0Fkdmlzb3J5TG9ja1N0YWxlKGxvY2tQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIEEgbG9jayBkaXJlY3RvcnkgaXMgY29uc2lkZXJlZCBzdGFsZSB3aGVuIGl0cyBvd25lciBtZXRhZGF0YSBuYW1lcyBhXG4gICAqIFBJRCBvbiB0aGlzIGhvc3QgdGhhdCBpcyBubyBsb25nZXIgcnVubmluZy4gQ3Jvc3MtaG9zdCBvd25lcnNoaXAgKGFcbiAgICogZGlmZmVyZW50IGBob3N0bmFtZWApIGlzIHRyZWF0ZWQgYXMgbGl2ZSBiZWNhdXNlIHdlIGNhbm5vdCByZWxpYWJseVxuICAgKiBwcm9iZSBhIFBJRCBvbiBhbm90aGVyIG1hY2hpbmU7IG9wZXJhdG9ycyBpbiB0aGF0IHNpdHVhdGlvbiBzaG91bGRcbiAgICogcmVtb3ZlIHN0YWxlIGxvY2sgZGlyZWN0b3JpZXMgYnkgaGFuZCBpZiB0aGV5IGxpbmdlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tQYXRoIC0gQWJzb2x1dGUgcGF0aCBvZiB0aGUgbG9jayBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5LWxvY2sgZmlsZSBpcyBzdGFsZS5cbiAgICovXG4gIGFzeW5jIF9pc0Fkdmlzb3J5TG9ja1N0YWxlKGxvY2tQYXRoKSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyByYXdPd25lci5cbiAgICAgKiBAdHlwZSB7c3RyaW5nfSAqL1xuICAgIGxldCByYXdPd25lclxuXG4gICAgdHJ5IHtcbiAgICAgIHJhd093bmVyID0gYXdhaXQgZnMucmVhZEZpbGUocGF0aC5qb2luKGxvY2tQYXRoLCBcIm93bmVyLmpzb25cIiksIFwidXRmOFwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTWlzc2luZyBvciB1bnJlYWRhYmxlIG1ldGFkYXRhIOKAlCB0cmVhdCBhcyBzdGFsZSBzbyB3ZSBjYW4gcmVjbGFpbS5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBvd25lci5cbiAgICAgKiBAdHlwZSB7e3BpZD86IG51bWJlciwgaG9zdG5hbWU/OiBzdHJpbmd9fSAqL1xuICAgIGxldCBvd25lclxuXG4gICAgdHJ5IHtcbiAgICAgIG93bmVyID0gSlNPTi5wYXJzZShyYXdPd25lcilcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFvd25lciB8fCB0eXBlb2Ygb3duZXIucGlkICE9PSBcIm51bWJlclwiKSByZXR1cm4gdHJ1ZVxuICAgIGlmIChvd25lci5ob3N0bmFtZSAmJiBvd25lci5ob3N0bmFtZSAhPT0gb3MuaG9zdG5hbWUoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgLy8gYGtpbGwocGlkLCAwKWAgaXMgYSBuby1vcCBzaWduYWwgdGhhdCBmYWlscyB3aXRoIEVTUkNIIGlmIHRoZVxuICAgICAgLy8gcHJvY2VzcyBpcyBub3QgcnVubmluZzsgcGVybWlzc2lvbiBlcnJvcnMgc3RpbGwgaW5kaWNhdGUgdGhlXG4gICAgICAvLyBwcm9jZXNzIGV4aXN0cyBzbyB3ZSB0cmVhdCB0aG9zZSBhcyBcIm5vdCBzdGFsZVwiLlxuICAgICAgcHJvY2Vzcy5raWxsKG93bmVyLnBpZCwgMClcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge0Vycm9yICYge2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpPy5jb2RlID09PSBcIkVTUkNIXCJcbiAgICB9XG4gIH1cbn1cbiJdfQ==
// @ts-check
import ConnectionSqlJs from "./connection-sql-js.js";
import initSqlJs from "sql.js";
import { createSqliteWebPersistence, deleteSqliteWebPersistences, sqliteWebPersistenceKey } from "./web-persistence.js";
import Base from "./base.js";
/**
 * VelociousDatabaseDriversSqliteWeb class.
 * @typedef {{query: (sql: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>}} SqliteWebConnection
 */
export default class VelociousDatabaseDriversSqliteWeb extends Base {
    /**
     * Connection.
     * @type {ConnectionSqlJs | undefined} */
    _connection = undefined;
    /** @type {SqliteWebConnection | undefined} */
    _externalConnection = undefined;
    /**
     * Runs sql js locate file.
     * @returns {(file: string) => string} - locateFile callback for sql.js.
     */
    sqlJsLocateFile() {
        const locateFile = this.getArgs().locateFile;
        if (typeof locateFile === "function") {
            return locateFile;
        }
        return (file) => `https://sql.js.org/dist/${file}`;
    }
    async connect() {
        this.args = this.getArgs();
        if (this.args.getConnection) {
            this._externalConnection = this.args.getConnection();
            return;
        }
        if (this.args.reset) {
            await deleteSqliteWebPersistences({ databaseName: this.databaseName() });
        }
        const persistence = await createSqliteWebPersistence({ databaseName: this.databaseName() });
        const SQL = await initSqlJs({ locateFile: this.sqlJsLocateFile() });
        const databaseContent = await persistence.load();
        const connectionSqlJs = new ConnectionSqlJs(this, new SQL.Database(databaseContent), persistence);
        this._connection = connectionSqlJs;
    }
    async _close() {
        await this.getConnection().close();
    }
    /**
     * Flushes pending SQL.js local persistence writes.
     * @returns {Promise<void>} - Resolves when pending writes are durable.
     */
    async flushPendingWrites() {
        if (!this.args?.getConnection) {
            if (!this._connection)
                throw new Error("SQLite web connection has not been initialized");
            await this._connection.flushDatabaseSave();
        }
    }
    hasPendingWrites() {
        return Boolean(!this.args?.getConnection && this._connection?.hasPendingDatabaseSave());
    }
    async deleteDatabaseStorage() {
        await deleteSqliteWebPersistences({ databaseName: this.databaseName() });
    }
    /**
     * Starts an outer transaction after draining SQL.js persistence admission.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when the transaction starts.
     */
    async startTransaction(options = {}) {
        if (!this.args?.getConnection) {
            if (!this._connection)
                throw new Error("SQLite web connection has not been initialized");
            try {
                await super.startTransaction(options);
            }
            finally {
                this._connection.completeTransactionStart();
            }
            return;
        }
        await super.startTransaction(options);
    }
    /**
     * Coordinates SQL BEGIN with active and queued persistence exports.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when the transaction starts.
     */
    async _startTransactionAction(options = {}) {
        if (!this.args?.getConnection) {
            if (!this._connection)
                throw new Error("SQLite web connection has not been initialized");
            await this._connection.withTransactionStart(async () => {
                await super._startTransactionAction(options);
            });
            return;
        }
        await super._startTransactionAction(options);
    }
    /**
     * Commits and persists bytes after the outermost SQL.js transaction closes.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when committed bytes are persisted.
     */
    async commitTransaction(options = {}) {
        const outermostTransaction = this._transactionsCount === 1;
        await super.commitTransaction(options);
        if (outermostTransaction && !this.args?.getConnection) {
            if (!this._connection)
                throw new Error("SQLite web connection has not been initialized");
            await this._connection.flushPendingDatabaseSave();
        }
    }
    /**
     * Rolls back and persists bytes after the outermost SQL.js transaction closes.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when rolled-back bytes are persisted.
     */
    async rollbackTransaction(options = {}) {
        const outermostTransaction = this._transactionsCount === 1;
        await super.rollbackTransaction(options);
        if (outermostTransaction && !this.args?.getConnection) {
            if (!this._connection)
                throw new Error("SQLite web connection has not been initialized");
            await this._connection.flushPendingDatabaseSave();
        }
    }
    /**
     * Runs get connection.
     * @returns {ConnectionSqlJs | SqliteWebConnection} - The connection.
     */
    getConnection() {
        if (this.args?.getConnection) {
            if (!this._externalConnection)
                throw new Error("SQLite web external connection has not been initialized");
            return this._externalConnection;
        }
        else {
            if (!this._connection)
                throw new Error("SQLite web connection has not been initialized");
            return this._connection;
        }
    }
    localStorageName() {
        return sqliteWebPersistenceKey(this.databaseName());
    }
    /**
     * Returns the configured database name.
     * @returns {string} - Database name.
     */
    databaseName() {
        const name = this.getArgs().name;
        if (typeof name !== "string" || name.length < 1)
            throw new Error("No name given in arguments for SQLite Web database");
        return name;
    }
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @param {import("../base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the query actual.
     */
    async _queryActual(sql, options = {}) {
        const connection = this.getConnection();
        const result = connection instanceof ConnectionSqlJs
            ? await connection.query(sql, { mutation: options.sqliteScript === true })
            : await connection.query(sql);
        if (!Array.isArray(result)) {
            const connectionName = connection?.constructor?.name || "UnknownConnection";
            throw new Error(`Sqlite web connection ${connectionName} returned a non-array result: ${typeof result}`);
        }
        return result;
    }
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    async _affectedRowsActual(sql) {
        const connection = this.getConnection();
        return await connection.affectedRows(sql);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgud2ViLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvc3FsaXRlL2luZGV4LndlYi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxlQUFlLE1BQU0sd0JBQXdCLENBQUE7QUFDcEQsT0FBTyxTQUFTLE1BQU0sUUFBUSxDQUFBO0FBQzlCLE9BQU8sRUFBQywwQkFBMEIsRUFBRSwyQkFBMkIsRUFBRSx1QkFBdUIsRUFBQyxNQUFNLHNCQUFzQixDQUFBO0FBRXJILE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUU1Qjs7O0dBR0c7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLGlDQUFrQyxTQUFRLElBQUk7SUFDakU7OzZDQUV5QztJQUN6QyxXQUFXLEdBQUcsU0FBUyxDQUFBO0lBRXZCLDhDQUE4QztJQUM5QyxtQkFBbUIsR0FBRyxTQUFTLENBQUE7SUFFL0I7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxVQUFVLENBQUE7UUFFNUMsSUFBSSxPQUFPLFVBQVUsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUNyQyxPQUFPLFVBQVUsQ0FBQTtRQUNuQixDQUFDO1FBRUQsT0FBTyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsMkJBQTJCLElBQUksRUFBRSxDQUFBO0lBQ3BELENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTztRQUNYLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRTFCLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUM1QixJQUFJLENBQUMsbUJBQW1CLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQTtZQUNwRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLElBQUksQ0FB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TUFBTSxFQUFFLENBQUMsQ0FBQTtRQUMxRyxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHO1FBQzNCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUN2QyxPQUFPLE1BQU0sVUFBVSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUMzQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbm5lY3Rpb25TcWxKcyBmcm9tIFwiLi9jb25uZWN0aW9uLXNxbC1qcy5qc1wiXG5pbXBvcnQgaW5pdFNxbEpzIGZyb20gXCJzcWwuanNcIlxuaW1wb3J0IHtjcmVhdGVTcWxpdGVXZWJQZXJzaXN0ZW5jZSwgZGVsZXRlU3FsaXRlV2ViUGVyc2lzdGVuY2VzLCBzcWxpdGVXZWJQZXJzaXN0ZW5jZUtleX0gZnJvbSBcIi4vd2ViLXBlcnNpc3RlbmNlLmpzXCJcblxuaW1wb3J0IEJhc2UgZnJvbSBcIi4vYmFzZS5qc1wiXG5cbi8qKlxuICogVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlV2ViIGNsYXNzLlxuICogQHR5cGVkZWYge3txdWVyeTogKHNxbDogc3RyaW5nKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPiwgYWZmZWN0ZWRSb3dzOiAoc3FsOiBzdHJpbmcpID0+IFByb21pc2U8bnVtYmVyPiwgY2xvc2U6ICgpID0+IFByb21pc2U8dm9pZD59fSBTcWxpdGVXZWJDb25uZWN0aW9uXG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlV2ViIGV4dGVuZHMgQmFzZSB7XG4gIC8qKlxuICAgKiBDb25uZWN0aW9uLlxuICAgKiBAdHlwZSB7Q29ubmVjdGlvblNxbEpzIHwgdW5kZWZpbmVkfSAqL1xuICBfY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKiBAdHlwZSB7U3FsaXRlV2ViQ29ubmVjdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgX2V4dGVybmFsQ29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIHNxbCBqcyBsb2NhdGUgZmlsZS5cbiAgICogQHJldHVybnMgeyhmaWxlOiBzdHJpbmcpID0+IHN0cmluZ30gLSBsb2NhdGVGaWxlIGNhbGxiYWNrIGZvciBzcWwuanMuXG4gICAqL1xuICBzcWxKc0xvY2F0ZUZpbGUoKSB7XG4gICAgY29uc3QgbG9jYXRlRmlsZSA9IHRoaXMuZ2V0QXJncygpLmxvY2F0ZUZpbGVcblxuICAgIGlmICh0eXBlb2YgbG9jYXRlRmlsZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gbG9jYXRlRmlsZVxuICAgIH1cblxuICAgIHJldHVybiAoZmlsZSkgPT4gYGh0dHBzOi8vc3FsLmpzLm9yZy9kaXN0LyR7ZmlsZX1gXG4gIH1cblxuICBhc3luYyBjb25uZWN0KCkge1xuICAgIHRoaXMuYXJncyA9IHRoaXMuZ2V0QXJncygpXG5cbiAgICBpZiAodGhpcy5hcmdzLmdldENvbm5lY3Rpb24pIHtcbiAgICAgIHRoaXMuX2V4dGVybmFsQ29ubmVjdGlvbiA9IHRoaXMuYXJncy5nZXRDb25uZWN0aW9uKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLmFyZ3MucmVzZXQpIHtcbiAgICAgIGF3YWl0IGRlbGV0ZVNxbGl0ZVdlYlBlcnNpc3RlbmNlcyh7ZGF0YWJhc2VOYW1lOiB0aGlzLmRhdGFiYXNlTmFtZSgpfSlcbiAgICB9XG5cbiAgICBjb25zdCBwZXJzaXN0ZW5jZSA9IGF3YWl0IGNyZWF0ZVNxbGl0ZVdlYlBlcnNpc3RlbmNlKHtkYXRhYmFzZU5hbWU6IHRoaXMuZGF0YWJhc2VOYW1lKCl9KVxuICAgIGNvbnN0IFNRTCA9IGF3YWl0IGluaXRTcWxKcyh7bG9jYXRlRmlsZTogdGhpcy5zcWxKc0xvY2F0ZUZpbGUoKX0pXG4gICAgY29uc3QgZGF0YWJhc2VDb250ZW50ID0gYXdhaXQgcGVyc2lzdGVuY2UubG9hZCgpXG4gICAgY29uc3QgY29ubmVjdGlvblNxbEpzID0gbmV3IENvbm5lY3Rpb25TcWxKcyh0aGlzLCBuZXcgU1FMLkRhdGFiYXNlKGRhdGFiYXNlQ29udGVudCksIHBlcnNpc3RlbmNlKVxuXG4gICAgdGhpcy5fY29ubmVjdGlvbiA9IGNvbm5lY3Rpb25TcWxKc1xuICB9XG5cbiAgYXN5bmMgX2Nsb3NlKCkge1xuICAgIGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGlvbigpLmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaGVzIHBlbmRpbmcgU1FMLmpzIGxvY2FsIHBlcnNpc3RlbmNlIHdyaXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIHdyaXRlcyBhcmUgZHVyYWJsZS5cbiAgICovXG4gIGFzeW5jIGZsdXNoUGVuZGluZ1dyaXRlcygpIHtcbiAgICBpZiAoIXRoaXMuYXJncz8uZ2V0Q29ubmVjdGlvbikge1xuICAgICAgaWYgKCF0aGlzLl9jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJTUUxpdGUgd2ViIGNvbm5lY3Rpb24gaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkXCIpXG5cbiAgICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24uZmx1c2hEYXRhYmFzZVNhdmUoKVxuICAgIH1cbiAgfVxuXG4gIGhhc1BlbmRpbmdXcml0ZXMoKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4oIXRoaXMuYXJncz8uZ2V0Q29ubmVjdGlvbiAmJiB0aGlzLl9jb25uZWN0aW9uPy5oYXNQZW5kaW5nRGF0YWJhc2VTYXZlKCkpXG4gIH1cblxuICBhc3luYyBkZWxldGVEYXRhYmFzZVN0b3JhZ2UoKSB7XG4gICAgYXdhaXQgZGVsZXRlU3FsaXRlV2ViUGVyc2lzdGVuY2VzKHtkYXRhYmFzZU5hbWU6IHRoaXMuZGF0YWJhc2VOYW1lKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhbiBvdXRlciB0cmFuc2FjdGlvbiBhZnRlciBkcmFpbmluZyBTUUwuanMgcGVyc2lzdGVuY2UgYWRtaXNzaW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgdHJhbnNhY3Rpb24gc3RhcnRzLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRUcmFuc2FjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIXRoaXMuYXJncz8uZ2V0Q29ubmVjdGlvbikge1xuICAgICAgaWYgKCF0aGlzLl9jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJTUUxpdGUgd2ViIGNvbm5lY3Rpb24gaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHN1cGVyLnN0YXJ0VHJhbnNhY3Rpb24ob3B0aW9ucylcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3Rpb24uY29tcGxldGVUcmFuc2FjdGlvblN0YXJ0KClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgc3VwZXIuc3RhcnRUcmFuc2FjdGlvbihvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIENvb3JkaW5hdGVzIFNRTCBCRUdJTiB3aXRoIGFjdGl2ZSBhbmQgcXVldWVkIHBlcnNpc3RlbmNlIGV4cG9ydHMuXG4gICAqIEBwYXJhbSB7UGljazxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSB0cmFuc2FjdGlvbiBzdGFydHMuXG4gICAqL1xuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIXRoaXMuYXJncz8uZ2V0Q29ubmVjdGlvbikge1xuICAgICAgaWYgKCF0aGlzLl9jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJTUUxpdGUgd2ViIGNvbm5lY3Rpb24gaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkXCIpXG5cbiAgICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24ud2l0aFRyYW5zYWN0aW9uU3RhcnQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBzdXBlci5fc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zKVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgc3VwZXIuX3N0YXJ0VHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21taXRzIGFuZCBwZXJzaXN0cyBieXRlcyBhZnRlciB0aGUgb3V0ZXJtb3N0IFNRTC5qcyB0cmFuc2FjdGlvbiBjbG9zZXMuXG4gICAqIEBwYXJhbSB7UGljazxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbW1pdHRlZCBieXRlcyBhcmUgcGVyc2lzdGVkLlxuICAgKi9cbiAgYXN5bmMgY29tbWl0VHJhbnNhY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgb3V0ZXJtb3N0VHJhbnNhY3Rpb24gPSB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9PT0gMVxuXG4gICAgYXdhaXQgc3VwZXIuY29tbWl0VHJhbnNhY3Rpb24ob3B0aW9ucylcblxuICAgIGlmIChvdXRlcm1vc3RUcmFuc2FjdGlvbiAmJiAhdGhpcy5hcmdzPy5nZXRDb25uZWN0aW9uKSB7XG4gICAgICBpZiAoIXRoaXMuX2Nvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlNRTGl0ZSB3ZWIgY29ubmVjdGlvbiBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWRcIilcblxuICAgICAgYXdhaXQgdGhpcy5fY29ubmVjdGlvbi5mbHVzaFBlbmRpbmdEYXRhYmFzZVNhdmUoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSb2xscyBiYWNrIGFuZCBwZXJzaXN0cyBieXRlcyBhZnRlciB0aGUgb3V0ZXJtb3N0IFNRTC5qcyB0cmFuc2FjdGlvbiBjbG9zZXMuXG4gICAqIEBwYXJhbSB7UGljazxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJvbGxlZC1iYWNrIGJ5dGVzIGFyZSBwZXJzaXN0ZWQuXG4gICAqL1xuICBhc3luYyByb2xsYmFja1RyYW5zYWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IG91dGVybW9zdFRyYW5zYWN0aW9uID0gdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPT09IDFcblxuICAgIGF3YWl0IHN1cGVyLnJvbGxiYWNrVHJhbnNhY3Rpb24ob3B0aW9ucylcblxuICAgIGlmIChvdXRlcm1vc3RUcmFuc2FjdGlvbiAmJiAhdGhpcy5hcmdzPy5nZXRDb25uZWN0aW9uKSB7XG4gICAgICBpZiAoIXRoaXMuX2Nvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlNRTGl0ZSB3ZWIgY29ubmVjdGlvbiBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWRcIilcblxuICAgICAgYXdhaXQgdGhpcy5fY29ubmVjdGlvbi5mbHVzaFBlbmRpbmdEYXRhYmFzZVNhdmUoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Q29ubmVjdGlvblNxbEpzIHwgU3FsaXRlV2ViQ29ubmVjdGlvbn0gLSBUaGUgY29ubmVjdGlvbi5cbiAgICovXG4gIGdldENvbm5lY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuYXJncz8uZ2V0Q29ubmVjdGlvbikge1xuICAgICAgaWYgKCF0aGlzLl9leHRlcm5hbENvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlNRTGl0ZSB3ZWIgZXh0ZXJuYWwgY29ubmVjdGlvbiBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWRcIilcblxuICAgICAgcmV0dXJuIHRoaXMuX2V4dGVybmFsQ29ubmVjdGlvblxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIXRoaXMuX2Nvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlNRTGl0ZSB3ZWIgY29ubmVjdGlvbiBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWRcIilcbiAgICAgIHJldHVybiB0aGlzLl9jb25uZWN0aW9uXG4gICAgfVxuICB9XG5cbiAgbG9jYWxTdG9yYWdlTmFtZSgpIHtcbiAgICByZXR1cm4gc3FsaXRlV2ViUGVyc2lzdGVuY2VLZXkodGhpcy5kYXRhYmFzZU5hbWUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb25maWd1cmVkIGRhdGFiYXNlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGF0YWJhc2UgbmFtZS5cbiAgICovXG4gIGRhdGFiYXNlTmFtZSgpIHtcbiAgICBjb25zdCBuYW1lID0gdGhpcy5nZXRBcmdzKCkubmFtZVxuXG4gICAgaWYgKHR5cGVvZiBuYW1lICE9PSBcInN0cmluZ1wiIHx8IG5hbWUubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gbmFtZSBnaXZlbiBpbiBhcmd1bWVudHMgZm9yIFNRTGl0ZSBXZWIgZGF0YWJhc2VcIilcblxuICAgIHJldHVybiBuYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkgYWN0dWFsLlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuZ2V0Q29ubmVjdGlvbigpXG4gICAgY29uc3QgcmVzdWx0ID0gY29ubmVjdGlvbiBpbnN0YW5jZW9mIENvbm5lY3Rpb25TcWxKc1xuICAgICAgPyBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KHNxbCwge211dGF0aW9uOiBvcHRpb25zLnNxbGl0ZVNjcmlwdCA9PT0gdHJ1ZX0pXG4gICAgICA6IGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoc3FsKVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc3VsdCkpIHtcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb25OYW1lID0gY29ubmVjdGlvbj8uY29uc3RydWN0b3I/Lm5hbWUgfHwgXCJVbmtub3duQ29ubmVjdGlvblwiXG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3FsaXRlIHdlYiBjb25uZWN0aW9uICR7Y29ubmVjdGlvbk5hbWV9IHJldHVybmVkIGEgbm9uLWFycmF5IHJlc3VsdDogJHt0eXBlb2YgcmVzdWx0fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gd2l0aCBhZmZlY3RlZC1yb3cgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5nZXRDb25uZWN0aW9uKClcbiAgICByZXR1cm4gYXdhaXQgY29ubmVjdGlvbi5hZmZlY3RlZFJvd3Moc3FsKVxuICB9XG59XG4iXX0=
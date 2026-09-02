// @ts-check
import debounce from "debounce";
import Mutex from "epic-locks/build/mutex.js";
import queryWeb from "./query.web.js";
export default class VelociousDatabaseDriversSqliteConnectionSqlJs {
    /**
     * Runs constructor.
     * @param {import("../base.js").default} driver - Database driver instance.
     * @param {import("sql.js").Database} connection - Connection.
     * @param {import("./web-persistence.js").SqliteWebPersistence} persistence - Database persistence adapter.
     */
    constructor(driver, connection, persistence) {
        this.connection = connection;
        this.databaseSaveDeferred = false;
        this.databaseSaveMutex = new Mutex();
        this.databaseTransactionStarting = false;
        this.driver = driver;
        this.persistence = persistence;
    }
    async close() {
        await this.flushDatabaseSave();
        await this.connection.close();
    }
    /**
     * Flushes any debounced database save and waits until persistence is complete.
     * @returns {Promise<void>} - Resolves when the current database bytes are stored.
     */
    async flushDatabaseSave() {
        this.saveDatabaseDebounce.clear();
        await this.saveDatabase();
    }
    /**
     * Flushes only when a mutation save is pending or was deferred by a transaction.
     * @returns {Promise<void>} - Resolves when pending database bytes are stored.
     */
    async flushPendingDatabaseSave() {
        if (!this.saveDatabaseDebounce.isPending && !this.databaseSaveDeferred)
            return;
        await this.flushDatabaseSave();
    }
    hasPendingDatabaseSave() {
        return Boolean(this.saveDatabaseDebounce.isPending || this.databaseSaveDeferred);
    }
    /**
     * Drains active and queued persistence before atomically starting an outer transaction.
     * @param {() => Promise<void>} callback - Starts the SQL transaction.
     * @returns {Promise<void>} - Resolves after BEGIN succeeds.
     */
    async withTransactionStart(callback) {
        if (this.saveDatabaseDebounce.isPending) {
            this.saveDatabaseDebounce.clear();
            this.databaseSaveDeferred = true;
        }
        await this.databaseSaveMutex.sync(async () => {
            if (this.databaseSaveDeferred) {
                this.databaseSaveDeferred = false;
                const databaseContent = this.connection.export();
                await this.persistence.save(databaseContent);
            }
            this.databaseTransactionStarting = true;
            try {
                await callback();
            }
            catch (error) {
                this.databaseTransactionStarting = false;
                throw error;
            }
        });
    }
    /**
     * Marks successful outer transaction admission complete after driver state is updated.
     * @returns {void}
     */
    completeTransactionStart() {
        this.databaseTransactionStarting = false;
    }
    /**
     * Runs query.
     * @param {string} sql - SQL string.
     * @param {{mutation?: boolean}} [options] - Internal query classification options.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the query.
     */
    async query(sql, { mutation = false } = {}) {
        const result = await queryWeb(this.connection, sql);
        const downcasedSQL = sql.toLowerCase().trim();
        // Auto-save database in local storage in case we can find manipulating instructions in the SQL
        if (mutation || downcasedSQL.startsWith("delete ") || downcasedSQL.startsWith("insert into ") || downcasedSQL.startsWith("update ")) {
            this.saveDatabaseDebounce();
        }
        return result;
    }
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    async affectedRows(sql) {
        await this.query(sql);
        const connection = /** @type {import("sql.js").Database & {getRowsModified: () => number}} */ (this.connection);
        return connection.getRowsModified();
    }
    saveDatabase = async () => {
        await this.databaseSaveMutex.sync(async () => {
            if (this.driver.insideTransaction() || this.databaseTransactionStarting) {
                this.databaseSaveDeferred = true;
                return;
            }
            this.databaseSaveDeferred = false;
            const databaseContent = this.connection.export();
            await this.persistence.save(databaseContent);
        });
    };
    saveDatabaseDebounce = debounce(this.saveDatabase, 500);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29ubmVjdGlvbi1zcWwtanMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvY29ubmVjdGlvbi1zcWwtanMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sUUFBUSxNQUFNLFVBQVUsQ0FBQTtBQUMvQixPQUFPLEtBQUssTUFBTSwyQkFBMkIsQ0FBQTtBQUM3QyxPQUFPLFFBQVEsTUFBTSxnQkFBZ0IsQ0FBQTtBQUVyQyxNQUFNLENBQUMsT0FBTyxPQUFPLDZDQUE2QztJQUNoRTs7Ozs7T0FLRztJQUNILFlBQVksTUFBTSxFQUFFLFVBQVUsRUFBRSxXQUFXO1FBQ3pDLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxLQUFLLENBQUE7UUFDakMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksS0FBSyxFQUFFLENBQUE7UUFDcEMsSUFBSSxDQUFDLDJCQUEyQixHQUFHLEtBQUssQ0FBQTtRQUN4QyxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQTtJQUNoQyxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDVCxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQzlCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUMvQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQjtRQUNyQixJQUFJLENBQUMsb0JBQW9CLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDakMsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyx3QkFBd0I7UUFDNUIsSUFBSSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FB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b0JBQW9CLEdBQUcsS0FBSyxDQUFBO1lBQ2pDLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUE7WUFFaEQsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUM5QyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUMsQ0FBQTtJQUVELG9CQUFvQixHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLEdBQUcsQ0FBQyxDQUFBO0NBQ3hEIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBkZWJvdW5jZSBmcm9tIFwiZGVib3VuY2VcIlxuaW1wb3J0IE11dGV4IGZyb20gXCJlcGljLWxvY2tzL2J1aWxkL211dGV4LmpzXCJcbmltcG9ydCBxdWVyeVdlYiBmcm9tIFwiLi9xdWVyeS53ZWIuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVDb25uZWN0aW9uU3FsSnMge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJzcWwuanNcIikuRGF0YWJhc2V9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vd2ViLXBlcnNpc3RlbmNlLmpzXCIpLlNxbGl0ZVdlYlBlcnNpc3RlbmNlfSBwZXJzaXN0ZW5jZSAtIERhdGFiYXNlIHBlcnNpc3RlbmNlIGFkYXB0ZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihkcml2ZXIsIGNvbm5lY3Rpb24sIHBlcnNpc3RlbmNlKSB7XG4gICAgdGhpcy5jb25uZWN0aW9uID0gY29ubmVjdGlvblxuICAgIHRoaXMuZGF0YWJhc2VTYXZlRGVmZXJyZWQgPSBmYWxzZVxuICAgIHRoaXMuZGF0YWJhc2VTYXZlTXV0ZXggPSBuZXcgTXV0ZXgoKVxuICAgIHRoaXMuZGF0YWJhc2VUcmFuc2FjdGlvblN0YXJ0aW5nID0gZmFsc2VcbiAgICB0aGlzLmRyaXZlciA9IGRyaXZlclxuICAgIHRoaXMucGVyc2lzdGVuY2UgPSBwZXJzaXN0ZW5jZVxuICB9XG5cbiAgYXN5bmMgY2xvc2UoKSB7XG4gICAgYXdhaXQgdGhpcy5mbHVzaERhdGFiYXNlU2F2ZSgpXG4gICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uLmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaGVzIGFueSBkZWJvdW5jZWQgZGF0YWJhc2Ugc2F2ZSBhbmQgd2FpdHMgdW50aWwgcGVyc2lzdGVuY2UgaXMgY29tcGxldGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGN1cnJlbnQgZGF0YWJhc2UgYnl0ZXMgYXJlIHN0b3JlZC5cbiAgICovXG4gIGFzeW5jIGZsdXNoRGF0YWJhc2VTYXZlKCkge1xuICAgIHRoaXMuc2F2ZURhdGFiYXNlRGVib3VuY2UuY2xlYXIoKVxuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGFiYXNlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaGVzIG9ubHkgd2hlbiBhIG11dGF0aW9uIHNhdmUgaXMgcGVuZGluZyBvciB3YXMgZGVmZXJyZWQgYnkgYSB0cmFuc2FjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIGRhdGFiYXNlIGJ5dGVzIGFyZSBzdG9yZWQuXG4gICAqL1xuICBhc3luYyBmbHVzaFBlbmRpbmdEYXRhYmFzZVNhdmUoKSB7XG4gICAgaWYgKCF0aGlzLnNhdmVEYXRhYmFzZURlYm91bmNlLmlzUGVuZGluZyAmJiAhdGhpcy5kYXRhYmFzZVNhdmVEZWZlcnJlZCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmZsdXNoRGF0YWJhc2VTYXZlKClcbiAgfVxuXG4gIGhhc1BlbmRpbmdEYXRhYmFzZVNhdmUoKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4odGhpcy5zYXZlRGF0YWJhc2VEZWJvdW5jZS5pc1BlbmRpbmcgfHwgdGhpcy5kYXRhYmFzZVNhdmVEZWZlcnJlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgYWN0aXZlIGFuZCBxdWV1ZWQgcGVyc2lzdGVuY2UgYmVmb3JlIGF0b21pY2FsbHkgc3RhcnRpbmcgYW4gb3V0ZXIgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBTdGFydHMgdGhlIFNRTCB0cmFuc2FjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgQkVHSU4gc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyB3aXRoVHJhbnNhY3Rpb25TdGFydChjYWxsYmFjaykge1xuICAgIGlmICh0aGlzLnNhdmVEYXRhYmFzZURlYm91bmNlLmlzUGVuZGluZykge1xuICAgICAgdGhpcy5zYXZlRGF0YWJhc2VEZWJvdW5jZS5jbGVhcigpXG4gICAgICB0aGlzLmRhdGFiYXNlU2F2ZURlZmVycmVkID0gdHJ1ZVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZGF0YWJhc2VTYXZlTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5kYXRhYmFzZVNhdmVEZWZlcnJlZCkge1xuICAgICAgICB0aGlzLmRhdGFiYXNlU2F2ZURlZmVycmVkID0gZmFsc2VcbiAgICAgICAgY29uc3QgZGF0YWJhc2VDb250ZW50ID0gdGhpcy5jb25uZWN0aW9uLmV4cG9ydCgpXG5cbiAgICAgICAgYXdhaXQgdGhpcy5wZXJzaXN0ZW5jZS5zYXZlKGRhdGFiYXNlQ29udGVudClcbiAgICAgIH1cblxuICAgICAgdGhpcy5kYXRhYmFzZVRyYW5zYWN0aW9uU3RhcnRpbmcgPSB0cnVlXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuZGF0YWJhc2VUcmFuc2FjdGlvblN0YXJ0aW5nID0gZmFsc2VcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIHN1Y2Nlc3NmdWwgb3V0ZXIgdHJhbnNhY3Rpb24gYWRtaXNzaW9uIGNvbXBsZXRlIGFmdGVyIGRyaXZlciBzdGF0ZSBpcyB1cGRhdGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNvbXBsZXRlVHJhbnNhY3Rpb25TdGFydCgpIHtcbiAgICB0aGlzLmRhdGFiYXNlVHJhbnNhY3Rpb25TdGFydGluZyA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7e211dGF0aW9uPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIEludGVybmFsIHF1ZXJ5IGNsYXNzaWZpY2F0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeS5cbiAgICovXG4gIGFzeW5jIHF1ZXJ5KHNxbCwge211dGF0aW9uID0gZmFsc2V9ID0ge30pIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBxdWVyeVdlYih0aGlzLmNvbm5lY3Rpb24sIHNxbClcbiAgICBjb25zdCBkb3duY2FzZWRTUUwgPSBzcWwudG9Mb3dlckNhc2UoKS50cmltKClcblxuICAgIC8vIEF1dG8tc2F2ZSBkYXRhYmFzZSBpbiBsb2NhbCBzdG9yYWdlIGluIGNhc2Ugd2UgY2FuIGZpbmQgbWFuaXB1bGF0aW5nIGluc3RydWN0aW9ucyBpbiB0aGUgU1FMXG4gICAgaWYgKG11dGF0aW9uIHx8IGRvd25jYXNlZFNRTC5zdGFydHNXaXRoKFwiZGVsZXRlIFwiKSB8fCBkb3duY2FzZWRTUUwuc3RhcnRzV2l0aChcImluc2VydCBpbnRvIFwiKSB8fCBkb3duY2FzZWRTUUwuc3RhcnRzV2l0aChcInVwZGF0ZSBcIikpIHtcbiAgICAgIHRoaXMuc2F2ZURhdGFiYXNlRGVib3VuY2UoKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIG11dGF0aW9uIHdpdGggYWZmZWN0ZWQtcm93IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gTXV0YXRpb24gU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIGFmZmVjdGVkUm93cyhzcWwpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICBjb25zdCBjb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCJzcWwuanNcIikuRGF0YWJhc2UgJiB7Z2V0Um93c01vZGlmaWVkOiAoKSA9PiBudW1iZXJ9fSAqLyAodGhpcy5jb25uZWN0aW9uKVxuICAgIHJldHVybiBjb25uZWN0aW9uLmdldFJvd3NNb2RpZmllZCgpXG4gIH1cblxuICBzYXZlRGF0YWJhc2UgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5kYXRhYmFzZVNhdmVNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLmRyaXZlci5pbnNpZGVUcmFuc2FjdGlvbigpIHx8IHRoaXMuZGF0YWJhc2VUcmFuc2FjdGlvblN0YXJ0aW5nKSB7XG4gICAgICAgIHRoaXMuZGF0YWJhc2VTYXZlRGVmZXJyZWQgPSB0cnVlXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLmRhdGFiYXNlU2F2ZURlZmVycmVkID0gZmFsc2VcbiAgICAgIGNvbnN0IGRhdGFiYXNlQ29udGVudCA9IHRoaXMuY29ubmVjdGlvbi5leHBvcnQoKVxuXG4gICAgICBhd2FpdCB0aGlzLnBlcnNpc3RlbmNlLnNhdmUoZGF0YWJhc2VDb250ZW50KVxuICAgIH0pXG4gIH1cblxuICBzYXZlRGF0YWJhc2VEZWJvdW5jZSA9IGRlYm91bmNlKHRoaXMuc2F2ZURhdGFiYXNlLCA1MDApXG59XG4iXX0=
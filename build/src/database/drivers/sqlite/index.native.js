import { digg } from "diggerize";
import envSense from "env-sense/build/use-env-sense.js";
// @ts-expect-error
import query from "./query";
// @ts-expect-error
import * as SQLite from "expo-sqlite";
import Base from "./base.js";
import { nativeDatabaseMutex, runNativeOperation } from "./native-query-gate.js";
export default class VelociousDatabaseDriversSqliteNative extends Base {
    async connect() {
        const { isBrowser, isNative, isServer } = envSense();
        if (!isNative)
            throw new Error(`SQLite native driver running inside non-native environment: ${JSON.stringify({ isBrowser, isNative, isServer })}`);
        const args = this.getArgs();
        const databaseName = this._databaseName();
        if (args.reset) {
            try {
                await SQLite.deleteDatabaseAsync(databaseName);
            }
            catch (error) {
                if (error instanceof Error && error.message.match(/Database '(.+)' not found/)) {
                    // Ignore not found
                }
                else {
                    throw error;
                }
            }
        }
        // expo-sqlite caches native databases by name. A shared cache means closing
        // one driver's handle closes every other driver's handle for that database.
        this.connection = await SQLite.openDatabaseAsync(databaseName, { useNewConnection: true });
        await this.registerVersion();
    }
    connectArgs() {
        const args = this.getArgs();
        /**
         * Connect args.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const connectArgs = {};
        const forward = ["database", "host", "password"];
        for (const forwardValue of forward) {
            if (forwardValue in args)
                connectArgs[forwardValue] = digg(args, forwardValue);
        }
        if ("username" in args)
            connectArgs["user"] = args["username"];
        return connectArgs;
    }
    /**
     * Returns the configured SQLite database name.
     * @returns {string} - Database name.
     */
    _databaseName() {
        const databaseName = this.getArgs().name;
        if (!databaseName)
            throw new Error("No name given for SQLite Native");
        return databaseName;
    }
    async _close() {
        const databaseName = this._databaseName();
        await nativeDatabaseMutex(databaseName).sync(async () => {
            const connection = this.connection;
            this.connection = undefined;
            await connection?.closeAsync();
        });
    }
    async deleteDatabaseStorage() {
        const databaseName = this._databaseName();
        try {
            await SQLite.deleteDatabaseAsync(databaseName);
        }
        catch (error) {
            if (!(error instanceof Error && error.message.match(/Database '(.+)' not found/)))
                throw error;
        }
    }
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @param {import("../base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Query result rows.
     */
    async _queryActual(sql, options = {}) {
        const databaseName = this._databaseName();
        return await runNativeOperation({
            databaseName,
            getConnection: () => this.connection,
            reopenConnection: async () => {
                this.connection = await SQLite.openDatabaseAsync(databaseName, { useNewConnection: true });
                return this.connection;
            },
            operation: async (connection) => {
                if (options.sqliteScript) {
                    await connection.execAsync(sql);
                    return [];
                }
                return await query(connection, sql);
            }
        });
    }
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    async _affectedRowsActual(sql) {
        const databaseName = this._databaseName();
        return await runNativeOperation({
            databaseName,
            getConnection: () => this.connection,
            reopenConnection: async () => {
                this.connection = await SQLite.openDatabaseAsync(databaseName, { useNewConnection: true });
                return this.connection;
            },
            operation: async (connection) => {
                const result = await connection.runAsync(sql);
                return result.changes;
            }
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubmF0aXZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvc3FsaXRlL2luZGV4Lm5hdGl2ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sUUFBUSxNQUFNLGtDQUFrQyxDQUFBO0FBRXZELG1CQUFtQjtBQUNuQixPQUFPLEtBQUssTUFBTSxTQUFTLENBQUE7QUFFM0IsbUJBQW1CO0FBQ25CLE9BQU8sS0FBSyxNQUFNLE1BQU0sYUFBYSxDQUFBO0FBRXJDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEVBQUMsbUJBQW1CLEVBQUUsa0JBQWtCLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU5RSxNQUFNLENBQUMsT0FBTyxPQUFPLG9DQUFxQyxTQUFRLElBQUk7SUFDcEUsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLEVBQUMsU0FBUyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUMsR0FBRyxRQUFRLEVBQUUsQ0FBQTtRQUVsRCxJQUFJLENBQUMsUUFBUTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0RBQStELElBQUksQ0FBQyxTQUFTLENBQUMsRUFBQyxTQUFTLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBRWhKLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUMzQixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7UUFFekMsSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxNQUFNLENBQUMsbUJBQW1CLENBQUMsWUFBWSxDQUFDLENBQUE7WUFDaEQsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxL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IGZyb20gXCJlbnYtc2Vuc2UvYnVpbGQvdXNlLWVudi1zZW5zZS5qc1wiXG5cbi8vIEB0cy1leHBlY3QtZXJyb3JcbmltcG9ydCBxdWVyeSBmcm9tIFwiLi9xdWVyeVwiXG5cbi8vIEB0cy1leHBlY3QtZXJyb3JcbmltcG9ydCAqIGFzIFNRTGl0ZSBmcm9tIFwiZXhwby1zcWxpdGVcIlxuXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCB7bmF0aXZlRGF0YWJhc2VNdXRleCwgcnVuTmF0aXZlT3BlcmF0aW9ufSBmcm9tIFwiLi9uYXRpdmUtcXVlcnktZ2F0ZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZU5hdGl2ZSBleHRlbmRzIEJhc2Uge1xuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGNvbnN0IHtpc0Jyb3dzZXIsIGlzTmF0aXZlLCBpc1NlcnZlcn0gPSBlbnZTZW5zZSgpXG5cbiAgICBpZiAoIWlzTmF0aXZlKSB0aHJvdyBuZXcgRXJyb3IoYFNRTGl0ZSBuYXRpdmUgZHJpdmVyIHJ1bm5pbmcgaW5zaWRlIG5vbi1uYXRpdmUgZW52aXJvbm1lbnQ6ICR7SlNPTi5zdHJpbmdpZnkoe2lzQnJvd3NlciwgaXNOYXRpdmUsIGlzU2VydmVyfSl9YClcblxuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IGRhdGFiYXNlTmFtZSA9IHRoaXMuX2RhdGFiYXNlTmFtZSgpXG5cbiAgICBpZiAoYXJncy5yZXNldCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgU1FMaXRlLmRlbGV0ZURhdGFiYXNlQXN5bmMoZGF0YWJhc2VOYW1lKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubWVzc2FnZS5tYXRjaCgvRGF0YWJhc2UgJyguKyknIG5vdCBmb3VuZC8pKSB7XG4gICAgICAgICAgLy8gSWdub3JlIG5vdCBmb3VuZFxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBleHBvLXNxbGl0ZSBjYWNoZXMgbmF0aXZlIGRhdGFiYXNlcyBieSBuYW1lLiBBIHNoYXJlZCBjYWNoZSBtZWFucyBjbG9zaW5nXG4gICAgLy8gb25lIGRyaXZlcidzIGhhbmRsZSBjbG9zZXMgZXZlcnkgb3RoZXIgZHJpdmVyJ3MgaGFuZGxlIGZvciB0aGF0IGRhdGFiYXNlLlxuICAgIHRoaXMuY29ubmVjdGlvbiA9IGF3YWl0IFNRTGl0ZS5vcGVuRGF0YWJhc2VBc3luYyhkYXRhYmFzZU5hbWUsIHt1c2VOZXdDb25uZWN0aW9uOiB0cnVlfSlcbiAgICBhd2FpdCB0aGlzLnJlZ2lzdGVyVmVyc2lvbigpXG4gIH1cblxuICBjb25uZWN0QXJncygpIHtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICAvKipcbiAgICAgKiBDb25uZWN0IGFyZ3MuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBjb25uZWN0QXJncyA9IHt9XG4gICAgY29uc3QgZm9yd2FyZCA9IFtcImRhdGFiYXNlXCIsIFwiaG9zdFwiLCBcInBhc3N3b3JkXCJdXG5cbiAgICBmb3IgKGNvbnN0IGZvcndhcmRWYWx1ZSBvZiBmb3J3YXJkKSB7XG4gICAgICBpZiAoZm9yd2FyZFZhbHVlIGluIGFyZ3MpIGNvbm5lY3RBcmdzW2ZvcndhcmRWYWx1ZV0gPSBkaWdnKGFyZ3MsIGZvcndhcmRWYWx1ZSlcbiAgICB9XG5cbiAgICBpZiAoXCJ1c2VybmFtZVwiIGluIGFyZ3MpIGNvbm5lY3RBcmdzW1widXNlclwiXSA9IGFyZ3NbXCJ1c2VybmFtZVwiXVxuXG4gICAgcmV0dXJuIGNvbm5lY3RBcmdzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29uZmlndXJlZCBTUUxpdGUgZGF0YWJhc2UgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEYXRhYmFzZSBuYW1lLlxuICAgKi9cbiAgX2RhdGFiYXNlTmFtZSgpIHtcbiAgICBjb25zdCBkYXRhYmFzZU5hbWUgPSB0aGlzLmdldEFyZ3MoKS5uYW1lXG5cbiAgICBpZiAoIWRhdGFiYXNlTmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gbmFtZSBnaXZlbiBmb3IgU1FMaXRlIE5hdGl2ZVwiKVxuXG4gICAgcmV0dXJuIGRhdGFiYXNlTmFtZVxuICB9XG5cbiAgYXN5bmMgX2Nsb3NlKCkge1xuICAgIGNvbnN0IGRhdGFiYXNlTmFtZSA9IHRoaXMuX2RhdGFiYXNlTmFtZSgpXG5cbiAgICBhd2FpdCBuYXRpdmVEYXRhYmFzZU11dGV4KGRhdGFiYXNlTmFtZSkuc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9uXG5cbiAgICAgIHRoaXMuY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgYXdhaXQgY29ubmVjdGlvbj8uY2xvc2VBc3luYygpXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZURhdGFiYXNlU3RvcmFnZSgpIHtcbiAgICBjb25zdCBkYXRhYmFzZU5hbWUgPSB0aGlzLl9kYXRhYmFzZU5hbWUoKVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBTUUxpdGUuZGVsZXRlRGF0YWJhc2VBc3luYyhkYXRhYmFzZU5hbWUpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubWVzc2FnZS5tYXRjaCgvRGF0YWJhc2UgJyguKyknIG5vdCBmb3VuZC8pKSkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59IC0gUXVlcnkgcmVzdWx0IHJvd3MuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBkYXRhYmFzZU5hbWUgPSB0aGlzLl9kYXRhYmFzZU5hbWUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1bk5hdGl2ZU9wZXJhdGlvbih7XG4gICAgICBkYXRhYmFzZU5hbWUsXG4gICAgICBnZXRDb25uZWN0aW9uOiAoKSA9PiB0aGlzLmNvbm5lY3Rpb24sXG4gICAgICByZW9wZW5Db25uZWN0aW9uOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbiA9IGF3YWl0IFNRTGl0ZS5vcGVuRGF0YWJhc2VBc3luYyhkYXRhYmFzZU5hbWUsIHt1c2VOZXdDb25uZWN0aW9uOiB0cnVlfSlcblxuICAgICAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9uXG4gICAgICB9LFxuICAgICAgb3BlcmF0aW9uOiBhc3luYyAoY29ubmVjdGlvbikgPT4ge1xuICAgICAgICBpZiAob3B0aW9ucy5zcWxpdGVTY3JpcHQpIHtcbiAgICAgICAgICBhd2FpdCBjb25uZWN0aW9uLmV4ZWNBc3luYyhzcWwpXG4gICAgICAgICAgcmV0dXJuIFtdXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgcXVlcnkoY29ubmVjdGlvbiwgc3FsKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiB3aXRoIGFmZmVjdGVkLXJvdyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkge1xuICAgIGNvbnN0IGRhdGFiYXNlTmFtZSA9IHRoaXMuX2RhdGFiYXNlTmFtZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgcnVuTmF0aXZlT3BlcmF0aW9uKHtcbiAgICAgIGRhdGFiYXNlTmFtZSxcbiAgICAgIGdldENvbm5lY3Rpb246ICgpID0+IHRoaXMuY29ubmVjdGlvbixcbiAgICAgIHJlb3BlbkNvbm5lY3Rpb246IGFzeW5jICgpID0+IHtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9uID0gYXdhaXQgU1FMaXRlLm9wZW5EYXRhYmFzZUFzeW5jKGRhdGFiYXNlTmFtZSwge3VzZU5ld0Nvbm5lY3Rpb246IHRydWV9KVxuXG4gICAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25cbiAgICAgIH0sXG4gICAgICBvcGVyYXRpb246IGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbm5lY3Rpb24ucnVuQXN5bmMoc3FsKVxuXG4gICAgICAgIHJldHVybiByZXN1bHQuY2hhbmdlc1xuICAgICAgfVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==
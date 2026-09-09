import { digg } from "diggerize";
import envSense from "env-sense/build/use-env-sense.js";
// @ts-expect-error
import query from "./query";
// @ts-expect-error
import * as SQLite from "expo-sqlite";
import Mutex from "epic-locks/build/mutex.js";
import Base from "./base.js";
export default class VelociousDatabaseDriversSqliteNative extends Base {
    /**
     * Serializes native queries so concurrent `getAllAsync` calls never race
     * `expo-sqlite`'s shared `NativeStatement` objects (a single connection
     * prepares/executes/finalizes one statement at a time).
     * @type {Mutex}
     */
    _queryMutex = new Mutex();
    async connect() {
        const { isBrowser, isNative, isServer } = envSense();
        if (!isNative)
            throw new Error(`SQLite native driver running inside non-native environment: ${JSON.stringify({ isBrowser, isNative, isServer })}`);
        const args = this.getArgs();
        if (!args.name)
            throw new Error("No name given for SQLite Native");
        const databaseName = args.name;
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
        this.connection = await SQLite.openDatabaseAsync(databaseName);
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
    async _close() {
        await this.connection.closeAsync();
        this.connection = undefined;
    }
    async deleteDatabaseStorage() {
        const databaseName = this.getArgs().name;
        if (!databaseName)
            throw new Error("No name given for SQLite Native");
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
        return await this._queryMutex.sync(async () => {
            if (!this.connection)
                throw new Error("Not connected yet");
            if (options.sqliteScript) {
                await this.connection.execAsync(sql);
                return [];
            }
            return await query(this.connection, sql);
        });
    }
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    async _affectedRowsActual(sql) {
        return await this._queryMutex.sync(async () => {
            if (!this.connection)
                throw new Error("Not connected yet");
            const result = await this.connection.runAsync(sql);
            return result.changes;
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubmF0aXZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvc3FsaXRlL2luZGV4Lm5hdGl2ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sUUFBUSxNQUFNLGtDQUFrQyxDQUFBO0FBRXZELG1CQUFtQjtBQUNuQixPQUFPLEtBQUssTUFBTSxTQUFTLENBQUE7QUFFM0IsbUJBQW1CO0FBQ25CLE9BQU8sS0FBSyxNQUFNLE1BQU0sYUFBYSxDQUFBO0FBRXJDLE9BQU8sS0FBSyxNQUFNLDJCQUEyQixDQUFBO0FBRTdDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUU1QixNQUFNLENBQUMsT0FBTyxPQUFPLG9DQUFxQyxTQUFRLElBQUk7SUFDcEU7Ozs7O09BS0c7SUFDSCxXQUFXLEdBQUcsSUFBSSxLQUFLLEVBQUUsQ0FBQTtJQUV6QixLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sRUFBQyxTQUFTLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBQyxHQUFHLFFBQVEsRUFBRSxDQUFBO1FBRWxELElBQUksQ0FBQyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywrREFBK0QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFDLFNBQVMsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFDLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFaEosTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRTNCLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsaUNBQWlDLENBQUMsQ0FBQTtRQUVsRSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFBO1FBRTlCLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDO2dC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QUMsSUFBSSxDQUFDLFVBQVU7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO1lBQzFELE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUE7WUFDbEQsT0FBTyxNQUFNLENBQUMsT0FBTyxDQUFBO1FBQ3ZCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBlbnZTZW5zZSBmcm9tIFwiZW52LXNlbnNlL2J1aWxkL3VzZS1lbnYtc2Vuc2UuanNcIlxuXG4vLyBAdHMtZXhwZWN0LWVycm9yXG5pbXBvcnQgcXVlcnkgZnJvbSBcIi4vcXVlcnlcIlxuXG4vLyBAdHMtZXhwZWN0LWVycm9yXG5pbXBvcnQgKiBhcyBTUUxpdGUgZnJvbSBcImV4cG8tc3FsaXRlXCJcblxuaW1wb3J0IE11dGV4IGZyb20gXCJlcGljLWxvY2tzL2J1aWxkL211dGV4LmpzXCJcblxuaW1wb3J0IEJhc2UgZnJvbSBcIi4vYmFzZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZU5hdGl2ZSBleHRlbmRzIEJhc2Uge1xuICAvKipcbiAgICogU2VyaWFsaXplcyBuYXRpdmUgcXVlcmllcyBzbyBjb25jdXJyZW50IGBnZXRBbGxBc3luY2AgY2FsbHMgbmV2ZXIgcmFjZVxuICAgKiBgZXhwby1zcWxpdGVgJ3Mgc2hhcmVkIGBOYXRpdmVTdGF0ZW1lbnRgIG9iamVjdHMgKGEgc2luZ2xlIGNvbm5lY3Rpb25cbiAgICogcHJlcGFyZXMvZXhlY3V0ZXMvZmluYWxpemVzIG9uZSBzdGF0ZW1lbnQgYXQgYSB0aW1lKS5cbiAgICogQHR5cGUge011dGV4fVxuICAgKi9cbiAgX3F1ZXJ5TXV0ZXggPSBuZXcgTXV0ZXgoKVxuXG4gIGFzeW5jIGNvbm5lY3QoKSB7XG4gICAgY29uc3Qge2lzQnJvd3NlciwgaXNOYXRpdmUsIGlzU2VydmVyfSA9IGVudlNlbnNlKClcblxuICAgIGlmICghaXNOYXRpdmUpIHRocm93IG5ldyBFcnJvcihgU1FMaXRlIG5hdGl2ZSBkcml2ZXIgcnVubmluZyBpbnNpZGUgbm9uLW5hdGl2ZSBlbnZpcm9ubWVudDogJHtKU09OLnN0cmluZ2lmeSh7aXNCcm93c2VyLCBpc05hdGl2ZSwgaXNTZXJ2ZXJ9KX1gKVxuXG4gICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG5cbiAgICBpZiAoIWFyZ3MubmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gbmFtZSBnaXZlbiBmb3IgU1FMaXRlIE5hdGl2ZVwiKVxuXG4gICAgY29uc3QgZGF0YWJhc2VOYW1lID0gYXJncy5uYW1lXG5cbiAgICBpZiAoYXJncy5yZXNldCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgU1FMaXRlLmRlbGV0ZURhdGFiYXNlQXN5bmMoZGF0YWJhc2VOYW1lKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubWVzc2FnZS5tYXRjaCgvRGF0YWJhc2UgJyguKyknIG5vdCBmb3VuZC8pKSB7XG4gICAgICAgICAgLy8gSWdub3JlIG5vdCBmb3VuZFxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNvbm5lY3Rpb24gPSBhd2FpdCBTUUxpdGUub3BlbkRhdGFiYXNlQXN5bmMoZGF0YWJhc2VOYW1lKVxuICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJWZXJzaW9uKClcbiAgfVxuXG4gIGNvbm5lY3RBcmdzKCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIC8qKlxuICAgICAqIENvbm5lY3QgYXJncy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbm5lY3RBcmdzID0ge31cbiAgICBjb25zdCBmb3J3YXJkID0gW1wiZGF0YWJhc2VcIiwgXCJob3N0XCIsIFwicGFzc3dvcmRcIl1cblxuICAgIGZvciAoY29uc3QgZm9yd2FyZFZhbHVlIG9mIGZvcndhcmQpIHtcbiAgICAgIGlmIChmb3J3YXJkVmFsdWUgaW4gYXJncykgY29ubmVjdEFyZ3NbZm9yd2FyZFZhbHVlXSA9IGRpZ2coYXJncywgZm9yd2FyZFZhbHVlKVxuICAgIH1cblxuICAgIGlmIChcInVzZXJuYW1lXCIgaW4gYXJncykgY29ubmVjdEFyZ3NbXCJ1c2VyXCJdID0gYXJnc1tcInVzZXJuYW1lXCJdXG5cbiAgICByZXR1cm4gY29ubmVjdEFyZ3NcbiAgfVxuXG4gIGFzeW5jIF9jbG9zZSgpIHtcbiAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24uY2xvc2VBc3luYygpXG4gICAgdGhpcy5jb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gIH1cblxuICBhc3luYyBkZWxldGVEYXRhYmFzZVN0b3JhZ2UoKSB7XG4gICAgY29uc3QgZGF0YWJhc2VOYW1lID0gdGhpcy5nZXRBcmdzKCkubmFtZVxuICAgIGlmICghZGF0YWJhc2VOYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBuYW1lIGdpdmVuIGZvciBTUUxpdGUgTmF0aXZlXCIpXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IFNRTGl0ZS5kZWxldGVEYXRhYmFzZUFzeW5jKGRhdGFiYXNlTmFtZSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5tZXNzYWdlLm1hdGNoKC9EYXRhYmFzZSAnKC4rKScgbm90IGZvdW5kLykpKSB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gLSBRdWVyeSByZXN1bHQgcm93cy5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9xdWVyeU11dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk5vdCBjb25uZWN0ZWQgeWV0XCIpXG5cbiAgICAgIGlmIChvcHRpb25zLnNxbGl0ZVNjcmlwdCkge1xuICAgICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24uZXhlY0FzeW5jKHNxbClcbiAgICAgICAgcmV0dXJuIFtdXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBxdWVyeSh0aGlzLmNvbm5lY3Rpb24sIHNxbClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gd2l0aCBhZmZlY3RlZC1yb3cgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcXVlcnlNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJOb3QgY29ubmVjdGVkIHlldFwiKVxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb25uZWN0aW9uLnJ1bkFzeW5jKHNxbClcbiAgICAgIHJldHVybiByZXN1bHQuY2hhbmdlc1xuICAgIH0pXG4gIH1cbn1cbiJdfQ==
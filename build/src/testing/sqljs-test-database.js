// @ts-check
import queryWeb from "../database/drivers/sqlite/query.web.js";
/**
 * Recreates an in-memory SQL.js test database from a captured schema baseline
 * after a quarantined connection is closed.
 */
export default class SqljsTestDatabase {
    /**
     * Runs constructor.
     * @param {{createDatabase: (data?: Uint8Array) => import("sql.js").Database}} args - Database factory.
     */
    constructor({ createDatabase }) {
        this.createDatabase = createDatabase;
        /** @type {Uint8Array | undefined} */
        this.baseline = undefined;
        /** @type {import("sql.js").Database | undefined} */
        this.currentDatabase = undefined;
        /** @type {{query: (sql: string) => Promise<Record<string, unknown>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>} | undefined} */
        this.currentConnection = undefined;
    }
    /**
     * Gets the current database.
     * @returns {import("sql.js").Database} - Current database.
     */
    database() {
        this.currentDatabase ??= this.createDatabase(this.baseline);
        return this.currentDatabase;
    }
    /** Captures the current migrated database as the recreation baseline. */
    captureBaseline() {
        this.baseline = this.database().export();
    }
    /**
     * Gets the current connection, recreating it from the schema baseline after quarantine.
     * @returns {{query: (sql: string) => Promise<Record<string, unknown>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>}} - Connection wrapper.
     */
    connection() {
        if (this.currentConnection)
            return this.currentConnection;
        const database = this.database();
        let closed = false;
        const assertOpen = () => {
            if (closed)
                throw new Error("SQL.js test database connection is closed");
        };
        /** @type {{query: (sql: string) => Promise<Record<string, unknown>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>}} */
        const connection = {
            query: async (sql) => {
                assertOpen();
                return await queryWeb(database, sql);
            },
            affectedRows: async (sql) => {
                assertOpen();
                await queryWeb(database, sql);
                return /** @type {import("sql.js").Database & {getRowsModified: () => number}} */ (database).getRowsModified();
            },
            close: async () => {
                if (closed)
                    return;
                closed = true;
                if (this.currentConnection === connection)
                    this.currentConnection = undefined;
                if (this.currentDatabase === database)
                    this.currentDatabase = undefined;
                database.close();
            }
        };
        this.currentConnection = connection;
        return connection;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FsanMtdGVzdC1kYXRhYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3NxbGpzLXRlc3QtZGF0YWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sUUFBUSxNQUFNLHlDQUF5QyxDQUFBO0FBRTlEOzs7R0FHRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8saUJBQWlCO0lBQ3BDOzs7T0FHRztJQUNILFlBQVksRUFBQyxjQUFjLEVBQUM7UUFDMUIsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUE7UUFDcEMscUNBQXFDO1FBQ3JDLElBQUksQ0FBQyxRQUFRLEdBQUcsU0FBUyxDQUFBO1FBQ3pCLG9EQUFvRDtRQUNwRCxJQUFJLENBQUMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtRQUNoQyxtS0FBbUs7UUFDbkssSUFBSSxDQUFDLGlCQUFpQixHQUFHLFNBQVMsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsUUFBUTtRQUNOLElBQUksQ0FBQyxlQUFlLEtBQUssSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDM0QsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFBO0lBQzdCLENBQUM7SUFFRCx5RUFBeUU7SUFDekUsZUFBZTtRQUNiLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFBO0lBQzFDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxVQUFVO1FBQ1IsSUFBSSxJQUFJLENBQUMsaUJBQWlCO1lBQUUsT0FBTyxJQUFJLENBQUMsaUJBQWlCLENBQUE7UUFFekQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFBO1FBQ2hDLElBQUksTUFBTSxHQUFHLEtBQUssQ0FBQTtRQUNsQixNQUFNLFVBQVUsR0FBRyxHQUFHLEVBQUU7WUFDdEIsSUFBSSxNQUFNO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkNBQTJDLENBQUMsQ0FBQTtRQUMxRSxDQUFDLENBQUE7UUFDRCx1SkFBdUo7UUFDdkosTUFBTSxVQUFVLEdBQUc7WUFDakIsS0FBSyxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsRUFBRTtnQkFDbkIsVUFBVSxFQUFFLENBQUE7Z0JBQ1osT0FBTyxNQUFNLFFBQVEsQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUE7WUFDdEMsQ0FBQztZQUNELFlBQVksRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLEVBQUU7Z0JBQzFCLFVBQVUsRUFBRSxDQUFBO2dCQUNaLE1BQU0sUUFBUSxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQTtnQkFDN0IsT0FBTywwRUFBMEUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ2hILENBQUM7WUFDRCxLQUFLLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ2hCLElBQUksTUFBTTtvQkFBRSxPQUFNO2dCQUNsQixNQUFNLEdBQUcsSUFBSSxDQUFBO2dCQUNiLElBQUksSUFBSSxDQUFDLGlCQUFpQixLQUFLLFVBQVU7b0JBQUUsSUFBSSxDQUFDLGlCQUFpQixHQUFHLFNBQVMsQ0FBQTtnQkFDN0UsSUFBSSxJQUFJLENBQUMsZUFBZSxLQUFLLFFBQVE7b0JBQUUsSUFBSSxDQUFDLGVBQWUsR0FBRyxTQUFTLENBQUE7Z0JBQ3ZFLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUNsQixDQUFDO1NBQ0YsQ0FBQTtRQUVELElBQUksQ0FBQyxpQkFBaUIsR0FBRyxVQUFVLENBQUE7UUFDbkMsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBxdWVyeVdlYiBmcm9tIFwiLi4vZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvcXVlcnkud2ViLmpzXCJcblxuLyoqXG4gKiBSZWNyZWF0ZXMgYW4gaW4tbWVtb3J5IFNRTC5qcyB0ZXN0IGRhdGFiYXNlIGZyb20gYSBjYXB0dXJlZCBzY2hlbWEgYmFzZWxpbmVcbiAqIGFmdGVyIGEgcXVhcmFudGluZWQgY29ubmVjdGlvbiBpcyBjbG9zZWQuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNxbGpzVGVzdERhdGFiYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7e2NyZWF0ZURhdGFiYXNlOiAoZGF0YT86IFVpbnQ4QXJyYXkpID0+IGltcG9ydChcInNxbC5qc1wiKS5EYXRhYmFzZX19IGFyZ3MgLSBEYXRhYmFzZSBmYWN0b3J5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NyZWF0ZURhdGFiYXNlfSkge1xuICAgIHRoaXMuY3JlYXRlRGF0YWJhc2UgPSBjcmVhdGVEYXRhYmFzZVxuICAgIC8qKiBAdHlwZSB7VWludDhBcnJheSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmJhc2VsaW5lID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJzcWwuanNcIikuRGF0YWJhc2UgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5jdXJyZW50RGF0YWJhc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge3txdWVyeTogKHNxbDogc3RyaW5nKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIHVua25vd24+W10+LCBhZmZlY3RlZFJvd3M6IChzcWw6IHN0cmluZykgPT4gUHJvbWlzZTxudW1iZXI+LCBjbG9zZTogKCkgPT4gUHJvbWlzZTx2b2lkPn0gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5jdXJyZW50Q29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGN1cnJlbnQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJzcWwuanNcIikuRGF0YWJhc2V9IC0gQ3VycmVudCBkYXRhYmFzZS5cbiAgICovXG4gIGRhdGFiYXNlKCkge1xuICAgIHRoaXMuY3VycmVudERhdGFiYXNlID8/PSB0aGlzLmNyZWF0ZURhdGFiYXNlKHRoaXMuYmFzZWxpbmUpXG4gICAgcmV0dXJuIHRoaXMuY3VycmVudERhdGFiYXNlXG4gIH1cblxuICAvKiogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgbWlncmF0ZWQgZGF0YWJhc2UgYXMgdGhlIHJlY3JlYXRpb24gYmFzZWxpbmUuICovXG4gIGNhcHR1cmVCYXNlbGluZSgpIHtcbiAgICB0aGlzLmJhc2VsaW5lID0gdGhpcy5kYXRhYmFzZSgpLmV4cG9ydCgpXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY3VycmVudCBjb25uZWN0aW9uLCByZWNyZWF0aW5nIGl0IGZyb20gdGhlIHNjaGVtYSBiYXNlbGluZSBhZnRlciBxdWFyYW50aW5lLlxuICAgKiBAcmV0dXJucyB7e3F1ZXJ5OiAoc3FsOiBzdHJpbmcpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgdW5rbm93bj5bXT4sIGFmZmVjdGVkUm93czogKHNxbDogc3RyaW5nKSA9PiBQcm9taXNlPG51bWJlcj4sIGNsb3NlOiAoKSA9PiBQcm9taXNlPHZvaWQ+fX0gLSBDb25uZWN0aW9uIHdyYXBwZXIuXG4gICAqL1xuICBjb25uZWN0aW9uKCkge1xuICAgIGlmICh0aGlzLmN1cnJlbnRDb25uZWN0aW9uKSByZXR1cm4gdGhpcy5jdXJyZW50Q29ubmVjdGlvblxuXG4gICAgY29uc3QgZGF0YWJhc2UgPSB0aGlzLmRhdGFiYXNlKClcbiAgICBsZXQgY2xvc2VkID0gZmFsc2VcbiAgICBjb25zdCBhc3NlcnRPcGVuID0gKCkgPT4ge1xuICAgICAgaWYgKGNsb3NlZCkgdGhyb3cgbmV3IEVycm9yKFwiU1FMLmpzIHRlc3QgZGF0YWJhc2UgY29ubmVjdGlvbiBpcyBjbG9zZWRcIilcbiAgICB9XG4gICAgLyoqIEB0eXBlIHt7cXVlcnk6IChzcWw6IHN0cmluZykgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdPiwgYWZmZWN0ZWRSb3dzOiAoc3FsOiBzdHJpbmcpID0+IFByb21pc2U8bnVtYmVyPiwgY2xvc2U6ICgpID0+IFByb21pc2U8dm9pZD59fSAqL1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB7XG4gICAgICBxdWVyeTogYXN5bmMgKHNxbCkgPT4ge1xuICAgICAgICBhc3NlcnRPcGVuKClcbiAgICAgICAgcmV0dXJuIGF3YWl0IHF1ZXJ5V2ViKGRhdGFiYXNlLCBzcWwpXG4gICAgICB9LFxuICAgICAgYWZmZWN0ZWRSb3dzOiBhc3luYyAoc3FsKSA9PiB7XG4gICAgICAgIGFzc2VydE9wZW4oKVxuICAgICAgICBhd2FpdCBxdWVyeVdlYihkYXRhYmFzZSwgc3FsKVxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCJzcWwuanNcIikuRGF0YWJhc2UgJiB7Z2V0Um93c01vZGlmaWVkOiAoKSA9PiBudW1iZXJ9fSAqLyAoZGF0YWJhc2UpLmdldFJvd3NNb2RpZmllZCgpXG4gICAgICB9LFxuICAgICAgY2xvc2U6IGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKGNsb3NlZCkgcmV0dXJuXG4gICAgICAgIGNsb3NlZCA9IHRydWVcbiAgICAgICAgaWYgKHRoaXMuY3VycmVudENvbm5lY3Rpb24gPT09IGNvbm5lY3Rpb24pIHRoaXMuY3VycmVudENvbm5lY3Rpb24gPSB1bmRlZmluZWRcbiAgICAgICAgaWYgKHRoaXMuY3VycmVudERhdGFiYXNlID09PSBkYXRhYmFzZSkgdGhpcy5jdXJyZW50RGF0YWJhc2UgPSB1bmRlZmluZWRcbiAgICAgICAgZGF0YWJhc2UuY2xvc2UoKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuY3VycmVudENvbm5lY3Rpb24gPSBjb25uZWN0aW9uXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgfVxufVxuIl19
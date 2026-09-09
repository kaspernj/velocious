// @ts-check
import BackgroundJobsStore from "./store.js";
/** Built-in SQL adapter preserving the existing durable store implementation. */
export default class SqlBackgroundJobsAdapter extends BackgroundJobsStore {
    /**
     * Declares generation capability.
     * @returns {boolean} - The built-in SQL store implements exact generation fencing.
     */
    supportsReleaseScopedGenerations() { return true; }
    /**
     * Ensures the built-in SQL schema during migration.
     * @param {{dbs: Record<string, import("../database/drivers/base.js").default>}} args - Migrated databases.
     * @returns {Promise<void>} - Resolves when the SQL schema is present.
     */
    async ensureFrameworkSchema({ dbs }) {
        const databaseIdentifier = this.getDatabaseIdentifier() || "default";
        const frameworkDb = dbs[databaseIdentifier];
        if (!frameworkDb)
            return;
        await this.ensureSchema(frameworkDb);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FsLWFkYXB0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3NxbC1hZGFwdGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLG1CQUFtQixNQUFNLFlBQVksQ0FBQTtBQUU1QyxpRkFBaUY7QUFDakYsTUFBTSxDQUFDLE9BQU8sT0FBTyx3QkFBeUIsU0FBUSxtQkFBbUI7SUFDdkU7OztPQUdHO0lBQ0gsZ0NBQWdDLEtBQUssT0FBTyxJQUFJLENBQUEsQ0FBQyxDQUFDO0lBRWxEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsRUFBQyxHQUFHLEVBQUM7UUFDL0IsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsSUFBSSxTQUFTLENBQUE7UUFDcEUsTUFBTSxXQUFXLEdBQUcsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFFM0MsSUFBSSxDQUFDLFdBQVc7WUFBRSxPQUFNO1FBRXhCLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUN0QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhY2tncm91bmRKb2JzU3RvcmUgZnJvbSBcIi4vc3RvcmUuanNcIlxuXG4vKiogQnVpbHQtaW4gU1FMIGFkYXB0ZXIgcHJlc2VydmluZyB0aGUgZXhpc3RpbmcgZHVyYWJsZSBzdG9yZSBpbXBsZW1lbnRhdGlvbi4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNxbEJhY2tncm91bmRKb2JzQWRhcHRlciBleHRlbmRzIEJhY2tncm91bmRKb2JzU3RvcmUge1xuICAvKipcbiAgICogRGVjbGFyZXMgZ2VuZXJhdGlvbiBjYXBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUaGUgYnVpbHQtaW4gU1FMIHN0b3JlIGltcGxlbWVudHMgZXhhY3QgZ2VuZXJhdGlvbiBmZW5jaW5nLlxuICAgKi9cbiAgc3VwcG9ydHNSZWxlYXNlU2NvcGVkR2VuZXJhdGlvbnMoKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYnVpbHQtaW4gU1FMIHNjaGVtYSBkdXJpbmcgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3tkYnM6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn19IGFyZ3MgLSBNaWdyYXRlZCBkYXRhYmFzZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIFNRTCBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyYW1ld29ya1NjaGVtYSh7ZGJzfSkge1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgXCJkZWZhdWx0XCJcbiAgICBjb25zdCBmcmFtZXdvcmtEYiA9IGRic1tkYXRhYmFzZUlkZW50aWZpZXJdXG5cbiAgICBpZiAoIWZyYW1ld29ya0RiKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlU2NoZW1hKGZyYW1ld29ya0RiKVxuICB9XG59XG4iXX0=
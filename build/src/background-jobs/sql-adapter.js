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
     * Declares atomic owned-handoff enqueue support.
     * @returns {boolean} - The SQL transaction validates ownership and enqueues atomically.
     */
    supportsOwnedEnqueueFromHandoff() { return true; }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FsLWFkYXB0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3NxbC1hZGFwdGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLG1CQUFtQixNQUFNLFlBQVksQ0FBQTtBQUU1QyxpRkFBaUY7QUFDakYsTUFBTSxDQUFDLE9BQU8sT0FBTyx3QkFBeUIsU0FBUSxtQkFBbUI7SUFDdkU7OztPQUdHO0lBQ0gsZ0NBQWdDLEtBQUssT0FBTyxJQUFJLENBQUEsQ0FBQyxDQUFDO0lBRWxEOzs7T0FHRztJQUNILCtCQUErQixLQUFLLE9BQU8sSUFBSSxDQUFBLENBQUMsQ0FBQztJQUVqRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLEVBQUMsR0FBRyxFQUFDO1FBQy9CLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLElBQUksU0FBUyxDQUFBO1FBQ3BFLE1BQU0sV0FBVyxHQUFHLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRTNDLElBQUksQ0FBQyxXQUFXO1lBQUUsT0FBTTtRQUV4QixNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDdEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1N0b3JlIGZyb20gXCIuL3N0b3JlLmpzXCJcblxuLyoqIEJ1aWx0LWluIFNRTCBhZGFwdGVyIHByZXNlcnZpbmcgdGhlIGV4aXN0aW5nIGR1cmFibGUgc3RvcmUgaW1wbGVtZW50YXRpb24uICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTcWxCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZXh0ZW5kcyBCYWNrZ3JvdW5kSm9ic1N0b3JlIHtcbiAgLyoqXG4gICAqIERlY2xhcmVzIGdlbmVyYXRpb24gY2FwYWJpbGl0eS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gVGhlIGJ1aWx0LWluIFNRTCBzdG9yZSBpbXBsZW1lbnRzIGV4YWN0IGdlbmVyYXRpb24gZmVuY2luZy5cbiAgICovXG4gIHN1cHBvcnRzUmVsZWFzZVNjb3BlZEdlbmVyYXRpb25zKCkgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGF0b21pYyBvd25lZC1oYW5kb2ZmIGVucXVldWUgc3VwcG9ydC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gVGhlIFNRTCB0cmFuc2FjdGlvbiB2YWxpZGF0ZXMgb3duZXJzaGlwIGFuZCBlbnF1ZXVlcyBhdG9taWNhbGx5LlxuICAgKi9cbiAgc3VwcG9ydHNPd25lZEVucXVldWVGcm9tSGFuZG9mZigpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBidWlsdC1pbiBTUUwgc2NoZW1hIGR1cmluZyBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7e2RiczogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fX0gYXJncyAtIE1pZ3JhdGVkIGRhdGFiYXNlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgU1FMIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJhbWV3b3JrU2NoZW1hKHtkYnN9KSB7XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IGZyYW1ld29ya0RiID0gZGJzW2RhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgIGlmICghZnJhbWV3b3JrRGIpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTY2hlbWEoZnJhbWV3b3JrRGIpXG4gIH1cbn1cbiJdfQ==
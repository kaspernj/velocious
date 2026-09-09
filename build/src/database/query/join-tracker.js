// @ts-check
export default class VelociousDatabaseQueryJoinTracker {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {typeof import("../record/index.js").default} args.modelClass - Root model class.
     */
    constructor({ modelClass }) {
        if (!modelClass)
            throw new Error("No modelClass given to JoinTracker");
        this._rootModelClass = modelClass;
        this._entries = new Map();
        this._tableUsage = new Map();
        this.registerPath([], modelClass.tableName());
    }
    /**
     * Runs clone.
     * @returns {VelociousDatabaseQueryJoinTracker} - The clone.
     */
    clone() {
        const cloned = new VelociousDatabaseQueryJoinTracker({ modelClass: this._rootModelClass });
        cloned._entries = new Map(this._entries);
        cloned._tableUsage = new Map(this._tableUsage);
        return cloned;
    }
    /**
     * Runs get root model class.
     * @returns {typeof import("../record/index.js").default} - Root model class.
     */
    getRootModelClass() {
        return this._rootModelClass;
    }
    /**
     * Runs path key.
     * @param {string[]} path - Join path.
     * @returns {string} - Path key.
     */
    pathKey(path) {
        return path.join(".");
    }
    /**
     * Runs get entry.
     * @param {string[]} path - Join path.
     * @returns {{tableName: string, alias: string | undefined} | undefined} - Entry.
     */
    getEntry(path) {
        return this._entries.get(this.pathKey(path));
    }
    /**
     * Runs register path.
     * @param {string[]} path - Join path.
     * @param {string} tableName - Table name.
     * @returns {{tableName: string, alias: string | undefined}} - Entry.
     */
    registerPath(path, tableName) {
        const key = this.pathKey(path);
        const existing = this._entries.get(key);
        if (existing)
            return existing;
        const usageCount = this._tableUsage.get(tableName) || 0;
        const alias = usageCount > 0 ? this.buildAlias(tableName, path) : undefined;
        this._tableUsage.set(tableName, usageCount + 1);
        const entry = { tableName, alias };
        this._entries.set(key, entry);
        return entry;
    }
    /**
     * Runs build alias.
     * @param {string} tableName - Table name.
     * @param {string[]} path - Join path.
     * @returns {string} - Alias.
     */
    buildAlias(tableName, path) {
        if (path.length === 0)
            return tableName;
        return `${tableName}__${path.join("__")}`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9pbi10cmFja2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L2pvaW4tdHJhY2tlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosTUFBTSxDQUFDLE9BQU8sT0FBTyxpQ0FBaUM7SUFDcEQ7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxVQUFVLEVBQUM7UUFDdEIsSUFBSSxDQUFDLFVBQVU7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUE7UUFFdEUsSUFBSSxDQUFDLGVBQWUsR0FBRyxVQUFVLENBQUE7UUFDakMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3pCLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUU1QixJQUFJLENBQUMsWUFBWSxDQUFDLEVBQUUsRUFBRSxVQUFVLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSztRQUNILE1BQU0sTUFBTSxHQUFHLElBQUksaUNBQWlDLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLGVBQWUsRUFBQyxDQUFDLENBQUE7UUFFeEYsTUFBTSxDQUFDLFFBQVEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDeEMsTUFBTSxDQUFDLFdBQVcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFFOUMsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsaUJBQWlCO1FBQ2YsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFBO0lBQzdCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsT0FBTyxDQUFDLElBQUk7UUFDVixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxRQUFRLENBQUMsSUFBSTtRQUNYLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0lBQzlDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFlBQVksQ0FBQyxJQUFJLEVBQUUsU0FBUztRQUMxQixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzlCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBRXZDLElBQUksUUFBUTtZQUFFLE9BQU8sUUFBUSxDQUFBO1FBRTdCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUN2RCxNQUFNLEtBQUssR0FBRyxVQUFVLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBRTNFLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxVQUFVLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFFL0MsTUFBTSxLQUFLLEdBQUcsRUFBQyxTQUFTLEVBQUUsS0FBSyxFQUFDLENBQUE7UUFFaEMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRTdCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsVUFBVSxDQUFDLFNBQVMsRUFBRSxJQUFJO1FBQ3hCLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFFdkMsT0FBTyxHQUFHLFNBQVMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUE7SUFDM0MsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlKb2luVHJhY2tlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHttb2RlbENsYXNzfSkge1xuICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiTm8gbW9kZWxDbGFzcyBnaXZlbiB0byBKb2luVHJhY2tlclwiKVxuXG4gICAgdGhpcy5fcm9vdE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG4gICAgdGhpcy5fZW50cmllcyA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX3RhYmxlVXNhZ2UgPSBuZXcgTWFwKClcblxuICAgIHRoaXMucmVnaXN0ZXJQYXRoKFtdLCBtb2RlbENsYXNzLnRhYmxlTmFtZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvbmUuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5Sm9pblRyYWNrZXJ9IC0gVGhlIGNsb25lLlxuICAgKi9cbiAgY2xvbmUoKSB7XG4gICAgY29uc3QgY2xvbmVkID0gbmV3IFZlbG9jaW91c0RhdGFiYXNlUXVlcnlKb2luVHJhY2tlcih7bW9kZWxDbGFzczogdGhpcy5fcm9vdE1vZGVsQ2xhc3N9KVxuXG4gICAgY2xvbmVkLl9lbnRyaWVzID0gbmV3IE1hcCh0aGlzLl9lbnRyaWVzKVxuICAgIGNsb25lZC5fdGFibGVVc2FnZSA9IG5ldyBNYXAodGhpcy5fdGFibGVVc2FnZSlcblxuICAgIHJldHVybiBjbG9uZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb290IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFJvb3QgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRSb290TW9kZWxDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5fcm9vdE1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhdGgga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBhdGgga2V5LlxuICAgKi9cbiAgcGF0aEtleShwYXRoKSB7XG4gICAgcmV0dXJuIHBhdGguam9pbihcIi5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbnRyeS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge3t0YWJsZU5hbWU6IHN0cmluZywgYWxpYXM6IHN0cmluZyB8IHVuZGVmaW5lZH0gfCB1bmRlZmluZWR9IC0gRW50cnkuXG4gICAqL1xuICBnZXRFbnRyeShwYXRoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2VudHJpZXMuZ2V0KHRoaXMucGF0aEtleShwYXRoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBKb2luIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7e3RhYmxlTmFtZTogc3RyaW5nLCBhbGlhczogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBFbnRyeS5cbiAgICovXG4gIHJlZ2lzdGVyUGF0aChwYXRoLCB0YWJsZU5hbWUpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLnBhdGhLZXkocGF0aClcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuX2VudHJpZXMuZ2V0KGtleSlcblxuICAgIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nXG5cbiAgICBjb25zdCB1c2FnZUNvdW50ID0gdGhpcy5fdGFibGVVc2FnZS5nZXQodGFibGVOYW1lKSB8fCAwXG4gICAgY29uc3QgYWxpYXMgPSB1c2FnZUNvdW50ID4gMCA/IHRoaXMuYnVpbGRBbGlhcyh0YWJsZU5hbWUsIHBhdGgpIDogdW5kZWZpbmVkXG5cbiAgICB0aGlzLl90YWJsZVVzYWdlLnNldCh0YWJsZU5hbWUsIHVzYWdlQ291bnQgKyAxKVxuXG4gICAgY29uc3QgZW50cnkgPSB7dGFibGVOYW1lLCBhbGlhc31cblxuICAgIHRoaXMuX2VudHJpZXMuc2V0KGtleSwgZW50cnkpXG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIGFsaWFzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBbGlhcy5cbiAgICovXG4gIGJ1aWxkQWxpYXModGFibGVOYW1lLCBwYXRoKSB7XG4gICAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gdGFibGVOYW1lXG5cbiAgICByZXR1cm4gYCR7dGFibGVOYW1lfV9fJHtwYXRoLmpvaW4oXCJfX1wiKX1gXG4gIH1cbn1cbiJdfQ==
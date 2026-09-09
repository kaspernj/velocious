// @ts-check
import restArgsError from "../../utils/rest-args-error.js";
export default class VelociousDatabaseQueryBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {import("../query-parser/options.js").default} [args.options] - Options object.
     */
    constructor({ driver, options, ...restArgs }) {
        restArgsError(restArgs);
        this._driver = driver;
        this._options = options || driver.options();
        if (!this._options)
            throw new Error("No database options was given or could be gotten from driver");
    }
    getConfiguration() {
        return this.getDriver().getConfiguration();
    }
    getDriver() {
        return this._driver;
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this._options;
    }
    getDatabaseType() {
        return this.getDriver().getType();
    }
    /**
     * Runs to sqls.
     * @abstract
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async toSQLs() {
        throw new Error("'toSQLs' wasn't implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUUxRCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEwQjtJQUM3Qzs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ3hDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQTtRQUNyQixJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU8sSUFBSSxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7UUFFM0MsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4REFBOEQsQ0FBQyxDQUFBO0lBQ3JHLENBQUM7SUFFRCxnQkFBZ0I7UUFDZCxPQUFPLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO0lBQzVDLENBQUM7SUFFRCxTQUFTO1FBQ1AsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxVQUFVO1FBQ1IsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFBO0lBQ3RCLENBQUM7SUFFRCxlQUFlO1FBQ2IsT0FBTyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDbkMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTTtRQUNWLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQTtJQUNoRCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IFthcmdzLm9wdGlvbnNdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZHJpdmVyLCBvcHRpb25zLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5fZHJpdmVyID0gZHJpdmVyXG4gICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnMgfHwgZHJpdmVyLm9wdGlvbnMoKVxuXG4gICAgaWYgKCF0aGlzLl9vcHRpb25zKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhYmFzZSBvcHRpb25zIHdhcyBnaXZlbiBvciBjb3VsZCBiZSBnb3R0ZW4gZnJvbSBkcml2ZXJcIilcbiAgfVxuXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RHJpdmVyKCkuZ2V0Q29uZmlndXJhdGlvbigpXG4gIH1cblxuICBnZXREcml2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RyaXZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS1wYXJzZXIvb3B0aW9ucy5qc1wiKS5kZWZhdWx0fSAtIFRoZSBvcHRpb25zIG9wdGlvbnMuXG4gICAqL1xuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB0aGlzLl9vcHRpb25zXG4gIH1cblxuICBnZXREYXRhYmFzZVR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RHJpdmVyKCkuZ2V0VHlwZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyB0b1NRTHMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3RvU1FMcycgd2Fzbid0IGltcGxlbWVudGVkXCIpXG4gIH1cbn1cbiJdfQ==
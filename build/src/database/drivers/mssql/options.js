// @ts-check
import QueryParserOptions from "../../query-parser/options.js";
export default class VelociousDatabaseDriversMssqlOptions extends QueryParserOptions {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     */
    constructor({ driver }) {
        const options = {
            driver,
            columnQuote: "\"",
            indexQuote: "\"",
            stringQuote: "'",
            tableQuote: "\""
        };
        super(options);
    }
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} string - String.
     * @returns {number | string} - The quote.
     */
    quote(string) {
        if (!this.driver)
            throw new Error("Driver not set");
        return this.driver.quote(string);
    }
    /**
     * Runs quote column name.
     * @param {string} string - String.
     * @returns {string} - The quote column name.
     */
    quoteColumnName(string) {
        if (string.includes("[") || string.includes("]"))
            throw new Error(`Possible SQL injection in column name: ${string}`);
        return `[${string}]`;
    }
    /**
     * Runs quote database name.
     * @param {string} databaseName - Database name.
     * @returns {string} - The quote database name.
     */
    quoteDatabaseName(databaseName) {
        if (typeof databaseName != "string")
            throw new Error(`Invalid database name given: ${databaseName}`);
        if (databaseName.includes("[") || databaseName.includes("]"))
            throw new Error(`Possible SQL injection in database name: ${databaseName}`);
        return `[${databaseName}]`;
    }
    /**
     * Runs quote index name.
     * @param {string} string - String.
     * @returns {string} - The quote index name.
     */
    quoteIndexName(string) {
        if (string.includes("[") || string.includes("]"))
            throw new Error(`Possible SQL injection in index name: ${string}`);
        return `[${string}]`;
    }
    /**
     * Runs quote table name.
     * @param {string} string - String.
     * @returns {string} - The quote table name.
     */
    quoteTableName(string) {
        if (string.includes("[") || string.includes("]"))
            throw new Error(`Possible SQL injection in table name: ${string}`);
        return `[${string}]`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3B0aW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL21zc3FsL29wdGlvbnMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sa0JBQWtCLE1BQU0sK0JBQStCLENBQUE7QUFFOUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQ0FBcUMsU0FBUSxrQkFBa0I7SUFDbEY7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUM7UUFDbEIsTUFBTSxPQUFPLEdBQUc7WUFDZCxNQUFNO1lBQ04sV0FBVyxFQUFFLElBQUk7WUFDakIsVUFBVSxFQUFFLElBQUk7WUFDaEIsV0FBVyxFQUFFLEdBQUc7WUFDaEIsVUFBVSxFQUFFLElBQUk7U0FDakIsQ0FBQTtRQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUNoQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxNQUFNO1FBQ1YsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBRW5ELE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsTUFBTTtRQUNwQixJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO1FBRXJILE9BQU8sSUFBSSxNQUFNLEdBQUcsQ0FBQTtJQUN0QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGlCQUFpQixDQUFDLFlBQVk7UUFDNUIsSUFBSSxPQUFPLFlBQVksSUFBSSxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsWUFBWSxFQUFFLENBQUMsQ0FBQTtRQUNwRyxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxZQUFZLEVBQUUsQ0FBQyxDQUFBO1FBRXpJLE9BQU8sSUFBSSxZQUFZLEdBQUcsQ0FBQTtJQUM1QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWMsQ0FBQyxNQUFNO1FBQ25CLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLE1BQU0sRUFBRSxDQUFDLENBQUE7UUFFcEgsT0FBTyxJQUFJLE1BQU0sR0FBRyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsY0FBYyxDQUFDLE1BQU07UUFDbkIsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5Q0FBeUMsTUFBTSxFQUFFLENBQUMsQ0FBQTtRQUVwSCxPQUFPLElBQUksTUFBTSxHQUFHLENBQUE7SUFDdEIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBRdWVyeVBhcnNlck9wdGlvbnMgZnJvbSBcIi4uLy4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzTXNzcWxPcHRpb25zIGV4dGVuZHMgUXVlcnlQYXJzZXJPcHRpb25zIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtkcml2ZXJ9KSB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGRyaXZlcixcbiAgICAgIGNvbHVtblF1b3RlOiBcIlxcXCJcIixcbiAgICAgIGluZGV4UXVvdGU6IFwiXFxcIlwiLFxuICAgICAgc3RyaW5nUXVvdGU6IFwiJ1wiLFxuICAgICAgdGFibGVRdW90ZTogXCJcXFwiXCJcbiAgICB9XG5cbiAgICBzdXBlcihvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN0cmluZyAtIFN0cmluZy5cbiAgICogQHJldHVybnMge251bWJlciB8IHN0cmluZ30gLSBUaGUgcXVvdGUuXG4gICAqL1xuICBxdW90ZShzdHJpbmcpIHtcbiAgICBpZiAoIXRoaXMuZHJpdmVyKSB0aHJvdyBuZXcgRXJyb3IoXCJEcml2ZXIgbm90IHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuZHJpdmVyLnF1b3RlKHN0cmluZylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyaW5nIC0gU3RyaW5nLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSBjb2x1bW4gbmFtZS5cbiAgICovXG4gIHF1b3RlQ29sdW1uTmFtZShzdHJpbmcpIHtcbiAgICBpZiAoc3RyaW5nLmluY2x1ZGVzKFwiW1wiKSB8fCBzdHJpbmcuaW5jbHVkZXMoXCJdXCIpKSB0aHJvdyBuZXcgRXJyb3IoYFBvc3NpYmxlIFNRTCBpbmplY3Rpb24gaW4gY29sdW1uIG5hbWU6ICR7c3RyaW5nfWApXG5cbiAgICByZXR1cm4gYFske3N0cmluZ31dYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgZGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIGRhdGFiYXNlIG5hbWUuXG4gICAqL1xuICBxdW90ZURhdGFiYXNlTmFtZShkYXRhYmFzZU5hbWUpIHtcbiAgICBpZiAodHlwZW9mIGRhdGFiYXNlTmFtZSAhPSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZGF0YWJhc2UgbmFtZSBnaXZlbjogJHtkYXRhYmFzZU5hbWV9YClcbiAgICBpZiAoZGF0YWJhc2VOYW1lLmluY2x1ZGVzKFwiW1wiKSB8fCBkYXRhYmFzZU5hbWUuaW5jbHVkZXMoXCJdXCIpKSB0aHJvdyBuZXcgRXJyb3IoYFBvc3NpYmxlIFNRTCBpbmplY3Rpb24gaW4gZGF0YWJhc2UgbmFtZTogJHtkYXRhYmFzZU5hbWV9YClcblxuICAgIHJldHVybiBgWyR7ZGF0YWJhc2VOYW1lfV1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSBpbmRleCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyaW5nIC0gU3RyaW5nLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSBpbmRleCBuYW1lLlxuICAgKi9cbiAgcXVvdGVJbmRleE5hbWUoc3RyaW5nKSB7XG4gICAgaWYgKHN0cmluZy5pbmNsdWRlcyhcIltcIikgfHwgc3RyaW5nLmluY2x1ZGVzKFwiXVwiKSkgdGhyb3cgbmV3IEVycm9yKGBQb3NzaWJsZSBTUUwgaW5qZWN0aW9uIGluIGluZGV4IG5hbWU6ICR7c3RyaW5nfWApXG5cbiAgICByZXR1cm4gYFske3N0cmluZ31dYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgdGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHN0cmluZyAtIFN0cmluZy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgdGFibGUgbmFtZS5cbiAgICovXG4gIHF1b3RlVGFibGVOYW1lKHN0cmluZykge1xuICAgIGlmIChzdHJpbmcuaW5jbHVkZXMoXCJbXCIpIHx8IHN0cmluZy5pbmNsdWRlcyhcIl1cIikpIHRocm93IG5ldyBFcnJvcihgUG9zc2libGUgU1FMIGluamVjdGlvbiBpbiB0YWJsZSBuYW1lOiAke3N0cmluZ31gKVxuXG4gICAgcmV0dXJuIGBbJHtzdHJpbmd9XWBcbiAgfVxufVxuXG4iXX0=
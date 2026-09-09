// @ts-check
export default class VelociousDatabaseQuerySelectBase {
    /**
     * Returns the explicit result alias carried by this select.
     * @param {{getType: () => string}} _driver - Driver that determines returned identifier spelling.
     * @returns {string | undefined} - Selected result alias, or undefined when the select has none.
     */
    getAlias(_driver) {
        return undefined;
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        if (!this.query)
            throw new Error("'query' hasn't been set");
        return this.query.driver.options();
    }
    /**
     * Runs set query.
     * @param {import("./index.js").default} query - Query instance.
     */
    setQuery(query) {
        this.query = query;
    }
    /**
     * Runs to sql.
     * @abstract
     * @returns {string} - SQL string.
     */
    toSql() {
        throw new Error("'toSql' wasn't implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0LWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvc2VsZWN0LWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0NBQWdDO0lBQ25EOzs7O09BSUc7SUFDSCxRQUFRLENBQUMsT0FBTztRQUNkLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxVQUFVO1FBQ1IsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFBO1FBRTNELE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVEsQ0FBQyxLQUFLO1FBQ1osSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLO1FBQ0gsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQy9DLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5U2VsZWN0QmFzZSB7XG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBleHBsaWNpdCByZXN1bHQgYWxpYXMgY2FycmllZCBieSB0aGlzIHNlbGVjdC5cbiAgICogQHBhcmFtIHt7Z2V0VHlwZTogKCkgPT4gc3RyaW5nfX0gX2RyaXZlciAtIERyaXZlciB0aGF0IGRldGVybWluZXMgcmV0dXJuZWQgaWRlbnRpZmllciBzcGVsbGluZy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBTZWxlY3RlZCByZXN1bHQgYWxpYXMsIG9yIHVuZGVmaW5lZCB3aGVuIHRoZSBzZWxlY3QgaGFzIG5vbmUuXG4gICAqL1xuICBnZXRBbGlhcyhfZHJpdmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS1wYXJzZXIvb3B0aW9ucy5qc1wiKS5kZWZhdWx0fSAtIFRoZSBvcHRpb25zIG9wdGlvbnMuXG4gICAqL1xuICBnZXRPcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5xdWVyeSkgdGhyb3cgbmV3IEVycm9yKFwiJ3F1ZXJ5JyBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLnF1ZXJ5LmRyaXZlci5vcHRpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBxdWVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBzZXRRdWVyeShxdWVyeSkge1xuICAgIHRoaXMucXVlcnkgPSBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdG9TcWwoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3RvU3FsJyB3YXNuJ3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19
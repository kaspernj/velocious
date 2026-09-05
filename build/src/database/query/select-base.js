// @ts-check
export default class VelociousDatabaseQuerySelectBase {
    /**
     * Returns the explicit result alias carried by this select.
     * @returns {string | undefined} - Selected result alias, or undefined when the select has none.
     */
    getAlias() {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0LWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvc2VsZWN0LWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0NBQWdDO0lBQ25EOzs7T0FHRztJQUNILFFBQVE7UUFDTixPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQTtRQUUzRCxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRLENBQUMsS0FBSztRQUNaLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSztRQUNILE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVNlbGVjdEJhc2Uge1xuICAvKipcbiAgICogUmV0dXJucyB0aGUgZXhwbGljaXQgcmVzdWx0IGFsaWFzIGNhcnJpZWQgYnkgdGhpcyBzZWxlY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gU2VsZWN0ZWQgcmVzdWx0IGFsaWFzLCBvciB1bmRlZmluZWQgd2hlbiB0aGUgc2VsZWN0IGhhcyBub25lLlxuICAgKi9cbiAgZ2V0QWxpYXMoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS1wYXJzZXIvb3B0aW9ucy5qc1wiKS5kZWZhdWx0fSAtIFRoZSBvcHRpb25zIG9wdGlvbnMuXG4gICAqL1xuICBnZXRPcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5xdWVyeSkgdGhyb3cgbmV3IEVycm9yKFwiJ3F1ZXJ5JyBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLnF1ZXJ5LmRyaXZlci5vcHRpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBxdWVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBzZXRRdWVyeShxdWVyeSkge1xuICAgIHRoaXMucXVlcnkgPSBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdG9TcWwoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3RvU3FsJyB3YXNuJ3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19
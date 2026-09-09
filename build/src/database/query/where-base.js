// @ts-check
export default class VelociousDatabaseQueryWhereBase {
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this.getQuery().getOptions();
    }
    /**
     * Runs get query.
     * @returns {import("./index.js").default} - The query.
     */
    getQuery() {
        if (!this.query)
            throw new Error("'query' hasn't been set");
        return this.query;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS93aGVyZS1iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUErQjtJQUNsRDs7O09BR0c7SUFDSCxVQUFVO1FBQ1IsT0FBTyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVE7UUFDTixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUE7UUFFM0QsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ25CLENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRLENBQUMsS0FBSztRQUNaLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSztRQUNILE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVdoZXJlQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRRdWVyeSgpLmdldE9wdGlvbnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFRoZSBxdWVyeS5cbiAgICovXG4gIGdldFF1ZXJ5KCkge1xuICAgIGlmICghdGhpcy5xdWVyeSkgdGhyb3cgbmV3IEVycm9yKFwiJ3F1ZXJ5JyBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLnF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcXVlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKi9cbiAgc2V0UXVlcnkocXVlcnkpIHtcbiAgICB0aGlzLnF1ZXJ5ID0gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHRvU3FsKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIid0b1NxbCcgd2Fzbid0IGltcGxlbWVudGVkXCIpXG4gIH1cbn1cbiJdfQ==
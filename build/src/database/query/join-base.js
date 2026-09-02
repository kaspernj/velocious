// @ts-check
export default class VelociousDatabaseQueryJoinBase {
    pretty = false;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this.getQuery().driver.options();
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
     * Runs set pretty.
     * @param {boolean} value - Value to use.
     */
    setPretty(value) {
        this.pretty = value;
    }
    /**
     * Runs set query.
     * @param {import("./index.js").default} query - Query instance.
     */
    setQuery(query) {
        this.query = query;
    }
    toSql() {
        throw new Error("'toSql' wasn't implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9pbi1iYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L2pvaW4tYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosTUFBTSxDQUFDLE9BQU8sT0FBTyw4QkFBOEI7SUFDakQsTUFBTSxHQUFHLEtBQUssQ0FBQTtJQUVkOzs7T0FHRztJQUNILFVBQVU7UUFDUixPQUFPLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDekMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVE7UUFDTixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUE7UUFFM0QsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ25CLENBQUM7SUFFRDs7O09BR0c7SUFDSCxTQUFTLENBQUMsS0FBSztRQUNiLElBQUksQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRLENBQUMsS0FBSztRQUNaLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ3BCLENBQUM7SUFFRCxLQUFLO1FBQ0gsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQy9DLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5Sm9pbkJhc2Uge1xuICBwcmV0dHkgPSBmYWxzZVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRRdWVyeSgpLmRyaXZlci5vcHRpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBxdWVyeS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gLSBUaGUgcXVlcnkuXG4gICAqL1xuICBnZXRRdWVyeSgpIHtcbiAgICBpZiAoIXRoaXMucXVlcnkpIHRocm93IG5ldyBFcnJvcihcIidxdWVyeScgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5xdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHByZXR0eS5cbiAgICogQHBhcmFtIHtib29sZWFufSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICovXG4gIHNldFByZXR0eSh2YWx1ZSkge1xuICAgIHRoaXMucHJldHR5ID0gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBxdWVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBzZXRRdWVyeShxdWVyeSkge1xuICAgIHRoaXMucXVlcnkgPSBxdWVyeVxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3RvU3FsJyB3YXNuJ3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19
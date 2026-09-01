// @ts-check
export default class VelociousDatabaseQueryFromBase {
    /**
     * Query.
     * @type {import("./index.js").default  | null} */
    query = null;
    /**
     * Runs set query.
     * @param {import("./index.js").default} query - Query instance.
     * @returns {void} - No return value.
     */
    setQuery(query) {
        this.query = query;
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        if (!this.query)
            throw new Error("'query' hasn't been set");
        return this.query.getOptions();
    }
    /**
     * Runs to sql.
     * @abstract
     * @returns {string[]} - SQL statements.
     */
    toSql() {
        throw new Error("'toSql' wasn't implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbS1iYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L2Zyb20tYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosTUFBTSxDQUFDLE9BQU8sT0FBTyw4QkFBOEI7SUFDakQ7O3NEQUVrRDtJQUNsRCxLQUFLLEdBQUcsSUFBSSxDQUFBO0lBRVo7Ozs7T0FJRztJQUNILFFBQVEsQ0FBQyxLQUFLO1FBQ1osSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUE7UUFFM0QsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFBO0lBQ2hDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSztRQUNILE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeUZyb21CYXNlIHtcbiAgLyoqXG4gICAqIFF1ZXJ5LlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICB8IG51bGx9ICovXG4gIHF1ZXJ5ID0gbnVsbFxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBxdWVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFF1ZXJ5KHF1ZXJ5KSB7XG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgaWYgKCF0aGlzLnF1ZXJ5KSB0aHJvdyBuZXcgRXJyb3IoXCIncXVlcnknIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMucXVlcnkuZ2V0T3B0aW9ucygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICB0b1NxbCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIndG9TcWwnIHdhc24ndCBpbXBsZW1lbnRlZFwiKVxuICB9XG59XG4iXX0=
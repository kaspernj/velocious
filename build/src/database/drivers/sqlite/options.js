// @ts-check
import QueryParserOptions from "../../query-parser/options.js";
export default class VelociousDatabaseDriversSqliteOptions extends QueryParserOptions {
    /**
     * Runs constructor.
     * @param {import("../base.js").default} driver - Database driver instance.
     */
    constructor(driver) {
        const optionsArgs = {
            driver,
            columnQuote: "`",
            indexQuote: "`",
            stringQuote: "'",
            tableQuote: "`"
        };
        super(optionsArgs);
    }
    /**
     * Runs quote.
     * @param {string} string - String.
     * @returns {number | string} - The quote.
     */
    quote(string) {
        if (!this.driver)
            throw new Error("Driver not set");
        return this.driver.quote(string);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3B0aW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL3NxbGl0ZS9vcHRpb25zLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGtCQUFrQixNQUFNLCtCQUErQixDQUFBO0FBRTlELE1BQU0sQ0FBQyxPQUFPLE9BQU8scUNBQXNDLFNBQVEsa0JBQWtCO0lBQ25GOzs7T0FHRztJQUNILFlBQVksTUFBTTtRQUNoQixNQUFNLFdBQVcsR0FBRztZQUNsQixNQUFNO1lBQ04sV0FBVyxFQUFFLEdBQUc7WUFDaEIsVUFBVSxFQUFFLEdBQUc7WUFDZixXQUFXLEVBQUUsR0FBRztZQUNoQixVQUFVLEVBQUUsR0FBRztTQUNoQixDQUFBO1FBRUQsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFbkQsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFF1ZXJ5UGFyc2VyT3B0aW9ucyBmcm9tIFwiLi4vLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVPcHRpb25zIGV4dGVuZHMgUXVlcnlQYXJzZXJPcHRpb25zIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5kZWZhdWx0fSBkcml2ZXIgLSBEYXRhYmFzZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihkcml2ZXIpIHtcbiAgICBjb25zdCBvcHRpb25zQXJncyA9IHtcbiAgICAgIGRyaXZlcixcbiAgICAgIGNvbHVtblF1b3RlOiBcImBcIixcbiAgICAgIGluZGV4UXVvdGU6IFwiYFwiLFxuICAgICAgc3RyaW5nUXVvdGU6IFwiJ1wiLFxuICAgICAgdGFibGVRdW90ZTogXCJgXCJcbiAgICB9XG5cbiAgICBzdXBlcihvcHRpb25zQXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyaW5nIC0gU3RyaW5nLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgc3RyaW5nfSAtIFRoZSBxdW90ZS5cbiAgICovXG4gIHF1b3RlKHN0cmluZykge1xuICAgIGlmICghdGhpcy5kcml2ZXIpIHRocm93IG5ldyBFcnJvcihcIkRyaXZlciBub3Qgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5kcml2ZXIucXVvdGUoc3RyaW5nKVxuICB9XG59XG4iXX0=
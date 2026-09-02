// @ts-check
import QueryParserOptions from "../../query-parser/options.js";
export default class VelociousDatabaseDriversMysqlOptions extends QueryParserOptions {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     */
    constructor({ driver }) {
        const options = {
            driver,
            columnQuote: "`",
            indexQuote: "`",
            stringQuote: "'",
            tableQuote: "`"
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
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3B0aW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL215c3FsL29wdGlvbnMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sa0JBQWtCLE1BQU0sK0JBQStCLENBQUE7QUFFOUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQ0FBcUMsU0FBUSxrQkFBa0I7SUFDbEY7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUM7UUFDbEIsTUFBTSxPQUFPLEdBQUc7WUFDZCxNQUFNO1lBQ04sV0FBVyxFQUFFLEdBQUc7WUFDaEIsVUFBVSxFQUFFLEdBQUc7WUFDZixXQUFXLEVBQUUsR0FBRztZQUNoQixVQUFVLEVBQUUsR0FBRztTQUNoQixDQUFBO1FBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQ2hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFbkQsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFF1ZXJ5UGFyc2VyT3B0aW9ucyBmcm9tIFwiLi4vLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNNeXNxbE9wdGlvbnMgZXh0ZW5kcyBRdWVyeVBhcnNlck9wdGlvbnMge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2RyaXZlcn0pIHtcbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgZHJpdmVyLFxuICAgICAgY29sdW1uUXVvdGU6IFwiYFwiLFxuICAgICAgaW5kZXhRdW90ZTogXCJgXCIsXG4gICAgICBzdHJpbmdRdW90ZTogXCInXCIsXG4gICAgICB0YWJsZVF1b3RlOiBcImBcIlxuICAgIH1cblxuICAgIHN1cGVyKG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3RyaW5nIC0gU3RyaW5nLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgc3RyaW5nfSAtIFRoZSBxdW90ZS5cbiAgICovXG4gIHF1b3RlKHN0cmluZykge1xuICAgIGlmICghdGhpcy5kcml2ZXIpIHRocm93IG5ldyBFcnJvcihcIkRyaXZlciBub3Qgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5kcml2ZXIucXVvdGUoc3RyaW5nKVxuICB9XG59XG5cbiJdfQ==
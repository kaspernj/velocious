// @ts-check
import QueryParserOptions from "../../query-parser/options.js";
export default class VelociousDatabaseDriversPgsqlOptions extends QueryParserOptions {
    /**
     * Runs constructor.
     * @param {import("../base.js").default} driver - Database driver instance.
     */
    constructor(driver) {
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
     * @param {string} string - String.
     * @returns {number | string} - The quote.
     */
    quote(string) {
        if (!this.driver)
            throw new Error("Driver not set");
        return this.driver.quote(string);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3B0aW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL3Bnc3FsL29wdGlvbnMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sa0JBQWtCLE1BQU0sK0JBQStCLENBQUE7QUFFOUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQ0FBcUMsU0FBUSxrQkFBa0I7SUFDbEY7OztPQUdHO0lBQ0gsWUFBWSxNQUFNO1FBQ2hCLE1BQU0sT0FBTyxHQUFHO1lBQ2QsTUFBTTtZQUNOLFdBQVcsRUFBRSxJQUFJO1lBQ2pCLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLFdBQVcsRUFBRSxHQUFHO1lBQ2hCLFVBQVUsRUFBRSxJQUFJO1NBQ2pCLENBQUE7UUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDaEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTTtRQUNWLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUVuRCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgUXVlcnlQYXJzZXJPcHRpb25zIGZyb20gXCIuLi8uLi9xdWVyeS1wYXJzZXIvb3B0aW9ucy5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1Bnc3FsT3B0aW9ucyBleHRlbmRzIFF1ZXJ5UGFyc2VyT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuZGVmYXVsdH0gZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3IoZHJpdmVyKSB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGRyaXZlcixcbiAgICAgIGNvbHVtblF1b3RlOiBcIlxcXCJcIixcbiAgICAgIGluZGV4UXVvdGU6IFwiXFxcIlwiLFxuICAgICAgc3RyaW5nUXVvdGU6IFwiJ1wiLFxuICAgICAgdGFibGVRdW90ZTogXCJcXFwiXCJcbiAgICB9XG5cbiAgICBzdXBlcihvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJpbmcgLSBTdHJpbmcuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBzdHJpbmd9IC0gVGhlIHF1b3RlLlxuICAgKi9cbiAgcXVvdGUoc3RyaW5nKSB7XG4gICAgaWYgKCF0aGlzLmRyaXZlcikgdGhyb3cgbmV3IEVycm9yKFwiRHJpdmVyIG5vdCBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLmRyaXZlci5xdW90ZShzdHJpbmcpXG4gIH1cbn1cbiJdfQ==
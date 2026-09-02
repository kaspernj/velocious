// @ts-check
import restArgsError from "../../utils/rest-args-error.js";
export default class VelociousDatabaseQueryParserFromParser {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} args.pretty - Whether pretty.
     * @param {import("../query/index.js").default} args.query - Query instance.
     */
    constructor({ pretty, query, ...restArgs }) {
        restArgsError(restArgs);
        this.pretty = pretty;
        this.query = query;
    }
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql() {
        const { pretty, query } = this;
        const froms = query.getFroms();
        let sql = " FROM";
        for (const fromKey in froms) {
            const from = froms[fromKey];
            if (typeof fromKey == "number" && fromKey > 0) {
                sql += ",";
            }
            if (pretty) {
                sql += "\n  ";
            }
            else {
                sql += " ";
            }
            from.setQuery(query);
            sql += from.toSql();
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbS1wYXJzZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnktcGFyc2VyL2Zyb20tcGFyc2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUUxRCxNQUFNLENBQUMsT0FBTyxPQUFPLHNDQUFzQztJQUN6RDs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ3RDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSztRQUNILE1BQU0sRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBQzVCLE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUU5QixJQUFJLEdBQUcsR0FBRyxPQUFPLENBQUE7UUFFakIsS0FBSyxNQUFNLE9BQU8sSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUM1QixNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7WUFFM0IsSUFBSSxPQUFPLE9BQU8sSUFBSSxRQUFRLElBQUksT0FBTyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUM5QyxHQUFHLElBQUksR0FBRyxDQUFBO1lBQ1osQ0FBQztZQUVELElBQUksTUFBTSxFQUFFLENBQUM7Z0JBQ1gsR0FBRyxJQUFJLE1BQU0sQ0FBQTtZQUNmLENBQUM7aUJBQU0sQ0FBQztnQkFDTixHQUFHLElBQUksR0FBRyxDQUFBO1lBQ1osQ0FBQztZQUVELElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUE7WUFFcEIsR0FBRyxJQUFJLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNyQixDQUFDO1FBRUQsT0FBTyxHQUFHLENBQUE7SUFDWixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlQYXJzZXJGcm9tUGFyc2VyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wcmV0dHkgLSBXaGV0aGVyIHByZXR0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cHJldHR5LCBxdWVyeSwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMucHJldHR5ID0gcHJldHR5XG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHRvU3FsKCkge1xuICAgIGNvbnN0IHtwcmV0dHksIHF1ZXJ5fSA9IHRoaXNcbiAgICBjb25zdCBmcm9tcyA9IHF1ZXJ5LmdldEZyb21zKClcblxuICAgIGxldCBzcWwgPSBcIiBGUk9NXCJcblxuICAgIGZvciAoY29uc3QgZnJvbUtleSBpbiBmcm9tcykge1xuICAgICAgY29uc3QgZnJvbSA9IGZyb21zW2Zyb21LZXldXG5cbiAgICAgIGlmICh0eXBlb2YgZnJvbUtleSA9PSBcIm51bWJlclwiICYmIGZyb21LZXkgPiAwKSB7XG4gICAgICAgIHNxbCArPSBcIixcIlxuICAgICAgfVxuXG4gICAgICBpZiAocHJldHR5KSB7XG4gICAgICAgIHNxbCArPSBcIlxcbiAgXCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNxbCArPSBcIiBcIlxuICAgICAgfVxuXG4gICAgICBmcm9tLnNldFF1ZXJ5KHF1ZXJ5KVxuXG4gICAgICBzcWwgKz0gZnJvbS50b1NxbCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbFxuICB9XG59XG4iXX0=
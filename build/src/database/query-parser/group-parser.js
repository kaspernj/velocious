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
        const groups = query.getGroups();
        if (groups.length == 0) {
            return "";
        }
        let sql = " GROUP BY";
        for (const groupKey in groups) {
            const group = groups[groupKey];
            if (typeof groupKey == "number" && groupKey > 0) {
                sql += ",";
            }
            if (pretty) {
                sql += "\n  ";
            }
            else {
                sql += " ";
            }
            if (typeof group == "string") {
                sql += group;
            }
            else {
                throw new Error(`Unsupported group type: ${typeof group}`);
            }
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ3JvdXAtcGFyc2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5LXBhcnNlci9ncm91cC1wYXJzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLGdDQUFnQyxDQUFBO0FBRTFELE1BQU0sQ0FBQyxPQUFPLE9BQU8sc0NBQXNDO0lBQ3pEOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDdEMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO1FBQ3BCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLO1FBQ0gsTUFBTSxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsR0FBRyxJQUFJLENBQUE7UUFDNUIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBRWhDLElBQUksTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUN2QixPQUFPLEVBQUUsQ0FBQTtRQUNYLENBQUM7UUFFRCxJQUFJLEdBQUcsR0FBRyxXQUFXLENBQUE7UUFFckIsS0FBSyxNQUFNLFFBQVEsSUFBSSxNQUFNLEVBQUUsQ0FBQztZQUM5QixNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7WUFFOUIsSUFBSSxPQUFPLFFBQVEsSUFBSSxRQUFRLElBQUksUUFBUSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNoRCxHQUFHLElBQUksR0FBRyxDQUFBO1lBQ1osQ0FBQztZQUVELElBQUksTUFBTSxFQUFFLENBQUM7Z0JBQ1gsR0FBRyxJQUFJLE1BQU0sQ0FBQTtZQUNmLENBQUM7aUJBQU0sQ0FBQztnQkFDTixHQUFHLElBQUksR0FBRyxDQUFBO1lBQ1osQ0FBQztZQUVELElBQUksT0FBTyxLQUFLLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQzdCLEdBQUcsSUFBSSxLQUFLLENBQUE7WUFDZCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQywyQkFBMkIsT0FBTyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1lBQzVELENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxHQUFHLENBQUE7SUFDWixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlQYXJzZXJGcm9tUGFyc2VyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wcmV0dHkgLSBXaGV0aGVyIHByZXR0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cHJldHR5LCBxdWVyeSwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMucHJldHR5ID0gcHJldHR5XG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHRvU3FsKCkge1xuICAgIGNvbnN0IHtwcmV0dHksIHF1ZXJ5fSA9IHRoaXNcbiAgICBjb25zdCBncm91cHMgPSBxdWVyeS5nZXRHcm91cHMoKVxuXG4gICAgaWYgKGdyb3Vwcy5sZW5ndGggPT0gMCkge1xuICAgICAgcmV0dXJuIFwiXCJcbiAgICB9XG5cbiAgICBsZXQgc3FsID0gXCIgR1JPVVAgQllcIlxuXG4gICAgZm9yIChjb25zdCBncm91cEtleSBpbiBncm91cHMpIHtcbiAgICAgIGNvbnN0IGdyb3VwID0gZ3JvdXBzW2dyb3VwS2V5XVxuXG4gICAgICBpZiAodHlwZW9mIGdyb3VwS2V5ID09IFwibnVtYmVyXCIgJiYgZ3JvdXBLZXkgPiAwKSB7XG4gICAgICAgIHNxbCArPSBcIixcIlxuICAgICAgfVxuXG4gICAgICBpZiAocHJldHR5KSB7XG4gICAgICAgIHNxbCArPSBcIlxcbiAgXCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNxbCArPSBcIiBcIlxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIGdyb3VwID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgc3FsICs9IGdyb3VwXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGdyb3VwIHR5cGU6ICR7dHlwZW9mIGdyb3VwfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbFxuICB9XG59XG4iXX0=
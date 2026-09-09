// @ts-check
export default class VelocuiousDatabaseQueryParserJoinsParser {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} args.pretty - Whether pretty.
     * @param {import("../query/index.js").default} args.query - Query instance.
     */
    constructor({ pretty, query }) {
        this.pretty = pretty;
        this.query = query;
        this.conn = this.query.driver;
    }
    toSql() {
        const { pretty, query } = this;
        let sql = "";
        for (const joinKey in query._joins) {
            const join = query._joins[joinKey];
            join.setPretty(pretty);
            join.setQuery(query);
            if (pretty) {
                sql += "\n\n";
            }
            else {
                sql += " ";
            }
            sql += join.toSql();
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9pbnMtcGFyc2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5LXBhcnNlci9qb2lucy1wYXJzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0NBQXdDO0lBQzNEOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUM7UUFDekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQTtJQUMvQixDQUFDO0lBRUQsS0FBSztRQUNILE1BQU0sRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBQzVCLElBQUksR0FBRyxHQUFHLEVBQUUsQ0FBQTtRQUVaLEtBQUssTUFBTSxPQUFPLElBQUksS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ25DLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUE7WUFFbEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUN0QixJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBRXBCLElBQUksTUFBTSxFQUFFLENBQUM7Z0JBQ1gsR0FBRyxJQUFJLE1BQU0sQ0FBQTtZQUNmLENBQUM7aUJBQU0sQ0FBQztnQkFDTixHQUFHLElBQUksR0FBRyxDQUFBO1lBQ1osQ0FBQztZQUVELEdBQUcsSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDckIsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFBO0lBQ1osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jdWlvdXNEYXRhYmFzZVF1ZXJ5UGFyc2VySm9pbnNQYXJzZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnByZXR0eSAtIFdoZXRoZXIgcHJldHR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtwcmV0dHksIHF1ZXJ5fSkge1xuICAgIHRoaXMucHJldHR5ID0gcHJldHR5XG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gICAgdGhpcy5jb25uID0gdGhpcy5xdWVyeS5kcml2ZXJcbiAgfVxuXG4gIHRvU3FsKCkge1xuICAgIGNvbnN0IHtwcmV0dHksIHF1ZXJ5fSA9IHRoaXNcbiAgICBsZXQgc3FsID0gXCJcIlxuXG4gICAgZm9yIChjb25zdCBqb2luS2V5IGluIHF1ZXJ5Ll9qb2lucykge1xuICAgICAgY29uc3Qgam9pbiA9IHF1ZXJ5Ll9qb2luc1tqb2luS2V5XVxuXG4gICAgICBqb2luLnNldFByZXR0eShwcmV0dHkpXG4gICAgICBqb2luLnNldFF1ZXJ5KHF1ZXJ5KVxuXG4gICAgICBpZiAocHJldHR5KSB7XG4gICAgICAgIHNxbCArPSBcIlxcblxcblwiXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcWwgKz0gXCIgXCJcbiAgICAgIH1cblxuICAgICAgc3FsICs9IGpvaW4udG9TcWwoKVxuICAgIH1cblxuICAgIHJldHVybiBzcWxcbiAgfVxufVxuIl19
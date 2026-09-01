// @ts-check
export default class VelocuiousDatabaseQueryParserWhereParser {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} args.pretty - Whether pretty.
     * @param {import("../query/index.js").default} args.query - Query instance.
     */
    constructor({ pretty, query }) {
        this.pretty = pretty;
        this.query = query;
    }
    toSql() {
        const { pretty, query } = this;
        let sql = "";
        if (query._wheres.length == 0)
            return sql;
        if (pretty) {
            sql += "\n\n";
        }
        else {
            sql += " ";
        }
        sql += "WHERE";
        let count = 0;
        for (const where of query._wheres) {
            if (count > 0)
                sql += " AND";
            if (pretty) {
                sql += "\n  ";
            }
            else {
                sql += " ";
            }
            sql += where.toSql();
            count++;
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtcGFyc2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5LXBhcnNlci93aGVyZS1wYXJzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0NBQXdDO0lBQzNEOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUM7UUFDekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVELEtBQUs7UUFDSCxNQUFNLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBQyxHQUFHLElBQUksQ0FBQTtRQUM1QixJQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFWixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUM7WUFBRSxPQUFPLEdBQUcsQ0FBQTtRQUV6QyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ1gsR0FBRyxJQUFJLE1BQU0sQ0FBQTtRQUNmLENBQUM7YUFBTSxDQUFDO1lBQ04sR0FBRyxJQUFJLEdBQUcsQ0FBQTtRQUNaLENBQUM7UUFFRCxHQUFHLElBQUksT0FBTyxDQUFBO1FBRWQsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFBO1FBRWIsS0FBSyxNQUFNLEtBQUssSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDbEMsSUFBSSxLQUFLLEdBQUcsQ0FBQztnQkFBRSxHQUFHLElBQUksTUFBTSxDQUFBO1lBRTVCLElBQUksTUFBTSxFQUFFLENBQUM7Z0JBQ1gsR0FBRyxJQUFJLE1BQU0sQ0FBQTtZQUNmLENBQUM7aUJBQU0sQ0FBQztnQkFDTixHQUFHLElBQUksR0FBRyxDQUFBO1lBQ1osQ0FBQztZQUVELEdBQUcsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUE7WUFDcEIsS0FBSyxFQUFFLENBQUE7UUFDVCxDQUFDO1FBRUQsT0FBTyxHQUFHLENBQUE7SUFDWixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2N1aW91c0RhdGFiYXNlUXVlcnlQYXJzZXJXaGVyZVBhcnNlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucHJldHR5IC0gV2hldGhlciBwcmV0dHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe3ByZXR0eSwgcXVlcnl9KSB7XG4gICAgdGhpcy5wcmV0dHkgPSBwcmV0dHlcbiAgICB0aGlzLnF1ZXJ5ID0gcXVlcnlcbiAgfVxuXG4gIHRvU3FsKCkge1xuICAgIGNvbnN0IHtwcmV0dHksIHF1ZXJ5fSA9IHRoaXNcbiAgICBsZXQgc3FsID0gXCJcIlxuXG4gICAgaWYgKHF1ZXJ5Ll93aGVyZXMubGVuZ3RoID09IDApIHJldHVybiBzcWxcblxuICAgIGlmIChwcmV0dHkpIHtcbiAgICAgIHNxbCArPSBcIlxcblxcblwiXG4gICAgfSBlbHNlIHtcbiAgICAgIHNxbCArPSBcIiBcIlxuICAgIH1cblxuICAgIHNxbCArPSBcIldIRVJFXCJcblxuICAgIGxldCBjb3VudCA9IDBcblxuICAgIGZvciAoY29uc3Qgd2hlcmUgb2YgcXVlcnkuX3doZXJlcykge1xuICAgICAgaWYgKGNvdW50ID4gMCkgc3FsICs9IFwiIEFORFwiXG5cbiAgICAgIGlmIChwcmV0dHkpIHtcbiAgICAgICAgc3FsICs9IFwiXFxuICBcIlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3FsICs9IFwiIFwiXG4gICAgICB9XG5cbiAgICAgIHNxbCArPSB3aGVyZS50b1NxbCgpXG4gICAgICBjb3VudCsrXG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbFxuICB9XG59XG4iXX0=
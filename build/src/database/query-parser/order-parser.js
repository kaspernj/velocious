// @ts-check
export default class VelocuiousDatabaseQueryParserOrderParser {
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
        if (query._orders.length == 0)
            return sql;
        if (pretty) {
            sql += "\n\n";
        }
        else {
            sql += " ";
        }
        sql += "ORDER BY";
        let count = 0;
        for (const order of query._orders) {
            if (count > 0)
                sql += " ,";
            if (pretty) {
                sql += "\n  ";
            }
            else {
                sql += " ";
            }
            sql += order.toSql();
            count++;
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItcGFyc2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5LXBhcnNlci9vcmRlci1wYXJzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0NBQXdDO0lBQzNEOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUM7UUFDekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVELEtBQUs7UUFDSCxNQUFNLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBQyxHQUFHLElBQUksQ0FBQTtRQUM1QixJQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFWixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUM7WUFBRSxPQUFPLEdBQUcsQ0FBQTtRQUV6QyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ1gsR0FBRyxJQUFJLE1BQU0sQ0FBQTtRQUNmLENBQUM7YUFBTSxDQUFDO1lBQ04sR0FBRyxJQUFJLEdBQUcsQ0FBQTtRQUNaLENBQUM7UUFFRCxHQUFHLElBQUksVUFBVSxDQUFBO1FBQ2pCLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQTtRQUViLEtBQUssTUFBTSxLQUFLLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xDLElBQUksS0FBSyxHQUFHLENBQUM7Z0JBQUUsR0FBRyxJQUFJLElBQUksQ0FBQTtZQUUxQixJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUNYLEdBQUcsSUFBSSxNQUFNLENBQUE7WUFDZixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sR0FBRyxJQUFJLEdBQUcsQ0FBQTtZQUNaLENBQUM7WUFFRCxHQUFHLElBQUksS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQ3BCLEtBQUssRUFBRSxDQUFBO1FBQ1QsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFBO0lBQ1osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jdWlvdXNEYXRhYmFzZVF1ZXJ5UGFyc2VyT3JkZXJQYXJzZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnByZXR0eSAtIFdoZXRoZXIgcHJldHR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtwcmV0dHksIHF1ZXJ5fSkge1xuICAgIHRoaXMucHJldHR5ID0gcHJldHR5XG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gIH1cblxuICB0b1NxbCgpIHtcbiAgICBjb25zdCB7cHJldHR5LCBxdWVyeX0gPSB0aGlzXG4gICAgbGV0IHNxbCA9IFwiXCJcblxuICAgIGlmIChxdWVyeS5fb3JkZXJzLmxlbmd0aCA9PSAwKSByZXR1cm4gc3FsXG5cbiAgICBpZiAocHJldHR5KSB7XG4gICAgICBzcWwgKz0gXCJcXG5cXG5cIlxuICAgIH0gZWxzZSB7XG4gICAgICBzcWwgKz0gXCIgXCJcbiAgICB9XG5cbiAgICBzcWwgKz0gXCJPUkRFUiBCWVwiXG4gICAgbGV0IGNvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCBvcmRlciBvZiBxdWVyeS5fb3JkZXJzKSB7XG4gICAgICBpZiAoY291bnQgPiAwKSBzcWwgKz0gXCIgLFwiXG5cbiAgICAgIGlmIChwcmV0dHkpIHtcbiAgICAgICAgc3FsICs9IFwiXFxuICBcIlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3FsICs9IFwiIFwiXG4gICAgICB9XG5cbiAgICAgIHNxbCArPSBvcmRlci50b1NxbCgpXG4gICAgICBjb3VudCsrXG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbFxuICB9XG59XG4iXX0=
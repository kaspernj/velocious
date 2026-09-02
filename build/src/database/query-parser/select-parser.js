// @ts-check
import restArgsError from "../../utils/rest-args-error.js";
export default class VelociousDatabaseQueryParserSelectParser {
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
    toSql() {
        const { pretty, query } = this;
        let sql = "";
        sql += "SELECT";
        if (query._distinct) {
            sql += " DISTINCT";
        }
        if (pretty) {
            sql += "\n";
        }
        else {
            sql += " ";
        }
        let count = 0;
        for (const selectValue of query._selects) {
            selectValue.setQuery(query);
            sql += selectValue.toSql();
            if (count + 1 < query._selects.length) {
                if (pretty) {
                    sql += ",";
                    sql += "  ";
                }
                else {
                    sql += ", ";
                }
            }
            count++;
        }
        if (query.getSelects().length == 0) {
            // @ts-expect-error
            if (query.constructor.name == "VelociousDatabaseQueryModelClassQuery" && query.modelClass) {
                // @ts-expect-error
                sql += `${query.driver.quoteTable(query.modelClass.tableName())}.*`;
            }
            else {
                sql += "*";
            }
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0LXBhcnNlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS1wYXJzZXIvc2VsZWN0LXBhcnNlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0sZ0NBQWdDLENBQUE7QUFFMUQsTUFBTSxDQUFDLE9BQU8sT0FBTyx3Q0FBd0M7SUFDM0Q7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLFFBQVEsRUFBQztRQUN0QyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVELEtBQUs7UUFDSCxNQUFNLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBQyxHQUFHLElBQUksQ0FBQTtRQUU1QixJQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFWixHQUFHLElBQUksUUFBUSxDQUFBO1FBRWYsSUFBSSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDcEIsR0FBRyxJQUFJLFdBQVcsQ0FBQTtRQUNwQixDQUFDO1FBRUQsSUFBSSxNQUFNLEVBQUUsQ0FBQztZQUNYLEdBQUcsSUFBSSxJQUFJLENBQUE7UUFDYixDQUFDO2FBQU0sQ0FBQztZQUNOLEdBQUcsSUFBSSxHQUFHLENBQUE7UUFDWixDQUFDO1FBRUQsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFBO1FBRWIsS0FBSyxNQUFNLFdBQVcsSUFBSSxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDekMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUUzQixHQUFHLElBQUksV0FBVyxDQUFDLEtBQUssRUFBRSxDQUFBO1lBRTFCLElBQUksS0FBSyxHQUFHLENBQUMsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUN0QyxJQUFJLE1BQU0sRUFBRSxDQUFDO29CQUNYLEdBQUcsSUFBSSxHQUFHLENBQUE7b0JBQ1YsR0FBRyxJQUFJLElBQUksQ0FBQTtnQkFDYixDQUFDO3FCQUFNLENBQUM7b0JBQ04sR0FBRyxJQUFJLElBQUksQ0FBQTtnQkFDYixDQUFDO1lBQ0gsQ0FBQztZQUVELEtBQUssRUFBRSxDQUFBO1FBQ1QsQ0FBQztRQUVELElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNuQyxtQkFBbUI7WUFDbkIsSUFBSSxLQUFLLENBQUMsV0FBVyxDQUFDLElBQUksSUFBSSx1Q0FBdUMsSUFBSSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQzFGLG1CQUFtQjtnQkFDbkIsR0FBRyxJQUFJLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUE7WUFDckUsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLEdBQUcsSUFBSSxHQUFHLENBQUE7WUFDWixDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFBO0lBQ1osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5UGFyc2VyU2VsZWN0UGFyc2VyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wcmV0dHkgLSBXaGV0aGVyIHByZXR0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cHJldHR5LCBxdWVyeSwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMucHJldHR5ID0gcHJldHR5XG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gIH1cblxuICB0b1NxbCgpIHtcbiAgICBjb25zdCB7cHJldHR5LCBxdWVyeX0gPSB0aGlzXG5cbiAgICBsZXQgc3FsID0gXCJcIlxuXG4gICAgc3FsICs9IFwiU0VMRUNUXCJcblxuICAgIGlmIChxdWVyeS5fZGlzdGluY3QpIHtcbiAgICAgIHNxbCArPSBcIiBESVNUSU5DVFwiXG4gICAgfVxuXG4gICAgaWYgKHByZXR0eSkge1xuICAgICAgc3FsICs9IFwiXFxuXCJcbiAgICB9IGVsc2Uge1xuICAgICAgc3FsICs9IFwiIFwiXG4gICAgfVxuXG4gICAgbGV0IGNvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCBzZWxlY3RWYWx1ZSBvZiBxdWVyeS5fc2VsZWN0cykge1xuICAgICAgc2VsZWN0VmFsdWUuc2V0UXVlcnkocXVlcnkpXG5cbiAgICAgIHNxbCArPSBzZWxlY3RWYWx1ZS50b1NxbCgpXG5cbiAgICAgIGlmIChjb3VudCArIDEgPCBxdWVyeS5fc2VsZWN0cy5sZW5ndGgpIHtcbiAgICAgICAgaWYgKHByZXR0eSkge1xuICAgICAgICAgIHNxbCArPSBcIixcIlxuICAgICAgICAgIHNxbCArPSBcIiAgXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzcWwgKz0gXCIsIFwiXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY291bnQrK1xuICAgIH1cblxuICAgIGlmIChxdWVyeS5nZXRTZWxlY3RzKCkubGVuZ3RoID09IDApIHtcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICAgIGlmIChxdWVyeS5jb25zdHJ1Y3Rvci5uYW1lID09IFwiVmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeVwiICYmIHF1ZXJ5Lm1vZGVsQ2xhc3MpIHtcbiAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgICAgICBzcWwgKz0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUocXVlcnkubW9kZWxDbGFzcy50YWJsZU5hbWUoKSl9LipgXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcWwgKz0gXCIqXCJcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc3FsXG4gIH1cbn1cbiJdfQ==
// @ts-check
import FromParser from "./from-parser.js";
import GroupParser from "./group-parser.js";
import JoinsParser from "./joins-parser.js";
import LimitParser from "./limit-parser.js";
import OrderParser from "./order-parser.js";
import SelectParser from "./select-parser.js";
import WhereParser from "./where-parser.js";
export default class VelociousDatabaseBaseQueryParser {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} [args.pretty] - Whether pretty.
     * @param {import("../query/index.js").default} args.query - Query instance.
     */
    constructor({ pretty = false, query }) {
        if (!query)
            throw new Error("No query given");
        this.pretty = pretty;
        this.query = query;
    }
    toSql() {
        const { pretty, query } = this;
        let sql = "";
        sql += new SelectParser({ pretty, query }).toSql();
        sql += new FromParser({ pretty, query }).toSql();
        sql += new JoinsParser({ pretty, query }).toSql();
        sql += new WhereParser({ pretty, query }).toSql();
        sql += new GroupParser({ pretty, query }).toSql();
        sql += new OrderParser({ pretty, query }).toSql();
        sql += new LimitParser({ pretty, query }).toSql();
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1xdWVyeS1wYXJzZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnktcGFyc2VyL2Jhc2UtcXVlcnktcGFyc2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFlBQVksTUFBTSxvQkFBb0IsQ0FBQTtBQUM3QyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUUzQyxNQUFNLENBQUMsT0FBTyxPQUFPLGdDQUFnQztJQUNuRDs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxNQUFNLEdBQUcsS0FBSyxFQUFFLEtBQUssRUFBQztRQUNqQyxJQUFJLENBQUMsS0FBSztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUU3QyxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0lBRUQsS0FBSztRQUNILE1BQU0sRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBRTVCLElBQUksR0FBRyxHQUFHLEVBQUUsQ0FBQTtRQUVaLEdBQUcsSUFBSSxJQUFJLFlBQVksQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ2hELEdBQUcsSUFBSSxJQUFJLFVBQVUsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQzlDLEdBQUcsSUFBSSxJQUFJLFdBQVcsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQy9DLEdBQUcsSUFBSSxJQUFJLFdBQVcsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQy9DLEdBQUcsSUFBSSxJQUFJLFdBQVcsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQy9DLEdBQUcsSUFBSSxJQUFJLFdBQVcsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQy9DLEdBQUcsSUFBSSxJQUFJLFdBQVcsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRS9DLE9BQU8sR0FBRyxDQUFBO0lBQ1osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBGcm9tUGFyc2VyIGZyb20gXCIuL2Zyb20tcGFyc2VyLmpzXCJcbmltcG9ydCBHcm91cFBhcnNlciBmcm9tIFwiLi9ncm91cC1wYXJzZXIuanNcIlxuaW1wb3J0IEpvaW5zUGFyc2VyIGZyb20gXCIuL2pvaW5zLXBhcnNlci5qc1wiXG5pbXBvcnQgTGltaXRQYXJzZXIgZnJvbSBcIi4vbGltaXQtcGFyc2VyLmpzXCJcbmltcG9ydCBPcmRlclBhcnNlciBmcm9tIFwiLi9vcmRlci1wYXJzZXIuanNcIlxuaW1wb3J0IFNlbGVjdFBhcnNlciBmcm9tIFwiLi9zZWxlY3QtcGFyc2VyLmpzXCJcbmltcG9ydCBXaGVyZVBhcnNlciBmcm9tIFwiLi93aGVyZS1wYXJzZXIuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZUJhc2VRdWVyeVBhcnNlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnByZXR0eV0gLSBXaGV0aGVyIHByZXR0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cHJldHR5ID0gZmFsc2UsIHF1ZXJ5fSkge1xuICAgIGlmICghcXVlcnkpIHRocm93IG5ldyBFcnJvcihcIk5vIHF1ZXJ5IGdpdmVuXCIpXG5cbiAgICB0aGlzLnByZXR0eSA9IHByZXR0eVxuICAgIHRoaXMucXVlcnkgPSBxdWVyeVxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgY29uc3Qge3ByZXR0eSwgcXVlcnl9ID0gdGhpc1xuXG4gICAgbGV0IHNxbCA9IFwiXCJcblxuICAgIHNxbCArPSBuZXcgU2VsZWN0UGFyc2VyKHtwcmV0dHksIHF1ZXJ5fSkudG9TcWwoKVxuICAgIHNxbCArPSBuZXcgRnJvbVBhcnNlcih7cHJldHR5LCBxdWVyeX0pLnRvU3FsKClcbiAgICBzcWwgKz0gbmV3IEpvaW5zUGFyc2VyKHtwcmV0dHksIHF1ZXJ5fSkudG9TcWwoKVxuICAgIHNxbCArPSBuZXcgV2hlcmVQYXJzZXIoe3ByZXR0eSwgcXVlcnl9KS50b1NxbCgpXG4gICAgc3FsICs9IG5ldyBHcm91cFBhcnNlcih7cHJldHR5LCBxdWVyeX0pLnRvU3FsKClcbiAgICBzcWwgKz0gbmV3IE9yZGVyUGFyc2VyKHtwcmV0dHksIHF1ZXJ5fSkudG9TcWwoKVxuICAgIHNxbCArPSBuZXcgTGltaXRQYXJzZXIoe3ByZXR0eSwgcXVlcnl9KS50b1NxbCgpXG5cbiAgICByZXR1cm4gc3FsXG4gIH1cbn1cbiJdfQ==
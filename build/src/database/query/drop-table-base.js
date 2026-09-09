// @ts-check
import QueryBase from "./base.js";
import restArgsError from "../../utils/rest-args-error.js";
export default class VelociousDatabaseQueryDropTableBase extends QueryBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} [args.cascade] - Whether cascade.
     * @param {import("./../drivers/base.js").default} args.driver - Database driver instance.
     * @param {boolean} [args.ifExists] - Whether if exists.
     * @param {string} args.tableName - Table name.
     */
    constructor({ cascade, driver, ifExists, tableName, ...restArgs }) {
        super({ driver });
        restArgsError(restArgs);
        this.cascade = cascade;
        this.ifExists = ifExists;
        this.tableName = tableName;
    }
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async toSQLs() {
        const databaseType = this.getDatabaseType();
        const options = this.getOptions();
        const { cascade, ifExists, tableName } = this;
        const sqls = [];
        let sql = "";
        if (databaseType == "mssql" && ifExists) {
            sql += `IF EXISTS(SELECT * FROM [sysobjects] WHERE [name] = ${options.quote(tableName)} AND [xtype] = 'U') BEGIN `;
        }
        sql += "DROP TABLE";
        if (databaseType != "mssql" && ifExists)
            sql += " IF EXISTS";
        sql += ` ${options.quoteTableName(tableName)}`;
        if (cascade && databaseType == "pgsql") {
            sql += " cascade";
        }
        if (databaseType == "mssql" && ifExists) {
            sql += " END";
        }
        sqls.push(sql);
        return sqls;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHJvcC10YWJsZS1iYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L2Ryb3AtdGFibGUtYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0sV0FBVyxDQUFBO0FBQ2pDLE9BQU8sYUFBYSxNQUFNLGdDQUFnQyxDQUFBO0FBRTFELE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUNBQW9DLFNBQVEsU0FBUztJQUN4RTs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUM3RCxLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBRWYsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO0lBQzVCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsTUFBTTtRQUNWLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUMzQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDakMsTUFBTSxFQUFDLE9BQU8sRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBQzNDLE1BQU0sSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNmLElBQUksR0FBRyxHQUFHLEVBQUUsQ0FBQTtRQUVaLElBQUksWUFBWSxJQUFJLE9BQU8sSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUN4QyxHQUFHLElBQUksdURBQXVELE9BQU8sQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLDRCQUE0QixDQUFBO1FBQ3BILENBQUM7UUFFRCxHQUFHLElBQUksWUFBWSxDQUFBO1FBRW5CLElBQUksWUFBWSxJQUFJLE9BQU8sSUFBSSxRQUFRO1lBQUUsR0FBRyxJQUFJLFlBQVksQ0FBQTtRQUU1RCxHQUFHLElBQUksSUFBSSxPQUFPLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUE7UUFFOUMsSUFBSSxPQUFPLElBQUksWUFBWSxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQ3ZDLEdBQUcsSUFBSSxVQUFVLENBQUE7UUFDbkIsQ0FBQztRQUVELElBQUksWUFBWSxJQUFJLE9BQU8sSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUN4QyxHQUFHLElBQUksTUFBTSxDQUFBO1FBQ2YsQ0FBQztRQUVELElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7UUFFZCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgUXVlcnlCYXNlIGZyb20gXCIuL2Jhc2UuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlEcm9wVGFibGVCYXNlIGV4dGVuZHMgUXVlcnlCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY2FzY2FkZV0gLSBXaGV0aGVyIGNhc2NhZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi8uLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kcml2ZXIgLSBEYXRhYmFzZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y2FzY2FkZSwgZHJpdmVyLCBpZkV4aXN0cywgdGFibGVOYW1lLCAuLi5yZXN0QXJnc30pIHtcbiAgICBzdXBlcih7ZHJpdmVyfSlcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLmNhc2NhZGUgPSBjYXNjYWRlXG4gICAgdGhpcy5pZkV4aXN0cyA9IGlmRXhpc3RzXG4gICAgdGhpcy50YWJsZU5hbWUgPSB0YWJsZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIHNxbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgdG9TUUxzKCkge1xuICAgIGNvbnN0IGRhdGFiYXNlVHlwZSA9IHRoaXMuZ2V0RGF0YWJhc2VUeXBlKClcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcbiAgICBjb25zdCB7Y2FzY2FkZSwgaWZFeGlzdHMsIHRhYmxlTmFtZX0gPSB0aGlzXG4gICAgY29uc3Qgc3FscyA9IFtdXG4gICAgbGV0IHNxbCA9IFwiXCJcblxuICAgIGlmIChkYXRhYmFzZVR5cGUgPT0gXCJtc3NxbFwiICYmIGlmRXhpc3RzKSB7XG4gICAgICBzcWwgKz0gYElGIEVYSVNUUyhTRUxFQ1QgKiBGUk9NIFtzeXNvYmplY3RzXSBXSEVSRSBbbmFtZV0gPSAke29wdGlvbnMucXVvdGUodGFibGVOYW1lKX0gQU5EIFt4dHlwZV0gPSAnVScpIEJFR0lOIGBcbiAgICB9XG5cbiAgICBzcWwgKz0gXCJEUk9QIFRBQkxFXCJcblxuICAgIGlmIChkYXRhYmFzZVR5cGUgIT0gXCJtc3NxbFwiICYmIGlmRXhpc3RzKSBzcWwgKz0gXCIgSUYgRVhJU1RTXCJcblxuICAgIHNxbCArPSBgICR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZSh0YWJsZU5hbWUpfWBcblxuICAgIGlmIChjYXNjYWRlICYmIGRhdGFiYXNlVHlwZSA9PSBcInBnc3FsXCIpIHtcbiAgICAgIHNxbCArPSBcIiBjYXNjYWRlXCJcbiAgICB9XG5cbiAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwibXNzcWxcIiAmJiBpZkV4aXN0cykge1xuICAgICAgc3FsICs9IFwiIEVORFwiXG4gICAgfVxuXG4gICAgc3Fscy5wdXNoKHNxbClcblxuICAgIHJldHVybiBzcWxzXG4gIH1cbn1cbiJdfQ==
// @ts-check
import CreateDatabaseBase from "../../../query/create-database-base.js";
export default class VelociousDatabaseConnectionDriversMssqlSqlCreateDatabase extends CreateDatabaseBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../base.js").default} args.driver - Database driver instance.
     * @param {string} args.databaseName - Database name.
     * @param {boolean} [args.ifNotExists] - Whether if not exists.
     */
    constructor({ driver, databaseName, ifNotExists }) {
        super({ databaseName, driver });
        this.ifNotExists = ifNotExists;
    }
    toSql() {
        const { databaseName } = this;
        const options = this.getOptions();
        let sql = "";
        if (this.ifNotExists) {
            sql += `IF NOT EXISTS(SELECT * FROM [sys].[databases] WHERE [name] = ${options.quote(databaseName)}) BEGIN `;
        }
        sql += `CREATE DATABASE ${options.quoteDatabaseName(databaseName)}`;
        if (this.ifNotExists) {
            sql += " END";
        }
        return [sql];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLWRhdGFiYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvbXNzcWwvc3FsL2NyZWF0ZS1kYXRhYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxrQkFBa0IsTUFBTSx3Q0FBd0MsQ0FBQTtBQUV2RSxNQUFNLENBQUMsT0FBTyxPQUFPLHdEQUF5RCxTQUFRLGtCQUFrQjtJQUN0Rzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxXQUFXLEVBQUM7UUFDN0MsS0FBSyxDQUFDLEVBQUMsWUFBWSxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDN0IsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUE7SUFDaEMsQ0FBQztJQUVELEtBQUs7UUFDSCxNQUFNLEVBQUMsWUFBWSxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBQzNCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUVqQyxJQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFWixJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNyQixHQUFHLElBQUksZ0VBQWdFLE9BQU8sQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQTtRQUM5RyxDQUFDO1FBRUQsR0FBRyxJQUFJLG1CQUFtQixPQUFPLENBQUMsaUJBQWlCLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQTtRQUVuRSxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNyQixHQUFHLElBQUksTUFBTSxDQUFBO1FBQ2YsQ0FBQztRQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUNkLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ3JlYXRlRGF0YWJhc2VCYXNlIGZyb20gXCIuLi8uLi8uLi9xdWVyeS9jcmVhdGUtZGF0YWJhc2UtYmFzZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlQ29ubmVjdGlvbkRyaXZlcnNNc3NxbFNxbENyZWF0ZURhdGFiYXNlIGV4dGVuZHMgQ3JlYXRlRGF0YWJhc2VCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZk5vdEV4aXN0c10gLSBXaGV0aGVyIGlmIG5vdCBleGlzdHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZHJpdmVyLCBkYXRhYmFzZU5hbWUsIGlmTm90RXhpc3RzfSkge1xuICAgIHN1cGVyKHtkYXRhYmFzZU5hbWUsIGRyaXZlcn0pXG4gICAgdGhpcy5pZk5vdEV4aXN0cyA9IGlmTm90RXhpc3RzXG4gIH1cblxuICB0b1NxbCgpIHtcbiAgICBjb25zdCB7ZGF0YWJhc2VOYW1lfSA9IHRoaXNcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcblxuICAgIGxldCBzcWwgPSBcIlwiXG5cbiAgICBpZiAodGhpcy5pZk5vdEV4aXN0cykge1xuICAgICAgc3FsICs9IGBJRiBOT1QgRVhJU1RTKFNFTEVDVCAqIEZST00gW3N5c10uW2RhdGFiYXNlc10gV0hFUkUgW25hbWVdID0gJHtvcHRpb25zLnF1b3RlKGRhdGFiYXNlTmFtZSl9KSBCRUdJTiBgXG4gICAgfVxuXG4gICAgc3FsICs9IGBDUkVBVEUgREFUQUJBU0UgJHtvcHRpb25zLnF1b3RlRGF0YWJhc2VOYW1lKGRhdGFiYXNlTmFtZSl9YFxuXG4gICAgaWYgKHRoaXMuaWZOb3RFeGlzdHMpIHtcbiAgICAgIHNxbCArPSBcIiBFTkRcIlxuICAgIH1cblxuICAgIHJldHVybiBbc3FsXVxuICB9XG59XG4iXX0=
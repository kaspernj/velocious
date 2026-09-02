// @ts-check
import CreateDatabaseBase from "../../../query/create-database-base.js";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;
/**
 * Runs validate charset or collation.
 * @param {string} field - Field name (for error messages).
 * @param {string} value - Identifier value.
 * @returns {string} - Same value, validated.
 */
function validateCharsetOrCollation(field, value) {
    if (!IDENTIFIER_PATTERN.test(value)) {
        throw new Error(`Invalid ${field} value: ${JSON.stringify(value)} — expected [A-Za-z0-9_]+`);
    }
    return value;
}
export default class VelociousDatabaseConnectionDriversMysqlSqlCreateDatabase extends CreateDatabaseBase {
    /**
     * Runs to sql.
     * @returns {string[]} - SQL statements.
     */
    toSql() {
        const options = this.getOptions();
        let sql = "CREATE DATABASE";
        if (this.ifNotExists)
            sql += " IF NOT EXISTS";
        sql += ` ${options.quoteDatabaseName(this.databaseName)}`;
        if (this.databaseCharset)
            sql += ` CHARACTER SET ${validateCharsetOrCollation("databaseCharset", this.databaseCharset)}`;
        if (this.databaseCollation)
            sql += ` COLLATE ${validateCharsetOrCollation("databaseCollation", this.databaseCollation)}`;
        return [sql];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLWRhdGFiYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvbXlzcWwvc3FsL2NyZWF0ZS1kYXRhYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxrQkFBa0IsTUFBTSx3Q0FBd0MsQ0FBQTtBQUV2RSxNQUFNLGtCQUFrQixHQUFHLGlCQUFpQixDQUFBO0FBRTVDOzs7OztHQUtHO0FBQ0gsU0FBUywwQkFBMEIsQ0FBQyxLQUFLLEVBQUUsS0FBSztJQUM5QyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDcEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxXQUFXLEtBQUssV0FBVyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxDQUFBO0lBQzlGLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLHdEQUF5RCxTQUFRLGtCQUFrQjtJQUN0Rzs7O09BR0c7SUFDSCxLQUFLO1FBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ2pDLElBQUksR0FBRyxHQUFHLGlCQUFpQixDQUFBO1FBRTNCLElBQUksSUFBSSxDQUFDLFdBQVc7WUFBRSxHQUFHLElBQUksZ0JBQWdCLENBQUE7UUFFN0MsR0FBRyxJQUFJLElBQUksT0FBTyxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFBO1FBRXpELElBQUksSUFBSSxDQUFDLGVBQWU7WUFBRSxHQUFHLElBQUksa0JBQWtCLDBCQUEwQixDQUFDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFBO1FBQ3hILElBQUksSUFBSSxDQUFDLGlCQUFpQjtZQUFFLEdBQUcsSUFBSSxZQUFZLDBCQUEwQixDQUFDLG1CQUFtQixFQUFFLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUE7UUFFeEgsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQ2QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBDcmVhdGVEYXRhYmFzZUJhc2UgZnJvbSBcIi4uLy4uLy4uL3F1ZXJ5L2NyZWF0ZS1kYXRhYmFzZS1iYXNlLmpzXCJcblxuY29uc3QgSURFTlRJRklFUl9QQVRURVJOID0gL15bQS1aYS16MC05X10rJC9cblxuLyoqXG4gKiBSdW5zIHZhbGlkYXRlIGNoYXJzZXQgb3IgY29sbGF0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGZpZWxkIC0gRmllbGQgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIElkZW50aWZpZXIgdmFsdWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhbWUgdmFsdWUsIHZhbGlkYXRlZC5cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVDaGFyc2V0T3JDb2xsYXRpb24oZmllbGQsIHZhbHVlKSB7XG4gIGlmICghSURFTlRJRklFUl9QQVRURVJOLnRlc3QodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkICR7ZmllbGR9IHZhbHVlOiAke0pTT04uc3RyaW5naWZ5KHZhbHVlKX0g4oCUIGV4cGVjdGVkIFtBLVphLXowLTlfXStgKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlQ29ubmVjdGlvbkRyaXZlcnNNeXNxbFNxbENyZWF0ZURhdGFiYXNlIGV4dGVuZHMgQ3JlYXRlRGF0YWJhc2VCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICB0b1NxbCgpIHtcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcbiAgICBsZXQgc3FsID0gXCJDUkVBVEUgREFUQUJBU0VcIlxuXG4gICAgaWYgKHRoaXMuaWZOb3RFeGlzdHMpIHNxbCArPSBcIiBJRiBOT1QgRVhJU1RTXCJcblxuICAgIHNxbCArPSBgICR7b3B0aW9ucy5xdW90ZURhdGFiYXNlTmFtZSh0aGlzLmRhdGFiYXNlTmFtZSl9YFxuXG4gICAgaWYgKHRoaXMuZGF0YWJhc2VDaGFyc2V0KSBzcWwgKz0gYCBDSEFSQUNURVIgU0VUICR7dmFsaWRhdGVDaGFyc2V0T3JDb2xsYXRpb24oXCJkYXRhYmFzZUNoYXJzZXRcIiwgdGhpcy5kYXRhYmFzZUNoYXJzZXQpfWBcbiAgICBpZiAodGhpcy5kYXRhYmFzZUNvbGxhdGlvbikgc3FsICs9IGAgQ09MTEFURSAke3ZhbGlkYXRlQ2hhcnNldE9yQ29sbGF0aW9uKFwiZGF0YWJhc2VDb2xsYXRpb25cIiwgdGhpcy5kYXRhYmFzZUNvbGxhdGlvbil9YFxuXG4gICAgcmV0dXJuIFtzcWxdXG4gIH1cbn1cbiJdfQ==
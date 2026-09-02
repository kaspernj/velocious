// @ts-check
import DropDatabaseBase from "../../../query/drop-database-base.js";
export default class VelociousDatabaseConnectionDriversMssqlSqlDropDatabase extends DropDatabaseBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../base.js").default} args.driver - Database driver instance.
     * @param {string} args.databaseName - Database name.
     * @param {boolean} [args.ifExists] - Whether if exists.
     */
    constructor({ driver, databaseName, ifExists }) {
        super({ databaseName, driver });
        this.ifExists = ifExists;
    }
    toSql() {
        const { databaseName } = this;
        const options = this.getOptions();
        let sql = "";
        if (this.ifExists) {
            sql += `IF EXISTS(SELECT * FROM [sys].[databases] WHERE [name] = ${options.quote(databaseName)}) BEGIN `;
        }
        sql += `DROP DATABASE ${options.quoteDatabaseName(databaseName)}`;
        if (this.ifExists) {
            sql += " END";
        }
        return [sql];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHJvcC1kYXRhYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL21zc3FsL3NxbC9kcm9wLWRhdGFiYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGdCQUFnQixNQUFNLHNDQUFzQyxDQUFBO0FBRW5FLE1BQU0sQ0FBQyxPQUFPLE9BQU8sc0RBQXVELFNBQVEsZ0JBQWdCO0lBQ2xHOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBQztRQUMxQyxLQUFLLENBQUMsRUFBQyxZQUFZLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUM3QixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtJQUMxQixDQUFDO0lBRUQsS0FBSztRQUNILE1BQU0sRUFBQyxZQUFZLEVBQUMsR0FBRyxJQUFJLENBQUE7UUFDM0IsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBRWpDLElBQUksR0FBRyxHQUFHLEVBQUUsQ0FBQTtRQUVaLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2xCLEdBQUcsSUFBSSw0REFBNEQsT0FBTyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFBO1FBQzFHLENBQUM7UUFFRCxHQUFHLElBQUksaUJBQWlCLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFBO1FBRWpFLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2xCLEdBQUcsSUFBSSxNQUFNLENBQUE7UUFDZixDQUFDO1FBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQ2QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBEcm9wRGF0YWJhc2VCYXNlIGZyb20gXCIuLi8uLi8uLi9xdWVyeS9kcm9wLWRhdGFiYXNlLWJhc2UuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZUNvbm5lY3Rpb25Ecml2ZXJzTXNzcWxTcWxEcm9wRGF0YWJhc2UgZXh0ZW5kcyBEcm9wRGF0YWJhc2VCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZkV4aXN0c10gLSBXaGV0aGVyIGlmIGV4aXN0cy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtkcml2ZXIsIGRhdGFiYXNlTmFtZSwgaWZFeGlzdHN9KSB7XG4gICAgc3VwZXIoe2RhdGFiYXNlTmFtZSwgZHJpdmVyfSlcbiAgICB0aGlzLmlmRXhpc3RzID0gaWZFeGlzdHNcbiAgfVxuXG4gIHRvU3FsKCkge1xuICAgIGNvbnN0IHtkYXRhYmFzZU5hbWV9ID0gdGhpc1xuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLmdldE9wdGlvbnMoKVxuXG4gICAgbGV0IHNxbCA9IFwiXCJcblxuICAgIGlmICh0aGlzLmlmRXhpc3RzKSB7XG4gICAgICBzcWwgKz0gYElGIEVYSVNUUyhTRUxFQ1QgKiBGUk9NIFtzeXNdLltkYXRhYmFzZXNdIFdIRVJFIFtuYW1lXSA9ICR7b3B0aW9ucy5xdW90ZShkYXRhYmFzZU5hbWUpfSkgQkVHSU4gYFxuICAgIH1cblxuICAgIHNxbCArPSBgRFJPUCBEQVRBQkFTRSAke29wdGlvbnMucXVvdGVEYXRhYmFzZU5hbWUoZGF0YWJhc2VOYW1lKX1gXG5cbiAgICBpZiAodGhpcy5pZkV4aXN0cykge1xuICAgICAgc3FsICs9IFwiIEVORFwiXG4gICAgfVxuXG4gICAgcmV0dXJuIFtzcWxdXG4gIH1cbn1cbiJdfQ==
// @ts-check
/**
 * CreateDatabaseArgsType type.
 * @typedef {object} CreateDatabaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} databaseName - Name of the database to create.
 * @property {boolean} [ifNotExists] - Skip creation if the database already exists.
 * @property {string} [databaseCharset] - Database-default character set (driver-specific; currently used by mysql).
 * @property {string} [databaseCollation] - Database-default collation (driver-specific; currently used by mysql).
 */
import QueryBase from "./base.js";
export default class VelociousDatabaseQueryCreateDatabaseBase extends QueryBase {
    /**
     * Runs constructor.
     * @param {CreateDatabaseArgsType} args - Options object.
     */
    constructor({ driver, databaseName, ifNotExists, databaseCharset, databaseCollation }) {
        super({ driver });
        this.databaseName = databaseName;
        this.ifNotExists = ifNotExists;
        this.databaseCharset = databaseCharset;
        this.databaseCollation = databaseCollation;
    }
    /**
     * Runs to sql.
     * @returns {string[]} - SQL statements.
     */
    toSql() {
        const { databaseName } = this;
        let sql = "CREATE DATABASE";
        if (this.ifNotExists)
            sql += " IF NOT EXISTS";
        sql += ` ${this.getOptions().quoteDatabaseName(databaseName)}`;
        return [sql];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLWRhdGFiYXNlLWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvY3JlYXRlLWRhdGFiYXNlLWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7OztHQVFHO0FBRUgsT0FBTyxTQUFTLE1BQU0sV0FBVyxDQUFBO0FBRWpDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0NBQXlDLFNBQVEsU0FBUztJQUM3RTs7O09BR0c7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFFLGlCQUFpQixFQUFDO1FBQ2pGLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDZixJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtRQUNoQyxJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQTtRQUM5QixJQUFJLENBQUMsZUFBZSxHQUFHLGVBQWUsQ0FBQTtRQUN0QyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsaUJBQWlCLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUs7UUFDSCxNQUFNLEVBQUMsWUFBWSxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBQzNCLElBQUksR0FBRyxHQUFHLGlCQUFpQixDQUFBO1FBRTNCLElBQUksSUFBSSxDQUFDLFdBQVc7WUFBRSxHQUFHLElBQUksZ0JBQWdCLENBQUE7UUFFN0MsR0FBRyxJQUFJLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUE7UUFFOUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQ2QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQ3JlYXRlRGF0YWJhc2VBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ3JlYXRlRGF0YWJhc2VBcmdzVHlwZVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIHVzZWQgdG8gZ2VuZXJhdGUgU1FMLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIE5hbWUgb2YgdGhlIGRhdGFiYXNlIHRvIGNyZWF0ZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2lmTm90RXhpc3RzXSAtIFNraXAgY3JlYXRpb24gaWYgdGhlIGRhdGFiYXNlIGFscmVhZHkgZXhpc3RzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkYXRhYmFzZUNoYXJzZXRdIC0gRGF0YWJhc2UtZGVmYXVsdCBjaGFyYWN0ZXIgc2V0IChkcml2ZXItc3BlY2lmaWM7IGN1cnJlbnRseSB1c2VkIGJ5IG15c3FsKS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VDb2xsYXRpb25dIC0gRGF0YWJhc2UtZGVmYXVsdCBjb2xsYXRpb24gKGRyaXZlci1zcGVjaWZpYzsgY3VycmVudGx5IHVzZWQgYnkgbXlzcWwpLlxuICovXG5cbmltcG9ydCBRdWVyeUJhc2UgZnJvbSBcIi4vYmFzZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlDcmVhdGVEYXRhYmFzZUJhc2UgZXh0ZW5kcyBRdWVyeUJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtDcmVhdGVEYXRhYmFzZUFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZHJpdmVyLCBkYXRhYmFzZU5hbWUsIGlmTm90RXhpc3RzLCBkYXRhYmFzZUNoYXJzZXQsIGRhdGFiYXNlQ29sbGF0aW9ufSkge1xuICAgIHN1cGVyKHtkcml2ZXJ9KVxuICAgIHRoaXMuZGF0YWJhc2VOYW1lID0gZGF0YWJhc2VOYW1lXG4gICAgdGhpcy5pZk5vdEV4aXN0cyA9IGlmTm90RXhpc3RzXG4gICAgdGhpcy5kYXRhYmFzZUNoYXJzZXQgPSBkYXRhYmFzZUNoYXJzZXRcbiAgICB0aGlzLmRhdGFiYXNlQ29sbGF0aW9uID0gZGF0YWJhc2VDb2xsYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIHNxbC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgdG9TcWwoKSB7XG4gICAgY29uc3Qge2RhdGFiYXNlTmFtZX0gPSB0aGlzXG4gICAgbGV0IHNxbCA9IFwiQ1JFQVRFIERBVEFCQVNFXCJcblxuICAgIGlmICh0aGlzLmlmTm90RXhpc3RzKSBzcWwgKz0gXCIgSUYgTk9UIEVYSVNUU1wiXG5cbiAgICBzcWwgKz0gYCAke3RoaXMuZ2V0T3B0aW9ucygpLnF1b3RlRGF0YWJhc2VOYW1lKGRhdGFiYXNlTmFtZSl9YFxuXG4gICAgcmV0dXJuIFtzcWxdXG4gIH1cbn1cbiJdfQ==
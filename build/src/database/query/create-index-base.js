// @ts-check
import QueryBase from "./base.js";
/**
 * CreateIndexBaseArgsType type.
 * @typedef {object} CreateIndexBaseArgsType
 * @property {Array<string | import("./../table-data/table-column.js").default>} columns - Columns to include in the index.
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
 * @property {string} [name] - Explicit index name to use.
 * @property {boolean} [unique] - Whether the index should enforce uniqueness.
 * @property {string} tableName - Name of the table to add the index to.
 */
export default class VelociousDatabaseQueryCreateIndexBase extends QueryBase {
    /**
     * Runs constructor.
     * @param {CreateIndexBaseArgsType} args - Options object.
     */
    constructor({ columns, driver, ifNotExists, name, unique, tableName }) {
        super({ driver });
        this.columns = columns;
        this.name = name;
        this.tableName = tableName;
        this.ifNotExists = ifNotExists;
        this.unique = unique;
    }
    generateIndexName() {
        const databaseType = this.getDriver().getType();
        let indexName = `index_on_`;
        let columnCount = 0;
        if (databaseType == "sqlite" || databaseType == "pgsql")
            indexName += `${this.tableName}_`;
        for (const column of this.columns) {
            columnCount++;
            if (columnCount > 1)
                indexName += "_and_";
            let columnName;
            if (typeof column == "string") {
                columnName = column;
            }
            else {
                columnName = column.getName();
            }
            indexName += columnName;
        }
        return indexName;
    }
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async toSQLs() {
        const databaseType = this.getDriver().getType();
        const indexName = this.name || this.generateIndexName();
        const options = this.getOptions();
        const { tableName } = this;
        let sql = "";
        if (this.ifNotExists && databaseType == "mssql") {
            sql += `
        IF NOT EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE
            name = ${options.quote(indexName)} AND
            object_id = OBJECT_ID(${options.quote(`dbo.${tableName}`)})
        )
        BEGIN
      `;
        }
        sql += "CREATE";
        if (this.unique)
            sql += " UNIQUE";
        sql += " INDEX";
        if (this.ifNotExists && databaseType != "mssql")
            sql += " IF NOT EXISTS";
        sql += ` ${options.quoteIndexName(indexName)}`;
        sql += ` ON ${options.quoteTableName(tableName)} (`;
        let columnCount = 0;
        for (const column of this.columns) {
            columnCount++;
            if (columnCount > 1)
                sql += ", ";
            let columnName;
            if (typeof column == "string") {
                columnName = column;
            }
            else {
                columnName = column.getName();
            }
            sql += `${options.quoteColumnName(columnName)}`;
        }
        sql += ")";
        if (this.ifNotExists && databaseType == "mssql") {
            sql += " END";
        }
        return [sql];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLWluZGV4LWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvY3JlYXRlLWluZGV4LWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLFdBQVcsQ0FBQTtBQUVqQzs7Ozs7Ozs7O0dBU0c7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLHFDQUFzQyxTQUFRLFNBQVM7SUFDMUU7OztPQUdHO0lBQ0gsWUFBWSxFQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDO1FBQ2pFLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDZixJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtRQUN0QixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUNoQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtRQUMxQixJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQTtRQUM5QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtJQUN0QixDQUFDO0lBRUQsaUJBQWlCO1FBQ2YsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQy9DLElBQUksU0FBUyxHQUFHLFdBQVcsQ0FBQTtRQUMzQixJQUFJLFdBQVcsR0FBRyxDQUFDLENBQUE7UUFFbkIsSUFBSSxZQUFZLElBQUksUUFBUSxJQUFJLFlBQVksSUFBSSxPQUFPO1lBQUUsU0FBUyxJQUFJLEdBQUcsSUFBSSxDQUFDLFNBQVMsR0FBRyxDQUFBO1FBRTFGLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xDLFdBQVcsRUFBRSxDQUFBO1lBRWIsSUFBSSxXQUFXLEdBQUcsQ0FBQztnQkFBRSxTQUFTLElBQUksT0FBTyxDQUFBO1lBRXpDLElBQUksVUFBVSxDQUFBO1lBRWQsSUFBSSxPQUFPLE1BQU0sSUFBSSxRQUFRLEVBQUUsQ0FBQztnQkFDOUIsVUFBVSxHQUFHLE1BQU0sQ0FBQTtZQUNyQixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sVUFBVSxHQUFHLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtZQUMvQixDQUFDO1lBRUQsU0FBUyxJQUFJLFVBQVUsQ0FBQTtRQUN6QixDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxNQUFNO1FBQ1YsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQy9DLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDdkQsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ2pDLE1BQU0sRUFBQyxTQUFTLEVBQUMsR0FBRyxJQUFJLENBQUE7UUFDeEIsSUFBSSxHQUFHLEdBQUcsRUFBRSxDQUFBO1FBRVosSUFBSSxJQUFJLENBQUMsV0FBVyxJQUFJLFlBQVksSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNoRCxHQUFHLElBQUk7Ozs7O3FCQUtRLE9BQU8sQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDO29DQUNULE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxTQUFTLEVBQUUsQ0FBQzs7O09BRzlELENBQUE7UUFDSCxDQUFDO1FBRUQsR0FBRyxJQUFJLFFBQVEsQ0FBQTtRQUVmLElBQUksSUFBSSxDQUFDLE1BQU07WUFBRSxHQUFHLElBQUksU0FBUyxDQUFBO1FBRWpDLEdBQUcsSUFBSSxRQUFRLENBQUE7UUFFZixJQUFJLElBQUksQ0FBQyxXQUFXLElBQUksWUFBWSxJQUFJLE9BQU87WUFBRSxHQUFHLElBQUksZ0JBQWdCLENBQUE7UUFFeEUsR0FBRyxJQUFJLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFBO1FBQzlDLEdBQUcsSUFBSSxPQUFPLE9BQU8sQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQTtRQUVuRCxJQUFJLFdBQVcsR0FBRyxDQUFDLENBQUE7UUFFbkIsS0FBSyxNQUFNLE1BQU0sSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDbEMsV0FBVyxFQUFFLENBQUE7WUFFYixJQUFJLFdBQVcsR0FBRyxDQUFDO2dCQUFFLEdBQUcsSUFBSSxJQUFJLENBQUE7WUFFaEMsSUFBSSxVQUFVLENBQUE7WUFFZCxJQUFJLE9BQU8sTUFBTSxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUM5QixVQUFVLEdBQUcsTUFBTSxDQUFBO1lBQ3JCLENBQUM7aUJBQU0sQ0FBQztnQkFDTixVQUFVLEdBQUcsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBQy9CLENBQUM7WUFFRCxHQUFHLElBQUksR0FBRyxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUE7UUFDakQsQ0FBQztRQUVELEdBQUcsSUFBSSxHQUFHLENBQUE7UUFFVixJQUFJLElBQUksQ0FBQyxXQUFXLElBQUksWUFBWSxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQ2hELEdBQUcsSUFBSSxNQUFNLENBQUE7UUFDZixDQUFDO1FBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQ2QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBRdWVyeUJhc2UgZnJvbSBcIi4vYmFzZS5qc1wiXG5cbi8qKlxuICogQ3JlYXRlSW5kZXhCYXNlQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENyZWF0ZUluZGV4QmFzZUFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge0FycmF5PHN0cmluZyB8IGltcG9ydChcIi4vLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IGNvbHVtbnMgLSBDb2x1bW5zIHRvIGluY2x1ZGUgaW4gdGhlIGluZGV4LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIHVzZWQgdG8gZ2VuZXJhdGUgU1FMLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaWZOb3RFeGlzdHNdIC0gU2tpcCBjcmVhdGlvbiBpZiB0aGUgaW5kZXggYWxyZWFkeSBleGlzdHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gRXhwbGljaXQgaW5kZXggbmFtZSB0byB1c2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFt1bmlxdWVdIC0gV2hldGhlciB0aGUgaW5kZXggc2hvdWxkIGVuZm9yY2UgdW5pcXVlbmVzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBOYW1lIG9mIHRoZSB0YWJsZSB0byBhZGQgdGhlIGluZGV4IHRvLlxuICovXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlDcmVhdGVJbmRleEJhc2UgZXh0ZW5kcyBRdWVyeUJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtDcmVhdGVJbmRleEJhc2VBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbHVtbnMsIGRyaXZlciwgaWZOb3RFeGlzdHMsIG5hbWUsIHVuaXF1ZSwgdGFibGVOYW1lfSkge1xuICAgIHN1cGVyKHtkcml2ZXJ9KVxuICAgIHRoaXMuY29sdW1ucyA9IGNvbHVtbnNcbiAgICB0aGlzLm5hbWUgPSBuYW1lXG4gICAgdGhpcy50YWJsZU5hbWUgPSB0YWJsZU5hbWVcbiAgICB0aGlzLmlmTm90RXhpc3RzID0gaWZOb3RFeGlzdHNcbiAgICB0aGlzLnVuaXF1ZSA9IHVuaXF1ZVxuICB9XG5cbiAgZ2VuZXJhdGVJbmRleE5hbWUoKSB7XG4gICAgY29uc3QgZGF0YWJhc2VUeXBlID0gdGhpcy5nZXREcml2ZXIoKS5nZXRUeXBlKClcbiAgICBsZXQgaW5kZXhOYW1lID0gYGluZGV4X29uX2BcbiAgICBsZXQgY29sdW1uQ291bnQgPSAwXG5cbiAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwic3FsaXRlXCIgfHwgZGF0YWJhc2VUeXBlID09IFwicGdzcWxcIikgaW5kZXhOYW1lICs9IGAke3RoaXMudGFibGVOYW1lfV9gXG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiB0aGlzLmNvbHVtbnMpIHtcbiAgICAgIGNvbHVtbkNvdW50KytcblxuICAgICAgaWYgKGNvbHVtbkNvdW50ID4gMSkgaW5kZXhOYW1lICs9IFwiX2FuZF9cIlxuXG4gICAgICBsZXQgY29sdW1uTmFtZVxuXG4gICAgICBpZiAodHlwZW9mIGNvbHVtbiA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGNvbHVtbk5hbWUgPSBjb2x1bW5cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbHVtbk5hbWUgPSBjb2x1bW4uZ2V0TmFtZSgpXG4gICAgICB9XG5cbiAgICAgIGluZGV4TmFtZSArPSBjb2x1bW5OYW1lXG4gICAgfVxuXG4gICAgcmV0dXJuIGluZGV4TmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3Fscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyB0b1NRTHMoKSB7XG4gICAgY29uc3QgZGF0YWJhc2VUeXBlID0gdGhpcy5nZXREcml2ZXIoKS5nZXRUeXBlKClcbiAgICBjb25zdCBpbmRleE5hbWUgPSB0aGlzLm5hbWUgfHwgdGhpcy5nZW5lcmF0ZUluZGV4TmFtZSgpXG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuZ2V0T3B0aW9ucygpXG4gICAgY29uc3Qge3RhYmxlTmFtZX0gPSB0aGlzXG4gICAgbGV0IHNxbCA9IFwiXCJcblxuICAgIGlmICh0aGlzLmlmTm90RXhpc3RzICYmIGRhdGFiYXNlVHlwZSA9PSBcIm1zc3FsXCIpIHtcbiAgICAgIHNxbCArPSBgXG4gICAgICAgIElGIE5PVCBFWElTVFMgKFxuICAgICAgICAgIFNFTEVDVCAxXG4gICAgICAgICAgRlJPTSBzeXMuaW5kZXhlc1xuICAgICAgICAgIFdIRVJFXG4gICAgICAgICAgICBuYW1lID0gJHtvcHRpb25zLnF1b3RlKGluZGV4TmFtZSl9IEFORFxuICAgICAgICAgICAgb2JqZWN0X2lkID0gT0JKRUNUX0lEKCR7b3B0aW9ucy5xdW90ZShgZGJvLiR7dGFibGVOYW1lfWApfSlcbiAgICAgICAgKVxuICAgICAgICBCRUdJTlxuICAgICAgYFxuICAgIH1cblxuICAgIHNxbCArPSBcIkNSRUFURVwiXG5cbiAgICBpZiAodGhpcy51bmlxdWUpIHNxbCArPSBcIiBVTklRVUVcIlxuXG4gICAgc3FsICs9IFwiIElOREVYXCJcblxuICAgIGlmICh0aGlzLmlmTm90RXhpc3RzICYmIGRhdGFiYXNlVHlwZSAhPSBcIm1zc3FsXCIpIHNxbCArPSBcIiBJRiBOT1QgRVhJU1RTXCJcblxuICAgIHNxbCArPSBgICR7b3B0aW9ucy5xdW90ZUluZGV4TmFtZShpbmRleE5hbWUpfWBcbiAgICBzcWwgKz0gYCBPTiAke29wdGlvbnMucXVvdGVUYWJsZU5hbWUodGFibGVOYW1lKX0gKGBcblxuICAgIGxldCBjb2x1bW5Db3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuY29sdW1ucykge1xuICAgICAgY29sdW1uQ291bnQrK1xuXG4gICAgICBpZiAoY29sdW1uQ291bnQgPiAxKSBzcWwgKz0gXCIsIFwiXG5cbiAgICAgIGxldCBjb2x1bW5OYW1lXG5cbiAgICAgIGlmICh0eXBlb2YgY29sdW1uID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgY29sdW1uTmFtZSA9IGNvbHVtblxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29sdW1uTmFtZSA9IGNvbHVtbi5nZXROYW1lKClcbiAgICAgIH1cblxuICAgICAgc3FsICs9IGAke29wdGlvbnMucXVvdGVDb2x1bW5OYW1lKGNvbHVtbk5hbWUpfWBcbiAgICB9XG5cbiAgICBzcWwgKz0gXCIpXCJcblxuICAgIGlmICh0aGlzLmlmTm90RXhpc3RzICYmIGRhdGFiYXNlVHlwZSA9PSBcIm1zc3FsXCIpIHtcbiAgICAgIHNxbCArPSBcIiBFTkRcIlxuICAgIH1cblxuICAgIHJldHVybiBbc3FsXVxuICB9XG59XG4iXX0=
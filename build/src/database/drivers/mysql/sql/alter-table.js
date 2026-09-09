// @ts-check
import AlterTableBase from "../../../query/alter-table-base.js";
import TableColumn from "../../../table-data/table-column.js";
export default class VelociousDatabaseConnectionDriversMysqlSqlAlterTable extends AlterTableBase {
    /**
     * Runs get drop foreign key sql.
     * @param {import("../../../table-data/table-foreign-key.js").default} foreignKey - Foreign key to drop.
     * @returns {string} - SQL fragment that removes the foreign key.
     */
    getDropForeignKeySQL(foreignKey) {
        const name = foreignKey.getName();
        if (!name)
            throw new Error(`Cannot remove unnamed foreign key on ${foreignKey.getTableName()}.${foreignKey.getColumnName()}`);
        return `DROP FOREIGN KEY ${this.getOptions().quoteIndexName(name)}`;
    }
    /**
     * Builds MySQL ALTER TABLE statements, adding indexes atomically with columns.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async toSQLs() {
        const sqls = await super.toSQLs();
        const indexes = this.tableData.getIndexes();
        if (indexes.length === 0)
            return sqls;
        if (sqls.length > 1)
            throw new Error("Expected one MySQL ALTER TABLE statement when adding indexes");
        const options = this.getOptions();
        let sql = sqls[0];
        let needsIndexSeparator = true;
        if (sql === undefined) {
            sql = `ALTER TABLE ${options.quoteTableName(this.tableData.getName())} `;
            needsIndexSeparator = false;
        }
        for (const index of indexes) {
            if (needsIndexSeparator) {
                sql += ", ";
            }
            else {
                needsIndexSeparator = true;
            }
            sql += "ADD";
            if (index.getUnique())
                sql += " UNIQUE";
            sql += " INDEX";
            const indexName = index.getName();
            if (typeof indexName === "string") {
                sql += ` ${options.quoteIndexName(indexName)}`;
            }
            sql += " (";
            sql += index
                .getColumns()
                .map((column) => {
                const columnName = column instanceof TableColumn ? column.getName() : column;
                return options.quoteColumnName(columnName);
            })
                .join(", ");
            sql += ")";
        }
        return [sql];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWx0ZXItdGFibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9teXNxbC9zcWwvYWx0ZXItdGFibGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLG9DQUFvQyxDQUFBO0FBQy9ELE9BQU8sV0FBVyxNQUFNLHFDQUFxQyxDQUFBO0FBRTdELE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0RBQXFELFNBQVEsY0FBYztJQUM5Rjs7OztPQUlHO0lBQ0gsb0JBQW9CLENBQUMsVUFBVTtRQUM3QixNQUFNLElBQUksR0FBRyxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUE7UUFFakMsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxVQUFVLENBQUMsWUFBWSxFQUFFLElBQUksVUFBVSxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUU3SCxPQUFPLG9CQUFvQixJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUE7SUFDckUsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxNQUFNO1FBQ1YsTUFBTSxJQUFJLEdBQUcsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUE7UUFDakMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUUzQyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQ3JDLElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4REFBOEQsQ0FBQyxDQUFBO1FBRXBHLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUNqQyxJQUFJLEdBQUcsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDakIsSUFBSSxtQkFBbUIsR0FBRyxJQUFJLENBQUE7UUFFOUIsSUFBSSxHQUFHLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDdEIsR0FBRyxHQUFHLGVBQWUsT0FBTyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRSxDQUFDLEdBQUcsQ0FBQTtZQUN4RSxtQkFBbUIsR0FBRyxLQUFLLENBQUE7UUFDN0IsQ0FBQztRQUVELEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxFQUFFLENBQUM7WUFDNUIsSUFBSSxtQkFBbUIsRUFBRSxDQUFDO2dCQUN4QixHQUFHLElBQUksSUFBSSxDQUFBO1lBQ2IsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLG1CQUFtQixHQUFHLElBQUksQ0FBQTtZQUM1QixDQUFDO1lBRUQsR0FBRyxJQUFJLEtBQUssQ0FBQTtZQUVaLElBQUksS0FBSyxDQUFDLFNBQVMsRUFBRTtnQkFBRSxHQUFHLElBQUksU0FBUyxDQUFBO1lBRXZDLEdBQUcsSUFBSSxRQUFRLENBQUE7WUFFZixNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUE7WUFFakMsSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDbEMsR0FBRyxJQUFJLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFBO1lBQ2hELENBQUM7WUFFRCxHQUFHLElBQUksSUFBSSxDQUFBO1lBQ1gsR0FBRyxJQUFJLEtBQUs7aUJBQ1QsVUFBVSxFQUFFO2lCQUNaLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFO2dCQUNkLE1BQU0sVUFBVSxHQUFHLE1BQU0sWUFBWSxXQUFXLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFBO2dCQUU1RSxPQUFPLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDNUMsQ0FBQyxDQUFDO2lCQUNELElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUNiLEdBQUcsSUFBSSxHQUFHLENBQUE7UUFDWixDQUFDO1FBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQ2QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBbHRlclRhYmxlQmFzZSBmcm9tIFwiLi4vLi4vLi4vcXVlcnkvYWx0ZXItdGFibGUtYmFzZS5qc1wiXG5pbXBvcnQgVGFibGVDb2x1bW4gZnJvbSBcIi4uLy4uLy4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VDb25uZWN0aW9uRHJpdmVyc015c3FsU3FsQWx0ZXJUYWJsZSBleHRlbmRzIEFsdGVyVGFibGVCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRyb3AgZm9yZWlnbiBrZXkgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL3RhYmxlLWRhdGEvdGFibGUtZm9yZWlnbi1rZXkuanNcIikuZGVmYXVsdH0gZm9yZWlnbktleSAtIEZvcmVpZ24ga2V5IHRvIGRyb3AuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIGZyYWdtZW50IHRoYXQgcmVtb3ZlcyB0aGUgZm9yZWlnbiBrZXkuXG4gICAqL1xuICBnZXREcm9wRm9yZWlnbktleVNRTChmb3JlaWduS2V5KSB7XG4gICAgY29uc3QgbmFtZSA9IGZvcmVpZ25LZXkuZ2V0TmFtZSgpXG5cbiAgICBpZiAoIW5hbWUpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJlbW92ZSB1bm5hbWVkIGZvcmVpZ24ga2V5IG9uICR7Zm9yZWlnbktleS5nZXRUYWJsZU5hbWUoKX0uJHtmb3JlaWduS2V5LmdldENvbHVtbk5hbWUoKX1gKVxuXG4gICAgcmV0dXJuIGBEUk9QIEZPUkVJR04gS0VZICR7dGhpcy5nZXRPcHRpb25zKCkucXVvdGVJbmRleE5hbWUobmFtZSl9YFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBNeVNRTCBBTFRFUiBUQUJMRSBzdGF0ZW1lbnRzLCBhZGRpbmcgaW5kZXhlcyBhdG9taWNhbGx5IHdpdGggY29sdW1ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyB0b1NRTHMoKSB7XG4gICAgY29uc3Qgc3FscyA9IGF3YWl0IHN1cGVyLnRvU1FMcygpXG4gICAgY29uc3QgaW5kZXhlcyA9IHRoaXMudGFibGVEYXRhLmdldEluZGV4ZXMoKVxuXG4gICAgaWYgKGluZGV4ZXMubGVuZ3RoID09PSAwKSByZXR1cm4gc3Fsc1xuICAgIGlmIChzcWxzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG9uZSBNeVNRTCBBTFRFUiBUQUJMRSBzdGF0ZW1lbnQgd2hlbiBhZGRpbmcgaW5kZXhlc1wiKVxuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuZ2V0T3B0aW9ucygpXG4gICAgbGV0IHNxbCA9IHNxbHNbMF1cbiAgICBsZXQgbmVlZHNJbmRleFNlcGFyYXRvciA9IHRydWVcblxuICAgIGlmIChzcWwgPT09IHVuZGVmaW5lZCkge1xuICAgICAgc3FsID0gYEFMVEVSIFRBQkxFICR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZSh0aGlzLnRhYmxlRGF0YS5nZXROYW1lKCkpfSBgXG4gICAgICBuZWVkc0luZGV4U2VwYXJhdG9yID0gZmFsc2VcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGluZGV4IG9mIGluZGV4ZXMpIHtcbiAgICAgIGlmIChuZWVkc0luZGV4U2VwYXJhdG9yKSB7XG4gICAgICAgIHNxbCArPSBcIiwgXCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5lZWRzSW5kZXhTZXBhcmF0b3IgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIHNxbCArPSBcIkFERFwiXG5cbiAgICAgIGlmIChpbmRleC5nZXRVbmlxdWUoKSkgc3FsICs9IFwiIFVOSVFVRVwiXG5cbiAgICAgIHNxbCArPSBcIiBJTkRFWFwiXG5cbiAgICAgIGNvbnN0IGluZGV4TmFtZSA9IGluZGV4LmdldE5hbWUoKVxuXG4gICAgICBpZiAodHlwZW9mIGluZGV4TmFtZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBzcWwgKz0gYCAke29wdGlvbnMucXVvdGVJbmRleE5hbWUoaW5kZXhOYW1lKX1gXG4gICAgICB9XG5cbiAgICAgIHNxbCArPSBcIiAoXCJcbiAgICAgIHNxbCArPSBpbmRleFxuICAgICAgICAuZ2V0Q29sdW1ucygpXG4gICAgICAgIC5tYXAoKGNvbHVtbikgPT4ge1xuICAgICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBjb2x1bW4gaW5zdGFuY2VvZiBUYWJsZUNvbHVtbiA/IGNvbHVtbi5nZXROYW1lKCkgOiBjb2x1bW5cblxuICAgICAgICAgIHJldHVybiBvcHRpb25zLnF1b3RlQ29sdW1uTmFtZShjb2x1bW5OYW1lKVxuICAgICAgICB9KVxuICAgICAgICAuam9pbihcIiwgXCIpXG4gICAgICBzcWwgKz0gXCIpXCJcbiAgICB9XG5cbiAgICByZXR1cm4gW3NxbF1cbiAgfVxufVxuIl19
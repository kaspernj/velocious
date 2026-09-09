// @ts-check
import WhereBase from "./where-base.js";
import WhereIn from "./where-in.js";
/**
 * VelociousDatabaseQueryWhereHash class.
 * @typedef {{[key: string]: string | number | boolean | null | Array<string | number | boolean | null> | WhereHash}} WhereHash
 */
export default class VelociousDatabaseQueryWhereHash extends WhereBase {
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {WhereHash} hash - Hash.
     */
    constructor(query, hash) {
        super();
        this.hash = hash;
        this.query = query;
    }
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql() {
        let sql = "(";
        sql += this._whereSQLFromHash(this.hash);
        sql += ")";
        return sql;
    }
    /**
     * Runs where sqlfrom hash.
     * @param {WhereHash} hash - Hash.
     * @param {string} [tableName] - Table name.
     * @param {number} index - Index value.
     * @returns {string} - SQL string.
     */
    _whereSQLFromHash(hash, tableName, index = 0) {
        const options = this.getOptions();
        let sql = "";
        for (const whereKey in hash) {
            const whereValue = hash[whereKey];
            if (Array.isArray(whereValue) && whereValue.length === 0) {
                if (index > 0)
                    sql += " AND ";
                sql += "1=0";
            }
            else if (!Array.isArray(whereValue) && whereValue !== null && typeof whereValue == "object") {
                if (tableName && "in" in whereValue) {
                    if (index > 0)
                        sql += " AND ";
                    sql += WhereIn.toSql({
                        columnSql: `${options.quoteTableName(tableName)}.${options.quoteColumnName(whereKey)}`,
                        options,
                        values: WhereIn.values(whereValue)
                    });
                }
                else {
                    sql += this._whereSQLFromHash(whereValue, whereKey, index);
                }
            }
            else {
                if (index > 0)
                    sql += " AND ";
                if (tableName) {
                    sql += `${options.quoteTableName(tableName)}.`;
                }
                sql += `${options.quoteColumnName(whereKey)}`;
                if (Array.isArray(whereValue)) {
                    sql += ` IN (${whereValue.map((value) => options.quote(value)).join(", ")})`;
                }
                else if (whereValue === null) {
                    sql += " IS NULL";
                }
                else {
                    sql += ` = ${options.quote(whereValue)}`;
                }
            }
            index++;
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtaGFzaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS93aGVyZS1oYXNoLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUN2QyxPQUFPLE9BQU8sTUFBTSxlQUFlLENBQUE7QUFFbkM7OztHQUdHO0FBRUgsTUFBTSxDQUFDLE9BQU8sT0FBTywrQkFBZ0MsU0FBUSxTQUFTO0lBQ3BFOzs7O09BSUc7SUFDSCxZQUFZLEtBQUssRUFBRSxJQUFJO1FBQ3JCLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUs7UUFDSCxJQUFJLEdBQUcsR0FBRyxHQUFHLENBQUE7UUFFYixHQUFHLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUN4QyxHQUFHLElBQUksR0FBRyxDQUFBO1FBRVYsT0FBTyxHQUFHLENBQUE7SUFDWixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsaUJBQWlCLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxLQUFLLEdBQUcsQ0FBQztRQUMxQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDakMsSUFBSSxHQUFHLEdBQUcsRUFBRSxDQUFBO1FBRVosS0FBSyxNQUFNLFFBQVEsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUM1QixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFFakMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3pELElBQUksS0FBSyxHQUFHLENBQUM7b0JBQUUsR0FBRyxJQUFJLE9BQU8sQ0FBQTtnQkFDN0IsR0FBRyxJQUFJLEtBQUssQ0FBQTtZQUNkLENBQUM7aUJBQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksVUFBVSxLQUFLLElBQUksSUFBSSxPQUFPLFVBQVUsSUFBSSxRQUFRLEVBQUUsQ0FBQztnQkFDOUYsSUFBSSxTQUFTLElBQUksSUFBSSxJQUFJLFVBQVUsRUFBRSxDQUFDO29CQUNwQyxJQUFJLEtBQUssR0FBRyxDQUFDO3dCQUFFLEdBQUcsSUFBSSxPQUFPLENBQUE7b0JBRTdCLEdBQUcsSUFBSSxPQUFPLENBQUMsS0FBSyxDQUFDO3dCQUNuQixTQUFTLEVBQUUsR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDLEVBQUU7d0JBQ3RGLE9BQU87d0JBQ1AsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDO3FCQUNuQyxDQUFDLENBQUE7Z0JBQ0osQ0FBQztxQkFBTSxDQUFDO29CQUNOLEdBQUcsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxLQUFLLENBQUMsQ0FBQTtnQkFDNUQsQ0FBQztZQUNILENBQUM7aUJBQU0sQ0FBQztnQkFDTixJQUFJLEtBQUssR0FBRyxDQUFDO29CQUFFLEdBQUcsSUFBSSxPQUFPLENBQUE7Z0JBRTdCLElBQUksU0FBUyxFQUFFLENBQUM7b0JBQ2QsR0FBRyxJQUFJLEdBQUcsT0FBTyxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFBO2dCQUNoRCxDQUFDO2dCQUVELEdBQUcsSUFBSSxHQUFHLE9BQU8sQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQTtnQkFFN0MsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7b0JBQzlCLEdBQUcsSUFBSSxRQUFRLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQTtnQkFDOUUsQ0FBQztxQkFBTSxJQUFJLFVBQVUsS0FBSyxJQUFJLEVBQUUsQ0FBQztvQkFDL0IsR0FBRyxJQUFJLFVBQVUsQ0FBQTtnQkFDbkIsQ0FBQztxQkFBTSxDQUFDO29CQUNOLEdBQUcsSUFBSSxNQUFNLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQTtnQkFDMUMsQ0FBQztZQUNILENBQUM7WUFFRCxLQUFLLEVBQUUsQ0FBQTtRQUNULENBQUM7UUFFRCxPQUFPLEdBQUcsQ0FBQTtJQUNaLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgV2hlcmVCYXNlIGZyb20gXCIuL3doZXJlLWJhc2UuanNcIlxuaW1wb3J0IFdoZXJlSW4gZnJvbSBcIi4vd2hlcmUtaW4uanNcIlxuXG4vKipcbiAqIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlXaGVyZUhhc2ggY2xhc3MuXG4gKiBAdHlwZWRlZiB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBudWxsIHwgQXJyYXk8c3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGw+IHwgV2hlcmVIYXNofX0gV2hlcmVIYXNoXG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVdoZXJlSGFzaCBleHRlbmRzIFdoZXJlQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtXaGVyZUhhc2h9IGhhc2ggLSBIYXNoLlxuICAgKi9cbiAgY29uc3RydWN0b3IocXVlcnksIGhhc2gpIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5oYXNoID0gaGFzaFxuICAgIHRoaXMucXVlcnkgPSBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB0b1NxbCgpIHtcbiAgICBsZXQgc3FsID0gXCIoXCJcblxuICAgIHNxbCArPSB0aGlzLl93aGVyZVNRTEZyb21IYXNoKHRoaXMuaGFzaClcbiAgICBzcWwgKz0gXCIpXCJcblxuICAgIHJldHVybiBzcWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlIHNxbGZyb20gaGFzaC5cbiAgICogQHBhcmFtIHtXaGVyZUhhc2h9IGhhc2ggLSBIYXNoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3RhYmxlTmFtZV0gLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBJbmRleCB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgX3doZXJlU1FMRnJvbUhhc2goaGFzaCwgdGFibGVOYW1lLCBpbmRleCA9IDApIHtcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcbiAgICBsZXQgc3FsID0gXCJcIlxuXG4gICAgZm9yIChjb25zdCB3aGVyZUtleSBpbiBoYXNoKSB7XG4gICAgICBjb25zdCB3aGVyZVZhbHVlID0gaGFzaFt3aGVyZUtleV1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkod2hlcmVWYWx1ZSkgJiYgd2hlcmVWYWx1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaWYgKGluZGV4ID4gMCkgc3FsICs9IFwiIEFORCBcIlxuICAgICAgICBzcWwgKz0gXCIxPTBcIlxuICAgICAgfSBlbHNlIGlmICghQXJyYXkuaXNBcnJheSh3aGVyZVZhbHVlKSAmJiB3aGVyZVZhbHVlICE9PSBudWxsICYmIHR5cGVvZiB3aGVyZVZhbHVlID09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgaWYgKHRhYmxlTmFtZSAmJiBcImluXCIgaW4gd2hlcmVWYWx1ZSkge1xuICAgICAgICAgIGlmIChpbmRleCA+IDApIHNxbCArPSBcIiBBTkQgXCJcblxuICAgICAgICAgIHNxbCArPSBXaGVyZUluLnRvU3FsKHtcbiAgICAgICAgICAgIGNvbHVtblNxbDogYCR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZSh0YWJsZU5hbWUpfS4ke29wdGlvbnMucXVvdGVDb2x1bW5OYW1lKHdoZXJlS2V5KX1gLFxuICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgIHZhbHVlczogV2hlcmVJbi52YWx1ZXMod2hlcmVWYWx1ZSlcbiAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNxbCArPSB0aGlzLl93aGVyZVNRTEZyb21IYXNoKHdoZXJlVmFsdWUsIHdoZXJlS2V5LCBpbmRleClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGluZGV4ID4gMCkgc3FsICs9IFwiIEFORCBcIlxuXG4gICAgICAgIGlmICh0YWJsZU5hbWUpIHtcbiAgICAgICAgICBzcWwgKz0gYCR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZSh0YWJsZU5hbWUpfS5gXG4gICAgICAgIH1cblxuICAgICAgICBzcWwgKz0gYCR7b3B0aW9ucy5xdW90ZUNvbHVtbk5hbWUod2hlcmVLZXkpfWBcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh3aGVyZVZhbHVlKSkge1xuICAgICAgICAgIHNxbCArPSBgIElOICgke3doZXJlVmFsdWUubWFwKCh2YWx1ZSkgPT4gb3B0aW9ucy5xdW90ZSh2YWx1ZSkpLmpvaW4oXCIsIFwiKX0pYFxuICAgICAgICB9IGVsc2UgaWYgKHdoZXJlVmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgICBzcWwgKz0gXCIgSVMgTlVMTFwiXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3FsICs9IGAgPSAke29wdGlvbnMucXVvdGUod2hlcmVWYWx1ZSl9YFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGluZGV4KytcbiAgICB9XG5cbiAgICByZXR1cm4gc3FsXG4gIH1cbn1cbiJdfQ==
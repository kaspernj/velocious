// @ts-check
import WhereBase from "./where-base.js";
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
                sql += this._whereSQLFromHash(whereValue, whereKey, index);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtaGFzaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS93aGVyZS1oYXNoLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUV2Qzs7O0dBR0c7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUFnQyxTQUFRLFNBQVM7SUFDcEU7Ozs7T0FJRztJQUNILFlBQVksS0FBSyxFQUFFLElBQUk7UUFDckIsS0FBSyxFQUFFLENBQUE7UUFDUCxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUNoQixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSztRQUNILElBQUksR0FBRyxHQUFHLEdBQUcsQ0FBQTtRQUViLEdBQUcsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3hDLEdBQUcsSUFBSSxHQUFHLENBQUE7UUFFVixPQUFPLEdBQUcsQ0FBQTtJQUNaLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLEtBQUssR0FBRyxDQUFDO1FBQzFDLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUNqQyxJQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFWixLQUFLLE1BQU0sUUFBUSxJQUFJLElBQUksRUFBRSxDQUFDO1lBQzVCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUVqQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksVUFBVSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDekQsSUFBSSxLQUFLLEdBQUcsQ0FBQztvQkFBRSxHQUFHLElBQUksT0FBTyxDQUFBO2dCQUM3QixHQUFHLElBQUksS0FBSyxDQUFBO1lBQ2QsQ0FBQztpQkFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxVQUFVLEtBQUssSUFBSSxJQUFJLE9BQU8sVUFBVSxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUM5RixHQUFHLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLFVBQVUsRUFBRSxRQUFRLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFDNUQsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLElBQUksS0FBSyxHQUFHLENBQUM7b0JBQUUsR0FBRyxJQUFJLE9BQU8sQ0FBQTtnQkFFN0IsSUFBSSxTQUFTLEVBQUUsQ0FBQztvQkFDZCxHQUFHLElBQUksR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUE7Z0JBQ2hELENBQUM7Z0JBRUQsR0FBRyxJQUFJLEdBQUcsT0FBTyxDQUFDLGVBQWUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFBO2dCQUU3QyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztvQkFDOUIsR0FBRyxJQUFJLFFBQVEsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFBO2dCQUM5RSxDQUFDO3FCQUFNLElBQUksVUFBVSxLQUFLLElBQUksRUFBRSxDQUFDO29CQUMvQixHQUFHLElBQUksVUFBVSxDQUFBO2dCQUNuQixDQUFDO3FCQUFNLENBQUM7b0JBQ04sR0FBRyxJQUFJLE1BQU0sT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFBO2dCQUMxQyxDQUFDO1lBQ0gsQ0FBQztZQUVELEtBQUssRUFBRSxDQUFBO1FBQ1QsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFBO0lBQ1osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBXaGVyZUJhc2UgZnJvbSBcIi4vd2hlcmUtYmFzZS5qc1wiXG5cbi8qKlxuICogVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVdoZXJlSGFzaCBjbGFzcy5cbiAqIEB0eXBlZGVmIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGwgfCBBcnJheTxzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgbnVsbD4gfCBXaGVyZUhhc2h9fSBXaGVyZUhhc2hcbiAqL1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5V2hlcmVIYXNoIGV4dGVuZHMgV2hlcmVCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1doZXJlSGFzaH0gaGFzaCAtIEhhc2guXG4gICAqL1xuICBjb25zdHJ1Y3RvcihxdWVyeSwgaGFzaCkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmhhc2ggPSBoYXNoXG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHRvU3FsKCkge1xuICAgIGxldCBzcWwgPSBcIihcIlxuXG4gICAgc3FsICs9IHRoaXMuX3doZXJlU1FMRnJvbUhhc2godGhpcy5oYXNoKVxuICAgIHNxbCArPSBcIilcIlxuXG4gICAgcmV0dXJuIHNxbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUgc3FsZnJvbSBoYXNoLlxuICAgKiBAcGFyYW0ge1doZXJlSGFzaH0gaGFzaCAtIEhhc2guXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdGFibGVOYW1lXSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIEluZGV4IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBfd2hlcmVTUUxGcm9tSGFzaChoYXNoLCB0YWJsZU5hbWUsIGluZGV4ID0gMCkge1xuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLmdldE9wdGlvbnMoKVxuICAgIGxldCBzcWwgPSBcIlwiXG5cbiAgICBmb3IgKGNvbnN0IHdoZXJlS2V5IGluIGhhc2gpIHtcbiAgICAgIGNvbnN0IHdoZXJlVmFsdWUgPSBoYXNoW3doZXJlS2V5XVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh3aGVyZVZhbHVlKSAmJiB3aGVyZVZhbHVlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoaW5kZXggPiAwKSBzcWwgKz0gXCIgQU5EIFwiXG4gICAgICAgIHNxbCArPSBcIjE9MFwiXG4gICAgICB9IGVsc2UgaWYgKCFBcnJheS5pc0FycmF5KHdoZXJlVmFsdWUpICYmIHdoZXJlVmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHdoZXJlVmFsdWUgPT0gXCJvYmplY3RcIikge1xuICAgICAgICBzcWwgKz0gdGhpcy5fd2hlcmVTUUxGcm9tSGFzaCh3aGVyZVZhbHVlLCB3aGVyZUtleSwgaW5kZXgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoaW5kZXggPiAwKSBzcWwgKz0gXCIgQU5EIFwiXG5cbiAgICAgICAgaWYgKHRhYmxlTmFtZSkge1xuICAgICAgICAgIHNxbCArPSBgJHtvcHRpb25zLnF1b3RlVGFibGVOYW1lKHRhYmxlTmFtZSl9LmBcbiAgICAgICAgfVxuXG4gICAgICAgIHNxbCArPSBgJHtvcHRpb25zLnF1b3RlQ29sdW1uTmFtZSh3aGVyZUtleSl9YFxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHdoZXJlVmFsdWUpKSB7XG4gICAgICAgICAgc3FsICs9IGAgSU4gKCR7d2hlcmVWYWx1ZS5tYXAoKHZhbHVlKSA9PiBvcHRpb25zLnF1b3RlKHZhbHVlKSkuam9pbihcIiwgXCIpfSlgXG4gICAgICAgIH0gZWxzZSBpZiAod2hlcmVWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHNxbCArPSBcIiBJUyBOVUxMXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzcWwgKz0gYCA9ICR7b3B0aW9ucy5xdW90ZSh3aGVyZVZhbHVlKX1gXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaW5kZXgrK1xuICAgIH1cblxuICAgIHJldHVybiBzcWxcbiAgfVxufVxuIl19
// @ts-check
import { digg } from "diggerize";
export default class VelociousDatabaseDriversBaseColumnsIndex {
    /**
     * Runs constructor.
     * @param {import("./base-table.js").default} table - Table.
     * @param {object} data - Data payload.
     */
    constructor(table, data) {
        this.data = data;
        this.table = table;
    }
    /**
     * Runs get column names.
     * @abstract
     * @returns {string[]} - The column names.
     */
    getColumnNames() { throw new Error("'getColumnNames' not implemented"); }
    /**
     * Runs get driver.
     * @returns {import("./base.js").default} - The driver.
     */
    getDriver() {
        return this.getTable().getDriver();
    }
    /**
     * Runs get name.
     * @returns {string} - The name.
     */
    getName() {
        return digg(this, "data", "index_name");
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this.getDriver().options();
    }
    /**
     * Runs get table.
     * @returns {import("./base-table.js").default} - The table.
     */
    getTable() {
        if (!this.table)
            throw new Error("No table set on column");
        return this.table;
    }
    /**
     * Runs get table data index.
     * @abstract
     * @returns {import("../table-data/table-index.js").default} - The table data index.
     */
    getTableDataIndex() {
        throw new Error("'getTableDataIndex' not implemented");
    }
    /**
     * Runs is primary key.
     * @returns {boolean} - Whether primary key.
     */
    isPrimaryKey() {
        return digg(this, "data", "is_primary_key");
    }
    /**
     * Runs is unique.
     * @returns {boolean} - Whether unique.
     */
    isUnique() {
        return digg(this, "data", "is_unique");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1jb2x1bW5zLWluZGV4LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS1jb2x1bW5zLWluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBRTlCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0NBQXdDO0lBQzNEOzs7O09BSUc7SUFDSCxZQUFZLEtBQUssRUFBRSxJQUFJO1FBQ3JCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsY0FBYyxLQUFLLE1BQU0sSUFBSSxLQUFLLENBQUMsa0NBQWtDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFeEU7OztPQUdHO0lBQ0gsU0FBUztRQUNQLE9BQU8sSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLFNBQVMsRUFBRSxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxPQUFPO1FBQ0wsT0FBTyxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxZQUFZLENBQUMsQ0FBQTtJQUN6QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLE9BQU8sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ25DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRO1FBQ04sSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO1FBRTFELE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGlCQUFpQjtRQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQTtJQUN4RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsWUFBWTtRQUNWLE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsUUFBUTtRQUNOLE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUE7SUFDeEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2VDb2x1bW5zSW5kZXgge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdH0gdGFibGUgLSBUYWJsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih0YWJsZSwgZGF0YSkge1xuICAgIHRoaXMuZGF0YSA9IGRhdGFcbiAgICB0aGlzLnRhYmxlID0gdGFibGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW4gbmFtZXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIGNvbHVtbiBuYW1lcy5cbiAgICovXG4gIGdldENvbHVtbk5hbWVzKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCInZ2V0Q29sdW1uTmFtZXMnIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRyaXZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBkcml2ZXIuXG4gICAqL1xuICBnZXREcml2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VGFibGUoKS5nZXREcml2ZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG5hbWUuXG4gICAqL1xuICBnZXROYW1lKCkgIHtcbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFcIiwgXCJpbmRleF9uYW1lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RHJpdmVyKCkub3B0aW9ucygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdH0gLSBUaGUgdGFibGUuXG4gICAqL1xuICBnZXRUYWJsZSgpIHtcbiAgICBpZiAoIXRoaXMudGFibGUpIHRocm93IG5ldyBFcnJvcihcIk5vIHRhYmxlIHNldCBvbiBjb2x1bW5cIilcblxuICAgIHJldHVybiB0aGlzLnRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgZGF0YSBpbmRleC5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWluZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGhlIHRhYmxlIGRhdGEgaW5kZXguXG4gICAqL1xuICBnZXRUYWJsZURhdGFJbmRleCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInZ2V0VGFibGVEYXRhSW5kZXgnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBpc1ByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIGRpZ2codGhpcywgXCJkYXRhXCIsIFwiaXNfcHJpbWFyeV9rZXlcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHVuaXF1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB1bmlxdWUuXG4gICAqL1xuICBpc1VuaXF1ZSgpIHtcbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFcIiwgXCJpc191bmlxdWVcIilcbiAgfVxufVxuIl19
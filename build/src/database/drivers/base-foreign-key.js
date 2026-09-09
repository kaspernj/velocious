// @ts-check
import TableForeignKey from "../table-data/table-foreign-key.js";
export default class VelociousDatabaseDriversBaseForeignKey {
    /**
     * Table.
     * @type {import("./base-table.js").default | undefined} */
    table = undefined;
    /**
     * Runs constructor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Data payload.
     */
    constructor(data) {
        this.data = data;
    }
    /**
     * Runs get column name.
     * @abstract
     * @returns {string} - The column name.
     */
    getColumnName() {
        throw new Error(`'getColumnName' not implemented`);
    }
    /**
     * Runs get driver.
     * @returns {import("./base.js").default} - The driver.
     */
    getDriver() {
        return this.getTable().getDriver();
    }
    /**
     * Runs get name.
     * @abstract
     * @returns {string} - The name.
     */
    getName() {
        throw new Error(`'getName' not implemented`);
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this.getDriver().options();
    }
    /**
     * Runs get referenced column name.
     * @abstract
     * @returns {string} - The referenced column name.
     */
    getReferencedColumnName() {
        throw new Error(`'getReferencedColumnName' not implemented`);
    }
    /**
     * Runs get referenced table name.
     * @abstract
     * @returns {string} - The referenced table name.
     */
    getReferencedTableName() {
        throw new Error(`'getReferencedTableName' not implemented`);
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
     * Runs get table name.
     * @abstract
     * @returns {string} - The table name.
     */
    getTableName() {
        throw new Error("'getTableName' not implemented");
    }
    /**
     * Runs get table data foreign key.
     * @returns {TableForeignKey} - The table data foreign key.
     */
    getTableDataForeignKey() {
        return new TableForeignKey({
            columnName: this.getColumnName(),
            name: this.getName(),
            tableName: this.getTableName(),
            referencedColumnName: this.getReferencedColumnName(),
            referencedTableName: this.getReferencedTableName()
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1mb3JlaWduLWtleS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UtZm9yZWlnbi1rZXkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sZUFBZSxNQUFNLG9DQUFvQyxDQUFBO0FBRWhFLE1BQU0sQ0FBQyxPQUFPLE9BQU8sc0NBQXNDO0lBQ3pEOzsrREFFMkQ7SUFDM0QsS0FBSyxHQUFHLFNBQVMsQ0FBQTtJQUVqQjs7O09BR0c7SUFDSCxZQUFZLElBQUk7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWE7UUFDWCxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxDQUFDLENBQUE7SUFDcEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVM7UUFDUCxPQUFPLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxTQUFTLEVBQUUsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE9BQU87UUFDTCxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUE7SUFDOUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixPQUFPLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHVCQUF1QjtRQUNyQixNQUFNLElBQUksS0FBSyxDQUFDLDJDQUEyQyxDQUFDLENBQUE7SUFDOUQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxzQkFBc0I7UUFDcEIsTUFBTSxJQUFJLEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxDQUFBO0lBQzdELENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRO1FBQ04sSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO1FBRTFELE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFlBQVk7UUFDVixNQUFNLElBQUksS0FBSyxDQUFDLGdDQUFnQyxDQUFDLENBQUE7SUFDbkQsQ0FBQztJQUVEOzs7T0FHRztJQUNILHNCQUFzQjtRQUNwQixPQUFPLElBQUksZUFBZSxDQUFDO1lBQ3pCLFVBQVUsRUFBRSxJQUFJLENBQUMsYUFBYSxFQUFFO1lBQ2hDLElBQUksRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFO1lBQ3BCLFNBQVMsRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFFO1lBQzlCLG9CQUFvQixFQUFFLElBQUksQ0FBQyx1QkFBdUIsRUFBRTtZQUNwRCxtQkFBbUIsRUFBRSxJQUFJLENBQUMsc0JBQXNCLEVBQUU7U0FDbkQsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBUYWJsZUZvcmVpZ25LZXkgZnJvbSBcIi4uL3RhYmxlLWRhdGEvdGFibGUtZm9yZWlnbi1rZXkuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlRm9yZWlnbktleSB7XG4gIC8qKlxuICAgKiBUYWJsZS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICB0YWJsZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGRhdGEpIHtcbiAgICB0aGlzLmRhdGEgPSBkYXRhXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1uIG5hbWUuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBjb2x1bW4gbmFtZS5cbiAgICovXG4gIGdldENvbHVtbk5hbWUoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAnZ2V0Q29sdW1uTmFtZScgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkcml2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZHJpdmVyLlxuICAgKi9cbiAgZ2V0RHJpdmVyKCkge1xuICAgIHJldHVybiB0aGlzLmdldFRhYmxlKCkuZ2V0RHJpdmVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBuYW1lLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbmFtZS5cbiAgICovXG4gIGdldE5hbWUoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAnZ2V0TmFtZScgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXREcml2ZXIoKS5vcHRpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWZlcmVuY2VkIGNvbHVtbiBuYW1lLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcmVmZXJlbmNlZCBjb2x1bW4gbmFtZS5cbiAgICovXG4gIGdldFJlZmVyZW5jZWRDb2x1bW5OYW1lKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJ2dldFJlZmVyZW5jZWRDb2x1bW5OYW1lJyBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlZmVyZW5jZWQgdGFibGUgbmFtZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHJlZmVyZW5jZWQgdGFibGUgbmFtZS5cbiAgICovXG4gIGdldFJlZmVyZW5jZWRUYWJsZU5hbWUoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAnZ2V0UmVmZXJlbmNlZFRhYmxlTmFtZScgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSB0YWJsZS5cbiAgICovXG4gIGdldFRhYmxlKCkge1xuICAgIGlmICghdGhpcy50YWJsZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gdGFibGUgc2V0IG9uIGNvbHVtblwiKVxuXG4gICAgcmV0dXJuIHRoaXMudGFibGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSBuYW1lLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdGFibGUgbmFtZS5cbiAgICovXG4gIGdldFRhYmxlTmFtZSgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInZ2V0VGFibGVOYW1lJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSBkYXRhIGZvcmVpZ24ga2V5LlxuICAgKiBAcmV0dXJucyB7VGFibGVGb3JlaWduS2V5fSAtIFRoZSB0YWJsZSBkYXRhIGZvcmVpZ24ga2V5LlxuICAgKi9cbiAgZ2V0VGFibGVEYXRhRm9yZWlnbktleSgpIHtcbiAgICByZXR1cm4gbmV3IFRhYmxlRm9yZWlnbktleSh7XG4gICAgICBjb2x1bW5OYW1lOiB0aGlzLmdldENvbHVtbk5hbWUoKSxcbiAgICAgIG5hbWU6IHRoaXMuZ2V0TmFtZSgpLFxuICAgICAgdGFibGVOYW1lOiB0aGlzLmdldFRhYmxlTmFtZSgpLFxuICAgICAgcmVmZXJlbmNlZENvbHVtbk5hbWU6IHRoaXMuZ2V0UmVmZXJlbmNlZENvbHVtbk5hbWUoKSxcbiAgICAgIHJlZmVyZW5jZWRUYWJsZU5hbWU6IHRoaXMuZ2V0UmVmZXJlbmNlZFRhYmxlTmFtZSgpXG4gICAgfSlcbiAgfVxufVxuXG4iXX0=
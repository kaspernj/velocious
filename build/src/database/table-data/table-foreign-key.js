// @ts-check
import restArgsError from "../../utils/rest-args-error.js";
export default class TableForeignKey {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.columnName - Column name.
     * @param {boolean} [args.dropForeignKey] - Whether to drop this foreign key.
     * @param {boolean} [args.isNewForeignKey] - Whether is new foreign key.
     * @param {string} [args.name] - Name.
     * @param {string} args.tableName - Table name.
     * @param {string} args.referencedColumnName - Referenced column name.
     * @param {string} args.referencedTableName - Referenced table name.
     */
    constructor({ columnName, dropForeignKey, isNewForeignKey, name, tableName, referencedColumnName, referencedTableName, ...restArgs }) {
        restArgsError(restArgs);
        this._columnName = columnName;
        this._dropForeignKey = dropForeignKey;
        this._isNewForeignKey = isNewForeignKey;
        this._name = name;
        this._tableName = tableName;
        this._referencedColumnName = referencedColumnName;
        this._referencedTableName = referencedTableName;
    }
    /**
     * Runs get column name.
     * @returns {string} - The column name.
     */
    getColumnName() { return this._columnName; }
    /**
     * Runs get drop foreign key.
     * @returns {boolean} - Whether this foreign key should be dropped.
     */
    getDropForeignKey() { return this._dropForeignKey || false; }
    /**
     * Runs get is new foreign key.
     * @returns {boolean} - Whether is new foreign key.
     */
    getIsNewForeignKey() { return this._isNewForeignKey || false; }
    /**
     * Runs get table name.
     * @returns {string} - The table name.
     */
    getTableName() { return this._tableName; }
    /**
     * Runs get referenced column name.
     * @returns {string} - The referenced column name.
     */
    getReferencedColumnName() { return this._referencedColumnName; }
    /**
     * Runs get referenced table name.
     * @returns {string} - The referenced table name.
     */
    getReferencedTableName() { return this._referencedTableName; }
    /**
     * Runs get name.
     * @returns {string} - The name.
     */
    getName() { return this._name || ""; }
    /**
     * Runs set name.
     * @param {string} newName - New name.
     * @returns {void} - No return value.
     */
    setName(newName) { this._name = newName; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFibGUtZm9yZWlnbi1rZXkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvdGFibGUtZGF0YS90YWJsZS1mb3JlaWduLWtleS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0sZ0NBQWdDLENBQUE7QUFFMUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxlQUFlO0lBQ2xDOzs7Ozs7Ozs7O09BVUc7SUFDSCxZQUFZLEVBQUMsVUFBVSxFQUFFLGNBQWMsRUFBRSxlQUFlLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxvQkFBb0IsRUFBRSxtQkFBbUIsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUNoSSxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLFdBQVcsR0FBRyxVQUFVLENBQUE7UUFDN0IsSUFBSSxDQUFDLGVBQWUsR0FBRyxjQUFjLENBQUE7UUFDckMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGVBQWUsQ0FBQTtRQUN2QyxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQTtRQUNqQixJQUFJLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtRQUMzQixJQUFJLENBQUMscUJBQXFCLEdBQUcsb0JBQW9CLENBQUE7UUFDakQsSUFBSSxDQUFDLG9CQUFvQixHQUFHLG1CQUFtQixDQUFBO0lBQ2pELENBQUM7SUFFRDs7O09BR0c7SUFDSCxhQUFhLEtBQUssT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFBLENBQUMsQ0FBQztJQUUzQzs7O09BR0c7SUFDSCxpQkFBaUIsS0FBSyxPQUFPLElBQUksQ0FBQyxlQUFlLElBQUksS0FBSyxDQUFBLENBQUMsQ0FBQztJQUU1RDs7O09BR0c7SUFDSCxrQkFBa0IsS0FBSyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsSUFBSSxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRTlEOzs7T0FHRztJQUNILFlBQVksS0FBSyxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUEsQ0FBQyxDQUFDO0lBRXpDOzs7T0FHRztJQUNILHVCQUF1QixLQUFLLE9BQU8sSUFBSSxDQUFDLHFCQUFxQixDQUFBLENBQUMsQ0FBQztJQUUvRDs7O09BR0c7SUFDSCxzQkFBc0IsS0FBSyxPQUFPLElBQUksQ0FBQyxvQkFBb0IsQ0FBQSxDQUFDLENBQUM7SUFFN0Q7OztPQUdHO0lBQ0gsT0FBTyxLQUFLLE9BQU8sSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRXJDOzs7O09BSUc7SUFDSCxPQUFPLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxLQUFLLEdBQUcsT0FBTyxDQUFBLENBQUMsQ0FBQztDQUMxQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGFibGVGb3JlaWduS2V5IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5kcm9wRm9yZWlnbktleV0gLSBXaGV0aGVyIHRvIGRyb3AgdGhpcyBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pc05ld0ZvcmVpZ25LZXldIC0gV2hldGhlciBpcyBuZXcgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5uYW1lXSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlZmVyZW5jZWRDb2x1bW5OYW1lIC0gUmVmZXJlbmNlZCBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVmZXJlbmNlZFRhYmxlTmFtZSAtIFJlZmVyZW5jZWQgdGFibGUgbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb2x1bW5OYW1lLCBkcm9wRm9yZWlnbktleSwgaXNOZXdGb3JlaWduS2V5LCBuYW1lLCB0YWJsZU5hbWUsIHJlZmVyZW5jZWRDb2x1bW5OYW1lLCByZWZlcmVuY2VkVGFibGVOYW1lLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5fY29sdW1uTmFtZSA9IGNvbHVtbk5hbWVcbiAgICB0aGlzLl9kcm9wRm9yZWlnbktleSA9IGRyb3BGb3JlaWduS2V5XG4gICAgdGhpcy5faXNOZXdGb3JlaWduS2V5ID0gaXNOZXdGb3JlaWduS2V5XG4gICAgdGhpcy5fbmFtZSA9IG5hbWVcbiAgICB0aGlzLl90YWJsZU5hbWUgPSB0YWJsZU5hbWVcbiAgICB0aGlzLl9yZWZlcmVuY2VkQ29sdW1uTmFtZSA9IHJlZmVyZW5jZWRDb2x1bW5OYW1lXG4gICAgdGhpcy5fcmVmZXJlbmNlZFRhYmxlTmFtZSA9IHJlZmVyZW5jZWRUYWJsZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgY29sdW1uIG5hbWUuXG4gICAqL1xuICBnZXRDb2x1bW5OYW1lKCkgeyByZXR1cm4gdGhpcy5fY29sdW1uTmFtZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRyb3AgZm9yZWlnbiBrZXkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBmb3JlaWduIGtleSBzaG91bGQgYmUgZHJvcHBlZC5cbiAgICovXG4gIGdldERyb3BGb3JlaWduS2V5KCkgeyByZXR1cm4gdGhpcy5fZHJvcEZvcmVpZ25LZXkgfHwgZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBpcyBuZXcgZm9yZWlnbiBrZXkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaXMgbmV3IGZvcmVpZ24ga2V5LlxuICAgKi9cbiAgZ2V0SXNOZXdGb3JlaWduS2V5KCkgeyByZXR1cm4gdGhpcy5faXNOZXdGb3JlaWduS2V5IHx8IGZhbHNlIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdGFibGUgbmFtZS5cbiAgICovXG4gIGdldFRhYmxlTmFtZSgpIHsgcmV0dXJuIHRoaXMuX3RhYmxlTmFtZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlZmVyZW5jZWQgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHJlZmVyZW5jZWQgY29sdW1uIG5hbWUuXG4gICAqL1xuICBnZXRSZWZlcmVuY2VkQ29sdW1uTmFtZSgpIHsgcmV0dXJuIHRoaXMuX3JlZmVyZW5jZWRDb2x1bW5OYW1lIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVmZXJlbmNlZCB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSByZWZlcmVuY2VkIHRhYmxlIG5hbWUuXG4gICAqL1xuICBnZXRSZWZlcmVuY2VkVGFibGVOYW1lKCkgeyByZXR1cm4gdGhpcy5fcmVmZXJlbmNlZFRhYmxlTmFtZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG5hbWUuXG4gICAqL1xuICBnZXROYW1lKCkgeyByZXR1cm4gdGhpcy5fbmFtZSB8fCBcIlwiIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld05hbWUgLSBOZXcgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TmFtZShuZXdOYW1lKSB7IHRoaXMuX25hbWUgPSBuZXdOYW1lIH1cbn1cbiJdfQ==
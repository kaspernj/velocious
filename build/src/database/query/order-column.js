// @ts-check
import OrderBase from "./order-base.js";
/**
 * OrderColumnInput type.
 * @typedef {object} OrderColumnInput
 * @property {string} column - Column name.
 * @property {"ASC" | "DESC" | "asc" | "desc"} [direction] - Sort direction.
 * @property {string} [tableName] - Optional table or alias name.
 */
/**
 * Runs normalize direction.
 * @param {string | undefined} direction - Direction input.
 * @returns {"ASC" | "DESC"} - Normalized direction.
 */
function normalizeDirection(direction) {
    if (typeof direction == "undefined")
        return "ASC";
    const normalized = direction.toUpperCase();
    if (normalized == "ASC" || normalized == "DESC")
        return normalized;
    throw new Error(`Invalid order direction: ${direction}`);
}
/**
 * Runs reverse direction.
 * @param {"ASC" | "DESC"} direction - Direction.
 * @returns {"ASC" | "DESC"} - Reversed direction.
 */
function reverseDirection(direction) {
    return direction == "ASC" ? "DESC" : "ASC";
}
export default class VelociousDatabaseQueryOrderColumn extends OrderBase {
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {OrderColumnInput} input - Column order input.
     */
    constructor(query, input) {
        super(query);
        if (!input.column)
            throw new Error("Order column is required");
        this.column = input.column;
        this.direction = normalizeDirection(input.direction);
        this.reverseOrder = false;
        this.tableName = input.tableName;
    }
    /**
     * Runs set reverse order.
     * @param {boolean} [reverseOrder] - Whether to reverse the order.
     * @returns {void}
     */
    setReverseOrder(reverseOrder = true) {
        this.reverseOrder = reverseOrder;
    }
    /**
     * Runs reversed copy.
     * @returns {VelociousDatabaseQueryOrderColumn} - A new independent order reversing the effective (rendered) direction.
     */
    reversedCopy() {
        const direction = this.reverseOrder ? this.direction : reverseDirection(this.direction);
        return new VelociousDatabaseQueryOrderColumn(this.query, { column: this.column, direction, tableName: this.tableName });
    }
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql() {
        const options = this.getOptions();
        const direction = this.reverseOrder ? reverseDirection(this.direction) : this.direction;
        let sql = "";
        if (this.tableName)
            sql += `${options.quoteTableName(this.tableName)}.`;
        sql += `${options.quoteColumnName(this.column)} ${direction}`;
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItY29sdW1uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L29yZGVyLWNvbHVtbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0saUJBQWlCLENBQUE7QUFFdkM7Ozs7OztHQU1HO0FBRUg7Ozs7R0FJRztBQUNILFNBQVMsa0JBQWtCLENBQUMsU0FBUztJQUNuQyxJQUFJLE9BQU8sU0FBUyxJQUFJLFdBQVc7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUVqRCxNQUFNLFVBQVUsR0FBRyxTQUFTLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDMUMsSUFBSSxVQUFVLElBQUksS0FBSyxJQUFJLFVBQVUsSUFBSSxNQUFNO1FBQUUsT0FBTyxVQUFVLENBQUE7SUFFbEUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsU0FBUyxFQUFFLENBQUMsQ0FBQTtBQUMxRCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZ0JBQWdCLENBQUMsU0FBUztJQUNqQyxPQUFPLFNBQVMsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFBO0FBQzVDLENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLGlDQUFrQyxTQUFRLFNBQVM7SUFDdEU7Ozs7T0FJRztJQUNILFlBQVksS0FBSyxFQUFFLEtBQUs7UUFDdEIsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRVosSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxDQUFBO1FBRTlELElBQUksQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQTtRQUMxQixJQUFJLENBQUMsU0FBUyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUNwRCxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQTtRQUN6QixJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsWUFBWSxHQUFHLElBQUk7UUFDakMsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFlBQVk7UUFDVixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFdkYsT0FBTyxJQUFJLGlDQUFpQyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsRUFBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO0lBQ3ZILENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLO1FBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ2pDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQTtRQUN2RixJQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFWixJQUFJLElBQUksQ0FBQyxTQUFTO1lBQUUsR0FBRyxJQUFJLEdBQUcsT0FBTyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQTtRQUV2RSxHQUFHLElBQUksR0FBRyxPQUFPLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxTQUFTLEVBQUUsQ0FBQTtRQUU3RCxPQUFPLEdBQUcsQ0FBQTtJQUNaLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgT3JkZXJCYXNlIGZyb20gXCIuL29yZGVyLWJhc2UuanNcIlxuXG4vKipcbiAqIE9yZGVyQ29sdW1uSW5wdXQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IE9yZGVyQ29sdW1uSW5wdXRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gbmFtZS5cbiAqIEBwcm9wZXJ0eSB7XCJBU0NcIiB8IFwiREVTQ1wiIHwgXCJhc2NcIiB8IFwiZGVzY1wifSBbZGlyZWN0aW9uXSAtIFNvcnQgZGlyZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0YWJsZU5hbWVdIC0gT3B0aW9uYWwgdGFibGUgb3IgYWxpYXMgbmFtZS5cbiAqL1xuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGRpcmVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBkaXJlY3Rpb24gLSBEaXJlY3Rpb24gaW5wdXQuXG4gKiBAcmV0dXJucyB7XCJBU0NcIiB8IFwiREVTQ1wifSAtIE5vcm1hbGl6ZWQgZGlyZWN0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVEaXJlY3Rpb24oZGlyZWN0aW9uKSB7XG4gIGlmICh0eXBlb2YgZGlyZWN0aW9uID09IFwidW5kZWZpbmVkXCIpIHJldHVybiBcIkFTQ1wiXG5cbiAgY29uc3Qgbm9ybWFsaXplZCA9IGRpcmVjdGlvbi50b1VwcGVyQ2FzZSgpXG4gIGlmIChub3JtYWxpemVkID09IFwiQVNDXCIgfHwgbm9ybWFsaXplZCA9PSBcIkRFU0NcIikgcmV0dXJuIG5vcm1hbGl6ZWRcblxuICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb3JkZXIgZGlyZWN0aW9uOiAke2RpcmVjdGlvbn1gKVxufVxuXG4vKipcbiAqIFJ1bnMgcmV2ZXJzZSBkaXJlY3Rpb24uXG4gKiBAcGFyYW0ge1wiQVNDXCIgfCBcIkRFU0NcIn0gZGlyZWN0aW9uIC0gRGlyZWN0aW9uLlxuICogQHJldHVybnMge1wiQVNDXCIgfCBcIkRFU0NcIn0gLSBSZXZlcnNlZCBkaXJlY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIHJldmVyc2VEaXJlY3Rpb24oZGlyZWN0aW9uKSB7XG4gIHJldHVybiBkaXJlY3Rpb24gPT0gXCJBU0NcIiA/IFwiREVTQ1wiIDogXCJBU0NcIlxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5T3JkZXJDb2x1bW4gZXh0ZW5kcyBPcmRlckJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7T3JkZXJDb2x1bW5JbnB1dH0gaW5wdXQgLSBDb2x1bW4gb3JkZXIgaW5wdXQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihxdWVyeSwgaW5wdXQpIHtcbiAgICBzdXBlcihxdWVyeSlcblxuICAgIGlmICghaW5wdXQuY29sdW1uKSB0aHJvdyBuZXcgRXJyb3IoXCJPcmRlciBjb2x1bW4gaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuY29sdW1uID0gaW5wdXQuY29sdW1uXG4gICAgdGhpcy5kaXJlY3Rpb24gPSBub3JtYWxpemVEaXJlY3Rpb24oaW5wdXQuZGlyZWN0aW9uKVxuICAgIHRoaXMucmV2ZXJzZU9yZGVyID0gZmFsc2VcbiAgICB0aGlzLnRhYmxlTmFtZSA9IGlucHV0LnRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHJldmVyc2Ugb3JkZXIuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3JldmVyc2VPcmRlcl0gLSBXaGV0aGVyIHRvIHJldmVyc2UgdGhlIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFJldmVyc2VPcmRlcihyZXZlcnNlT3JkZXIgPSB0cnVlKSB7XG4gICAgdGhpcy5yZXZlcnNlT3JkZXIgPSByZXZlcnNlT3JkZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldmVyc2VkIGNvcHkuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5T3JkZXJDb2x1bW59IC0gQSBuZXcgaW5kZXBlbmRlbnQgb3JkZXIgcmV2ZXJzaW5nIHRoZSBlZmZlY3RpdmUgKHJlbmRlcmVkKSBkaXJlY3Rpb24uXG4gICAqL1xuICByZXZlcnNlZENvcHkoKSB7XG4gICAgY29uc3QgZGlyZWN0aW9uID0gdGhpcy5yZXZlcnNlT3JkZXIgPyB0aGlzLmRpcmVjdGlvbiA6IHJldmVyc2VEaXJlY3Rpb24odGhpcy5kaXJlY3Rpb24pXG5cbiAgICByZXR1cm4gbmV3IFZlbG9jaW91c0RhdGFiYXNlUXVlcnlPcmRlckNvbHVtbih0aGlzLnF1ZXJ5LCB7Y29sdW1uOiB0aGlzLmNvbHVtbiwgZGlyZWN0aW9uLCB0YWJsZU5hbWU6IHRoaXMudGFibGVOYW1lfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIHNxbC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdG9TcWwoKSB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuZ2V0T3B0aW9ucygpXG4gICAgY29uc3QgZGlyZWN0aW9uID0gdGhpcy5yZXZlcnNlT3JkZXIgPyByZXZlcnNlRGlyZWN0aW9uKHRoaXMuZGlyZWN0aW9uKSA6IHRoaXMuZGlyZWN0aW9uXG4gICAgbGV0IHNxbCA9IFwiXCJcblxuICAgIGlmICh0aGlzLnRhYmxlTmFtZSkgc3FsICs9IGAke29wdGlvbnMucXVvdGVUYWJsZU5hbWUodGhpcy50YWJsZU5hbWUpfS5gXG5cbiAgICBzcWwgKz0gYCR7b3B0aW9ucy5xdW90ZUNvbHVtbk5hbWUodGhpcy5jb2x1bW4pfSAke2RpcmVjdGlvbn1gXG5cbiAgICByZXR1cm4gc3FsXG4gIH1cbn1cbiJdfQ==
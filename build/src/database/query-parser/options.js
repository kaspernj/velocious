// @ts-check
/**
 * OptionsObjectArgsType type.
 * @typedef {object} OptionsObjectArgsType
 * @property {string} columnQuote - Quote character for column names.
 * @property {string} indexQuote - Quote character for index names.
 * @property {import("../drivers/base.js").default} driver - Database driver instance.
 * @property {string} tableQuote - Quote character for table names.
 * @property {string} stringQuote - Quote character for string literals.
 */
export default class VelociousDatabaseQueryParserOptions {
    /**
     * Runs constructor.
     * @param {OptionsObjectArgsType} options - Options object.
     */
    constructor(options) {
        this.columnQuote = options.columnQuote;
        this.indexQuote = options.indexQuote;
        this.driver = options.driver;
        this.tableQuote = options.tableQuote;
        this.stringQuote = options.stringQuote;
        if (!this.driver)
            throw new Error("No driver given to parser options");
    }
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {number | string} - The quote.
     */
    quote(value) {
        if (typeof value == "number")
            return value;
        return this.quoteString(value);
    }
    /**
     * Runs quote database name.
     * @param {string} databaseName - Database name.
     * @returns {string} - The quote database name.
     */
    quoteDatabaseName(databaseName) {
        if (databaseName.includes(this.tableQuote))
            throw new Error(`Possible SQL injection in database name: ${databaseName}`);
        return `${this.tableQuote}${databaseName}${this.tableQuote}`;
    }
    /**
     * Runs quote column name.
     * @param {string} columnName - Column name.
     * @returns {string} - The quote column name.
     */
    quoteColumnName(columnName) {
        if (!columnName)
            throw new Error("No column name was given");
        if (columnName.includes(this.columnQuote))
            throw new Error(`Invalid column name: ${columnName}`);
        return `${this.columnQuote}${columnName}${this.columnQuote}`;
    }
    /**
     * Runs quote index name.
     * @param {string} indexName - Index name.
     * @returns {string} - The quote index name.
     */
    quoteIndexName(indexName) {
        if (!indexName || indexName.includes(this.columnQuote))
            throw new Error(`Invalid column name: ${indexName}`);
        return `${this.columnQuote}${indexName}${this.columnQuote}`;
    }
    /**
     * Runs quote string.
     * @abstract
     * @param {ReturnType<typeof JSON.parse>} string - String.
     * @returns {string} - The quote string.
     */
    quoteString(string) {
        throw new Error("quoteString not implemented");
    }
    /**
     * Runs quote table name.
     * @param {string} tableName - Table name.
     * @returns {string} - The quote table name.
     */
    quoteTableName(tableName) {
        if (!tableName || tableName.includes(this.tableQuote))
            throw new Error(`Invalid table name: ${tableName}`);
        return `${this.tableQuote}${tableName}${this.tableQuote}`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3B0aW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS1wYXJzZXIvb3B0aW9ucy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7Ozs7O0dBUUc7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLG1DQUFtQztJQUN0RDs7O09BR0c7SUFDSCxZQUFZLE9BQU87UUFDakIsSUFBSSxDQUFDLFdBQVcsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFBO1FBQ3RDLElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQTtRQUNwQyxJQUFJLENBQUMsTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUE7UUFDNUIsSUFBSSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFBO1FBQ3BDLElBQUksQ0FBQyxXQUFXLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQTtRQUV0QyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1DQUFtQyxDQUFDLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsS0FBSztRQUNULElBQUksT0FBTyxLQUFLLElBQUksUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTFDLE9BQU8sSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGlCQUFpQixDQUFDLFlBQVk7UUFDNUIsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxZQUFZLEVBQUUsQ0FBQyxDQUFBO1FBRXZILE9BQU8sR0FBRyxJQUFJLENBQUMsVUFBVSxHQUFHLFlBQVksR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDOUQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsVUFBVTtRQUN4QixJQUFJLENBQUMsVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMEJBQTBCLENBQUMsQ0FBQTtRQUM1RCxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFFaEcsT0FBTyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxHQUFHLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtJQUM5RCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWMsQ0FBQyxTQUFTO1FBQ3RCLElBQUksQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsU0FBUyxFQUFFLENBQUMsQ0FBQTtRQUU1RyxPQUFPLEdBQUcsSUFBSSxDQUFDLFdBQVcsR0FBRyxTQUFTLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBQzdELENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFdBQVcsQ0FBQyxNQUFNO1FBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQTtJQUNoRCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWMsQ0FBQyxTQUFTO1FBQ3RCLElBQUksQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1QkFBdUIsU0FBUyxFQUFFLENBQUMsQ0FBQTtRQUUxRyxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO0lBQzNELENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIE9wdGlvbnNPYmplY3RBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gT3B0aW9uc09iamVjdEFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uUXVvdGUgLSBRdW90ZSBjaGFyYWN0ZXIgZm9yIGNvbHVtbiBuYW1lcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpbmRleFF1b3RlIC0gUXVvdGUgY2hhcmFjdGVyIGZvciBpbmRleCBuYW1lcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZVF1b3RlIC0gUXVvdGUgY2hhcmFjdGVyIGZvciB0YWJsZSBuYW1lcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdHJpbmdRdW90ZSAtIFF1b3RlIGNoYXJhY3RlciBmb3Igc3RyaW5nIGxpdGVyYWxzLlxuICovXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlQYXJzZXJPcHRpb25zIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7T3B0aW9uc09iamVjdEFyZ3NUeXBlfSBvcHRpb25zIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgdGhpcy5jb2x1bW5RdW90ZSA9IG9wdGlvbnMuY29sdW1uUXVvdGVcbiAgICB0aGlzLmluZGV4UXVvdGUgPSBvcHRpb25zLmluZGV4UXVvdGVcbiAgICB0aGlzLmRyaXZlciA9IG9wdGlvbnMuZHJpdmVyXG4gICAgdGhpcy50YWJsZVF1b3RlID0gb3B0aW9ucy50YWJsZVF1b3RlXG4gICAgdGhpcy5zdHJpbmdRdW90ZSA9IG9wdGlvbnMuc3RyaW5nUXVvdGVcblxuICAgIGlmICghdGhpcy5kcml2ZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGRyaXZlciBnaXZlbiB0byBwYXJzZXIgb3B0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgc3RyaW5nfSAtIFRoZSBxdW90ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIHJldHVybiB0aGlzLnF1b3RlU3RyaW5nKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgZGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIGRhdGFiYXNlIG5hbWUuXG4gICAqL1xuICBxdW90ZURhdGFiYXNlTmFtZShkYXRhYmFzZU5hbWUpIHtcbiAgICBpZiAoZGF0YWJhc2VOYW1lLmluY2x1ZGVzKHRoaXMudGFibGVRdW90ZSkpIHRocm93IG5ldyBFcnJvcihgUG9zc2libGUgU1FMIGluamVjdGlvbiBpbiBkYXRhYmFzZSBuYW1lOiAke2RhdGFiYXNlTmFtZX1gKVxuXG4gICAgcmV0dXJuIGAke3RoaXMudGFibGVRdW90ZX0ke2RhdGFiYXNlTmFtZX0ke3RoaXMudGFibGVRdW90ZX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgY29sdW1uIG5hbWUuXG4gICAqL1xuICBxdW90ZUNvbHVtbk5hbWUoY29sdW1uTmFtZSkge1xuICAgIGlmICghY29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1uIG5hbWUgd2FzIGdpdmVuXCIpXG4gICAgaWYgKGNvbHVtbk5hbWUuaW5jbHVkZXModGhpcy5jb2x1bW5RdW90ZSkpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjb2x1bW4gbmFtZTogJHtjb2x1bW5OYW1lfWApXG5cbiAgICByZXR1cm4gYCR7dGhpcy5jb2x1bW5RdW90ZX0ke2NvbHVtbk5hbWV9JHt0aGlzLmNvbHVtblF1b3RlfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIGluZGV4IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpbmRleE5hbWUgLSBJbmRleCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSBpbmRleCBuYW1lLlxuICAgKi9cbiAgcXVvdGVJbmRleE5hbWUoaW5kZXhOYW1lKSB7XG4gICAgaWYgKCFpbmRleE5hbWUgfHwgaW5kZXhOYW1lLmluY2x1ZGVzKHRoaXMuY29sdW1uUXVvdGUpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29sdW1uIG5hbWU6ICR7aW5kZXhOYW1lfWApXG5cbiAgICByZXR1cm4gYCR7dGhpcy5jb2x1bW5RdW90ZX0ke2luZGV4TmFtZX0ke3RoaXMuY29sdW1uUXVvdGV9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgc3RyaW5nLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3RyaW5nIC0gU3RyaW5nLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSBzdHJpbmcuXG4gICAqL1xuICBxdW90ZVN0cmluZyhzdHJpbmcpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcInF1b3RlU3RyaW5nIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgdGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBxdW90ZVRhYmxlTmFtZSh0YWJsZU5hbWUpIHtcbiAgICBpZiAoIXRhYmxlTmFtZSB8fCB0YWJsZU5hbWUuaW5jbHVkZXModGhpcy50YWJsZVF1b3RlKSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHRhYmxlIG5hbWU6ICR7dGFibGVOYW1lfWApXG5cbiAgICByZXR1cm4gYCR7dGhpcy50YWJsZVF1b3RlfSR7dGFibGVOYW1lfSR7dGhpcy50YWJsZVF1b3RlfWBcbiAgfVxufVxuXG4iXX0=
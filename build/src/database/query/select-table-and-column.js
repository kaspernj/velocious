// @ts-check
import SelectBase from "./select-base.js";
export default class VelociousDatabaseQuerySelectTableAndColumn extends SelectBase {
    /**
     * Runs constructor.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     */
    constructor(tableName, columnName) {
        super();
        this.columnName = columnName;
        this.tableName = tableName;
    }
    getColumnName() {
        return this.columnName;
    }
    getTableName() {
        return this.tableName;
    }
    toSql() {
        return `${this.getOptions().quoteTableName(this.tableName)}.${this.getOptions().quoteColumnName(this.columnName)}`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0LXRhYmxlLWFuZC1jb2x1bW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvc2VsZWN0LXRhYmxlLWFuZC1jb2x1bW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBRXpDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sMENBQTJDLFNBQVEsVUFBVTtJQUNoRjs7OztPQUlHO0lBQ0gsWUFBWSxTQUFTLEVBQUUsVUFBVTtRQUMvQixLQUFLLEVBQUUsQ0FBQTtRQUNQLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO0lBQzVCLENBQUM7SUFFRCxhQUFhO1FBQ1gsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFBO0lBQ3hCLENBQUM7SUFFRCxZQUFZO1FBQ1YsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFBO0lBQ3ZCLENBQUM7SUFFRCxLQUFLO1FBQ0gsT0FBTyxHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUE7SUFDcEgsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBTZWxlY3RCYXNlIGZyb20gXCIuL3NlbGVjdC1iYXNlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVNlbGVjdFRhYmxlQW5kQ29sdW1uIGV4dGVuZHMgU2VsZWN0QmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHRhYmxlTmFtZSwgY29sdW1uTmFtZSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmNvbHVtbk5hbWUgPSBjb2x1bW5OYW1lXG4gICAgdGhpcy50YWJsZU5hbWUgPSB0YWJsZU5hbWVcbiAgfVxuXG4gIGdldENvbHVtbk5hbWUoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29sdW1uTmFtZVxuICB9XG5cbiAgZ2V0VGFibGVOYW1lKCkge1xuICAgIHJldHVybiB0aGlzLnRhYmxlTmFtZVxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuZ2V0T3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHRoaXMudGFibGVOYW1lKX0uJHt0aGlzLmdldE9wdGlvbnMoKS5xdW90ZUNvbHVtbk5hbWUodGhpcy5jb2x1bW5OYW1lKX1gXG4gIH1cbn1cbiJdfQ==
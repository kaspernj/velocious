// @ts-check
import FromBase from "./from-base.js";
export default class VelociousDatabaseQueryFromTable extends FromBase {
    /**
     * Runs constructor.
     * @param {string} tableName - Table name.
     */
    constructor(tableName) {
        super();
        this.tableName = tableName;
    }
    toSql() {
        return [this.getOptions().quoteTableName(this.tableName)];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbS10YWJsZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9mcm9tLXRhYmxlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFFBQVEsTUFBTSxnQkFBZ0IsQ0FBQTtBQUVyQyxNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUFnQyxTQUFRLFFBQVE7SUFDbkU7OztPQUdHO0lBQ0gsWUFBWSxTQUFTO1FBQ25CLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDNUIsQ0FBQztJQUVELEtBQUs7UUFDSCxPQUFPLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtJQUMzRCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEZyb21CYXNlIGZyb20gXCIuL2Zyb20tYmFzZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlGcm9tVGFibGUgZXh0ZW5kcyBGcm9tQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHRhYmxlTmFtZSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLnRhYmxlTmFtZSA9IHRhYmxlTmFtZVxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgcmV0dXJuIFt0aGlzLmdldE9wdGlvbnMoKS5xdW90ZVRhYmxlTmFtZSh0aGlzLnRhYmxlTmFtZSldXG4gIH1cbn1cbiJdfQ==
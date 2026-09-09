// @ts-check
import JoinBase from "./join-base.js";
export default class VelociousDatabaseQueryJoinPlain extends JoinBase {
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain) {
        super();
        this.plain = plain;
    }
    toSql() {
        return this.plain;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9pbi1wbGFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9qb2luLXBsYWluLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFFBQVEsTUFBTSxnQkFBZ0IsQ0FBQTtBQUVyQyxNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUFnQyxTQUFRLFFBQVE7SUFDbkU7OztPQUdHO0lBQ0gsWUFBWSxLQUFLO1FBQ2YsS0FBSyxFQUFFLENBQUE7UUFDUCxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0lBRUQsS0FBSztRQUNILE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtJQUNuQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEpvaW5CYXNlIGZyb20gXCIuL2pvaW4tYmFzZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlKb2luUGxhaW4gZXh0ZW5kcyBKb2luQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGxhaW4gLSBQbGFpbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHBsYWluKSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMucGxhaW4gPSBwbGFpblxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgcmV0dXJuIHRoaXMucGxhaW5cbiAgfVxufVxuIl19
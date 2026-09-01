// @ts-check
import SelectBase from "./select-base.js";
export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0LXBsYWluLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L3NlbGVjdC1wbGFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFFekMsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQ0FBa0MsU0FBUSxVQUFVO0lBQ3ZFOzs7T0FHRztJQUNILFlBQVksS0FBSztRQUNmLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVELEtBQUs7UUFDSCxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUE7SUFDbkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBTZWxlY3RCYXNlIGZyb20gXCIuL3NlbGVjdC1iYXNlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVNlbGVjdFBsYWluIGV4dGVuZHMgU2VsZWN0QmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGxhaW4gLSBQbGFpbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHBsYWluKSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMucGxhaW4gPSBwbGFpblxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgcmV0dXJuIHRoaXMucGxhaW5cbiAgfVxufVxuIl19
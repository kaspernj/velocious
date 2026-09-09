// @ts-check
import FromBase from "./from-base.js";
export default class VelociousDatabaseQueryFromPlain extends FromBase {
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain) {
        super();
        this.plain = plain;
    }
    toSql() { return [this.plain]; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbS1wbGFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9mcm9tLXBsYWluLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFFBQVEsTUFBTSxnQkFBZ0IsQ0FBQTtBQUVyQyxNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUFnQyxTQUFRLFFBQVE7SUFDbkU7OztPQUdHO0lBQ0gsWUFBWSxLQUFLO1FBQ2YsS0FBSyxFQUFFLENBQUE7UUFDUCxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0lBRUQsS0FBSyxLQUFLLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUEsQ0FBQyxDQUFDO0NBQ2hDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBGcm9tQmFzZSBmcm9tIFwiLi9mcm9tLWJhc2UuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5RnJvbVBsYWluIGV4dGVuZHMgRnJvbUJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBsYWluIC0gUGxhaW4uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihwbGFpbikge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLnBsYWluID0gcGxhaW5cbiAgfVxuXG4gIHRvU3FsKCkgeyByZXR1cm4gW3RoaXMucGxhaW5dIH1cbn1cbiJdfQ==
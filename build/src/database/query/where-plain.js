// @ts-check
import WhereBase from "./where-base.js";
export default class VelociousDatabaseQueryWhereHash extends WhereBase {
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {string} plain - Plain.
     */
    constructor(query, plain) {
        super();
        this.plain = plain;
        this.query = query;
    }
    toSql() {
        return this.plain;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtcGxhaW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvd2hlcmUtcGxhaW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBRXZDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sK0JBQWdDLFNBQVEsU0FBUztJQUNwRTs7OztPQUlHO0lBQ0gsWUFBWSxLQUFLLEVBQUUsS0FBSztRQUN0QixLQUFLLEVBQUUsQ0FBQTtRQUNQLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO1FBQ2xCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ3BCLENBQUM7SUFFRCxLQUFLO1FBQ0gsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ25CLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgV2hlcmVCYXNlIGZyb20gXCIuL3doZXJlLWJhc2UuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5V2hlcmVIYXNoIGV4dGVuZHMgV2hlcmVCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGxhaW4gLSBQbGFpbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHF1ZXJ5LCBwbGFpbikge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLnBsYWluID0gcGxhaW5cbiAgICB0aGlzLnF1ZXJ5ID0gcXVlcnlcbiAgfVxuXG4gIHRvU3FsKCkge1xuICAgIHJldHVybiB0aGlzLnBsYWluXG4gIH1cbn1cbiJdfQ==
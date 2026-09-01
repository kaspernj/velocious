// @ts-check
import OrderBase from "./order-base.js";
export default class VelociousDatabaseQueryOrderPlain extends OrderBase {
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {string} plain - Plain.
     */
    constructor(query, plain) {
        super(query);
        this.plain = plain;
        this.reverseOrder = false;
    }
    setReverseOrder() {
        this.reverseOrder = true;
    }
    toSql() {
        if (this.reverseOrder) {
            return `${this.plain} DESC`;
        }
        return this.plain;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItcGxhaW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvb3JkZXItcGxhaW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBRXZDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0NBQWlDLFNBQVEsU0FBUztJQUNyRTs7OztPQUlHO0lBQ0gsWUFBWSxLQUFLLEVBQUUsS0FBSztRQUN0QixLQUFLLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDWixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtRQUNsQixJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQTtJQUMzQixDQUFDO0lBRUQsZUFBZTtRQUNiLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFBO0lBQzFCLENBQUM7SUFFRCxLQUFLO1FBQ0gsSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDdEIsT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLE9BQU8sQ0FBQTtRQUM3QixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ25CLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgT3JkZXJCYXNlIGZyb20gXCIuL29yZGVyLWJhc2UuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5T3JkZXJQbGFpbiBleHRlbmRzIE9yZGVyQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBsYWluIC0gUGxhaW4uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihxdWVyeSwgcGxhaW4pIHtcbiAgICBzdXBlcihxdWVyeSlcbiAgICB0aGlzLnBsYWluID0gcGxhaW5cbiAgICB0aGlzLnJldmVyc2VPcmRlciA9IGZhbHNlXG4gIH1cblxuICBzZXRSZXZlcnNlT3JkZXIoKSB7XG4gICAgdGhpcy5yZXZlcnNlT3JkZXIgPSB0cnVlXG4gIH1cblxuICB0b1NxbCgpIHtcbiAgICBpZiAodGhpcy5yZXZlcnNlT3JkZXIpIHtcbiAgICAgIHJldHVybiBgJHt0aGlzLnBsYWlufSBERVNDYFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnBsYWluXG4gIH1cbn1cbiJdfQ==
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
    /**
     * Runs reversed copy.
     * @returns {VelociousDatabaseQueryOrderPlain} - A new independent order reversing the effective (rendered) direction; a directionless plain order renders DESC.
     */
    reversedCopy() {
        const effective = this.reverseOrder ? `${this.plain} DESC` : this.plain;
        const match = effective.match(/^(.*\S)\s+(ASC|DESC)$/i);
        if (match) {
            const direction = match[2].toUpperCase() == "ASC" ? "DESC" : "ASC";
            return new VelociousDatabaseQueryOrderPlain(this.query, `${match[1]} ${direction}`);
        }
        return new VelociousDatabaseQueryOrderPlain(this.query, `${effective} DESC`);
    }
    toSql() {
        if (this.reverseOrder) {
            return `${this.plain} DESC`;
        }
        return this.plain;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItcGxhaW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvb3JkZXItcGxhaW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBRXZDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0NBQWlDLFNBQVEsU0FBUztJQUNyRTs7OztPQUlHO0lBQ0gsWUFBWSxLQUFLLEVBQUUsS0FBSztRQUN0QixLQUFLLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDWixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtRQUNsQixJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQTtJQUMzQixDQUFDO0lBRUQsZUFBZTtRQUNiLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxZQUFZO1FBQ1YsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUE7UUFDdkUsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO1FBRXZELElBQUksS0FBSyxFQUFFLENBQUM7WUFDVixNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQTtZQUNsRSxPQUFPLElBQUksZ0NBQWdDLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBQ3JGLENBQUM7UUFFRCxPQUFPLElBQUksZ0NBQWdDLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLFNBQVMsT0FBTyxDQUFDLENBQUE7SUFDOUUsQ0FBQztJQUVELEtBQUs7UUFDSCxJQUFJLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN0QixPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssT0FBTyxDQUFBO1FBQzdCLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUE7SUFDbkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBPcmRlckJhc2UgZnJvbSBcIi4vb3JkZXItYmFzZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlPcmRlclBsYWluIGV4dGVuZHMgT3JkZXJCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGxhaW4gLSBQbGFpbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHF1ZXJ5LCBwbGFpbikge1xuICAgIHN1cGVyKHF1ZXJ5KVxuICAgIHRoaXMucGxhaW4gPSBwbGFpblxuICAgIHRoaXMucmV2ZXJzZU9yZGVyID0gZmFsc2VcbiAgfVxuXG4gIHNldFJldmVyc2VPcmRlcigpIHtcbiAgICB0aGlzLnJldmVyc2VPcmRlciA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldmVyc2VkIGNvcHkuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5T3JkZXJQbGFpbn0gLSBBIG5ldyBpbmRlcGVuZGVudCBvcmRlciByZXZlcnNpbmcgdGhlIGVmZmVjdGl2ZSAocmVuZGVyZWQpIGRpcmVjdGlvbjsgYSBkaXJlY3Rpb25sZXNzIHBsYWluIG9yZGVyIHJlbmRlcnMgREVTQy5cbiAgICovXG4gIHJldmVyc2VkQ29weSgpIHtcbiAgICBjb25zdCBlZmZlY3RpdmUgPSB0aGlzLnJldmVyc2VPcmRlciA/IGAke3RoaXMucGxhaW59IERFU0NgIDogdGhpcy5wbGFpblxuICAgIGNvbnN0IG1hdGNoID0gZWZmZWN0aXZlLm1hdGNoKC9eKC4qXFxTKVxccysoQVNDfERFU0MpJC9pKVxuXG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICBjb25zdCBkaXJlY3Rpb24gPSBtYXRjaFsyXS50b1VwcGVyQ2FzZSgpID09IFwiQVNDXCIgPyBcIkRFU0NcIiA6IFwiQVNDXCJcbiAgICAgIHJldHVybiBuZXcgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeU9yZGVyUGxhaW4odGhpcy5xdWVyeSwgYCR7bWF0Y2hbMV19ICR7ZGlyZWN0aW9ufWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5T3JkZXJQbGFpbih0aGlzLnF1ZXJ5LCBgJHtlZmZlY3RpdmV9IERFU0NgKVxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgaWYgKHRoaXMucmV2ZXJzZU9yZGVyKSB7XG4gICAgICByZXR1cm4gYCR7dGhpcy5wbGFpbn0gREVTQ2BcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5wbGFpblxuICB9XG59XG4iXX0=
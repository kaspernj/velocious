// @ts-check
export default class VelociousDatabaseQueryOrderBase {
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     */
    constructor(query) {
        this.query = query;
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this.query.driver.options();
    }
    /**
     * Runs set reverse order.
     * @abstract
     * @param {boolean} _reverseOrder - Whether reverse order.
     * @returns {void} - No return value.
     */
    setReverseOrder(_reverseOrder) {
        throw new Error("setReverseOrder not implemented");
    }
    /**
     * Runs reversed copy.
     * @abstract
     * @returns {import("./order-base.js").default} - A new independent order with the direction reversed.
     */
    reversedCopy() {
        throw new Error("reversedCopy not implemented");
    }
    toSql() {
        throw new Error("'toSql' wasn't implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9vcmRlci1iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUErQjtJQUNsRDs7O09BR0c7SUFDSCxZQUFZLEtBQUs7UUFDZixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsZUFBZSxDQUFDLGFBQWE7UUFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO0lBQ3BELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsWUFBWTtRQUNWLE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQTtJQUNqRCxDQUFDO0lBRUQsS0FBSztRQUNILE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeU9yZGVyQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHF1ZXJ5KSB7XG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkuZHJpdmVyLm9wdGlvbnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHJldmVyc2Ugb3JkZXIuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IF9yZXZlcnNlT3JkZXIgLSBXaGV0aGVyIHJldmVyc2Ugb3JkZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFJldmVyc2VPcmRlcihfcmV2ZXJzZU9yZGVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwic2V0UmV2ZXJzZU9yZGVyIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmV2ZXJzZWQgY29weS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL29yZGVyLWJhc2UuanNcIikuZGVmYXVsdH0gLSBBIG5ldyBpbmRlcGVuZGVudCBvcmRlciB3aXRoIHRoZSBkaXJlY3Rpb24gcmV2ZXJzZWQuXG4gICAqL1xuICByZXZlcnNlZENvcHkoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicmV2ZXJzZWRDb3B5IG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3RvU3FsJyB3YXNuJ3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19
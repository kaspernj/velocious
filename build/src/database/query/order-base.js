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
    toSql() {
        throw new Error("'toSql' wasn't implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9vcmRlci1iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUErQjtJQUNsRDs7O09BR0c7SUFDSCxZQUFZLEtBQUs7UUFDZixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsZUFBZSxDQUFDLGFBQWE7UUFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO0lBQ3BELENBQUM7SUFFRCxLQUFLO1FBQ0gsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQy9DLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5T3JkZXJCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3IocXVlcnkpIHtcbiAgICB0aGlzLnF1ZXJ5ID0gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeS5kcml2ZXIub3B0aW9ucygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmV2ZXJzZSBvcmRlci5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gX3JldmVyc2VPcmRlciAtIFdoZXRoZXIgcmV2ZXJzZSBvcmRlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0UmV2ZXJzZU9yZGVyKF9yZXZlcnNlT3JkZXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJzZXRSZXZlcnNlT3JkZXIgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICB0b1NxbCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIndG9TcWwnIHdhc24ndCBpbXBsZW1lbnRlZFwiKVxuICB9XG59XG4iXX0=
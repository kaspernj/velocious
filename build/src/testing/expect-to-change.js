// @ts-check
import BaseExpect from "./base-expect.js";
import restArgsError from "../utils/rest-args-error.js";
export default class ExpectToChange extends BaseExpect {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {() => Promise<number>} args.changeCallback - Change callback.
     * @param {import("./expect.js").default} args.expect - Expect.
     */
    constructor({ changeCallback, expect, ...restArgs }) {
        super();
        restArgsError(restArgs);
        this.expect = expect;
        this.changeCallback = changeCallback;
    }
    /**
     * Runs by.
     * @param {number} count - Count value.
     * @returns {import("./expect.js").default} - The by.
     */
    by(count) {
        this.count = count;
        return this.expect;
    }
    async runBefore() {
        this.oldCount = await this.changeCallback();
    }
    async runAfter() {
        this.newCount = await this.changeCallback();
    }
    /**
     * Runs execute.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async execute() {
        if (this.newCount === undefined || this.oldCount === undefined) {
            throw new Error("ExpectToChange not executed properly");
        }
        const difference = this.newCount - this.oldCount;
        if (difference != this.count) {
            throw new Error(`Expected to change by ${this.count} but changed by ${difference}`);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhwZWN0LXRvLWNoYW5nZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL2V4cGVjdC10by1jaGFuZ2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZELE1BQU0sQ0FBQyxPQUFPLE9BQU8sY0FBZSxTQUFRLFVBQVU7SUFDcEQ7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsY0FBYyxFQUFFLE1BQU0sRUFBRSxHQUFHLFFBQVEsRUFBQztRQUMvQyxLQUFLLEVBQUUsQ0FBQTtRQUNQLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQTtJQUN0QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEVBQUUsQ0FBQyxLQUFLO1FBQ04sSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFFbEIsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFBO0lBQ3BCLENBQUM7SUFFRCxLQUFLLENBQUMsU0FBUztRQUNiLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUE7SUFDN0MsQ0FBQztJQUVELEtBQUssQ0FBQyxRQUFRO1FBQ1osSUFBSSxDQUFDLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQTtJQUM3QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxJQUFJLElBQUksQ0FBQyxRQUFRLEtBQUssU0FBUyxJQUFJLElBQUksQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDL0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFBO1FBQ3pELENBQUM7UUFFRCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUE7UUFFaEQsSUFBSSxVQUFVLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQzdCLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLElBQUksQ0FBQyxLQUFLLG1CQUFtQixVQUFVLEVBQUUsQ0FBQyxDQUFBO1FBQ3JGLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VFeHBlY3QgZnJvbSBcIi4vYmFzZS1leHBlY3QuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEV4cGVjdFRvQ2hhbmdlIGV4dGVuZHMgQmFzZUV4cGVjdCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8bnVtYmVyPn0gYXJncy5jaGFuZ2VDYWxsYmFjayAtIENoYW5nZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2V4cGVjdC5qc1wiKS5kZWZhdWx0fSBhcmdzLmV4cGVjdCAtIEV4cGVjdC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjaGFuZ2VDYWxsYmFjaywgZXhwZWN0LCAuLi5yZXN0QXJnc30pIHtcbiAgICBzdXBlcigpXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMuZXhwZWN0ID0gZXhwZWN0XG4gICAgdGhpcy5jaGFuZ2VDYWxsYmFjayA9IGNoYW5nZUNhbGxiYWNrXG4gIH1cblxuICAvKipcbiAgICogUnVucyBieS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGNvdW50IC0gQ291bnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2V4cGVjdC5qc1wiKS5kZWZhdWx0fSAtIFRoZSBieS5cbiAgICovXG4gIGJ5KGNvdW50KSB7XG4gICAgdGhpcy5jb3VudCA9IGNvdW50XG5cbiAgICByZXR1cm4gdGhpcy5leHBlY3RcbiAgfVxuXG4gIGFzeW5jIHJ1bkJlZm9yZSgpIHtcbiAgICB0aGlzLm9sZENvdW50ID0gYXdhaXQgdGhpcy5jaGFuZ2VDYWxsYmFjaygpXG4gIH1cblxuICBhc3luYyBydW5BZnRlcigpIHtcbiAgICB0aGlzLm5ld0NvdW50ID0gYXdhaXQgdGhpcy5jaGFuZ2VDYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBpZiAodGhpcy5uZXdDb3VudCA9PT0gdW5kZWZpbmVkIHx8IHRoaXMub2xkQ291bnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0VG9DaGFuZ2Ugbm90IGV4ZWN1dGVkIHByb3Blcmx5XCIpXG4gICAgfVxuXG4gICAgY29uc3QgZGlmZmVyZW5jZSA9IHRoaXMubmV3Q291bnQgLSB0aGlzLm9sZENvdW50XG5cbiAgICBpZiAoZGlmZmVyZW5jZSAhPSB0aGlzLmNvdW50KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHRvIGNoYW5nZSBieSAke3RoaXMuY291bnR9IGJ1dCBjaGFuZ2VkIGJ5ICR7ZGlmZmVyZW5jZX1gKVxuICAgIH1cbiAgfVxufVxuIl19
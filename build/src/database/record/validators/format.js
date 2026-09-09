// @ts-check
import Base from "./base.js";
export default class VelociousDatabaseRecordValidatorsFormat extends Base {
    /**
     * Runs validate.
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     * @returns {Promise<void>}
     */
    async validate({ model, attributeName }) {
        const value = model.readAttribute(attributeName);
        // Rails parity: `allow_blank: true` skips the format check for
        // blank/null/undefined values. Default to false (same as Rails).
        const allowBlank = this.args?.allowBlank === true;
        if (value == null || (typeof value === "string" && value.trim() === "")) {
            if (allowBlank)
                return;
            if (!(attributeName in model._validationErrors))
                model._validationErrors[attributeName] = [];
            model._validationErrors[attributeName].push({ type: "format", message: "is invalid" });
            return;
        }
        const pattern = this.args?.with;
        if (!(pattern instanceof RegExp)) {
            throw new Error(`validates format requires a 'with' option that is a RegExp, got: ${typeof pattern}`);
        }
        const stringValue = String(value);
        // Reset lastIndex so stateful flags (g, y) on a shared RegExp
        // instance don't cause nondeterministic pass/fail across calls.
        pattern.lastIndex = 0;
        if (!pattern.test(stringValue)) {
            const message = typeof this.args?.message === "string" ? this.args.message : "is invalid";
            if (!(attributeName in model._validationErrors))
                model._validationErrors[attributeName] = [];
            model._validationErrors[attributeName].push({ type: "format", message });
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZm9ybWF0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3JlY29yZC92YWxpZGF0b3JzL2Zvcm1hdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBRTVCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sdUNBQXdDLFNBQVEsSUFBSTtJQUN2RTs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsUUFBUSxDQUFDLEVBQUMsS0FBSyxFQUFFLGFBQWEsRUFBQztRQUNuQyxNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRWhELCtEQUErRDtRQUMvRCxpRUFBaUU7UUFDakUsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFBO1FBRWpELElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxDQUFDLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUN4RSxJQUFJLFVBQVU7Z0JBQUUsT0FBTTtZQUV0QixJQUFJLENBQUMsQ0FBQyxhQUFhLElBQUksS0FBSyxDQUFDLGlCQUFpQixDQUFDO2dCQUFFLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLENBQUE7WUFFNUYsS0FBSyxDQUFDLGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7WUFFcEYsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQTtRQUUvQixJQUFJLENBQUMsQ0FBQyxPQUFPLFlBQVksTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUNqQyxNQUFNLElBQUksS0FBSyxDQUFDLG9FQUFvRSxPQUFPLE9BQU8sRUFBRSxDQUFDLENBQUE7UUFDdkcsQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUVqQyw4REFBOEQ7UUFDOUQsZ0VBQWdFO1FBQ2hFLE9BQU8sQ0FBQyxTQUFTLEdBQUcsQ0FBQyxDQUFBO1FBRXJCLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDL0IsTUFBTSxPQUFPLEdBQUcsT0FBTyxJQUFJLENBQUMsSUFBSSxFQUFFLE9BQU8sS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUE7WUFFekYsSUFBSSxDQUFDLENBQUMsYUFBYSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQztnQkFBRSxLQUFLLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSxDQUFBO1lBRTVGLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDeEUsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRWYWxpZGF0b3JzRm9ybWF0IGV4dGVuZHMgQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIHZhbGlkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHZhbGlkYXRlKHttb2RlbCwgYXR0cmlidXRlTmFtZX0pIHtcbiAgICBjb25zdCB2YWx1ZSA9IG1vZGVsLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcblxuICAgIC8vIFJhaWxzIHBhcml0eTogYGFsbG93X2JsYW5rOiB0cnVlYCBza2lwcyB0aGUgZm9ybWF0IGNoZWNrIGZvclxuICAgIC8vIGJsYW5rL251bGwvdW5kZWZpbmVkIHZhbHVlcy4gRGVmYXVsdCB0byBmYWxzZSAoc2FtZSBhcyBSYWlscykuXG4gICAgY29uc3QgYWxsb3dCbGFuayA9IHRoaXMuYXJncz8uYWxsb3dCbGFuayA9PT0gdHJ1ZVxuXG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS50cmltKCkgPT09IFwiXCIpKSB7XG4gICAgICBpZiAoYWxsb3dCbGFuaykgcmV0dXJuXG5cbiAgICAgIGlmICghKGF0dHJpYnV0ZU5hbWUgaW4gbW9kZWwuX3ZhbGlkYXRpb25FcnJvcnMpKSBtb2RlbC5fdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXSA9IFtdXG5cbiAgICAgIG1vZGVsLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdLnB1c2goe3R5cGU6IFwiZm9ybWF0XCIsIG1lc3NhZ2U6IFwiaXMgaW52YWxpZFwifSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcGF0dGVybiA9IHRoaXMuYXJncz8ud2l0aFxuXG4gICAgaWYgKCEocGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgdmFsaWRhdGVzIGZvcm1hdCByZXF1aXJlcyBhICd3aXRoJyBvcHRpb24gdGhhdCBpcyBhIFJlZ0V4cCwgZ290OiAke3R5cGVvZiBwYXR0ZXJufWApXG4gICAgfVxuXG4gICAgY29uc3Qgc3RyaW5nVmFsdWUgPSBTdHJpbmcodmFsdWUpXG5cbiAgICAvLyBSZXNldCBsYXN0SW5kZXggc28gc3RhdGVmdWwgZmxhZ3MgKGcsIHkpIG9uIGEgc2hhcmVkIFJlZ0V4cFxuICAgIC8vIGluc3RhbmNlIGRvbid0IGNhdXNlIG5vbmRldGVybWluaXN0aWMgcGFzcy9mYWlsIGFjcm9zcyBjYWxscy5cbiAgICBwYXR0ZXJuLmxhc3RJbmRleCA9IDBcblxuICAgIGlmICghcGF0dGVybi50ZXN0KHN0cmluZ1ZhbHVlKSkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IHR5cGVvZiB0aGlzLmFyZ3M/Lm1lc3NhZ2UgPT09IFwic3RyaW5nXCIgPyB0aGlzLmFyZ3MubWVzc2FnZSA6IFwiaXMgaW52YWxpZFwiXG5cbiAgICAgIGlmICghKGF0dHJpYnV0ZU5hbWUgaW4gbW9kZWwuX3ZhbGlkYXRpb25FcnJvcnMpKSBtb2RlbC5fdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXSA9IFtdXG5cbiAgICAgIG1vZGVsLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdLnB1c2goe3R5cGU6IFwiZm9ybWF0XCIsIG1lc3NhZ2V9KVxuICAgIH1cbiAgfVxufVxuIl19
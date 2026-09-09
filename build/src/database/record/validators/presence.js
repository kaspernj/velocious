// @ts-check
import Base from "./base.js";
import validationMessage from "../validation-messages.js";
export default class VelociousDatabaseRecordValidatorsPresence extends Base {
    /**
     * Runs validate.
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     */
    async validate({ model, attributeName }) {
        const rawValue = /** @type {unknown} */ (model.readAttribute(attributeName));
        const attributeValue = typeof rawValue === "string" ? rawValue.trim() : rawValue;
        // Only nullish values and blank (trimmed-empty) strings count as absent;
        // falsy non-string values like 0 or false are legitimately present.
        if (attributeValue === null || attributeValue === undefined || attributeValue === "") {
            if (!(attributeName in model._validationErrors))
                model._validationErrors[attributeName] = [];
            const translator = model.getModelClass()._getConfiguration().getTranslator();
            model._validationErrors[attributeName].push({ type: "presence", message: validationMessage({ translator, type: "blank" }) });
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlc2VuY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL3ZhbGlkYXRvcnMvcHJlc2VuY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLGlCQUFpQixNQUFNLDJCQUEyQixDQUFBO0FBRXpELE1BQU0sQ0FBQyxPQUFPLE9BQU8seUNBQTBDLFNBQVEsSUFBSTtJQUN6RTs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxRQUFRLENBQUMsRUFBQyxLQUFLLEVBQUUsYUFBYSxFQUFDO1FBQ25DLE1BQU0sUUFBUSxHQUFHLHNCQUFzQixDQUFDLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFBO1FBQzVFLE1BQU0sY0FBYyxHQUFHLE9BQU8sUUFBUSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUE7UUFFaEYseUVBQXlFO1FBQ3pFLG9FQUFvRTtRQUNwRSxJQUFJLGNBQWMsS0FBSyxJQUFJLElBQUksY0FBYyxLQUFLLFNBQVMsSUFBSSxjQUFjLEtBQUssRUFBRSxFQUFFLENBQUM7WUFDckYsSUFBSSxDQUFDLENBQUMsYUFBYSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQztnQkFBRSxLQUFLLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSxDQUFBO1lBRTVGLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLGFBQWEsRUFBRSxDQUFBO1lBRTVFLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBRSxpQkFBaUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFDLENBQUMsRUFBQyxDQUFDLENBQUE7UUFDMUgsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCB2YWxpZGF0aW9uTWVzc2FnZSBmcm9tIFwiLi4vdmFsaWRhdGlvbi1tZXNzYWdlcy5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkVmFsaWRhdG9yc1ByZXNlbmNlIGV4dGVuZHMgQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIHZhbGlkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgYXN5bmMgdmFsaWRhdGUoe21vZGVsLCBhdHRyaWJ1dGVOYW1lfSkge1xuICAgIGNvbnN0IHJhd1ZhbHVlID0gLyoqIEB0eXBlIHt1bmtub3dufSAqLyAobW9kZWwucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcbiAgICBjb25zdCBhdHRyaWJ1dGVWYWx1ZSA9IHR5cGVvZiByYXdWYWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHJhd1ZhbHVlLnRyaW0oKSA6IHJhd1ZhbHVlXG5cbiAgICAvLyBPbmx5IG51bGxpc2ggdmFsdWVzIGFuZCBibGFuayAodHJpbW1lZC1lbXB0eSkgc3RyaW5ncyBjb3VudCBhcyBhYnNlbnQ7XG4gICAgLy8gZmFsc3kgbm9uLXN0cmluZyB2YWx1ZXMgbGlrZSAwIG9yIGZhbHNlIGFyZSBsZWdpdGltYXRlbHkgcHJlc2VudC5cbiAgICBpZiAoYXR0cmlidXRlVmFsdWUgPT09IG51bGwgfHwgYXR0cmlidXRlVmFsdWUgPT09IHVuZGVmaW5lZCB8fCBhdHRyaWJ1dGVWYWx1ZSA9PT0gXCJcIikge1xuICAgICAgaWYgKCEoYXR0cmlidXRlTmFtZSBpbiBtb2RlbC5fdmFsaWRhdGlvbkVycm9ycykpIG1vZGVsLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdID0gW11cblxuICAgICAgY29uc3QgdHJhbnNsYXRvciA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpLmdldFRyYW5zbGF0b3IoKVxuXG4gICAgICBtb2RlbC5fdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXS5wdXNoKHt0eXBlOiBcInByZXNlbmNlXCIsIG1lc3NhZ2U6IHZhbGlkYXRpb25NZXNzYWdlKHt0cmFuc2xhdG9yLCB0eXBlOiBcImJsYW5rXCJ9KX0pXG4gICAgfVxuICB9XG59XG4iXX0=
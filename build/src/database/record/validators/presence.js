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
        const rawValue = /** @type {string | undefined} */ (model.readAttribute(attributeName));
        const attributeValue = rawValue?.trim();
        if (!attributeValue) {
            if (!(attributeName in model._validationErrors))
                model._validationErrors[attributeName] = [];
            const translator = model.getModelClass()._getConfiguration().getTranslator();
            model._validationErrors[attributeName].push({ type: "presence", message: validationMessage({ translator, type: "blank" }) });
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlc2VuY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL3ZhbGlkYXRvcnMvcHJlc2VuY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLGlCQUFpQixNQUFNLDJCQUEyQixDQUFBO0FBRXpELE1BQU0sQ0FBQyxPQUFPLE9BQU8seUNBQTBDLFNBQVEsSUFBSTtJQUN6RTs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxRQUFRLENBQUMsRUFBQyxLQUFLLEVBQUUsYUFBYSxFQUFDO1FBQ25DLE1BQU0sUUFBUSxHQUFHLGlDQUFpQyxDQUFDLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFBO1FBQ3ZGLE1BQU0sY0FBYyxHQUFHLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQTtRQUV2QyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDcEIsSUFBSSxDQUFDLENBQUMsYUFBYSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQztnQkFBRSxLQUFLLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSxDQUFBO1lBRTVGLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLGFBQWEsRUFBRSxDQUFBO1lBRTVFLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBRSxpQkFBaUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFDLENBQUMsRUFBQyxDQUFDLENBQUE7UUFDMUgsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCB2YWxpZGF0aW9uTWVzc2FnZSBmcm9tIFwiLi4vdmFsaWRhdGlvbi1tZXNzYWdlcy5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkVmFsaWRhdG9yc1ByZXNlbmNlIGV4dGVuZHMgQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIHZhbGlkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgYXN5bmMgdmFsaWRhdGUoe21vZGVsLCBhdHRyaWJ1dGVOYW1lfSkge1xuICAgIGNvbnN0IHJhd1ZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovIChtb2RlbC5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpKVxuICAgIGNvbnN0IGF0dHJpYnV0ZVZhbHVlID0gcmF3VmFsdWU/LnRyaW0oKVxuXG4gICAgaWYgKCFhdHRyaWJ1dGVWYWx1ZSkge1xuICAgICAgaWYgKCEoYXR0cmlidXRlTmFtZSBpbiBtb2RlbC5fdmFsaWRhdGlvbkVycm9ycykpIG1vZGVsLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdID0gW11cblxuICAgICAgY29uc3QgdHJhbnNsYXRvciA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpLmdldFRyYW5zbGF0b3IoKVxuXG4gICAgICBtb2RlbC5fdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXS5wdXNoKHt0eXBlOiBcInByZXNlbmNlXCIsIG1lc3NhZ2U6IHZhbGlkYXRpb25NZXNzYWdlKHt0cmFuc2xhdG9yLCB0eXBlOiBcImJsYW5rXCJ9KX0pXG4gICAgfVxuICB9XG59XG4iXX0=
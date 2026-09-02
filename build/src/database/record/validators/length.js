// @ts-check
import Base from "./base.js";
import validationMessage from "../validation-messages.js";
export default class VelociousDatabaseRecordValidatorsLength extends Base {
    /**
     * Runs validate: bounds the value's string length by the `maximum` and/or
     * `minimum` options. Absent values (null/undefined/"") are skipped — they
     * are the presence validator's concern.
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async validate({ model, attributeName }) {
        const maximum = this.args?.maximum;
        const minimum = this.args?.minimum;
        if (typeof maximum != "number" && typeof minimum != "number") {
            throw new Error("length validator requires a maximum and/or minimum option");
        }
        const rawValue = model.readAttribute(attributeName);
        if (rawValue === null || rawValue === undefined || rawValue === "")
            return;
        const valueLength = String(rawValue).length;
        const translator = model.getModelClass()._getConfiguration().getTranslator();
        if (typeof maximum == "number" && valueLength > maximum) {
            this._addError(model, attributeName, validationMessage({ translator, type: "too_long", variables: { count: maximum } }));
        }
        if (typeof minimum == "number" && valueLength < minimum) {
            this._addError(model, attributeName, validationMessage({ translator, type: "too_short", variables: { count: minimum } }));
        }
    }
    /**
     * Adds a length validation error to the model.
     * @param {import("../index.js").default} model - Model instance.
     * @param {string} attributeName - Attribute name.
     * @param {string} message - Translated message predicate.
     * @returns {void}
     */
    _addError(model, attributeName, message) {
        if (!(attributeName in model._validationErrors))
            model._validationErrors[attributeName] = [];
        model._validationErrors[attributeName].push({ type: "length", message });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGVuZ3RoLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3JlY29yZC92YWxpZGF0b3JzL2xlbmd0aC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8saUJBQWlCLE1BQU0sMkJBQTJCLENBQUE7QUFFekQsTUFBTSxDQUFDLE9BQU8sT0FBTyx1Q0FBd0MsU0FBUSxJQUFJO0lBQ3ZFOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFDLEtBQUssRUFBRSxhQUFhLEVBQUM7UUFDbkMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUE7UUFDbEMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUE7UUFFbEMsSUFBSSxPQUFPLE9BQU8sSUFBSSxRQUFRLElBQUksT0FBTyxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7WUFDN0QsTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFBO1FBQzlFLENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRW5ELElBQUksUUFBUSxLQUFLLElBQUksSUFBSSxRQUFRLEtBQUssU0FBUyxJQUFJLFFBQVEsS0FBSyxFQUFFO1lBQUUsT0FBTTtRQUUxRSxNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFBO1FBQzNDLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBRTVFLElBQUksT0FBTyxPQUFPLElBQUksUUFBUSxJQUFJLFdBQVcsR0FBRyxPQUFPLEVBQUUsQ0FBQztZQUN4RCxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxhQUFhLEVBQUUsaUJBQWlCLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdEgsQ0FBQztRQUVELElBQUksT0FBTyxPQUFPLElBQUksUUFBUSxJQUFJLFdBQVcsR0FBRyxPQUFPLEVBQUUsQ0FBQztZQUN4RCxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxhQUFhLEVBQUUsaUJBQWlCLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxTQUFTLEVBQUUsRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdkgsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxTQUFTLENBQUMsS0FBSyxFQUFFLGFBQWEsRUFBRSxPQUFPO1FBQ3JDLElBQUksQ0FBQyxDQUFDLGFBQWEsSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUM7WUFBRSxLQUFLLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRTVGLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7SUFDeEUsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlIGZyb20gXCIuL2Jhc2UuanNcIlxuaW1wb3J0IHZhbGlkYXRpb25NZXNzYWdlIGZyb20gXCIuLi92YWxpZGF0aW9uLW1lc3NhZ2VzLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRWYWxpZGF0b3JzTGVuZ3RoIGV4dGVuZHMgQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIHZhbGlkYXRlOiBib3VuZHMgdGhlIHZhbHVlJ3Mgc3RyaW5nIGxlbmd0aCBieSB0aGUgYG1heGltdW1gIGFuZC9vclxuICAgKiBgbWluaW11bWAgb3B0aW9ucy4gQWJzZW50IHZhbHVlcyAobnVsbC91bmRlZmluZWQvXCJcIikgYXJlIHNraXBwZWQg4oCUIHRoZXlcbiAgICogYXJlIHRoZSBwcmVzZW5jZSB2YWxpZGF0b3IncyBjb25jZXJuLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdmFsaWRhdGUoe21vZGVsLCBhdHRyaWJ1dGVOYW1lfSkge1xuICAgIGNvbnN0IG1heGltdW0gPSB0aGlzLmFyZ3M/Lm1heGltdW1cbiAgICBjb25zdCBtaW5pbXVtID0gdGhpcy5hcmdzPy5taW5pbXVtXG5cbiAgICBpZiAodHlwZW9mIG1heGltdW0gIT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgbWluaW11bSAhPSBcIm51bWJlclwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJsZW5ndGggdmFsaWRhdG9yIHJlcXVpcmVzIGEgbWF4aW11bSBhbmQvb3IgbWluaW11bSBvcHRpb25cIilcbiAgICB9XG5cbiAgICBjb25zdCByYXdWYWx1ZSA9IG1vZGVsLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChyYXdWYWx1ZSA9PT0gbnVsbCB8fCByYXdWYWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHJhd1ZhbHVlID09PSBcIlwiKSByZXR1cm5cblxuICAgIGNvbnN0IHZhbHVlTGVuZ3RoID0gU3RyaW5nKHJhd1ZhbHVlKS5sZW5ndGhcbiAgICBjb25zdCB0cmFuc2xhdG9yID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0VHJhbnNsYXRvcigpXG5cbiAgICBpZiAodHlwZW9mIG1heGltdW0gPT0gXCJudW1iZXJcIiAmJiB2YWx1ZUxlbmd0aCA+IG1heGltdW0pIHtcbiAgICAgIHRoaXMuX2FkZEVycm9yKG1vZGVsLCBhdHRyaWJ1dGVOYW1lLCB2YWxpZGF0aW9uTWVzc2FnZSh7dHJhbnNsYXRvciwgdHlwZTogXCJ0b29fbG9uZ1wiLCB2YXJpYWJsZXM6IHtjb3VudDogbWF4aW11bX19KSlcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIG1pbmltdW0gPT0gXCJudW1iZXJcIiAmJiB2YWx1ZUxlbmd0aCA8IG1pbmltdW0pIHtcbiAgICAgIHRoaXMuX2FkZEVycm9yKG1vZGVsLCBhdHRyaWJ1dGVOYW1lLCB2YWxpZGF0aW9uTWVzc2FnZSh7dHJhbnNsYXRvciwgdHlwZTogXCJ0b29fc2hvcnRcIiwgdmFyaWFibGVzOiB7Y291bnQ6IG1pbmltdW19fSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBsZW5ndGggdmFsaWRhdGlvbiBlcnJvciB0byB0aGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUcmFuc2xhdGVkIG1lc3NhZ2UgcHJlZGljYXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hZGRFcnJvcihtb2RlbCwgYXR0cmlidXRlTmFtZSwgbWVzc2FnZSkge1xuICAgIGlmICghKGF0dHJpYnV0ZU5hbWUgaW4gbW9kZWwuX3ZhbGlkYXRpb25FcnJvcnMpKSBtb2RlbC5fdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXSA9IFtdXG5cbiAgICBtb2RlbC5fdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXS5wdXNoKHt0eXBlOiBcImxlbmd0aFwiLCBtZXNzYWdlfSlcbiAgfVxufVxuIl19
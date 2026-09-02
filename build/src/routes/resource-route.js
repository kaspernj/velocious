// @ts-check
import BaseRoute from "./base-route.js";
import BasicRoute from "./basic-route.js";
import escapeStringRegexp from "escape-string-regexp";
import * as inflection from "inflection";
import restArgsError from "../utils/rest-args-error.js";
import singularizeModelName from "../utils/singularize-model-name.js";
class VelociousRouteResourceRoute extends BasicRoute {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.name - Name.
     */
    constructor({ name, ...restArgs }) {
        super();
        restArgsError(restArgs);
        this.name = name;
        this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`);
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<string>} */
        this.collectionRouteNames = new Set();
    }
    /**
     * Runs get.
     * @param {string} name - Name.
     * @param {{on?: "member" | "collection"}} [options] - Route options for scope.
     */
    get(name, options = {}) {
        const { on, ...restArgs } = options || {};
        restArgsError(restArgs);
        if (on && on !== "member" && on !== "collection") {
            throw new Error(`Unknown 'on' value: ${on}`);
        }
        if (on === "collection") {
            this.collectionRouteNames.add(name);
        }
        super.get(name);
    }
    /**
     * Runs post.
     * @param {string} name - Name.
     * @param {{on?: "member" | "collection"}} [options] - Route options for scope.
     */
    post(name, options = {}) {
        const { on, ...restArgs } = options || {};
        restArgsError(restArgs);
        if (on && on !== "member" && on !== "collection") {
            throw new Error(`Unknown 'on' value: ${on}`);
        }
        if (on === "collection") {
            this.collectionRouteNames.add(name);
        }
        super.post(name);
    }
    getHumanPaths() {
        return [
            { method: "GET", action: "index", path: this.name },
            { method: "POST", action: "create", path: this.name },
            { method: "GET", action: "show", path: `${this.name}/\${id}` },
            { method: "DELETE", action: "destroy", path: `${this.name}/\${id}` }
        ];
    }
    /**
     * Runs match with path.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Parameters object.
     * @param {string} args.path - Path.
     * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
     * @returns {{restPath: string} | undefined} - REST path metadata for this route.
     */
    matchWithPath({ params, path, request }) {
        const match = path.match(this.regExp);
        if (match) {
            const [_beginnigSlash, _matchedName, restPath] = match;
            let action;
            const controllerName = params.controller ? `${params.controller}/${this.name}` : this.name;
            const normalizedRestPath = restPath.replace(/^\//, "");
            let nextRestPath = normalizedRestPath;
            params.controller = controllerName;
            if (normalizedRestPath.length === 0) {
                if (request.httpMethod() == "DELETE") {
                    action = "delete";
                }
                else if (request.httpMethod() == "POST") {
                    action = "create";
                }
                else {
                    action = "index";
                }
                nextRestPath = "";
            }
            else {
                const [collectionCandidate] = normalizedRestPath.split("/");
                if (this.collectionRouteNames.has(collectionCandidate)) {
                    nextRestPath = normalizedRestPath;
                }
                else {
                    const idMatch = normalizedRestPath.match(/^([^/?]+)(?:\?[^/]*)?(?:\/(.*))?$/);
                    if (idMatch) {
                        const singularName = singularizeModelName(this.name);
                        const singularAttributeName = inflection.camelize(inflection.underscore(singularName), true);
                        const idVarName = `${singularAttributeName}Id`;
                        const recordId = idMatch[1];
                        const remainingPath = idMatch[2];
                        params[idVarName] = recordId;
                        params.id = recordId;
                        if (remainingPath && remainingPath.length > 0) {
                            nextRestPath = remainingPath;
                        }
                        else if (request.httpMethod() == "DELETE") {
                            action = "delete";
                            nextRestPath = "";
                        }
                        else if (request.httpMethod() == "POST") {
                            action = "create";
                            nextRestPath = "";
                        }
                        else {
                            action = "show";
                            nextRestPath = "";
                        }
                    }
                }
            }
            if (action) {
                params.action = action;
            }
            return { restPath: nextRestPath };
        }
    }
}
BaseRoute.registerRouteResourceType(VelociousRouteResourceRoute);
export default VelociousRouteResourceRoute;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2Utcm91dGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvcm91dGVzL3Jlc291cmNlLXJvdXRlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUN2QyxPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLGtCQUFrQixNQUFNLHNCQUFzQixDQUFBO0FBQ3JELE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sb0JBQW9CLE1BQU0sb0NBQW9DLENBQUE7QUFFckUsTUFBTSwyQkFBNEIsU0FBUSxVQUFVO0lBQ2xEOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsSUFBSSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzdCLEtBQUssRUFBRSxDQUFBO1FBQ1AsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsS0FBSyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDL0Q7O2lDQUV5QjtRQUN6QixJQUFJLENBQUMsb0JBQW9CLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEdBQUcsQ0FBQyxJQUFJLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDcEIsTUFBTSxFQUFDLEVBQUUsRUFBRSxHQUFHLFFBQVEsRUFBQyxHQUFHLE9BQU8sSUFBSSxFQUFFLENBQUE7UUFFdkMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxRQUFRLElBQUksRUFBRSxLQUFLLFlBQVksRUFBRSxDQUFDO1lBQ2pELE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFDOUMsQ0FBQztRQUVELElBQUksRUFBRSxLQUFLLFlBQVksRUFBRSxDQUFDO1lBQ3hCLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDckMsQ0FBQztRQUVELEtBQUssQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDakIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxJQUFJLENBQUMsSUFBSSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQ3JCLE1BQU0sRUFBQyxFQUFFLEVBQUUsR0FBRyxRQUFRLEVBQUMsR0FBRyxPQUFPLElBQUksRUFBRSxDQUFBO1FBRXZDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssUUFBUSxJQUFJLEVBQUUsS0FBSyxZQUFZLEVBQUUsQ0FBQztZQUNqRCxNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBQzlDLENBQUM7UUFFRCxJQUFJLEVBQUUsS0FBSyxZQUFZLEVBQUUsQ0FBQztZQUN4QixJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3JDLENBQUM7UUFFRCxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ2xCLENBQUM7SUFFRCxhQUFhO1FBQ1gsT0FBTztZQUNMLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxFQUFDO1lBQ2pELEVBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxFQUFDO1lBQ25ELEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLFNBQVMsRUFBQztZQUM1RCxFQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxTQUFTLEVBQUM7U0FDbkUsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsYUFBYSxDQUFDLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDbkMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFckMsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNWLE1BQU0sQ0FBQyxjQUFjLEVBQUUsWUFBWSxFQUFFLFFBQVEsQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUV0RCxJQUFJLE1BQU0sQ0FBQTtZQUNWLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUE7WUFDMUYsTUFBTSxrQkFBa0IsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQTtZQUN0RCxJQUFJLFlBQVksR0FBRyxrQkFBa0IsQ0FBQTtZQUVyQyxNQUFNLENBQUMsVUFBVSxHQUFHLGNBQWMsQ0FBQTtZQUVsQyxJQUFJLGtCQUFrQixDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDcEMsSUFBSSxPQUFPLENBQUMsVUFBVSxFQUFFLElBQUksUUFBUSxFQUFFLENBQUM7b0JBQ3JDLE1BQU0sR0FBRyxRQUFRLENBQUE7Z0JBQ25CLENBQUM7cUJBQU0sSUFBSSxPQUFPLENBQUMsVUFBVSxFQUFFLElBQUksTUFBTSxFQUFFLENBQUM7b0JBQzFDLE1BQU0sR0FBRyxRQUFRLENBQUE7Z0JBQ25CLENBQUM7cUJBQU0sQ0FBQztvQkFDTixNQUFNLEdBQUcsT0FBTyxDQUFBO2dCQUNsQixDQUFDO2dCQUNELFlBQVksR0FBRyxFQUFFLENBQUE7WUFDbkIsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtnQkFFM0QsSUFBSSxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDLEVBQUUsQ0FBQztvQkFDdkQsWUFBWSxHQUFHLGtCQUFrQixDQUFBO2dCQUNuQyxDQUFDO3FCQUFNLENBQUM7b0JBQ04sTUFBTSxPQUFPLEdBQUcsa0JBQWtCLENBQUMsS0FBSyxDQUFDLG1DQUFtQyxDQUFDLENBQUE7b0JBRTdFLElBQUksT0FBTyxFQUFFLENBQUM7d0JBQ1osTUFBTSxZQUFZLEdBQUcsb0JBQW9CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO3dCQUNwRCxNQUFNLHFCQUFxQixHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQTt3QkFDNUYsTUFBTSxTQUFTLEdBQUcsR0FBRyxxQkFBcUIsSUFBSSxDQUFBO3dCQUM5QyxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUE7d0JBQzNCLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQTt3QkFFaEMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxHQUFHLFFBQVEsQ0FBQTt3QkFDNUIsTUFBTSxDQUFDLEVBQUUsR0FBRyxRQUFRLENBQUE7d0JBRXBCLElBQUksYUFBYSxJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7NEJBQzlDLFlBQVksR0FBRyxhQUFhLENBQUE7d0JBQzlCLENBQUM7NkJBQU0sSUFBSSxPQUFPLENBQUMsVUFBVSxFQUFFLElBQUksUUFBUSxFQUFFLENBQUM7NEJBQzVDLE1BQU0sR0FBRyxRQUFRLENBQUE7NEJBQ2pCLFlBQVksR0FBRyxFQUFFLENBQUE7d0JBQ25CLENBQUM7NkJBQU0sSUFBSSxPQUFPLENBQUMsVUFBVSxFQUFFLElBQUksTUFBTSxFQUFFLENBQUM7NEJBQzFDLE1BQU0sR0FBRyxRQUFRLENBQUE7NEJBQ2pCLFlBQVksR0FBRyxFQUFFLENBQUE7d0JBQ25CLENBQUM7NkJBQU0sQ0FBQzs0QkFDTixNQUFNLEdBQUcsTUFBTSxDQUFBOzRCQUNmLFlBQVksR0FBRyxFQUFFLENBQUE7d0JBQ25CLENBQUM7b0JBQ0gsQ0FBQztnQkFDSCxDQUFDO1lBQ0gsQ0FBQztZQUVELElBQUksTUFBTSxFQUFFLENBQUM7Z0JBQ1gsTUFBTSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7WUFDeEIsQ0FBQztZQUVELE9BQU8sRUFBQyxRQUFRLEVBQUUsWUFBWSxFQUFDLENBQUE7UUFDakMsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVELFNBQVMsQ0FBQyx5QkFBeUIsQ0FBQywyQkFBMkIsQ0FBQyxDQUFBO0FBRWhFLGVBQWUsMkJBQTJCLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VSb3V0ZSBmcm9tIFwiLi9iYXNlLXJvdXRlLmpzXCJcbmltcG9ydCBCYXNpY1JvdXRlIGZyb20gXCIuL2Jhc2ljLXJvdXRlLmpzXCJcbmltcG9ydCBlc2NhcGVTdHJpbmdSZWdleHAgZnJvbSBcImVzY2FwZS1zdHJpbmctcmVnZXhwXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgc2luZ3VsYXJpemVNb2RlbE5hbWUgZnJvbSBcIi4uL3V0aWxzL3Npbmd1bGFyaXplLW1vZGVsLW5hbWUuanNcIlxuXG5jbGFzcyBWZWxvY2lvdXNSb3V0ZVJlc291cmNlUm91dGUgZXh0ZW5kcyBCYXNpY1JvdXRlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBOYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe25hbWUsIC4uLnJlc3RBcmdzfSkge1xuICAgIHN1cGVyKClcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIHRoaXMubmFtZSA9IG5hbWVcbiAgICB0aGlzLnJlZ0V4cCA9IG5ldyBSZWdFeHAoYF4oJHtlc2NhcGVTdHJpbmdSZWdleHAobmFtZSl9KSguKikkYClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIHRoaXMuY29sbGVjdGlvblJvdXRlTmFtZXMgPSBuZXcgU2V0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3tvbj86IFwibWVtYmVyXCIgfCBcImNvbGxlY3Rpb25cIn19IFtvcHRpb25zXSAtIFJvdXRlIG9wdGlvbnMgZm9yIHNjb3BlLlxuICAgKi9cbiAgZ2V0KG5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtvbiwgLi4ucmVzdEFyZ3N9ID0gb3B0aW9ucyB8fCB7fVxuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmIChvbiAmJiBvbiAhPT0gXCJtZW1iZXJcIiAmJiBvbiAhPT0gXCJjb2xsZWN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biAnb24nIHZhbHVlOiAke29ufWApXG4gICAgfVxuXG4gICAgaWYgKG9uID09PSBcImNvbGxlY3Rpb25cIikge1xuICAgICAgdGhpcy5jb2xsZWN0aW9uUm91dGVOYW1lcy5hZGQobmFtZSlcbiAgICB9XG5cbiAgICBzdXBlci5nZXQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBvc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHt7b24/OiBcIm1lbWJlclwiIHwgXCJjb2xsZWN0aW9uXCJ9fSBbb3B0aW9uc10gLSBSb3V0ZSBvcHRpb25zIGZvciBzY29wZS5cbiAgICovXG4gIHBvc3QobmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge29uLCAuLi5yZXN0QXJnc30gPSBvcHRpb25zIHx8IHt9XG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKG9uICYmIG9uICE9PSBcIm1lbWJlclwiICYmIG9uICE9PSBcImNvbGxlY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duICdvbicgdmFsdWU6ICR7b259YClcbiAgICB9XG5cbiAgICBpZiAob24gPT09IFwiY29sbGVjdGlvblwiKSB7XG4gICAgICB0aGlzLmNvbGxlY3Rpb25Sb3V0ZU5hbWVzLmFkZChuYW1lKVxuICAgIH1cblxuICAgIHN1cGVyLnBvc3QobmFtZSlcbiAgfVxuXG4gIGdldEh1bWFuUGF0aHMoKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHttZXRob2Q6IFwiR0VUXCIsIGFjdGlvbjogXCJpbmRleFwiLCBwYXRoOiB0aGlzLm5hbWV9LFxuICAgICAge21ldGhvZDogXCJQT1NUXCIsIGFjdGlvbjogXCJjcmVhdGVcIiwgcGF0aDogdGhpcy5uYW1lfSxcbiAgICAgIHttZXRob2Q6IFwiR0VUXCIsIGFjdGlvbjogXCJzaG93XCIsIHBhdGg6IGAke3RoaXMubmFtZX0vXFwke2lkfWB9LFxuICAgICAge21ldGhvZDogXCJERUxFVEVcIiwgYWN0aW9uOiBcImRlc3Ryb3lcIiwgcGF0aDogYCR7dGhpcy5uYW1lfS9cXCR7aWR9YH1cbiAgICBdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaCB3aXRoIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFBhcmFtZXRlcnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wYXRoIC0gUGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7e3Jlc3RQYXRoOiBzdHJpbmd9IHwgdW5kZWZpbmVkfSAtIFJFU1QgcGF0aCBtZXRhZGF0YSBmb3IgdGhpcyByb3V0ZS5cbiAgICovXG4gIG1hdGNoV2l0aFBhdGgoe3BhcmFtcywgcGF0aCwgcmVxdWVzdH0pIHtcbiAgICBjb25zdCBtYXRjaCA9IHBhdGgubWF0Y2godGhpcy5yZWdFeHApXG5cbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGNvbnN0IFtfYmVnaW5uaWdTbGFzaCwgX21hdGNoZWROYW1lLCByZXN0UGF0aF0gPSBtYXRjaFxuXG4gICAgICBsZXQgYWN0aW9uXG4gICAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9IHBhcmFtcy5jb250cm9sbGVyID8gYCR7cGFyYW1zLmNvbnRyb2xsZXJ9LyR7dGhpcy5uYW1lfWAgOiB0aGlzLm5hbWVcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRSZXN0UGF0aCA9IHJlc3RQYXRoLnJlcGxhY2UoL15cXC8vLCBcIlwiKVxuICAgICAgbGV0IG5leHRSZXN0UGF0aCA9IG5vcm1hbGl6ZWRSZXN0UGF0aFxuXG4gICAgICBwYXJhbXMuY29udHJvbGxlciA9IGNvbnRyb2xsZXJOYW1lXG5cbiAgICAgIGlmIChub3JtYWxpemVkUmVzdFBhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSA9PSBcIkRFTEVURVwiKSB7XG4gICAgICAgICAgYWN0aW9uID0gXCJkZWxldGVcIlxuICAgICAgICB9IGVsc2UgaWYgKHJlcXVlc3QuaHR0cE1ldGhvZCgpID09IFwiUE9TVFwiKSB7XG4gICAgICAgICAgYWN0aW9uID0gXCJjcmVhdGVcIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFjdGlvbiA9IFwiaW5kZXhcIlxuICAgICAgICB9XG4gICAgICAgIG5leHRSZXN0UGF0aCA9IFwiXCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IFtjb2xsZWN0aW9uQ2FuZGlkYXRlXSA9IG5vcm1hbGl6ZWRSZXN0UGF0aC5zcGxpdChcIi9cIilcblxuICAgICAgICBpZiAodGhpcy5jb2xsZWN0aW9uUm91dGVOYW1lcy5oYXMoY29sbGVjdGlvbkNhbmRpZGF0ZSkpIHtcbiAgICAgICAgICBuZXh0UmVzdFBhdGggPSBub3JtYWxpemVkUmVzdFBhdGhcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBpZE1hdGNoID0gbm9ybWFsaXplZFJlc3RQYXRoLm1hdGNoKC9eKFteLz9dKykoPzpcXD9bXi9dKik/KD86XFwvKC4qKSk/JC8pXG5cbiAgICAgICAgICBpZiAoaWRNYXRjaCkge1xuICAgICAgICAgICAgY29uc3Qgc2luZ3VsYXJOYW1lID0gc2luZ3VsYXJpemVNb2RlbE5hbWUodGhpcy5uYW1lKVxuICAgICAgICAgICAgY29uc3Qgc2luZ3VsYXJBdHRyaWJ1dGVOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoc2luZ3VsYXJOYW1lKSwgdHJ1ZSlcbiAgICAgICAgICAgIGNvbnN0IGlkVmFyTmFtZSA9IGAke3Npbmd1bGFyQXR0cmlidXRlTmFtZX1JZGBcbiAgICAgICAgICAgIGNvbnN0IHJlY29yZElkID0gaWRNYXRjaFsxXVxuICAgICAgICAgICAgY29uc3QgcmVtYWluaW5nUGF0aCA9IGlkTWF0Y2hbMl1cblxuICAgICAgICAgICAgcGFyYW1zW2lkVmFyTmFtZV0gPSByZWNvcmRJZFxuICAgICAgICAgICAgcGFyYW1zLmlkID0gcmVjb3JkSWRcblxuICAgICAgICAgICAgaWYgKHJlbWFpbmluZ1BhdGggJiYgcmVtYWluaW5nUGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIG5leHRSZXN0UGF0aCA9IHJlbWFpbmluZ1BhdGhcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgPT0gXCJERUxFVEVcIikge1xuICAgICAgICAgICAgICBhY3Rpb24gPSBcImRlbGV0ZVwiXG4gICAgICAgICAgICAgIG5leHRSZXN0UGF0aCA9IFwiXCJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgPT0gXCJQT1NUXCIpIHtcbiAgICAgICAgICAgICAgYWN0aW9uID0gXCJjcmVhdGVcIlxuICAgICAgICAgICAgICBuZXh0UmVzdFBhdGggPSBcIlwiXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBhY3Rpb24gPSBcInNob3dcIlxuICAgICAgICAgICAgICBuZXh0UmVzdFBhdGggPSBcIlwiXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChhY3Rpb24pIHtcbiAgICAgICAgcGFyYW1zLmFjdGlvbiA9IGFjdGlvblxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge3Jlc3RQYXRoOiBuZXh0UmVzdFBhdGh9XG4gICAgfVxuICB9XG59XG5cbkJhc2VSb3V0ZS5yZWdpc3RlclJvdXRlUmVzb3VyY2VUeXBlKFZlbG9jaW91c1JvdXRlUmVzb3VyY2VSb3V0ZSlcblxuZXhwb3J0IGRlZmF1bHQgVmVsb2Npb3VzUm91dGVSZXNvdXJjZVJvdXRlXG5cbiJdfQ==
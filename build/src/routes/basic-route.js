// @ts-check
import BaseRoute from "./base-route.js";
export default class VelociousBasicRoute extends BaseRoute {
    /**
     * Runs get.
     * @param {string} name - Route name.
     */
    get(name) {
        const GetRoute = VelociousBasicRoute.GetRouteType;
        const route = new GetRoute({ name });
        this.routes.push(route);
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
        throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`);
    }
    /**
     * Mounts a sub-application (e.g. the background-jobs dashboard API) at a path
     * prefix, similar to mounting Sidekiq::Web in a Rails routes file. The
     * mountable's `mountInto({configuration, ...options})` is invoked when the
     * configuration receives the routes.
     * @param {{mountInto: (args: object) => void}} mountable - Mountable with a static `mountInto` method.
     * @param {object} [options] - Mount options. Must include an `at` path prefix starting with "/".
     * @returns {void} - No return value.
     */
    mount(mountable, options = {}) {
        if (!mountable || typeof mountable.mountInto !== "function") {
            throw new Error("mount expects a mountable with a 'mountInto' method");
        }
        const at = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (options).at;
        if (typeof at !== "string" || !at.startsWith("/")) {
            throw new Error(`mount requires an 'at' option starting with '/', got: ${String(at)}`);
        }
        this.mounts.push({ mountable, options });
    }
    /**
     * Runs namespace.
     * @param {string} name - Name.
     * @param {(arg: import("./namespace-route.js").default) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    namespace(name, callback) {
        const NamespaceRoute = VelociousBasicRoute.NameSpaceRouteType;
        if (!NamespaceRoute)
            throw new Error("No NamespaceRoute registered");
        const route = new NamespaceRoute({ name });
        this.routes.push(route);
        if (callback) {
            callback(route);
        }
    }
    /**
     * Runs post.
     * @param {string} name - Name.
     * @returns {void} - No return value.
     */
    post(name) {
        const PostRoute = VelociousBasicRoute.PostRouteType;
        if (!PostRoute)
            throw new Error("No PostRoute registered");
        const route = new PostRoute({ name });
        this.routes.push(route);
    }
    /**
     * Runs resources.
     * @param {string} name - Name.
     * @param {(arg: import("./resource-route.js").default) => void} [callback] - Callback function.
     * @returns {void} - No return value.
     */
    resources(name, callback) {
        const ResourceRoute = VelociousBasicRoute.ResourceRouteType;
        if (!ResourceRoute)
            throw new Error("No ResourceRoute registered");
        const route = new ResourceRoute({ name });
        this.routes.push(route);
        if (callback) {
            callback(route);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzaWMtcm91dGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvcm91dGVzL2Jhc2ljLXJvdXRlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUV2QyxNQUFNLENBQUMsT0FBTyxPQUFPLG1CQUFvQixTQUFRLFNBQVM7SUFDeEQ7OztPQUdHO0lBQ0gsR0FBRyxDQUFDLElBQUk7UUFDTixNQUFNLFFBQVEsR0FBRyxtQkFBbUIsQ0FBQyxZQUFZLENBQUE7UUFDakQsTUFBTSxLQUFLLEdBQUcsSUFBSSxRQUFRLENBQUMsRUFBQyxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRWxDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ3pCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsYUFBYSxDQUFDLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDbkMsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO0lBQy9FLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxTQUFTLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDM0IsSUFBSSxDQUFDLFNBQVMsSUFBSSxPQUFPLFNBQVMsQ0FBQyxTQUFTLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDNUQsTUFBTSxJQUFJLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFBO1FBQ3hFLENBQUM7UUFFRCxNQUFNLEVBQUUsR0FBRyw0REFBNEQsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUVwRixJQUFJLE9BQU8sRUFBRSxLQUFLLFFBQVEsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNsRCxNQUFNLElBQUksS0FBSyxDQUFDLHlEQUF5RCxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ3hGLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO0lBQ3hDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUTtRQUN0QixNQUFNLGNBQWMsR0FBRyxtQkFBbUIsQ0FBQyxrQkFBa0IsQ0FBQTtRQUU3RCxJQUFJLENBQUMsY0FBYztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQTtRQUVwRSxNQUFNLEtBQUssR0FBRyxJQUFJLGNBQWMsQ0FBQyxFQUFDLElBQUksRUFBQyxDQUFDLENBQUE7UUFFeEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFdkIsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNiLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUNqQixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxJQUFJLENBQUMsSUFBSTtRQUNQLE1BQU0sU0FBUyxHQUFHLG1CQUFtQixDQUFDLGFBQWEsQ0FBQTtRQUVuRCxJQUFJLENBQUMsU0FBUztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQTtRQUUxRCxNQUFNLEtBQUssR0FBRyxJQUFJLFNBQVMsQ0FBQyxFQUFDLElBQUksRUFBQyxDQUFDLENBQUE7UUFFbkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDekIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsU0FBUyxDQUFDLElBQUksRUFBRSxRQUFRO1FBQ3RCLE1BQU0sYUFBYSxHQUFHLG1CQUFtQixDQUFDLGlCQUFpQixDQUFBO1FBRTNELElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO1FBRWxFLE1BQU0sS0FBSyxHQUFHLElBQUksYUFBYSxDQUFDLEVBQUMsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUV2QyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUV2QixJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ2IsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ2pCLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VSb3V0ZSBmcm9tIFwiLi9iYXNlLXJvdXRlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQmFzaWNSb3V0ZSBleHRlbmRzIEJhc2VSb3V0ZSB7XG4gIC8qKlxuICAgKiBSdW5zIGdldC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBSb3V0ZSBuYW1lLlxuICAgKi9cbiAgZ2V0KG5hbWUpIHtcbiAgICBjb25zdCBHZXRSb3V0ZSA9IFZlbG9jaW91c0Jhc2ljUm91dGUuR2V0Um91dGVUeXBlXG4gICAgY29uc3Qgcm91dGUgPSBuZXcgR2V0Um91dGUoe25hbWV9KVxuXG4gICAgdGhpcy5yb3V0ZXMucHVzaChyb3V0ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoIHdpdGggcGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucGFyYW1zIC0gUGFyYW1ldGVycyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnBhdGggLSBQYXRoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gYXJncy5yZXF1ZXN0IC0gUmVxdWVzdCBvYmplY3QuXG4gICAqIEByZXR1cm5zIHt7cmVzdFBhdGg6IHN0cmluZ30gfCB1bmRlZmluZWR9IC0gUkVTVCBwYXRoIG1ldGFkYXRhIGZvciB0aGlzIHJvdXRlLlxuICAgKi9cbiAgbWF0Y2hXaXRoUGF0aCh7cGFyYW1zLCBwYXRoLCByZXF1ZXN0fSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyAnbWF0Y2hXaXRoUGF0aCcgaW1wbGVtZW50ZWQgb24gJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBNb3VudHMgYSBzdWItYXBwbGljYXRpb24gKGUuZy4gdGhlIGJhY2tncm91bmQtam9icyBkYXNoYm9hcmQgQVBJKSBhdCBhIHBhdGhcbiAgICogcHJlZml4LCBzaW1pbGFyIHRvIG1vdW50aW5nIFNpZGVraXE6OldlYiBpbiBhIFJhaWxzIHJvdXRlcyBmaWxlLiBUaGVcbiAgICogbW91bnRhYmxlJ3MgYG1vdW50SW50byh7Y29uZmlndXJhdGlvbiwgLi4ub3B0aW9uc30pYCBpcyBpbnZva2VkIHdoZW4gdGhlXG4gICAqIGNvbmZpZ3VyYXRpb24gcmVjZWl2ZXMgdGhlIHJvdXRlcy5cbiAgICogQHBhcmFtIHt7bW91bnRJbnRvOiAoYXJnczogb2JqZWN0KSA9PiB2b2lkfX0gbW91bnRhYmxlIC0gTW91bnRhYmxlIHdpdGggYSBzdGF0aWMgYG1vdW50SW50b2AgbWV0aG9kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gTW91bnQgb3B0aW9ucy4gTXVzdCBpbmNsdWRlIGFuIGBhdGAgcGF0aCBwcmVmaXggc3RhcnRpbmcgd2l0aCBcIi9cIi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbW91bnQobW91bnRhYmxlLCBvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIW1vdW50YWJsZSB8fCB0eXBlb2YgbW91bnRhYmxlLm1vdW50SW50byAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJtb3VudCBleHBlY3RzIGEgbW91bnRhYmxlIHdpdGggYSAnbW91bnRJbnRvJyBtZXRob2RcIilcbiAgICB9XG5cbiAgICBjb25zdCBhdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob3B0aW9ucykuYXRcblxuICAgIGlmICh0eXBlb2YgYXQgIT09IFwic3RyaW5nXCIgfHwgIWF0LnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYG1vdW50IHJlcXVpcmVzIGFuICdhdCcgb3B0aW9uIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKGF0KX1gKVxuICAgIH1cblxuICAgIHRoaXMubW91bnRzLnB1c2goe21vdW50YWJsZSwgb3B0aW9uc30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuYW1lc3BhY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHsoYXJnOiBpbXBvcnQoXCIuL25hbWVzcGFjZS1yb3V0ZS5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBuYW1lc3BhY2UobmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBOYW1lc3BhY2VSb3V0ZSA9IFZlbG9jaW91c0Jhc2ljUm91dGUuTmFtZVNwYWNlUm91dGVUeXBlXG5cbiAgICBpZiAoIU5hbWVzcGFjZVJvdXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBOYW1lc3BhY2VSb3V0ZSByZWdpc3RlcmVkXCIpXG5cbiAgICBjb25zdCByb3V0ZSA9IG5ldyBOYW1lc3BhY2VSb3V0ZSh7bmFtZX0pXG5cbiAgICB0aGlzLnJvdXRlcy5wdXNoKHJvdXRlKVxuXG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayhyb3V0ZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwb3N0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHBvc3QobmFtZSkge1xuICAgIGNvbnN0IFBvc3RSb3V0ZSA9IFZlbG9jaW91c0Jhc2ljUm91dGUuUG9zdFJvdXRlVHlwZVxuXG4gICAgaWYgKCFQb3N0Um91dGUpIHRocm93IG5ldyBFcnJvcihcIk5vIFBvc3RSb3V0ZSByZWdpc3RlcmVkXCIpXG5cbiAgICBjb25zdCByb3V0ZSA9IG5ldyBQb3N0Um91dGUoe25hbWV9KVxuXG4gICAgdGhpcy5yb3V0ZXMucHVzaChyb3V0ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0geyhhcmc6IGltcG9ydChcIi4vcmVzb3VyY2Utcm91dGUuanNcIikuZGVmYXVsdCkgPT4gdm9pZH0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZXNvdXJjZXMobmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBSZXNvdXJjZVJvdXRlID0gVmVsb2Npb3VzQmFzaWNSb3V0ZS5SZXNvdXJjZVJvdXRlVHlwZVxuXG4gICAgaWYgKCFSZXNvdXJjZVJvdXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBSZXNvdXJjZVJvdXRlIHJlZ2lzdGVyZWRcIilcblxuICAgIGNvbnN0IHJvdXRlID0gbmV3IFJlc291cmNlUm91dGUoe25hbWV9KVxuXG4gICAgdGhpcy5yb3V0ZXMucHVzaChyb3V0ZSlcblxuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgY2FsbGJhY2socm91dGUpXG4gICAgfVxuICB9XG59XG5cbiJdfQ==
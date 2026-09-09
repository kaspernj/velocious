// @ts-check
import GetRoute from "./get-route.js"; // eslint-disable-line no-unused-vars
import NameSpaceRoute from "./namespace-route.js"; // eslint-disable-line no-unused-vars
import PostRoute from "./post-route.js"; // eslint-disable-line no-unused-vars
import RootRoute from "./root-route.js";
import ResourceRoute from "./resource-route.js"; // eslint-disable-line no-unused-vars
export default class VelociousRoutes {
    rootRoute = new RootRoute();
    /**
     * Runs draw.
     * @param {(arg: import("./root-route.js").default) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    draw(callback) {
        callback(this.rootRoute);
    }
    /**
     * Collects all `route.mount(...)` registrations across the route tree so the
     * configuration can apply them when the routes are set.
     * @returns {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ReturnType<typeof JSON.parse>>}>} - Declared mounts.
     */
    getMounts() {
        /**
         * Collected.
         * @type {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ReturnType<typeof JSON.parse>>}>} */
        const collected = [];
        /**
         * Visit.
         * @param {import("./base-route.js").default} route - Route to visit.
         */
        const visit = (route) => {
            if (typeof route.getMounts === "function") {
                collected.push(...route.getMounts());
            }
            for (const subRoute of route.getSubRoutes()) {
                visit(subRoute);
            }
        };
        visit(this.rootRoute);
        return collected;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvcm91dGVzL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFFBQVEsTUFBTSxnQkFBZ0IsQ0FBQSxDQUFDLHFDQUFxQztBQUMzRSxPQUFPLGNBQWMsTUFBTSxzQkFBc0IsQ0FBQSxDQUFDLHFDQUFxQztBQUN2RixPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQSxDQUFDLHFDQUFxQztBQUM3RSxPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUN2QyxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQSxDQUFDLHFDQUFxQztBQUVyRixNQUFNLENBQUMsT0FBTyxPQUFPLGVBQWU7SUFDbEMsU0FBUyxHQUFHLElBQUksU0FBUyxFQUFFLENBQUE7SUFFM0I7Ozs7T0FJRztJQUNILElBQUksQ0FBQyxRQUFRO1FBQ1gsUUFBUSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFNBQVM7UUFDUDs7cUlBRTZIO1FBQzdILE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQjs7O1dBR0c7UUFDSCxNQUFNLEtBQUssR0FBRyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQ3RCLElBQUksT0FBTyxLQUFLLENBQUMsU0FBUyxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUMxQyxTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUE7WUFDdEMsQ0FBQztZQUVELEtBQUssTUFBTSxRQUFRLElBQUksS0FBSyxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUM7Z0JBQzVDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNqQixDQUFDO1FBQ0gsQ0FBQyxDQUFBO1FBRUQsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUVyQixPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEdldFJvdXRlIGZyb20gXCIuL2dldC1yb3V0ZS5qc1wiIC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbmltcG9ydCBOYW1lU3BhY2VSb3V0ZSBmcm9tIFwiLi9uYW1lc3BhY2Utcm91dGUuanNcIiAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5pbXBvcnQgUG9zdFJvdXRlIGZyb20gXCIuL3Bvc3Qtcm91dGUuanNcIiAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5pbXBvcnQgUm9vdFJvdXRlIGZyb20gXCIuL3Jvb3Qtcm91dGUuanNcIlxuaW1wb3J0IFJlc291cmNlUm91dGUgZnJvbSBcIi4vcmVzb3VyY2Utcm91dGUuanNcIiAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c1JvdXRlcyB7XG4gIHJvb3RSb3V0ZSA9IG5ldyBSb290Um91dGUoKVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyYXcuXG4gICAqIEBwYXJhbSB7KGFyZzogaW1wb3J0KFwiLi9yb290LXJvdXRlLmpzXCIpLmRlZmF1bHQpID0+IHZvaWR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGRyYXcoY2FsbGJhY2spIHtcbiAgICBjYWxsYmFjayh0aGlzLnJvb3RSb3V0ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsZWN0cyBhbGwgYHJvdXRlLm1vdW50KC4uLilgIHJlZ2lzdHJhdGlvbnMgYWNyb3NzIHRoZSByb3V0ZSB0cmVlIHNvIHRoZVxuICAgKiBjb25maWd1cmF0aW9uIGNhbiBhcHBseSB0aGVtIHdoZW4gdGhlIHJvdXRlcyBhcmUgc2V0LlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e21vdW50YWJsZToge21vdW50SW50bzogKGFyZ3M6IG9iamVjdCkgPT4gdm9pZH0sIG9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAtIERlY2xhcmVkIG1vdW50cy5cbiAgICovXG4gIGdldE1vdW50cygpIHtcbiAgICAvKipcbiAgICAgKiBDb2xsZWN0ZWQuXG4gICAgICogQHR5cGUge0FycmF5PHttb3VudGFibGU6IHttb3VudEludG86IChhcmdzOiBvYmplY3QpID0+IHZvaWR9LCBvcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgICBjb25zdCBjb2xsZWN0ZWQgPSBbXVxuXG4gICAgLyoqXG4gICAgICogVmlzaXQuXG4gICAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2Utcm91dGUuanNcIikuZGVmYXVsdH0gcm91dGUgLSBSb3V0ZSB0byB2aXNpdC5cbiAgICAgKi9cbiAgICBjb25zdCB2aXNpdCA9IChyb3V0ZSkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByb3V0ZS5nZXRNb3VudHMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb2xsZWN0ZWQucHVzaCguLi5yb3V0ZS5nZXRNb3VudHMoKSlcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBzdWJSb3V0ZSBvZiByb3V0ZS5nZXRTdWJSb3V0ZXMoKSkge1xuICAgICAgICB2aXNpdChzdWJSb3V0ZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2aXNpdCh0aGlzLnJvb3RSb3V0ZSlcblxuICAgIHJldHVybiBjb2xsZWN0ZWRcbiAgfVxufVxuIl19
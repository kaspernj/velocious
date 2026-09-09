import * as inflection from "inflection";
import Application from "../../../../application.js";
import BaseCommand from "../../../../cli/base-command.js";
export default class VelociousCliCommandsServer extends BaseCommand {
    output = "";
    /**
     * Runs normalize action name.
     * @param {string} actionName - Raw route action name.
     * @returns {string} - Normalized method name.
     */
    normalizeActionName(actionName) {
        return inflection.camelize(actionName.replaceAll("-", "_").replaceAll("/", "_"), true);
    }
    async execute() {
        const application = new Application({
            configuration: this.getConfiguration(),
            type: "server"
        });
        await application.initialize();
        const routes = this.getConfiguration().getRoutes();
        if (!routes?.rootRoute)
            throw new Error("Routes have not been initialized");
        this.printRoutes(routes.rootRoute);
        return { output: this.output };
    }
    /**
     * Runs print routes.
     * @param {import("../../../../routes/base-route.js").default} route - Route.
     * @param {number} [level] - Level.
     * @returns {void} - No return value.
     */
    printRoutes(route, level = 0) {
        const prefix = "  ".repeat(level);
        for (const routeData of route.getHumanPaths()) {
            this.log(`${prefix}${routeData.method} ${routeData.path}${routeData.action ? ` -> ${this.normalizeActionName(routeData.action)}` : ""}`);
        }
        for (const subRoute of route.getSubRoutes()) {
            this.printRoutes(subRoute, level + 1);
        }
    }
    /**
     * Runs log.
     * @param {string} content - Content.
     * @returns {void} - No return value.
     */
    log(content) {
        if (this.cli.getTesting()) {
            this.output += `${content}\n`;
        }
        else {
            console.log(content);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL3JvdXRlcy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUV4QyxPQUFPLFdBQVcsTUFBTSw0QkFBNEIsQ0FBQTtBQUNwRCxPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV6RCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEyQixTQUFRLFdBQVc7SUFDakUsTUFBTSxHQUFHLEVBQUUsQ0FBQTtJQUVYOzs7O09BSUc7SUFDSCxtQkFBbUIsQ0FBQyxVQUFVO1FBQzVCLE9BQU8sVUFBVSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFBO0lBQ3hGLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sV0FBVyxHQUFHLElBQUksV0FBVyxDQUFDO1lBQ2xDLGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7WUFDdEMsSUFBSSxFQUFFLFFBQVE7U0FDZixDQUFDLENBQUE7UUFDRixNQUFNLFdBQVcsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUM5QixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUVsRCxJQUFJLENBQUMsTUFBTSxFQUFFLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGtDQUFrQyxDQUFDLENBQUE7UUFFM0UsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFbEMsT0FBTyxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFDLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsV0FBVyxDQUFDLEtBQUssRUFBRSxLQUFLLEdBQUcsQ0FBQztRQUMxQixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRWpDLEtBQUssTUFBTSxTQUFTLElBQUksS0FBSyxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUM7WUFDOUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQU0sR0FBRyxTQUFTLENBQUMsTUFBTSxJQUFJLFNBQVMsQ0FBQyxJQUFJLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsbUJBQW1CLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFDMUksQ0FBQztRQUVELEtBQUssTUFBTSxRQUFRLElBQUksS0FBSyxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUM7WUFDNUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFBO1FBQ3ZDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEdBQUcsQ0FBQyxPQUFPO1FBQ1QsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUM7WUFDMUIsSUFBSSxDQUFDLE1BQU0sSUFBSSxHQUFHLE9BQU8sSUFBSSxDQUFBO1FBQy9CLENBQUM7YUFBTSxDQUFDO1lBQ04sT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUN0QixDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5cbmltcG9ydCBBcHBsaWNhdGlvbiBmcm9tIFwiLi4vLi4vLi4vLi4vYXBwbGljYXRpb24uanNcIlxuaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi8uLi9jbGkvYmFzZS1jb21tYW5kLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ2xpQ29tbWFuZHNTZXJ2ZXIgZXh0ZW5kcyBCYXNlQ29tbWFuZHtcbiAgb3V0cHV0ID0gXCJcIlxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbk5hbWUgLSBSYXcgcm91dGUgYWN0aW9uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBtZXRob2QgbmFtZS5cbiAgICovXG4gIG5vcm1hbGl6ZUFjdGlvbk5hbWUoYWN0aW9uTmFtZSkge1xuICAgIHJldHVybiBpbmZsZWN0aW9uLmNhbWVsaXplKGFjdGlvbk5hbWUucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpLnJlcGxhY2VBbGwoXCIvXCIsIFwiX1wiKSwgdHJ1ZSlcbiAgfVxuXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgYXBwbGljYXRpb24gPSBuZXcgQXBwbGljYXRpb24oe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICB0eXBlOiBcInNlcnZlclwiXG4gICAgfSlcbiAgICBhd2FpdCBhcHBsaWNhdGlvbi5pbml0aWFsaXplKClcbiAgICBjb25zdCByb3V0ZXMgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRSb3V0ZXMoKVxuXG4gICAgaWYgKCFyb3V0ZXM/LnJvb3RSb3V0ZSkgdGhyb3cgbmV3IEVycm9yKFwiUm91dGVzIGhhdmUgbm90IGJlZW4gaW5pdGlhbGl6ZWRcIilcblxuICAgIHRoaXMucHJpbnRSb3V0ZXMocm91dGVzLnJvb3RSb3V0ZSlcblxuICAgIHJldHVybiB7b3V0cHV0OiB0aGlzLm91dHB1dH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW50IHJvdXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi9yb3V0ZXMvYmFzZS1yb3V0ZS5qc1wiKS5kZWZhdWx0fSByb3V0ZSAtIFJvdXRlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2xldmVsXSAtIExldmVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwcmludFJvdXRlcyhyb3V0ZSwgbGV2ZWwgPSAwKSB7XG4gICAgY29uc3QgcHJlZml4ID0gXCIgIFwiLnJlcGVhdChsZXZlbClcblxuICAgIGZvciAoY29uc3Qgcm91dGVEYXRhIG9mIHJvdXRlLmdldEh1bWFuUGF0aHMoKSkge1xuICAgICAgdGhpcy5sb2coYCR7cHJlZml4fSR7cm91dGVEYXRhLm1ldGhvZH0gJHtyb3V0ZURhdGEucGF0aH0ke3JvdXRlRGF0YS5hY3Rpb24gPyBgIC0+ICR7dGhpcy5ub3JtYWxpemVBY3Rpb25OYW1lKHJvdXRlRGF0YS5hY3Rpb24pfWAgOiBcIlwifWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWJSb3V0ZSBvZiByb3V0ZS5nZXRTdWJSb3V0ZXMoKSkge1xuICAgICAgdGhpcy5wcmludFJvdXRlcyhzdWJSb3V0ZSwgbGV2ZWwgKyAxKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnRlbnQgLSBDb250ZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBsb2coY29udGVudCkge1xuICAgIGlmICh0aGlzLmNsaS5nZXRUZXN0aW5nKCkpIHtcbiAgICAgIHRoaXMub3V0cHV0ICs9IGAke2NvbnRlbnR9XFxuYFxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmxvZyhjb250ZW50KVxuICAgIH1cbiAgfVxufVxuIl19
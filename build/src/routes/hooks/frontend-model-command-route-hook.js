// @ts-check
import { frontendModelResourcesWithBuiltInsForBackendProject } from "../../frontend-models/built-in-resources.js";
import { frontendModelActionForCommand, frontendModelCustomCommandForPath, frontendModelResourcePath } from "../../frontend-models/resource-definition.js";
const SHARED_FRONTEND_MODEL_API_PATH = "/frontend-models";
const FRONTEND_MODEL_CONTROLLER_PATH = new URL("../../frontend-model-controller.js", import.meta.url).href;
/**
 * Runs frontend model command route hook.
 * @param {object} args - Hook args.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {string} args.currentPath - Request path without query.
 * @param {boolean} [args.hasMatchingCustomRoute] - Set when the request path matches an explicit custom route.
 * @returns {Promise<import("../../configuration-types.js").RouteResolverHookResult | null>} - Route override or null.
 */
export default async function frontendModelCommandRouteHook({ configuration, currentPath, hasMatchingCustomRoute }) {
    const normalizedCurrentPath = normalizePath(currentPath);
    if (normalizedCurrentPath === "/frontend-models/sync/bootstrap") {
        return {
            action: "frontend-sync-bootstrap",
            controller: "velocious/api",
            controllerPath: FRONTEND_MODEL_CONTROLLER_PATH
        };
    }
    if (normalizedCurrentPath === "/frontend-models/sync/replay") {
        return {
            action: "frontend-sync-replay",
            controller: "velocious/api",
            controllerPath: FRONTEND_MODEL_CONTROLLER_PATH
        };
    }
    if (["/frontend-models/sync/change-feed", "/frontend-models/sync/changes", "/sync/changes"].includes(normalizedCurrentPath)) {
        return {
            action: "frontend-sync-change-feed",
            controller: "velocious/api",
            controllerPath: FRONTEND_MODEL_CONTROLLER_PATH
        };
    }
    if (["/frontend-models/sync/snapshot", "/sync/snapshot"].includes(normalizedCurrentPath)) {
        return {
            action: "frontend-sync-snapshot",
            controller: "velocious/api",
            controllerPath: FRONTEND_MODEL_CONTROLLER_PATH
        };
    }
    if (normalizedCurrentPath === SHARED_FRONTEND_MODEL_API_PATH) {
        return {
            action: "frontend-api",
            controller: "velocious/api",
            controllerPath: FRONTEND_MODEL_CONTROLLER_PATH
        };
    }
    // Don't intercept paths that match explicitly defined custom routes
    if (hasMatchingCustomRoute)
        return null;
    const backendProjects = configuration.getBackendProjects();
    const customCommandMatch = frontendModelCustomCommandForPath({
        backendProjects,
        currentPath: normalizedCurrentPath
    });
    if (customCommandMatch) {
        /**
         * Params.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const params = {
            frontendModelCustomCommandMethodName: customCommandMatch.methodName,
            frontendModelCustomCommandScope: customCommandMatch.scope,
            model: customCommandMatch.modelName
        };
        if (customCommandMatch.memberId) {
            params.id = customCommandMatch.memberId;
        }
        return {
            action: "frontend-custom-command",
            controller: customCommandMatch.resourcePath.replace(/^\/+/, ""),
            controllerPath: FRONTEND_MODEL_CONTROLLER_PATH,
            params
        };
    }
    for (const backendProject of backendProjects) {
        const resources = frontendModelResourcesWithBuiltInsForBackendProject(backendProject);
        for (const modelName in resources) {
            const resourceDefinition = resources[modelName];
            const resourcePath = frontendModelResourcePath(modelName, resourceDefinition);
            const normalizedResourcePath = normalizePath(resourcePath);
            const expectedPrefix = `${normalizedResourcePath}/`;
            if (!normalizedCurrentPath.startsWith(expectedPrefix))
                continue;
            const commandName = normalizedCurrentPath.slice(expectedPrefix.length);
            if (commandName.includes("/"))
                continue;
            const action = frontendModelActionForCommand({ commandName, modelName, resourceDefinition });
            if (!action)
                continue;
            const controller = normalizedResourcePath.replace(/^\/+/, "");
            return {
                action: `frontend-${action}`,
                controller,
                controllerPath: FRONTEND_MODEL_CONTROLLER_PATH
            };
        }
    }
    return null;
}
/**
 * Runs normalize path.
 * @param {string} path - Path value.
 * @returns {string} - Normalized path with leading slash and no trailing slash.
 */
function normalizePath(path) {
    const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
    if (withLeadingSlash.length > 1) {
        return withLeadingSlash.replace(/\/+$/, "");
    }
    return withLeadingSlash;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWwtY29tbWFuZC1yb3V0ZS1ob29rLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3JvdXRlcy9ob29rcy9mcm9udGVuZC1tb2RlbC1jb21tYW5kLXJvdXRlLWhvb2suanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLDZDQUE2QyxDQUFBO0FBQy9HLE9BQU8sRUFBQyw2QkFBNkIsRUFBRSxpQ0FBaUMsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLDhDQUE4QyxDQUFBO0FBRXhKLE1BQU0sOEJBQThCLEdBQUcsa0JBQWtCLENBQUE7QUFDekQsTUFBTSw4QkFBOEIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxvQ0FBb0MsRUFBRSxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUE7QUFFMUc7Ozs7Ozs7R0FPRztBQUNILE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxVQUFVLDZCQUE2QixDQUFDLEVBQUMsYUFBYSxFQUFFLFdBQVcsRUFBRSxzQkFBc0IsRUFBQztJQUM5RyxNQUFNLHFCQUFxQixHQUFHLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUV4RCxJQUFJLHFCQUFxQixLQUFLLGlDQUFpQyxFQUFFLENBQUM7UUFDaEUsT0FBTztZQUNMLE1BQU0sRUFBRSx5QkFBeUI7WUFDakMsVUFBVSxFQUFFLGVBQWU7WUFDM0IsY0FBYyxFQUFFLDhCQUE4QjtTQUMvQyxDQUFBO0lBQ0gsQ0FBQztJQUVELElBQUkscUJBQXFCLEtBQUssOEJBQThCLEVBQUUsQ0FBQztRQUM3RCxPQUFPO1lBQ0wsTUFBTSxFQUFFLHNCQUFzQjtZQUM5QixVQUFVLEVBQUUsZUFBZTtZQUMzQixjQUFjLEVBQUUsOEJBQThCO1NBQy9DLENBQUE7SUFDSCxDQUFDO0lBRUQsSUFBSSxDQUFDLG1DQUFtQyxFQUFFLCtCQUErQixFQUFFLGVBQWUsQ0FBQyxD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YyxFQUFFLDhCQUE4QjthQUMvQyxDQUFBO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQTtBQUNiLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxhQUFhLENBQUMsSUFBSTtJQUN6QixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQTtJQUVqRSxJQUFJLGdCQUFnQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNoQyxPQUFPLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVELE9BQU8sZ0JBQWdCLENBQUE7QUFDekIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4uLy4uL2Zyb250ZW5kLW1vZGVscy9idWlsdC1pbi1yZXNvdXJjZXMuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsQWN0aW9uRm9yQ29tbWFuZCwgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRGb3JQYXRoLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRofSBmcm9tIFwiLi4vLi4vZnJvbnRlbmQtbW9kZWxzL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuXG5jb25zdCBTSEFSRURfRlJPTlRFTkRfTU9ERUxfQVBJX1BBVEggPSBcIi9mcm9udGVuZC1tb2RlbHNcIlxuY29uc3QgRlJPTlRFTkRfTU9ERUxfQ09OVFJPTExFUl9QQVRIID0gbmV3IFVSTChcIi4uLy4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIiwgaW1wb3J0Lm1ldGEudXJsKS5ocmVmXG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBjb21tYW5kIHJvdXRlIGhvb2suXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEhvb2sgYXJncy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY3VycmVudFBhdGggLSBSZXF1ZXN0IHBhdGggd2l0aG91dCBxdWVyeS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaGFzTWF0Y2hpbmdDdXN0b21Sb3V0ZV0gLSBTZXQgd2hlbiB0aGUgcmVxdWVzdCBwYXRoIG1hdGNoZXMgYW4gZXhwbGljaXQgY3VzdG9tIHJvdXRlLlxuICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Sb3V0ZVJlc29sdmVySG9va1Jlc3VsdCB8IG51bGw+fSAtIFJvdXRlIG92ZXJyaWRlIG9yIG51bGwuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDb21tYW5kUm91dGVIb29rKHtjb25maWd1cmF0aW9uLCBjdXJyZW50UGF0aCwgaGFzTWF0Y2hpbmdDdXN0b21Sb3V0ZX0pIHtcbiAgY29uc3Qgbm9ybWFsaXplZEN1cnJlbnRQYXRoID0gbm9ybWFsaXplUGF0aChjdXJyZW50UGF0aClcblxuICBpZiAobm9ybWFsaXplZEN1cnJlbnRQYXRoID09PSBcIi9mcm9udGVuZC1tb2RlbHMvc3luYy9ib290c3RyYXBcIikge1xuICAgIHJldHVybiB7XG4gICAgICBhY3Rpb246IFwiZnJvbnRlbmQtc3luYy1ib290c3RyYXBcIixcbiAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzL2FwaVwiLFxuICAgICAgY29udHJvbGxlclBhdGg6IEZST05URU5EX01PREVMX0NPTlRST0xMRVJfUEFUSFxuICAgIH1cbiAgfVxuXG4gIGlmIChub3JtYWxpemVkQ3VycmVudFBhdGggPT09IFwiL2Zyb250ZW5kLW1vZGVscy9zeW5jL3JlcGxheVwiKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbjogXCJmcm9udGVuZC1zeW5jLXJlcGxheVwiLFxuICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXMvYXBpXCIsXG4gICAgICBjb250cm9sbGVyUGF0aDogRlJPTlRFTkRfTU9ERUxfQ09OVFJPTExFUl9QQVRIXG4gICAgfVxuICB9XG5cbiAgaWYgKFtcIi9mcm9udGVuZC1tb2RlbHMvc3luYy9jaGFuZ2UtZmVlZFwiLCBcIi9mcm9udGVuZC1tb2RlbHMvc3luYy9jaGFuZ2VzXCIsIFwiL3N5bmMvY2hhbmdlc1wiXS5pbmNsdWRlcyhub3JtYWxpemVkQ3VycmVudFBhdGgpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbjogXCJmcm9udGVuZC1zeW5jLWNoYW5nZS1mZWVkXCIsXG4gICAgICBjb250cm9sbGVyOiBcInZlbG9jaW91cy9hcGlcIixcbiAgICAgIGNvbnRyb2xsZXJQYXRoOiBGUk9OVEVORF9NT0RFTF9DT05UUk9MTEVSX1BBVEhcbiAgICB9XG4gIH1cblxuICBpZiAoW1wiL2Zyb250ZW5kLW1vZGVscy9zeW5jL3NuYXBzaG90XCIsIFwiL3N5bmMvc25hcHNob3RcIl0uaW5jbHVkZXMobm9ybWFsaXplZEN1cnJlbnRQYXRoKSkge1xuICAgIHJldHVybiB7XG4gICAgICBhY3Rpb246IFwiZnJvbnRlbmQtc3luYy1zbmFwc2hvdFwiLFxuICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXMvYXBpXCIsXG4gICAgICBjb250cm9sbGVyUGF0aDogRlJPTlRFTkRfTU9ERUxfQ09OVFJPTExFUl9QQVRIXG4gICAgfVxuICB9XG5cbiAgaWYgKG5vcm1hbGl6ZWRDdXJyZW50UGF0aCA9PT0gU0hBUkVEX0ZST05URU5EX01PREVMX0FQSV9QQVRIKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbjogXCJmcm9udGVuZC1hcGlcIixcbiAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzL2FwaVwiLFxuICAgICAgY29udHJvbGxlclBhdGg6IEZST05URU5EX01PREVMX0NPTlRST0xMRVJfUEFUSFxuICAgIH1cbiAgfVxuXG4gIC8vIERvbid0IGludGVyY2VwdCBwYXRocyB0aGF0IG1hdGNoIGV4cGxpY2l0bHkgZGVmaW5lZCBjdXN0b20gcm91dGVzXG4gIGlmIChoYXNNYXRjaGluZ0N1c3RvbVJvdXRlKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IGJhY2tlbmRQcm9qZWN0cyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKClcbiAgY29uc3QgY3VzdG9tQ29tbWFuZE1hdGNoID0gZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRGb3JQYXRoKHtcbiAgICBiYWNrZW5kUHJvamVjdHMsXG4gICAgY3VycmVudFBhdGg6IG5vcm1hbGl6ZWRDdXJyZW50UGF0aFxuICB9KVxuXG4gIGlmIChjdXN0b21Db21tYW5kTWF0Y2gpIHtcbiAgICAvKipcbiAgICAgKiBQYXJhbXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBwYXJhbXMgPSB7XG4gICAgICBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZE1ldGhvZE5hbWU6IGN1c3RvbUNvbW1hbmRNYXRjaC5tZXRob2ROYW1lLFxuICAgICAgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRTY29wZTogY3VzdG9tQ29tbWFuZE1hdGNoLnNjb3BlLFxuICAgICAgbW9kZWw6IGN1c3RvbUNvbW1hbmRNYXRjaC5tb2RlbE5hbWVcbiAgICB9XG5cbiAgICBpZiAoY3VzdG9tQ29tbWFuZE1hdGNoLm1lbWJlcklkKSB7XG4gICAgICBwYXJhbXMuaWQgPSBjdXN0b21Db21tYW5kTWF0Y2gubWVtYmVySWRcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWN0aW9uOiBcImZyb250ZW5kLWN1c3RvbS1jb21tYW5kXCIsXG4gICAgICBjb250cm9sbGVyOiBjdXN0b21Db21tYW5kTWF0Y2gucmVzb3VyY2VQYXRoLnJlcGxhY2UoL15cXC8rLywgXCJcIiksXG4gICAgICBjb250cm9sbGVyUGF0aDogRlJPTlRFTkRfTU9ERUxfQ09OVFJPTExFUl9QQVRILFxuICAgICAgcGFyYW1zXG4gICAgfVxuICB9XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsTmFtZSBpbiByZXNvdXJjZXMpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1ttb2RlbE5hbWVdXG4gICAgICBjb25zdCByZXNvdXJjZVBhdGggPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uKVxuICAgICAgY29uc3Qgbm9ybWFsaXplZFJlc291cmNlUGF0aCA9IG5vcm1hbGl6ZVBhdGgocmVzb3VyY2VQYXRoKVxuICAgICAgY29uc3QgZXhwZWN0ZWRQcmVmaXggPSBgJHtub3JtYWxpemVkUmVzb3VyY2VQYXRofS9gXG5cbiAgICAgIGlmICghbm9ybWFsaXplZEN1cnJlbnRQYXRoLnN0YXJ0c1dpdGgoZXhwZWN0ZWRQcmVmaXgpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjb21tYW5kTmFtZSA9IG5vcm1hbGl6ZWRDdXJyZW50UGF0aC5zbGljZShleHBlY3RlZFByZWZpeC5sZW5ndGgpXG4gICAgICBpZiAoY29tbWFuZE5hbWUuaW5jbHVkZXMoXCIvXCIpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBhY3Rpb24gPSBmcm9udGVuZE1vZGVsQWN0aW9uRm9yQ29tbWFuZCh7Y29tbWFuZE5hbWUsIG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9ufSlcbiAgICAgIGlmICghYWN0aW9uKSBjb250aW51ZVxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGgucmVwbGFjZSgvXlxcLysvLCBcIlwiKVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3Rpb246IGBmcm9udGVuZC0ke2FjdGlvbn1gLFxuICAgICAgICBjb250cm9sbGVyLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogRlJPTlRFTkRfTU9ERUxfQ09OVFJPTExFUl9QQVRIXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBQYXRoIHZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIHBhdGggd2l0aCBsZWFkaW5nIHNsYXNoIGFuZCBubyB0cmFpbGluZyBzbGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUGF0aChwYXRoKSB7XG4gIGNvbnN0IHdpdGhMZWFkaW5nU2xhc2ggPSBwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpID8gcGF0aCA6IGAvJHtwYXRofWBcblxuICBpZiAod2l0aExlYWRpbmdTbGFzaC5sZW5ndGggPiAxKSB7XG4gICAgcmV0dXJuIHdpdGhMZWFkaW5nU2xhc2gucmVwbGFjZSgvXFwvKyQvLCBcIlwiKVxuICB9XG5cbiAgcmV0dXJuIHdpdGhMZWFkaW5nU2xhc2hcbn1cbiJdfQ==
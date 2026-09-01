export type FrontendModelResolvedResourceRegistration = {
    /**
     * - Effective frontend model name (modelName override or registry key).
     */
    modelName: string;
    /**
     * - Registered resource class.
     */
    resourceClass: import("../configuration-types.js").FrontendModelResourceClassType;
    /**
     * - Normalized resource configuration.
     */
    resourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
};
/**
 * Runs the frontendModelResourcesForBackendProject helper.
 * @param {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
export declare function frontendModelResourcesForBackendProject(backendProject: import("../configuration-types.js").BackendProjectConfiguration): Record<string, import("../configuration-types.js").FrontendModelResourceClassType>;
/**
 * Runs the frontendModelResourceDefinitionIsClass helper.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate resource definition.
 * @returns {value is import("../configuration-types.js").FrontendModelResourceClassType} - Whether value is a resource class.
 */
export declare function frontendModelResourceDefinitionIsClass(value: ReturnType<typeof JSON.parse>): value is import("../configuration-types.js").FrontendModelResourceClassType;
/**
 * Runs the frontendModelResourceClassFromDefinition helper.
 * @param {ReturnType<typeof JSON.parse>} resourceDefinition - Resource definition.
 * @returns {import("../configuration-types.js").FrontendModelResourceClassType | null} - Resource class when definition is class-based.
 */
export declare function frontendModelResourceClassFromDefinition(resourceDefinition: ReturnType<typeof JSON.parse>): import("../configuration-types.js").FrontendModelResourceClassType | null;
/**
 * Runs the frontendModelResourceConfigurationFromDefinition helper.
 * @param {ReturnType<typeof JSON.parse>} resourceDefinition - Resource definition.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null} - Normalized resource configuration.
 */
export declare function frontendModelResourceConfigurationFromDefinition(resourceDefinition: ReturnType<typeof JSON.parse>): import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null;
/**
 * Builds a frontend-safe sync manifest for all sync-enabled frontend-model resources.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} backendProjects - Backend projects to scan.
 * @returns {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>} - Sync metadata keyed by model name.
 */
export declare function frontendModelSyncManifestForBackendProjects(backendProjects: import("../configuration-types.js").BackendProjectConfiguration[]): Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>;
/**
 * Builds a frontend-safe API manifest for all registered frontend-model
 * resources. The manifest is deterministic (sorted model names, sorted
 * attributes, sorted commands) and includes only public-safe metadata: no
 * secrets, no server callbacks, no backend file paths.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} backendProjects - Backend projects to scan.
 * @returns {Record<string, unknown>} - Frontend-safe API manifest.
 */
export declare function frontendModelApiManifest(backendProjects: import("../configuration-types.js").BackendProjectConfiguration[]): Record<string, unknown>;
/**
 * Runs the frontendModelResourcePath helper.
 * @param {string} modelName - Model class name.
 * @param {ReturnType<typeof JSON.parse>} resourceDefinition - Resource definition.
 * @returns {string} - Normalized resource path.
 */
export declare function frontendModelResourcePath(modelName: string, resourceDefinition: ReturnType<typeof JSON.parse>): string;
/**
 * Runs the frontendModelActionForCommand helper.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command path segment.
 * @param {string} args.modelName - Model class name.
 * @param {ReturnType<typeof JSON.parse>} args.resourceDefinition - Resource definition.
 * @returns {"destroy" | "find" | "index" | "create" | "update" | "attach" | "download" | "url" | null} - Frontend action.
 */
export declare function frontendModelActionForCommand({ commandName, modelName, resourceDefinition }: {
    commandName: string;
    modelName: string;
    resourceDefinition: ReturnType<typeof JSON.parse>;
}): "destroy" | "find" | "index" | "create" | "update" | "attach" | "download" | "url" | null;
/**
 * Runs the frontendModelCustomCommandForPath helper.
 * @param {object} args - Arguments.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} args.backendProjects - Backend projects to scan.
 * @param {string} args.currentPath - Request path without query.
 * @returns {{commandName: string, memberId?: string, methodName: string, modelName: string, resourcePath: string, scope: "collection" | "member"} | null} - Matched custom command metadata.
 */
export declare function frontendModelCustomCommandForPath({ backendProjects, currentPath }: {
    backendProjects: import("../configuration-types.js").BackendProjectConfiguration[];
    currentPath: string;
}): {
    commandName: string;
    memberId?: string;
    methodName: string;
    modelName: string;
    resourcePath: string;
    scope: "collection" | "member";
} | null;
/**
 * Resolves the registered frontend-model resource class for a resource type
 * across all backend projects. A resource's effective name is its
 * `modelName` override when declared, otherwise its registry key — matching
 * {@link frontendModelSyncManifestForBackendProjects}. A registry key shadowed
 * by a `modelName` override does not resolve.
 * @param {object} args - Options.
 * @param {{getBackendProjects: () => import("../configuration-types.js").BackendProjectConfiguration[]}} args.configuration - Configuration exposing the backend projects.
 * @param {string} args.resourceType - Frontend model name to resolve.
 * @returns {FrontendModelResolvedResourceRegistration | null} Resolved registration or null when the resource type is not registered.
 */
export declare function resolveFrontendModelResourceClass({ configuration, resourceType }: {
    configuration: {
        getBackendProjects: () => import("../configuration-types.js").BackendProjectConfiguration[];
    };
    resourceType: string;
}): FrontendModelResolvedResourceRegistration | null;
//# sourceMappingURL=resource-definition.d.ts.map
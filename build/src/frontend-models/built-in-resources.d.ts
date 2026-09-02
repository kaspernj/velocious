/**
 * Returns backend project resources with framework-owned frontend models.
 * @param {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
export declare function frontendModelResourcesWithBuiltInsForBackendProject(backendProject: import("../configuration-types.js").BackendProjectConfiguration): Record<string, import("../configuration-types.js").FrontendModelResourceClassType>;
/**
 * Checks whether a resource definition is a framework-owned built-in resource.
 * @param {object} args - Arguments.
 * @param {string} args.modelName - Frontend model name.
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} args.resourceDefinition - Resource definition.
 * @returns {boolean} - Whether the resource is a framework built-in.
 */
export declare function frontendModelResourceIsBuiltIn({ modelName, resourceDefinition }: {
    modelName: string;
    resourceDefinition: import("../configuration-types.js").FrontendModelResourceClassType;
}): boolean;
//# sourceMappingURL=built-in-resources.d.ts.map
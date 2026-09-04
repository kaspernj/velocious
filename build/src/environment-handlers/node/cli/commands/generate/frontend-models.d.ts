import BaseCommand from "../../../../../cli/base-command.js";
export type FrontendAttributeConfig = {
    /**
     * - Column type.
     */
    type?: string;
    /**
     * - Column type.
     */
    columnType?: string;
    /**
     * - SQL type.
     */
    sqlType?: string;
    /**
     * - Data type.
     */
    dataType?: string;
    /**
     * - Exact JSDoc type.
     */
    jsDocType?: string;
    /**
     * - Attribute name when configured as an array entry.
     */
    name?: string;
    /**
     * - Whether null is allowed.
     */
    null?: boolean;
    /**
     * - Whether the attribute is selected by default.
     */
    selectedByDefault?: boolean;
    /**
     * - Returns column type.
     */
    getType?: () => string;
    /**
     * - Returns whether null is allowed.
     */
    getNull?: () => boolean;
};
export type FrontendModelGeneratorPermitSpec = Array<string | Record<string, FrontendModelGeneratorPermitSpec>>;
export type ResourceJsDocImportAlias = {
    /**
     * - Exported type name.
     */
    importedName: string;
    /**
     * - Import specifier from the source file.
     */
    specifier: string;
};
export type ResourceMethodReturnType = {
    /**
     * - Import aliases visible in the source file.
     */
    importAliases: Map<string, ResourceJsDocImportAlias>;
    /**
     * - Source file that declared the method.
     */
    sourceFile: string | null;
    /**
     * - JSDoc return type.
     */
    type: string;
};
export type ResourceMethodParameterType = {
    /**
     * - Import aliases visible in the source file.
     */
    importAliases: Map<string, ResourceJsDocImportAlias>;
    /**
     * - Parameter name.
     */
    name: string | null;
    /**
     * - Source file that declared the method.
     */
    sourceFile: string | null;
    /**
     * - JSDoc parameter type.
     */
    type: string;
};
/** Node CLI command that generates frontend model classes from backend project resource config. */
export default class DbGenerateFrontendModels extends BaseCommand {
    /** @type {Map<string, ResourceMethodReturnType> | null} */
    _resourceMethodReturnTypes: Map<string, ResourceMethodReturnType> | null;
    /** @type {Map<string, ResourceMethodParameterType[]> | null} */
    _resourceMethodParameterTypes: Map<string, ResourceMethodParameterType[]> | null;
    /**
     * Runs execute.
     * @returns {Promise<void>} - Resolves when files are generated.
     */
    execute(): Promise<void>;
    /**
     * Runs validate model config.
     * @param {object} args - Arguments.
     * @param {Set<string>} args.availableFrontendModelClassNames - Available frontend model class names in backend project.
     * @param {string} args.className - Model class name.
     * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {void} - No return value.
     */
    validateModelConfig({ availableFrontendModelClassNames, className, modelConfig, resourceClass }: {
        availableFrontendModelClassNames: Set<string>;
        className: string;
        modelConfig: import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
        resourceClass?: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null;
    }): void;
    /**
     * Runs resources for backend project.
     * @param {import("../../../../../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
     * @returns {Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>} - Resource definitions keyed by model class name.
     */
    resourcesForBackendProject(backendProject: import("../../../../../configuration-types.js").BackendProjectConfiguration): Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>;
    /**
     * Runs available frontend model class names.
     * @param {Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>} resources - Resource configuration keyed by model name.
     * @returns {Set<string>} - Available frontend model class names.
     */
    availableFrontendModelClassNames(resources: Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>): Set<string>;
    /**
     * Runs frontend models directory for backend project.
     * @param {{frontendModelsOutputPath?: string}} backendProject - Backend project config.
     * @returns {string} - Absolute frontend models output directory.
     */
    frontendModelsDirectoryForBackendProject(backendProject: {
        frontendModelsOutputPath?: string;
    }): string;
    /**
     * Runs import path for frontend models directory.
     * @param {string} frontendModelsDir - Frontend models output directory.
     * @returns {string} - Base class import path.
     */
    importPathForFrontendModelsDirectory(frontendModelsDir: string): string;
    /**
     * Runs build model file content.
     * @param {object} args - Method args.
     * @param {string} args.className - Model class name.
     * @param {string} args.frontendModelFilePath - Generated frontend model file path.
     * @param {string} args.importPath - Base class import path.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {Promise<string>} - Generated file content.
     */
    buildModelFileContent({ className, frontendModelFilePath, importPath, modelClass, modelConfig, resourceClass }: {
        className: string;
        frontendModelFilePath: string;
        importPath: string;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
        modelConfig: import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
        resourceClass?: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null;
    }): Promise<string>;
    /**
     * Runs build setup file content.
     * @param {Array<{className: string, fileName: string}>} generatedFiles - Generated model files.
     * @returns {string} - Setup file content with side-effect imports for model registration.
     */
    buildSetupFileContent(generatedFiles: Array<{
        className: string;
        fileName: string;
    }>): string;
    /**
     * Runs write attributes typedef.
     * @param {object} args - Arguments.
     * @param {Array<{jsDocType: string, name: string, writeJsDocType: string}>} args.attributes - Generated read attributes.
     * @param {string} args.attributesTypeName - Generated read attributes typedef name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @param {Array<{attributes: Array<{name: string, type: string}>, relationshipName: string, typeName: string}>} args.nestedWriteTypes - Nested write typedefs.
     * @param {FrontendModelGeneratorPermitSpec} args.permittedParams - Resource permitted params spec.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @param {string} args.typeName - Typedef name.
     * @returns {Promise<string>} - Generated typedef source.
     */
    writeAttributesTypedef({ attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams, resourceClass, typeName }: {
        attributes: Array<{
            jsDocType: string;
            name: string;
            writeJsDocType: string;
        }>;
        attributesTypeName: string;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
        nestedWriteTypes: Array<{
            attributes: Array<{
                name: string;
                type: string;
            }>;
            relationshipName: string;
            typeName: string;
        }>;
        permittedParams: FrontendModelGeneratorPermitSpec;
        resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined;
        typeName: string;
    }): Promise<string>;
    /**
     * Runs frontend write attribute type.
     * @param {{attribute: {jsDocType: string, name: string, writeJsDocType: string} | undefined, attributeName: string, attributesTypeName: string, resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined}} args - Arguments.
     * @returns {Promise<string>} - JSDoc type for the permitted write field.
     */
    frontendWriteAttributeType({ attribute, attributeName, attributesTypeName, resourceClass }: {
        attribute: {
            jsDocType: string;
            name: string;
            writeJsDocType: string;
        } | undefined;
        attributeName: string;
        attributesTypeName: string;
        resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined;
    }): Promise<string>;
    /**
     * Runs frontend write attribute setter parameter type.
     * @param {{attributeName: string, resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined}} args - Arguments.
     * @returns {Promise<string | null>} - Setter value parameter type when it is useful for generation.
     */
    frontendWriteAttributeSetterParameterType({ attributeName, resourceClass }: {
        attributeName: string;
        resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined;
    }): Promise<string | null>;
    /**
     * Runs is broad generated type.
     * @param {string} jsDocType - JSDoc type.
     * @returns {boolean} - Whether the type is too broad to improve generated write typing.
     */
    isBroadGeneratedType(jsDocType: string): boolean;
    /**
     * Resolves a permitted write attribute to the generated frontend attribute name.
     * @param {{attributeName: string, attributesByName: Map<string, {jsDocType: string, name: string}>, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
     * @returns {string} - Frontend attribute name used by generated accessors.
     */
    frontendWriteAttributeName({ attributeName, attributesByName, modelClass }: {
        attributeName: string;
        attributesByName: Map<string, {
            jsDocType: string;
            name: string;
        }>;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
    }): string;
    /**
     * Runs nested write types for model.
     * @param {object} args - Arguments.
     * @param {string} args.className - Frontend model class name.
     * @param {FrontendModelGeneratorPermitSpec} args.permittedParams - Combined permitted params specs.
     * @param {Array<{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} args.relationships - Generated relationships.
     * @returns {Array<{attributes: Array<{name: string, type: string}>, relationshipName: string, typeName: string}>} - Nested write typedefs.
     */
    nestedWriteTypesForModel({ className, permittedParams, relationships }: {
        className: string;
        permittedParams: FrontendModelGeneratorPermitSpec;
        relationships: Array<{
            autoload: boolean;
            relationshipName: string;
            targetClassName: string;
            targetFileName: string;
            type: "belongsTo" | "hasOne" | "hasMany";
        }>;
    }): Array<{
        attributes: Array<{
            name: string;
            type: string;
        }>;
        relationshipName: string;
        typeName: string;
    }>;
    /**
     * Runs nested write attributes for spec.
     * @param {object} args - Arguments.
     * @param {Array<string | Record<string, object>> | object | string | null | undefined} args.nestedSpec - Nested permit spec.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.targetModelClass - Target backend model class.
     * @returns {Array<{name: string, type: string}>} - Nested write attributes.
     */
    nestedWriteAttributesForSpec({ nestedSpec, targetModelClass }: {
        nestedSpec: Array<string | Record<string, object>> | object | string | null | undefined;
        targetModelClass: typeof import("../../../../../database/record/index.js").default | undefined;
    }): Array<{
        name: string;
        type: string;
    }>;
    /**
     * Runs permitted params for generator.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} resourceClass - Resource class.
     * @param {"create" | "update"} action - Write action.
     * @returns {FrontendModelGeneratorPermitSpec} - Permitted params spec.
     */
    permittedParamsForGenerator(resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null, action: "create" | "update"): FrontendModelGeneratorPermitSpec;
    /**
     * Invokes a backend resource's `permittedParams()` instance method at
     * generation time and extracts the relationship names that accept
     * nested writes (`{fooAttributes: [...]}` entries). The generator
     * emits those names into the frontend model's `resourceConfig()` so
     * the client `save()` walker knows which relationships to ship.
     *
     * Constructed with no controller/ability so resource overrides must
     * support being called without a request context.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} resourceClass - Resource class.
     * @returns {string[]} - Relationship names that accept nested writes (empty when none).
     */
    nestedRelationshipNamesForGenerator(resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null): string[];
    /**
     * Runs formatted array property.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Base indentation.
     * @param {string} args.propertyName - Object property name.
     * @param {string[]} args.values - String values.
     * @returns {string} - Formatted multiline array property.
     */
    formattedArrayProperty({ indent, propertyName, values }: {
        indent: string;
        propertyName: string;
        values: string[];
    }): string;
    /**
     * Runs formatted commands property.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Base indentation.
     * @param {string} args.propertyName - Object property name.
     * @param {Record<string, string>} args.values - Command key-values.
     * @returns {string} - Formatted multiline array property. Always emits
     *   the camelCase method-name array form (`memberCommands: ["updateAccess"]`)
     *   so the generated config matches the canonical
     *   `FrontendModelResourceConfig.{collection,member}Commands: string[]`
     *   shape. The runtime derives the command slug from the camelCase
     *   method name; consumers never need to write out
     *   `{updateAccess: "update-access"}` by hand.
     */
    formattedCommandsProperty({ indent, propertyName, values }: {
        indent: string;
        propertyName: string;
        values: Record<string, string>;
    }): string;
    /**
     * Runs formatted object property.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Base indentation.
     * @param {string} args.propertyName - Object property name.
     * @param {Record<string, string>} args.values - Object key-values.
     * @param {Record<string, string>} [args.filterDefaultValues] - Default values to omit from output.
     * @returns {string} - Formatted multiline object property.
     */
    formattedObjectProperty({ filterDefaultValues, indent, propertyName, values }: {
        indent: string;
        propertyName: string;
        values: Record<string, string>;
        filterDefaultValues?: Record<string, string>;
    }): string;
    /**
     * Runs formatted JSON property.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Base indentation.
     * @param {string} args.propertyName - Object property name.
     * @param {unknown} args.value - JSON-compatible value.
     * @returns {string} - Formatted property.
     */
    formattedJsonProperty({ indent, propertyName, value }: {
        indent: string;
        propertyName: string;
        value: unknown;
    }): string;
    /**
     * Runs formatted JSON value.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Indentation before this value.
     * @param {unknown} args.value - JSON-compatible value.
     * @returns {string} - Formatted value.
     */
    formattedJsonValue({ indent, value }: {
        indent: string;
        value: unknown;
    }): string;
    /**
     * Runs formatted object key.
     * @param {string} key - Object key.
     * @returns {string} - JavaScript object key.
     */
    formattedObjectKey(key: string): string;
    /**
     * Runs attribute definitions for model.
     * @param {object} args - Arguments.
     * @param {string} args.className - Frontend model class name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {Promise<Array<{jsDocType: string, name: string, writeJsDocType: string}>>} - Attribute definitions.
     */
    attributeDefinitionsForModel({ className, modelClass, modelConfig, resourceClass }: {
        className: string;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
        modelConfig: import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
        resourceClass?: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null;
    }): Promise<Array<{
        jsDocType: string;
        name: string;
        writeJsDocType: string;
    }>>;
    /**
     * Runs frontend attribute config for generated attribute.
     * @param {{attributeConfig: FrontendAttributeConfig, attributeName: string, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
     * @returns {FrontendAttributeConfig} - Attribute config used for generated JSDoc.
     */
    frontendAttributeConfigForGeneratedAttribute({ attributeConfig, attributeName, modelClass }: {
        attributeConfig: FrontendAttributeConfig;
        attributeName: string;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
    }): FrontendAttributeConfig;
    /**
     * Runs frontend attribute is model primary key.
     * @param {{attributeName: string, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
     * @returns {boolean} - Whether the attribute is the model primary key.
     */
    frontendAttributeIsModelPrimaryKey({ attributeName, modelClass }: {
        attributeName: string;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
    }): boolean;
    /**
     * Resolves the primary key from explicit resource config or the backend model.
     * @param {{attributeNames: Array<string>, modelClass: typeof import("../../../../../database/record/index.js").default | undefined, modelConfig: import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration}} args - Primary key resolution args.
     * @returns {string | Array<string>} - Frontend-model primary key attribute name.
     */
    frontendModelPrimaryKeyForResource({ attributeNames, modelClass, modelConfig }: {
        attributeNames: Array<string>;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
        modelConfig: import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
    }): string | Array<string>;
    /**
     * Validates an explicitly configured frontend-model primary key.
     * @param {{attributeNames: Array<string>, primaryKey: string | string[]}} args - Configured primary key args.
     * @returns {string | string[]} - Configured primary key.
     */
    validatedConfiguredPrimaryKey({ attributeNames, primaryKey }: {
        attributeNames: Array<string>;
        primaryKey: string | string[];
    }): string | string[];
    /**
     * Resolves the backend primary key to generated frontend-model attribute names.
     * @param {{attributeNames: Array<string>, modelClass: typeof import("../../../../../database/record/index.js").default}} args - Primary key resolution args.
     * @returns {string | Array<string>} - Frontend-model primary key attribute name.
     */
    frontendModelPrimaryKeyForModelClass({ attributeNames, modelClass }: {
        attributeNames: Array<string>;
        modelClass: typeof import("../../../../../database/record/index.js").default;
    }): string | Array<string>;
    /**
     * Resolves one backend primary key column to a generated frontend-model attribute name.
     * @param {{attributeNames: Array<string>, columnName: string, modelClass: typeof import("../../../../../database/record/index.js").default}} args - Primary key args.
     * @returns {string} - Frontend-model primary key attribute name.
     */
    frontendModelPrimaryKeyAttributeName({ attributeNames, columnName, modelClass }: {
        attributeNames: Array<string>;
        columnName: string;
        modelClass: typeof import("../../../../../database/record/index.js").default;
    }): string;
    /**
     * Resolves frontend attribute config from explicit metadata, resource methods, model columns, translated columns, or model accessor JSDoc.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend attribute name.
     * @param {string} args.className - Frontend model class name.
     * @param {FrontendAttributeConfig | null} args.configuredAttributeConfig - Resource-provided attribute config.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @returns {Promise<FrontendAttributeConfig>} - Resolved frontend attribute config.
     */
    resolvedFrontendAttributeConfig({ attributeName, className, configuredAttributeConfig, modelClass, resourceClass }: {
        attributeName: string;
        className: string;
        configuredAttributeConfig: FrontendAttributeConfig | null;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
        resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined;
    }): Promise<FrontendAttributeConfig>;
    /**
     * Runs frontend attribute config has type.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute config.
     * @returns {boolean} - Whether the config declares a type source.
     */
    frontendAttributeConfigHasType(attributeConfig: FrontendAttributeConfig | null | undefined): boolean;
    /**
     * Runs frontend attribute config has nullability.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute config.
     * @returns {boolean} - Whether the config declares nullability.
     */
    frontendAttributeConfigHasNullability(attributeConfig: FrontendAttributeConfig | null | undefined): boolean;
    /**
     * Runs js doc type for frontend attribute.
     * @param {object} args - Arguments.
     * @param {FrontendAttributeConfig | null | undefined} args.attributeConfig - Attribute configuration value.
     * @returns {string} - JSDoc type.
     */
    jsDocTypeForFrontendAttribute({ attributeConfig }: {
        attributeConfig: FrontendAttributeConfig | null | undefined;
    }): string;
    /**
     * Runs js doc type for frontend write attribute.
     * @param {object} args - Arguments.
     * @param {FrontendAttributeConfig | null | undefined} args.attributeConfig - Attribute configuration value.
     * @returns {string} - JSDoc type accepted by create/update payloads.
     */
    jsDocTypeForFrontendWriteAttribute({ attributeConfig }: {
        attributeConfig: FrontendAttributeConfig | null | undefined;
    }): string;
    /**
     * Runs js doc type for frontend write attribute base type.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {string} - Non-nullable JSDoc type accepted by create/update payloads.
     */
    jsDocTypeForFrontendWriteAttributeBaseType(attributeConfig: FrontendAttributeConfig | null | undefined): string;
    /**
     * Runs js doc type for frontend attribute base type.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {string} - Non-nullable JSDoc type.
     */
    jsDocTypeForFrontendAttributeBaseType(attributeConfig: FrontendAttributeConfig | null | undefined): string;
    /**
     * Runs frontend attribute type is temporal.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {boolean} - Whether the attribute represents a date/time value.
     */
    frontendAttributeTypeIsTemporal(attributeConfig: FrontendAttributeConfig | null | undefined): boolean;
    /**
     * Runs frontend attribute can be null.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {boolean} - Whether the attribute allows null values.
     */
    frontendAttributeCanBeNull(attributeConfig: FrontendAttributeConfig | null | undefined): boolean;
    /**
     * Runs frontend attribute type value.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {string | null} - Normalized column type.
     */
    frontendAttributeTypeValue(attributeConfig: FrontendAttributeConfig | null | undefined): string | null;
    /**
     * Runs frontend attribute config for resource attribute.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @returns {Promise<FrontendAttributeConfig | null>} - Attribute config inferred from resource method JSDoc.
     */
    frontendAttributeConfigForResourceAttribute({ attributeName, resourceClass }: {
        attributeName: string;
        resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined;
    }): Promise<FrontendAttributeConfig | null>;
    /**
     * Runs frontend attribute config for translated attribute.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @returns {FrontendAttributeConfig | null} - Attribute config inferred from translated attribute columns.
     */
    frontendAttributeConfigForTranslatedAttribute({ attributeName, modelClass, resourceClass }: {
        attributeName: string;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
        resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined;
    }): FrontendAttributeConfig | null;
    /**
     * Runs frontend attribute is translated.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Backend model class.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @returns {boolean} - Whether the frontend attribute is translated.
     */
    frontendAttributeIsTranslated({ attributeName, modelClass, resourceClass }: {
        attributeName: string;
        modelClass: typeof import("../../../../../database/record/index.js").default;
        resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined;
    }): boolean;
    /**
     * Runs frontend attribute config for model accessor.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @returns {Promise<FrontendAttributeConfig | null>} - Attribute config inferred from model accessor JSDoc.
     */
    frontendAttributeConfigForModelAccessor({ attributeName, modelClass }: {
        attributeName: string;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
    }): Promise<FrontendAttributeConfig | null>;
    /**
     * A backend accessor's `@returns` can reference types that exist only on the
     * backend (e.g. a model-local `@typedef AgentRunPlanningArtifact`). The frontend
     * model can't resolve those, so fall back to `any` rather than emitting an
     * undefined type name. Types built only from primitives and known generic
     * builtins pass through unchanged.
     * @param {string} jsDocType - Resolved (Promise-unwrapped) attribute type.
     * @returns {string} - A frontend-resolvable attribute type.
     */
    frontendResolvableAttributeJsDocType(jsDocType: string): string;
    /**
     * Capitalized identifiers a generated frontend model can resolve on its own
     * (primitives are lower-case and matched separately), so only framework-owned
     * and builtin generic types are listed.
     * @returns {Set<string>} - Frontend-resolvable type identifiers.
     */
    frontendResolvableTypeIdentifiers(): Set<string>;
    /**
     * Rewrites a custom-command param/return JSDoc type so it resolves in the generated
     * frontend model: backend model imports are mapped to generated frontend model
     * imports, and otherwise non-frontend-resolvable identifiers become `any` in place
     * so sibling scalar fields keep their real types. The word boundary avoids matching
     * the capitalized middle of a camelCase property name (e.g. `adjustedTotalCents`).
     * @param {object} args - Arguments.
     * @param {string | null} args.frontendModelFilePath - Generated frontend model file path.
     * @param {Map<string, ResourceJsDocImportAlias>} args.importAliases - Import aliases visible to the source method.
     * @param {string} args.jsDocType - Resolved (Promise-unwrapped) JSDoc type.
     * @param {string | null} args.sourceFile - Source file that declared the method.
     * @returns {string} - A frontend-resolvable JSDoc type.
     */
    frontendResolvableCommandJsDocType({ frontendModelFilePath, importAliases, jsDocType, sourceFile }: {
        frontendModelFilePath: string | null;
        importAliases: Map<string, ResourceJsDocImportAlias>;
        jsDocType: string;
        sourceFile: string | null;
    }): string;
    /**
     * Raises when a command JSDoc type references a backend-local helper expression.
     * @param {string} jsDocType - Command JSDoc type.
     * @returns {void} No return value.
     */
    assertNoBackendLocalCommandTypeExpressions(jsDocType: string): void;
    /**
     * Runs frontend resolvable js doc import specifier.
     * @param {object} args - Arguments.
     * @param {string | null} args.frontendModelFilePath - Generated frontend model file path.
     * @param {string | null} args.sourceFile - Source file that declared the JSDoc type.
     * @param {string} args.specifier - Source-file import specifier.
     * @returns {string | null} - Rewritten frontend-model import specifier, or null when backend-local.
     */
    frontendResolvableJsDocImportSpecifier({ frontendModelFilePath, sourceFile, specifier }: {
        frontendModelFilePath: string | null;
        sourceFile: string | null;
        specifier: string;
    }): string | null;
    /**
     * Runs frontend model import specifier for backend model path.
     * @param {object} args - Arguments.
     * @param {string} args.frontendModelFilePath - Generated frontend model file path.
     * @param {string} args.importedPath - Source-file import path resolved from JSDoc.
     * @returns {string | null} - Generated frontend-model import specifier, or null when the path is not a registered model file.
     */
    frontendModelImportSpecifierForBackendModelPath({ frontendModelFilePath, importedPath }: {
        frontendModelFilePath: string;
        importedPath: string;
    }): string | null;
    /**
     * Runs generated frontend model file names.
     * @returns {Set<string>} - Frontend model filenames that this generation run can emit.
     */
    generatedFrontendModelFileNames(): Set<string>;
    /**
     * Runs relative import specifier.
     * @param {object} args - Arguments.
     * @param {string} args.fromFile - Source file that will contain the import expression.
     * @param {string} args.toFile - File being imported.
     * @returns {string} - Relative import specifier.
     */
    relativeImportSpecifier({ fromFile, toFile }: {
        fromFile: string;
        toFile: string;
    }): string;
    /**
     * Runs file path is within any directory.
     * @param {object} args - Arguments.
     * @param {string[]} args.directories - Candidate parent directories.
     * @param {string} args.filePath - File path to test.
     * @returns {boolean} - Whether the file path is under one candidate directory.
     */
    filePathIsWithinAnyDirectory({ directories, filePath }: {
        directories: string[];
        filePath: string;
    }): boolean;
    /**
     * Escapes text for use inside a RegExp.
     * @param {string} value - Value to escape.
     * @returns {string} - RegExp-safe value.
     */
    escapeRegExp(value: string): string;
    /**
     * Builds the JSDoc param block, parameter list, payload-argument expression, and
     * return type for a custom command method. With declared `args` each becomes a
     * named, typed parameter mapped positionally into the command payload; without
     * them the method stays variadic.
     * @param {object} args - Arguments.
     * @param {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} args.commandMetadata - Per-command metadata.
     * @param {string} args.methodName - Command method name.
     * @returns {{paramDocs: string, parameters: string, payloadArguments: string, returnType: string}} - Generation pieces.
     */
    customCommandMethodSignature({ commandMetadata, methodName }: {
        commandMetadata: Record<string, {
            args: Array<{
                name: string;
                type: string;
            }>;
            returnType: string | null;
        }>;
        methodName: string;
    }): {
        paramDocs: string;
        parameters: string;
        payloadArguments: string;
        returnType: string;
    };
    /**
     * Whether a single command-args JSDoc type is known to accept an empty object `{}`:
     * a single balanced object literal whose top-level members are all optional (`name?:`)
     * or index signatures (`[k: ...]:`). Anything else returns false so the parameter stays
     * required — including a required member, a non-object-literal (a positional `number`,
     * a `Record<...>` / `Partial<...>` whose key/wrapper may still require data), and any
     * intersection/union (e.g. `{a?: x} & {b: string}`), where `{}` is not assignable.
     * @param {string} type - The arg's JSDoc type string.
     * @returns {boolean} - Whether the generated parameter can default to `{}`.
     */
    argTypeAcceptsEmptyObject(type: string): boolean;
    /**
     * Splits the inner body of an object-literal type into its top-level members,
     * respecting nested `{}` / `[]` / `<>` / `()` so field types like `string[] | null`
     * or `{a: b}` aren't split mid-type. Members are separated by `,` or `;`.
     * @param {string} inner - Object-literal body (without the outer braces).
     * @returns {string[]} - Trimmed non-empty top-level members.
     */
    splitTopLevelTypeMembers(inner: string): string[];
    /**
     * Index of the first top-level `:` in an object-literal member, ignoring colons
     * nested inside `{}` / `[]` / `<>` / `()` (e.g. an index signature `[k: string]`).
     * @param {string} member - A single object-literal member.
     * @returns {number} - The colon index, or -1 when none is found at the top level.
     */
    topLevelColonIndex(member: string): number;
    /**
     * Whether the type is a single balanced object literal — its leading `{` closes only
     * at the final character. Rejects top-level intersections/unions like `{a?: x} & {b: y}`
     * or `{a?: x} | string` whose brace depth returns to 0 before the end.
     * @param {string} type - A trimmed type string that starts with `{` and ends with `}`.
     * @returns {boolean} - Whether the braces wrap the whole type.
     */
    isSingleBalancedObjectLiteral(type: string): boolean;
    /**
     * Enriches custom-command metadata by deriving a command's typed args and return
     * type from the backend resource method's `@param`/`@returns` JSDoc when they are
     * not already declared in `resourceConfig`. Precedence: explicit `resourceConfig`
     * `{args, returnType}` wins, then the derived backend-method JSDoc, then the generic
     * default. Model-class identifiers in the derived types are downgraded to `any`
     * because the frontend receives a serialized record, not a model instance, which the
     * consumer hydrates with `Model.instantiateFromResponse(...)`.
     * @param {object} args - Arguments.
     * @param {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} args.commandMetadata - Declared per-command metadata.
     * @param {string[]} args.commandNames - Command method names to resolve.
     * @param {string} args.frontendModelFilePath - Generated frontend model file path.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @returns {Promise<Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>>} - Enriched metadata.
     */
    commandMetadataWithResourceJsDoc({ commandMetadata, commandNames, frontendModelFilePath, resourceClass }: {
        commandMetadata: Record<string, {
            args: Array<{
                name: string;
                type: string;
            }>;
            returnType: string | null;
        }>;
        commandNames: string[];
        frontendModelFilePath: string;
        resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined;
    }): Promise<Record<string, {
        args: Array<{
            name: string;
            type: string;
        }>;
        returnType: string | null;
    }>>;
    /**
     * Runs unwrapped promise js doc type.
     * @param {object} args - Arguments.
     * @param {string} args.jsDocType - JSDoc type to normalize.
     * @returns {string} - The resolved value type for serialized frontend attributes.
     */
    unwrappedPromiseJsDocType({ jsDocType }: {
        jsDocType: string;
    }): string;
    /**
     * Runs method owner class name.
     * @param {object} args - Arguments.
     * @param {string} args.methodName - Method name.
     * @param {typeof import("../../../../../database/record/index.js").default | import("../../../../../configuration-types.js").FrontendModelResourceClassType} args.targetClass - Target class.
     * @returns {string | null} - Class name that declares the method.
     */
    methodOwnerClassName({ methodName, targetClass }: {
        methodName: string;
        targetClass: typeof import("../../../../../database/record/index.js").default | import("../../../../../configuration-types.js").FrontendModelResourceClassType;
    }): string | null;
    /**
     * Runs resource method return type.
     * @param {object} args - Arguments.
     * @param {string} args.methodName - Method name.
     * @param {string} args.sourceClassName - Source class name.
     * @returns {Promise<string | null>} - JSDoc return type when documented.
     */
    resourceMethodReturnType({ methodName, sourceClassName }: {
        methodName: string;
        sourceClassName: string;
    }): Promise<string | null>;
    /**
     * Runs resource method return type definition.
     * @param {object} args - Arguments.
     * @param {string} args.methodName - Method name.
     * @param {string} args.sourceClassName - Source class name.
     * @returns {Promise<ResourceMethodReturnType | null>} - JSDoc return type definition when documented.
     */
    resourceMethodReturnTypeDefinition({ methodName, sourceClassName }: {
        methodName: string;
        sourceClassName: string;
    }): Promise<ResourceMethodReturnType | null>;
    /**
     * Runs resource method parameter type.
     * @param {{methodName: string, parameterIndex: number, sourceClassName: string}} args - Arguments.
     * @returns {Promise<string | null>} - JSDoc parameter type when documented.
     */
    resourceMethodParameterType({ methodName, parameterIndex, sourceClassName }: {
        methodName: string;
        parameterIndex: number;
        sourceClassName: string;
    }): Promise<string | null>;
    /**
     * Runs resource method parameters.
     * @param {{methodName: string, sourceClassName: string}} args - Arguments.
     * @returns {Promise<ResourceMethodParameterType[] | null>} - JSDoc parameters (name + type) when documented.
     */
    resourceMethodParameters({ methodName, sourceClassName }: {
        methodName: string;
        sourceClassName: string;
    }): Promise<ResourceMethodParameterType[] | null>;
    /**
     * Runs resource method return types.
     * @returns {Promise<Map<string, ResourceMethodReturnType>>} - Resource method return types keyed by ClassName.methodName.
     */
    resourceMethodReturnTypes(): Promise<Map<string, ResourceMethodReturnType>>;
    /**
     * Runs resource method parameter types.
     * @returns {Promise<Map<string, ResourceMethodParameterType[]>>} - Resource method parameters keyed by ClassName.methodName.
     */
    resourceMethodParameterTypes(): Promise<Map<string, ResourceMethodParameterType[]>>;
    /**
     * Runs frontend model JSDoc source files.
     * @returns {Promise<string[]>} - JavaScript source files that can define frontend-model resources and model accessors.
     */
    frontendModelJsDocSourceFiles(): Promise<string[]>;
    /**
     * Runs frontend model JSDoc source directories.
     * @returns {string[]} - Source directories to scan for generated frontend-model JSDoc.
     */
    frontendModelJsDocSourceDirectories(): string[];
    /**
     * Adds resource method return types from source.
     * @param {object} args - Arguments.
     * @param {Map<string, ResourceMethodReturnType>} args.returnTypes - Mutable return types map.
     * @param {string | null} [args.sourceFile] - Source file path.
     * @param {string} args.sourceText - Source text.
     * @returns {void}
     */
    addResourceMethodReturnTypesFromSource({ returnTypes, sourceFile, sourceText }: {
        returnTypes: Map<string, ResourceMethodReturnType>;
        sourceFile?: string | null;
        sourceText: string;
    }): void;
    /**
     * Adds resource method parameter types from source.
     * @param {{parameterTypes: Map<string, ResourceMethodParameterType[]>, sourceFile?: string | null, sourceText: string}} args - Arguments.
     * @returns {void}
     */
    addResourceMethodParameterTypesFromSource({ parameterTypes, sourceFile, sourceText }: {
        parameterTypes: Map<string, ResourceMethodParameterType[]>;
        sourceFile?: string | null;
        sourceText: string;
    }): void;
    /**
     * Runs JSDoc import aliases from source.
     * @param {string} sourceText - Source text.
     * @returns {Map<string, ResourceJsDocImportAlias>} - Import aliases keyed by local name.
     */
    jsDocImportAliasesFromSource(sourceText: string): Map<string, ResourceJsDocImportAlias>;
    /**
     * Runs js doc return type.
     * @param {string} jsDocText - JSDoc text inside comment markers.
     * @returns {string | null} - JSDoc return type when present.
     */
    jsDocReturnType(jsDocText: string): string | null;
    /**
     * Collapses a JSDoc type spanning multiple comment lines into a single line so it can
     * be emitted into an inline type-assertion cast. A multiline backend return type keeps
     * its leading continuation asterisks in the captured substring, which are invalid inside
     * an inline cast and make TypeScript read the asserted type as `undefined`.
     * @param {string} jsDocType - Raw captured JSDoc type, possibly multiline.
     * @returns {string} - Single-line JSDoc type.
     */
    normalizeJsDocType(jsDocType: string): string;
    /**
     * Runs js doc parameters.
     * @param {string} jsDocText - JSDoc text inside comment markers.
     * @returns {Array<{name: string | null, type: string}>} - JSDoc parameters (name + type) in declaration order.
     */
    jsDocParameters(jsDocText: string): Array<{
        name: string | null;
        type: string;
    }>;
    /**
     * Runs javascript files in directory.
     * @param {string} directory - Directory path.
     * @returns {Promise<string[]>} - JavaScript source file paths.
     */
    javascriptFilesInDirectory(directory: string): Promise<string[]>;
    /**
     * Finds a matching closing brace while respecting JavaScript strings and comments.
     * @param {object} args - Arguments.
     * @param {number} args.openIndex - Opening brace index.
     * @param {string} args.sourceText - Source text.
     * @returns {number | null} - Closing brace index when found.
     */
    matchingBraceIndex({ openIndex, sourceText }: {
        openIndex: number;
        sourceText: string;
    }): number | null;
    /**
     * Runs frontend attribute config for model attribute.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @returns {FrontendAttributeConfig | null} - Attribute config inferred from the backend model when available.
     */
    frontendAttributeConfigForModelAttribute({ attributeName, modelClass }: {
        attributeName: string;
        modelClass: typeof import("../../../../../database/record/index.js").default | undefined;
    }): FrontendAttributeConfig | null;
    /**
     * Runs frontend attribute config for column.
     * @param {object} args - Arguments.
     * @param {import("../../../../../database/drivers/base-column.js").default} args.column - Database column.
     * @returns {FrontendAttributeConfig} - Attribute config inferred from the database column.
     */
    frontendAttributeConfigForColumn({ column }: {
        column: import("../../../../../database/drivers/base-column.js").default;
    }): FrontendAttributeConfig;
    /**
     * Runs relationships for model.
     * @param {object} args - Arguments.
     * @param {string} args.className - Model class name.
     * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {Array<{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationships.
     */
    relationshipsForModel({ className, modelConfig, resourceClass }: {
        className: string;
        modelConfig: import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
        resourceClass?: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null;
    }): Array<{
        autoload: boolean;
        relationshipName: string;
        targetClassName: string;
        targetFileName: string;
        type: "belongsTo" | "hasOne" | "hasMany";
    }>;
    /**
     * Runs inferred relationship definition.
     * @param {object} args - Arguments.
     * @param {string} args.className - Model class name.
     * @param {string} args.relationshipName - Relationship name.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}} Inferred relationship definition.
     */
    inferredRelationshipDefinition({ className, relationshipName, resourceClass }: {
        className: string;
        relationshipName: string;
        resourceClass?: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null;
    }): {
        autoload: boolean;
        relationshipName: string;
        targetClassName: string;
        targetFileName: string;
        type: "belongsTo" | "hasOne" | "hasMany";
    };
}
//# sourceMappingURL=frontend-models.d.ts.map
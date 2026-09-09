import BaseCommand from "../../../../../cli/base-command.js";
import fs from "fs/promises";
import generatedFileBanner from "./generated-file-banner.js";
import path from "node:path";
import * as inflection from "inflection";
import { frontendModelResourceIsBuiltIn, frontendModelResourcesWithBuiltInsForBackendProject } from "../../../../../frontend-models/built-in-resources.js";
import { frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition } from "../../../../../frontend-models/resource-definition.js";
import { frontendModelResourceInternalConstructor } from "../../../../../frontend-model-resource/base-resource.js";
/**
 * Attribute metadata used for generated frontend-model JSDoc.
 * @typedef {object} FrontendAttributeConfig
 * @property {string} [type] - Column type.
 * @property {string} [columnType] - Column type.
 * @property {string} [sqlType] - SQL type.
 * @property {string} [dataType] - Data type.
 * @property {string} [jsDocType] - Exact JSDoc type.
 * @property {string} [name] - Attribute name when configured as an array entry.
 * @property {boolean} [null] - Whether null is allowed.
 * @property {boolean} [selectedByDefault] - Whether the attribute is selected by default.
 * @property {() => string} [getType] - Returns column type.
 * @property {() => boolean} [getNull] - Returns whether null is allowed.
 */
/**
 * Permit spec returned by frontend-model resources during generation.
 * @typedef {Array<string | Record<string, FrontendModelGeneratorPermitSpec>>} FrontendModelGeneratorPermitSpec
 */
/**
 * JSDoc import alias extracted from a backend resource source file.
 * @typedef {object} ResourceJsDocImportAlias
 * @property {string} importedName - Exported type name.
 * @property {string} specifier - Import specifier from the source file.
 */
/**
 * JSDoc return type extracted from a backend resource method.
 * @typedef {object} ResourceMethodReturnType
 * @property {Map<string, ResourceJsDocImportAlias>} importAliases - Import aliases visible in the source file.
 * @property {string | null} sourceFile - Source file that declared the method.
 * @property {string} type - JSDoc return type.
 */
/**
 * JSDoc parameter type extracted from a backend resource method.
 * @typedef {object} ResourceMethodParameterType
 * @property {Map<string, ResourceJsDocImportAlias>} importAliases - Import aliases visible in the source file.
 * @property {string | null} name - Parameter name.
 * @property {string | null} sourceFile - Source file that declared the method.
 * @property {string} type - JSDoc parameter type.
 */
const FRONTEND_MODELS_REGENERATE_COMMAND = "velocious generate:frontend-models";
/** Node CLI command that generates frontend model classes from backend project resource config. */
export default class DbGenerateFrontendModels extends BaseCommand {
    /** @type {Map<string, ResourceMethodReturnType> | null} */
    _resourceMethodReturnTypes = null;
    /** @type {Map<string, ResourceMethodParameterType[]> | null} */
    _resourceMethodParameterTypes = null;
    /**
     * Runs execute.
     * @returns {Promise<void>} - Resolves when files are generated.
     */
    async execute() {
        const configuration = this.getConfiguration();
        const backendProjects = configuration.getBackendProjects();
        await configuration.initializeModels();
        const environmentHandler = configuration.getEnvironmentHandler();
        if (typeof environmentHandler.autoDiscoverResources === "function") {
            await environmentHandler.autoDiscoverResources(configuration);
        }
        if (!Array.isArray(backendProjects) || backendProjects.length === 0) {
            throw new Error("No backend projects configured. Configure 'backendProjects' in your configuration first");
        }
        /**
         * Ensured directories.
         * @type {Set<string>} */
        const ensuredDirectories = new Set();
        /**
         * Generated model names by directory.
         * @type {Map<string, Set<string>>} */
        const generatedModelNamesByDirectory = new Map();
        /**
         * Generated files by directory.
         * @type {Map<string, Array<{className: string, fileName: string}>>} */
        const generatedFilesByDirectory = new Map();
        for (const backendProject of backendProjects) {
            // Canonicalize the output directory so equivalent spellings (a trailing
            // slash, `.`/`..` segments, duplicate separators, relative vs absolute)
            // resolve to a single key. Otherwise the per-directory maps below treat
            // them as different directories, duplicate class names slip past detection,
            // and the split buckets write incomplete index.js/setup.js for files that
            // actually land in the same directory on disk.
            const frontendModelsDir = path.resolve(this.frontendModelsDirectoryForBackendProject(backendProject));
            const importPath = this.importPathForFrontendModelsDirectory(frontendModelsDir);
            if (!ensuredDirectories.has(frontendModelsDir)) {
                await fs.mkdir(frontendModelsDir, { recursive: true });
                ensuredDirectories.add(frontendModelsDir);
            }
            if (!generatedFilesByDirectory.has(frontendModelsDir)) {
                generatedFilesByDirectory.set(frontendModelsDir, []);
            }
            if (!generatedModelNamesByDirectory.has(frontendModelsDir)) {
                generatedModelNamesByDirectory.set(frontendModelsDir, new Set());
            }
            const generatedFiles = generatedFilesByDirectory.get(frontendModelsDir);
            const generatedModelNames = generatedModelNamesByDirectory.get(frontendModelsDir);
            if (!generatedFiles)
                throw new Error(`Generated files list missing for ${frontendModelsDir}`);
            if (!generatedModelNames)
                throw new Error(`Generated model names set missing for ${frontendModelsDir}`);
            const resources = this.resourcesForBackendProject(backendProject);
            const availableFrontendModelClassNames = this.availableFrontendModelClassNames(resources);
            for (const modelClassName in resources) {
                const modelConfig = frontendModelResourceConfigurationFromDefinition(resources[modelClassName]);
                const className = inflection.camelize(modelClassName.replaceAll("-", "_"));
                const fileName = `${inflection.dasherize(inflection.underscore(className))}.js`;
                const filePath = `${frontendModelsDir}/${fileName}`;
                if (!modelConfig) {
                    throw new Error(`Invalid frontend model resource definition for '${className}'`);
                }
                const resolvedResourceClass = frontendModelResourceClassFromDefinition(resources[modelClassName]);
                // An abstract base resource (no static ModelClass — e.g. an app's shared
                // `BaseResource` that other resources extend) can't back a generated
                // frontend model. Treat it as resource-less so the generator falls back
                // to by-name model lookup + empty write params instead of throwing when
                // it eagerly calls `modelClass()` / `permittedParams()` on it.
                const resourceClass = resolvedResourceClass && resolvedResourceClass.ModelClass ? resolvedResourceClass : null;
                this.validateModelConfig({ availableFrontendModelClassNames, className, modelConfig, resourceClass });
                if (generatedModelNames.has(className)) {
                    if (frontendModelResourceIsBuiltIn({ modelName: modelClassName, resourceDefinition: resources[modelClassName] })) {
                        continue;
                    }
                    throw new Error(`Duplicate frontend model definition for '${className}'`);
                }
                generatedModelNames.add(className);
                const fileContent = await this.buildModelFileContent({
                    className,
                    frontendModelFilePath: filePath,
                    importPath,
                    modelClass: resourceClass ? resourceClass.modelClass() : configuration.getModelClasses()[className],
                    modelConfig,
                    resourceClass
                });
                await fs.writeFile(filePath, fileContent);
                generatedFiles.push({ className, fileName });
                console.log(`create src/frontend-models/${fileName}`);
            }
        }
        for (const [frontendModelsDir, generatedFiles] of generatedFilesByDirectory) {
            // The index.js barrel is no longer generated — nothing imports it (models are
            // imported by file path, and setup.js performs the registration side-effects).
            // Remove any stale one left from an older generator.
            await fs.rm(`${frontendModelsDir}/index.js`, { force: true });
            const setupContent = this.buildSetupFileContent(generatedFiles);
            await fs.writeFile(`${frontendModelsDir}/setup.js`, setupContent);
            console.log("create src/frontend-models/setup.js");
        }
    }
    /**
     * Runs validate model config.
     * @param {object} args - Arguments.
     * @param {Set<string>} args.availableFrontendModelClassNames - Available frontend model class names in backend project.
     * @param {string} args.className - Model class name.
     * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {void} - No return value.
     */
    validateModelConfig({ availableFrontendModelClassNames, className, modelConfig, resourceClass }) {
        const abilities = modelConfig.abilities;
        if (!abilities || typeof abilities !== "object") {
            throw new Error(`Model '${className}' is missing required 'abilities' config`);
        }
        const readActions = [
            { action: "index", abilityAction: abilities.index },
            { action: "find", abilityAction: abilities.find }
        ];
        for (const { action, abilityAction } of readActions) {
            if (typeof abilityAction !== "string" || abilityAction.length < 1) {
                throw new Error(`Model '${className}' is missing required abilities.${action} config`);
            }
        }
        const relationships = modelConfig.relationships;
        if (relationships === undefined)
            return;
        const normalizedRelationships = this.relationshipsForModel({ className, modelConfig, resourceClass });
        for (const relationship of normalizedRelationships) {
            if (!availableFrontendModelClassNames.has(relationship.targetClassName)) {
                throw new Error(`Model '${className}' relationship '${relationship.relationshipName}' references '${relationship.targetClassName}', but no frontend model resource exists for that target in this backend project`);
            }
        }
    }
    /**
     * Runs resources for backend project.
     * @param {import("../../../../../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
     * @returns {Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>} - Resource definitions keyed by model class name.
     */
    resourcesForBackendProject(backendProject) {
        return frontendModelResourcesWithBuiltInsForBackendProject(backendProject);
    }
    /**
     * Runs available frontend model class names.
     * @param {Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>} resources - Resource configuration keyed by model name.
     * @returns {Set<string>} - Available frontend model class names.
     */
    availableFrontendModelClassNames(resources) {
        /**
         * Class names.
         * @type {Set<string>} */
        const classNames = new Set();
        for (const resourceModelName in resources) {
            classNames.add(inflection.camelize(resourceModelName.replaceAll("-", "_")));
        }
        return classNames;
    }
    /**
     * Runs frontend models directory for backend project.
     * @param {{frontendModelsOutputPath?: string}} backendProject - Backend project config.
     * @returns {string} - Absolute frontend models output directory.
     */
    frontendModelsDirectoryForBackendProject(backendProject) {
        const outputPath = backendProject.frontendModelsOutputPath || this.directory();
        return `${outputPath}/src/frontend-models`;
    }
    /**
     * Runs import path for frontend models directory.
     * @param {string} frontendModelsDir - Frontend models output directory.
     * @returns {string} - Base class import path.
     */
    importPathForFrontendModelsDirectory(frontendModelsDir) {
        const devMode = frontendModelsDir.includes("/spec/dummy/src/frontend-models");
        if (devMode) {
            return "../../../../src/frontend-models/base.js";
        }
        return "velocious/build/src/frontend-models/base.js";
    }
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
    async buildModelFileContent({ className, frontendModelFilePath, importPath, modelClass, modelConfig, resourceClass }) {
        const attributes = await this.attributeDefinitionsForModel({ className, modelClass, modelConfig, resourceClass });
        const relationships = this.relationshipsForModel({ className, modelConfig, resourceClass });
        const attachments = modelConfig.attachments && typeof modelConfig.attachments === "object"
            ? modelConfig.attachments
            : {};
        const attributesTypeName = `${className}Attributes`;
        const createAttributesTypeName = `${className}CreateAttributes`;
        const updateAttributesTypeName = `${className}UpdateAttributes`;
        const attributeNames = attributes.map((attribute) => attribute.name);
        const permittedCreateParams = this.permittedParamsForGenerator(resourceClass || null, "create");
        const permittedUpdateParams = this.permittedParamsForGenerator(resourceClass || null, "update");
        const nestedWriteTypes = this.nestedWriteTypesForModel({ className, permittedParams: permittedCreateParams.concat(permittedUpdateParams), relationships });
        const usesTransportValue = attributes.some((attribute) => attribute.jsDocType.includes("FrontendModelTransportValue"))
            || nestedWriteTypes.some((nestedWriteType) => nestedWriteType.attributes.some((attribute) => attribute.type.includes("FrontendModelTransportValue")));
        const builtInCollectionCommands = {
            create: modelConfig.builtInCollectionCommands.create || "create",
            index: modelConfig.builtInCollectionCommands.index || "index"
        };
        const builtInMemberCommands = {
            attach: modelConfig.builtInMemberCommands.attach || "attach",
            destroy: modelConfig.builtInMemberCommands.destroy || "destroy",
            download: modelConfig.builtInMemberCommands.download || "download",
            find: modelConfig.builtInMemberCommands.find || "find",
            update: modelConfig.builtInMemberCommands.update || "update",
            url: modelConfig.builtInMemberCommands.url || "url"
        };
        const collectionCommands = modelConfig.collectionCommands;
        const memberCommands = modelConfig.memberCommands;
        if (Object.hasOwn(collectionCommands, "onDestroy")) {
            throw new Error(`Frontend model collection command '${className}.onDestroy' collides with the generated lifecycle hook`);
        }
        const declaredCommandMetadata = modelConfig.commandMetadata || {};
        const commandMetadata = await this.commandMetadataWithResourceJsDoc({
            commandMetadata: declaredCommandMetadata,
            commandNames: [...Object.keys(collectionCommands), ...Object.keys(memberCommands)],
            frontendModelFilePath,
            resourceClass
        });
        const builtInCollectionCommandsAreDefault = builtInCollectionCommands.create === "create" && builtInCollectionCommands.index === "index";
        const builtInMemberCommandsAreDefault = builtInMemberCommands.attach === "attach"
            && builtInMemberCommands.destroy === "destroy"
            && builtInMemberCommands.download === "download"
            && builtInMemberCommands.find === "find"
            && builtInMemberCommands.update === "update"
            && builtInMemberCommands.url === "url";
        const primaryKey = this.frontendModelPrimaryKeyForResource({ attributeNames, modelClass, modelConfig });
        const primaryKeyValueType = this.frontendModelPrimaryKeyValueType({ attributesTypeName, primaryKey });
        const eventPrimaryKeyValueType = Array.isArray(primaryKey) ? primaryKeyValueType : "string";
        let fileContent = generatedFileBanner(FRONTEND_MODELS_REGENERATE_COMMAND);
        fileContent += `import FrontendModelBase from "${importPath}"\n`;
        fileContent += "\n";
        fileContent += "/**\n";
        fileContent += ` * Frontend model resource config.\n`;
        fileContent += ` * @typedef {import("${importPath}").FrontendModelResourceConfig} FrontendModelResourceConfig\n`;
        fileContent += " */\n";
        fileContent += "/**\n";
        fileContent += " * Fallback attribute value type for generated fields without narrower metadata.\n";
        fileContent += ` * @typedef {import("${importPath}").FrontendModelAttributeValue} FrontendModelAttributeValue\n`;
        fileContent += " */\n";
        if (usesTransportValue) {
            fileContent += "/**\n";
            fileContent += " * Value supported by frontend-model transport serialization and deserialization.\n";
            fileContent += ` * @typedef {import("${importPath}").FrontendModelTransportValue} FrontendModelTransportValue\n`;
            fileContent += " */\n";
        }
        fileContent += "\n";
        fileContent += "/**\n";
        fileContent += ` * ${attributesTypeName} type.\n`;
        fileContent += ` * @typedef {object} ${attributesTypeName}\n`;
        for (const attribute of attributes) {
            fileContent += ` * @property {${attribute.jsDocType}} ${attribute.name} - Attribute value.\n`;
        }
        fileContent += " */\n";
        for (const nestedWriteType of nestedWriteTypes) {
            fileContent += "/**\n";
            fileContent += ` * Attributes accepted for nested ${nestedWriteType.relationshipName} writes.\n`;
            fileContent += ` * @typedef {object} ${nestedWriteType.typeName}\n`;
            for (const nestedAttribute of nestedWriteType.attributes) {
                fileContent += ` * @property {${nestedAttribute.type}} [${nestedAttribute.name}] - Nested ${nestedAttribute.name} value.\n`;
            }
            fileContent += " */\n";
        }
        fileContent += await this.writeAttributesTypedef({ attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams: permittedCreateParams, resourceClass, typeName: createAttributesTypeName });
        fileContent += await this.writeAttributesTypedef({ attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams: permittedUpdateParams, resourceClass, typeName: updateAttributesTypeName });
        fileContent += "/**\n";
        fileContent += ` * Frontend model for ${className}.\n`;
        fileContent += ` * @augments {FrontendModelBase<${attributesTypeName}, ${createAttributesTypeName}, ${updateAttributesTypeName}, ${primaryKeyValueType}, ${eventPrimaryKeyValueType}>}\n`;
        fileContent += " */\n";
        fileContent += `class ${className} extends FrontendModelBase {\n`;
        fileContent += "  /** @returns {FrontendModelResourceConfig} - Resource config. */\n";
        fileContent += "  static resourceConfig() {\n";
        fileContent += "    return {\n";
        fileContent += `      modelName: ${JSON.stringify(className)},\n`;
        if (Object.keys(attachments).length > 0) {
            fileContent += "      attachments: {\n";
            for (const [attachmentName, attachmentConfig] of Object.entries(attachments)) {
                const attachmentType = attachmentConfig && typeof attachmentConfig === "object" && attachmentConfig.type === "hasMany"
                    ? "hasMany"
                    : "hasOne";
                if (attachmentConfig.sync) {
                    fileContent += `        ${attachmentName}: {\n`;
                    fileContent += "          sync: {\n";
                    fileContent += `            fetch: ${JSON.stringify(attachmentConfig.sync.fetch)},\n`;
                    fileContent += `            offlineRequirement: ${JSON.stringify(attachmentConfig.sync.offlineRequirement)},\n`;
                    fileContent += `            retention: ${JSON.stringify(attachmentConfig.sync.retention)},\n`;
                    fileContent += "          },\n";
                    fileContent += `          type: ${JSON.stringify(attachmentType)}\n`;
                    fileContent += "        },\n";
                }
                else {
                    fileContent += `        ${attachmentName}: {type: ${JSON.stringify(attachmentType)}},\n`;
                }
            }
            fileContent += "      },\n";
        }
        fileContent += this.formattedArrayProperty({
            indent: "      ",
            propertyName: "attributes",
            values: attributeNames
        });
        if (!builtInCollectionCommandsAreDefault) {
            fileContent += this.formattedObjectProperty({
                filterDefaultValues: { create: "create", index: "index" },
                indent: "      ",
                propertyName: "builtInCollectionCommands",
                values: builtInCollectionCommands
            });
        }
        if (!builtInMemberCommandsAreDefault) {
            fileContent += this.formattedObjectProperty({
                filterDefaultValues: {
                    attach: "attach",
                    destroy: "destroy",
                    download: "download",
                    find: "find",
                    update: "update",
                    url: "url"
                },
                indent: "      ",
                propertyName: "builtInMemberCommands",
                values: builtInMemberCommands
            });
        }
        if (Object.keys(collectionCommands).length > 0) {
            fileContent += this.formattedCommandsProperty({
                indent: "      ",
                propertyName: "collectionCommands",
                values: collectionCommands
            });
        }
        if (Object.keys(memberCommands).length > 0) {
            fileContent += this.formattedCommandsProperty({
                indent: "      ",
                propertyName: "memberCommands",
                values: memberCommands
            });
        }
        if (primaryKey !== "id") {
            fileContent += `      primaryKey: ${JSON.stringify(primaryKey)},\n`;
        }
        const nestedRelationshipNames = this.nestedRelationshipNamesForGenerator(resourceClass || null);
        if (nestedRelationshipNames.length > 0) {
            fileContent += "      nestedAttributes: {\n";
            for (const relationshipName of nestedRelationshipNames) {
                fileContent += `        ${relationshipName}: {},\n`;
            }
            fileContent += "      },\n";
        }
        if (modelConfig.sync?.enabled) {
            fileContent += this.formattedJsonProperty({
                indent: "      ",
                propertyName: "sync",
                value: modelConfig.sync
            });
        }
        fileContent += "    }\n";
        fileContent += "  }\n";
        if (relationships.length > 0) {
            fileContent += "\n";
            fileContent += "  /** @returns {Record<string, {type: \"belongsTo\" | \"hasOne\" | \"hasMany\", autoload?: boolean}>} - Relationship definitions. */\n";
            fileContent += "  static relationshipDefinitions() {\n";
            fileContent += "    return {\n";
            for (const relationship of relationships) {
                const parts = [`type: ${JSON.stringify(relationship.type)}`];
                if (relationship.autoload === false)
                    parts.push("autoload: false");
                fileContent += `      ${relationship.relationshipName}: {${parts.join(", ")}},\n`;
            }
            fileContent += "    }\n";
            fileContent += "  }\n";
            fileContent += "\n";
            fileContent += "  /** @returns {Record<string, string>} - Relationship model class names. */\n";
            fileContent += "  static relationshipModelClasses() {\n";
            fileContent += "    return {\n";
            for (const relationship of relationships) {
                fileContent += `      ${relationship.relationshipName}: ${JSON.stringify(relationship.targetClassName)},\n`;
            }
            fileContent += "    }\n";
            fileContent += "  }\n";
        }
        for (const attribute of attributes) {
            const camelizedAttribute = inflection.camelize(attribute.name, true);
            const camelizedAttributeUpper = inflection.camelize(attribute.name);
            const attributeType = `${attributesTypeName}[${JSON.stringify(attribute.name)}]`;
            const setterAttributeType = await this.frontendWriteAttributeType({
                attribute,
                attributeName: attribute.name,
                attributesTypeName,
                resourceClass
            });
            fileContent += "\n";
            fileContent += `  /** @returns {${attributeType}} - Attribute value. */\n`;
            fileContent += `  ${camelizedAttribute}() { return /** @type {${attributeType}} */ (this.readAttribute(${JSON.stringify(attribute.name)})) }\n`;
            fileContent += "\n";
            fileContent += "  /**\n";
            fileContent += `   * @param {${setterAttributeType}} newValue - New attribute value.\n`;
            fileContent += `   * @returns {${setterAttributeType}} - Assigned value.\n`;
            fileContent += "   */\n";
            fileContent += `  set${camelizedAttributeUpper}(newValue) { return /** @type {${setterAttributeType}} */ (this.setAttribute(${JSON.stringify(attribute.name)}, newValue)) }\n`;
        }
        for (const methodName of Object.keys(collectionCommands)) {
            const signature = this.customCommandMethodSignature({ commandMetadata, methodName });
            fileContent += "\n";
            fileContent += "  /**\n";
            fileContent += `   * Runs ${methodName}.\n`;
            fileContent += signature.paramDocs;
            fileContent += `   * @returns {Promise<${signature.returnType}>} - Command response.\n`;
            fileContent += "   */\n";
            fileContent += `  static async ${methodName}(${signature.parameters}) {\n`;
            fileContent += `    return /** @type {${signature.returnType}} */ (await this.executeCustomCommand({\n`;
            fileContent += `      commandName: ${JSON.stringify(collectionCommands[methodName])},\n`;
            fileContent += `      commandType: ${JSON.stringify(collectionCommands[methodName])},\n`;
            fileContent += `      payload: ${className}.normalizeCustomCommandPayloadArguments(${signature.payloadArguments}),\n`;
            fileContent += "      resourcePath: this.resourcePath()\n";
            fileContent += "    }))\n";
            fileContent += "  }\n";
        }
        for (const methodName of Object.keys(memberCommands)) {
            const signature = this.customCommandMethodSignature({ commandMetadata, methodName });
            fileContent += "\n";
            fileContent += "  /**\n";
            fileContent += `   * Runs ${methodName}.\n`;
            fileContent += signature.paramDocs;
            fileContent += `   * @returns {Promise<${signature.returnType}>} - Command response.\n`;
            fileContent += "   */\n";
            fileContent += `  async ${methodName}(${signature.parameters}) {\n`;
            fileContent += `    return /** @type {${signature.returnType}} */ (await ${className}.executeCustomCommand({\n`;
            fileContent += `      commandName: ${JSON.stringify(memberCommands[methodName])},\n`;
            fileContent += `      commandType: ${JSON.stringify(memberCommands[methodName])},\n`;
            fileContent += `      memberId: this.scalarPrimaryKeyValue(${JSON.stringify(`Custom member command ${className}#${methodName}`)}),\n`;
            fileContent += `      payload: ${className}.normalizeCustomCommandPayloadArguments(${signature.payloadArguments}),\n`;
            fileContent += `      resourcePath: ${className}.resourcePath()\n`;
            fileContent += "    }))\n";
            fileContent += "  }\n";
        }
        for (const relationship of relationships) {
            const relationshipNameCamelized = inflection.camelize(relationship.relationshipName);
            const targetImportPath = `./${relationship.targetFileName}.js`;
            const targetInstanceType = `import(${JSON.stringify(targetImportPath)}).${relationship.targetClassName}`;
            const targetCreateAttributesType = `import(${JSON.stringify(targetImportPath)}).${relationship.targetClassName}CreateAttributes`;
            if (relationship.type == "hasMany") {
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Returns ${relationship.relationshipName} relationship helper.\n`;
                fileContent += `   * @returns {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} - Relationship helper.\n`;
                fileContent += "   */\n";
                fileContent += `  ${relationship.relationshipName}Relationship() { return /** @type {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)})) }\n`;
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Returns ${relationship.relationshipName}.\n`;
                fileContent += `   * @returns {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} - Relationship helper.\n`;
                fileContent += "   */\n";
                fileContent += `  ${relationship.relationshipName}() { return this.${relationship.relationshipName}Relationship() }\n`;
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Returns loaded ${relationship.relationshipName}.\n`;
                fileContent += `   * @returns {Array<${targetInstanceType}>} - Loaded related models.\n`;
                fileContent += "   */\n";
                fileContent += `  ${relationship.relationshipName}Loaded() { return this.${relationship.relationshipName}Relationship().loaded() }\n`;
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Loads ${relationship.relationshipName}.\n`;
                fileContent += `   * @returns {Promise<Array<${targetInstanceType}>>} - Loaded related models.\n`;
                fileContent += "   */\n";
                fileContent += `  async load${relationshipNameCamelized}() { return await this.${relationship.relationshipName}Relationship().load() }\n`;
            }
            else {
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Returns ${relationship.relationshipName} relationship helper.\n`;
                fileContent += `   * @returns {import(${JSON.stringify(importPath)}).FrontendModelSingularRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} - Relationship helper.\n`;
                fileContent += "   */\n";
                fileContent += `  ${relationship.relationshipName}Relationship() { return /** @type {import(${JSON.stringify(importPath)}).FrontendModelSingularRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)})) }\n`;
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Returns ${relationship.relationshipName}.\n`;
                fileContent += `   * @returns {${targetInstanceType} | null} - Loaded related model.\n`;
                fileContent += "   */\n";
                fileContent += `  ${relationship.relationshipName}() { return this.${relationship.relationshipName}Relationship().loaded() }\n`;
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Builds ${relationship.relationshipName}.\n`;
                fileContent += `   * @param {${targetCreateAttributesType}} [attributes] - Attributes for the new related model.\n`;
                fileContent += `   * @returns {${targetInstanceType}} - Built related model.\n`;
                fileContent += "   */\n";
                fileContent += `  build${relationshipNameCamelized}(attributes = {}) { return this.${relationship.relationshipName}Relationship().build(attributes) }\n`;
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Loads ${relationship.relationshipName}.\n`;
                fileContent += `   * @returns {Promise<${targetInstanceType} | null>} - Loaded related model.\n`;
                fileContent += "   */\n";
                fileContent += `  async load${relationshipNameCamelized}() { return await this.${relationship.relationshipName}Relationship().load() }\n`;
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Returns or loads ${relationship.relationshipName}.\n`;
                fileContent += `   * @returns {Promise<${targetInstanceType} | null>} - Loaded related model.\n`;
                fileContent += "   */\n";
                fileContent += `  async ${relationship.relationshipName}OrLoad() { return await this.${relationship.relationshipName}Relationship().orLoad() }\n`;
                fileContent += "\n";
                fileContent += "  /**\n";
                fileContent += `   * Sets ${relationship.relationshipName}.\n`;
                fileContent += `   * @param {${targetInstanceType} | null} model - Related model.\n`;
                fileContent += "   * @returns {void}\n";
                fileContent += "   */\n";
                fileContent += `  set${relationshipNameCamelized}(model) { this.${relationship.relationshipName}Relationship().setLoaded(model) }\n`;
            }
        }
        fileContent += "\n";
        fileContent += "  /**\n";
        fileContent += "   * Registers a class-level destroy callback.\n";
        fileContent += "   * @overload\n";
        fileContent += `   * @param {(payload: {id: ${eventPrimaryKeyValueType}}) => void} callback - Event callback.\n`;
        fileContent += `   * @param {import(${JSON.stringify(importPath)}).FrontendModelEventOptions} [options] - Destroy event options.\n`;
        fileContent += "   * @returns {Promise<() => void>} - Unsubscribe callback.\n";
        fileContent += "   */\n";
        fileContent += "  /**\n";
        fileContent += `   * @template {import(${JSON.stringify(importPath)}).FrontendModelClass} T\n`;
        fileContent += "   * @overload\n";
        fileContent += "   * @this {T}\n";
        fileContent += `   * @param {(payload: {id: import(${JSON.stringify(importPath)}).FrontendModelEventPrimaryKeyValueFor<InstanceType<T>>}) => void} callback - Event callback.\n`;
        fileContent += `   * @param {import(${JSON.stringify(importPath)}).FrontendModelEventOptions} [options] - Destroy event options.\n`;
        fileContent += "   * @returns {Promise<() => void>} - Unsubscribe callback.\n";
        fileContent += "   */\n";
        fileContent += "  /**\n";
        fileContent += "   * Implements class-level destroy callback registration.\n";
        fileContent += "   * @param {(payload: {id: never}) => void} callback - Type-erased event callback.\n";
        fileContent += `   * @param {import(${JSON.stringify(importPath)}).FrontendModelEventOptions} [options] - Destroy event options.\n`;
        fileContent += "   * @returns {Promise<() => void>} - Unsubscribe callback.\n";
        fileContent += "   */\n";
        fileContent += "  static async onDestroy(callback, options = {}) {\n";
        fileContent += "    return await this._registerDestroyEventCallback(callback, options)\n";
        fileContent += "  }\n";
        fileContent += "}\n";
        fileContent += "\n";
        fileContent += `FrontendModelBase.registerModel(${className})\n`;
        fileContent += "\n";
        fileContent += `export {${className}}\n`;
        fileContent += "\n";
        fileContent += `export default ${className}\n`;
        return fileContent;
    }
    /**
     * Runs build setup file content.
     * @param {Array<{className: string, fileName: string}>} generatedFiles - Generated model files.
     * @returns {string} - Setup file content with side-effect imports for model registration.
     */
    buildSetupFileContent(generatedFiles) {
        let content = generatedFileBanner(FRONTEND_MODELS_REGENERATE_COMMAND);
        for (const { fileName } of generatedFiles) {
            content += `import "./${fileName}"\n`;
        }
        return content;
    }
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
    async writeAttributesTypedef({ attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams, resourceClass, typeName }) {
        const attributeLines = [];
        let output = "/**\n";
        const attributesByName = new Map(attributes.map((attribute) => [attribute.name, attribute]));
        const nestedWriteTypesByKey = new Map(nestedWriteTypes.map((nestedWriteType) => [`${nestedWriteType.relationshipName}Attributes`, nestedWriteType]));
        const emittedAttributeNames = new Set();
        for (const entry of permittedParams) {
            if (typeof entry == "string") {
                const attributeName = this.frontendWriteAttributeName({ attributeName: entry, attributesByName, modelClass });
                if (emittedAttributeNames.has(attributeName))
                    continue;
                emittedAttributeNames.add(attributeName);
                const type = await this.frontendWriteAttributeType({
                    attribute: attributesByName.get(attributeName),
                    attributeName,
                    attributesTypeName,
                    resourceClass
                });
                attributeLines.push(` * @property {${type}} [${attributeName}] - Permitted ${attributeName} value.\n`);
            }
            else if (entry && typeof entry == "object" && !Array.isArray(entry)) {
                for (const key of Object.keys(entry)) {
                    const nestedWriteType = nestedWriteTypesByKey.get(key);
                    const type = nestedWriteType ? `Array<${nestedWriteType.typeName}>` : "Array<object>";
                    attributeLines.push(` * @property {${type}} [${key}] - Permitted nested ${key} values.\n`);
                }
            }
        }
        output += ` * Attributes accepted by ${typeName}.\n`;
        if (attributeLines.length === 0) {
            output += ` * @typedef {Record<string, never>} ${typeName}\n`;
        }
        else {
            output += ` * @typedef {object} ${typeName}\n`;
            output += attributeLines.join("");
        }
        output += " */\n";
        return output;
    }
    /**
     * Runs frontend write attribute type.
     * @param {{attribute: {jsDocType: string, name: string, writeJsDocType: string} | undefined, attributeName: string, attributesTypeName: string, resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined}} args - Arguments.
     * @returns {Promise<string>} - JSDoc type for the permitted write field.
     */
    async frontendWriteAttributeType({ attribute, attributeName, attributesTypeName, resourceClass }) {
        const setterParameterType = await this.frontendWriteAttributeSetterParameterType({ attributeName, resourceClass });
        if (setterParameterType)
            return `${setterParameterType} | null`;
        if (!attribute)
            return "FrontendModelAttributeValue";
        if (attribute.jsDocType.trim() === "null")
            return "FrontendModelAttributeValue";
        if (attribute.writeJsDocType !== attribute.jsDocType)
            return attribute.writeJsDocType;
        return `${attributesTypeName}[${JSON.stringify(attribute.name)}] | null`;
    }
    /**
     * Runs frontend write attribute setter parameter type.
     * @param {{attributeName: string, resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined}} args - Arguments.
     * @returns {Promise<string | null>} - Setter value parameter type when it is useful for generation.
     */
    async frontendWriteAttributeSetterParameterType({ attributeName, resourceClass }) {
        if (!resourceClass?.name)
            return null;
        const methodName = `set${inflection.camelize(attributeName)}Attribute`;
        const parameterType = await this.resourceMethodParameterType({
            methodName,
            parameterIndex: 1,
            sourceClassName: resourceClass.name
        });
        if (!parameterType)
            return null;
        if (this.isBroadGeneratedType(parameterType))
            return null;
        return parameterType;
    }
    /**
     * Runs is broad generated type.
     * @param {string} jsDocType - JSDoc type.
     * @returns {boolean} - Whether the type is too broad to improve generated write typing.
     */
    isBroadGeneratedType(jsDocType) {
        const normalizedType = jsDocType.trim();
        return normalizedType === "?"
            || normalizedType === "any"
            || normalizedType === "object"
            || normalizedType === "unknown";
    }
    /**
     * Resolves a permitted write attribute to the generated frontend attribute name.
     * @param {{attributeName: string, attributesByName: Map<string, {jsDocType: string, name: string}>, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
     * @returns {string} - Frontend attribute name used by generated accessors.
     */
    frontendWriteAttributeName({ attributeName, attributesByName, modelClass }) {
        if (attributesByName.has(attributeName))
            return attributeName;
        if (modelClass) {
            const resolvedAttributeName = modelClass.resolveAttributeName(attributeName);
            if (resolvedAttributeName && attributesByName.has(resolvedAttributeName))
                return resolvedAttributeName;
        }
        const normalizedAttributeName = inflection.camelize(attributeName, true).toLowerCase();
        const matchingAttributeName = Array.from(attributesByName.keys()).find((candidateName) => candidateName.toLowerCase() === normalizedAttributeName);
        if (matchingAttributeName)
            return matchingAttributeName;
        // Write-only virtual params are valid permitted params even when they have no read attribute.
        return attributeName;
    }
    /**
     * Runs nested write types for model.
     * @param {object} args - Arguments.
     * @param {string} args.className - Frontend model class name.
     * @param {FrontendModelGeneratorPermitSpec} args.permittedParams - Combined permitted params specs.
     * @param {Array<{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} args.relationships - Generated relationships.
     * @returns {Array<{attributes: Array<{name: string, type: string}>, relationshipName: string, typeName: string}>} - Nested write typedefs.
     */
    nestedWriteTypesForModel({ className, permittedParams, relationships }) {
        const relationshipsByName = new Map(relationships.map((relationship) => [relationship.relationshipName, relationship]));
        const nestedWriteTypesByName = new Map();
        for (const entry of permittedParams) {
            if (!entry || typeof entry != "object" || Array.isArray(entry))
                continue;
            for (const key of Object.keys(entry)) {
                if (!key.endsWith("Attributes"))
                    continue;
                const relationshipName = key.slice(0, -"Attributes".length);
                const nestedSpec = entry[key];
                const relationship = relationshipsByName.get(relationshipName);
                let targetModelClass;
                if (relationship) {
                    try {
                        targetModelClass = this.getConfiguration().getModelClass(relationship.targetClassName);
                    }
                    catch {
                        targetModelClass = undefined;
                    }
                }
                if (nestedWriteTypesByName.has(relationshipName))
                    continue;
                nestedWriteTypesByName.set(relationshipName, {
                    attributes: this.nestedWriteAttributesForSpec({ nestedSpec, targetModelClass }),
                    relationshipName,
                    typeName: `${className}${inflection.camelize(relationshipName)}NestedAttributes`
                });
            }
        }
        return Array.from(nestedWriteTypesByName.values());
    }
    /**
     * Runs nested write attributes for spec.
     * @param {object} args - Arguments.
     * @param {Array<string | Record<string, object>> | object | string | null | undefined} args.nestedSpec - Nested permit spec.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.targetModelClass - Target backend model class.
     * @returns {Array<{name: string, type: string}>} - Nested write attributes.
     */
    nestedWriteAttributesForSpec({ nestedSpec, targetModelClass }) {
        if (!Array.isArray(nestedSpec))
            return [];
        return nestedSpec.filter((entry) => typeof entry == "string").map((attributeName) => {
            const resolvedAttributeName = targetModelClass?.resolveAttributeName(attributeName) || attributeName;
            const attributeConfig = this.frontendAttributeConfigForModelAttribute({ attributeName: resolvedAttributeName, modelClass: targetModelClass });
            return {
                name: resolvedAttributeName,
                type: attributeConfig ? this.jsDocTypeForFrontendWriteAttribute({ attributeConfig }) : "FrontendModelAttributeValue"
            };
        });
    }
    /**
     * Runs permitted params for generator.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} resourceClass - Resource class.
     * @param {"create" | "update"} action - Write action.
     * @returns {FrontendModelGeneratorPermitSpec} - Permitted params spec.
     */
    permittedParamsForGenerator(resourceClass, action) {
        if (!resourceClass)
            return [];
        try {
            const modelClass = resourceClass.modelClass();
            const ResourceClass = frontendModelResourceInternalConstructor(resourceClass);
            const instance = new ResourceClass({
                ability: undefined,
                context: {},
                locals: {},
                modelClass,
                modelName: modelClass.getModelName(),
                params: {},
                resourceConfiguration: /** @type {import("../../../../../configuration-types.js").FrontendModelResourceConfiguration} */ ({ attributes: [] })
            });
            const spec = instance.permittedParams({ action, ability: undefined, locals: {}, params: {} });
            return Array.isArray(spec) ? spec : [];
        }
        catch (error) {
            throw new Error(`Failed to invoke ${resourceClass.name}.permittedParams() while generating frontend model write types: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }
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
    nestedRelationshipNamesForGenerator(resourceClass) {
        if (!resourceClass)
            return [];
        let spec;
        try {
            const modelClass = resourceClass.modelClass();
            const ResourceClass = frontendModelResourceInternalConstructor(resourceClass);
            const instance = new ResourceClass({
                ability: undefined,
                context: {},
                locals: {},
                modelClass,
                modelName: modelClass.getModelName(),
                params: {},
                resourceConfiguration: /** @type {import("../../../../../configuration-types.js").FrontendModelResourceConfiguration} */ ({ attributes: [] })
            });
            spec = instance.permittedParams();
        }
        catch (error) {
            throw new Error(`Failed to invoke ${resourceClass.name}.permittedParams() while generating frontend models: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
        if (!Array.isArray(spec))
            return [];
        /**
         * Relationship names.
         * @type {string[]} */
        const relationshipNames = [];
        for (const entry of spec) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry))
                continue;
            for (const key of Object.keys(entry)) {
                if (!key.endsWith("Attributes"))
                    continue;
                const name = key.slice(0, -"Attributes".length);
                if (name)
                    relationshipNames.push(name);
            }
        }
        return relationshipNames;
    }
    /**
     * Runs formatted array property.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Base indentation.
     * @param {string} args.propertyName - Object property name.
     * @param {string[]} args.values - String values.
     * @returns {string} - Formatted multiline array property.
     */
    formattedArrayProperty({ indent, propertyName, values }) {
        let output = `${indent}${propertyName}: [\n`;
        for (const value of values) {
            output += `${indent}  ${JSON.stringify(value)},\n`;
        }
        output += `${indent}],\n`;
        return output;
    }
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
    formattedCommandsProperty({ indent, propertyName, values }) {
        return this.formattedArrayProperty({ indent, propertyName, values: Object.keys(values) });
    }
    /**
     * Runs formatted object property.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Base indentation.
     * @param {string} args.propertyName - Object property name.
     * @param {Record<string, string>} args.values - Object key-values.
     * @param {Record<string, string>} [args.filterDefaultValues] - Default values to omit from output.
     * @returns {string} - Formatted multiline object property.
     */
    formattedObjectProperty({ filterDefaultValues, indent, propertyName, values }) {
        let output = `${indent}${propertyName}: {\n`;
        for (const objectKey of Object.keys(values)) {
            if (filterDefaultValues && filterDefaultValues[objectKey] === values[objectKey])
                continue;
            output += `${indent}  ${objectKey}: ${JSON.stringify(values[objectKey])},\n`;
        }
        output += `${indent}},\n`;
        return output;
    }
    /**
     * Runs formatted JSON property.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Base indentation.
     * @param {string} args.propertyName - Object property name.
     * @param {unknown} args.value - JSON-compatible value.
     * @returns {string} - Formatted property.
     */
    formattedJsonProperty({ indent, propertyName, value }) {
        return `${indent}${propertyName}: ${this.formattedJsonValue({ indent, value })},\n`;
    }
    /**
     * Runs formatted JSON value.
     * @param {object} args - Formatting args.
     * @param {string} args.indent - Indentation before this value.
     * @param {unknown} args.value - JSON-compatible value.
     * @returns {string} - Formatted value.
     */
    formattedJsonValue({ indent, value }) {
        if (Array.isArray(value)) {
            let output = "[\n";
            for (const entry of value) {
                output += `${indent}  ${this.formattedJsonValue({ indent: `${indent}  `, value: entry })},\n`;
            }
            output += `${indent}]`;
            return output;
        }
        if (value && typeof value === "object") {
            let output = "{\n";
            for (const key of Object.keys(value)) {
                output += `${indent}  ${this.formattedObjectKey(key)}: ${this.formattedJsonValue({ indent: `${indent}  `, value: /** @type {Record<string, unknown>} */ (value)[key] })},\n`;
            }
            output += `${indent}}`;
            return output;
        }
        return JSON.stringify(value);
    }
    /**
     * Runs formatted object key.
     * @param {string} key - Object key.
     * @returns {string} - JavaScript object key.
     */
    formattedObjectKey(key) {
        return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    }
    /**
     * Runs attribute definitions for model.
     * @param {object} args - Arguments.
     * @param {string} args.className - Frontend model class name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {Promise<Array<{jsDocType: string, name: string, writeJsDocType: string}>>} - Attribute definitions.
     */
    async attributeDefinitionsForModel({ className, modelClass, modelConfig, resourceClass }) {
        let attributes = modelConfig.attributes;
        // Auto-derive attributes from model columns when not explicitly defined
        if ((!attributes || (Array.isArray(attributes) && attributes.length === 0)) && modelClass) {
            const columns = modelClass.getColumns();
            if (Array.isArray(columns)) {
                attributes = columns.map((column) => inflection.camelize(column.getName(), true));
            }
        }
        if (Array.isArray(attributes)) {
            const attributeDefinitions = [];
            for (const attributeDefinition of attributes) {
                /** @type {FrontendAttributeConfig | null} */
                let configuredAttributeConfig = null;
                let attributeName;
                if (typeof attributeDefinition == "string") {
                    attributeName = attributeDefinition;
                }
                else if (attributeDefinition && typeof attributeDefinition == "object" && !Array.isArray(attributeDefinition)) {
                    configuredAttributeConfig = /** @type {FrontendAttributeConfig} */ (attributeDefinition);
                    attributeName = configuredAttributeConfig.name;
                }
                if (typeof attributeName != "string" || attributeName.length < 1) {
                    throw new Error(`Expected frontend model attribute array entries to be strings or objects with a name, got: ${JSON.stringify(attributeDefinition)}`);
                }
                const attributeConfig = await this.resolvedFrontendAttributeConfig({
                    attributeName,
                    className,
                    configuredAttributeConfig,
                    modelClass,
                    resourceClass
                });
                const frontendAttributeConfig = this.frontendAttributeConfigForGeneratedAttribute({
                    attributeConfig,
                    attributeName,
                    modelClass
                });
                attributeDefinitions.push({
                    jsDocType: this.jsDocTypeForFrontendAttribute({ attributeConfig: frontendAttributeConfig }),
                    name: attributeName,
                    writeJsDocType: this.jsDocTypeForFrontendWriteAttribute({ attributeConfig: frontendAttributeConfig })
                });
            }
            return attributeDefinitions;
        }
        if (!attributes || typeof attributes !== "object") {
            throw new Error(`Expected 'attributes' as array or object but got: ${attributes}`);
        }
        const attributeDefinitions = [];
        for (const attributeName of Object.keys(attributes)) {
            const attributeConfig = attributes[attributeName];
            const configuredAttributeConfig = attributeConfig && typeof attributeConfig === "object"
                ? /** @type {FrontendAttributeConfig} */ (attributeConfig)
                : null;
            const normalizedAttributeConfig = await this.resolvedFrontendAttributeConfig({
                attributeName,
                className,
                configuredAttributeConfig,
                modelClass,
                resourceClass
            });
            const frontendAttributeConfig = this.frontendAttributeConfigForGeneratedAttribute({
                attributeConfig: normalizedAttributeConfig,
                attributeName,
                modelClass
            });
            attributeDefinitions.push({
                jsDocType: this.jsDocTypeForFrontendAttribute({ attributeConfig: frontendAttributeConfig }),
                name: attributeName,
                writeJsDocType: this.jsDocTypeForFrontendWriteAttribute({ attributeConfig: frontendAttributeConfig })
            });
        }
        return attributeDefinitions;
    }
    /**
     * Runs frontend attribute config for generated attribute.
     * @param {{attributeConfig: FrontendAttributeConfig, attributeName: string, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
     * @returns {FrontendAttributeConfig} - Attribute config used for generated JSDoc.
     */
    frontendAttributeConfigForGeneratedAttribute({ attributeConfig, attributeName, modelClass }) {
        if (!this.frontendAttributeIsModelPrimaryKey({ attributeName, modelClass }))
            return attributeConfig;
        if (this.frontendAttributeConfigHasNullability(attributeConfig))
            return attributeConfig;
        return { ...attributeConfig, null: false };
    }
    /**
     * Runs frontend attribute is model primary key.
     * @param {{attributeName: string, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
     * @returns {boolean} - Whether the attribute is the model primary key.
     */
    frontendAttributeIsModelPrimaryKey({ attributeName, modelClass }) {
        if (!modelClass)
            return false;
        const primaryKey = modelClass.primaryKey();
        for (const columnName of Array.isArray(primaryKey) ? primaryKey : [primaryKey]) {
            if (attributeName === columnName)
                return true;
            if (modelClass.resolveAttributeName(columnName) === attributeName)
                return true;
        }
        return false;
    }
    /**
     * Resolves the primary key from explicit resource config or the backend model.
     * @param {{attributeNames: Array<string>, modelClass: typeof import("../../../../../database/record/index.js").default | undefined, modelConfig: import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration}} args - Primary key resolution args.
     * @returns {string | Array<string>} - Frontend-model primary key attribute name.
     */
    frontendModelPrimaryKeyForResource({ attributeNames, modelClass, modelConfig }) {
        if (modelConfig.primaryKey) {
            return this.validatedConfiguredPrimaryKey({ attributeNames, primaryKey: modelConfig.primaryKey });
        }
        if (!modelClass)
            return "id";
        return this.frontendModelPrimaryKeyForModelClass({ attributeNames, modelClass });
    }
    /**
     * Builds the generated model's concrete primary-key value type.
     * @param {{attributesTypeName: string, primaryKey: string | string[]}} args - Primary-key type arguments.
     * @returns {string} - JSDoc type expression.
     */
    frontendModelPrimaryKeyValueType({ attributesTypeName, primaryKey }) {
        if (Array.isArray(primaryKey)) {
            const attributeNames = primaryKey.map((attributeName) => JSON.stringify(attributeName)).join(" | ");
            return `Pick<${attributesTypeName}, ${attributeNames}>`;
        }
        return `${attributesTypeName}[${JSON.stringify(primaryKey)}]`;
    }
    /**
     * Validates an explicitly configured frontend-model primary key.
     * @param {{attributeNames: Array<string>, primaryKey: string | string[]}} args - Configured primary key args.
     * @returns {string | string[]} - Configured primary key.
     */
    validatedConfiguredPrimaryKey({ attributeNames, primaryKey }) {
        const primaryKeyAttributes = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
        if (primaryKeyAttributes.length < 1) {
            throw new Error("Configured frontend model composite primary key must contain at least one attribute.");
        }
        if (new Set(primaryKeyAttributes).size !== primaryKeyAttributes.length) {
            throw new Error("Configured frontend model composite primary key attributes must be unique.");
        }
        for (const attributeName of primaryKeyAttributes) {
            if (!attributeNames.includes(attributeName)) {
                throw new Error(`Configured frontend model primary key "${attributeName}" is not a generated frontend model attribute.`);
            }
        }
        return primaryKey;
    }
    /**
     * Resolves the backend primary key to generated frontend-model attribute names.
     * @param {{attributeNames: Array<string>, modelClass: typeof import("../../../../../database/record/index.js").default}} args - Primary key resolution args.
     * @returns {string | Array<string>} - Frontend-model primary key attribute name.
     */
    frontendModelPrimaryKeyForModelClass({ attributeNames, modelClass }) {
        const primaryKey = modelClass.primaryKey();
        if (primaryKey === "id")
            return "id";
        if (Array.isArray(primaryKey)) {
            return primaryKey.map((columnName) => this.frontendModelPrimaryKeyAttributeName({ attributeNames, columnName, modelClass }));
        }
        return this.frontendModelPrimaryKeyAttributeName({ attributeNames, columnName: primaryKey, modelClass });
    }
    /**
     * Resolves one backend primary key column to a generated frontend-model attribute name.
     * @param {{attributeNames: Array<string>, columnName: string, modelClass: typeof import("../../../../../database/record/index.js").default}} args - Primary key args.
     * @returns {string} - Frontend-model primary key attribute name.
     */
    frontendModelPrimaryKeyAttributeName({ attributeNames, columnName, modelClass }) {
        if (attributeNames.includes(columnName))
            return columnName;
        const attributeName = modelClass.resolveAttributeName(columnName);
        if (attributeName && attributeNames.includes(attributeName)) {
            return attributeName;
        }
        throw new Error(`${modelClass.name}.primaryKey() column "${columnName}" does not resolve to a generated frontend model attribute.`);
    }
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
    async resolvedFrontendAttributeConfig({ attributeName, className, configuredAttributeConfig, modelClass, resourceClass }) {
        const inferredResourceConfig = await this.frontendAttributeConfigForResourceAttribute({ attributeName, resourceClass });
        const inferredColumnConfig = inferredResourceConfig
            ? null
            : this.frontendAttributeConfigForModelAttribute({ attributeName, modelClass });
        const inferredTranslatedConfig = inferredResourceConfig || inferredColumnConfig
            ? null
            : this.frontendAttributeConfigForTranslatedAttribute({ attributeName, modelClass, resourceClass });
        const inferredModelAccessorConfig = inferredResourceConfig || inferredColumnConfig || inferredTranslatedConfig
            ? null
            : await this.frontendAttributeConfigForModelAccessor({ attributeName, modelClass });
        const inferredConfig = inferredResourceConfig || inferredColumnConfig || inferredTranslatedConfig || inferredModelAccessorConfig;
        if (configuredAttributeConfig && this.frontendAttributeConfigHasType(configuredAttributeConfig)) {
            return inferredConfig
                ? { ...inferredConfig, ...configuredAttributeConfig }
                : configuredAttributeConfig;
        }
        if (inferredConfig) {
            return configuredAttributeConfig
                ? { ...inferredConfig, ...configuredAttributeConfig }
                : inferredConfig;
        }
        throw new Error(`Could not infer JSDoc type for frontend model attribute '${className}#${attributeName}'. Add a backend model column, translation table column, explicit resource metadata, or a @returns JSDoc type on ${resourceClass?.name || "the resource"}.${attributeName}Attribute().`);
    }
    /**
     * Runs frontend attribute config has type.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute config.
     * @returns {boolean} - Whether the config declares a type source.
     */
    frontendAttributeConfigHasType(attributeConfig) {
        return typeof this.frontendAttributeTypeValue(attributeConfig) == "string"
            || typeof attributeConfig?.jsDocType == "string";
    }
    /**
     * Runs frontend attribute config has nullability.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute config.
     * @returns {boolean} - Whether the config declares nullability.
     */
    frontendAttributeConfigHasNullability(attributeConfig) {
        if (!attributeConfig || typeof attributeConfig !== "object")
            return false;
        if (Object.prototype.hasOwnProperty.call(attributeConfig, "null"))
            return true;
        return typeof attributeConfig.getNull == "function";
    }
    /**
     * Runs js doc type for frontend attribute.
     * @param {object} args - Arguments.
     * @param {FrontendAttributeConfig | null | undefined} args.attributeConfig - Attribute configuration value.
     * @returns {string} - JSDoc type.
     */
    jsDocTypeForFrontendAttribute({ attributeConfig }) {
        if (attributeConfig && typeof attributeConfig.jsDocType == "string" && attributeConfig.jsDocType.length > 0) {
            return attributeConfig.jsDocType;
        }
        const jsDocType = this.jsDocTypeForFrontendAttributeBaseType(attributeConfig);
        if (!this.frontendAttributeCanBeNull(attributeConfig)) {
            return jsDocType;
        }
        return `${jsDocType} | null`;
    }
    /**
     * Runs js doc type for frontend write attribute.
     * @param {object} args - Arguments.
     * @param {FrontendAttributeConfig | null | undefined} args.attributeConfig - Attribute configuration value.
     * @returns {string} - JSDoc type accepted by create/update payloads.
     */
    jsDocTypeForFrontendWriteAttribute({ attributeConfig }) {
        if (attributeConfig && typeof attributeConfig.jsDocType == "string" && attributeConfig.jsDocType.length > 0) {
            return attributeConfig.jsDocType;
        }
        const jsDocType = this.jsDocTypeForFrontendWriteAttributeBaseType(attributeConfig);
        if (!this.frontendAttributeCanBeNull(attributeConfig)) {
            return jsDocType;
        }
        return `${jsDocType} | null`;
    }
    /**
     * Runs js doc type for frontend write attribute base type.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {string} - Non-nullable JSDoc type accepted by create/update payloads.
     */
    jsDocTypeForFrontendWriteAttributeBaseType(attributeConfig) {
        const readType = this.jsDocTypeForFrontendAttributeBaseType(attributeConfig);
        if (!this.frontendAttributeTypeIsTemporal(attributeConfig))
            return readType;
        return `${readType} | string`;
    }
    /**
     * Runs js doc type for frontend attribute base type.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {string} - Non-nullable JSDoc type.
     */
    jsDocTypeForFrontendAttributeBaseType(attributeConfig) {
        if (!attributeConfig || typeof attributeConfig !== "object") {
            return "FrontendModelAttributeValue";
        }
        const type = this.frontendAttributeTypeValue(attributeConfig);
        if (type == "boolean") {
            return "boolean";
        }
        else if (type == "json" || type == "jsonb") {
            return "FrontendModelTransportValue";
        }
        else if (type && ["blob", "char", "nvarchar", "varchar", "text", "longtext", "mediumtext", "tinytext", "uuid", "character varying"].includes(type)) {
            return "string";
        }
        else if (type && ["bit", "bigint", "decimal", "double", "double precision", "float", "int", "integer", "numeric", "real", "smallint", "tinyint"].includes(type)) {
            return "number";
        }
        else if (this.frontendAttributeTypeIsTemporal(attributeConfig)) {
            return "Date";
        }
        else {
            return "FrontendModelAttributeValue";
        }
    }
    /**
     * Runs frontend attribute type is temporal.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {boolean} - Whether the attribute represents a date/time value.
     */
    frontendAttributeTypeIsTemporal(attributeConfig) {
        if (!attributeConfig || typeof attributeConfig !== "object")
            return false;
        const type = this.frontendAttributeTypeValue(attributeConfig);
        return type ? ["date", "datetime", "timestamp", "timestamp without time zone", "timestamptz"].includes(type) : false;
    }
    /**
     * Runs frontend attribute can be null.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {boolean} - Whether the attribute allows null values.
     */
    frontendAttributeCanBeNull(attributeConfig) {
        if (!attributeConfig || typeof attributeConfig !== "object") {
            return false;
        }
        if (typeof attributeConfig.getNull == "function") {
            return attributeConfig.getNull() === true;
        }
        return attributeConfig.null === true;
    }
    /**
     * Runs frontend attribute type value.
     * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
     * @returns {string | null} - Normalized column type.
     */
    frontendAttributeTypeValue(attributeConfig) {
        if (!attributeConfig || typeof attributeConfig !== "object") {
            return null;
        }
        if (typeof attributeConfig.getType == "function") {
            return String(attributeConfig.getType());
        }
        const typeValue = attributeConfig.type || attributeConfig.columnType || attributeConfig.sqlType || attributeConfig.dataType;
        if (typeof typeValue !== "string") {
            return null;
        }
        return typeValue;
    }
    /**
     * Runs frontend attribute config for resource attribute.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @returns {Promise<FrontendAttributeConfig | null>} - Attribute config inferred from resource method JSDoc.
     */
    async frontendAttributeConfigForResourceAttribute({ attributeName, resourceClass }) {
        if (!resourceClass)
            return null;
        const methodName = `${attributeName}Attribute`;
        const ownerClassName = this.methodOwnerClassName({ methodName, targetClass: resourceClass });
        if (!ownerClassName)
            return null;
        const jsDocType = await this.resourceMethodReturnType({
            methodName,
            sourceClassName: ownerClassName
        });
        return jsDocType ? { jsDocType: this.unwrappedPromiseJsDocType({ jsDocType }) } : null;
    }
    /**
     * Runs frontend attribute config for translated attribute.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @returns {FrontendAttributeConfig | null} - Attribute config inferred from translated attribute columns.
     */
    frontendAttributeConfigForTranslatedAttribute({ attributeName, modelClass, resourceClass }) {
        if (!modelClass)
            return null;
        if (!this.frontendAttributeIsTranslated({ attributeName, modelClass, resourceClass }))
            return null;
        const TranslationClass = modelClass.getTranslationClass();
        const columnName = inflection.underscore(attributeName);
        let column;
        try {
            column = TranslationClass.getColumnsHash()[columnName];
        }
        catch (error) {
            if (error instanceof Error && (error.message.includes("hasn't been initialized yet") || error.message.includes("used before initialization")))
                return null;
            throw error;
        }
        return column ? this.frontendAttributeConfigForColumn({ column }) : null;
    }
    /**
     * Runs frontend attribute is translated.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Backend model class.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
     * @returns {boolean} - Whether the frontend attribute is translated.
     */
    frontendAttributeIsTranslated({ attributeName, modelClass, resourceClass }) {
        if (resourceClass) {
            const translatedAttributes = resourceClass.translatedAttributesConfig();
            if (Array.isArray(translatedAttributes) && translatedAttributes.includes(attributeName))
                return true;
        }
        const translations = modelClass._translations;
        return Boolean(translations && typeof translations == "object" && Object.prototype.hasOwnProperty.call(translations, attributeName));
    }
    /**
     * Runs frontend attribute config for model accessor.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @returns {Promise<FrontendAttributeConfig | null>} - Attribute config inferred from model accessor JSDoc.
     */
    async frontendAttributeConfigForModelAccessor({ attributeName, modelClass }) {
        if (!modelClass)
            return null;
        const ownerClassName = this.methodOwnerClassName({ methodName: attributeName, targetClass: modelClass });
        if (!ownerClassName)
            return null;
        const jsDocType = await this.resourceMethodReturnType({
            methodName: attributeName,
            sourceClassName: ownerClassName
        });
        // Frontend attributes hold the serialized (resolved) value, so an async
        // backend accessor typed `Promise<number>` must surface as `number` — the
        // same unwrapping the resource-method inference path applies.
        return jsDocType
            ? { jsDocType: this.frontendResolvableAttributeJsDocType(this.unwrappedPromiseJsDocType({ jsDocType })) }
            : null;
    }
    /**
     * A backend accessor's `@returns` can reference types that exist only on the
     * backend (e.g. a model-local `@typedef AgentRunPlanningArtifact`). The frontend
     * model can't resolve those, so fall back to `any` rather than emitting an
     * undefined type name. Types built only from primitives and known generic
     * builtins pass through unchanged.
     * @param {string} jsDocType - Resolved (Promise-unwrapped) attribute type.
     * @returns {string} - A frontend-resolvable attribute type.
     */
    frontendResolvableAttributeJsDocType(jsDocType) {
        const safeTypeIdentifiers = this.frontendResolvableTypeIdentifiers();
        const referencedIdentifiers = jsDocType.match(/[A-Z][A-Za-z0-9_$]*/g) || [];
        if (referencedIdentifiers.some((identifier) => !safeTypeIdentifiers.has(identifier))) {
            return "any";
        }
        return jsDocType;
    }
    /**
     * Capitalized identifiers a generated frontend model can resolve on its own
     * (primitives are lower-case and matched separately), so only framework-owned
     * and builtin generic types are listed.
     * @returns {Set<string>} - Frontend-resolvable type identifiers.
     */
    frontendResolvableTypeIdentifiers() {
        return new Set([
            "Array", "Date", "Exclude", "Extract", "FrontendModelAttributeValue", "FrontendModelTransportValue",
            "Map", "NonNullable", "Omit", "Partial", "Pick", "Promise", "Readonly", "ReadonlyArray", "Record",
            "Required", "ReturnType", "Set"
        ]);
    }
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
    frontendResolvableCommandJsDocType({ frontendModelFilePath, importAliases, jsDocType, sourceFile }) {
        const safeTypeIdentifiers = this.frontendResolvableTypeIdentifiers();
        /** @type {string[]} */
        const preservedImports = [];
        /**
         * Stores an import expression behind a lowercase placeholder while generic
         * identifier cleanup runs.
         * @param {string} importExpression - Import expression to preserve.
         * @returns {string} Placeholder inserted into the type string.
         */
        const preserveImportExpression = (importExpression) => {
            const placeholder = `__velocious_import_placeholder_${preservedImports.length}__`;
            preservedImports.push(importExpression);
            return placeholder;
        };
        this.assertNoBackendLocalCommandTypeExpressions(jsDocType);
        const withRewrittenInlineImports = jsDocType
            // A type that reaches into a backend source file via `import("...")`
            // (optionally `.Member` and `[]`) is frontend-resolvable only when it
            // points at a generated model file; other backend-local imports collapse
            // to `any` so helper/service implementation details do not leak.
            .replace(/import\(\s*["']([^"']*)["']\s*\)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)((?:\s*\[\s*\])*)/g, (_match, specifier, memberChain, arraySuffix) => {
            const rewrittenSpecifier = this.frontendResolvableJsDocImportSpecifier({
                frontendModelFilePath,
                sourceFile,
                specifier
            });
            if (!rewrittenSpecifier)
                return "any";
            return preserveImportExpression(`import(${JSON.stringify(rewrittenSpecifier)})${memberChain.replace(/\s+/g, "")}${arraySuffix.replace(/\s+/g, "")}`);
        });
        let withRewrittenAliases = withRewrittenInlineImports;
        for (const [aliasName, importAlias] of importAliases) {
            const rewrittenSpecifier = this.frontendResolvableJsDocImportSpecifier({
                frontendModelFilePath,
                sourceFile,
                specifier: importAlias.specifier
            });
            if (!rewrittenSpecifier)
                continue;
            const aliasRegex = new RegExp(`\\b${this.escapeRegExp(aliasName)}\\b`, "g");
            withRewrittenAliases = withRewrittenAliases.replace(aliasRegex, preserveImportExpression(`import(${JSON.stringify(rewrittenSpecifier)}).${importAlias.importedName}`));
        }
        const sanitized = withRewrittenAliases
            // Remaining capitalized identifiers are model classes or otherwise non-resolvable
            // types; downgrade each in place so sibling scalar fields keep their real types.
            .replace(/\b[A-Z][A-Za-z0-9_$]*/g, (identifier) => safeTypeIdentifiers.has(identifier) ? identifier : "any");
        return preservedImports.reduce((type, importExpression, index) => type.replaceAll(`__velocious_import_placeholder_${index}__`, importExpression), sanitized);
    }
    /**
     * Raises when a command JSDoc type references a backend-local helper expression.
     * @param {string} jsDocType - Command JSDoc type.
     * @returns {void} No return value.
     */
    assertNoBackendLocalCommandTypeExpressions(jsDocType) {
        const localReturnTypeMatch = jsDocType.match(/\b(?:Awaited\s*<\s*)?ReturnType\s*<\s*typeof\s+[A-Za-z_$][\w$]*\s*>\s*>?/);
        if (!localReturnTypeMatch)
            return;
        throw new Error(`Custom command JSDoc type cannot use backend-local ReturnType expressions in generated frontend models: ${localReturnTypeMatch[0]}. Move the payload shape to a shared typedef and return that type from the command method.`);
    }
    /**
     * Runs frontend resolvable js doc import specifier.
     * @param {object} args - Arguments.
     * @param {string | null} args.frontendModelFilePath - Generated frontend model file path.
     * @param {string | null} args.sourceFile - Source file that declared the JSDoc type.
     * @param {string} args.specifier - Source-file import specifier.
     * @returns {string | null} - Rewritten frontend-model import specifier, or null when backend-local.
     */
    frontendResolvableJsDocImportSpecifier({ frontendModelFilePath, sourceFile, specifier }) {
        if (!sourceFile || !frontendModelFilePath)
            return null;
        if (!specifier.startsWith(".") && !specifier.startsWith("/"))
            return specifier;
        const importedPath = path.resolve(path.dirname(sourceFile), specifier);
        const modelImportSpecifier = this.frontendModelImportSpecifierForBackendModelPath({
            frontendModelFilePath,
            importedPath
        });
        if (modelImportSpecifier)
            return modelImportSpecifier;
        if (this.filePathIsWithinAnyDirectory({ directories: this.frontendModelJsDocSourceDirectories(), filePath: importedPath })) {
            return null;
        }
        return this.relativeImportSpecifier({ fromFile: frontendModelFilePath, toFile: importedPath });
    }
    /**
     * Runs frontend model import specifier for backend model path.
     * @param {object} args - Arguments.
     * @param {string} args.frontendModelFilePath - Generated frontend model file path.
     * @param {string} args.importedPath - Source-file import path resolved from JSDoc.
     * @returns {string | null} - Generated frontend-model import specifier, or null when the path is not a registered model file.
     */
    frontendModelImportSpecifierForBackendModelPath({ frontendModelFilePath, importedPath }) {
        const frontendModelsDirectory = path.dirname(frontendModelFilePath);
        const importedModelPath = importedPath.endsWith(".js") ? importedPath : `${importedPath}.js`;
        for (const modelFileName of this.generatedFrontendModelFileNames()) {
            for (const sourceDirectory of this.frontendModelJsDocSourceDirectories()) {
                const modelsDirectory = path.join(sourceDirectory, "models");
                const candidateModelPath = path.join(modelsDirectory, modelFileName);
                if (path.resolve(candidateModelPath) !== path.resolve(importedModelPath))
                    continue;
                return this.relativeImportSpecifier({
                    fromFile: frontendModelFilePath,
                    toFile: path.join(frontendModelsDirectory, modelFileName)
                });
            }
        }
        return null;
    }
    /**
     * Runs generated frontend model file names.
     * @returns {Set<string>} - Frontend model filenames that this generation run can emit.
     */
    generatedFrontendModelFileNames() {
        /** @type {Set<string>} */
        const fileNames = new Set();
        for (const backendProject of this.getConfiguration().getBackendProjects()) {
            const resources = this.resourcesForBackendProject(backendProject);
            for (const resourceModelName of Object.keys(resources)) {
                const className = inflection.camelize(resourceModelName.replaceAll("-", "_"));
                fileNames.add(`${inflection.dasherize(inflection.underscore(className))}.js`);
            }
        }
        return fileNames;
    }
    /**
     * Runs relative import specifier.
     * @param {object} args - Arguments.
     * @param {string} args.fromFile - Source file that will contain the import expression.
     * @param {string} args.toFile - File being imported.
     * @returns {string} - Relative import specifier.
     */
    relativeImportSpecifier({ fromFile, toFile }) {
        let relativeSpecifier = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
        if (!relativeSpecifier.startsWith(".")) {
            relativeSpecifier = `./${relativeSpecifier}`;
        }
        return relativeSpecifier;
    }
    /**
     * Runs file path is within any directory.
     * @param {object} args - Arguments.
     * @param {string[]} args.directories - Candidate parent directories.
     * @param {string} args.filePath - File path to test.
     * @returns {boolean} - Whether the file path is under one candidate directory.
     */
    filePathIsWithinAnyDirectory({ directories, filePath }) {
        return directories.some((directory) => {
            const relativePath = path.relative(path.resolve(directory), path.resolve(filePath));
            return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
        });
    }
    /**
     * Escapes text for use inside a RegExp.
     * @param {string} value - Value to escape.
     * @returns {string} - RegExp-safe value.
     */
    escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
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
    customCommandMethodSignature({ commandMetadata, methodName }) {
        const metadata = commandMetadata[methodName] || { args: [], returnType: null };
        const returnType = metadata.returnType || "Record<string, FrontendModelAttributeValue>";
        if (metadata.args.length > 0) {
            const parameterNames = metadata.args.map((arg) => arg.name);
            // A single args object whose every field is optional accepts `{}`, so default
            // the parameter and mark it optional — callers can then omit it entirely
            // (`record.command()` instead of `record.command({})`). Required-field args keep
            // the mandatory parameter (a `{}` default wouldn't satisfy their type).
            const defaultsToEmptyObject = metadata.args.length === 1 && this.argTypeAcceptsEmptyObject(metadata.args[0].type);
            return {
                paramDocs: metadata.args.map((arg) => `   * @param {${arg.type}} ${defaultsToEmptyObject ? `[${arg.name}]` : arg.name} - Command argument.\n`).join(""),
                parameters: defaultsToEmptyObject ? `${parameterNames[0]} = {}` : parameterNames.join(", "),
                payloadArguments: `[${parameterNames.join(", ")}]`,
                returnType
            };
        }
        return {
            paramDocs: "   * @param {...FrontendModelAttributeValue} commandArguments - Custom command arguments.\n",
            parameters: "...commandArguments",
            payloadArguments: "commandArguments",
            returnType
        };
    }
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
    argTypeAcceptsEmptyObject(type) {
        const trimmedType = type.trim();
        // Must be a single balanced object literal: starts with `{`, ends with `}`, and the
        // opening brace closes only at the final character. This rejects intersections/unions
        // like `{a?: x} & {b: string}` that merely happen to start `{` and end `}`.
        if (!(trimmedType.startsWith("{") && trimmedType.endsWith("}")))
            return false;
        if (!this.isSingleBalancedObjectLiteral(trimmedType))
            return false;
        const inner = trimmedType.slice(1, -1);
        for (const member of this.splitTopLevelTypeMembers(inner)) {
            const colonIndex = this.topLevelColonIndex(member);
            // No top-level colon: a call/construct/mapped signature or malformed member —
            // can't confirm it's optional, so treat the type as not empty-defaultable.
            if (colonIndex < 0)
                return false;
            const key = member.slice(0, colonIndex).trim();
            // Index signatures (`[k: string]`) don't require a value; optional props end in `?`.
            // Anything else is a required property, so `{}` would not satisfy the type.
            if (!key.startsWith("[") && !key.endsWith("?"))
                return false;
        }
        return true;
    }
    /**
     * Splits the inner body of an object-literal type into its top-level members,
     * respecting nested `{}` / `[]` / `<>` / `()` so field types like `string[] | null`
     * or `{a: b}` aren't split mid-type. Members are separated by `,` or `;`.
     * @param {string} inner - Object-literal body (without the outer braces).
     * @returns {string[]} - Trimmed non-empty top-level members.
     */
    splitTopLevelTypeMembers(inner) {
        const members = [];
        let depth = 0;
        let start = 0;
        for (let index = 0; index < inner.length; index += 1) {
            const character = inner[index];
            if (character === "{" || character === "[" || character === "<" || character === "(") {
                depth += 1;
            }
            else if (character === "}" || character === "]" || character === ">" || character === ")") {
                depth -= 1;
            }
            else if ((character === "," || character === ";") && depth === 0) {
                members.push(inner.slice(start, index));
                start = index + 1;
            }
        }
        members.push(inner.slice(start));
        return members.map((member) => member.trim()).filter((member) => member.length > 0);
    }
    /**
     * Index of the first top-level `:` in an object-literal member, ignoring colons
     * nested inside `{}` / `[]` / `<>` / `()` (e.g. an index signature `[k: string]`).
     * @param {string} member - A single object-literal member.
     * @returns {number} - The colon index, or -1 when none is found at the top level.
     */
    topLevelColonIndex(member) {
        let depth = 0;
        for (let index = 0; index < member.length; index += 1) {
            const character = member[index];
            if (character === "{" || character === "[" || character === "<" || character === "(") {
                depth += 1;
            }
            else if (character === "}" || character === "]" || character === ">" || character === ")") {
                depth -= 1;
            }
            else if (character === ":" && depth === 0) {
                return index;
            }
        }
        return -1;
    }
    /**
     * Whether the type is a single balanced object literal — its leading `{` closes only
     * at the final character. Rejects top-level intersections/unions like `{a?: x} & {b: y}`
     * or `{a?: x} | string` whose brace depth returns to 0 before the end.
     * @param {string} type - A trimmed type string that starts with `{` and ends with `}`.
     * @returns {boolean} - Whether the braces wrap the whole type.
     */
    isSingleBalancedObjectLiteral(type) {
        let depth = 0;
        for (let index = 0; index < type.length; index += 1) {
            const character = type[index];
            if (character === "{" || character === "[" || character === "<" || character === "(") {
                depth += 1;
            }
            else if (character === "}" || character === "]" || character === ">" || character === ")") {
                depth -= 1;
                // The opening brace balanced before the end, so something follows the literal.
                if (depth === 0 && index < type.length - 1)
                    return false;
            }
        }
        return depth === 0;
    }
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
    async commandMetadataWithResourceJsDoc({ commandMetadata, commandNames, frontendModelFilePath, resourceClass }) {
        if (!resourceClass)
            return commandMetadata;
        /** @type {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} */
        const enriched = { ...commandMetadata };
        for (const commandName of commandNames) {
            const declared = commandMetadata[commandName] || { args: [], returnType: null };
            const sourceClassName = this.methodOwnerClassName({ methodName: commandName, targetClass: resourceClass });
            if (!sourceClassName) {
                enriched[commandName] = declared;
                continue;
            }
            let returnType = declared.returnType;
            if (!returnType) {
                const jsDocReturnType = await this.resourceMethodReturnTypeDefinition({ methodName: commandName, sourceClassName });
                if (jsDocReturnType) {
                    returnType = this.frontendResolvableCommandJsDocType({
                        frontendModelFilePath,
                        importAliases: jsDocReturnType.importAliases,
                        jsDocType: this.unwrappedPromiseJsDocType({ jsDocType: jsDocReturnType.type }),
                        sourceFile: jsDocReturnType.sourceFile
                    });
                }
            }
            let args = declared.args;
            if (!args || args.length === 0) {
                const jsDocParameters = await this.resourceMethodParameters({ methodName: commandName, sourceClassName });
                // Skip object-property tags (`@param {string} args.message`); only the
                // top-level parameters map to method arguments, otherwise the shared
                // `@param {object} args` + property style would emit `name(args, args)`.
                const topLevelParameters = (jsDocParameters || []).filter((parameter) => typeof parameter.name === "string" && !parameter.name.includes("."));
                if (topLevelParameters.length > 0) {
                    args = topLevelParameters.map((parameter) => ({
                        name: /** @type {string} */ (parameter.name),
                        type: this.frontendResolvableCommandJsDocType({
                            frontendModelFilePath,
                            importAliases: parameter.importAliases,
                            jsDocType: parameter.type,
                            sourceFile: parameter.sourceFile
                        })
                    }));
                }
            }
            enriched[commandName] = { args: args || [], returnType: returnType || null };
        }
        return enriched;
    }
    /**
     * Runs unwrapped promise js doc type.
     * @param {object} args - Arguments.
     * @param {string} args.jsDocType - JSDoc type to normalize.
     * @returns {string} - The resolved value type for serialized frontend attributes.
     */
    unwrappedPromiseJsDocType({ jsDocType }) {
        const promisePrefix = "Promise<";
        if (!jsDocType.startsWith(promisePrefix))
            return jsDocType;
        if (!jsDocType.endsWith(">")) {
            throw new Error(`Expected Promise JSDoc type to end with '>': ${jsDocType}`);
        }
        const resolvedType = jsDocType.slice(promisePrefix.length, -1).trim();
        if (resolvedType.length < 1) {
            throw new Error(`Expected Promise JSDoc type to contain a resolved type: ${jsDocType}`);
        }
        return resolvedType;
    }
    /**
     * Runs method owner class name.
     * @param {object} args - Arguments.
     * @param {string} args.methodName - Method name.
     * @param {typeof import("../../../../../database/record/index.js").default | import("../../../../../configuration-types.js").FrontendModelResourceClassType} args.targetClass - Target class.
     * @returns {string | null} - Class name that declares the method.
     */
    methodOwnerClassName({ methodName, targetClass }) {
        let prototype = targetClass.prototype;
        while (prototype && prototype !== Object.prototype) {
            if (Object.prototype.hasOwnProperty.call(prototype, methodName)) {
                const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
                if (typeof descriptor?.value != "function")
                    return null;
                const constructorName = prototype.constructor?.name;
                if (typeof constructorName == "string" && constructorName.length > 0)
                    return constructorName;
                return null;
            }
            prototype = Object.getPrototypeOf(prototype);
        }
        return null;
    }
    /**
     * Runs resource method return type.
     * @param {object} args - Arguments.
     * @param {string} args.methodName - Method name.
     * @param {string} args.sourceClassName - Source class name.
     * @returns {Promise<string | null>} - JSDoc return type when documented.
     */
    async resourceMethodReturnType({ methodName, sourceClassName }) {
        const returnType = await this.resourceMethodReturnTypeDefinition({ methodName, sourceClassName });
        return returnType ? returnType.type : null;
    }
    /**
     * Runs resource method return type definition.
     * @param {object} args - Arguments.
     * @param {string} args.methodName - Method name.
     * @param {string} args.sourceClassName - Source class name.
     * @returns {Promise<ResourceMethodReturnType | null>} - JSDoc return type definition when documented.
     */
    async resourceMethodReturnTypeDefinition({ methodName, sourceClassName }) {
        const resourceMethodReturnTypes = await this.resourceMethodReturnTypes();
        const returnTypeKey = `${sourceClassName}.${methodName}`;
        if (!resourceMethodReturnTypes.has(returnTypeKey))
            return null;
        const returnType = resourceMethodReturnTypes.get(returnTypeKey);
        if (!returnType) {
            throw new Error(`Expected JSDoc return type for ${returnTypeKey}`);
        }
        if (typeof returnType.type != "string" || returnType.type.length < 1) {
            throw new Error(`Expected non-empty JSDoc return type for ${returnTypeKey}`);
        }
        return returnType;
    }
    /**
     * Runs resource method parameter type.
     * @param {{methodName: string, parameterIndex: number, sourceClassName: string}} args - Arguments.
     * @returns {Promise<string | null>} - JSDoc parameter type when documented.
     */
    async resourceMethodParameterType({ methodName, parameterIndex, sourceClassName }) {
        const parameters = await this.resourceMethodParameters({ methodName, sourceClassName });
        if (!parameters)
            return null;
        const parameter = parameters[parameterIndex];
        if (parameter === undefined)
            return null;
        if (parameter.type.length < 1) {
            throw new Error(`Expected non-empty JSDoc parameter type for ${sourceClassName}.${methodName} parameter ${parameterIndex}`);
        }
        return parameter.type;
    }
    /**
     * Runs resource method parameters.
     * @param {{methodName: string, sourceClassName: string}} args - Arguments.
     * @returns {Promise<ResourceMethodParameterType[] | null>} - JSDoc parameters (name + type) when documented.
     */
    async resourceMethodParameters({ methodName, sourceClassName }) {
        const resourceMethodParameterTypes = await this.resourceMethodParameterTypes();
        const parameterTypesKey = `${sourceClassName}.${methodName}`;
        if (!resourceMethodParameterTypes.has(parameterTypesKey))
            return null;
        const parameters = resourceMethodParameterTypes.get(parameterTypesKey);
        if (!parameters) {
            throw new Error(`Expected JSDoc parameters for ${parameterTypesKey}`);
        }
        return parameters;
    }
    /**
     * Runs resource method return types.
     * @returns {Promise<Map<string, ResourceMethodReturnType>>} - Resource method return types keyed by ClassName.methodName.
     */
    async resourceMethodReturnTypes() {
        if (this._resourceMethodReturnTypes)
            return this._resourceMethodReturnTypes;
        const sourceFiles = await this.frontendModelJsDocSourceFiles();
        const returnTypes = new Map();
        for (const sourceFile of sourceFiles) {
            const sourceText = await fs.readFile(sourceFile, "utf8");
            this.addResourceMethodReturnTypesFromSource({ returnTypes, sourceFile, sourceText });
        }
        this._resourceMethodReturnTypes = returnTypes;
        return returnTypes;
    }
    /**
     * Runs resource method parameter types.
     * @returns {Promise<Map<string, ResourceMethodParameterType[]>>} - Resource method parameters keyed by ClassName.methodName.
     */
    async resourceMethodParameterTypes() {
        if (this._resourceMethodParameterTypes)
            return this._resourceMethodParameterTypes;
        const sourceFiles = await this.frontendModelJsDocSourceFiles();
        const parameterTypes = new Map();
        for (const sourceFile of sourceFiles) {
            const sourceText = await fs.readFile(sourceFile, "utf8");
            this.addResourceMethodParameterTypesFromSource({ parameterTypes, sourceFile, sourceText });
        }
        this._resourceMethodParameterTypes = parameterTypes;
        return parameterTypes;
    }
    /**
     * Runs frontend model JSDoc source files.
     * @returns {Promise<string[]>} - JavaScript source files that can define frontend-model resources and model accessors.
     */
    async frontendModelJsDocSourceFiles() {
        const sourceFiles = [];
        for (const sourceDirectory of this.frontendModelJsDocSourceDirectories()) {
            sourceFiles.push(...await this.javascriptFilesInDirectory(sourceDirectory));
        }
        return sourceFiles;
    }
    /**
     * Runs frontend model JSDoc source directories.
     * @returns {string[]} - Source directories to scan for generated frontend-model JSDoc.
     */
    frontendModelJsDocSourceDirectories() {
        const sourceDirectories = new Set([path.join(this.directory(), "src")]);
        for (const backendProject of this.getConfiguration().getBackendProjects()) {
            if (typeof backendProject.path == "string" && backendProject.path.length > 0) {
                sourceDirectories.add(path.join(backendProject.path, "src"));
            }
        }
        return Array.from(sourceDirectories);
    }
    /**
     * Adds resource method return types from source.
     * @param {object} args - Arguments.
     * @param {Map<string, ResourceMethodReturnType>} args.returnTypes - Mutable return types map.
     * @param {string | null} [args.sourceFile] - Source file path.
     * @param {string} args.sourceText - Source text.
     * @returns {void}
     */
    addResourceMethodReturnTypesFromSource({ returnTypes, sourceFile = null, sourceText }) {
        const classRegex = /class\s+([A-Za-z_$][\w$]*)\s+(?:extends\s+[^{]+)?\{/g;
        const importAliases = this.jsDocImportAliasesFromSource(sourceText);
        let classMatch;
        while ((classMatch = classRegex.exec(sourceText))) {
            const className = classMatch[1];
            const classBodyStart = classRegex.lastIndex;
            const classBodyEnd = this.matchingBraceIndex({ openIndex: classBodyStart - 1, sourceText });
            if (classBodyEnd == null) {
                // The brace matcher can't tokenize every construct (e.g. a regex literal
                // whose quotes look like string delimiters), so it can fail to locate a
                // class body. Skip metadata extraction for that class rather than
                // aborting the whole frontend-model generation; resources that parse
                // cleanly still get their JSDoc-derived return/param types.
                continue;
            }
            const classBody = sourceText.slice(classBodyStart, classBodyEnd);
            const jsDocRegex = /\/\*\*([\s\S]*?)\*\//g;
            let jsDocMatch;
            while ((jsDocMatch = jsDocRegex.exec(classBody))) {
                const sourceAfterJsDoc = classBody.slice(jsDocRegex.lastIndex);
                const methodMatch = sourceAfterJsDoc.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
                if (!methodMatch)
                    continue;
                const methodName = methodMatch[1];
                const returnType = this.jsDocReturnType(jsDocMatch[1]);
                if (returnType) {
                    returnTypes.set(`${className}.${methodName}`, { importAliases, sourceFile, type: returnType });
                }
            }
            classRegex.lastIndex = classBodyEnd + 1;
        }
    }
    /**
     * Adds resource method parameter types from source.
     * @param {{parameterTypes: Map<string, ResourceMethodParameterType[]>, sourceFile?: string | null, sourceText: string}} args - Arguments.
     * @returns {void}
     */
    addResourceMethodParameterTypesFromSource({ parameterTypes, sourceFile = null, sourceText }) {
        const classRegex = /class\s+([A-Za-z_$][\w$]*)\s+(?:extends\s+[^{]+)?\{/g;
        const importAliases = this.jsDocImportAliasesFromSource(sourceText);
        let classMatch;
        while ((classMatch = classRegex.exec(sourceText))) {
            const className = classMatch[1];
            const classBodyStart = classRegex.lastIndex;
            const classBodyEnd = this.matchingBraceIndex({ openIndex: classBodyStart - 1, sourceText });
            if (classBodyEnd == null) {
                // The brace matcher can't tokenize every construct (e.g. a regex literal
                // whose quotes look like string delimiters), so it can fail to locate a
                // class body. Skip metadata extraction for that class rather than
                // aborting the whole frontend-model generation; resources that parse
                // cleanly still get their JSDoc-derived return/param types.
                continue;
            }
            const classBody = sourceText.slice(classBodyStart, classBodyEnd);
            const jsDocRegex = /\/\*\*([\s\S]*?)\*\//g;
            let jsDocMatch;
            while ((jsDocMatch = jsDocRegex.exec(classBody))) {
                const sourceAfterJsDoc = classBody.slice(jsDocRegex.lastIndex);
                const methodMatch = sourceAfterJsDoc.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
                if (!methodMatch)
                    continue;
                const methodName = methodMatch[1];
                const jsDocParameters = this.jsDocParameters(jsDocMatch[1]);
                if (jsDocParameters.length > 0) {
                    parameterTypes.set(`${className}.${methodName}`, jsDocParameters.map((parameter) => ({ ...parameter, importAliases, sourceFile })));
                }
            }
            classRegex.lastIndex = classBodyEnd + 1;
        }
    }
    /**
     * Runs JSDoc import aliases from source.
     * @param {string} sourceText - Source text.
     * @returns {Map<string, ResourceJsDocImportAlias>} - Import aliases keyed by local name.
     */
    jsDocImportAliasesFromSource(sourceText) {
        const importAliases = new Map();
        const importRegex = /@import\s*\{\s*([^}]+?)\s*\}\s*from\s*["']([^"']+)["']/g;
        let importMatch;
        while ((importMatch = importRegex.exec(sourceText))) {
            const importList = importMatch[1];
            const specifier = importMatch[2];
            for (const rawImportEntry of importList.split(",")) {
                const importEntry = rawImportEntry.trim();
                if (importEntry.length < 1)
                    continue;
                const entryMatch = importEntry.match(/^(default|[A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
                if (!entryMatch) {
                    throw new Error(`Could not parse JSDoc @import entry: ${importEntry}`);
                }
                const importedName = entryMatch[1];
                const aliasName = entryMatch[2] || importedName;
                importAliases.set(aliasName, { importedName, specifier });
            }
        }
        return importAliases;
    }
    /**
     * Runs js doc return type.
     * @param {string} jsDocText - JSDoc text inside comment markers.
     * @returns {string | null} - JSDoc return type when present.
     */
    jsDocReturnType(jsDocText) {
        const returnsMatch = jsDocText.match(/@returns?\s*\{/);
        if (!returnsMatch || returnsMatch.index == null)
            return null;
        const typeOpenIndex = returnsMatch.index + returnsMatch[0].length - 1;
        const typeCloseIndex = this.matchingBraceIndex({ openIndex: typeOpenIndex, sourceText: jsDocText });
        if (typeCloseIndex == null) {
            throw new Error(`Could not parse JSDoc return type from: ${jsDocText}`);
        }
        const returnType = this.normalizeJsDocType(jsDocText.slice(typeOpenIndex + 1, typeCloseIndex));
        if (returnType.length < 1) {
            throw new Error(`Expected non-empty JSDoc return type in: ${jsDocText}`);
        }
        return returnType;
    }
    /**
     * Collapses a JSDoc type spanning multiple comment lines into a single line so it can
     * be emitted into an inline type-assertion cast. A multiline backend return type keeps
     * its leading continuation asterisks in the captured substring, which are invalid inside
     * an inline cast and make TypeScript read the asserted type as `undefined`.
     * @param {string} jsDocType - Raw captured JSDoc type, possibly multiline.
     * @returns {string} - Single-line JSDoc type.
     */
    normalizeJsDocType(jsDocType) {
        return jsDocType.replace(/\s*\n\s*\*?[ \t]*/g, " ").trim();
    }
    /**
     * Runs js doc parameters.
     * @param {string} jsDocText - JSDoc text inside comment markers.
     * @returns {Array<{name: string | null, type: string}>} - JSDoc parameters (name + type) in declaration order.
     */
    jsDocParameters(jsDocText) {
        const parameters = [];
        const paramRegex = /@param\s*\{/g;
        let _paramMatch;
        while ((_paramMatch = paramRegex.exec(jsDocText))) {
            const typeOpenIndex = paramRegex.lastIndex - 1;
            const typeCloseIndex = this.matchingBraceIndex({ openIndex: typeOpenIndex, sourceText: jsDocText });
            if (typeCloseIndex == null) {
                throw new Error(`Could not parse JSDoc parameter type from: ${jsDocText}`);
            }
            const type = this.normalizeJsDocType(jsDocText.slice(typeOpenIndex + 1, typeCloseIndex));
            if (type.length < 1) {
                throw new Error(`Expected non-empty JSDoc parameter type in: ${jsDocText}`);
            }
            // After the closing brace the parameter name follows (optionally bracketed
            // for `@param {type} [name]`). Capture the leading name token — including any
            // dotted path so object-property tags like `@param {string} args.message` stay
            // distinguishable from the top-level `@param {object} args` parameter.
            const nameMatch = jsDocText.slice(typeCloseIndex + 1).match(/^\s*\[?\s*([A-Za-z_$][\w$.]*)/);
            parameters.push({ name: nameMatch ? nameMatch[1] : null, type });
            paramRegex.lastIndex = typeCloseIndex + 1;
        }
        return parameters;
    }
    /**
     * Runs javascript files in directory.
     * @param {string} directory - Directory path.
     * @returns {Promise<string[]>} - JavaScript source file paths.
     */
    async javascriptFilesInDirectory(directory) {
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        }
        catch (error) {
            if (error && typeof error == "object" && "code" in error && error.code === "ENOENT")
                return [];
            throw error;
        }
        const filePaths = [];
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                filePaths.push(...await this.javascriptFilesInDirectory(entryPath));
            }
            else if (entry.isFile() && /\.(mjs|js|jsx|ts)$/.test(entry.name)) {
                filePaths.push(entryPath);
            }
        }
        return filePaths;
    }
    /**
     * Finds a matching closing brace while respecting JavaScript strings and comments.
     * @param {object} args - Arguments.
     * @param {number} args.openIndex - Opening brace index.
     * @param {string} args.sourceText - Source text.
     * @returns {number | null} - Closing brace index when found.
     */
    matchingBraceIndex({ openIndex, sourceText }) {
        if (sourceText[openIndex] !== "{") {
            throw new Error(`Expected opening brace at index ${openIndex}`);
        }
        let depth = 0;
        let inBlockComment = false;
        let inLineComment = false;
        let inString = "";
        for (let index = openIndex; index < sourceText.length; index++) {
            const char = sourceText[index];
            const nextChar = sourceText[index + 1];
            const previousChar = sourceText[index - 1];
            if (inLineComment) {
                if (char === "\n")
                    inLineComment = false;
                continue;
            }
            if (inBlockComment) {
                if (char === "*" && nextChar === "/") {
                    inBlockComment = false;
                    index++;
                }
                continue;
            }
            if (inString) {
                if (char === inString && previousChar !== "\\")
                    inString = "";
                continue;
            }
            if (char === "/" && nextChar === "/") {
                inLineComment = true;
                index++;
                continue;
            }
            if (char === "/" && nextChar === "*") {
                inBlockComment = true;
                index++;
                continue;
            }
            if (char === "\"" || char === "'" || char === "`") {
                inString = char;
                continue;
            }
            if (char === "{") {
                depth++;
            }
            else if (char === "}") {
                depth--;
                if (depth === 0)
                    return index;
            }
        }
        return null;
    }
    /**
     * Runs frontend attribute config for model attribute.
     * @param {object} args - Arguments.
     * @param {string} args.attributeName - Frontend model attribute name.
     * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
     * @returns {FrontendAttributeConfig | null} - Attribute config inferred from the backend model when available.
     */
    frontendAttributeConfigForModelAttribute({ attributeName, modelClass }) {
        if (!modelClass) {
            return null;
        }
        const resolvedAttributeName = modelClass.resolveAttributeName(attributeName);
        if (!resolvedAttributeName)
            return null;
        let columnName;
        try {
            columnName = modelClass.getAttributeNameToColumnNameMap()[resolvedAttributeName];
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("used before initialization"))
                return null;
            throw error;
        }
        if (!columnName) {
            return null;
        }
        let column;
        try {
            column = modelClass.getColumnsHash()[columnName];
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("used before initialization"))
                return null;
            throw error;
        }
        return column ? this.frontendAttributeConfigForColumn({ column }) : null;
    }
    /**
     * Runs frontend attribute config for column.
     * @param {object} args - Arguments.
     * @param {import("../../../../../database/drivers/base-column.js").default} args.column - Database column.
     * @returns {FrontendAttributeConfig} - Attribute config inferred from the database column.
     */
    frontendAttributeConfigForColumn({ column }) {
        const type = column.getType();
        if (typeof type != "string" || type.length < 1) {
            throw new Error(`Expected non-empty column type for frontend model attribute inference, got: ${type}`);
        }
        return {
            null: column.getNull(),
            type
        };
    }
    /**
     * Runs relationships for model.
     * @param {object} args - Arguments.
     * @param {string} args.className - Model class name.
     * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {Array<{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationships.
     */
    relationshipsForModel({ className, modelConfig, resourceClass }) {
        const relationships = modelConfig.relationships;
        if (relationships === undefined || relationships === null) {
            return [];
        }
        if (!Array.isArray(relationships)) {
            throw new Error(`Model '${className}' has invalid relationships config — must be an array of relationship names, got ${typeof relationships}`);
        }
        return relationships.map((relationshipName) => this.inferredRelationshipDefinition({ className, relationshipName, resourceClass }));
    }
    /**
     * Runs inferred relationship definition.
     * @param {object} args - Arguments.
     * @param {string} args.className - Model class name.
     * @param {string} args.relationshipName - Relationship name.
     * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
     * @returns {{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}} Inferred relationship definition.
     */
    inferredRelationshipDefinition({ className, relationshipName, resourceClass }) {
        const modelClass = resourceClass ? resourceClass.modelClass() : this.getConfiguration().getModelClass(className);
        const relationship = modelClass.getRelationshipByName(relationshipName);
        const relationshipType = relationship.getType();
        if (relationshipType !== "belongsTo" && relationshipType !== "hasOne" && relationshipType !== "hasMany") {
            throw new Error(`Model '${className}' relationship '${relationshipName}' has unsupported type '${relationshipType}'`);
        }
        let targetClassName;
        try {
            const targetModelClass = relationship.getTargetModelClass();
            targetClassName = targetModelClass?.getModelName();
        }
        catch {
            // Model class not registered yet — fall back to className from relationship definition
        }
        if (!targetClassName) {
            targetClassName = relationship.className;
            if (!targetClassName) {
                throw new Error(`Model '${className}' relationship '${relationshipName}' has no target model class`);
            }
        }
        return {
            autoload: relationship.getAutoload(),
            relationshipName,
            targetClassName,
            targetFileName: inflection.dasherize(inflection.underscore(targetClassName)),
            type: relationshipType
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL2dlbmVyYXRlL2Zyb250ZW5kLW1vZGVscy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSxvQ0FBb0MsQ0FBQTtBQUM1RCxPQUFPLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDNUIsT0FBTyxtQkFBbUIsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1RCxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLDhCQUE4QixFQUFFLG1EQUFtRCxFQUFDLE1BQU0sc0RBQXNELENBQUE7QUFDeEosT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGdEQUFnRCxFQUFDLE1BQU0sdURBQXVELENBQUE7QUFDaEssT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0seURBQXlELENBQUE7QUFFaEg7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNIOzs7R0FHRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUNILE1BQU0sa0NBQWtDLEdBQUcsb0NBQW9DLENBQUE7QUFFL0UsbUdBQW1HO0FBQ25HLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0JBQXlCLFNBQVEsV0FBVztJQUMvRCwyREFBMkQ7SUFDM0QsMEJBQTBCLEdBQUcsSUFBSSxDQUFBO0lBRWpDLGdFQUFnRTtJQUNoRSw2QkFBNkIsR0FBRyxJQUFJLENBQUE7SUFFcEM7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUM3QyxNQUFNLGVBQWUsR0FBRyxhQUFhLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtRQUUxRCxNQUFNLGFBQWEsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRXRDLE1BQU0sa0JBQWtCLEdBQUcsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFFaEUsSUFBSSxPQUFPLGtCQUFrQixDQUFDLHFCQUFxQixLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ25FLE1BQU0sa0JBQWtCLENBQUMscUJBQXFCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDL0QsQ0FBQztRQUVELElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxJQUFJLGVBQWUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDcEUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5RkFBeUYsQ0FBQyxDQUFBO1FBQzVHLENBQUM7UUFFRDs7aUNBRXlCO1FBQ3pCLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNwQzs7OENBRXNDO1FBQ3RDLE1BQU0sOEJBQThCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNoRDs7K0VBRXVFO1FBQ3ZFLE1BQU0seUJBQXlCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUUzQyxLQUFLLE1BQU0sY0FBYyxJQUFJLGVBQWUsRUFBRSxDQUFDO1lBQzdDLHdFQUF3RTtZQUN4RSx3RUFBd0U7WUFDeEUsd0VBQXdFO1lBQ3hFLDRFQUE0RTtZQUM1RSwwRUFBMEU7WUFDMUUsK0NBQStDO1lBQy9DLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsd0NBQXdDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQTtZQUNyRyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsb0NBQW9DLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtZQUUvRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQztnQkFDL0MsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLGlCQUFpQixFQUFFLEVBQUMsU0FBUyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBQ3BELGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1lBQzNDLENBQUM7WUFFRCxJQUFJLENBQUMseUJBQXlCLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQztnQkFDdEQseUJBQXlCLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLEVBQUUsQ0FBQyxDQUFBO1lBQ3RELENBQUM7WUFFRCxJQUFJLENBQUMsOEJBQThCLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQztnQkFDM0QsOEJBQThCLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQTtZQUNsRSxDQUFDO1lBRUQsTUFBTSxjQUFjLEdBQUcseUJBQXlCLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLENBQUE7WUFDdkUsTUFBTSxtQkFBbUIsR0FBRyw4QkFBOEIsQ0FBQyxHQUFHLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtZQUVqRixJQUFJLENBQUMsY0FBYztnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxpQkFBaUIsRUFBRSxDQUFDLENBQUE7WUFDN0YsSUFBSSxDQUFDLG1CQUFtQjtnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlDQUF5QyxpQkFBaUIsRUFBRSxDQUFDLENBQUE7WUFDdkcsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQ2pFLE1BQU0sZ0NBQWdDLEdBQUcsSUFBSSxDQUFDLGdDQUFnQyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBRXpGLEtBQUssTUFBTSxjQUFjLElBQUksU0FBUyxFQUFFLENBQUM7Z0JBQ3ZDLE1BQU0sV0FBVyxHQUFHLGdEQUFnRCxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFBO2dCQUMvRixNQUFNLFNBQVMsR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUE7Z0JBQzFFLE1BQU0sUUFBUSxHQUFHLEdBQUcsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEtBQUssQ0FBQTtnQkFDL0UsTUFBTSxRQUFRLEdBQUcsR0FBRyxpQkFBaUIsSUFBSSxRQUFRLEVBQUUsQ0FBQTtnQkFFbkQsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO29CQUNqQixNQUFNLElBQUksS0FBSyxDQUFDLG1EQUFtRCxTQUFTLEdBQUcsQ0FBQyxDQUFBO2dCQUNsRixDQUFDO2dCQUVELE1BQU0scUJBQXFCLEdBQUcsd0NBQXdDLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUE7Z0JBQ2pHLHlFQUF5RTtnQkFDekUscUVBQXFFO2dCQUNyRSx3RUFBd0U7Z0JBQ3hFLHdFQUF3RTtnQkFDeEUsK0RBQStEO2dCQUMvRCxNQUFNLGFBQWEsR0FBRyxxQkFBcUIsSUFBSSxxQkFBcUIsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7Z0JBRTlHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLGdDQUFnQyxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtnQkFFbkcsSUFBSSxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztvQkFDdkMsSUFBSSw4QkFBOEIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsU0FBUyxDQUFDLGNBQWMsQ0FBQyxFQUFDLENBQUMsRUFBRSxDQUFDO3dCQUMvRyxTQUFRO29CQUNWLENBQUM7b0JBRUQsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsU0FBUyxHQUFHLENBQUMsQ0FBQTtnQkFDM0UsQ0FBQztnQkFFRCxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUE7Z0JBRWxDLE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDO29CQUNuRCxTQUFTO29CQUNULHFCQUFxQixFQUFFLFFBQVE7b0JBQy9CLFVBQVU7b0JBQ1YsVUFBVSxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUMsU0FBUyxDQUFDO29CQUNuRyxXQUFXO29CQUNYLGFBQWE7aUJBQ2QsQ0FBQyxDQUFBO2dCQUVGLE1BQU0sRUFBRSxDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUUsV0FBVyxDQUFDLENBQUE7Z0JBQ3pDLGNBQWMsQ0FBQyxJQUFJLENBQUMsRUFBQyxTQUFTLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtnQkFFMUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsUUFBUSxFQUFFLENBQUMsQ0FBQTtZQUN2RCxDQUFDO1FBQ0gsQ0FBQztRQUVELEtBQUssTUFBTSxDQUFDLGlCQUFpQixFQUFFLGNBQWMsQ0FBQyxJQUFJLHlCQUF5QixFQUFFLENBQUM7WUFDNUUsOEVBQThFO1lBQzlFLCtFQUErRTtZQUMvRSxxREFBcUQ7WUFDckQsTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsaUJBQWlCLFdBQVcsRUFBRSxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBRTNELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxjQUFjLENBQUMsQ0FBQTtZQUUvRCxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUMsR0FBRyxpQkFBaUIsV0FBVyxFQUFFLFlBQVksQ0FBQyxDQUFBO1lBRWpFLE9BQU8sQ0FBQyxHQUFHLENBQUMscUNBQXFDLENBQUMsQ0FBQTtRQUNwRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsbUJBQW1CLENBQUMsRUFBQyxnQ0FBZ0MsRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBQztRQUMzRixNQUFNLFNBQVMsR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFBO1FBRXZDLElBQUksQ0FBQyxTQUFTLElBQUksT0FBTyxTQUFTLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDaEQsTUFBTSxJQUFJLEtBQUssQ0FBQyxVQUFVLFNBQVMsMENBQTBDLENBQUMsQ0FBQTtRQUNoRixDQUFDO1FBRUQsTUFBTSxXQUFXLEdBQUc7WUFDbEIsRUFBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRSxTQUFTLENBQUMsS0FBSyxFQUFDO1lBQ2pELEVBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUUsU0FBUyxDQUFDLElBQUksRUFBQztTQUNoRCxDQUFBO1FBRUQsS0FBSyxNQUFNLEVBQUMsTUFBTSxFQUFFLGFBQWEsRUFBQyxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2xELElBQUksT0FBTyxhQUFhLEtBQUssUUFBUSxJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ2xFLE1BQU0sSUFBSSxLQUFLLENBQUMsVUFBVSxTQUFTLG1DQUFtQyxNQUFNLFNBQVMsQ0FBQyxDQUFBO1lBQ3hGLENBQUM7UUFDSCxDQUFDO1FBRUQsTUFBTSxhQUFhLEdBQUcsV0FBVyxDQUFDLGFBQWEsQ0FBQTtRQUUvQyxJQUFJLGFBQWEsS0FBSyxTQUFTO1lBQUUsT0FBTTtRQUV2QyxNQUFNLHVCQUF1QixHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxXQUFXLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUVuRyxLQUFLLE1BQU0sWUFBWSxJQUFJLHVCQUF1QixFQUFFLENBQUM7WUFDbkQsSUFBSSxDQUFDLGdDQUFnQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztnQkFDeEUsTUFBTSxJQUFJLEtBQUssQ0FBQyxVQUFVLFNBQVMsbUJBQW1CLFlBQVksQ0FBQyxnQkFBZ0IsaUJBQWlCLFlBQVksQ0FBQyxlQUFlLGtGQUFrRixDQUFDLENBQUE7WUFDck4sQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDBCQUEwQixDQUFDLGNBQWM7UUFDdkMsT0FBTyxtREFBbUQsQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUM1RSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdDQUFnQyxDQUFDLFNBQVM7UUFDeEM7O2lDQUV5QjtRQUN6QixNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRTVCLEtBQUssTUFBTSxpQkFBaUIsSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUMxQyxVQUFVLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDN0UsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsd0NBQXdDLENBQUMsY0FBYztRQUNyRCxNQUFNLFVBQVUsR0FBRyxjQUFjLENBQUMsd0JBQXdCLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBRTlFLE9BQU8sR0FBRyxVQUFVLHNCQUFzQixDQUFBO0lBQzVDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0NBQW9DLENBQUMsaUJBQWlCO1FBQ3BELE1BQU0sT0FBTyxHQUFHLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO1FBRTdFLElBQUksT0FBTyxFQUFFLENBQUM7WUFDWixPQUFPLHlDQUF5QyxDQUFBO1FBQ2xELENBQUM7UUFFRCxPQUFPLDZDQUE2QyxDQUFBO0lBQ3RELENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLEVBQUMsU0FBUyxFQUFFLHFCQUFxQixFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBQztRQUNoSCxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDL0csTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEVBQUMsU0FBUyxFQUFFLFdBQVcsRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBQ3pGLE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQyxXQUFXLElBQUksT0FBTyxXQUFXLENBQUMsV0FBVyxLQUFLLFFBQVE7WUFDeEYsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxXQUFXO1lBQ3pCLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFDTixNQUFNLGtCQUFrQixHQUFHLEdBQUcsU0FBUyxZQUFZLENBQUE7UUFDbkQsTUFBTSx3QkFBd0IsR0FBRyxHQUFHLFNBQVMsa0JBQWtCLENBQUE7UUFDL0QsTUFBTSx3QkFBd0IsR0FBRyxHQUFHLFNBQVMsa0JBQWtCLENBQUE7UUFDL0QsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3BFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDLDJCQUEyQixDQUFDLGFBQWEsSUFBSSxJQUFJLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFDL0YsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsMkJBQTJCLENBQUMsYUFBYSxJQUFJLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUMvRixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxlQUFlLEVBQUUscUJBQXFCLENBQUMsTUFBTSxDQUFDLHFCQUFxQixDQUFDLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUN4SixNQUFNLGtCQUFrQixHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLDZCQUE2QixDQUFDLENBQUM7ZUFDakgsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUMsZUFBZSxFQUFFLEVBQUUsQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdkosTUFBTSx5QkFBeUIsR0FBRztZQUNoQyxNQUFNLEVBQUUsV0FBVyxDQUFDLHlCQUF5QixDQUFDLE1BQU0sSUFBSSxRQUFRO1lBQ2hFLEtBQUssRUFBRSxXQUFXLENBQUMseUJBQXlCLENBQUMsS0FBSyxJQUFJLE9BQU87U0FDOUQsQ0FBQTtRQUNELE1BQU0scUJBQXFCLEdBQUc7WUFDNUIsTUFBTSxFQUFFLFdBQVcsQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLElBQUksUUFBUTtZQUM1RCxPQUFPLEVBQUUsV0FBVyxDQUFDLHFCQUFxQixDQUFDLE9BQU8sSUFBSSxTQUFTO1lBQy9ELFFBQVEsRUFBRSxXQUFXLENBQUMscUJBQXFCLENBQUMsUUFBUSxJQUFJLFVBQVU7WUFDbEUsSUFBSSxFQUFFLFdBQVcsQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLElBQUksTUFBTTtZQUN0RCxNQUFNLEVBQUUsV0FBVyxDQUFDLHFCQUFxQixDQUFDLE1BQU0sSUFBSSxRQUFRO1lBQzVELEdBQUcsRUFBRSxXQUFXLENBQUMscUJBQXFCLENBQUMsR0FBRyxJQUFJLEtBQUs7U0FDcEQsQ0FBQTtRQUNELE1BQU0sa0JBQWtCLEdBQUcsV0FBVyxDQUFDLGtCQUFrQixDQUFBO1FBQ3pELE1BQU0sY0FBYyxHQUFHLFdBQVcsQ0FBQyxjQUFjLENBQUE7UUFFakQsSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLGtCQUFrQixFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDbkQsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQ0FBc0MsU0FBUyx3REFBd0QsQ0FBQyxDQUFBO1FBQzFILENBQUM7UUFFRCxNQUFNLHVCQUF1QixHQUFHLFdBQVcsQ0FBQyxlQUFlLElBQUksRUFBRSxDQUFBO1FBQ2pFLE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBSSxDQUFDLGdDQUFnQyxDQUFDO1lBQ2xFLGVBQWUsRUFBRSx1QkFBdUI7WUFDeEMsWUFBWSxFQUFFLENBQUMsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ2xGLHFCQUFxQjtZQUNyQixhQUFhO1NBQ2QsQ0FBQyxDQUFBO1FBQ0YsTUFBTSxtQ0FBbUMsR0FBRyx5QkFBeUIsQ0FBQyxNQUFNLEtBQUssUUFBUSxJQUFJLHlCQUF5QixDQUFDLEtBQUssS0FBSyxPQUFPLENBQUE7UUFDeEksTUFBTSwrQkFBK0IsR0FBRyxxQkFBcUIsQ0FBQyxNQUFNLEtBQUssUUFBUTtlQUM1RSxxQkFBcUIsQ0FBQyxPQUFPLEtBQUssU0FBUztlQUMzQyxxQkFBcUIsQ0FBQyxRQUFRLEtBQUssVUFBVTtlQUM3QyxxQkFBcUIsQ0FBQyxJQUFJLEtBQUssTUFBTTtlQUNyQyxxQkFBcUIsQ0FBQyxNQUFNLEtBQUssUUFBUTtlQUN6QyxxQkFBcUIsQ0FBQyxHQUFHLEtBQUssS0FBSyxDQUFBO1FBQ3hDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtRQUNyRyxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxFQUFDLGtCQUFrQixFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDbkcsTUFBTSx3QkFBd0IsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFBO1FBRTNGLElBQUksV0FBVyxHQUFHLG1CQUFtQixDQUFDLGtDQUFrQyxDQUFDLENBQUE7UUFFekUsV0FBVyxJQUFJLGtDQUFrQyxVQUFVLEtBQUssQ0FBQTtRQUVoRSxXQUFXLElBQUksSUFBSSxDQUFBO1FBQ25CLFdBQVcsSUFBSSxPQUFPLENBQUE7UUFDdEIsV0FBVyxJQUFJLHNDQUFzQyxDQUFBO1FBQ3JELFdBQVcsSUFBSSx3QkFBd0IsVUFBVSwrREFBK0QsQ0FBQTtRQUNoSCxXQUFXLElBQUksT0FBTyxDQUFBO1FBQ3RCLFdBQVcsSUFBSSxPQUFPLENBQUE7UUFDdEIsV0FBVyxJQUFJLG9GQUFvRixDQUFBO1FBQ25HLFdBQVcsSUFBSSx3QkFBd0IsVUFBVSwrREFBK0QsQ0FBQTtRQUNoSCxXQUFXLElBQUksT0FBTyxDQUFBO1FBQ3RCLElBQUksa0JBQWtCLEVBQUUsQ0FBQztZQUN2QixXQUFXLElBQUksT0FBTyxDQUFBO1lBQ3RCLFdBQVcsSUFBSSxxRkFBcUYsQ0FBQTtZQUNwRyxXQUFXLElBQUksd0JBQXdCLFVBQVUsK0RBQStELENBQUE7WUFDaEgsV0FBVyxJQUFJLE9BQU8sQ0FBQTtRQUN4QixDQUFDO1FBQ0QsV0FBVyxJQUFJLElBQUksQ0FBQTtRQUNuQixXQUFXLElBQUksT0FBTyxDQUFBO1FBQ3RCLFdBQVcsSUFBSSxNQUFNLGtCQUFrQixVQUFVLENBQUE7UUFDakQsV0FBVyxJQUFJLHdCQUF3QixrQkFBa0IsSUFBSSxDQUFBO1FBQzdELEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7WUFDbkMsV0FBVyxJQUFJLGlCQUFpQixTQUFTLENBQUMsU0FBUyxLQUFLLFNBQVMsQ0FBQyxJQUFJLHVCQUF1QixDQUFBO1FBQy9GLENBQUM7UUFDRCxXQUFXLElBQUksT0FBTyxDQUFBO1FBQ3RCLEtBQUssTUFBTSxlQUFlLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztZQUMvQyxXQUFXLElBQUksT0FBTyxDQUFBO1lBQ3RCLFdBQVcsSUFBSSxxQ0FBcUMsZUFBZSxDQUFDLGdCQUFnQixZQUFZLENBQUE7WUFDaEcsV0FBVyxJQUFJLHdCQUF3QixlQUFlLENBQUMsUUFBUSxJQUFJLENBQUE7WUFDbkUsS0FBSyxNQUFNLGVBQWUsSUFBSSxlQUFlLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQ3pELFdBQVcsSUFBSSxpQkFBaUIsZUFBZSxDQUFDLElBQUksTUFBTSxlQUFlLENBQUMsSUFBSSxjQUFjLGVBQWUsQ0FBQyxJQUFJLFdBQVcsQ0FBQTtZQUM3SCxDQUFDO1lBQ0QsV0FBVyxJQUFJLE9BQU8sQ0FBQTtRQUN4QixDQUFDO1FBQ0QsV0FBVyxJQUFJLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLEVBQUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxnQkFBZ0IsRUFBRSxlQUFlLEVBQUUscUJBQXFCLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSx3QkFBd0IsRUFBQyxDQUFDLENBQUE7UUFDM00sV0FBVyxJQUFJLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLEVBQUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxnQkFBZ0IsRUFBRSxlQUFlLEVBQUUscUJBQXFCLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSx3QkFBd0IsRUFBQyxDQUFDLENBQUE7UUFDM00sV0FBVyxJQUFJLE9BQU8sQ0FBQTtRQUN0QixXQUFXLElBQUkseUJBQXlCLFNBQVMsS0FBSyxDQUFBO1FBQ3RELFdBQVcsSUFBSSxtQ0FBbUMsa0JBQWtCLEtBQUssd0JBQXdCLEtBQUssd0JBQXdCLEtBQUssbUJBQW1CLEtBQUssd0JBQXdCLE1BQU0sQ0FBQTtRQUN6TCxXQUFXLElBQUksT0FBTyxDQUFBO1FBQ3RCLFdBQVcsSUFBSSxTQUFTLFNBQVMsZ0NBQWdDLENBQUE7UUFDakUsV0FBVyxJQUFJLHNFQUFzRSxDQUFBO1FBQ3JGLFdBQVcsSUFBSSwrQkFBK0IsQ0FBQTtRQUM5QyxXQUFXLElBQUksZ0JBQWdCLENBQUE7UUFDL0IsV0FBVyxJQUFJLG9CQUFvQixJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUE7UUFDakUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN4QyxXQUFXLElBQUksd0JBQXdCLENBQUE7WUFDdkMsS0FBSyxNQUFNLENBQUMsY0FBYyxFQUFFLGdCQUFnQixDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO2dCQUM3RSxNQUFNLGNBQWMsR0FBRyxnQkFBZ0IsSUFBSSxPQUFPLGdCQUFnQixLQUFLLFFBQVEsSUFBSSxnQkFBZ0IsQ0FBQyxJQUFJLEtBQUssU0FBUztvQkFDcEgsQ0FBQyxDQUFDLFNBQVM7b0JBQ1gsQ0FBQyxDQUFDLFFBQVEsQ0FBQTtnQkFFWixJQUFJLGdCQUFnQixDQUFDLElBQUksRUFBRSxDQUFDO29CQUMxQixXQUFXLElBQUksV0FBVyxjQUFjLE9BQU8sQ0FBQTtvQkFDL0MsV0FBVyxJQUFJLHFCQUFxQixDQUFBO29CQUNwQyxXQUFXLElBQUksc0JBQXNCLElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUE7b0JBQ3JGLFdBQVcsSUFBSSxtQ0FBbUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFBO29CQUMvRyxXQUFXLElBQUksMEJBQTBCLElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUE7b0JBQzdGLFdBQVcsSUFBSSxnQkFBZ0IsQ0FBQTtvQkFDL0IsV0FBVyxJQUFJLG1CQUFtQixJQUFJLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUE7b0JBQ3BFLFdBQVcsSUFBSSxjQUFjLENBQUE7Z0JBQy9CLENBQUM7cUJBQU0sQ0FBQztvQkFDTixXQUFXLElBQUksV0FBVyxjQUFjLFlBQVksSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFBO2dCQUMxRixDQUFDO1lBQ0gsQ0FBQztZQUNELFdBQVcsSUFBSSxZQUFZLENBQUE7UUFDN0IsQ0FBQztRQUNELFdBQVcsSUFBSSxJQUFJLENBQUMsc0JBQXNCLENBQUM7WUFDekMsTUFBTSxFQUFFLFFBQVE7WUFDaEIsWUFBWSxFQUFFLFlBQVk7WUFDMUIsTUFBTSxFQUFFLGNBQWM7U0FDdkIsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLG1DQUFtQyxFQUFFLENBQUM7WUFDekMsV0FBVyxJQUFJLElBQUksQ0FBQyx1QkFBdUIsQ0FBQztnQkFDMUMsbUJBQW1CLEVBQUUsRUFBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUM7Z0JBQ3ZELE1BQU0sRUFBRSxRQUFRO2dCQUNoQixZQUFZLEVBQUUsMkJBQTJCO2dCQUN6QyxNQUFNLEVBQUUseUJBQXlCO2FBQ2xDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFDRCxJQUFJLENBQUMsK0JBQStCLEVBQUUsQ0FBQztZQUNyQyxXQUFXLElBQUksSUFBSSxDQUFDLHVCQUF1QixDQUFDO2dCQUMxQyxtQkFBbUIsRUFBRTtvQkFDbkIsTUFBTSxFQUFFLFFBQVE7b0JBQ2hCLE9BQU8sRUFBRSxTQUFTO29CQUNsQixRQUFRLEVBQUUsVUFBVTtvQkFDcEIsSUFBSSxFQUFFLE1BQU07b0JBQ1osTUFBTSxFQUFFLFFBQVE7b0JBQ2hCLEdBQUcsRUFBRSxLQUFLO2lCQUNYO2dCQUNELE1BQU0sRUFBRSxRQUFRO2dCQUNoQixZQUFZLEVBQUUsdUJBQXVCO2dCQUNyQyxNQUFNLEVBQUUscUJBQXFCO2FBQzlCLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFDRCxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDL0MsV0FBVyxJQUFJLElBQUksQ0FBQyx5QkFBeUIsQ0FBQztnQkFDNUMsTUFBTSxFQUFFLFFBQVE7Z0JBQ2hCLFlBQVksRUFBRSxvQkFBb0I7Z0JBQ2xDLE1BQU0sRUFBRSxrQkFBa0I7YUFDM0IsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUNELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDM0MsV0FBVyxJQUFJLElBQUksQ0FBQyx5QkFBeUIsQ0FBQztnQkFDNUMsTUFBTSxFQUFFLFFBQVE7Z0JBQ2hCLFlBQVksRUFBRSxnQkFBZ0I7Z0JBQzlCLE1BQU0sRUFBRSxjQUFjO2FBQ3ZCLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFDRCxJQUFJLFVBQVUsS0FBSyxJQUFJLEVBQUUsQ0FBQztZQUN4QixXQUFXLElBQUkscUJBQXFCLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQTtRQUNyRSxDQUFDO1FBQ0QsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLENBQUMsbUNBQW1DLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxDQUFBO1FBQy9GLElBQUksdUJBQXVCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLFdBQVcsSUFBSSw2QkFBNkIsQ0FBQTtZQUM1QyxLQUFLLE1BQU0sZ0JBQWdCLElBQUksdUJBQXVCLEVBQUUsQ0FBQztnQkFDdkQsV0FBVyxJQUFJLFdBQVcsZ0JBQWdCLFNBQVMsQ0FBQTtZQUNyRCxDQUFDO1lBQ0QsV0FBVyxJQUFJLFlBQVksQ0FBQTtRQUM3QixDQUFDO1FBQ0QsSUFBSSxXQUFXLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxDQUFDO1lBQzlCLFdBQVcsSUFBSSxJQUFJLENBQUMscUJBQXFCLENBQUM7Z0JBQ3hDLE1BQU0sRUFBRSxRQUFRO2dCQUNoQixZQUFZLEVBQUUsTUFBTTtnQkFDcEIsS0FBSyxFQUFFLFdBQVcsQ0FBQyxJQUFJO2FBQ3hCLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFDRCxXQUFXLElBQUksU0FBUyxDQUFBO1FBQ3hCLFdBQVcsSUFBSSxPQUFPLENBQUE7UUFFdEIsSUFBSSxhQUFhLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzdCLFdBQVcsSUFBSSxJQUFJLENBQUE7WUFDbkIsV0FBVyxJQUFJLHdJQUF3SSxDQUFBO1lBQ3ZKLFdBQVcsSUFBSSx3Q0FBd0MsQ0FBQTtZQUN2RCxXQUFXLElBQUksZ0JBQWdCLENBQUE7WUFDL0IsS0FBSyxNQUFNLFlBQVksSUFBSSxhQUFhLEVBQUUsQ0FBQztnQkFDekMsTUFBTSxLQUFLLEdBQUcsQ0FBQyxTQUFTLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQTtnQkFFNUQsSUFBSSxZQUFZLENBQUMsUUFBUSxLQUFLLEtBQUs7b0JBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO2dCQUVsRSxXQUFXLElBQUksU0FBUyxZQUFZLENBQUMsZ0JBQWdCLE1BQU0sS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFBO1lBQ25GLENBQUM7WUFDRCxXQUFXLElBQUksU0FBUyxDQUFBO1lBQ3hCLFdBQVcsSUFBSSxPQUFPLENBQUE7WUFFdEIsV0FBVyxJQUFJLElBQUksQ0FBQTtZQUNuQixXQUFXLElBQUksZ0ZBQWdGLENBQUE7WUFDL0YsV0FBVyxJQUFJLHlDQUF5QyxDQUFBO1lBQ3hELFdBQVcsSUFBSSxnQkFBZ0IsQ0FBQTtZQUMvQixLQUFLLE1BQU0sWUFBWSxJQUFJLGFBQWEsRUFBRSxDQUFDO2dCQUN6QyxXQUFXLElBQUksU0FBUyxZQUFZLENBQUMsZ0JBQWdCLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsZUFBZSxDQUFDLEtBQUssQ0FBQTtZQUM3RyxDQUFDO1lBQ0QsV0FBVyxJQUFJLFNBQVMsQ0FBQTtZQUN4QixXQUFXLElBQUksT0FBTyxDQUFBO1FBQ3hCLENBQUM7UUFFRCxLQUFLLE1BQU0sU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ25DLE1BQU0sa0JBQWtCLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFBO1lBQ3BFLE1BQU0sdUJBQXVCLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDbkUsTUFBTSxhQUFhLEdBQUcsR0FBRyxrQkFBa0IsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFBO1lBQ2hGLE1BQU0sbUJBQW1CLEdBQUcsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUM7Z0JBQ2hFLFNBQVM7Z0JBQ1QsYUFBYSxFQUFFLFNBQVMsQ0FBQyxJQUFJO2dCQUM3QixrQkFBa0I7Z0JBQ2xCLGFBQWE7YUFDZCxDQUFDLENBQUE7WUFFRixXQUFXLElBQUksSUFBSSxDQUFBO1lBQ25CLFdBQVcsSUFBSSxtQkFBbUIsYUFBYSwyQkFBMkIsQ0FBQTtZQUMxRSxXQUFXLElBQUksS0FBSyxrQkFBa0IsMEJBQTBCLGFBQWEsNEJBQTRCLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUE7WUFFL0ksV0FBVyxJQUFJLElBQUksQ0FBQTtZQUNuQixXQUFXLElBQUksU0FBUyxDQUFBO1lBQ3hCLFdBQVcsSUFBSSxnQkFBZ0IsbUJBQW1CLHFDQUFxQyxDQUFBO1lBQ3ZGLFdBQVcsSUFBSSxrQkFBa0IsbUJBQW1CLHVCQUF1QixDQUFBO1lBQzNFLFdBQVcsSUFBSSxTQUFTLENBQUE7WUFDeEIsV0FBVyxJQUFJLFFBQVEsdUJBQXVCLGtDQUFrQyxtQkFBbUIsMkJBQTJCLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQTtRQUNoTCxDQUFDO1FBRUQsS0FBSyxNQUFNLFVBQVUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQztZQUN6RCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsRUFBQyxlQUFlLEVBQUUsVUFBVSxFQUFDLENBQUMsQ0FBQTtZQUVsRixXQUFXLElBQUksSUFBSSxDQUFBO1lBQ25CLFdBQVcsSUFBSSxTQUFTLENBQUE7WUFDeEIsV0FBVyxJQUFJLGFBQWEsVUFBVSxLQUFLLENBQUE7WUFDM0MsV0FBVyxJQUFJLFNBQVMsQ0FBQyxTQUFTLENBQUE7WUFDbEMsV0FBVyxJQUFJLDBCQUEwQixTQUFTLENBQUMsVUFBVSwwQkFBMEIsQ0FBQTtZQUN2RixXQUFXLElBQUksU0FBUyxDQUFBO1lBQ3hCLFdBQVcsSUFBSSxrQkFBa0IsVUFBVSxJQUFJLFNBQVMsQ0FBQyxVQUFVLE9BQU8sQ0FBQTtZQUMxRSxXQUFXLElBQUkseUJBQXlCLFNBQVMsQ0FBQyxVQUFVLDJDQUEyQyxDQUFBO1lBQ3ZHLFdBQVcsSUFBSSxzQkFBc0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLENBQUMsQ0FBQyxLQUFLLENBQUE7WUFDeEYsV0FBVyxJQUFJLHNCQUFzQixJQUFJLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLFVBQVUsQ0FBQyxDQUFDLEtBQUssQ0FBQTtZQUN4RixXQUFXLElBQUksa0JBQWtCLFNBQVMsMkNBQTJDLFNBQVMsQ0FBQyxnQkFBZ0IsTUFBTSxDQUFBO1lBQ3JILFdBQVcsSUFBSSwyQ0FBMkMsQ0FBQTtZQUMxRCxXQUFXLElBQUksV0FBVyxDQUFBO1lBQzFCLFdBQVcsSUFBSSxPQUFPLENBQUE7UUFDeEIsQ0FBQztRQUVELEtBQUssTUFBTSxVQUFVLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1lBQ3JELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLGVBQWUsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO1lBRWxGLFdBQVcsSUFBSSxJQUFJLENBQUE7WUFDbkIsV0FBVyxJQUFJLFNBQVMsQ0FBQTtZQUN4QixXQUFXLElBQUksYUFBYSxVQUFVLEtBQUssQ0FBQTtZQUMzQyxXQUFXLElBQUksU0FBUyxDQUFDLFNBQVMsQ0FBQTtZQUNsQyxXQUFXLElBQUksMEJBQTBCLFNBQVMsQ0FBQyxVQUFVLDBCQUEwQixDQUFBO1lBQ3ZGLFdBQVcsSUFBSSxTQUFTLENBQUE7WUFDeEIsV0FBVyxJQUFJLFdBQVcsVUFBVSxJQUFJLFNBQVMsQ0FBQyxVQUFVLE9BQU8sQ0FBQTtZQUNuRSxXQUFXLElBQUkseUJBQXlCLFNBQVMsQ0FBQyxVQUFVLGVBQWUsU0FBUywyQkFBMkIsQ0FBQTtZQUMvRyxXQUFXLElBQUksc0JBQXNCLElBQUksQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEtBQUssQ0FBQTtZQUNwRixXQUFXLElBQUksc0JBQXNCLElBQUksQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEtBQUssQ0FBQTtZQUNwRixXQUFXLElBQUksOENBQThDLElBQUksQ0FBQyxTQUFTLENBQUMseUJBQXlCLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQyxNQUFNLENBQUE7WUFDckksV0FBVyxJQUFJLGtCQUFrQixTQUFTLDJDQUEyQyxTQUFTLENBQUMsZ0JBQWdCLE1BQU0sQ0FBQTtZQUNySCxXQUFXLElBQUksdUJBQXVCLFNBQVMsbUJBQW1CLENBQUE7WUFDbEUsV0FBVyxJQUFJLFdBQVcsQ0FBQTtZQUMxQixXQUFXLElBQUksT0FBTyxDQUFBO1FBQ3hCLENBQUM7UUFFRCxLQUFLLE1BQU0sWUFBWSxJQUFJLGFBQWEsRUFBRSxDQUFDO1lBQ3pDLE1BQU0seUJBQXlCLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtZQUNwRixNQUFNLGdCQUFnQixHQUFHLEtBQUssWUFBWSxDQUFDLGNBQWMsS0FBSyxDQUFBO1lBQzlELE1BQU0sa0JBQWtCLEdBQUcsVUFBVSxJQUFJLENBQUMsU0FBUyxDQUFDLGdCQUFnQixDQUFDLEtBQUssWUFBWSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3hHLE1BQU0sMEJBQTBCLEdBQUcsVUFBVSxJQUFJLENBQUMsU0FBUyxDQUFDLGdCQUFnQixDQUFDLEtBQUssWUFBWSxDQUFDLGVBQWUsa0JBQWtCLENBQUE7WUFFaEksSUFBSSxZQUFZLENBQUMsSUFBSSxJQUFJLFNBQVMsRUFBRSxDQUFDO2dCQUNuQyxXQUFXLElBQUksSUFBSSxDQUFBO2dCQUNuQixXQUFXLElBQUksU0FBUyxDQUFBO2dCQUN4QixXQUFXLElBQUksZ0JBQWdCLFlBQVksQ0FBQyxnQkFBZ0IseUJBQXlCLENBQUE7Z0JBQ3JGLFdBQVcsSUFBSSx5QkFBeUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsc0NBQXNDLFNBQVMsS0FBSyxrQkFBa0IsS0FBSywwQkFBMEIsNkJBQTZCLENBQUE7Z0JBQ3BNLFdBQVcsSUFBSSxTQUFTLENBQUE7Z0JBQ3hCLFdBQVcsSUFBSSxLQUFLLFlBQVksQ0FBQyxnQkFBZ0IsNkNBQTZDLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLHNDQUFzQyxTQUFTLEtBQUssa0JBQWtCLEtBQUssMEJBQTBCLHFDQUFxQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUE7Z0JBRXZULFdBQVcsSUFBSSxJQUFJLENBQUE7Z0JBQ25CLFdBQVcsSUFBSSxTQUFTLENBQUE7Z0JBQ3hCLFdBQVcsSUFBSSxnQkFBZ0IsWUFBWSxDQUFDLGdCQUFnQixLQUFLLENBQUE7Z0JBQ2pFLFdBQVcsSUFBSSx5QkFBeUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsc0NBQXNDLFNBQVMsS0FBSyxrQkFBa0IsS0FBSywwQkFBMEIsNkJBQTZCLENBQUE7Z0JBQ3BNLFdBQVcsSUFBSSxTQUFTLENBQUE7Z0JBQ3hCLFdBQVcsSUFBSSxLQUFLLFlBQVksQ0FBQyxnQkFBZ0Isb0JBQW9CLFlBQVksQ0FBQyxnQkFBZ0Isb0JBQW9CLENBQUE7Z0JBRXRILFdBQVcsSUFBSSxJQUFJLENBQUE7Z0JBQ25CLFdBQVcsSUFBSSxTQUFTLENBQUE7Z0JBQ3hCLFdBQVcsSUFBSSx1QkFBdUIsWUFBWSxDQUFDLGdCQUFnQixLQUFLLENBQUE7Z0JBQ3hFLFdBQVcsSUFBSSx3QkFBd0Isa0JBQWtCLCtCQUErQixDQUFBO2dCQUN4RixXQUFXLElBQUksU0FBUyxDQUFBO2dCQUN4QixXQUFXLElBQUksS0FBSyxZQUFZLENBQUMsZ0JBQWdCLDBCQUEwQixZQUFZLENBQUMsZ0JBQWdCLDZCQUE2QixDQUFBO2dCQUVySSxXQUFXLElBQUksSUFBSSxDQUFBO2dCQUNuQixXQUFXLElBQUksU0FBUyxDQUFBO2dCQUN4QixXQUFXLElBQUksY0FBYyxZQUFZLENBQUMsZ0JBQWdCLEtBQUssQ0FBQTtnQkFDL0QsV0FBVyxJQUFJLGdDQUFnQyxrQkFBa0IsZ0NBQWdDLENBQUE7Z0JBQ2pHLFdBQVcsSUFBSSxTQUFTLENBQUE7Z0JBQ3hCLFdBQVcsSUFBSSxlQUFlLHlCQUF5QiwwQkFBMEIsWUFBWSxDQUFDLGdCQUFnQiwyQkFBMkIsQ0FBQTtZQUMzSSxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sV0FBVyxJQUFJLElBQUksQ0FBQTtnQkFDbkIsV0FBVyxJQUFJLFNBQVMsQ0FBQTtnQkFDeEIsV0FBVyxJQUFJLGdCQUFnQixZQUFZLENBQUMsZ0JBQWdCLHlCQUF5QixDQUFBO2dCQUNyRixXQUFXLElBQUkseUJBQXlCLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLHVDQUF1QyxTQUFTLEtBQUssa0JBQWtCLEtBQUssMEJBQTBCLDZCQUE2QixDQUFBO2dCQUNyTSxXQUFXLElBQUksU0FBUyxDQUFBO2dCQUN4QixXQUFXLElBQUksS0FBSyxZQUFZLENBQUMsZ0JBQWdCLDZDQUE2QyxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyx1Q0FBdUMsU0FBUyxLQUFLLGtCQUFrQixLQUFLLDBCQUEwQixxQ0FBcUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxDQUFBO2dCQUV4VCxXQUFXLElBQUksSUFBSSxDQUFBO2dCQUNuQixXQUFXLElBQUksU0FBUyxDQUFBO2dCQUN4QixXQUFXLElBQUksZ0JBQWdCLFlBQVksQ0FBQyxnQkFBZ0IsS0FBSyxDQUFBO2dCQUNqRSxXQUFXLElBQUksa0JBQWtCLGtCQUFrQixvQ0FBb0MsQ0FBQTtnQkFDdkYsV0FBVyxJQUFJLFNBQVMsQ0FBQTtnQkFDeEIsV0FBVyxJQUFJLEtBQUssWUFBWSxDQUFDLGdCQUFnQixvQkFBb0IsWUFBWSxDQUFDLGdCQUFnQiw2QkFBNkIsQ0FBQTtnQkFFL0gsV0FBVyxJQUFJLElBQUksQ0FBQTtnQkFDbkIsV0FBVyxJQUFJLFNBQVMsQ0FBQTtnQkFDeEIsV0FBVyxJQUFJLGVBQWUsWUFBWSxDQUFDLGdCQUFnQixLQUFLLENBQUE7Z0JBQ2hFLFdBQVcsSUFBSSxnQkFBZ0IsMEJBQTBCLDBEQUEwRCxDQUFBO2dCQUNuSCxXQUFXLElBQUksa0JBQWtCLGtCQUFrQiw0QkFBNEIsQ0FBQTtnQkFDL0UsV0FBVyxJQUFJLFNBQVMsQ0FBQTtnQkFDeEIsV0FBVyxJQUFJLFVBQVUseUJBQXlCLG1DQUFtQyxZQUFZLENBQUMsZ0JBQWdCLHNDQUFzQyxDQUFBO2dCQUV4SixXQUFXLElBQUksSUFBSSxDQUFBO2dCQUNuQixXQUFXLElBQUksU0FBUyxDQUFBO2dCQUN4QixXQUFXLElBQUksY0FBYyxZQUFZLENBQUMsZ0JBQWdCLEtBQUssQ0FBQTtnQkFDL0QsV0FBVyxJQUFJLDBCQUEwQixrQkFBa0IscUNBQXFDLENBQUE7Z0JBQ2hHLFdBQVcsSUFBSSxTQUFTLENBQUE7Z0JBQ3hCLFdBQVcsSUFBSSxlQUFlLHlCQUF5QiwwQkFBMEIsWUFBWSxDQUFDLGdCQUFnQiwyQkFBMkIsQ0FBQTtnQkFFekksV0FBVyxJQUFJLElBQUksQ0FBQTtnQkFDbkIsV0FBVyxJQUFJLFNBQVMsQ0FBQTtnQkFDeEIsV0FBVyxJQUFJLHlCQUF5QixZQUFZLENBQUMsZ0JBQWdCLEtBQUssQ0FBQTtnQkFDMUUsV0FBVyxJQUFJLDBCQUEwQixrQkFBa0IscUNBQXFDLENBQUE7Z0JBQ2hHLFdBQVcsSUFBSSxTQUFTLENBQUE7Z0JBQ3hCLFdBQVcsSUFBSSxXQUFXLFlBQVksQ0FBQyxnQkFBZ0IsZ0NBQWdDLFlBQVksQ0FBQyxnQkFBZ0IsNkJBQTZCLENBQUE7Z0JBRWpKLFdBQVcsSUFBSSxJQUFJLENBQUE7Z0JBQ25CLFdBQVcsSUFBSSxTQUFTLENBQUE7Z0JBQ3hCLFdBQVcsSUFBSSxhQUFhLFlBQVksQ0FBQyxnQkFBZ0IsS0FBSyxDQUFBO2dCQUM5RCxXQUFXLElBQUksZ0JBQWdCLGtCQUFrQixtQ0FBbUMsQ0FBQTtnQkFDcEYsV0FBVyxJQUFJLHdCQUF3QixDQUFBO2dCQUN2QyxXQUFXLElBQUksU0FBUyxDQUFBO2dCQUN4QixXQUFXLElBQUksUUFBUSx5QkFBeUIsa0JBQWtCLFlBQVksQ0FBQyxnQkFBZ0IscUNBQXFDLENBQUE7WUFDdEksQ0FBQztRQUNILENBQUM7UUFFRCxXQUFXLElBQUksSUFBSSxDQUFBO1FBQ25CLFdBQVcsSUFBSSxTQUFTLENBQUE7UUFDeEIsV0FBVyxJQUFJLGtEQUFrRCxDQUFBO1FBQ2pFLFdBQVcsSUFBSSxrQkFBa0IsQ0FBQTtRQUNqQyxXQUFXLElBQUksK0JBQStCLHdCQUF3QiwwQ0FBMEMsQ0FBQTtRQUNoSCxXQUFXLElBQUksdUJBQXVCLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLG1FQUFtRSxDQUFBO1FBQ25JLFdBQVcsSUFBSSwrREFBK0QsQ0FBQTtRQUM5RSxXQUFXLElBQUksU0FBUyxDQUFBO1FBQ3hCLFdBQVcsSUFBSSxTQUFTLENBQUE7UUFDeEIsV0FBVyxJQUFJLDBCQUEwQixJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQywyQkFBMkIsQ0FBQTtRQUM5RixXQUFXLElBQUksa0JBQWtCLENBQUE7UUFDakMsV0FBVyxJQUFJLGtCQUFrQixDQUFBO1FBQ2pDLFdBQVcsSUFBSSxzQ0FBc0MsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsaUdBQWlHLENBQUE7UUFDaEwsV0FBVyxJQUFJLHVCQUF1QixJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxtRUFBbUUsQ0FBQTtRQUNuSSxXQUFXLElBQUksK0RBQStELENBQUE7UUFDOUUsV0FBVyxJQUFJLFNBQVMsQ0FBQTtRQUN4QixXQUFXLElBQUksU0FBUyxDQUFBO1FBQ3hCLFdBQVcsSUFBSSw4REFBOEQsQ0FBQTtRQUM3RSxXQUFXLElBQUksdUZBQXVGLENBQUE7UUFDdEcsV0FBVyxJQUFJLHVCQUF1QixJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxtRUFBbUUsQ0FBQTtRQUNuSSxXQUFXLElBQUksK0RBQStELENBQUE7UUFDOUUsV0FBVyxJQUFJLFNBQVMsQ0FBQTtRQUN4QixXQUFXLElBQUksc0RBQXNELENBQUE7UUFDckUsV0FBVyxJQUFJLDBFQUEwRSxDQUFBO1FBQ3pGLFdBQVcsSUFBSSxPQUFPLENBQUE7UUFFdEIsV0FBVyxJQUFJLEtBQUssQ0FBQTtRQUNwQixXQUFXLElBQUksSUFBSSxDQUFBO1FBQ25CLFdBQVcsSUFBSSxtQ0FBbUMsU0FBUyxLQUFLLENBQUE7UUFDaEUsV0FBVyxJQUFJLElBQUksQ0FBQTtRQUNuQixXQUFXLElBQUksV0FBVyxTQUFTLEtBQUssQ0FBQTtRQUN4QyxXQUFXLElBQUksSUFBSSxDQUFBO1FBQ25CLFdBQVcsSUFBSSxrQkFBa0IsU0FBUyxJQUFJLENBQUE7UUFFOUMsT0FBTyxXQUFXLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQkFBcUIsQ0FBQyxjQUFjO1FBQ2xDLElBQUksT0FBTyxHQUFHLG1CQUFtQixDQUFDLGtDQUFrQyxDQUFDLENBQUE7UUFFckUsS0FBSyxNQUFNLEVBQUMsUUFBUSxFQUFDLElBQUksY0FBYyxFQUFFLENBQUM7WUFDeEMsT0FBTyxJQUFJLGFBQWEsUUFBUSxLQUFLLENBQUE7UUFDdkMsQ0FBQztRQUVELE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxVQUFVLEVBQUUsZ0JBQWdCLEVBQUUsZUFBZSxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUM7UUFDbkksTUFBTSxjQUFjLEdBQUcsRUFBRSxDQUFBO1FBRXpCLElBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQTtRQUVwQixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDNUYsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsQ0FBQyxlQUFlLEVBQUUsRUFBRSxDQUFDLENBQUMsR0FBRyxlQUFlLENBQUMsZ0JBQWdCLFlBQVksRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDcEosTUFBTSxxQkFBcUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRXZDLEtBQUssTUFBTSxLQUFLLElBQUksZUFBZSxFQUFFLENBQUM7WUFDcEMsSUFBSSxPQUFPLEtBQUssSUFBSSxRQUFRLEVBQUUsQ0FBQztnQkFDN0IsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUMsYUFBYSxFQUFFLEtBQUssRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO2dCQUUzRyxJQUFJLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7b0JBQUUsU0FBUTtnQkFFdEQscUJBQXFCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO2dCQUV4QyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQywwQkFBMEIsQ0FBQztvQkFDakQsU0FBUyxFQUFFLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7b0JBQzlDLGFBQWE7b0JBQ2Isa0JBQWtCO29CQUNsQixhQUFhO2lCQUNkLENBQUMsQ0FBQTtnQkFFRixjQUFjLENBQUMsSUFBSSxDQUFDLGlCQUFpQixJQUFJLE1BQU0sYUFBYSxpQkFBaUIsYUFBYSxXQUFXLENBQUMsQ0FBQTtZQUN4RyxDQUFDO2lCQUFNLElBQUksS0FBSyxJQUFJLE9BQU8sS0FBSyxJQUFJLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDdEUsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQ3JDLE1BQU0sZUFBZSxHQUFHLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQTtvQkFDdEQsTUFBTSxJQUFJLEdBQUcsZUFBZSxDQUFDLENBQUMsQ0FBQyxTQUFTLGVBQWUsQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFBO29CQUVyRixjQUFjLENBQUMsSUFBSSxDQUFDLGlCQUFpQixJQUFJLE1BQU0sR0FBRyx3QkFBd0IsR0FBRyxZQUFZLENBQUMsQ0FBQTtnQkFDNUYsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsTUFBTSxJQUFJLDZCQUE2QixRQUFRLEtBQUssQ0FBQTtRQUNwRCxJQUFJLGNBQWMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDaEMsTUFBTSxJQUFJLHVDQUF1QyxRQUFRLElBQUksQ0FBQTtRQUMvRCxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sSUFBSSx3QkFBd0IsUUFBUSxJQUFJLENBQUE7WUFDOUMsTUFBTSxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDbkMsQ0FBQztRQUNELE1BQU0sSUFBSSxPQUFPLENBQUE7UUFFakIsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsa0JBQWtCLEVBQUUsYUFBYSxFQUFDO1FBQzVGLE1BQU0sbUJBQW1CLEdBQUcsTUFBTSxJQUFJLENBQUMseUNBQXlDLENBQUMsRUFBQyxhQUFhLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUVoSCxJQUFJLG1CQUFtQjtZQUFFLE9BQU8sR0FBRyxtQkFBbUIsU0FBUyxDQUFBO1FBRS9ELElBQUksQ0FBQyxTQUFTO1lBQUUsT0FBTyw2QkFBNkIsQ0FBQTtRQUVwRCxJQUFJLFNBQVMsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUssTUFBTTtZQUFFLE9BQU8sNkJBQTZCLENBQUE7UUFFL0UsSUFBSSxTQUFTLENBQUMsY0FBYyxLQUFLLFNBQVMsQ0FBQyxTQUFTO1lBQUUsT0FBTyxTQUFTLENBQUMsY0FBYyxDQUFBO1FBRXJGLE9BQU8sR0FBRyxrQkFBa0IsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFBO0lBQzFFLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHlDQUF5QyxDQUFDLEVBQUMsYUFBYSxFQUFFLGFBQWEsRUFBQztRQUM1RSxJQUFJLENBQUMsYUFBYSxFQUFFLElBQUk7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVyQyxNQUFNLFVBQVUsR0FBRyxNQUFNLFVBQVUsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQTtRQUN0RSxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQztZQUMzRCxVQUFVO1lBQ1YsY0FBYyxFQUFFLENBQUM7WUFDakIsZUFBZSxFQUFFLGFBQWEsQ0FBQyxJQUFJO1NBQ3BDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxhQUFhO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDL0IsSUFBSSxJQUFJLENBQUMsb0JBQW9CLENBQUMsYUFBYSxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFekQsT0FBTyxhQUFhLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxvQkFBb0IsQ0FBQyxTQUFTO1FBQzVCLE1BQU0sY0FBYyxHQUFHLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUV2QyxPQUFPLGNBQWMsS0FBSyxHQUFHO2VBQ3hCLGNBQWMsS0FBSyxLQUFLO2VBQ3hCLGNBQWMsS0FBSyxRQUFRO2VBQzNCLGNBQWMsS0FBSyxTQUFTLENBQUE7SUFDbkMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwwQkFBMEIsQ0FBQyxFQUFDLGFBQWEsRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUM7UUFDdEUsSUFBSSxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO1lBQUUsT0FBTyxhQUFhLENBQUE7UUFFN0QsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNmLE1BQU0scUJBQXFCLEdBQUcsVUFBVSxDQUFDLG9CQUFvQixDQUFDLGFBQWEsQ0FBQyxDQUFBO1lBRTVFLElBQUkscUJBQXFCLElBQUksZ0JBQWdCLENBQUMsR0FBRyxDQUFDLHFCQUFxQixDQUFDO2dCQUFFLE9BQU8scUJBQXFCLENBQUE7UUFDeEcsQ0FBQztRQUVELE1BQU0sdUJBQXVCLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUE7UUFDdEYsTUFBTSxxQkFBcUIsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQyxhQUFhLENBQUMsV0FBVyxFQUFFLEtBQUssdUJBQXVCLENBQUMsQ0FBQTtRQUVsSixJQUFJLHFCQUFxQjtZQUFFLE9BQU8scUJBQXFCLENBQUE7UUFFdkQsOEZBQThGO1FBQzlGLE9BQU8sYUFBYSxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsd0JBQXdCLENBQUMsRUFBQyxTQUFTLEVBQUUsZUFBZSxFQUFFLGFBQWEsRUFBQztRQUNsRSxNQUFNLG1CQUFtQixHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRSxDQUFDLENBQUMsWUFBWSxDQUFDLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUN2SCxNQUFNLHNCQUFzQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFeEMsS0FBSyxNQUFNLEtBQUssSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUNwQyxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxJQUFJLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztnQkFBRSxTQUFRO1lBRXhFLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUNyQyxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUM7b0JBQUUsU0FBUTtnQkFDekMsTUFBTSxnQkFBZ0IsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQTtnQkFDM0QsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUM3QixNQUFNLFlBQVksR0FBRyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtnQkFDOUQsSUFBSSxnQkFBZ0IsQ0FBQTtnQkFFcEIsSUFBSSxZQUFZLEVBQUUsQ0FBQztvQkFDakIsSUFBSSxDQUFDO3dCQUNILGdCQUFnQixHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsZUFBZSxDQUFDLENBQUE7b0JBQ3hGLENBQUM7b0JBQUMsTUFBTSxDQUFDO3dCQUNQLGdCQUFnQixHQUFHLFNBQVMsQ0FBQTtvQkFDOUIsQ0FBQztnQkFDSCxDQUFDO2dCQUVELElBQUksc0JBQXNCLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDO29CQUFFLFNBQVE7Z0JBRTFELHNCQUFzQixDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRTtvQkFDM0MsVUFBVSxFQUFFLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxnQkFBZ0IsRUFBQyxDQUFDO29CQUM3RSxnQkFBZ0I7b0JBQ2hCLFFBQVEsRUFBRSxHQUFHLFNBQVMsR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLGtCQUFrQjtpQkFDakYsQ0FBQyxDQUFBO1lBQ0osQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQTtJQUNwRCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsNEJBQTRCLENBQUMsRUFBQyxVQUFVLEVBQUUsZ0JBQWdCLEVBQUM7UUFDekQsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDO1lBQUUsT0FBTyxFQUFFLENBQUE7UUFFekMsT0FBTyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEtBQUssSUFBSSxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxhQUFhLEVBQUUsRUFBRTtZQUNsRixNQUFNLHFCQUFxQixHQUFHLGdCQUFnQixFQUFFLG9CQUFvQixDQUFDLGFBQWEsQ0FBQyxJQUFJLGFBQWEsQ0FBQTtZQUNwRyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsd0NBQXdDLENBQUMsRUFBQyxhQUFhLEVBQUUscUJBQXFCLEVBQUUsVUFBVSxFQUFFLGdCQUFnQixFQUFDLENBQUMsQ0FBQTtZQUUzSSxPQUFPO2dCQUNMLElBQUksRUFBRSxxQkFBcUI7Z0JBQzNCLElBQUksRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFDLGVBQWUsRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLDZCQUE2QjthQUNuSCxDQUFBO1FBQ0gsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCwyQkFBMkIsQ0FBQyxhQUFhLEVBQUUsTUFBTTtRQUMvQyxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sRUFBRSxDQUFBO1FBRTdCLElBQUksQ0FBQztZQUNILE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtZQUU3QyxNQUFNLGFBQWEsR0FBRyx3Q0FBd0MsQ0FBQyxhQUFhLENBQUMsQ0FBQTtZQUM3RSxNQUFNLFFBQVEsR0FBRyxJQUFJLGFBQWEsQ0FBQztnQkFDakMsT0FBTyxFQUFFLFNBQVM7Z0JBQ2xCLE9BQU8sRUFBRSxFQUFFO2dCQUNYLE1BQU0sRUFBRSxFQUFFO2dCQUNWLFVBQVU7Z0JBQ1YsU0FBUyxFQUFFLFVBQVUsQ0FBQyxZQUFZLEVBQUU7Z0JBQ3BDLE1BQU0sRUFBRSxFQUFFO2dCQUNWLHFCQUFxQixFQUFFLGlHQUFpRyxDQUFDLENBQUMsRUFBQyxVQUFVLEVBQUUsRUFBRSxFQUFDLENBQUM7YUFDNUksQ0FBQyxDQUFBO1lBQ0YsTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLGVBQWUsQ0FBQyxFQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBQyxDQUFDLENBQUE7WUFFM0YsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUN4QyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsb0JBQW9CLGFBQWEsQ0FBQyxJQUFJLG1FQUFtRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQ3BNLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7O09BV0c7SUFDSCxtQ0FBbUMsQ0FBQyxhQUFhO1FBQy9DLElBQUksQ0FBQyxhQUFhO1lBQUUsT0FBTyxFQUFFLENBQUE7UUFFN0IsSUFBSSxJQUFJLENBQUE7UUFFUixJQUFJLENBQUM7WUFDSCxNQUFNLFVBQVUsR0FBRyxhQUFhLENBQUMsVUFBVSxFQUFFLENBQUE7WUFFN0MsTUFBTSxhQUFhLEdBQUcsd0NBQXdDLENBQUMsYUFBYSxDQUFDLENBQUE7WUFDN0UsTUFBTSxRQUFRLEdBQUcsSUFBSSxhQUFhLENBQUM7Z0JBQ2pDLE9BQU8sRUFBRSxTQUFTO2dCQUNsQixPQUFPLEVBQUUsRUFBRTtnQkFDWCxNQUFNLEVBQUUsRUFBRTtnQkFDVixVQUFVO2dCQUNWLFNBQVMsRUFBRSxVQUFVLENBQUMsWUFBWSxFQUFFO2dCQUNwQyxNQUFNLEVBQUUsRUFBRTtnQkFDVixxQkFBcUIsRUFBRSxpR0FBaUcsQ0FBQyxDQUFDLEVBQUMsVUFBVSxFQUFFLEVBQUUsRUFBQyxDQUFDO2FBQzVJLENBQUMsQ0FBQTtZQUNGLElBQUksR0FBRyxRQUFRLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDbkMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLElBQUksS0FBSyxDQUFDLG9CQUFvQixhQUFhLENBQUMsSUFBSSx3REFBd0QsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUN6TCxDQUFDO1FBRUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDO1lBQUUsT0FBTyxFQUFFLENBQUE7UUFFbkM7OzhCQUVzQjtRQUN0QixNQUFNLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtRQUU1QixLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3pCLElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO2dCQUFFLFNBQVE7WUFFekUsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3JDLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQztvQkFBRSxTQUFRO2dCQUN6QyxNQUFNLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQTtnQkFDL0MsSUFBSSxJQUFJO29CQUFFLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUN4QyxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8saUJBQWlCLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxzQkFBc0IsQ0FBQyxFQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUUsTUFBTSxFQUFDO1FBQ25ELElBQUksTUFBTSxHQUFHLEdBQUcsTUFBTSxHQUFHLFlBQVksT0FBTyxDQUFBO1FBRTVDLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxFQUFFLENBQUM7WUFDM0IsTUFBTSxJQUFJLEdBQUcsTUFBTSxLQUFLLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQTtRQUNwRCxDQUFDO1FBRUQsTUFBTSxJQUFJLEdBQUcsTUFBTSxNQUFNLENBQUE7UUFFekIsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7T0FhRztJQUNILHlCQUF5QixDQUFDLEVBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxNQUFNLEVBQUM7UUFDdEQsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsRUFBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFDLENBQUMsQ0FBQTtJQUN6RixDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCx1QkFBdUIsQ0FBQyxFQUFDLG1CQUFtQixFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsTUFBTSxFQUFDO1FBQ3pFLElBQUksTUFBTSxHQUFHLEdBQUcsTUFBTSxHQUFHLFlBQVksT0FBTyxDQUFBO1FBRTVDLEtBQUssTUFBTSxTQUFTLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1lBQzVDLElBQUksbUJBQW1CLElBQUksbUJBQW1CLENBQUMsU0FBUyxDQUFDLEtBQUssTUFBTSxDQUFDLFNBQVMsQ0FBQztnQkFBRSxTQUFRO1lBRXpGLE1BQU0sSUFBSSxHQUFHLE1BQU0sS0FBSyxTQUFTLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsS0FBSyxDQUFBO1FBQzlFLENBQUM7UUFFRCxNQUFNLElBQUksR0FBRyxNQUFNLE1BQU0sQ0FBQTtRQUV6QixPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gscUJBQXFCLENBQUMsRUFBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLEtBQUssRUFBQztRQUNqRCxPQUFPLEdBQUcsTUFBTSxHQUFHLFlBQVksS0FBSyxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFDLENBQUMsS0FBSyxDQUFBO0lBQ25GLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxrQkFBa0IsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUM7UUFDaEMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDekIsSUFBSSxNQUFNLEdBQUcsS0FBSyxDQUFBO1lBRWxCLEtBQUssTUFBTSxLQUFLLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQzFCLE1BQU0sSUFBSSxHQUFHLE1BQU0sS0FBSyxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBQyxNQUFNLEVBQUUsR0FBRyxNQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsS0FBSyxDQUFBO1lBQzdGLENBQUM7WUFFRCxNQUFNLElBQUksR0FBRyxNQUFNLEdBQUcsQ0FBQTtZQUV0QixPQUFPLE1BQU0sQ0FBQTtRQUNmLENBQUM7UUFFRCxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN2QyxJQUFJLE1BQU0sR0FBRyxLQUFLLENBQUE7WUFFbEIsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3JDLE1BQU0sSUFBSSxHQUFHLE1BQU0sS0FBSyxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLEtBQUssSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUMsTUFBTSxFQUFFLEdBQUcsTUFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLHNDQUFzQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUMsQ0FBQyxLQUFLLENBQUE7WUFDNUssQ0FBQztZQUVELE1BQU0sSUFBSSxHQUFHLE1BQU0sR0FBRyxDQUFBO1lBRXRCLE9BQU8sTUFBTSxDQUFBO1FBQ2YsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGtCQUFrQixDQUFDLEdBQUc7UUFDcEIsT0FBTyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUNuRSxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsNEJBQTRCLENBQUMsRUFBQyxTQUFTLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxhQUFhLEVBQUM7UUFDcEYsSUFBSSxVQUFVLEdBQUcsV0FBVyxDQUFDLFVBQVUsQ0FBQTtRQUV2Qyx3RUFBd0U7UUFDeEUsSUFBSSxDQUFDLENBQUMsVUFBVSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksVUFBVSxFQUFFLENBQUM7WUFDMUYsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLFVBQVUsRUFBRSxDQUFBO1lBRXZDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUMzQixVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQTtZQUNuRixDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQzlCLE1BQU0sb0JBQW9CLEdBQUcsRUFBRSxDQUFBO1lBRS9CLEtBQUssTUFBTSxtQkFBbUIsSUFBSSxVQUFVLEVBQUUsQ0FBQztnQkFDN0MsNkNBQTZDO2dCQUM3QyxJQUFJLHlCQUF5QixHQUFHLElBQUksQ0FBQTtnQkFDcEMsSUFBSSxhQUFhLENBQUE7Z0JBRWpCLElBQUksT0FBTyxtQkFBbUIsSUFBSSxRQUFRLEVBQUUsQ0FBQztvQkFDM0MsYUFBYSxHQUFHLG1CQUFtQixDQUFBO2dCQUNyQyxDQUFDO3FCQUFNLElBQUksbUJBQW1CLElBQUksT0FBTyxtQkFBbUIsSUFBSSxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLEVBQUUsQ0FBQztvQkFDaEgseUJBQXlCLEdBQUcsc0NBQXNDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO29CQUN4RixhQUFhLEdBQUcseUJBQXlCLENBQUMsSUFBSSxDQUFBO2dCQUNoRCxDQUFDO2dCQUVELElBQUksT0FBTyxhQUFhLElBQUksUUFBUSxJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ2pFLE1BQU0sSUFBSSxLQUFLLENBQUMsOEZBQThGLElBQUksQ0FBQyxTQUFTLENBQUMsbUJBQW1CLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBQ3RKLENBQUM7Z0JBRUQsTUFBTSxlQUFlLEdBQUcsTUFBTSxJQUFJLENBQUMsK0JBQStCLENBQUM7b0JBQ2pFLGFBQWE7b0JBQ2IsU0FBUztvQkFDVCx5QkFBeUI7b0JBQ3pCLFVBQVU7b0JBQ1YsYUFBYTtpQkFDZCxDQUFDLENBQUE7Z0JBRUYsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLENBQUMsNENBQTRDLENBQUM7b0JBQ2hGLGVBQWU7b0JBQ2YsYUFBYTtvQkFDYixVQUFVO2lCQUNYLENBQUMsQ0FBQTtnQkFFRixvQkFBb0IsQ0FBQyxJQUFJLENBQUM7b0JBQ3hCLFNBQVMsRUFBRSxJQUFJLENBQUMsNkJBQTZCLENBQUMsRUFBQyxlQUFlLEVBQUUsdUJBQXVCLEVBQUMsQ0FBQztvQkFDekYsSUFBSSxFQUFFLGFBQWE7b0JBQ25CLGNBQWMsRUFBRSxJQUFJLENBQUMsa0NBQWtDLENBQUMsRUFBQyxlQUFlLEVBQUUsdUJBQXVCLEVBQUMsQ0FBQztpQkFDcEcsQ0FBQyxDQUFBO1lBQ0osQ0FBQztZQUVELE9BQU8sb0JBQW9CLENBQUE7UUFDN0IsQ0FBQztRQUVELElBQUksQ0FBQyxVQUFVLElBQUksT0FBTyxVQUFVLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDbEQsTUFBTSxJQUFJLEtBQUssQ0FBQyxxREFBcUQsVUFBVSxFQUFFLENBQUMsQ0FBQTtRQUNwRixDQUFDO1FBRUQsTUFBTSxvQkFBb0IsR0FBRyxFQUFFLENBQUE7UUFFL0IsS0FBSyxNQUFNLGFBQWEsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDcEQsTUFBTSxlQUFlLEdBQUcsVUFBVSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1lBQ2pELE1BQU0seUJBQXlCLEdBQUcsZUFBZSxJQUFJLE9BQU8sZUFBZSxLQUFLLFFBQVE7Z0JBQ3RGLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLGVBQWUsQ0FBQztnQkFDMUQsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUNSLE1BQU0seUJBQXlCLEdBQUcsTUFBTSxJQUFJLENBQUMsK0JBQStCLENBQUM7Z0JBQzNFLGFBQWE7Z0JBQ2IsU0FBUztnQkFDVCx5QkFBeUI7Z0JBQ3pCLFVBQVU7Z0JBQ1YsYUFBYTthQUNkLENBQUMsQ0FBQTtZQUNGLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxDQUFDLDRDQUE0QyxDQUFDO2dCQUNoRixlQUFlLEVBQUUseUJBQXlCO2dCQUMxQyxhQUFhO2dCQUNiLFVBQVU7YUFDWCxDQUFDLENBQUE7WUFFRixvQkFBb0IsQ0FBQyxJQUFJLENBQUM7Z0JBQ3hCLFNBQVMsRUFBRSxJQUFJLENBQUMsNkJBQTZCLENBQUMsRUFBQyxlQUFlLEVBQUUsdUJBQXVCLEVBQUMsQ0FBQztnQkFDekYsSUFBSSxFQUFFLGFBQWE7Z0JBQ25CLGNBQWMsRUFBRSxJQUFJLENBQUMsa0NBQWtDLENBQUMsRUFBQyxlQUFlLEVBQUUsdUJBQXVCLEVBQUMsQ0FBQzthQUNwRyxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsT0FBTyxvQkFBb0IsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDRDQUE0QyxDQUFDLEVBQUMsZUFBZSxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQUM7UUFDdkYsSUFBSSxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFDLGFBQWEsRUFBRSxVQUFVLEVBQUMsQ0FBQztZQUFFLE9BQU8sZUFBZSxDQUFBO1FBQ2pHLElBQUksSUFBSSxDQUFDLHFDQUFxQyxDQUFDLGVBQWUsQ0FBQztZQUFFLE9BQU8sZUFBZSxDQUFBO1FBRXZGLE9BQU8sRUFBQyxHQUFHLGVBQWUsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxrQ0FBa0MsQ0FBQyxFQUFDLGFBQWEsRUFBRSxVQUFVLEVBQUM7UUFDNUQsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU3QixNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsVUFBVSxFQUFFLENBQUE7UUFFMUMsS0FBSyxNQUFNLFVBQVUsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUMvRSxJQUFJLGFBQWEsS0FBSyxVQUFVO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBQzdDLElBQUksVUFBVSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxLQUFLLGFBQWE7Z0JBQUUsT0FBTyxJQUFJLENBQUE7UUFDaEYsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxrQ0FBa0MsQ0FBQyxFQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFDO1FBQzFFLElBQUksV0FBVyxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzNCLE9BQU8sSUFBSSxDQUFDLDZCQUE2QixDQUFDLEVBQUMsY0FBYyxFQUFFLFVBQVUsRUFBRSxXQUFXLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQTtRQUNqRyxDQUFDO1FBRUQsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUU1QixPQUFPLElBQUksQ0FBQyxvQ0FBb0MsQ0FBQyxFQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO0lBQ2hGLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsZ0NBQWdDLENBQUMsRUFBQyxrQkFBa0IsRUFBRSxVQUFVLEVBQUM7UUFDL0QsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDOUIsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUVuRyxPQUFPLFFBQVEsa0JBQWtCLEtBQUssY0FBYyxHQUFHLENBQUE7UUFDekQsQ0FBQztRQUVELE9BQU8sR0FBRyxrQkFBa0IsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUE7SUFDL0QsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCw2QkFBNkIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUM7UUFDeEQsTUFBTSxvQkFBb0IsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFbEYsSUFBSSxvQkFBb0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDcEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxzRkFBc0YsQ0FBQyxDQUFBO1FBQ3pHLENBQUM7UUFFRCxJQUFJLElBQUksR0FBRyxDQUFDLG9CQUFvQixDQUFDLENBQUMsSUFBSSxLQUFLLG9CQUFvQixDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3ZFLE1BQU0sSUFBSSxLQUFLLENBQUMsNEVBQTRFLENBQUMsQ0FBQTtRQUMvRixDQUFDO1FBRUQsS0FBSyxNQUFNLGFBQWEsSUFBSSxvQkFBb0IsRUFBRSxDQUFDO1lBQ2pELElBQUksQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7Z0JBQzVDLE1BQU0sSUFBSSxLQUFLLENBQUMsMENBQTBDLGFBQWEsZ0RBQWdELENBQUMsQ0FBQTtZQUMxSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0NBQW9DLENBQUMsRUFBQyxjQUFjLEVBQUUsVUFBVSxFQUFDO1FBQy9ELE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUUxQyxJQUFJLFVBQVUsS0FBSyxJQUFJO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFcEMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDOUIsT0FBTyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsb0NBQW9DLENBQUMsRUFBQyxjQUFjLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUM1SCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsb0NBQW9DLENBQUMsRUFBQyxjQUFjLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO0lBQ3hHLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0NBQW9DLENBQUMsRUFBQyxjQUFjLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBQztRQUMzRSxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDO1lBQUUsT0FBTyxVQUFVLENBQUE7UUFFMUQsTUFBTSxhQUFhLEdBQUcsVUFBVSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRWpFLElBQUksYUFBYSxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUM1RCxPQUFPLGFBQWEsQ0FBQTtRQUN0QixDQUFDO1FBRUQsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFVBQVUsQ0FBQyxJQUFJLHlCQUF5QixVQUFVLDZEQUE2RCxDQUFDLENBQUE7SUFDckksQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxFQUFDLGFBQWEsRUFBRSxTQUFTLEVBQUUseUJBQXlCLEVBQUUsVUFBVSxFQUFFLGFBQWEsRUFBQztRQUNwSCxNQUFNLHNCQUFzQixHQUFHLE1BQU0sSUFBSSxDQUFDLDJDQUEyQyxDQUFDLEVBQUMsYUFBYSxFQUFFLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDckgsTUFBTSxvQkFBb0IsR0FBRyxzQkFBc0I7WUFDakQsQ0FBQyxDQUFDLElBQUk7WUFDTixDQUFDLENBQUMsSUFBSSxDQUFDLHdDQUF3QyxDQUFDLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDOUUsTUFBTSx3QkFBd0IsR0FBRyxzQkFBc0IsSUFBSSxvQkFBb0I7WUFDN0UsQ0FBQyxDQUFDLElBQUk7WUFDTixDQUFDLENBQUMsSUFBSSxDQUFDLDZDQUE2QyxDQUFDLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBQ2xHLE1BQU0sMkJBQTJCLEdBQUcsc0JBQXNCLElBQUksb0JBQW9CLElBQUksd0JBQXdCO1lBQzVHLENBQUMsQ0FBQyxJQUFJO1lBQ04sQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDLHVDQUF1QyxDQUFDLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDbkYsTUFBTSxjQUFjLEdBQUcsc0JBQXNCLElBQUksb0JBQW9CLElBQUksd0JBQXdCLElBQUksMkJBQTJCLENBQUE7UUFFaEksSUFBSSx5QkFBeUIsSUFBSSxJQUFJLENBQUMsOEJBQThCLENBQUMseUJBQXlCLENBQUMsRUFBRSxDQUFDO1lBQ2hHLE9BQU8sY0FBYztnQkFDbkIsQ0FBQyxDQUFDLEVBQUMsR0FBRyxjQUFjLEVBQUUsR0FBRyx5QkFBeUIsRUFBQztnQkFDbkQsQ0FBQyxDQUFDLHlCQUF5QixDQUFBO1FBQy9CLENBQUM7UUFFRCxJQUFJLGNBQWMsRUFBRSxDQUFDO1lBQ25CLE9BQU8seUJBQXlCO2dCQUM5QixDQUFDLENBQUMsRUFBQyxHQUFHLGNBQWMsRUFBRSxHQUFHLHlCQUF5QixFQUFDO2dCQUNuRCxDQUFDLENBQUMsY0FBYyxDQUFBO1FBQ3BCLENBQUM7UUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxTQUFTLElBQUksYUFBYSxvSEFBb0gsYUFBYSxFQUFFLElBQUksSUFBSSxjQUFjLElBQUksYUFBYSxjQUFjLENBQUMsQ0FBQTtJQUNqUyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDhCQUE4QixDQUFDLGVBQWU7UUFDNUMsT0FBTyxPQUFPLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxlQUFlLENBQUMsSUFBSSxRQUFRO2VBQ3JFLE9BQU8sZUFBZSxFQUFFLFNBQVMsSUFBSSxRQUFRLENBQUE7SUFDcEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQ0FBcUMsQ0FBQyxlQUFlO1FBQ25ELElBQUksQ0FBQyxlQUFlLElBQUksT0FBTyxlQUFlLEtBQUssUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBQ3pFLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxNQUFNLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUU5RSxPQUFPLE9BQU8sZUFBZSxDQUFDLE9BQU8sSUFBSSxVQUFVLENBQUE7SUFDckQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsNkJBQTZCLENBQUMsRUFBQyxlQUFlLEVBQUM7UUFDN0MsSUFBSSxlQUFlLElBQUksT0FBTyxlQUFlLENBQUMsU0FBUyxJQUFJLFFBQVEsSUFBSSxlQUFlLENBQUMsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM1RyxPQUFPLGVBQWUsQ0FBQyxTQUFTLENBQUE7UUFDbEMsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUU3RSxJQUFJLENBQUMsSUFBSSxDQUFDLDBCQUEwQixDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7WUFDdEQsT0FBTyxTQUFTLENBQUE7UUFDbEIsQ0FBQztRQUVELE9BQU8sR0FBRyxTQUFTLFNBQVMsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxrQ0FBa0MsQ0FBQyxFQUFDLGVBQWUsRUFBQztRQUNsRCxJQUFJLGVBQWUsSUFBSSxPQUFPLGVBQWUsQ0FBQyxTQUFTLElBQUksUUFBUSxJQUFJLGVBQWUsQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzVHLE9BQU8sZUFBZSxDQUFDLFNBQVMsQ0FBQTtRQUNsQyxDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLDBDQUEwQyxDQUFDLGVBQWUsQ0FBQyxDQUFBO1FBRWxGLElBQUksQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztZQUN0RCxPQUFPLFNBQVMsQ0FBQTtRQUNsQixDQUFDO1FBRUQsT0FBTyxHQUFHLFNBQVMsU0FBUyxDQUFBO0lBQzlCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMENBQTBDLENBQUMsZUFBZTtRQUN4RCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMscUNBQXFDLENBQUMsZUFBZSxDQUFDLENBQUE7UUFFNUUsSUFBSSxDQUFDLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxlQUFlLENBQUM7WUFBRSxPQUFPLFFBQVEsQ0FBQTtRQUUzRSxPQUFPLEdBQUcsUUFBUSxXQUFXLENBQUE7SUFDL0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQ0FBcUMsQ0FBQyxlQUFlO1FBQ25ELElBQUksQ0FBQyxlQUFlLElBQUksT0FBTyxlQUFlLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDNUQsT0FBTyw2QkFBNkIsQ0FBQTtRQUN0QyxDQUFDO1FBRUQsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLGVBQWUsQ0FBQyxDQUFBO1FBRTdELElBQUksSUFBSSxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQ3RCLE9BQU8sU0FBUyxDQUFBO1FBQ2xCLENBQUM7YUFBTSxJQUFJLElBQUksSUFBSSxNQUFNLElBQUksSUFBSSxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQzdDLE9BQU8sNkJBQTZCLENBQUE7UUFDdEMsQ0FBQzthQUFNLElBQUksSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsbUJBQW1CLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNySixPQUFPLFFBQVEsQ0FBQTtRQUNqQixDQUFDO2FBQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsa0JBQWtCLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsU0FBUyxDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDbEssT0FBTyxRQUFRLENBQUE7UUFDakIsQ0FBQzthQUFNLElBQUksSUFBSSxDQUFDLCtCQUErQixDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7WUFDakUsT0FBTyxNQUFNLENBQUE7UUFDZixDQUFDO2FBQU0sQ0FBQztZQUNOLE9BQU8sNkJBQTZCLENBQUE7UUFDdEMsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsK0JBQStCLENBQUMsZUFBZTtRQUM3QyxJQUFJLENBQUMsZUFBZSxJQUFJLE9BQU8sZUFBZSxLQUFLLFFBQVE7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUV6RSxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsMEJBQTBCLENBQUMsZUFBZSxDQUFDLENBQUE7UUFFN0QsT0FBTyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUUsNkJBQTZCLEVBQUUsYUFBYSxDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUE7SUFDdEgsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwwQkFBMEIsQ0FBQyxlQUFlO1FBQ3hDLElBQUksQ0FBQyxlQUFlLElBQUksT0FBTyxlQUFlLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDNUQsT0FBTyxLQUFLLENBQUE7UUFDZCxDQUFDO1FBRUQsSUFBSSxPQUFPLGVBQWUsQ0FBQyxPQUFPLElBQUksVUFBVSxFQUFFLENBQUM7WUFDakQsT0FBTyxlQUFlLENBQUMsT0FBTyxFQUFFLEtBQUssSUFBSSxDQUFBO1FBQzNDLENBQUM7UUFFRCxPQUFPLGVBQWUsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFBO0lBQ3RDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMEJBQTBCLENBQUMsZUFBZTtRQUN4QyxJQUFJLENBQUMsZUFBZSxJQUFJLE9BQU8sZUFBZSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzVELE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQztRQUVELElBQUksT0FBTyxlQUFlLENBQUMsT0FBTyxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ2pELE9BQU8sTUFBTSxDQUFDLGVBQWUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFBO1FBQzFDLENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRyxlQUFlLENBQUMsSUFBSSxJQUFJLGVBQWUsQ0FBQyxVQUFVLElBQUksZUFBZSxDQUFDLE9BQU8sSUFBSSxlQUFlLENBQUMsUUFBUSxDQUFBO1FBRTNILElBQUksT0FBTyxTQUFTLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDbEMsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQywyQ0FBMkMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxhQUFhLEVBQUM7UUFDOUUsSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUUvQixNQUFNLFVBQVUsR0FBRyxHQUFHLGFBQWEsV0FBVyxDQUFBO1FBQzlDLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUUxRixJQUFJLENBQUMsY0FBYztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRWhDLE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDO1lBQ3BELFVBQVU7WUFDVixlQUFlLEVBQUUsY0FBYztTQUNoQyxDQUFDLENBQUE7UUFFRixPQUFPLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLHlCQUF5QixDQUFDLEVBQUMsU0FBUyxFQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDcEYsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCw2Q0FBNkMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxVQUFVLEVBQUUsYUFBYSxFQUFDO1FBQ3RGLElBQUksQ0FBQyxVQUFVO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDNUIsSUFBSSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxFQUFDLGFBQWEsRUFBRSxVQUFVLEVBQUUsYUFBYSxFQUFDLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVoRyxNQUFNLGdCQUFnQixHQUFHLFVBQVUsQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBQ3pELE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFdkQsSUFBSSxNQUFNLENBQUE7UUFFVixJQUFJLENBQUM7WUFDSCxNQUFNLEdBQUcsZ0JBQWdCLENBQUMsY0FBYyxFQUFFLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDeEQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLEtBQUssWUFBWSxLQUFLLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyw2QkFBNkIsQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLDRCQUE0QixDQUFDLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUE7WUFFMUosTUFBTSxLQUFLLENBQUE7UUFDYixDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxFQUFDLE1BQU0sRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtJQUN4RSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILDZCQUE2QixDQUFDLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRSxhQUFhLEVBQUM7UUFDdEUsSUFBSSxhQUFhLEVBQUUsQ0FBQztZQUNsQixNQUFNLG9CQUFvQixHQUFHLGFBQWEsQ0FBQywwQkFBMEIsRUFBRSxDQUFBO1lBRXZFLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUE7UUFDdEcsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQyxhQUFhLENBQUE7UUFFN0MsT0FBTyxPQUFPLENBQUMsWUFBWSxJQUFJLE9BQU8sWUFBWSxJQUFJLFFBQVEsSUFBSSxNQUFNLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUE7SUFDdEksQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxVQUFVLEVBQUM7UUFDdkUsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUU1QixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsRUFBQyxVQUFVLEVBQUUsYUFBYSxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO1FBRXRHLElBQUksQ0FBQyxjQUFjO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFaEMsTUFBTSxTQUFTLEdBQUcsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUM7WUFDcEQsVUFBVSxFQUFFLGFBQWE7WUFDekIsZUFBZSxFQUFFLGNBQWM7U0FDaEMsQ0FBQyxDQUFBO1FBRUYsd0VBQXdFO1FBQ3hFLDBFQUEwRTtRQUMxRSw4REFBOEQ7UUFDOUQsT0FBTyxTQUFTO1lBQ2QsQ0FBQyxDQUFDLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxvQ0FBb0MsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsRUFBQyxTQUFTLEVBQUMsQ0FBQyxDQUFDLEVBQUM7WUFDckcsQ0FBQyxDQUFDLElBQUksQ0FBQTtJQUNWLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILG9DQUFvQyxDQUFDLFNBQVM7UUFDNUMsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLENBQUMsaUNBQWlDLEVBQUUsQ0FBQTtRQUNwRSxNQUFNLHFCQUFxQixHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsc0JBQXNCLENBQUMsSUFBSSxFQUFFLENBQUE7UUFFM0UsSUFBSSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNyRixPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFFRCxPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxpQ0FBaUM7UUFDL0IsT0FBTyxJQUFJLEdBQUcsQ0FBQztZQUNiLE9BQU8sRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSw2QkFBNkIsRUFBRSw2QkFBNkI7WUFDbkcsS0FBSyxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsVUFBVSxFQUFFLGVBQWUsRUFBRSxRQUFRO1lBQ2pHLFVBQVUsRUFBRSxZQUFZLEVBQUUsS0FBSztTQUNoQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztPQVlHO0lBQ0gsa0NBQWtDLENBQUMsRUFBQyxxQkFBcUIsRUFBRSxhQUFhLEVBQUUsU0FBUyxFQUFFLFVBQVUsRUFBQztRQUM5RixNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxpQ0FBaUMsRUFBRSxDQUFBO1FBQ3BFLHVCQUF1QjtRQUN2QixNQUFNLGdCQUFnQixHQUFHLEVBQUUsQ0FBQTtRQUMzQjs7Ozs7V0FLRztRQUNILE1BQU0sd0JBQXdCLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFO1lBQ3BELE1BQU0sV0FBVyxHQUFHLGtDQUFrQyxnQkFBZ0IsQ0FBQyxNQUFNLElBQUksQ0FBQTtZQUVqRixnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtZQUV2QyxPQUFPLFdBQVcsQ0FBQTtRQUNwQixDQUFDLENBQUE7UUFFRCxJQUFJLENBQUMsMENBQTBDLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFMUQsTUFBTSwwQkFBMEIsR0FBRyxTQUFTO1lBQzFDLHFFQUFxRTtZQUNyRSxzRUFBc0U7WUFDdEUseUVBQXlFO1lBQ3pFLGlFQUFpRTthQUNoRSxPQUFPLENBQUMsbUZBQW1GLEVBQUUsQ0FBQyxNQUFNLEVBQUUsU0FBUyxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsRUFBRTtZQUM1SSxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxzQ0FBc0MsQ0FBQztnQkFDckUscUJBQXFCO2dCQUNyQixVQUFVO2dCQUNWLFNBQVM7YUFDVixDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsa0JBQWtCO2dCQUFFLE9BQU8sS0FBSyxDQUFBO1lBRXJDLE9BQU8sd0JBQXdCLENBQUMsVUFBVSxJQUFJLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLElBQUksV0FBVyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLEdBQUcsV0FBVyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ3RKLENBQUMsQ0FBQyxDQUFBO1FBRUosSUFBSSxvQkFBb0IsR0FBRywwQkFBMEIsQ0FBQTtRQUVyRCxLQUFLLE1BQU0sQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLElBQUksYUFBYSxFQUFFLENBQUM7WUFDckQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsc0NBQXNDLENBQUM7Z0JBQ3JFLHFCQUFxQjtnQkFDckIsVUFBVTtnQkFDVixTQUFTLEVBQUUsV0FBVyxDQUFDLFNBQVM7YUFDakMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLGtCQUFrQjtnQkFBRSxTQUFRO1lBRWpDLE1BQU0sVUFBVSxHQUFHLElBQUksTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFBO1lBRTNFLG9CQUFvQixHQUFHLG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsd0JBQXdCLENBQUMsVUFBVSxJQUFJLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLEtBQUssV0FBVyxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUN4SyxDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsb0JBQW9CO1lBQ3BDLGtGQUFrRjtZQUNsRixpRkFBaUY7YUFDaEYsT0FBTyxDQUFDLHdCQUF3QixFQUFFLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFOUcsT0FBTyxnQkFBZ0IsQ0FBQyxNQUFNLENBQzVCLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxrQ0FBa0MsS0FBSyxJQUFJLEVBQUUsZ0JBQWdCLENBQUMsRUFDakgsU0FBUyxDQUNWLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDBDQUEwQyxDQUFDLFNBQVM7UUFDbEQsTUFBTSxvQkFBb0IsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLDBFQUEwRSxDQUFDLENBQUE7UUFFeEgsSUFBSSxDQUFDLG9CQUFvQjtZQUFFLE9BQU07UUFFakMsTUFBTSxJQUFJLEtBQUssQ0FBQywyR0FBMkcsb0JBQW9CLENBQUMsQ0FBQyxDQUFDLDRGQUE0RixDQUFDLENBQUE7SUFDalAsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxzQ0FBc0MsQ0FBQyxFQUFDLHFCQUFxQixFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUM7UUFDbkYsSUFBSSxDQUFDLFVBQVUsSUFBSSxDQUFDLHFCQUFxQjtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQ3RELElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUM7WUFBRSxPQUFPLFNBQVMsQ0FBQTtRQUU5RSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsU0FBUyxDQUFDLENBQUE7UUFDdEUsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMsK0NBQStDLENBQUM7WUFDaEYscUJBQXFCO1lBQ3JCLFlBQVk7U0FDYixDQUFDLENBQUE7UUFFRixJQUFJLG9CQUFvQjtZQUFFLE9BQU8sb0JBQW9CLENBQUE7UUFFckQsSUFBSSxJQUFJLENBQUMsNEJBQTRCLENBQUMsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLG1DQUFtQyxFQUFFLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBQyxDQUFDLEVBQUUsQ0FBQztZQUN6SCxPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxxQkFBcUIsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtJQUM5RixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsK0NBQStDLENBQUMsRUFBQyxxQkFBcUIsRUFBRSxZQUFZLEVBQUM7UUFDbkYsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDbkUsTUFBTSxpQkFBaUIsR0FBRyxZQUFZLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxLQUFLLENBQUE7UUFFNUYsS0FBSyxNQUFNLGFBQWEsSUFBSSxJQUFJLENBQUMsK0JBQStCLEVBQUUsRUFBRSxDQUFDO1lBQ25FLEtBQUssTUFBTSxlQUFlLElBQUksSUFBSSxDQUFDLG1DQUFtQyxFQUFFLEVBQUUsQ0FBQztnQkFDekUsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsUUFBUSxDQUFDLENBQUE7Z0JBQzVELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsYUFBYSxDQUFDLENBQUE7Z0JBRXBFLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLElBQUksQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUM7b0JBQUUsU0FBUTtnQkFFbEYsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQUM7b0JBQ2xDLFFBQVEsRUFBRSxxQkFBcUI7b0JBQy9CLE1BQU0sRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLHVCQUF1QixFQUFFLGFBQWEsQ0FBQztpQkFDMUQsQ0FBQyxDQUFBO1lBQ0osQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7O09BR0c7SUFDSCwrQkFBK0I7UUFDN0IsMEJBQTBCO1FBQzFCLE1BQU0sU0FBUyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFM0IsS0FBSyxNQUFNLGNBQWMsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUM7WUFDMUUsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBRWpFLEtBQUssTUFBTSxpQkFBaUIsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZELE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFBO2dCQUU3RSxTQUFTLENBQUMsR0FBRyxDQUFDLEdBQUcsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQy9FLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHVCQUF1QixDQUFDLEVBQUMsUUFBUSxFQUFFLE1BQU0sRUFBQztRQUN4QyxJQUFJLGlCQUFpQixHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUUvRixJQUFJLENBQUMsaUJBQWlCLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDdkMsaUJBQWlCLEdBQUcsS0FBSyxpQkFBaUIsRUFBRSxDQUFBO1FBQzlDLENBQUM7UUFFRCxPQUFPLGlCQUFpQixDQUFBO0lBQzFCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCw0QkFBNEIsQ0FBQyxFQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUM7UUFDbEQsT0FBTyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUU7WUFDcEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQTtZQUVuRixPQUFPLFlBQVksS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUE7UUFDbEcsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFlBQVksQ0FBQyxLQUFLO1FBQ2hCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRSxNQUFNLENBQUMsQ0FBQTtJQUNyRCxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsNEJBQTRCLENBQUMsRUFBQyxlQUFlLEVBQUUsVUFBVSxFQUFDO1FBQ3hELE1BQU0sUUFBUSxHQUFHLGVBQWUsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFDLElBQUksRUFBRSxFQUFFLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFBO1FBQzVFLE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxVQUFVLElBQUksNkNBQTZDLENBQUE7UUFFdkYsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM3QixNQUFNLGNBQWMsR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQzNELDhFQUE4RTtZQUM5RSx5RUFBeUU7WUFDekUsaUZBQWlGO1lBQ2pGLHdFQUF3RTtZQUN4RSxNQUFNLHFCQUFxQixHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxJQUFJLENBQUMseUJBQXlCLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUVqSCxPQUFPO2dCQUNMLFNBQVMsRUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxJQUFJLEtBQUsscUJBQXFCLENBQUMsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZKLFVBQVUsRUFBRSxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsR0FBRyxjQUFjLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7Z0JBQzNGLGdCQUFnQixFQUFFLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRztnQkFDbEQsVUFBVTthQUNYLENBQUE7UUFDSCxDQUFDO1FBRUQsT0FBTztZQUNMLFNBQVMsRUFBRSw2RkFBNkY7WUFDeEcsVUFBVSxFQUFFLHFCQUFxQjtZQUNqQyxnQkFBZ0IsRUFBRSxrQkFBa0I7WUFDcEMsVUFBVTtTQUNYLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gseUJBQXlCLENBQUMsSUFBSTtRQUM1QixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7UUFFL0Isb0ZBQW9GO1FBQ3BGLHNGQUFzRjtRQUN0Riw0RUFBNEU7UUFDNUUsSUFBSSxDQUFDLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxXQUFXLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFDN0UsSUFBSSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxXQUFXLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUVsRSxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXRDLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLHdCQUF3QixDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDMUQsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBRWxELDhFQUE4RTtZQUM5RSwyRUFBMkU7WUFDM0UsSUFBSSxVQUFVLEdBQUcsQ0FBQztnQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUVoQyxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxVQUFVLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUU5QyxxRkFBcUY7WUFDckYsNEVBQTRFO1lBQzVFLElBQUksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUM7Z0JBQUUsT0FBTyxLQUFLLENBQUE7UUFDOUQsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHdCQUF3QixDQUFDLEtBQUs7UUFDNUIsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBO1FBQ2xCLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQTtRQUNiLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQTtRQUViLEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLEtBQUssR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNyRCxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUE7WUFFOUIsSUFBSSxTQUFTLEtBQUssR0FBRyxJQUFJLFNBQVMsS0FBSyxHQUFHLElBQUksU0FBUyxLQUFLLEdBQUcsSUFBSSxTQUFTLEtBQUssR0FBRyxFQUFFLENBQUM7Z0JBQ3JGLEtBQUssSUFBSSxDQUFDLENBQUE7WUFDWixDQUFDO2lCQUFNLElBQUksU0FBUyxLQUFLLEdBQUcsSUFBSSxTQUFTLEtBQUssR0FBRyxJQUFJLFNBQVMsS0FBSyxHQUFHLElBQUksU0FBUyxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUM1RixLQUFLLElBQUksQ0FBQyxDQUFBO1lBQ1osQ0FBQztpQkFBTSxJQUFJLENBQUMsU0FBUyxLQUFLLEdBQUcsSUFBSSxTQUFTLEtBQUssR0FBRyxDQUFDLElBQUksS0FBSyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUNuRSxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7Z0JBQ3ZDLEtBQUssR0FBRyxLQUFLLEdBQUcsQ0FBQyxDQUFBO1lBQ25CLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFFaEMsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUE7SUFDckYsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsa0JBQWtCLENBQUMsTUFBTTtRQUN2QixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUE7UUFFYixLQUFLLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRSxLQUFLLEdBQUcsTUFBTSxDQUFDLE1BQU0sRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDdEQsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBRS9CLElBQUksU0FBUyxLQUFLLEdBQUcsSUFBSSxTQUFTLEtBQUssR0FBRyxJQUFJLFNBQVMsS0FBSyxHQUFHLElBQUksU0FBUyxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUNyRixLQUFLLElBQUksQ0FBQyxDQUFBO1lBQ1osQ0FBQztpQkFBTSxJQUFJLFNBQVMsS0FBSyxHQUFHLElBQUksU0FBUyxLQUFLLEdBQUcsSUFBSSxTQUFTLEtBQUssR0FBRyxJQUFJLFNBQVMsS0FBSyxHQUFHLEVBQUUsQ0FBQztnQkFDNUYsS0FBSyxJQUFJLENBQUMsQ0FBQTtZQUNaLENBQUM7aUJBQU0sSUFBSSxTQUFTLEtBQUssR0FBRyxJQUFJLEtBQUssS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDNUMsT0FBTyxLQUFLLENBQUE7WUFDZCxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sQ0FBQyxDQUFDLENBQUE7SUFDWCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsNkJBQTZCLENBQUMsSUFBSTtRQUNoQyxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUE7UUFFYixLQUFLLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRSxLQUFLLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDcEQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBRTdCLElBQUksU0FBUyxLQUFLLEdBQUcsSUFBSSxTQUFTLEtBQUssR0FBRyxJQUFJLFNBQVMsS0FBSyxHQUFHLElBQUksU0FBUyxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUNyRixLQUFLLElBQUksQ0FBQyxDQUFBO1lBQ1osQ0FBQztpQkFBTSxJQUFJLFNBQVMsS0FBSyxHQUFHLElBQUksU0FBUyxLQUFLLEdBQUcsSUFBSSxTQUFTLEtBQUssR0FBRyxJQUFJLFNBQVMsS0FBSyxHQUFHLEVBQUUsQ0FBQztnQkFDNUYsS0FBSyxJQUFJLENBQUMsQ0FBQTtnQkFFViwrRUFBK0U7Z0JBQy9FLElBQUksS0FBSyxLQUFLLENBQUMsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDO29CQUFFLE9BQU8sS0FBSyxDQUFBO1lBQzFELENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxLQUFLLEtBQUssQ0FBQyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7T0FjRztJQUNILEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxFQUFDLGVBQWUsRUFBRSxZQUFZLEVBQUUscUJBQXFCLEVBQUUsYUFBYSxFQUFDO1FBQzFHLElBQUksQ0FBQyxhQUFhO1lBQUUsT0FBTyxlQUFlLENBQUE7UUFFMUMscUdBQXFHO1FBQ3JHLE1BQU0sUUFBUSxHQUFHLEVBQUMsR0FBRyxlQUFlLEVBQUMsQ0FBQTtRQUVyQyxLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sUUFBUSxHQUFHLGVBQWUsQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFDLElBQUksRUFBRSxFQUFFLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFBO1lBQzdFLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBQyxDQUFDLENBQUE7WUFFeEcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO2dCQUNyQixRQUFRLENBQUMsV0FBVyxDQUFDLEdBQUcsUUFBUSxDQUFBO2dCQUVoQyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksVUFBVSxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUE7WUFFcEMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUNoQixNQUFNLGVBQWUsR0FBRyxNQUFNLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQTtnQkFFakgsSUFBSSxlQUFlLEVBQUUsQ0FBQztvQkFDcEIsVUFBVSxHQUFHLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQzt3QkFDbkQscUJBQXFCO3dCQUNyQixhQUFhLEVBQUUsZUFBZSxDQUFDLGFBQWE7d0JBQzVDLFNBQVMsRUFBRSxJQUFJLENBQUMseUJBQXlCLENBQUMsRUFBQyxTQUFTLEVBQUUsZUFBZSxDQUFDLElBQUksRUFBQyxDQUFDO3dCQUM1RSxVQUFVLEVBQUUsZUFBZSxDQUFDLFVBQVU7cUJBQ3ZDLENBQUMsQ0FBQTtnQkFDSixDQUFDO1lBQ0gsQ0FBQztZQUVELElBQUksSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUE7WUFFeEIsSUFBSSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUMvQixNQUFNLGVBQWUsR0FBRyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQTtnQkFDdkcsdUVBQXVFO2dCQUN2RSxxRUFBcUU7Z0JBQ3JFLHlFQUF5RTtnQkFDekUsTUFBTSxrQkFBa0IsR0FBRyxDQUFDLGVBQWUsSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLE9BQU8sU0FBUyxDQUFDLElBQUksS0FBSyxRQUFRLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFBO2dCQUU3SSxJQUFJLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDbEMsSUFBSSxHQUFHLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQzt3QkFDNUMsSUFBSSxFQUFFLHFCQUFxQixDQUFDLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt3QkFDNUMsSUFBSSxFQUFFLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQzs0QkFDNUMscUJBQXFCOzRCQUNyQixhQUFhLEVBQUUsU0FBUyxDQUFDLGFBQWE7NEJBQ3RDLFNBQVMsRUFBRSxTQUFTLENBQUMsSUFBSTs0QkFDekIsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVO3lCQUNqQyxDQUFDO3FCQUNILENBQUMsQ0FBQyxDQUFBO2dCQUNMLENBQUM7WUFDSCxDQUFDO1lBRUQsUUFBUSxDQUFDLFdBQVcsQ0FBQyxHQUFHLEVBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxFQUFFLEVBQUUsVUFBVSxFQUFFLFVBQVUsSUFBSSxJQUFJLEVBQUMsQ0FBQTtRQUM1RSxDQUFDO1FBRUQsT0FBTyxRQUFRLENBQUE7SUFDakIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gseUJBQXlCLENBQUMsRUFBQyxTQUFTLEVBQUM7UUFDbkMsTUFBTSxhQUFhLEdBQUcsVUFBVSxDQUFBO1FBRWhDLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQztZQUFFLE9BQU8sU0FBUyxDQUFBO1FBRTFELElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDN0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxnREFBZ0QsU0FBUyxFQUFFLENBQUMsQ0FBQTtRQUM5RSxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7UUFFckUsSUFBSSxZQUFZLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzVCLE1BQU0sSUFBSSxLQUFLLENBQUMsMkRBQTJELFNBQVMsRUFBRSxDQUFDLENBQUE7UUFDekYsQ0FBQztRQUVELE9BQU8sWUFBWSxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxvQkFBb0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUM7UUFDNUMsSUFBSSxTQUFTLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQTtRQUVyQyxPQUFPLFNBQVMsSUFBSSxTQUFTLEtBQUssTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ25ELElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUNoRSxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsd0JBQXdCLENBQUMsU0FBUyxFQUFFLFVBQVUsQ0FBQyxDQUFBO2dCQUV6RSxJQUFJLE9BQU8sVUFBVSxFQUFFLEtBQUssSUFBSSxVQUFVO29CQUFFLE9BQU8sSUFBSSxDQUFBO2dCQUV2RCxNQUFNLGVBQWUsR0FBRyxTQUFTLENBQUMsV0FBVyxFQUFFLElBQUksQ0FBQTtnQkFFbkQsSUFBSSxPQUFPLGVBQWUsSUFBSSxRQUFRLElBQUksZUFBZSxDQUFDLE1BQU0sR0FBRyxDQUFDO29CQUFFLE9BQU8sZUFBZSxDQUFBO2dCQUU1RixPQUFPLElBQUksQ0FBQTtZQUNiLENBQUM7WUFFRCxTQUFTLEdBQUcsTUFBTSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUM5QyxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QixDQUFDLEVBQUMsVUFBVSxFQUFFLGVBQWUsRUFBQztRQUMxRCxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFDLFVBQVUsRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO1FBRS9GLE9BQU8sVUFBVSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFDLFVBQVUsRUFBRSxlQUFlLEVBQUM7UUFDcEUsTUFBTSx5QkFBeUIsR0FBRyxNQUFNLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFBO1FBQ3hFLE1BQU0sYUFBYSxHQUFHLEdBQUcsZUFBZSxJQUFJLFVBQVUsRUFBRSxDQUFBO1FBRXhELElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFOUQsTUFBTSxVQUFVLEdBQUcseUJBQXlCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRS9ELElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLGtDQUFrQyxhQUFhLEVBQUUsQ0FBQyxDQUFBO1FBQ3BFLENBQUM7UUFFRCxJQUFJLE9BQU8sVUFBVSxDQUFDLElBQUksSUFBSSxRQUFRLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDckUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsYUFBYSxFQUFFLENBQUMsQ0FBQTtRQUM5RSxDQUFDO1FBRUQsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsMkJBQTJCLENBQUMsRUFBQyxVQUFVLEVBQUUsY0FBYyxFQUFFLGVBQWUsRUFBQztRQUM3RSxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO1FBRXJGLElBQUksQ0FBQyxVQUFVO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFNUIsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBRTVDLElBQUksU0FBUyxLQUFLLFNBQVM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV4QyxJQUFJLFNBQVMsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzlCLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLGVBQWUsSUFBSSxVQUFVLGNBQWMsY0FBYyxFQUFFLENBQUMsQ0FBQTtRQUM3SCxDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUMsSUFBSSxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QixDQUFDLEVBQUMsVUFBVSxFQUFFLGVBQWUsRUFBQztRQUMxRCxNQUFNLDRCQUE0QixHQUFHLE1BQU0sSUFBSSxDQUFDLDRCQUE0QixFQUFFLENBQUE7UUFDOUUsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLGVBQWUsSUFBSSxVQUFVLEVBQUUsQ0FBQTtRQUU1RCxJQUFJLENBQUMsNEJBQTRCLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFckUsTUFBTSxVQUFVLEdBQUcsNEJBQTRCLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLENBQUE7UUFFdEUsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsaUNBQWlDLGlCQUFpQixFQUFFLENBQUMsQ0FBQTtRQUN2RSxDQUFDO1FBRUQsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyx5QkFBeUI7UUFDN0IsSUFBSSxJQUFJLENBQUMsMEJBQTBCO1lBQUUsT0FBTyxJQUFJLENBQUMsMEJBQTBCLENBQUE7UUFFM0UsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtRQUM5RCxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRTdCLEtBQUssTUFBTSxVQUFVLElBQUksV0FBVyxFQUFFLENBQUM7WUFDckMsTUFBTSxVQUFVLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQTtZQUV4RCxJQUFJLENBQUMsc0NBQXNDLENBQUMsRUFBQyxXQUFXLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDcEYsQ0FBQztRQUVELElBQUksQ0FBQywwQkFBMEIsR0FBRyxXQUFXLENBQUE7UUFFN0MsT0FBTyxXQUFXLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyw0QkFBNEI7UUFDaEMsSUFBSSxJQUFJLENBQUMsNkJBQTZCO1lBQUUsT0FBTyxJQUFJLENBQUMsNkJBQTZCLENBQUE7UUFFakYsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtRQUM5RCxNQUFNLGNBQWMsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRWhDLEtBQUssTUFBTSxVQUFVLElBQUksV0FBVyxFQUFFLENBQUM7WUFDckMsTUFBTSxVQUFVLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQTtZQUV4RCxJQUFJLENBQUMseUNBQXlDLENBQUMsRUFBQyxjQUFjLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDMUYsQ0FBQztRQUVELElBQUksQ0FBQyw2QkFBNkIsR0FBRyxjQUFjLENBQUE7UUFFbkQsT0FBTyxjQUFjLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyw2QkFBNkI7UUFDakMsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBRXRCLEtBQUssTUFBTSxlQUFlLElBQUksSUFBSSxDQUFDLG1DQUFtQyxFQUFFLEVBQUUsQ0FBQztZQUN6RSxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUM3RSxDQUFDO1FBRUQsT0FBTyxXQUFXLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILG1DQUFtQztRQUNqQyxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXZFLEtBQUssTUFBTSxjQUFjLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxDQUFDO1lBQzFFLElBQUksT0FBTyxjQUFjLENBQUMsSUFBSSxJQUFJLFFBQVEsSUFBSSxjQUFjLENBQUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDN0UsaUJBQWlCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQzlELENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUE7SUFDdEMsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxzQ0FBc0MsQ0FBQyxFQUFDLFdBQVcsRUFBRSxVQUFVLEdBQUcsSUFBSSxFQUFFLFVBQVUsRUFBQztRQUNqRixNQUFNLFVBQVUsR0FBRyxzREFBc0QsQ0FBQTtRQUN6RSxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDbkUsSUFBSSxVQUFVLENBQUE7UUFFZCxPQUFPLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ2xELE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUMvQixNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsU0FBUyxDQUFBO1lBQzNDLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxjQUFjLEdBQUcsQ0FBQyxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7WUFFekYsSUFBSSxZQUFZLElBQUksSUFBSSxFQUFFLENBQUM7Z0JBQ3pCLHlFQUF5RTtnQkFDekUsd0VBQXdFO2dCQUN4RSxrRUFBa0U7Z0JBQ2xFLHFFQUFxRTtnQkFDckUsNERBQTREO2dCQUM1RCxTQUFRO1lBQ1YsQ0FBQztZQUVELE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUMsY0FBYyxFQUFFLFlBQVksQ0FBQyxDQUFBO1lBQ2hFLE1BQU0sVUFBVSxHQUFHLHVCQUF1QixDQUFBO1lBQzFDLElBQUksVUFBVSxDQUFBO1lBRWQsT0FBTyxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDakQsTUFBTSxnQkFBZ0IsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsQ0FBQTtnQkFDOUQsTUFBTSxXQUFXLEdBQUcsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUE7Z0JBRXRGLElBQUksQ0FBQyxXQUFXO29CQUFFLFNBQVE7Z0JBRTFCLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQTtnQkFFakMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtnQkFFdEQsSUFBSSxVQUFVLEVBQUUsQ0FBQztvQkFDZixXQUFXLENBQUMsR0FBRyxDQUFDLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxFQUFFLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFDLENBQUMsQ0FBQTtnQkFDOUYsQ0FBQztZQUNILENBQUM7WUFFRCxVQUFVLENBQUMsU0FBUyxHQUFHLFlBQVksR0FBRyxDQUFDLENBQUE7UUFDekMsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gseUNBQXlDLENBQUMsRUFBQyxjQUFjLEVBQUUsVUFBVSxHQUFHLElBQUksRUFBRSxVQUFVLEVBQUM7UUFDdkYsTUFBTSxVQUFVLEdBQUcsc0RBQXNELENBQUE7UUFDekUsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ25FLElBQUksVUFBVSxDQUFBO1FBRWQsT0FBTyxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNsRCxNQUFNLFNBQVMsR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDL0IsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLFNBQVMsQ0FBQTtZQUMzQyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBQyxTQUFTLEVBQUUsY0FBYyxHQUFHLENBQUMsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO1lBRXpGLElBQUksWUFBWSxJQUFJLElBQUksRUFBRSxDQUFDO2dCQUN6Qix5RUFBeUU7Z0JBQ3pFLHdFQUF3RTtnQkFDeEUsa0VBQWtFO2dCQUNsRSxxRUFBcUU7Z0JBQ3JFLDREQUE0RDtnQkFDNUQsU0FBUTtZQUNWLENBQUM7WUFFRCxNQUFNLFNBQVMsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDLGNBQWMsRUFBRSxZQUFZLENBQUMsQ0FBQTtZQUNoRSxNQUFNLFVBQVUsR0FBRyx1QkFBdUIsQ0FBQTtZQUMxQyxJQUFJLFVBQVUsQ0FBQTtZQUVkLE9BQU8sQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ2pELE1BQU0sZ0JBQWdCLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUE7Z0JBQzlELE1BQU0sV0FBVyxHQUFHLGdCQUFnQixDQUFDLEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxDQUFBO2dCQUV0RixJQUFJLENBQUMsV0FBVztvQkFBRSxTQUFRO2dCQUUxQixNQUFNLFVBQVUsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUE7Z0JBQ2pDLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7Z0JBRTNELElBQUksZUFBZSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDL0IsY0FBYyxDQUFDLEdBQUcsQ0FBQyxHQUFHLFNBQVMsSUFBSSxVQUFVLEVBQUUsRUFBRSxlQUFlLENBQUMsR0FBRyxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUMsR0FBRyxTQUFTLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUNuSSxDQUFDO1lBQ0gsQ0FBQztZQUVELFVBQVUsQ0FBQyxTQUFTLEdBQUcsWUFBWSxHQUFHLENBQUMsQ0FBQTtRQUN6QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCw0QkFBNEIsQ0FBQyxVQUFVO1FBQ3JDLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDL0IsTUFBTSxXQUFXLEdBQUcseURBQXlELENBQUE7UUFDN0UsSUFBSSxXQUFXLENBQUE7UUFFZixPQUFPLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ3BELE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUNqQyxNQUFNLFNBQVMsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFaEMsS0FBSyxNQUFNLGNBQWMsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ25ELE1BQU0sV0FBVyxHQUFHLGNBQWMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtnQkFFekMsSUFBSSxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUM7b0JBQUUsU0FBUTtnQkFFcEMsTUFBTSxVQUFVLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyw2REFBNkQsQ0FBQyxDQUFBO2dCQUVuRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsd0NBQXdDLFdBQVcsRUFBRSxDQUFDLENBQUE7Z0JBQ3hFLENBQUM7Z0JBRUQsTUFBTSxZQUFZLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUNsQyxNQUFNLFNBQVMsR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLElBQUksWUFBWSxDQUFBO2dCQUUvQyxhQUFhLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxFQUFDLFlBQVksRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1lBQ3pELENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxhQUFhLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsU0FBUztRQUN2QixNQUFNLFlBQVksR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFdEQsSUFBSSxDQUFDLFlBQVksSUFBSSxZQUFZLENBQUMsS0FBSyxJQUFJLElBQUk7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUU1RCxNQUFNLGFBQWEsR0FBRyxZQUFZLENBQUMsS0FBSyxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFBO1FBQ3JFLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUE7UUFFakcsSUFBSSxjQUFjLElBQUksSUFBSSxFQUFFLENBQUM7WUFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQywyQ0FBMkMsU0FBUyxFQUFFLENBQUMsQ0FBQTtRQUN6RSxDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsYUFBYSxHQUFHLENBQUMsRUFBRSxjQUFjLENBQUMsQ0FBQyxDQUFBO1FBRTlGLElBQUksVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBQzFFLENBQUM7UUFFRCxPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILGtCQUFrQixDQUFDLFNBQVM7UUFDMUIsT0FBTyxTQUFTLENBQUMsT0FBTyxDQUFDLG9CQUFvQixFQUFFLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFBO0lBQzVELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsZUFBZSxDQUFDLFNBQVM7UUFDdkIsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFBO1FBQ3JCLE1BQU0sVUFBVSxHQUFHLGNBQWMsQ0FBQTtRQUNqQyxJQUFJLFdBQVcsQ0FBQTtRQUVmLE9BQU8sQ0FBQyxXQUFXLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDbEQsTUFBTSxhQUFhLEdBQUcsVUFBVSxDQUFDLFNBQVMsR0FBRyxDQUFDLENBQUE7WUFDOUMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUMsU0FBUyxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtZQUVqRyxJQUFJLGNBQWMsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsU0FBUyxFQUFFLENBQUMsQ0FBQTtZQUM1RSxDQUFDO1lBRUQsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsYUFBYSxHQUFHLENBQUMsRUFBRSxjQUFjLENBQUMsQ0FBQyxDQUFBO1lBRXhGLElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDcEIsTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsU0FBUyxFQUFFLENBQUMsQ0FBQTtZQUM3RSxDQUFDO1lBRUQsMkVBQTJFO1lBQzNFLDhFQUE4RTtZQUM5RSwrRUFBK0U7WUFDL0UsdUVBQXVFO1lBQ3ZFLE1BQU0sU0FBUyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsY0FBYyxHQUFHLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxDQUFBO1lBRTVGLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBQzlELFVBQVUsQ0FBQyxTQUFTLEdBQUcsY0FBYyxHQUFHLENBQUMsQ0FBQTtRQUMzQyxDQUFDO1FBRUQsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsU0FBUztRQUN4QyxJQUFJLE9BQU8sQ0FBQTtRQUVYLElBQUksQ0FBQztZQUNILE9BQU8sR0FBRyxNQUFNLEVBQUUsQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLEVBQUMsYUFBYSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDOUQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssSUFBSSxRQUFRLElBQUksTUFBTSxJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFFBQVE7Z0JBQUUsT0FBTyxFQUFFLENBQUE7WUFFOUYsTUFBTSxLQUFLLENBQUE7UUFDYixDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsRUFBRSxDQUFBO1FBRXBCLEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxFQUFFLENBQUM7WUFDNUIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBRWxELElBQUksS0FBSyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7Z0JBQ3hCLFNBQVMsQ0FBQyxJQUFJLENBQUMsR0FBRyxNQUFNLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO1lBQ3JFLENBQUM7aUJBQU0sSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLElBQUksb0JBQW9CLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUNuRSxTQUFTLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBQzNCLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGtCQUFrQixDQUFDLEVBQUMsU0FBUyxFQUFFLFVBQVUsRUFBQztRQUN4QyxJQUFJLFVBQVUsQ0FBQyxTQUFTLENBQUMsS0FBSyxHQUFHLEVBQUUsQ0FBQztZQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLG1DQUFtQyxTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBQ2pFLENBQUM7UUFFRCxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUE7UUFDYixJQUFJLGNBQWMsR0FBRyxLQUFLLENBQUE7UUFDMUIsSUFBSSxhQUFhLEdBQUcsS0FBSyxDQUFBO1FBQ3pCLElBQUksUUFBUSxHQUFHLEVBQUUsQ0FBQTtRQUVqQixLQUFLLElBQUksS0FBSyxHQUFHLFNBQVMsRUFBRSxLQUFLLEdBQUcsVUFBVSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDO1lBQy9ELE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUM5QixNQUFNLFFBQVEsR0FBRyxVQUFVLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFBO1lBQ3RDLE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUE7WUFFMUMsSUFBSSxhQUFhLEVBQUUsQ0FBQztnQkFDbEIsSUFBSSxJQUFJLEtBQUssSUFBSTtvQkFBRSxhQUFhLEdBQUcsS0FBSyxDQUFBO2dCQUV4QyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksY0FBYyxFQUFFLENBQUM7Z0JBQ25CLElBQUksSUFBSSxLQUFLLEdBQUcsSUFBSSxRQUFRLEtBQUssR0FBRyxFQUFFLENBQUM7b0JBQ3JDLGNBQWMsR0FBRyxLQUFLLENBQUE7b0JBQ3RCLEtBQUssRUFBRSxDQUFBO2dCQUNULENBQUM7Z0JBRUQsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUNiLElBQUksSUFBSSxLQUFLLFFBQVEsSUFBSSxZQUFZLEtBQUssSUFBSTtvQkFBRSxRQUFRLEdBQUcsRUFBRSxDQUFBO2dCQUU3RCxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksSUFBSSxLQUFLLEdBQUcsSUFBSSxRQUFRLEtBQUssR0FBRyxFQUFFLENBQUM7Z0JBQ3JDLGFBQWEsR0FBRyxJQUFJLENBQUE7Z0JBQ3BCLEtBQUssRUFBRSxDQUFBO2dCQUNQLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxJQUFJLEtBQUssR0FBRyxJQUFJLFFBQVEsS0FBSyxHQUFHLEVBQUUsQ0FBQztnQkFDckMsY0FBYyxHQUFHLElBQUksQ0FBQTtnQkFDckIsS0FBSyxFQUFFLENBQUE7Z0JBQ1AsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxLQUFLLEdBQUcsSUFBSSxJQUFJLEtBQUssR0FBRyxFQUFFLENBQUM7Z0JBQ2xELFFBQVEsR0FBRyxJQUFJLENBQUE7Z0JBQ2YsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLElBQUksS0FBSyxHQUFHLEVBQUUsQ0FBQztnQkFDakIsS0FBSyxFQUFFLENBQUE7WUFDVCxDQUFDO2lCQUFNLElBQUksSUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUN4QixLQUFLLEVBQUUsQ0FBQTtnQkFFUCxJQUFJLEtBQUssS0FBSyxDQUFDO29CQUFFLE9BQU8sS0FBSyxDQUFBO1lBQy9CLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsd0NBQXdDLENBQUMsRUFBQyxhQUFhLEVBQUUsVUFBVSxFQUFDO1FBQ2xFLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNoQixPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxNQUFNLHFCQUFxQixHQUFHLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUU1RSxJQUFJLENBQUMscUJBQXFCO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFdkMsSUFBSSxVQUFVLENBQUE7UUFFZCxJQUFJLENBQUM7WUFDSCxVQUFVLEdBQUcsVUFBVSxDQUFDLCtCQUErQixFQUFFLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUNsRixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksS0FBSyxZQUFZLEtBQUssSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyw0QkFBNEIsQ0FBQztnQkFBRSxPQUFPLElBQUksQ0FBQTtZQUUvRixNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7UUFFRCxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUE7UUFFVixJQUFJLENBQUM7WUFDSCxNQUFNLEdBQUcsVUFBVSxDQUFDLGNBQWMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ2xELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxLQUFLLFlBQVksS0FBSyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLDRCQUE0QixDQUFDO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBRS9GLE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsRUFBQyxNQUFNLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsZ0NBQWdDLENBQUMsRUFBQyxNQUFNLEVBQUM7UUFDdkMsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRTdCLElBQUksT0FBTyxJQUFJLElBQUksUUFBUSxJQUFJLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDL0MsTUFBTSxJQUFJLEtBQUssQ0FBQywrRUFBK0UsSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUN4RyxDQUFDO1FBRUQsT0FBTztZQUNMLElBQUksRUFBRSxNQUFNLENBQUMsT0FBTyxFQUFFO1lBQ3RCLElBQUk7U0FDTCxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxxQkFBcUIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxXQUFXLEVBQUUsYUFBYSxFQUFDO1FBQzNELE1BQU0sYUFBYSxHQUFHLFdBQVcsQ0FBQyxhQUFhLENBQUE7UUFFL0MsSUFBSSxhQUFhLEtBQUssU0FBUyxJQUFJLGFBQWEsS0FBSyxJQUFJLEVBQUUsQ0FBQztZQUMxRCxPQUFPLEVBQUUsQ0FBQTtRQUNYLENBQUM7UUFFRCxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1lBQ2xDLE1BQU0sSUFBSSxLQUFLLENBQUMsVUFBVSxTQUFTLG9GQUFvRixPQUFPLGFBQWEsRUFBRSxDQUFDLENBQUE7UUFDaEosQ0FBQztRQUVELE9BQU8sYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsOEJBQThCLENBQUMsRUFBQyxTQUFTLEVBQUUsZ0JBQWdCLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ25JLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsOEJBQThCLENBQUMsRUFBQyxTQUFTLEVBQUUsZ0JBQWdCLEVBQUUsYUFBYSxFQUFDO1FBQ3pFLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFaEgsTUFBTSxZQUFZLEdBQUcsVUFBVSxDQUFDLHFCQUFxQixDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDdkUsTUFBTSxnQkFBZ0IsR0FBRyxZQUFZLENBQUMsT0FBTyxFQUFFLENBQUE7UUFFL0MsSUFBSSxnQkFBZ0IsS0FBSyxXQUFXLElBQUksZ0JBQWdCLEtBQUssUUFBUSxJQUFJLGdCQUFnQixLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3hHLE1BQU0sSUFBSSxLQUFLLENBQUMsVUFBVSxTQUFTLG1CQUFtQixnQkFBZ0IsMkJBQTJCLGdCQUFnQixHQUFHLENBQUMsQ0FBQTtRQUN2SCxDQUFDO1FBRUQsSUFBSSxlQUFlLENBQUE7UUFFbkIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxnQkFBZ0IsR0FBRyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtZQUUzRCxlQUFlLEdBQUcsZ0JBQWdCLEVBQUUsWUFBWSxFQUFFLENBQUE7UUFDcEQsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLHVGQUF1RjtRQUN6RixDQUFDO1FBRUQsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3JCLGVBQWUsR0FBRyxZQUFZLENBQUMsU0FBUyxDQUFBO1lBRXhDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztnQkFDckIsTUFBTSxJQUFJLEtBQUssQ0FBQyxVQUFVLFNBQVMsbUJBQW1CLGdCQUFnQiw2QkFBNkIsQ0FBQyxDQUFBO1lBQ3RHLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTztZQUNMLFFBQVEsRUFBRSxZQUFZLENBQUMsV0FBVyxFQUFFO1lBQ3BDLGdCQUFnQjtZQUNoQixlQUFlO1lBQ2YsY0FBYyxFQUFFLFVBQVUsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUM1RSxJQUFJLEVBQUUsZ0JBQWdCO1NBQ3ZCLENBQUE7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgZ2VuZXJhdGVkRmlsZUJhbm5lciBmcm9tIFwiLi9nZW5lcmF0ZWQtZmlsZS1iYW5uZXIuanNcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlSXNCdWlsdEluLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9mcm9udGVuZC1tb2RlbHMvYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9ufSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vZnJvbnRlbmQtbW9kZWxzL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiXG5cbi8qKlxuICogQXR0cmlidXRlIG1ldGFkYXRhIHVzZWQgZm9yIGdlbmVyYXRlZCBmcm9udGVuZC1tb2RlbCBKU0RvYy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kQXR0cmlidXRlQ29uZmlnXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3R5cGVdIC0gQ29sdW1uIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbHVtblR5cGVdIC0gQ29sdW1uIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3NxbFR5cGVdIC0gU1FMIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RhdGFUeXBlXSAtIERhdGEgdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbanNEb2NUeXBlXSAtIEV4YWN0IEpTRG9jIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gQXR0cmlidXRlIG5hbWUgd2hlbiBjb25maWd1cmVkIGFzIGFuIGFycmF5IGVudHJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbbnVsbF0gLSBXaGV0aGVyIG51bGwgaXMgYWxsb3dlZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NlbGVjdGVkQnlEZWZhdWx0XSAtIFdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBpcyBzZWxlY3RlZCBieSBkZWZhdWx0LlxuICogQHByb3BlcnR5IHsoKSA9PiBzdHJpbmd9IFtnZXRUeXBlXSAtIFJldHVybnMgY29sdW1uIHR5cGUuXG4gKiBAcHJvcGVydHkgeygpID0+IGJvb2xlYW59IFtnZXROdWxsXSAtIFJldHVybnMgd2hldGhlciBudWxsIGlzIGFsbG93ZWQuXG4gKi9cbi8qKlxuICogUGVybWl0IHNwZWMgcmV0dXJuZWQgYnkgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzIGR1cmluZyBnZW5lcmF0aW9uLlxuICogQHR5cGVkZWYge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxHZW5lcmF0b3JQZXJtaXRTcGVjPj59IEZyb250ZW5kTW9kZWxHZW5lcmF0b3JQZXJtaXRTcGVjXG4gKi9cbi8qKlxuICogSlNEb2MgaW1wb3J0IGFsaWFzIGV4dHJhY3RlZCBmcm9tIGEgYmFja2VuZCByZXNvdXJjZSBzb3VyY2UgZmlsZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJlc291cmNlSnNEb2NJbXBvcnRBbGlhc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGltcG9ydGVkTmFtZSAtIEV4cG9ydGVkIHR5cGUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzcGVjaWZpZXIgLSBJbXBvcnQgc3BlY2lmaWVyIGZyb20gdGhlIHNvdXJjZSBmaWxlLlxuICovXG4vKipcbiAqIEpTRG9jIHJldHVybiB0eXBlIGV4dHJhY3RlZCBmcm9tIGEgYmFja2VuZCByZXNvdXJjZSBtZXRob2QuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZXNvdXJjZU1ldGhvZFJldHVyblR5cGVcbiAqIEBwcm9wZXJ0eSB7TWFwPHN0cmluZywgUmVzb3VyY2VKc0RvY0ltcG9ydEFsaWFzPn0gaW1wb3J0QWxpYXNlcyAtIEltcG9ydCBhbGlhc2VzIHZpc2libGUgaW4gdGhlIHNvdXJjZSBmaWxlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBzb3VyY2VGaWxlIC0gU291cmNlIGZpbGUgdGhhdCBkZWNsYXJlZCB0aGUgbWV0aG9kLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHR5cGUgLSBKU0RvYyByZXR1cm4gdHlwZS5cbiAqL1xuLyoqXG4gKiBKU0RvYyBwYXJhbWV0ZXIgdHlwZSBleHRyYWN0ZWQgZnJvbSBhIGJhY2tlbmQgcmVzb3VyY2UgbWV0aG9kLlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlXG4gKiBAcHJvcGVydHkge01hcDxzdHJpbmcsIFJlc291cmNlSnNEb2NJbXBvcnRBbGlhcz59IGltcG9ydEFsaWFzZXMgLSBJbXBvcnQgYWxpYXNlcyB2aXNpYmxlIGluIHRoZSBzb3VyY2UgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gbmFtZSAtIFBhcmFtZXRlciBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBzb3VyY2VGaWxlIC0gU291cmNlIGZpbGUgdGhhdCBkZWNsYXJlZCB0aGUgbWV0aG9kLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHR5cGUgLSBKU0RvYyBwYXJhbWV0ZXIgdHlwZS5cbiAqL1xuY29uc3QgRlJPTlRFTkRfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORCA9IFwidmVsb2Npb3VzIGdlbmVyYXRlOmZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKiBOb2RlIENMSSBjb21tYW5kIHRoYXQgZ2VuZXJhdGVzIGZyb250ZW5kIG1vZGVsIGNsYXNzZXMgZnJvbSBiYWNrZW5kIHByb2plY3QgcmVzb3VyY2UgY29uZmlnLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJHZW5lcmF0ZUZyb250ZW5kTW9kZWxzIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZT4gfCBudWxsfSAqL1xuICBfcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcyA9IG51bGxcblxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZVtdPiB8IG51bGx9ICovXG4gIF9yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzID0gbnVsbFxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZmlsZXMgYXJlIGdlbmVyYXRlZC5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuXG4gICAgYXdhaXQgY29uZmlndXJhdGlvbi5pbml0aWFsaXplTW9kZWxzKClcblxuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmICh0eXBlb2YgZW52aXJvbm1lbnRIYW5kbGVyLmF1dG9EaXNjb3ZlclJlc291cmNlcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuYXV0b0Rpc2NvdmVyUmVzb3VyY2VzKGNvbmZpZ3VyYXRpb24pXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGJhY2tlbmRQcm9qZWN0cykgfHwgYmFja2VuZFByb2plY3RzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gYmFja2VuZCBwcm9qZWN0cyBjb25maWd1cmVkLiBDb25maWd1cmUgJ2JhY2tlbmRQcm9qZWN0cycgaW4geW91ciBjb25maWd1cmF0aW9uIGZpcnN0XCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRW5zdXJlZCBkaXJlY3Rvcmllcy5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgZW5zdXJlZERpcmVjdG9yaWVzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVkIG1vZGVsIG5hbWVzIGJ5IGRpcmVjdG9yeS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgU2V0PHN0cmluZz4+fSAqL1xuICAgIGNvbnN0IGdlbmVyYXRlZE1vZGVsTmFtZXNCeURpcmVjdG9yeSA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlZCBmaWxlcyBieSBkaXJlY3RvcnkuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIEFycmF5PHtjbGFzc05hbWU6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZ30+Pn0gKi9cbiAgICBjb25zdCBnZW5lcmF0ZWRGaWxlc0J5RGlyZWN0b3J5ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgICAgLy8gQ2Fub25pY2FsaXplIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHNvIGVxdWl2YWxlbnQgc3BlbGxpbmdzIChhIHRyYWlsaW5nXG4gICAgICAvLyBzbGFzaCwgYC5gL2AuLmAgc2VnbWVudHMsIGR1cGxpY2F0ZSBzZXBhcmF0b3JzLCByZWxhdGl2ZSB2cyBhYnNvbHV0ZSlcbiAgICAgIC8vIHJlc29sdmUgdG8gYSBzaW5nbGUga2V5LiBPdGhlcndpc2UgdGhlIHBlci1kaXJlY3RvcnkgbWFwcyBiZWxvdyB0cmVhdFxuICAgICAgLy8gdGhlbSBhcyBkaWZmZXJlbnQgZGlyZWN0b3JpZXMsIGR1cGxpY2F0ZSBjbGFzcyBuYW1lcyBzbGlwIHBhc3QgZGV0ZWN0aW9uLFxuICAgICAgLy8gYW5kIHRoZSBzcGxpdCBidWNrZXRzIHdyaXRlIGluY29tcGxldGUgaW5kZXguanMvc2V0dXAuanMgZm9yIGZpbGVzIHRoYXRcbiAgICAgIC8vIGFjdHVhbGx5IGxhbmQgaW4gdGhlIHNhbWUgZGlyZWN0b3J5IG9uIGRpc2suXG4gICAgICBjb25zdCBmcm9udGVuZE1vZGVsc0RpciA9IHBhdGgucmVzb2x2ZSh0aGlzLmZyb250ZW5kTW9kZWxzRGlyZWN0b3J5Rm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpKVxuICAgICAgY29uc3QgaW1wb3J0UGF0aCA9IHRoaXMuaW1wb3J0UGF0aEZvckZyb250ZW5kTW9kZWxzRGlyZWN0b3J5KGZyb250ZW5kTW9kZWxzRGlyKVxuXG4gICAgICBpZiAoIWVuc3VyZWREaXJlY3Rvcmllcy5oYXMoZnJvbnRlbmRNb2RlbHNEaXIpKSB7XG4gICAgICAgIGF3YWl0IGZzLm1rZGlyKGZyb250ZW5kTW9kZWxzRGlyLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgICAgICAgZW5zdXJlZERpcmVjdG9yaWVzLmFkZChmcm9udGVuZE1vZGVsc0RpcilcbiAgICAgIH1cblxuICAgICAgaWYgKCFnZW5lcmF0ZWRGaWxlc0J5RGlyZWN0b3J5Lmhhcyhmcm9udGVuZE1vZGVsc0RpcikpIHtcbiAgICAgICAgZ2VuZXJhdGVkRmlsZXNCeURpcmVjdG9yeS5zZXQoZnJvbnRlbmRNb2RlbHNEaXIsIFtdKVxuICAgICAgfVxuXG4gICAgICBpZiAoIWdlbmVyYXRlZE1vZGVsTmFtZXNCeURpcmVjdG9yeS5oYXMoZnJvbnRlbmRNb2RlbHNEaXIpKSB7XG4gICAgICAgIGdlbmVyYXRlZE1vZGVsTmFtZXNCeURpcmVjdG9yeS5zZXQoZnJvbnRlbmRNb2RlbHNEaXIsIG5ldyBTZXQoKSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgZ2VuZXJhdGVkRmlsZXMgPSBnZW5lcmF0ZWRGaWxlc0J5RGlyZWN0b3J5LmdldChmcm9udGVuZE1vZGVsc0RpcilcbiAgICAgIGNvbnN0IGdlbmVyYXRlZE1vZGVsTmFtZXMgPSBnZW5lcmF0ZWRNb2RlbE5hbWVzQnlEaXJlY3RvcnkuZ2V0KGZyb250ZW5kTW9kZWxzRGlyKVxuXG4gICAgICBpZiAoIWdlbmVyYXRlZEZpbGVzKSB0aHJvdyBuZXcgRXJyb3IoYEdlbmVyYXRlZCBmaWxlcyBsaXN0IG1pc3NpbmcgZm9yICR7ZnJvbnRlbmRNb2RlbHNEaXJ9YClcbiAgICAgIGlmICghZ2VuZXJhdGVkTW9kZWxOYW1lcykgdGhyb3cgbmV3IEVycm9yKGBHZW5lcmF0ZWQgbW9kZWwgbmFtZXMgc2V0IG1pc3NpbmcgZm9yICR7ZnJvbnRlbmRNb2RlbHNEaXJ9YClcbiAgICAgIGNvbnN0IHJlc291cmNlcyA9IHRoaXMucmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gICAgICBjb25zdCBhdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcyA9IHRoaXMuYXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMocmVzb3VyY2VzKVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3NOYW1lIGluIHJlc291cmNlcykge1xuICAgICAgICBjb25zdCBtb2RlbENvbmZpZyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZXNbbW9kZWxDbGFzc05hbWVdKVxuICAgICAgICBjb25zdCBjbGFzc05hbWUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKG1vZGVsQ2xhc3NOYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcbiAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBgJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoY2xhc3NOYW1lKSl9LmpzYFxuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGAke2Zyb250ZW5kTW9kZWxzRGlyfS8ke2ZpbGVOYW1lfWBcblxuICAgICAgICBpZiAoIW1vZGVsQ29uZmlnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGRlZmluaXRpb24gZm9yICcke2NsYXNzTmFtZX0nYClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc29sdmVkUmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VzW21vZGVsQ2xhc3NOYW1lXSlcbiAgICAgICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgY2FuJ3QgYmFjayBhIGdlbmVyYXRlZFxuICAgICAgICAvLyBmcm9udGVuZCBtb2RlbC4gVHJlYXQgaXQgYXMgcmVzb3VyY2UtbGVzcyBzbyB0aGUgZ2VuZXJhdG9yIGZhbGxzIGJhY2tcbiAgICAgICAgLy8gdG8gYnktbmFtZSBtb2RlbCBsb29rdXAgKyBlbXB0eSB3cml0ZSBwYXJhbXMgaW5zdGVhZCBvZiB0aHJvd2luZyB3aGVuXG4gICAgICAgIC8vIGl0IGVhZ2VybHkgY2FsbHMgYG1vZGVsQ2xhc3MoKWAgLyBgcGVybWl0dGVkUGFyYW1zKClgIG9uIGl0LlxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gcmVzb2x2ZWRSZXNvdXJjZUNsYXNzICYmIHJlc29sdmVkUmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzID8gcmVzb2x2ZWRSZXNvdXJjZUNsYXNzIDogbnVsbFxuXG4gICAgICAgIHRoaXMudmFsaWRhdGVNb2RlbENvbmZpZyh7YXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMsIGNsYXNzTmFtZSwgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KVxuXG4gICAgICAgIGlmIChnZW5lcmF0ZWRNb2RlbE5hbWVzLmhhcyhjbGFzc05hbWUpKSB7XG4gICAgICAgICAgaWYgKGZyb250ZW5kTW9kZWxSZXNvdXJjZUlzQnVpbHRJbih7bW9kZWxOYW1lOiBtb2RlbENsYXNzTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uOiByZXNvdXJjZXNbbW9kZWxDbGFzc05hbWVdfSkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBEdXBsaWNhdGUgZnJvbnRlbmQgbW9kZWwgZGVmaW5pdGlvbiBmb3IgJyR7Y2xhc3NOYW1lfSdgKVxuICAgICAgICB9XG5cbiAgICAgICAgZ2VuZXJhdGVkTW9kZWxOYW1lcy5hZGQoY2xhc3NOYW1lKVxuXG4gICAgICAgIGNvbnN0IGZpbGVDb250ZW50ID0gYXdhaXQgdGhpcy5idWlsZE1vZGVsRmlsZUNvbnRlbnQoe1xuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBmcm9udGVuZE1vZGVsRmlsZVBhdGg6IGZpbGVQYXRoLFxuICAgICAgICAgIGltcG9ydFBhdGgsXG4gICAgICAgICAgbW9kZWxDbGFzczogcmVzb3VyY2VDbGFzcyA/IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpIDogY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVtjbGFzc05hbWVdLFxuICAgICAgICAgIG1vZGVsQ29uZmlnLFxuICAgICAgICAgIHJlc291cmNlQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIGZpbGVDb250ZW50KVxuICAgICAgICBnZW5lcmF0ZWRGaWxlcy5wdXNoKHtjbGFzc05hbWUsIGZpbGVOYW1lfSlcblxuICAgICAgICBjb25zb2xlLmxvZyhgY3JlYXRlIHNyYy9mcm9udGVuZC1tb2RlbHMvJHtmaWxlTmFtZX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2Zyb250ZW5kTW9kZWxzRGlyLCBnZW5lcmF0ZWRGaWxlc10gb2YgZ2VuZXJhdGVkRmlsZXNCeURpcmVjdG9yeSkge1xuICAgICAgLy8gVGhlIGluZGV4LmpzIGJhcnJlbCBpcyBubyBsb25nZXIgZ2VuZXJhdGVkIOKAlCBub3RoaW5nIGltcG9ydHMgaXQgKG1vZGVscyBhcmVcbiAgICAgIC8vIGltcG9ydGVkIGJ5IGZpbGUgcGF0aCwgYW5kIHNldHVwLmpzIHBlcmZvcm1zIHRoZSByZWdpc3RyYXRpb24gc2lkZS1lZmZlY3RzKS5cbiAgICAgIC8vIFJlbW92ZSBhbnkgc3RhbGUgb25lIGxlZnQgZnJvbSBhbiBvbGRlciBnZW5lcmF0b3IuXG4gICAgICBhd2FpdCBmcy5ybShgJHtmcm9udGVuZE1vZGVsc0Rpcn0vaW5kZXguanNgLCB7Zm9yY2U6IHRydWV9KVxuXG4gICAgICBjb25zdCBzZXR1cENvbnRlbnQgPSB0aGlzLmJ1aWxkU2V0dXBGaWxlQ29udGVudChnZW5lcmF0ZWRGaWxlcylcblxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGAke2Zyb250ZW5kTW9kZWxzRGlyfS9zZXR1cC5qc2AsIHNldHVwQ29udGVudClcblxuICAgICAgY29uc29sZS5sb2coXCJjcmVhdGUgc3JjL2Zyb250ZW5kLW1vZGVscy9zZXR1cC5qc1wiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHZhbGlkYXRlIG1vZGVsIGNvbmZpZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IGFyZ3MuYXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMgLSBBdmFpbGFibGUgZnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZXMgaW4gYmFja2VuZCBwcm9qZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MubW9kZWxDb25maWcgLSBNb2RlbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gW2FyZ3MucmVzb3VyY2VDbGFzc10gLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdmFsaWRhdGVNb2RlbENvbmZpZyh7YXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMsIGNsYXNzTmFtZSwgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gbW9kZWxDb25maWcuYWJpbGl0aWVzXG5cbiAgICBpZiAoIWFiaWxpdGllcyB8fCB0eXBlb2YgYWJpbGl0aWVzICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICcke2NsYXNzTmFtZX0nIGlzIG1pc3NpbmcgcmVxdWlyZWQgJ2FiaWxpdGllcycgY29uZmlnYClcbiAgICB9XG5cbiAgICBjb25zdCByZWFkQWN0aW9ucyA9IFtcbiAgICAgIHthY3Rpb246IFwiaW5kZXhcIiwgYWJpbGl0eUFjdGlvbjogYWJpbGl0aWVzLmluZGV4fSxcbiAgICAgIHthY3Rpb246IFwiZmluZFwiLCBhYmlsaXR5QWN0aW9uOiBhYmlsaXRpZXMuZmluZH1cbiAgICBdXG5cbiAgICBmb3IgKGNvbnN0IHthY3Rpb24sIGFiaWxpdHlBY3Rpb259IG9mIHJlYWRBY3Rpb25zKSB7XG4gICAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eUFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJyR7Y2xhc3NOYW1lfScgaXMgbWlzc2luZyByZXF1aXJlZCBhYmlsaXRpZXMuJHthY3Rpb259IGNvbmZpZ2ApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IG1vZGVsQ29uZmlnLnJlbGF0aW9uc2hpcHNcblxuICAgIGlmIChyZWxhdGlvbnNoaXBzID09PSB1bmRlZmluZWQpIHJldHVyblxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFJlbGF0aW9uc2hpcHMgPSB0aGlzLnJlbGF0aW9uc2hpcHNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiBub3JtYWxpemVkUmVsYXRpb25zaGlwcykge1xuICAgICAgaWYgKCFhdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcy5oYXMocmVsYXRpb25zaGlwLnRhcmdldENsYXNzTmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAnJHtjbGFzc05hbWV9JyByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9JyByZWZlcmVuY2VzICcke3JlbGF0aW9uc2hpcC50YXJnZXRDbGFzc05hbWV9JywgYnV0IG5vIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGV4aXN0cyBmb3IgdGhhdCB0YXJnZXQgaW4gdGhpcyBiYWNrZW5kIHByb2plY3RgKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlcyBmb3IgYmFja2VuZCBwcm9qZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBiYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBjb25maWcuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb24+fSAtIFJlc291cmNlIGRlZmluaXRpb25zIGtleWVkIGJ5IG1vZGVsIGNsYXNzIG5hbWUuXG4gICAqL1xuICByZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdCkge1xuICAgIHJldHVybiBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdmFpbGFibGUgZnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uPn0gcmVzb3VyY2VzIC0gUmVzb3VyY2UgY29uZmlndXJhdGlvbiBrZXllZCBieSBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gQXZhaWxhYmxlIGZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWVzLlxuICAgKi9cbiAgYXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMocmVzb3VyY2VzKSB7XG4gICAgLyoqXG4gICAgICogQ2xhc3MgbmFtZXMuXG4gICAgICogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGNsYXNzTmFtZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgcmVzb3VyY2VNb2RlbE5hbWUgaW4gcmVzb3VyY2VzKSB7XG4gICAgICBjbGFzc05hbWVzLmFkZChpbmZsZWN0aW9uLmNhbWVsaXplKHJlc291cmNlTW9kZWxOYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNsYXNzTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVscyBkaXJlY3RvcnkgZm9yIGJhY2tlbmQgcHJvamVjdC5cbiAgICogQHBhcmFtIHt7ZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoPzogc3RyaW5nfX0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFic29sdXRlIGZyb250ZW5kIG1vZGVscyBvdXRwdXQgZGlyZWN0b3J5LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbHNEaXJlY3RvcnlGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdCkge1xuICAgIGNvbnN0IG91dHB1dFBhdGggPSBiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVsc091dHB1dFBhdGggfHwgdGhpcy5kaXJlY3RvcnkoKVxuXG4gICAgcmV0dXJuIGAke291dHB1dFBhdGh9L3NyYy9mcm9udGVuZC1tb2RlbHNgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgcGF0aCBmb3IgZnJvbnRlbmQgbW9kZWxzIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZyb250ZW5kTW9kZWxzRGlyIC0gRnJvbnRlbmQgbW9kZWxzIG91dHB1dCBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQmFzZSBjbGFzcyBpbXBvcnQgcGF0aC5cbiAgICovXG4gIGltcG9ydFBhdGhGb3JGcm9udGVuZE1vZGVsc0RpcmVjdG9yeShmcm9udGVuZE1vZGVsc0Rpcikge1xuICAgIGNvbnN0IGRldk1vZGUgPSBmcm9udGVuZE1vZGVsc0Rpci5pbmNsdWRlcyhcIi9zcGVjL2R1bW15L3NyYy9mcm9udGVuZC1tb2RlbHNcIilcblxuICAgIGlmIChkZXZNb2RlKSB7XG4gICAgICByZXR1cm4gXCIuLi8uLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIlxuICAgIH1cblxuICAgIHJldHVybiBcInZlbG9jaW91cy9idWlsZC9zcmMvZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgbW9kZWwgZmlsZSBjb250ZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1ldGhvZCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mcm9udGVuZE1vZGVsRmlsZVBhdGggLSBHZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbXBvcnRQYXRoIC0gQmFzZSBjbGFzcyBpbXBvcnQgcGF0aC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5tb2RlbENvbmZpZyAtIE1vZGVsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSBbYXJncy5yZXNvdXJjZUNsYXNzXSAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEdlbmVyYXRlZCBmaWxlIGNvbnRlbnQuXG4gICAqL1xuICBhc3luYyBidWlsZE1vZGVsRmlsZUNvbnRlbnQoe2NsYXNzTmFtZSwgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLCBpbXBvcnRQYXRoLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5hdHRyaWJ1dGVEZWZpbml0aW9uc0Zvck1vZGVsKHtjbGFzc05hbWUsIG1vZGVsQ2xhc3MsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gdGhpcy5yZWxhdGlvbnNoaXBzRm9yTW9kZWwoe2NsYXNzTmFtZSwgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gbW9kZWxDb25maWcuYXR0YWNobWVudHMgJiYgdHlwZW9mIG1vZGVsQ29uZmlnLmF0dGFjaG1lbnRzID09PSBcIm9iamVjdFwiXG4gICAgICA/IG1vZGVsQ29uZmlnLmF0dGFjaG1lbnRzXG4gICAgICA6IHt9XG4gICAgY29uc3QgYXR0cmlidXRlc1R5cGVOYW1lID0gYCR7Y2xhc3NOYW1lfUF0dHJpYnV0ZXNgXG4gICAgY29uc3QgY3JlYXRlQXR0cmlidXRlc1R5cGVOYW1lID0gYCR7Y2xhc3NOYW1lfUNyZWF0ZUF0dHJpYnV0ZXNgXG4gICAgY29uc3QgdXBkYXRlQXR0cmlidXRlc1R5cGVOYW1lID0gYCR7Y2xhc3NOYW1lfVVwZGF0ZUF0dHJpYnV0ZXNgXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBhdHRyaWJ1dGVzLm1hcCgoYXR0cmlidXRlKSA9PiBhdHRyaWJ1dGUubmFtZSlcbiAgICBjb25zdCBwZXJtaXR0ZWRDcmVhdGVQYXJhbXMgPSB0aGlzLnBlcm1pdHRlZFBhcmFtc0ZvckdlbmVyYXRvcihyZXNvdXJjZUNsYXNzIHx8IG51bGwsIFwiY3JlYXRlXCIpXG4gICAgY29uc3QgcGVybWl0dGVkVXBkYXRlUGFyYW1zID0gdGhpcy5wZXJtaXR0ZWRQYXJhbXNGb3JHZW5lcmF0b3IocmVzb3VyY2VDbGFzcyB8fCBudWxsLCBcInVwZGF0ZVwiKVxuICAgIGNvbnN0IG5lc3RlZFdyaXRlVHlwZXMgPSB0aGlzLm5lc3RlZFdyaXRlVHlwZXNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBwZXJtaXR0ZWRQYXJhbXM6IHBlcm1pdHRlZENyZWF0ZVBhcmFtcy5jb25jYXQocGVybWl0dGVkVXBkYXRlUGFyYW1zKSwgcmVsYXRpb25zaGlwc30pXG4gICAgY29uc3QgdXNlc1RyYW5zcG9ydFZhbHVlID0gYXR0cmlidXRlcy5zb21lKChhdHRyaWJ1dGUpID0+IGF0dHJpYnV0ZS5qc0RvY1R5cGUuaW5jbHVkZXMoXCJGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcIikpXG4gICAgICB8fCBuZXN0ZWRXcml0ZVR5cGVzLnNvbWUoKG5lc3RlZFdyaXRlVHlwZSkgPT4gbmVzdGVkV3JpdGVUeXBlLmF0dHJpYnV0ZXMuc29tZSgoYXR0cmlidXRlKSA9PiBhdHRyaWJ1dGUudHlwZS5pbmNsdWRlcyhcIkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVwiKSkpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHtcbiAgICAgIGNyZWF0ZTogbW9kZWxDb25maWcuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5jcmVhdGUgfHwgXCJjcmVhdGVcIixcbiAgICAgIGluZGV4OiBtb2RlbENvbmZpZy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmluZGV4IHx8IFwiaW5kZXhcIlxuICAgIH1cbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSB7XG4gICAgICBhdHRhY2g6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy5hdHRhY2ggfHwgXCJhdHRhY2hcIixcbiAgICAgIGRlc3Ryb3k6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy5kZXN0cm95IHx8IFwiZGVzdHJveVwiLFxuICAgICAgZG93bmxvYWQ6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy5kb3dubG9hZCB8fCBcImRvd25sb2FkXCIsXG4gICAgICBmaW5kOiBtb2RlbENvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMuZmluZCB8fCBcImZpbmRcIixcbiAgICAgIHVwZGF0ZTogbW9kZWxDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzLnVwZGF0ZSB8fCBcInVwZGF0ZVwiLFxuICAgICAgdXJsOiBtb2RlbENvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMudXJsIHx8IFwidXJsXCJcbiAgICB9XG4gICAgY29uc3QgY29sbGVjdGlvbkNvbW1hbmRzID0gbW9kZWxDb25maWcuY29sbGVjdGlvbkNvbW1hbmRzXG4gICAgY29uc3QgbWVtYmVyQ29tbWFuZHMgPSBtb2RlbENvbmZpZy5tZW1iZXJDb21tYW5kc1xuXG4gICAgaWYgKE9iamVjdC5oYXNPd24oY29sbGVjdGlvbkNvbW1hbmRzLCBcIm9uRGVzdHJveVwiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCBjb2xsZWN0aW9uIGNvbW1hbmQgJyR7Y2xhc3NOYW1lfS5vbkRlc3Ryb3knIGNvbGxpZGVzIHdpdGggdGhlIGdlbmVyYXRlZCBsaWZlY3ljbGUgaG9va2ApXG4gICAgfVxuXG4gICAgY29uc3QgZGVjbGFyZWRDb21tYW5kTWV0YWRhdGEgPSBtb2RlbENvbmZpZy5jb21tYW5kTWV0YWRhdGEgfHwge31cbiAgICBjb25zdCBjb21tYW5kTWV0YWRhdGEgPSBhd2FpdCB0aGlzLmNvbW1hbmRNZXRhZGF0YVdpdGhSZXNvdXJjZUpzRG9jKHtcbiAgICAgIGNvbW1hbmRNZXRhZGF0YTogZGVjbGFyZWRDb21tYW5kTWV0YWRhdGEsXG4gICAgICBjb21tYW5kTmFtZXM6IFsuLi5PYmplY3Qua2V5cyhjb2xsZWN0aW9uQ29tbWFuZHMpLCAuLi5PYmplY3Qua2V5cyhtZW1iZXJDb21tYW5kcyldLFxuICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgcmVzb3VyY2VDbGFzc1xuICAgIH0pXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc0FyZURlZmF1bHQgPSBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmNyZWF0ZSA9PT0gXCJjcmVhdGVcIiAmJiBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmluZGV4ID09PSBcImluZGV4XCJcbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHNBcmVEZWZhdWx0ID0gYnVpbHRJbk1lbWJlckNvbW1hbmRzLmF0dGFjaCA9PT0gXCJhdHRhY2hcIlxuICAgICAgJiYgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmRlc3Ryb3kgPT09IFwiZGVzdHJveVwiXG4gICAgICAmJiBidWlsdEluTWVtYmVyQ29tbWFuZHMuZG93bmxvYWQgPT09IFwiZG93bmxvYWRcIlxuICAgICAgJiYgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmZpbmQgPT09IFwiZmluZFwiXG4gICAgICAmJiBidWlsdEluTWVtYmVyQ29tbWFuZHMudXBkYXRlID09PSBcInVwZGF0ZVwiXG4gICAgICAmJiBidWlsdEluTWVtYmVyQ29tbWFuZHMudXJsID09PSBcInVybFwiXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlGb3JSZXNvdXJjZSh7YXR0cmlidXRlTmFtZXMsIG1vZGVsQ2xhc3MsIG1vZGVsQ29uZmlnfSlcbiAgICBjb25zdCBwcmltYXJ5S2V5VmFsdWVUeXBlID0gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleVZhbHVlVHlwZSh7YXR0cmlidXRlc1R5cGVOYW1lLCBwcmltYXJ5S2V5fSlcbiAgICBjb25zdCBldmVudFByaW1hcnlLZXlWYWx1ZVR5cGUgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleVZhbHVlVHlwZSA6IFwic3RyaW5nXCJcblxuICAgIGxldCBmaWxlQ29udGVudCA9IGdlbmVyYXRlZEZpbGVCYW5uZXIoRlJPTlRFTkRfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORClcblxuICAgIGZpbGVDb250ZW50ICs9IGBpbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2UgZnJvbSBcIiR7aW1wb3J0UGF0aH1cIlxcbmBcblxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZy5cXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEB0eXBlZGVmIHtpbXBvcnQoXCIke2ltcG9ydFBhdGh9XCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgKiBGYWxsYmFjayBhdHRyaWJ1dGUgdmFsdWUgdHlwZSBmb3IgZ2VuZXJhdGVkIGZpZWxkcyB3aXRob3V0IG5hcnJvd2VyIG1ldGFkYXRhLlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEB0eXBlZGVmIHtpbXBvcnQoXCIke2ltcG9ydFBhdGh9XCIpLkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZX0gRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBpZiAodXNlc1RyYW5zcG9ydFZhbHVlKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqIFZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBhbmQgZGVzZXJpYWxpemF0aW9uLlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge2ltcG9ydChcIiR7aW1wb3J0UGF0aH1cIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblwiXG4gICAgfVxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqICR7YXR0cmlidXRlc1R5cGVOYW1lfSB0eXBlLlxcbmBcbiAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge29iamVjdH0gJHthdHRyaWJ1dGVzVHlwZU5hbWV9XFxuYFxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAcHJvcGVydHkgeyR7YXR0cmlidXRlLmpzRG9jVHlwZX19ICR7YXR0cmlidXRlLm5hbWV9IC0gQXR0cmlidXRlIHZhbHVlLlxcbmBcbiAgICB9XG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgKi9cXG5cIlxuICAgIGZvciAoY29uc3QgbmVzdGVkV3JpdGVUeXBlIG9mIG5lc3RlZFdyaXRlVHlwZXMpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiLyoqXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBBdHRyaWJ1dGVzIGFjY2VwdGVkIGZvciBuZXN0ZWQgJHtuZXN0ZWRXcml0ZVR5cGUucmVsYXRpb25zaGlwTmFtZX0gd3JpdGVzLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAdHlwZWRlZiB7b2JqZWN0fSAke25lc3RlZFdyaXRlVHlwZS50eXBlTmFtZX1cXG5gXG4gICAgICBmb3IgKGNvbnN0IG5lc3RlZEF0dHJpYnV0ZSBvZiBuZXN0ZWRXcml0ZVR5cGUuYXR0cmlidXRlcykge1xuICAgICAgICBmaWxlQ29udGVudCArPSBgICogQHByb3BlcnR5IHske25lc3RlZEF0dHJpYnV0ZS50eXBlfX0gWyR7bmVzdGVkQXR0cmlidXRlLm5hbWV9XSAtIE5lc3RlZCAke25lc3RlZEF0dHJpYnV0ZS5uYW1lfSB2YWx1ZS5cXG5gXG4gICAgICB9XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblwiXG4gICAgfVxuICAgIGZpbGVDb250ZW50ICs9IGF3YWl0IHRoaXMud3JpdGVBdHRyaWJ1dGVzVHlwZWRlZih7YXR0cmlidXRlcywgYXR0cmlidXRlc1R5cGVOYW1lLCBtb2RlbENsYXNzLCBuZXN0ZWRXcml0ZVR5cGVzLCBwZXJtaXR0ZWRQYXJhbXM6IHBlcm1pdHRlZENyZWF0ZVBhcmFtcywgcmVzb3VyY2VDbGFzcywgdHlwZU5hbWU6IGNyZWF0ZUF0dHJpYnV0ZXNUeXBlTmFtZX0pXG4gICAgZmlsZUNvbnRlbnQgKz0gYXdhaXQgdGhpcy53cml0ZUF0dHJpYnV0ZXNUeXBlZGVmKHthdHRyaWJ1dGVzLCBhdHRyaWJ1dGVzVHlwZU5hbWUsIG1vZGVsQ2xhc3MsIG5lc3RlZFdyaXRlVHlwZXMsIHBlcm1pdHRlZFBhcmFtczogcGVybWl0dGVkVXBkYXRlUGFyYW1zLCByZXNvdXJjZUNsYXNzLCB0eXBlTmFtZTogdXBkYXRlQXR0cmlidXRlc1R5cGVOYW1lfSlcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEZyb250ZW5kIG1vZGVsIGZvciAke2NsYXNzTmFtZX0uXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IGAgKiBAYXVnbWVudHMge0Zyb250ZW5kTW9kZWxCYXNlPCR7YXR0cmlidXRlc1R5cGVOYW1lfSwgJHtjcmVhdGVBdHRyaWJ1dGVzVHlwZU5hbWV9LCAke3VwZGF0ZUF0dHJpYnV0ZXNUeXBlTmFtZX0sICR7cHJpbWFyeUtleVZhbHVlVHlwZX0sICR7ZXZlbnRQcmltYXJ5S2V5VmFsdWVUeXBlfT59XFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgY2xhc3MgJHtjbGFzc05hbWV9IGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2Uge1xcbmBcbiAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlnLiAqL1xcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICAgIHJldHVybiB7XFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICAgICAgbW9kZWxOYW1lOiAke0pTT04uc3RyaW5naWZ5KGNsYXNzTmFtZSl9LFxcbmBcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgYXR0YWNobWVudHM6IHtcXG5cIlxuICAgICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIGF0dGFjaG1lbnRDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgICBjb25zdCBhdHRhY2htZW50VHlwZSA9IGF0dGFjaG1lbnRDb25maWcgJiYgdHlwZW9mIGF0dGFjaG1lbnRDb25maWcgPT09IFwib2JqZWN0XCIgJiYgYXR0YWNobWVudENvbmZpZy50eXBlID09PSBcImhhc01hbnlcIlxuICAgICAgICAgID8gXCJoYXNNYW55XCJcbiAgICAgICAgICA6IFwiaGFzT25lXCJcblxuICAgICAgICBpZiAoYXR0YWNobWVudENvbmZpZy5zeW5jKSB7XG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgJHthdHRhY2htZW50TmFtZX06IHtcXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgICAgICAgc3luYzoge1xcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgICAgIGZldGNoOiAke0pTT04uc3RyaW5naWZ5KGF0dGFjaG1lbnRDb25maWcuc3luYy5mZXRjaCl9LFxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgICAgICAgICAgb2ZmbGluZVJlcXVpcmVtZW50OiAke0pTT04uc3RyaW5naWZ5KGF0dGFjaG1lbnRDb25maWcuc3luYy5vZmZsaW5lUmVxdWlyZW1lbnQpfSxcXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgICAgIHJldGVudGlvbjogJHtKU09OLnN0cmluZ2lmeShhdHRhY2htZW50Q29uZmlnLnN5bmMucmV0ZW50aW9uKX0sXFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgICAgIH0sXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgICAgICAgIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoYXR0YWNobWVudFR5cGUpfVxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICAgICAgfSxcXG5cIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICAgICR7YXR0YWNobWVudE5hbWV9OiB7dHlwZTogJHtKU09OLnN0cmluZ2lmeShhdHRhY2htZW50VHlwZSl9fSxcXG5gXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgfSxcXG5cIlxuICAgIH1cbiAgICBmaWxlQ29udGVudCArPSB0aGlzLmZvcm1hdHRlZEFycmF5UHJvcGVydHkoe1xuICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgcHJvcGVydHlOYW1lOiBcImF0dHJpYnV0ZXNcIixcbiAgICAgIHZhbHVlczogYXR0cmlidXRlTmFtZXNcbiAgICB9KVxuICAgIGlmICghYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc0FyZURlZmF1bHQpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IHRoaXMuZm9ybWF0dGVkT2JqZWN0UHJvcGVydHkoe1xuICAgICAgICBmaWx0ZXJEZWZhdWx0VmFsdWVzOiB7Y3JlYXRlOiBcImNyZWF0ZVwiLCBpbmRleDogXCJpbmRleFwifSxcbiAgICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgICBwcm9wZXJ0eU5hbWU6IFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiLFxuICAgICAgICB2YWx1ZXM6IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmICghYnVpbHRJbk1lbWJlckNvbW1hbmRzQXJlRGVmYXVsdCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRPYmplY3RQcm9wZXJ0eSh7XG4gICAgICAgIGZpbHRlckRlZmF1bHRWYWx1ZXM6IHtcbiAgICAgICAgICBhdHRhY2g6IFwiYXR0YWNoXCIsXG4gICAgICAgICAgZGVzdHJveTogXCJkZXN0cm95XCIsXG4gICAgICAgICAgZG93bmxvYWQ6IFwiZG93bmxvYWRcIixcbiAgICAgICAgICBmaW5kOiBcImZpbmRcIixcbiAgICAgICAgICB1cGRhdGU6IFwidXBkYXRlXCIsXG4gICAgICAgICAgdXJsOiBcInVybFwiXG4gICAgICAgIH0sXG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiLFxuICAgICAgICB2YWx1ZXM6IGJ1aWx0SW5NZW1iZXJDb21tYW5kc1xuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKGNvbGxlY3Rpb25Db21tYW5kcykubGVuZ3RoID4gMCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRDb21tYW5kc1Byb3BlcnR5KHtcbiAgICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgICBwcm9wZXJ0eU5hbWU6IFwiY29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gICAgICAgIHZhbHVlczogY29sbGVjdGlvbkNvbW1hbmRzXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXMobWVtYmVyQ29tbWFuZHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IHRoaXMuZm9ybWF0dGVkQ29tbWFuZHNQcm9wZXJ0eSh7XG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcIm1lbWJlckNvbW1hbmRzXCIsXG4gICAgICAgIHZhbHVlczogbWVtYmVyQ29tbWFuZHNcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmIChwcmltYXJ5S2V5ICE9PSBcImlkXCIpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBwcmltYXJ5S2V5OiAke0pTT04uc3RyaW5naWZ5KHByaW1hcnlLZXkpfSxcXG5gXG4gICAgfVxuICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWVzID0gdGhpcy5uZXN0ZWRSZWxhdGlvbnNoaXBOYW1lc0ZvckdlbmVyYXRvcihyZXNvdXJjZUNsYXNzIHx8IG51bGwpXG4gICAgaWYgKG5lc3RlZFJlbGF0aW9uc2hpcE5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgbmVzdGVkQXR0cmlidXRlczoge1xcblwiXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgbmVzdGVkUmVsYXRpb25zaGlwTmFtZXMpIHtcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgJHtyZWxhdGlvbnNoaXBOYW1lfToge30sXFxuYFxuICAgICAgfVxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgICB9LFxcblwiXG4gICAgfVxuICAgIGlmIChtb2RlbENvbmZpZy5zeW5jPy5lbmFibGVkKSB7XG4gICAgICBmaWxlQ29udGVudCArPSB0aGlzLmZvcm1hdHRlZEpzb25Qcm9wZXJ0eSh7XG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcInN5bmNcIixcbiAgICAgICAgdmFsdWU6IG1vZGVsQ29uZmlnLnN5bmNcbiAgICAgIH0pXG4gICAgfVxuICAgIGZpbGVDb250ZW50ICs9IFwiICAgIH1cXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcblxuICAgIGlmIChyZWxhdGlvbnNoaXBzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKiogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHt0eXBlOiBcXFwiYmVsb25nc1RvXFxcIiB8IFxcXCJoYXNPbmVcXFwiIHwgXFxcImhhc01hbnlcXFwiLCBhdXRvbG9hZD86IGJvb2xlYW59Pn0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMuICovXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKSB7XFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIHJldHVybiB7XFxuXCJcbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgY29uc3QgcGFydHMgPSBbYHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkocmVsYXRpb25zaGlwLnR5cGUpfWBdXG5cbiAgICAgICAgaWYgKHJlbGF0aW9uc2hpcC5hdXRvbG9hZCA9PT0gZmFsc2UpIHBhcnRzLnB1c2goXCJhdXRvbG9hZDogZmFsc2VcIilcblxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgICAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX06IHske3BhcnRzLmpvaW4oXCIsIFwiKX19LFxcbmBcbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIH1cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIH1cXG5cIlxuXG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIFJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcyBuYW1lcy4gKi9cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIHN0YXRpYyByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKSB7XFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIHJldHVybiB7XFxuXCJcbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9OiAke0pTT04uc3RyaW5naWZ5KHJlbGF0aW9uc2hpcC50YXJnZXRDbGFzc05hbWUpfSxcXG5gXG4gICAgICB9XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICB9XFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBhdHRyaWJ1dGVzKSB7XG4gICAgICBjb25zdCBjYW1lbGl6ZWRBdHRyaWJ1dGUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZS5uYW1lLCB0cnVlKVxuICAgICAgY29uc3QgY2FtZWxpemVkQXR0cmlidXRlVXBwZXIgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZS5uYW1lKVxuICAgICAgY29uc3QgYXR0cmlidXRlVHlwZSA9IGAke2F0dHJpYnV0ZXNUeXBlTmFtZX1bJHtKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGUubmFtZSl9XWBcbiAgICAgIGNvbnN0IHNldHRlckF0dHJpYnV0ZVR5cGUgPSBhd2FpdCB0aGlzLmZyb250ZW5kV3JpdGVBdHRyaWJ1dGVUeXBlKHtcbiAgICAgICAgYXR0cmlidXRlLFxuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBhdHRyaWJ1dGUubmFtZSxcbiAgICAgICAgYXR0cmlidXRlc1R5cGVOYW1lLFxuICAgICAgICByZXNvdXJjZUNsYXNzXG4gICAgICB9KVxuXG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICAvKiogQHJldHVybnMgeyR7YXR0cmlidXRlVHlwZX19IC0gQXR0cmlidXRlIHZhbHVlLiAqL1xcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7Y2FtZWxpemVkQXR0cmlidXRlfSgpIHsgcmV0dXJuIC8qKiBAdHlwZSB7JHthdHRyaWJ1dGVUeXBlfX0gKi8gKHRoaXMucmVhZEF0dHJpYnV0ZSgke0pTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZS5uYW1lKX0pKSB9XFxuYFxuXG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEBwYXJhbSB7JHtzZXR0ZXJBdHRyaWJ1dGVUeXBlfX0gbmV3VmFsdWUgLSBOZXcgYXR0cmlidXRlIHZhbHVlLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHske3NldHRlckF0dHJpYnV0ZVR5cGV9fSAtIEFzc2lnbmVkIHZhbHVlLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgc2V0JHtjYW1lbGl6ZWRBdHRyaWJ1dGVVcHBlcn0obmV3VmFsdWUpIHsgcmV0dXJuIC8qKiBAdHlwZSB7JHtzZXR0ZXJBdHRyaWJ1dGVUeXBlfX0gKi8gKHRoaXMuc2V0QXR0cmlidXRlKCR7SlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlLm5hbWUpfSwgbmV3VmFsdWUpKSB9XFxuYFxuICAgIH1cblxuICAgIGZvciAoY29uc3QgbWV0aG9kTmFtZSBvZiBPYmplY3Qua2V5cyhjb2xsZWN0aW9uQ29tbWFuZHMpKSB7XG4gICAgICBjb25zdCBzaWduYXR1cmUgPSB0aGlzLmN1c3RvbUNvbW1hbmRNZXRob2RTaWduYXR1cmUoe2NvbW1hbmRNZXRhZGF0YSwgbWV0aG9kTmFtZX0pXG5cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUnVucyAke21ldGhvZE5hbWV9LlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IHNpZ25hdHVyZS5wYXJhbURvY3NcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtQcm9taXNlPCR7c2lnbmF0dXJlLnJldHVyblR5cGV9Pn0gLSBDb21tYW5kIHJlc3BvbnNlLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgc3RhdGljIGFzeW5jICR7bWV0aG9kTmFtZX0oJHtzaWduYXR1cmUucGFyYW1ldGVyc30pIHtcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgIHJldHVybiAvKiogQHR5cGUgeyR7c2lnbmF0dXJlLnJldHVyblR5cGV9fSAqLyAoYXdhaXQgdGhpcy5leGVjdXRlQ3VzdG9tQ29tbWFuZCh7XFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIGNvbW1hbmROYW1lOiAke0pTT04uc3RyaW5naWZ5KGNvbGxlY3Rpb25Db21tYW5kc1ttZXRob2ROYW1lXSl9LFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBjb21tYW5kVHlwZTogJHtKU09OLnN0cmluZ2lmeShjb2xsZWN0aW9uQ29tbWFuZHNbbWV0aG9kTmFtZV0pfSxcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgICAgcGF5bG9hZDogJHtjbGFzc05hbWV9Lm5vcm1hbGl6ZUN1c3RvbUNvbW1hbmRQYXlsb2FkQXJndW1lbnRzKCR7c2lnbmF0dXJlLnBheWxvYWRBcmd1bWVudHN9KSxcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICAgIHJlc291cmNlUGF0aDogdGhpcy5yZXNvdXJjZVBhdGgoKVxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICB9KSlcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIH1cXG5cIlxuICAgIH1cblxuICAgIGZvciAoY29uc3QgbWV0aG9kTmFtZSBvZiBPYmplY3Qua2V5cyhtZW1iZXJDb21tYW5kcykpIHtcbiAgICAgIGNvbnN0IHNpZ25hdHVyZSA9IHRoaXMuY3VzdG9tQ29tbWFuZE1ldGhvZFNpZ25hdHVyZSh7Y29tbWFuZE1ldGFkYXRhLCBtZXRob2ROYW1lfSlcblxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSdW5zICR7bWV0aG9kTmFtZX0uXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gc2lnbmF0dXJlLnBhcmFtRG9jc1xuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge1Byb21pc2U8JHtzaWduYXR1cmUucmV0dXJuVHlwZX0+fSAtIENvbW1hbmQgcmVzcG9uc2UuXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICBhc3luYyAke21ldGhvZE5hbWV9KCR7c2lnbmF0dXJlLnBhcmFtZXRlcnN9KSB7XFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICByZXR1cm4gLyoqIEB0eXBlIHske3NpZ25hdHVyZS5yZXR1cm5UeXBlfX0gKi8gKGF3YWl0ICR7Y2xhc3NOYW1lfS5leGVjdXRlQ3VzdG9tQ29tbWFuZCh7XFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIGNvbW1hbmROYW1lOiAke0pTT04uc3RyaW5naWZ5KG1lbWJlckNvbW1hbmRzW21ldGhvZE5hbWVdKX0sXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIGNvbW1hbmRUeXBlOiAke0pTT04uc3RyaW5naWZ5KG1lbWJlckNvbW1hbmRzW21ldGhvZE5hbWVdKX0sXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIG1lbWJlcklkOiB0aGlzLnNjYWxhclByaW1hcnlLZXlWYWx1ZSgke0pTT04uc3RyaW5naWZ5KGBDdXN0b20gbWVtYmVyIGNvbW1hbmQgJHtjbGFzc05hbWV9IyR7bWV0aG9kTmFtZX1gKX0pLFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBwYXlsb2FkOiAke2NsYXNzTmFtZX0ubm9ybWFsaXplQ3VzdG9tQ29tbWFuZFBheWxvYWRBcmd1bWVudHMoJHtzaWduYXR1cmUucGF5bG9hZEFyZ3VtZW50c30pLFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICByZXNvdXJjZVBhdGg6ICR7Y2xhc3NOYW1lfS5yZXNvdXJjZVBhdGgoKVxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIH0pKVxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgfVxcblwiXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgcmVsYXRpb25zaGlwcykge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZCA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRJbXBvcnRQYXRoID0gYC4vJHtyZWxhdGlvbnNoaXAudGFyZ2V0RmlsZU5hbWV9LmpzYFxuICAgICAgY29uc3QgdGFyZ2V0SW5zdGFuY2VUeXBlID0gYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHRhcmdldEltcG9ydFBhdGgpfSkuJHtyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lfWBcbiAgICAgIGNvbnN0IHRhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlID0gYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHRhcmdldEltcG9ydFBhdGgpfSkuJHtyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lfUNyZWF0ZUF0dHJpYnV0ZXNgXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAudHlwZSA9PSBcImhhc01hbnlcIikge1xuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9IHJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDwke2NsYXNzTmFtZX0sICR7dGFyZ2V0SW5zdGFuY2VUeXBlfSwgJHt0YXJnZXRDcmVhdGVBdHRyaWJ1dGVzVHlwZX0+fSAtIFJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKSB7IHJldHVybiAvKiogQHR5cGUge2ltcG9ydCgke0pTT04uc3RyaW5naWZ5KGltcG9ydFBhdGgpfSkuRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8JHtjbGFzc05hbWV9LCAke3RhcmdldEluc3RhbmNlVHlwZX0sICR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9Pn0gKi8gKHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKCR7SlNPTi5zdHJpbmdpZnkocmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWUpfSkpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUmV0dXJucyAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfS5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPCR7Y2xhc3NOYW1lfSwgJHt0YXJnZXRJbnN0YW5jZVR5cGV9LCAke3RhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlfT59IC0gUmVsYXRpb25zaGlwIGhlbHBlci5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfSgpIHsgcmV0dXJuIHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKSB9XFxuYFxuXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIFJldHVybnMgbG9hZGVkICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge0FycmF5PCR7dGFyZ2V0SW5zdGFuY2VUeXBlfT59IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWxzLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9TG9hZGVkKCkgeyByZXR1cm4gdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLmxvYWRlZCgpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogTG9hZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTwke3RhcmdldEluc3RhbmNlVHlwZX0+Pn0gLSBMb2FkZWQgcmVsYXRlZCBtb2RlbHMuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgbG9hZCR7cmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZH0oKSB7IHJldHVybiBhd2FpdCB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkubG9hZCgpIH1cXG5gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9IHJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8JHtjbGFzc05hbWV9LCAke3RhcmdldEluc3RhbmNlVHlwZX0sICR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9Pn0gLSBSZWxhdGlvbnNoaXAgaGVscGVyLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDwke2NsYXNzTmFtZX0sICR7dGFyZ2V0SW5zdGFuY2VUeXBlfSwgJHt0YXJnZXRDcmVhdGVBdHRyaWJ1dGVzVHlwZX0+fSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoJHtKU09OLnN0cmluZ2lmeShyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZSl9KSkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMgeyR7dGFyZ2V0SW5zdGFuY2VUeXBlfSB8IG51bGx9IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0oKSB7IHJldHVybiB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkubG9hZGVkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBCdWlsZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0geyR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9fSBbYXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzIGZvciB0aGUgbmV3IHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7JHt0YXJnZXRJbnN0YW5jZVR5cGV9fSAtIEJ1aWx0IHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYnVpbGQke3JlbGF0aW9uc2hpcE5hbWVDYW1lbGl6ZWR9KGF0dHJpYnV0ZXMgPSB7fSkgeyByZXR1cm4gdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLmJ1aWxkKGF0dHJpYnV0ZXMpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogTG9hZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwke3RhcmdldEluc3RhbmNlVHlwZX0gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRlZCBtb2RlbC5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICBhc3luYyBsb2FkJHtyZWxhdGlvbnNoaXBOYW1lQ2FtZWxpemVkfSgpIHsgcmV0dXJuIGF3YWl0IHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKS5sb2FkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zIG9yIGxvYWRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge1Byb21pc2U8JHt0YXJnZXRJbnN0YW5jZVR5cGV9IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1PckxvYWQoKSB7IHJldHVybiBhd2FpdCB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkub3JMb2FkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBTZXRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHske3RhcmdldEluc3RhbmNlVHlwZX0gfCBudWxsfSBtb2RlbCAtIFJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICogQHJldHVybnMge3ZvaWR9XFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgIHNldCR7cmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZH0obW9kZWwpIHsgdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLnNldExvYWRlZChtb2RlbCkgfVxcbmBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqIFJlZ2lzdGVycyBhIGNsYXNzLWxldmVsIGRlc3Ryb3kgY2FsbGJhY2suXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAgICogQG92ZXJsb2FkXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6ICR7ZXZlbnRQcmltYXJ5S2V5VmFsdWVUeXBlfX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEBwYXJhbSB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBEZXN0cm95IGV2ZW50IG9wdGlvbnMuXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEB0ZW1wbGF0ZSB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsQ2xhc3N9IFRcXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqIEBvdmVybG9hZFxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqIEB0aGlzIHtUfVxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxFdmVudFByaW1hcnlLZXlWYWx1ZUZvcjxJbnN0YW5jZVR5cGU8VD4+fSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHtpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIERlc3Ryb3kgZXZlbnQgb3B0aW9ucy5cXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqIEltcGxlbWVudHMgY2xhc3MtbGV2ZWwgZGVzdHJveSBjYWxsYmFjayByZWdpc3RyYXRpb24uXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBuZXZlcn0pID0+IHZvaWR9IGNhbGxiYWNrIC0gVHlwZS1lcmFzZWQgZXZlbnQgY2FsbGJhY2suXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0ge2ltcG9ydCgke0pTT04uc3RyaW5naWZ5KGltcG9ydFBhdGgpfSkuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRGVzdHJveSBldmVudCBvcHRpb25zLlxcbmBcbiAgICBmaWxlQ29udGVudCArPSBcIiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAgc3RhdGljIGFzeW5jIG9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcmVnaXN0ZXJEZXN0cm95RXZlbnRDYWxsYmFjayhjYWxsYmFjaywgb3B0aW9ucylcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcblxuICAgIGZpbGVDb250ZW50ICs9IFwifVxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IGBGcm9udGVuZE1vZGVsQmFzZS5yZWdpc3Rlck1vZGVsKCR7Y2xhc3NOYW1lfSlcXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IGBleHBvcnQgeyR7Y2xhc3NOYW1lfX1cXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IGBleHBvcnQgZGVmYXVsdCAke2NsYXNzTmFtZX1cXG5gXG5cbiAgICByZXR1cm4gZmlsZUNvbnRlbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIHNldHVwIGZpbGUgY29udGVudC5cbiAgICogQHBhcmFtIHtBcnJheTx7Y2xhc3NOYW1lOiBzdHJpbmcsIGZpbGVOYW1lOiBzdHJpbmd9Pn0gZ2VuZXJhdGVkRmlsZXMgLSBHZW5lcmF0ZWQgbW9kZWwgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2V0dXAgZmlsZSBjb250ZW50IHdpdGggc2lkZS1lZmZlY3QgaW1wb3J0cyBmb3IgbW9kZWwgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYnVpbGRTZXR1cEZpbGVDb250ZW50KGdlbmVyYXRlZEZpbGVzKSB7XG4gICAgbGV0IGNvbnRlbnQgPSBnZW5lcmF0ZWRGaWxlQmFubmVyKEZST05URU5EX01PREVMU19SRUdFTkVSQVRFX0NPTU1BTkQpXG5cbiAgICBmb3IgKGNvbnN0IHtmaWxlTmFtZX0gb2YgZ2VuZXJhdGVkRmlsZXMpIHtcbiAgICAgIGNvbnRlbnQgKz0gYGltcG9ydCBcIi4vJHtmaWxlTmFtZX1cIlxcbmBcbiAgICB9XG5cbiAgICByZXR1cm4gY29udGVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd3JpdGUgYXR0cmlidXRlcyB0eXBlZGVmLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtBcnJheTx7anNEb2NUeXBlOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgd3JpdGVKc0RvY1R5cGU6IHN0cmluZ30+fSBhcmdzLmF0dHJpYnV0ZXMgLSBHZW5lcmF0ZWQgcmVhZCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVzVHlwZU5hbWUgLSBHZW5lcmF0ZWQgcmVhZCBhdHRyaWJ1dGVzIHR5cGVkZWYgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7QXJyYXk8e2F0dHJpYnV0ZXM6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZWxhdGlvbnNoaXBOYW1lOiBzdHJpbmcsIHR5cGVOYW1lOiBzdHJpbmd9Pn0gYXJncy5uZXN0ZWRXcml0ZVR5cGVzIC0gTmVzdGVkIHdyaXRlIHR5cGVkZWZzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxHZW5lcmF0b3JQZXJtaXRTcGVjfSBhcmdzLnBlcm1pdHRlZFBhcmFtcyAtIFJlc291cmNlIHBlcm1pdHRlZCBwYXJhbXMgc3BlYy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MucmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlTmFtZSAtIFR5cGVkZWYgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBHZW5lcmF0ZWQgdHlwZWRlZiBzb3VyY2UuXG4gICAqL1xuICBhc3luYyB3cml0ZUF0dHJpYnV0ZXNUeXBlZGVmKHthdHRyaWJ1dGVzLCBhdHRyaWJ1dGVzVHlwZU5hbWUsIG1vZGVsQ2xhc3MsIG5lc3RlZFdyaXRlVHlwZXMsIHBlcm1pdHRlZFBhcmFtcywgcmVzb3VyY2VDbGFzcywgdHlwZU5hbWV9KSB7XG4gICAgY29uc3QgYXR0cmlidXRlTGluZXMgPSBbXVxuXG4gICAgbGV0IG91dHB1dCA9IFwiLyoqXFxuXCJcblxuICAgIGNvbnN0IGF0dHJpYnV0ZXNCeU5hbWUgPSBuZXcgTWFwKGF0dHJpYnV0ZXMubWFwKChhdHRyaWJ1dGUpID0+IFthdHRyaWJ1dGUubmFtZSwgYXR0cmlidXRlXSkpXG4gICAgY29uc3QgbmVzdGVkV3JpdGVUeXBlc0J5S2V5ID0gbmV3IE1hcChuZXN0ZWRXcml0ZVR5cGVzLm1hcCgobmVzdGVkV3JpdGVUeXBlKSA9PiBbYCR7bmVzdGVkV3JpdGVUeXBlLnJlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlc2AsIG5lc3RlZFdyaXRlVHlwZV0pKVxuICAgIGNvbnN0IGVtaXR0ZWRBdHRyaWJ1dGVOYW1lcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwZXJtaXR0ZWRQYXJhbXMpIHtcbiAgICAgIGlmICh0eXBlb2YgZW50cnkgPT0gXCJzdHJpbmdcIikge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gdGhpcy5mcm9udGVuZFdyaXRlQXR0cmlidXRlTmFtZSh7YXR0cmlidXRlTmFtZTogZW50cnksIGF0dHJpYnV0ZXNCeU5hbWUsIG1vZGVsQ2xhc3N9KVxuXG4gICAgICAgIGlmIChlbWl0dGVkQXR0cmlidXRlTmFtZXMuaGFzKGF0dHJpYnV0ZU5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGVtaXR0ZWRBdHRyaWJ1dGVOYW1lcy5hZGQoYXR0cmlidXRlTmFtZSlcblxuICAgICAgICBjb25zdCB0eXBlID0gYXdhaXQgdGhpcy5mcm9udGVuZFdyaXRlQXR0cmlidXRlVHlwZSh7XG4gICAgICAgICAgYXR0cmlidXRlOiBhdHRyaWJ1dGVzQnlOYW1lLmdldChhdHRyaWJ1dGVOYW1lKSxcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgIGF0dHJpYnV0ZXNUeXBlTmFtZSxcbiAgICAgICAgICByZXNvdXJjZUNsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXR0cmlidXRlTGluZXMucHVzaChgICogQHByb3BlcnR5IHske3R5cGV9fSBbJHthdHRyaWJ1dGVOYW1lfV0gLSBQZXJtaXR0ZWQgJHthdHRyaWJ1dGVOYW1lfSB2YWx1ZS5cXG5gKVxuICAgICAgfSBlbHNlIGlmIChlbnRyeSAmJiB0eXBlb2YgZW50cnkgPT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZW50cnkpKSB7XG4gICAgICAgICAgY29uc3QgbmVzdGVkV3JpdGVUeXBlID0gbmVzdGVkV3JpdGVUeXBlc0J5S2V5LmdldChrZXkpXG4gICAgICAgICAgY29uc3QgdHlwZSA9IG5lc3RlZFdyaXRlVHlwZSA/IGBBcnJheTwke25lc3RlZFdyaXRlVHlwZS50eXBlTmFtZX0+YCA6IFwiQXJyYXk8b2JqZWN0PlwiXG5cbiAgICAgICAgICBhdHRyaWJ1dGVMaW5lcy5wdXNoKGAgKiBAcHJvcGVydHkgeyR7dHlwZX19IFske2tleX1dIC0gUGVybWl0dGVkIG5lc3RlZCAke2tleX0gdmFsdWVzLlxcbmApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBvdXRwdXQgKz0gYCAqIEF0dHJpYnV0ZXMgYWNjZXB0ZWQgYnkgJHt0eXBlTmFtZX0uXFxuYFxuICAgIGlmIChhdHRyaWJ1dGVMaW5lcy5sZW5ndGggPT09IDApIHtcbiAgICAgIG91dHB1dCArPSBgICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIG5ldmVyPn0gJHt0eXBlTmFtZX1cXG5gXG4gICAgfSBlbHNlIHtcbiAgICAgIG91dHB1dCArPSBgICogQHR5cGVkZWYge29iamVjdH0gJHt0eXBlTmFtZX1cXG5gXG4gICAgICBvdXRwdXQgKz0gYXR0cmlidXRlTGluZXMuam9pbihcIlwiKVxuICAgIH1cbiAgICBvdXRwdXQgKz0gXCIgKi9cXG5cIlxuXG4gICAgcmV0dXJuIG91dHB1dFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgd3JpdGUgYXR0cmlidXRlIHR5cGUuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZToge2pzRG9jVHlwZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcsIHdyaXRlSnNEb2NUeXBlOiBzdHJpbmd9IHwgdW5kZWZpbmVkLCBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXNUeXBlTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpTRG9jIHR5cGUgZm9yIHRoZSBwZXJtaXR0ZWQgd3JpdGUgZmllbGQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFdyaXRlQXR0cmlidXRlVHlwZSh7YXR0cmlidXRlLCBhdHRyaWJ1dGVOYW1lLCBhdHRyaWJ1dGVzVHlwZU5hbWUsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgY29uc3Qgc2V0dGVyUGFyYW1ldGVyVHlwZSA9IGF3YWl0IHRoaXMuZnJvbnRlbmRXcml0ZUF0dHJpYnV0ZVNldHRlclBhcmFtZXRlclR5cGUoe2F0dHJpYnV0ZU5hbWUsIHJlc291cmNlQ2xhc3N9KVxuXG4gICAgaWYgKHNldHRlclBhcmFtZXRlclR5cGUpIHJldHVybiBgJHtzZXR0ZXJQYXJhbWV0ZXJUeXBlfSB8IG51bGxgXG5cbiAgICBpZiAoIWF0dHJpYnV0ZSkgcmV0dXJuIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCJcblxuICAgIGlmIChhdHRyaWJ1dGUuanNEb2NUeXBlLnRyaW0oKSA9PT0gXCJudWxsXCIpIHJldHVybiBcIkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVwiXG5cbiAgICBpZiAoYXR0cmlidXRlLndyaXRlSnNEb2NUeXBlICE9PSBhdHRyaWJ1dGUuanNEb2NUeXBlKSByZXR1cm4gYXR0cmlidXRlLndyaXRlSnNEb2NUeXBlXG5cbiAgICByZXR1cm4gYCR7YXR0cmlidXRlc1R5cGVOYW1lfVske0pTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZS5uYW1lKX1dIHwgbnVsbGBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHdyaXRlIGF0dHJpYnV0ZSBzZXR0ZXIgcGFyYW1ldGVyIHR5cGUuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgcmVzb3VyY2VDbGFzczogaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gU2V0dGVyIHZhbHVlIHBhcmFtZXRlciB0eXBlIHdoZW4gaXQgaXMgdXNlZnVsIGZvciBnZW5lcmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRXcml0ZUF0dHJpYnV0ZVNldHRlclBhcmFtZXRlclR5cGUoe2F0dHJpYnV0ZU5hbWUsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzPy5uYW1lKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgbWV0aG9kTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSl9QXR0cmlidXRlYFxuICAgIGNvbnN0IHBhcmFtZXRlclR5cGUgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZSh7XG4gICAgICBtZXRob2ROYW1lLFxuICAgICAgcGFyYW1ldGVySW5kZXg6IDEsXG4gICAgICBzb3VyY2VDbGFzc05hbWU6IHJlc291cmNlQ2xhc3MubmFtZVxuICAgIH0pXG5cbiAgICBpZiAoIXBhcmFtZXRlclR5cGUpIHJldHVybiBudWxsXG4gICAgaWYgKHRoaXMuaXNCcm9hZEdlbmVyYXRlZFR5cGUocGFyYW1ldGVyVHlwZSkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gcGFyYW1ldGVyVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgYnJvYWQgZ2VuZXJhdGVkIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqc0RvY1R5cGUgLSBKU0RvYyB0eXBlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB0eXBlIGlzIHRvbyBicm9hZCB0byBpbXByb3ZlIGdlbmVyYXRlZCB3cml0ZSB0eXBpbmcuXG4gICAqL1xuICBpc0Jyb2FkR2VuZXJhdGVkVHlwZShqc0RvY1R5cGUpIHtcbiAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IGpzRG9jVHlwZS50cmltKClcblxuICAgIHJldHVybiBub3JtYWxpemVkVHlwZSA9PT0gXCI/XCJcbiAgICAgIHx8IG5vcm1hbGl6ZWRUeXBlID09PSBcImFueVwiXG4gICAgICB8fCBub3JtYWxpemVkVHlwZSA9PT0gXCJvYmplY3RcIlxuICAgICAgfHwgbm9ybWFsaXplZFR5cGUgPT09IFwidW5rbm93blwiXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBwZXJtaXR0ZWQgd3JpdGUgYXR0cmlidXRlIHRvIHRoZSBnZW5lcmF0ZWQgZnJvbnRlbmQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgYXR0cmlidXRlc0J5TmFtZTogTWFwPHN0cmluZywge2pzRG9jVHlwZTogc3RyaW5nLCBuYW1lOiBzdHJpbmd9PiwgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGcm9udGVuZCBhdHRyaWJ1dGUgbmFtZSB1c2VkIGJ5IGdlbmVyYXRlZCBhY2Nlc3NvcnMuXG4gICAqL1xuICBmcm9udGVuZFdyaXRlQXR0cmlidXRlTmFtZSh7YXR0cmlidXRlTmFtZSwgYXR0cmlidXRlc0J5TmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoYXR0cmlidXRlc0J5TmFtZS5oYXMoYXR0cmlidXRlTmFtZSkpIHJldHVybiBhdHRyaWJ1dGVOYW1lXG5cbiAgICBpZiAobW9kZWxDbGFzcykge1xuICAgICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lICYmIGF0dHJpYnV0ZXNCeU5hbWUuaGFzKHJlc29sdmVkQXR0cmlidXRlTmFtZSkpIHJldHVybiByZXNvbHZlZEF0dHJpYnV0ZU5hbWVcbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSwgdHJ1ZSkudG9Mb3dlckNhc2UoKVxuICAgIGNvbnN0IG1hdGNoaW5nQXR0cmlidXRlTmFtZSA9IEFycmF5LmZyb20oYXR0cmlidXRlc0J5TmFtZS5rZXlzKCkpLmZpbmQoKGNhbmRpZGF0ZU5hbWUpID0+IGNhbmRpZGF0ZU5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAobWF0Y2hpbmdBdHRyaWJ1dGVOYW1lKSByZXR1cm4gbWF0Y2hpbmdBdHRyaWJ1dGVOYW1lXG5cbiAgICAvLyBXcml0ZS1vbmx5IHZpcnR1YWwgcGFyYW1zIGFyZSB2YWxpZCBwZXJtaXR0ZWQgcGFyYW1zIGV2ZW4gd2hlbiB0aGV5IGhhdmUgbm8gcmVhZCBhdHRyaWJ1dGUuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5lc3RlZCB3cml0ZSB0eXBlcyBmb3IgbW9kZWwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxHZW5lcmF0b3JQZXJtaXRTcGVjfSBhcmdzLnBlcm1pdHRlZFBhcmFtcyAtIENvbWJpbmVkIHBlcm1pdHRlZCBwYXJhbXMgc3BlY3MuXG4gICAqIEBwYXJhbSB7QXJyYXk8e2F1dG9sb2FkOiBib29sZWFuLCByZWxhdGlvbnNoaXBOYW1lOiBzdHJpbmcsIHRhcmdldENsYXNzTmFtZTogc3RyaW5nLCB0YXJnZXRGaWxlTmFtZTogc3RyaW5nLCB0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifT59IGFyZ3MucmVsYXRpb25zaGlwcyAtIEdlbmVyYXRlZCByZWxhdGlvbnNoaXBzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e2F0dHJpYnV0ZXM6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZWxhdGlvbnNoaXBOYW1lOiBzdHJpbmcsIHR5cGVOYW1lOiBzdHJpbmd9Pn0gLSBOZXN0ZWQgd3JpdGUgdHlwZWRlZnMuXG4gICAqL1xuICBuZXN0ZWRXcml0ZVR5cGVzRm9yTW9kZWwoe2NsYXNzTmFtZSwgcGVybWl0dGVkUGFyYW1zLCByZWxhdGlvbnNoaXBzfSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHNCeU5hbWUgPSBuZXcgTWFwKHJlbGF0aW9uc2hpcHMubWFwKChyZWxhdGlvbnNoaXApID0+IFtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwXSkpXG4gICAgY29uc3QgbmVzdGVkV3JpdGVUeXBlc0J5TmFtZSA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwZXJtaXR0ZWRQYXJhbXMpIHtcbiAgICAgIGlmICghZW50cnkgfHwgdHlwZW9mIGVudHJ5ICE9IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGVudHJ5KSkge1xuICAgICAgICBpZiAoIWtleS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIGNvbnRpbnVlXG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSBrZXkuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcbiAgICAgICAgY29uc3QgbmVzdGVkU3BlYyA9IGVudHJ5W2tleV1cbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gcmVsYXRpb25zaGlwc0J5TmFtZS5nZXQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgbGV0IHRhcmdldE1vZGVsQ2xhc3NcblxuICAgICAgICBpZiAocmVsYXRpb25zaGlwKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRNb2RlbENsYXNzKHJlbGF0aW9uc2hpcC50YXJnZXRDbGFzc05hbWUpXG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5lc3RlZFdyaXRlVHlwZXNCeU5hbWUuaGFzKHJlbGF0aW9uc2hpcE5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIG5lc3RlZFdyaXRlVHlwZXNCeU5hbWUuc2V0KHJlbGF0aW9uc2hpcE5hbWUsIHtcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB0aGlzLm5lc3RlZFdyaXRlQXR0cmlidXRlc0ZvclNwZWMoe25lc3RlZFNwZWMsIHRhcmdldE1vZGVsQ2xhc3N9KSxcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHR5cGVOYW1lOiBgJHtjbGFzc05hbWV9JHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfU5lc3RlZEF0dHJpYnV0ZXNgXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmVzdGVkV3JpdGVUeXBlc0J5TmFtZS52YWx1ZXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5lc3RlZCB3cml0ZSBhdHRyaWJ1dGVzIGZvciBzcGVjLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+PiB8IG9iamVjdCB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MubmVzdGVkU3BlYyAtIE5lc3RlZCBwZXJtaXQgc3BlYy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBiYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT59IC0gTmVzdGVkIHdyaXRlIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBuZXN0ZWRXcml0ZUF0dHJpYnV0ZXNGb3JTcGVjKHtuZXN0ZWRTcGVjLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShuZXN0ZWRTcGVjKSkgcmV0dXJuIFtdXG5cbiAgICByZXR1cm4gbmVzdGVkU3BlYy5maWx0ZXIoKGVudHJ5KSA9PiB0eXBlb2YgZW50cnkgPT0gXCJzdHJpbmdcIikubWFwKChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSB0YXJnZXRNb2RlbENsYXNzPy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSB8fCBhdHRyaWJ1dGVOYW1lXG4gICAgICBjb25zdCBhdHRyaWJ1dGVDb25maWcgPSB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yTW9kZWxBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWU6IHJlc29sdmVkQXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzc30pXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIG5hbWU6IHJlc29sdmVkQXR0cmlidXRlTmFtZSxcbiAgICAgICAgdHlwZTogYXR0cmlidXRlQ29uZmlnID8gdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZFdyaXRlQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWd9KSA6IFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCJcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVybWl0dGVkIHBhcmFtcyBmb3IgZ2VuZXJhdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gcmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwifSBhY3Rpb24gLSBXcml0ZSBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsR2VuZXJhdG9yUGVybWl0U3BlY30gLSBQZXJtaXR0ZWQgcGFyYW1zIHNwZWMuXG4gICAqL1xuICBwZXJtaXR0ZWRQYXJhbXNGb3JHZW5lcmF0b3IocmVzb3VyY2VDbGFzcywgYWN0aW9uKSB7XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzKSByZXR1cm4gW11cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBtb2RlbENsYXNzID0gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcblxuICAgICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IocmVzb3VyY2VDbGFzcylcbiAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IFJlc291cmNlQ2xhc3Moe1xuICAgICAgICBhYmlsaXR5OiB1bmRlZmluZWQsXG4gICAgICAgIGNvbnRleHQ6IHt9LFxuICAgICAgICBsb2NhbHM6IHt9LFxuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBtb2RlbE5hbWU6IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIHBhcmFtczoge30sXG4gICAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259ICovICh7YXR0cmlidXRlczogW119KVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHNwZWMgPSBpbnN0YW5jZS5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbiwgYWJpbGl0eTogdW5kZWZpbmVkLCBsb2NhbHM6IHt9LCBwYXJhbXM6IHt9fSlcblxuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoc3BlYykgPyBzcGVjIDogW11cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gaW52b2tlICR7cmVzb3VyY2VDbGFzcy5uYW1lfS5wZXJtaXR0ZWRQYXJhbXMoKSB3aGlsZSBnZW5lcmF0aW5nIGZyb250ZW5kIG1vZGVsIHdyaXRlIHR5cGVzOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW52b2tlcyBhIGJhY2tlbmQgcmVzb3VyY2UncyBgcGVybWl0dGVkUGFyYW1zKClgIGluc3RhbmNlIG1ldGhvZCBhdFxuICAgKiBnZW5lcmF0aW9uIHRpbWUgYW5kIGV4dHJhY3RzIHRoZSByZWxhdGlvbnNoaXAgbmFtZXMgdGhhdCBhY2NlcHRcbiAgICogbmVzdGVkIHdyaXRlcyAoYHtmb29BdHRyaWJ1dGVzOiBbLi4uXX1gIGVudHJpZXMpLiBUaGUgZ2VuZXJhdG9yXG4gICAqIGVtaXRzIHRob3NlIG5hbWVzIGludG8gdGhlIGZyb250ZW5kIG1vZGVsJ3MgYHJlc291cmNlQ29uZmlnKClgIHNvXG4gICAqIHRoZSBjbGllbnQgYHNhdmUoKWAgd2Fsa2VyIGtub3dzIHdoaWNoIHJlbGF0aW9uc2hpcHMgdG8gc2hpcC5cbiAgICpcbiAgICogQ29uc3RydWN0ZWQgd2l0aCBubyBjb250cm9sbGVyL2FiaWxpdHkgc28gcmVzb3VyY2Ugb3ZlcnJpZGVzIG11c3RcbiAgICogc3VwcG9ydCBiZWluZyBjYWxsZWQgd2l0aG91dCBhIHJlcXVlc3QgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IHJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFJlbGF0aW9uc2hpcCBuYW1lcyB0aGF0IGFjY2VwdCBuZXN0ZWQgd3JpdGVzIChlbXB0eSB3aGVuIG5vbmUpLlxuICAgKi9cbiAgbmVzdGVkUmVsYXRpb25zaGlwTmFtZXNGb3JHZW5lcmF0b3IocmVzb3VyY2VDbGFzcykge1xuICAgIGlmICghcmVzb3VyY2VDbGFzcykgcmV0dXJuIFtdXG5cbiAgICBsZXQgc3BlY1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuXG4gICAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvcihyZXNvdXJjZUNsYXNzKVxuICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgUmVzb3VyY2VDbGFzcyh7XG4gICAgICAgIGFiaWxpdHk6IHVuZGVmaW5lZCxcbiAgICAgICAgY29udGV4dDoge30sXG4gICAgICAgIGxvY2Fsczoge30sXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIG1vZGVsTmFtZTogbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgcGFyYW1zOiB7fSxcbiAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHthdHRyaWJ1dGVzOiBbXX0pXG4gICAgICB9KVxuICAgICAgc3BlYyA9IGluc3RhbmNlLnBlcm1pdHRlZFBhcmFtcygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGludm9rZSAke3Jlc291cmNlQ2xhc3MubmFtZX0ucGVybWl0dGVkUGFyYW1zKCkgd2hpbGUgZ2VuZXJhdGluZyBmcm9udGVuZCBtb2RlbHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzcGVjKSkgcmV0dXJuIFtdXG5cbiAgICAvKipcbiAgICAgKiBSZWxhdGlvbnNoaXAgbmFtZXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWVzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3BlYykge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGVudHJ5KSkge1xuICAgICAgICBpZiAoIWtleS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIGNvbnRpbnVlXG4gICAgICAgIGNvbnN0IG5hbWUgPSBrZXkuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcbiAgICAgICAgaWYgKG5hbWUpIHJlbGF0aW9uc2hpcE5hbWVzLnB1c2gobmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBhcnJheSBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGb3JtYXR0aW5nIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmluZGVudCAtIEJhc2UgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb3BlcnR5TmFtZSAtIE9iamVjdCBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLnZhbHVlcyAtIFN0cmluZyB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRm9ybWF0dGVkIG11bHRpbGluZSBhcnJheSBwcm9wZXJ0eS5cbiAgICovXG4gIGZvcm1hdHRlZEFycmF5UHJvcGVydHkoe2luZGVudCwgcHJvcGVydHlOYW1lLCB2YWx1ZXN9KSB7XG4gICAgbGV0IG91dHB1dCA9IGAke2luZGVudH0ke3Byb3BlcnR5TmFtZX06IFtcXG5gXG5cbiAgICBmb3IgKGNvbnN0IHZhbHVlIG9mIHZhbHVlcykge1xuICAgICAgb3V0cHV0ICs9IGAke2luZGVudH0gICR7SlNPTi5zdHJpbmdpZnkodmFsdWUpfSxcXG5gXG4gICAgfVxuXG4gICAgb3V0cHV0ICs9IGAke2luZGVudH1dLFxcbmBcblxuICAgIHJldHVybiBvdXRwdXRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBjb21tYW5kcyBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGb3JtYXR0aW5nIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmluZGVudCAtIEJhc2UgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb3BlcnR5TmFtZSAtIE9iamVjdCBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IGFyZ3MudmFsdWVzIC0gQ29tbWFuZCBrZXktdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBtdWx0aWxpbmUgYXJyYXkgcHJvcGVydHkuIEFsd2F5cyBlbWl0c1xuICAgKiAgIHRoZSBjYW1lbENhc2UgbWV0aG9kLW5hbWUgYXJyYXkgZm9ybSAoYG1lbWJlckNvbW1hbmRzOiBbXCJ1cGRhdGVBY2Nlc3NcIl1gKVxuICAgKiAgIHNvIHRoZSBnZW5lcmF0ZWQgY29uZmlnIG1hdGNoZXMgdGhlIGNhbm9uaWNhbFxuICAgKiAgIGBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWcue2NvbGxlY3Rpb24sbWVtYmVyfUNvbW1hbmRzOiBzdHJpbmdbXWBcbiAgICogICBzaGFwZS4gVGhlIHJ1bnRpbWUgZGVyaXZlcyB0aGUgY29tbWFuZCBzbHVnIGZyb20gdGhlIGNhbWVsQ2FzZVxuICAgKiAgIG1ldGhvZCBuYW1lOyBjb25zdW1lcnMgbmV2ZXIgbmVlZCB0byB3cml0ZSBvdXRcbiAgICogICBge3VwZGF0ZUFjY2VzczogXCJ1cGRhdGUtYWNjZXNzXCJ9YCBieSBoYW5kLlxuICAgKi9cbiAgZm9ybWF0dGVkQ29tbWFuZHNQcm9wZXJ0eSh7aW5kZW50LCBwcm9wZXJ0eU5hbWUsIHZhbHVlc30pIHtcbiAgICByZXR1cm4gdGhpcy5mb3JtYXR0ZWRBcnJheVByb3BlcnR5KHtpbmRlbnQsIHByb3BlcnR5TmFtZSwgdmFsdWVzOiBPYmplY3Qua2V5cyh2YWx1ZXMpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBvYmplY3QgcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRm9ybWF0dGluZyBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbmRlbnQgLSBCYXNlIGluZGVudGF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcm9wZXJ0eU5hbWUgLSBPYmplY3QgcHJvcGVydHkgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBhcmdzLnZhbHVlcyAtIE9iamVjdCBrZXktdmFsdWVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IFthcmdzLmZpbHRlckRlZmF1bHRWYWx1ZXNdIC0gRGVmYXVsdCB2YWx1ZXMgdG8gb21pdCBmcm9tIG91dHB1dC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgbXVsdGlsaW5lIG9iamVjdCBwcm9wZXJ0eS5cbiAgICovXG4gIGZvcm1hdHRlZE9iamVjdFByb3BlcnR5KHtmaWx0ZXJEZWZhdWx0VmFsdWVzLCBpbmRlbnQsIHByb3BlcnR5TmFtZSwgdmFsdWVzfSkge1xuICAgIGxldCBvdXRwdXQgPSBgJHtpbmRlbnR9JHtwcm9wZXJ0eU5hbWV9OiB7XFxuYFxuXG4gICAgZm9yIChjb25zdCBvYmplY3RLZXkgb2YgT2JqZWN0LmtleXModmFsdWVzKSkge1xuICAgICAgaWYgKGZpbHRlckRlZmF1bHRWYWx1ZXMgJiYgZmlsdGVyRGVmYXVsdFZhbHVlc1tvYmplY3RLZXldID09PSB2YWx1ZXNbb2JqZWN0S2V5XSkgY29udGludWVcblxuICAgICAgb3V0cHV0ICs9IGAke2luZGVudH0gICR7b2JqZWN0S2V5fTogJHtKU09OLnN0cmluZ2lmeSh2YWx1ZXNbb2JqZWN0S2V5XSl9LFxcbmBcbiAgICB9XG5cbiAgICBvdXRwdXQgKz0gYCR7aW5kZW50fX0sXFxuYFxuXG4gICAgcmV0dXJuIG91dHB1dFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIEpTT04gcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRm9ybWF0dGluZyBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbmRlbnQgLSBCYXNlIGluZGVudGF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcm9wZXJ0eU5hbWUgLSBPYmplY3QgcHJvcGVydHkgbmFtZS5cbiAgICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnZhbHVlIC0gSlNPTi1jb21wYXRpYmxlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBwcm9wZXJ0eS5cbiAgICovXG4gIGZvcm1hdHRlZEpzb25Qcm9wZXJ0eSh7aW5kZW50LCBwcm9wZXJ0eU5hbWUsIHZhbHVlfSkge1xuICAgIHJldHVybiBgJHtpbmRlbnR9JHtwcm9wZXJ0eU5hbWV9OiAke3RoaXMuZm9ybWF0dGVkSnNvblZhbHVlKHtpbmRlbnQsIHZhbHVlfSl9LFxcbmBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBKU09OIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZvcm1hdHRpbmcgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW5kZW50IC0gSW5kZW50YXRpb24gYmVmb3JlIHRoaXMgdmFsdWUuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy52YWx1ZSAtIEpTT04tY29tcGF0aWJsZSB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgdmFsdWUuXG4gICAqL1xuICBmb3JtYXR0ZWRKc29uVmFsdWUoe2luZGVudCwgdmFsdWV9KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBsZXQgb3V0cHV0ID0gXCJbXFxuXCJcblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiB2YWx1ZSkge1xuICAgICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fSAgJHt0aGlzLmZvcm1hdHRlZEpzb25WYWx1ZSh7aW5kZW50OiBgJHtpbmRlbnR9ICBgLCB2YWx1ZTogZW50cnl9KX0sXFxuYFxuICAgICAgfVxuXG4gICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fV1gXG5cbiAgICAgIHJldHVybiBvdXRwdXRcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBsZXQgb3V0cHV0ID0gXCJ7XFxuXCJcblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModmFsdWUpKSB7XG4gICAgICAgIG91dHB1dCArPSBgJHtpbmRlbnR9ICAke3RoaXMuZm9ybWF0dGVkT2JqZWN0S2V5KGtleSl9OiAke3RoaXMuZm9ybWF0dGVkSnNvblZhbHVlKHtpbmRlbnQ6IGAke2luZGVudH0gIGAsIHZhbHVlOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAodmFsdWUpW2tleV19KX0sXFxuYFxuICAgICAgfVxuXG4gICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fX1gXG5cbiAgICAgIHJldHVybiBvdXRwdXRcbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JtYXR0ZWQgb2JqZWN0IGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE9iamVjdCBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSmF2YVNjcmlwdCBvYmplY3Qga2V5LlxuICAgKi9cbiAgZm9ybWF0dGVkT2JqZWN0S2V5KGtleSkge1xuICAgIHJldHVybiAvXltBLVphLXpfJF1bXFx3JF0qJC8udGVzdChrZXkpID8ga2V5IDogSlNPTi5zdHJpbmdpZnkoa2V5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0cmlidXRlIGRlZmluaXRpb25zIGZvciBtb2RlbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MubW9kZWxDb25maWcgLSBNb2RlbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gW2FyZ3MucmVzb3VyY2VDbGFzc10gLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2pzRG9jVHlwZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcsIHdyaXRlSnNEb2NUeXBlOiBzdHJpbmd9Pj59IC0gQXR0cmlidXRlIGRlZmluaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgYXR0cmlidXRlRGVmaW5pdGlvbnNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBsZXQgYXR0cmlidXRlcyA9IG1vZGVsQ29uZmlnLmF0dHJpYnV0ZXNcblxuICAgIC8vIEF1dG8tZGVyaXZlIGF0dHJpYnV0ZXMgZnJvbSBtb2RlbCBjb2x1bW5zIHdoZW4gbm90IGV4cGxpY2l0bHkgZGVmaW5lZFxuICAgIGlmICgoIWF0dHJpYnV0ZXMgfHwgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykgJiYgYXR0cmlidXRlcy5sZW5ndGggPT09IDApKSAmJiBtb2RlbENsYXNzKSB7XG4gICAgICBjb25zdCBjb2x1bW5zID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5zKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY29sdW1ucykpIHtcbiAgICAgICAgYXR0cmlidXRlcyA9IGNvbHVtbnMubWFwKChjb2x1bW4pID0+IGluZmxlY3Rpb24uY2FtZWxpemUoY29sdW1uLmdldE5hbWUoKSwgdHJ1ZSkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZURlZmluaXRpb25zID0gW11cblxuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVEZWZpbml0aW9uIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgLyoqIEB0eXBlIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGx9ICovXG4gICAgICAgIGxldCBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnID0gbnVsbFxuICAgICAgICBsZXQgYXR0cmlidXRlTmFtZVxuXG4gICAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlRGVmaW5pdGlvbiA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgYXR0cmlidXRlTmFtZSA9IGF0dHJpYnV0ZURlZmluaXRpb25cbiAgICAgICAgfSBlbHNlIGlmIChhdHRyaWJ1dGVEZWZpbml0aW9uICYmIHR5cGVvZiBhdHRyaWJ1dGVEZWZpbml0aW9uID09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoYXR0cmlidXRlRGVmaW5pdGlvbikpIHtcbiAgICAgICAgICBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnID0gLyoqIEB0eXBlIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30gKi8gKGF0dHJpYnV0ZURlZmluaXRpb24pXG4gICAgICAgICAgYXR0cmlidXRlTmFtZSA9IGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcubmFtZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVOYW1lICE9IFwic3RyaW5nXCIgfHwgYXR0cmlidXRlTmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgYXJyYXkgZW50cmllcyB0byBiZSBzdHJpbmdzIG9yIG9iamVjdHMgd2l0aCBhIG5hbWUsIGdvdDogJHtKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGVEZWZpbml0aW9uKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXR0cmlidXRlQ29uZmlnID0gYXdhaXQgdGhpcy5yZXNvbHZlZEZyb250ZW5kQXR0cmlidXRlQ29uZmlnKHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnLFxuICAgICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgICAgcmVzb3VyY2VDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnN0IGZyb250ZW5kQXR0cmlidXRlQ29uZmlnID0gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckdlbmVyYXRlZEF0dHJpYnV0ZSh7XG4gICAgICAgICAgYXR0cmlidXRlQ29uZmlnLFxuICAgICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgbW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF0dHJpYnV0ZURlZmluaXRpb25zLnB1c2goe1xuICAgICAgICAgIGpzRG9jVHlwZTogdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZEF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnOiBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30pLFxuICAgICAgICAgIG5hbWU6IGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgd3JpdGVKc0RvY1R5cGU6IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnOiBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30pXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVEZWZpbml0aW9uc1xuICAgIH1cblxuICAgIGlmICghYXR0cmlidXRlcyB8fCB0eXBlb2YgYXR0cmlidXRlcyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAnYXR0cmlidXRlcycgYXMgYXJyYXkgb3Igb2JqZWN0IGJ1dCBnb3Q6ICR7YXR0cmlidXRlc31gKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dHJpYnV0ZURlZmluaXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgYXR0cmlidXRlQ29uZmlnID0gYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgICAgY29uc3QgY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZyA9IGF0dHJpYnV0ZUNvbmZpZyAmJiB0eXBlb2YgYXR0cmlidXRlQ29uZmlnID09PSBcIm9iamVjdFwiXG4gICAgICAgID8gLyoqIEB0eXBlIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30gKi8gKGF0dHJpYnV0ZUNvbmZpZylcbiAgICAgICAgOiBudWxsXG4gICAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlQ29uZmlnID0gYXdhaXQgdGhpcy5yZXNvbHZlZEZyb250ZW5kQXR0cmlidXRlQ29uZmlnKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZSxcbiAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnLFxuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICByZXNvdXJjZUNsYXNzXG4gICAgICB9KVxuICAgICAgY29uc3QgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgPSB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yR2VuZXJhdGVkQXR0cmlidXRlKHtcbiAgICAgICAgYXR0cmlidXRlQ29uZmlnOiBub3JtYWxpemVkQXR0cmlidXRlQ29uZmlnLFxuICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICBtb2RlbENsYXNzXG4gICAgICB9KVxuXG4gICAgICBhdHRyaWJ1dGVEZWZpbml0aW9ucy5wdXNoKHtcbiAgICAgICAganNEb2NUeXBlOiB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWc6IGZyb250ZW5kQXR0cmlidXRlQ29uZmlnfSksXG4gICAgICAgIG5hbWU6IGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIHdyaXRlSnNEb2NUeXBlOiB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kV3JpdGVBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZzogZnJvbnRlbmRBdHRyaWJ1dGVDb25maWd9KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlRGVmaW5pdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIGdlbmVyYXRlZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZUNvbmZpZzogRnJvbnRlbmRBdHRyaWJ1dGVDb25maWcsIGF0dHJpYnV0ZU5hbWU6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnfSAtIEF0dHJpYnV0ZSBjb25maWcgdXNlZCBmb3IgZ2VuZXJhdGVkIEpTRG9jLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JHZW5lcmF0ZWRBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZywgYXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIXRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVJc01vZGVsUHJpbWFyeUtleSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pKSByZXR1cm4gYXR0cmlidXRlQ29uZmlnXG4gICAgaWYgKHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdIYXNOdWxsYWJpbGl0eShhdHRyaWJ1dGVDb25maWcpKSByZXR1cm4gYXR0cmlidXRlQ29uZmlnXG5cbiAgICByZXR1cm4gey4uLmF0dHJpYnV0ZUNvbmZpZywgbnVsbDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgaXMgbW9kZWwgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGlzIHRoZSBtb2RlbCBwcmltYXJ5IGtleS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlSXNNb2RlbFByaW1hcnlLZXkoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFtb2RlbENsYXNzKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXldKSB7XG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gY29sdW1uTmFtZSkgcmV0dXJuIHRydWVcbiAgICAgIGlmIChtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGNvbHVtbk5hbWUpID09PSBhdHRyaWJ1dGVOYW1lKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBwcmltYXJ5IGtleSBmcm9tIGV4cGxpY2l0IHJlc291cmNlIGNvbmZpZyBvciB0aGUgYmFja2VuZCBtb2RlbC5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZXM6IEFycmF5PHN0cmluZz4sIG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgbW9kZWxDb25maWc6IGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259fSBhcmdzIC0gUHJpbWFyeSBrZXkgcmVzb2x1dGlvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nPn0gLSBGcm9udGVuZC1tb2RlbCBwcmltYXJ5IGtleSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5Rm9yUmVzb3VyY2Uoe2F0dHJpYnV0ZU5hbWVzLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZ30pIHtcbiAgICBpZiAobW9kZWxDb25maWcucHJpbWFyeUtleSkge1xuICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdGVkQ29uZmlndXJlZFByaW1hcnlLZXkoe2F0dHJpYnV0ZU5hbWVzLCBwcmltYXJ5S2V5OiBtb2RlbENvbmZpZy5wcmltYXJ5S2V5fSlcbiAgICB9XG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHJldHVybiBcImlkXCJcblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5Rm9yTW9kZWxDbGFzcyh7YXR0cmlidXRlTmFtZXMsIG1vZGVsQ2xhc3N9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZ2VuZXJhdGVkIG1vZGVsJ3MgY29uY3JldGUgcHJpbWFyeS1rZXkgdmFsdWUgdHlwZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlc1R5cGVOYW1lOiBzdHJpbmcsIHByaW1hcnlLZXk6IHN0cmluZyB8IHN0cmluZ1tdfX0gYXJncyAtIFByaW1hcnkta2V5IHR5cGUgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEpTRG9jIHR5cGUgZXhwcmVzc2lvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5VmFsdWVUeXBlKHthdHRyaWJ1dGVzVHlwZU5hbWUsIHByaW1hcnlLZXl9KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gcHJpbWFyeUtleS5tYXAoKGF0dHJpYnV0ZU5hbWUpID0+IEpTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZU5hbWUpKS5qb2luKFwiIHwgXCIpXG5cbiAgICAgIHJldHVybiBgUGljazwke2F0dHJpYnV0ZXNUeXBlTmFtZX0sICR7YXR0cmlidXRlTmFtZXN9PmBcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7YXR0cmlidXRlc1R5cGVOYW1lfVske0pTT04uc3RyaW5naWZ5KHByaW1hcnlLZXkpfV1gXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGFuIGV4cGxpY2l0bHkgY29uZmlndXJlZCBmcm9udGVuZC1tb2RlbCBwcmltYXJ5IGtleS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZXM6IEFycmF5PHN0cmluZz4sIHByaW1hcnlLZXk6IHN0cmluZyB8IHN0cmluZ1tdfX0gYXJncyAtIENvbmZpZ3VyZWQgcHJpbWFyeSBrZXkgYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHN0cmluZ1tdfSAtIENvbmZpZ3VyZWQgcHJpbWFyeSBrZXkuXG4gICAqL1xuICB2YWxpZGF0ZWRDb25maWd1cmVkUHJpbWFyeUtleSh7YXR0cmlidXRlTmFtZXMsIHByaW1hcnlLZXl9KSB7XG4gICAgY29uc3QgcHJpbWFyeUtleUF0dHJpYnV0ZXMgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleSA6IFtwcmltYXJ5S2V5XVxuXG4gICAgaWYgKHByaW1hcnlLZXlBdHRyaWJ1dGVzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgY29tcG9zaXRlIHByaW1hcnkga2V5IG11c3QgY29udGFpbiBhdCBsZWFzdCBvbmUgYXR0cmlidXRlLlwiKVxuICAgIH1cblxuICAgIGlmIChuZXcgU2V0KHByaW1hcnlLZXlBdHRyaWJ1dGVzKS5zaXplICE9PSBwcmltYXJ5S2V5QXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgY29tcG9zaXRlIHByaW1hcnkga2V5IGF0dHJpYnV0ZXMgbXVzdCBiZSB1bmlxdWUuXCIpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHByaW1hcnlLZXlBdHRyaWJ1dGVzKSB7XG4gICAgICBpZiAoIWF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBwcmltYXJ5IGtleSBcIiR7YXR0cmlidXRlTmFtZX1cIiBpcyBub3QgYSBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlLmApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYmFja2VuZCBwcmltYXJ5IGtleSB0byBnZW5lcmF0ZWQgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlIG5hbWVzLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lczogQXJyYXk8c3RyaW5nPiwgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIFByaW1hcnkga2V5IHJlc29sdXRpb24gYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IEFycmF5PHN0cmluZz59IC0gRnJvbnRlbmQtbW9kZWwgcHJpbWFyeSBrZXkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUHJpbWFyeUtleUZvck1vZGVsQ2xhc3Moe2F0dHJpYnV0ZU5hbWVzLCBtb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgaWYgKHByaW1hcnlLZXkgPT09IFwiaWRcIikgcmV0dXJuIFwiaWRcIlxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIHJldHVybiBwcmltYXJ5S2V5Lm1hcCgoY29sdW1uTmFtZSkgPT4gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleUF0dHJpYnV0ZU5hbWUoe2F0dHJpYnV0ZU5hbWVzLCBjb2x1bW5OYW1lLCBtb2RlbENsYXNzfSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlBdHRyaWJ1dGVOYW1lKHthdHRyaWJ1dGVOYW1lcywgY29sdW1uTmFtZTogcHJpbWFyeUtleSwgbW9kZWxDbGFzc30pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb25lIGJhY2tlbmQgcHJpbWFyeSBrZXkgY29sdW1uIHRvIGEgZ2VuZXJhdGVkIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lczogQXJyYXk8c3RyaW5nPiwgY29sdW1uTmFtZTogc3RyaW5nLCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gUHJpbWFyeSBrZXkgYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGcm9udGVuZC1tb2RlbCBwcmltYXJ5IGtleSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5QXR0cmlidXRlTmFtZSh7YXR0cmlidXRlTmFtZXMsIGNvbHVtbk5hbWUsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKGF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKGNvbHVtbk5hbWUpKSByZXR1cm4gY29sdW1uTmFtZVxuXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoY29sdW1uTmFtZSlcblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lICYmIGF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICByZXR1cm4gYXR0cmlidXRlTmFtZVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbENsYXNzLm5hbWV9LnByaW1hcnlLZXkoKSBjb2x1bW4gXCIke2NvbHVtbk5hbWV9XCIgZG9lcyBub3QgcmVzb2x2ZSB0byBhIGdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGZyb20gZXhwbGljaXQgbWV0YWRhdGEsIHJlc291cmNlIG1ldGhvZHMsIG1vZGVsIGNvbHVtbnMsIHRyYW5zbGF0ZWQgY29sdW1ucywgb3IgbW9kZWwgYWNjZXNzb3IgSlNEb2MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gRnJvbnRlbmQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsfSBhcmdzLmNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcgLSBSZXNvdXJjZS1wcm92aWRlZCBhdHRyaWJ1dGUgY29uZmlnLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MucmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZz59IC0gUmVzb2x2ZWQgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZy5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVkRnJvbnRlbmRBdHRyaWJ1dGVDb25maWcoe2F0dHJpYnV0ZU5hbWUsIGNsYXNzTmFtZSwgY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZywgbW9kZWxDbGFzcywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBjb25zdCBpbmZlcnJlZFJlc291cmNlQ29uZmlnID0gYXdhaXQgdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvclJlc291cmNlQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lLCByZXNvdXJjZUNsYXNzfSlcbiAgICBjb25zdCBpbmZlcnJlZENvbHVtbkNvbmZpZyA9IGluZmVycmVkUmVzb3VyY2VDb25maWdcbiAgICAgID8gbnVsbFxuICAgICAgOiB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yTW9kZWxBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KVxuICAgIGNvbnN0IGluZmVycmVkVHJhbnNsYXRlZENvbmZpZyA9IGluZmVycmVkUmVzb3VyY2VDb25maWcgfHwgaW5mZXJyZWRDb2x1bW5Db25maWdcbiAgICAgID8gbnVsbFxuICAgICAgOiB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yVHJhbnNsYXRlZEF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgcmVzb3VyY2VDbGFzc30pXG4gICAgY29uc3QgaW5mZXJyZWRNb2RlbEFjY2Vzc29yQ29uZmlnID0gaW5mZXJyZWRSZXNvdXJjZUNvbmZpZyB8fCBpbmZlcnJlZENvbHVtbkNvbmZpZyB8fCBpbmZlcnJlZFRyYW5zbGF0ZWRDb25maWdcbiAgICAgID8gbnVsbFxuICAgICAgOiBhd2FpdCB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yTW9kZWxBY2Nlc3Nvcih7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pXG4gICAgY29uc3QgaW5mZXJyZWRDb25maWcgPSBpbmZlcnJlZFJlc291cmNlQ29uZmlnIHx8IGluZmVycmVkQ29sdW1uQ29uZmlnIHx8IGluZmVycmVkVHJhbnNsYXRlZENvbmZpZyB8fCBpbmZlcnJlZE1vZGVsQWNjZXNzb3JDb25maWdcblxuICAgIGlmIChjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnICYmIHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdIYXNUeXBlKGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcpKSB7XG4gICAgICByZXR1cm4gaW5mZXJyZWRDb25maWdcbiAgICAgICAgPyB7Li4uaW5mZXJyZWRDb25maWcsIC4uLmNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWd9XG4gICAgICAgIDogY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZ1xuICAgIH1cblxuICAgIGlmIChpbmZlcnJlZENvbmZpZykge1xuICAgICAgcmV0dXJuIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWdcbiAgICAgICAgPyB7Li4uaW5mZXJyZWRDb25maWcsIC4uLmNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWd9XG4gICAgICAgIDogaW5mZXJyZWRDb25maWdcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBpbmZlciBKU0RvYyB0eXBlIGZvciBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgJyR7Y2xhc3NOYW1lfSMke2F0dHJpYnV0ZU5hbWV9Jy4gQWRkIGEgYmFja2VuZCBtb2RlbCBjb2x1bW4sIHRyYW5zbGF0aW9uIHRhYmxlIGNvbHVtbiwgZXhwbGljaXQgcmVzb3VyY2UgbWV0YWRhdGEsIG9yIGEgQHJldHVybnMgSlNEb2MgdHlwZSBvbiAke3Jlc291cmNlQ2xhc3M/Lm5hbWUgfHwgXCJ0aGUgcmVzb3VyY2VcIn0uJHthdHRyaWJ1dGVOYW1lfUF0dHJpYnV0ZSgpLmApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGhhcyB0eXBlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29uZmlnIGRlY2xhcmVzIGEgdHlwZSBzb3VyY2UuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0hhc1R5cGUoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGlzLmZyb250ZW5kQXR0cmlidXRlVHlwZVZhbHVlKGF0dHJpYnV0ZUNvbmZpZykgPT0gXCJzdHJpbmdcIlxuICAgICAgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZz8uanNEb2NUeXBlID09IFwic3RyaW5nXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgaGFzIG51bGxhYmlsaXR5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29uZmlnIGRlY2xhcmVzIG51bGxhYmlsaXR5LlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdIYXNOdWxsYWJpbGl0eShhdHRyaWJ1dGVDb25maWcpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZUNvbmZpZyB8fCB0eXBlb2YgYXR0cmlidXRlQ29uZmlnICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGF0dHJpYnV0ZUNvbmZpZywgXCJudWxsXCIpKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIHR5cGVvZiBhdHRyaWJ1dGVDb25maWcuZ2V0TnVsbCA9PSBcImZ1bmN0aW9uXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpzIGRvYyB0eXBlIGZvciBmcm9udGVuZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5hdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBKU0RvYyB0eXBlLlxuICAgKi9cbiAganNEb2NUeXBlRm9yRnJvbnRlbmRBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZ30pIHtcbiAgICBpZiAoYXR0cmlidXRlQ29uZmlnICYmIHR5cGVvZiBhdHRyaWJ1dGVDb25maWcuanNEb2NUeXBlID09IFwic3RyaW5nXCIgJiYgYXR0cmlidXRlQ29uZmlnLmpzRG9jVHlwZS5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gYXR0cmlidXRlQ29uZmlnLmpzRG9jVHlwZVxuICAgIH1cblxuICAgIGNvbnN0IGpzRG9jVHlwZSA9IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRBdHRyaWJ1dGVCYXNlVHlwZShhdHRyaWJ1dGVDb25maWcpXG5cbiAgICBpZiAoIXRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDYW5CZU51bGwoYXR0cmlidXRlQ29uZmlnKSkge1xuICAgICAgcmV0dXJuIGpzRG9jVHlwZVxuICAgIH1cblxuICAgIHJldHVybiBgJHtqc0RvY1R5cGV9IHwgbnVsbGBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpzIGRvYyB0eXBlIGZvciBmcm9udGVuZCB3cml0ZSBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5hdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBKU0RvYyB0eXBlIGFjY2VwdGVkIGJ5IGNyZWF0ZS91cGRhdGUgcGF5bG9hZHMuXG4gICAqL1xuICBqc0RvY1R5cGVGb3JGcm9udGVuZFdyaXRlQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWd9KSB7XG4gICAgaWYgKGF0dHJpYnV0ZUNvbmZpZyAmJiB0eXBlb2YgYXR0cmlidXRlQ29uZmlnLmpzRG9jVHlwZSA9PSBcInN0cmluZ1wiICYmIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGUubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGVcbiAgICB9XG5cbiAgICBjb25zdCBqc0RvY1R5cGUgPSB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kV3JpdGVBdHRyaWJ1dGVCYXNlVHlwZShhdHRyaWJ1dGVDb25maWcpXG5cbiAgICBpZiAoIXRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDYW5CZU51bGwoYXR0cmlidXRlQ29uZmlnKSkge1xuICAgICAgcmV0dXJuIGpzRG9jVHlwZVxuICAgIH1cblxuICAgIHJldHVybiBgJHtqc0RvY1R5cGV9IHwgbnVsbGBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpzIGRvYyB0eXBlIGZvciBmcm9udGVuZCB3cml0ZSBhdHRyaWJ1dGUgYmFzZSB0eXBlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9uLW51bGxhYmxlIEpTRG9jIHR5cGUgYWNjZXB0ZWQgYnkgY3JlYXRlL3VwZGF0ZSBwYXlsb2Fkcy5cbiAgICovXG4gIGpzRG9jVHlwZUZvckZyb250ZW5kV3JpdGVBdHRyaWJ1dGVCYXNlVHlwZShhdHRyaWJ1dGVDb25maWcpIHtcbiAgICBjb25zdCByZWFkVHlwZSA9IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRBdHRyaWJ1dGVCYXNlVHlwZShhdHRyaWJ1dGVDb25maWcpXG5cbiAgICBpZiAoIXRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVUeXBlSXNUZW1wb3JhbChhdHRyaWJ1dGVDb25maWcpKSByZXR1cm4gcmVhZFR5cGVcblxuICAgIHJldHVybiBgJHtyZWFkVHlwZX0gfCBzdHJpbmdgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgdHlwZSBmb3IgZnJvbnRlbmQgYXR0cmlidXRlIGJhc2UgdHlwZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vbi1udWxsYWJsZSBKU0RvYyB0eXBlLlxuICAgKi9cbiAganNEb2NUeXBlRm9yRnJvbnRlbmRBdHRyaWJ1dGVCYXNlVHlwZShhdHRyaWJ1dGVDb25maWcpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZUNvbmZpZyB8fCB0eXBlb2YgYXR0cmlidXRlQ29uZmlnICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gXCJGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcIlxuICAgIH1cblxuICAgIGNvbnN0IHR5cGUgPSB0aGlzLmZyb250ZW5kQXR0cmlidXRlVHlwZVZhbHVlKGF0dHJpYnV0ZUNvbmZpZylcblxuICAgIGlmICh0eXBlID09IFwiYm9vbGVhblwiKSB7XG4gICAgICByZXR1cm4gXCJib29sZWFuXCJcbiAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJqc29uXCIgfHwgdHlwZSA9PSBcImpzb25iXCIpIHtcbiAgICAgIHJldHVybiBcIkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVwiXG4gICAgfSBlbHNlIGlmICh0eXBlICYmIFtcImJsb2JcIiwgXCJjaGFyXCIsIFwibnZhcmNoYXJcIiwgXCJ2YXJjaGFyXCIsIFwidGV4dFwiLCBcImxvbmd0ZXh0XCIsIFwibWVkaXVtdGV4dFwiLCBcInRpbnl0ZXh0XCIsIFwidXVpZFwiLCBcImNoYXJhY3RlciB2YXJ5aW5nXCJdLmluY2x1ZGVzKHR5cGUpKSB7XG4gICAgICByZXR1cm4gXCJzdHJpbmdcIlxuICAgIH0gZWxzZSBpZiAodHlwZSAmJiBbXCJiaXRcIiwgXCJiaWdpbnRcIiwgXCJkZWNpbWFsXCIsIFwiZG91YmxlXCIsIFwiZG91YmxlIHByZWNpc2lvblwiLCBcImZsb2F0XCIsIFwiaW50XCIsIFwiaW50ZWdlclwiLCBcIm51bWVyaWNcIiwgXCJyZWFsXCIsIFwic21hbGxpbnRcIiwgXCJ0aW55aW50XCJdLmluY2x1ZGVzKHR5cGUpKSB7XG4gICAgICByZXR1cm4gXCJudW1iZXJcIlxuICAgIH0gZWxzZSBpZiAodGhpcy5mcm9udGVuZEF0dHJpYnV0ZVR5cGVJc1RlbXBvcmFsKGF0dHJpYnV0ZUNvbmZpZykpIHtcbiAgICAgIHJldHVybiBcIkRhdGVcIlxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gXCJGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSB0eXBlIGlzIHRlbXBvcmFsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGF0dHJpYnV0ZSByZXByZXNlbnRzIGEgZGF0ZS90aW1lIHZhbHVlLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVUeXBlSXNUZW1wb3JhbChhdHRyaWJ1dGVDb25maWcpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZUNvbmZpZyB8fCB0eXBlb2YgYXR0cmlidXRlQ29uZmlnICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHR5cGUgPSB0aGlzLmZyb250ZW5kQXR0cmlidXRlVHlwZVZhbHVlKGF0dHJpYnV0ZUNvbmZpZylcblxuICAgIHJldHVybiB0eXBlID8gW1wiZGF0ZVwiLCBcImRhdGV0aW1lXCIsIFwidGltZXN0YW1wXCIsIFwidGltZXN0YW1wIHdpdGhvdXQgdGltZSB6b25lXCIsIFwidGltZXN0YW1wdHpcIl0uaW5jbHVkZXModHlwZSkgOiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNhbiBiZSBudWxsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBhbGxvd3MgbnVsbCB2YWx1ZXMuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNhbkJlTnVsbChhdHRyaWJ1dGVDb25maWcpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZUNvbmZpZyB8fCB0eXBlb2YgYXR0cmlidXRlQ29uZmlnICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5nZXROdWxsID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGF0dHJpYnV0ZUNvbmZpZy5nZXROdWxsKCkgPT09IHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlQ29uZmlnLm51bGwgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSB0eXBlIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIE5vcm1hbGl6ZWQgY29sdW1uIHR5cGUuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZVR5cGVWYWx1ZShhdHRyaWJ1dGVDb25maWcpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZUNvbmZpZyB8fCB0eXBlb2YgYXR0cmlidXRlQ29uZmlnICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYXR0cmlidXRlQ29uZmlnLmdldFR5cGUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gU3RyaW5nKGF0dHJpYnV0ZUNvbmZpZy5nZXRUeXBlKCkpXG4gICAgfVxuXG4gICAgY29uc3QgdHlwZVZhbHVlID0gYXR0cmlidXRlQ29uZmlnLnR5cGUgfHwgYXR0cmlidXRlQ29uZmlnLmNvbHVtblR5cGUgfHwgYXR0cmlidXRlQ29uZmlnLnNxbFR5cGUgfHwgYXR0cmlidXRlQ29uZmlnLmRhdGFUeXBlXG5cbiAgICBpZiAodHlwZW9mIHR5cGVWYWx1ZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICByZXR1cm4gdHlwZVZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGZvciByZXNvdXJjZSBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsPn0gLSBBdHRyaWJ1dGUgY29uZmlnIGluZmVycmVkIGZyb20gcmVzb3VyY2UgbWV0aG9kIEpTRG9jLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JSZXNvdXJjZUF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZSwgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBtZXRob2ROYW1lID0gYCR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGVgXG4gICAgY29uc3Qgb3duZXJDbGFzc05hbWUgPSB0aGlzLm1ldGhvZE93bmVyQ2xhc3NOYW1lKHttZXRob2ROYW1lLCB0YXJnZXRDbGFzczogcmVzb3VyY2VDbGFzc30pXG5cbiAgICBpZiAoIW93bmVyQ2xhc3NOYW1lKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QganNEb2NUeXBlID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFJldHVyblR5cGUoe1xuICAgICAgbWV0aG9kTmFtZSxcbiAgICAgIHNvdXJjZUNsYXNzTmFtZTogb3duZXJDbGFzc05hbWVcbiAgICB9KVxuXG4gICAgcmV0dXJuIGpzRG9jVHlwZSA/IHtqc0RvY1R5cGU6IHRoaXMudW53cmFwcGVkUHJvbWlzZUpzRG9jVHlwZSh7anNEb2NUeXBlfSl9IDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgdHJhbnNsYXRlZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5yZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGx9IC0gQXR0cmlidXRlIGNvbmZpZyBpbmZlcnJlZCBmcm9tIHRyYW5zbGF0ZWQgYXR0cmlidXRlIGNvbHVtbnMuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvclRyYW5zbGF0ZWRBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgaWYgKCFtb2RlbENsYXNzKSByZXR1cm4gbnVsbFxuICAgIGlmICghdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUlzVHJhbnNsYXRlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgcmVzb3VyY2VDbGFzc30pKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgVHJhbnNsYXRpb25DbGFzcyA9IG1vZGVsQ2xhc3MuZ2V0VHJhbnNsYXRpb25DbGFzcygpXG4gICAgY29uc3QgY29sdW1uTmFtZSA9IGluZmxlY3Rpb24udW5kZXJzY29yZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgbGV0IGNvbHVtblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbHVtbiA9IFRyYW5zbGF0aW9uQ2xhc3MuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiAoZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhcImhhc24ndCBiZWVuIGluaXRpYWxpemVkIHlldFwiKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKFwidXNlZCBiZWZvcmUgaW5pdGlhbGl6YXRpb25cIikpKSByZXR1cm4gbnVsbFxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiBjb2x1bW4gPyB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yQ29sdW1uKHtjb2x1bW59KSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBpcyB0cmFuc2xhdGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MucmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBmcm9udGVuZCBhdHRyaWJ1dGUgaXMgdHJhbnNsYXRlZC5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlSXNUcmFuc2xhdGVkKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGlmIChyZXNvdXJjZUNsYXNzKSB7XG4gICAgICBjb25zdCB0cmFuc2xhdGVkQXR0cmlidXRlcyA9IHJlc291cmNlQ2xhc3MudHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh0cmFuc2xhdGVkQXR0cmlidXRlcykgJiYgdHJhbnNsYXRlZEF0dHJpYnV0ZXMuaW5jbHVkZXMoYXR0cmlidXRlTmFtZSkpIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgY29uc3QgdHJhbnNsYXRpb25zID0gbW9kZWxDbGFzcy5fdHJhbnNsYXRpb25zXG5cbiAgICByZXR1cm4gQm9vbGVhbih0cmFuc2xhdGlvbnMgJiYgdHlwZW9mIHRyYW5zbGF0aW9ucyA9PSBcIm9iamVjdFwiICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0cmFuc2xhdGlvbnMsIGF0dHJpYnV0ZU5hbWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgbW9kZWwgYWNjZXNzb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGw+fSAtIEF0dHJpYnV0ZSBjb25maWcgaW5mZXJyZWQgZnJvbSBtb2RlbCBhY2Nlc3NvciBKU0RvYy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yTW9kZWxBY2Nlc3Nvcih7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBvd25lckNsYXNzTmFtZSA9IHRoaXMubWV0aG9kT3duZXJDbGFzc05hbWUoe21ldGhvZE5hbWU6IGF0dHJpYnV0ZU5hbWUsIHRhcmdldENsYXNzOiBtb2RlbENsYXNzfSlcblxuICAgIGlmICghb3duZXJDbGFzc05hbWUpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBqc0RvY1R5cGUgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUmV0dXJuVHlwZSh7XG4gICAgICBtZXRob2ROYW1lOiBhdHRyaWJ1dGVOYW1lLFxuICAgICAgc291cmNlQ2xhc3NOYW1lOiBvd25lckNsYXNzTmFtZVxuICAgIH0pXG5cbiAgICAvLyBGcm9udGVuZCBhdHRyaWJ1dGVzIGhvbGQgdGhlIHNlcmlhbGl6ZWQgKHJlc29sdmVkKSB2YWx1ZSwgc28gYW4gYXN5bmNcbiAgICAvLyBiYWNrZW5kIGFjY2Vzc29yIHR5cGVkIGBQcm9taXNlPG51bWJlcj5gIG11c3Qgc3VyZmFjZSBhcyBgbnVtYmVyYCDigJQgdGhlXG4gICAgLy8gc2FtZSB1bndyYXBwaW5nIHRoZSByZXNvdXJjZS1tZXRob2QgaW5mZXJlbmNlIHBhdGggYXBwbGllcy5cbiAgICByZXR1cm4ganNEb2NUeXBlXG4gICAgICA/IHtqc0RvY1R5cGU6IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlQXR0cmlidXRlSnNEb2NUeXBlKHRoaXMudW53cmFwcGVkUHJvbWlzZUpzRG9jVHlwZSh7anNEb2NUeXBlfSkpfVxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogQSBiYWNrZW5kIGFjY2Vzc29yJ3MgYEByZXR1cm5zYCBjYW4gcmVmZXJlbmNlIHR5cGVzIHRoYXQgZXhpc3Qgb25seSBvbiB0aGVcbiAgICogYmFja2VuZCAoZS5nLiBhIG1vZGVsLWxvY2FsIGBAdHlwZWRlZiBBZ2VudFJ1blBsYW5uaW5nQXJ0aWZhY3RgKS4gVGhlIGZyb250ZW5kXG4gICAqIG1vZGVsIGNhbid0IHJlc29sdmUgdGhvc2UsIHNvIGZhbGwgYmFjayB0byBgYW55YCByYXRoZXIgdGhhbiBlbWl0dGluZyBhblxuICAgKiB1bmRlZmluZWQgdHlwZSBuYW1lLiBUeXBlcyBidWlsdCBvbmx5IGZyb20gcHJpbWl0aXZlcyBhbmQga25vd24gZ2VuZXJpY1xuICAgKiBidWlsdGlucyBwYXNzIHRocm91Z2ggdW5jaGFuZ2VkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ganNEb2NUeXBlIC0gUmVzb2x2ZWQgKFByb21pc2UtdW53cmFwcGVkKSBhdHRyaWJ1dGUgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBIGZyb250ZW5kLXJlc29sdmFibGUgYXR0cmlidXRlIHR5cGUuXG4gICAqL1xuICBmcm9udGVuZFJlc29sdmFibGVBdHRyaWJ1dGVKc0RvY1R5cGUoanNEb2NUeXBlKSB7XG4gICAgY29uc3Qgc2FmZVR5cGVJZGVudGlmaWVycyA9IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlVHlwZUlkZW50aWZpZXJzKClcbiAgICBjb25zdCByZWZlcmVuY2VkSWRlbnRpZmllcnMgPSBqc0RvY1R5cGUubWF0Y2goL1tBLVpdW0EtWmEtejAtOV8kXSovZykgfHwgW11cblxuICAgIGlmIChyZWZlcmVuY2VkSWRlbnRpZmllcnMuc29tZSgoaWRlbnRpZmllcikgPT4gIXNhZmVUeXBlSWRlbnRpZmllcnMuaGFzKGlkZW50aWZpZXIpKSkge1xuICAgICAgcmV0dXJuIFwiYW55XCJcbiAgICB9XG5cbiAgICByZXR1cm4ganNEb2NUeXBlXG4gIH1cblxuICAvKipcbiAgICogQ2FwaXRhbGl6ZWQgaWRlbnRpZmllcnMgYSBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgY2FuIHJlc29sdmUgb24gaXRzIG93blxuICAgKiAocHJpbWl0aXZlcyBhcmUgbG93ZXItY2FzZSBhbmQgbWF0Y2hlZCBzZXBhcmF0ZWx5KSwgc28gb25seSBmcmFtZXdvcmstb3duZWRcbiAgICogYW5kIGJ1aWx0aW4gZ2VuZXJpYyB0eXBlcyBhcmUgbGlzdGVkLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRnJvbnRlbmQtcmVzb2x2YWJsZSB0eXBlIGlkZW50aWZpZXJzLlxuICAgKi9cbiAgZnJvbnRlbmRSZXNvbHZhYmxlVHlwZUlkZW50aWZpZXJzKCkge1xuICAgIHJldHVybiBuZXcgU2V0KFtcbiAgICAgIFwiQXJyYXlcIiwgXCJEYXRlXCIsIFwiRXhjbHVkZVwiLCBcIkV4dHJhY3RcIiwgXCJGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcIiwgXCJGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcIixcbiAgICAgIFwiTWFwXCIsIFwiTm9uTnVsbGFibGVcIiwgXCJPbWl0XCIsIFwiUGFydGlhbFwiLCBcIlBpY2tcIiwgXCJQcm9taXNlXCIsIFwiUmVhZG9ubHlcIiwgXCJSZWFkb25seUFycmF5XCIsIFwiUmVjb3JkXCIsXG4gICAgICBcIlJlcXVpcmVkXCIsIFwiUmV0dXJuVHlwZVwiLCBcIlNldFwiXG4gICAgXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXdyaXRlcyBhIGN1c3RvbS1jb21tYW5kIHBhcmFtL3JldHVybiBKU0RvYyB0eXBlIHNvIGl0IHJlc29sdmVzIGluIHRoZSBnZW5lcmF0ZWRcbiAgICogZnJvbnRlbmQgbW9kZWw6IGJhY2tlbmQgbW9kZWwgaW1wb3J0cyBhcmUgbWFwcGVkIHRvIGdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbFxuICAgKiBpbXBvcnRzLCBhbmQgb3RoZXJ3aXNlIG5vbi1mcm9udGVuZC1yZXNvbHZhYmxlIGlkZW50aWZpZXJzIGJlY29tZSBgYW55YCBpbiBwbGFjZVxuICAgKiBzbyBzaWJsaW5nIHNjYWxhciBmaWVsZHMga2VlcCB0aGVpciByZWFsIHR5cGVzLiBUaGUgd29yZCBib3VuZGFyeSBhdm9pZHMgbWF0Y2hpbmdcbiAgICogdGhlIGNhcGl0YWxpemVkIG1pZGRsZSBvZiBhIGNhbWVsQ2FzZSBwcm9wZXJ0eSBuYW1lIChlLmcuIGBhZGp1c3RlZFRvdGFsQ2VudHNgKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5mcm9udGVuZE1vZGVsRmlsZVBhdGggLSBHZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge01hcDxzdHJpbmcsIFJlc291cmNlSnNEb2NJbXBvcnRBbGlhcz59IGFyZ3MuaW1wb3J0QWxpYXNlcyAtIEltcG9ydCBhbGlhc2VzIHZpc2libGUgdG8gdGhlIHNvdXJjZSBtZXRob2QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpzRG9jVHlwZSAtIFJlc29sdmVkIChQcm9taXNlLXVud3JhcHBlZCkgSlNEb2MgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLnNvdXJjZUZpbGUgLSBTb3VyY2UgZmlsZSB0aGF0IGRlY2xhcmVkIHRoZSBtZXRob2QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQSBmcm9udGVuZC1yZXNvbHZhYmxlIEpTRG9jIHR5cGUuXG4gICAqL1xuICBmcm9udGVuZFJlc29sdmFibGVDb21tYW5kSnNEb2NUeXBlKHtmcm9udGVuZE1vZGVsRmlsZVBhdGgsIGltcG9ydEFsaWFzZXMsIGpzRG9jVHlwZSwgc291cmNlRmlsZX0pIHtcbiAgICBjb25zdCBzYWZlVHlwZUlkZW50aWZpZXJzID0gdGhpcy5mcm9udGVuZFJlc29sdmFibGVUeXBlSWRlbnRpZmllcnMoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgcHJlc2VydmVkSW1wb3J0cyA9IFtdXG4gICAgLyoqXG4gICAgICogU3RvcmVzIGFuIGltcG9ydCBleHByZXNzaW9uIGJlaGluZCBhIGxvd2VyY2FzZSBwbGFjZWhvbGRlciB3aGlsZSBnZW5lcmljXG4gICAgICogaWRlbnRpZmllciBjbGVhbnVwIHJ1bnMuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGltcG9ydEV4cHJlc3Npb24gLSBJbXBvcnQgZXhwcmVzc2lvbiB0byBwcmVzZXJ2ZS5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBQbGFjZWhvbGRlciBpbnNlcnRlZCBpbnRvIHRoZSB0eXBlIHN0cmluZy5cbiAgICAgKi9cbiAgICBjb25zdCBwcmVzZXJ2ZUltcG9ydEV4cHJlc3Npb24gPSAoaW1wb3J0RXhwcmVzc2lvbikgPT4ge1xuICAgICAgY29uc3QgcGxhY2Vob2xkZXIgPSBgX192ZWxvY2lvdXNfaW1wb3J0X3BsYWNlaG9sZGVyXyR7cHJlc2VydmVkSW1wb3J0cy5sZW5ndGh9X19gXG5cbiAgICAgIHByZXNlcnZlZEltcG9ydHMucHVzaChpbXBvcnRFeHByZXNzaW9uKVxuXG4gICAgICByZXR1cm4gcGxhY2Vob2xkZXJcbiAgICB9XG5cbiAgICB0aGlzLmFzc2VydE5vQmFja2VuZExvY2FsQ29tbWFuZFR5cGVFeHByZXNzaW9ucyhqc0RvY1R5cGUpXG5cbiAgICBjb25zdCB3aXRoUmV3cml0dGVuSW5saW5lSW1wb3J0cyA9IGpzRG9jVHlwZVxuICAgICAgLy8gQSB0eXBlIHRoYXQgcmVhY2hlcyBpbnRvIGEgYmFja2VuZCBzb3VyY2UgZmlsZSB2aWEgYGltcG9ydChcIi4uLlwiKWBcbiAgICAgIC8vIChvcHRpb25hbGx5IGAuTWVtYmVyYCBhbmQgYFtdYCkgaXMgZnJvbnRlbmQtcmVzb2x2YWJsZSBvbmx5IHdoZW4gaXRcbiAgICAgIC8vIHBvaW50cyBhdCBhIGdlbmVyYXRlZCBtb2RlbCBmaWxlOyBvdGhlciBiYWNrZW5kLWxvY2FsIGltcG9ydHMgY29sbGFwc2VcbiAgICAgIC8vIHRvIGBhbnlgIHNvIGhlbHBlci9zZXJ2aWNlIGltcGxlbWVudGF0aW9uIGRldGFpbHMgZG8gbm90IGxlYWsuXG4gICAgICAucmVwbGFjZSgvaW1wb3J0XFwoXFxzKltcIiddKFteXCInXSopW1wiJ11cXHMqXFwpKCg/OlxccypcXC5cXHMqW0EtWmEtel8kXVtcXHckXSopKikoKD86XFxzKlxcW1xccypcXF0pKikvZywgKF9tYXRjaCwgc3BlY2lmaWVyLCBtZW1iZXJDaGFpbiwgYXJyYXlTdWZmaXgpID0+IHtcbiAgICAgICAgY29uc3QgcmV3cml0dGVuU3BlY2lmaWVyID0gdGhpcy5mcm9udGVuZFJlc29sdmFibGVKc0RvY0ltcG9ydFNwZWNpZmllcih7XG4gICAgICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgICAgIHNvdXJjZUZpbGUsXG4gICAgICAgICAgc3BlY2lmaWVyXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKCFyZXdyaXR0ZW5TcGVjaWZpZXIpIHJldHVybiBcImFueVwiXG5cbiAgICAgICAgcmV0dXJuIHByZXNlcnZlSW1wb3J0RXhwcmVzc2lvbihgaW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkocmV3cml0dGVuU3BlY2lmaWVyKX0pJHttZW1iZXJDaGFpbi5yZXBsYWNlKC9cXHMrL2csIFwiXCIpfSR7YXJyYXlTdWZmaXgucmVwbGFjZSgvXFxzKy9nLCBcIlwiKX1gKVxuICAgICAgfSlcblxuICAgIGxldCB3aXRoUmV3cml0dGVuQWxpYXNlcyA9IHdpdGhSZXdyaXR0ZW5JbmxpbmVJbXBvcnRzXG5cbiAgICBmb3IgKGNvbnN0IFthbGlhc05hbWUsIGltcG9ydEFsaWFzXSBvZiBpbXBvcnRBbGlhc2VzKSB7XG4gICAgICBjb25zdCByZXdyaXR0ZW5TcGVjaWZpZXIgPSB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZUpzRG9jSW1wb3J0U3BlY2lmaWVyKHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgICBzb3VyY2VGaWxlLFxuICAgICAgICBzcGVjaWZpZXI6IGltcG9ydEFsaWFzLnNwZWNpZmllclxuICAgICAgfSlcblxuICAgICAgaWYgKCFyZXdyaXR0ZW5TcGVjaWZpZXIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGFsaWFzUmVnZXggPSBuZXcgUmVnRXhwKGBcXFxcYiR7dGhpcy5lc2NhcGVSZWdFeHAoYWxpYXNOYW1lKX1cXFxcYmAsIFwiZ1wiKVxuXG4gICAgICB3aXRoUmV3cml0dGVuQWxpYXNlcyA9IHdpdGhSZXdyaXR0ZW5BbGlhc2VzLnJlcGxhY2UoYWxpYXNSZWdleCwgcHJlc2VydmVJbXBvcnRFeHByZXNzaW9uKGBpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShyZXdyaXR0ZW5TcGVjaWZpZXIpfSkuJHtpbXBvcnRBbGlhcy5pbXBvcnRlZE5hbWV9YCkpXG4gICAgfVxuXG4gICAgY29uc3Qgc2FuaXRpemVkID0gd2l0aFJld3JpdHRlbkFsaWFzZXNcbiAgICAgIC8vIFJlbWFpbmluZyBjYXBpdGFsaXplZCBpZGVudGlmaWVycyBhcmUgbW9kZWwgY2xhc3NlcyBvciBvdGhlcndpc2Ugbm9uLXJlc29sdmFibGVcbiAgICAgIC8vIHR5cGVzOyBkb3duZ3JhZGUgZWFjaCBpbiBwbGFjZSBzbyBzaWJsaW5nIHNjYWxhciBmaWVsZHMga2VlcCB0aGVpciByZWFsIHR5cGVzLlxuICAgICAgLnJlcGxhY2UoL1xcYltBLVpdW0EtWmEtejAtOV8kXSovZywgKGlkZW50aWZpZXIpID0+IHNhZmVUeXBlSWRlbnRpZmllcnMuaGFzKGlkZW50aWZpZXIpID8gaWRlbnRpZmllciA6IFwiYW55XCIpXG5cbiAgICByZXR1cm4gcHJlc2VydmVkSW1wb3J0cy5yZWR1Y2UoXG4gICAgICAodHlwZSwgaW1wb3J0RXhwcmVzc2lvbiwgaW5kZXgpID0+IHR5cGUucmVwbGFjZUFsbChgX192ZWxvY2lvdXNfaW1wb3J0X3BsYWNlaG9sZGVyXyR7aW5kZXh9X19gLCBpbXBvcnRFeHByZXNzaW9uKSxcbiAgICAgIHNhbml0aXplZFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSYWlzZXMgd2hlbiBhIGNvbW1hbmQgSlNEb2MgdHlwZSByZWZlcmVuY2VzIGEgYmFja2VuZC1sb2NhbCBoZWxwZXIgZXhwcmVzc2lvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVHlwZSAtIENvbW1hbmQgSlNEb2MgdHlwZS5cbiAgICogQHJldHVybnMge3ZvaWR9IE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzc2VydE5vQmFja2VuZExvY2FsQ29tbWFuZFR5cGVFeHByZXNzaW9ucyhqc0RvY1R5cGUpIHtcbiAgICBjb25zdCBsb2NhbFJldHVyblR5cGVNYXRjaCA9IGpzRG9jVHlwZS5tYXRjaCgvXFxiKD86QXdhaXRlZFxccyo8XFxzKik/UmV0dXJuVHlwZVxccyo8XFxzKnR5cGVvZlxccytbQS1aYS16XyRdW1xcdyRdKlxccyo+XFxzKj4/LylcblxuICAgIGlmICghbG9jYWxSZXR1cm5UeXBlTWF0Y2gpIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBDdXN0b20gY29tbWFuZCBKU0RvYyB0eXBlIGNhbm5vdCB1c2UgYmFja2VuZC1sb2NhbCBSZXR1cm5UeXBlIGV4cHJlc3Npb25zIGluIGdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbHM6ICR7bG9jYWxSZXR1cm5UeXBlTWF0Y2hbMF19LiBNb3ZlIHRoZSBwYXlsb2FkIHNoYXBlIHRvIGEgc2hhcmVkIHR5cGVkZWYgYW5kIHJldHVybiB0aGF0IHR5cGUgZnJvbSB0aGUgY29tbWFuZCBtZXRob2QuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHJlc29sdmFibGUganMgZG9jIGltcG9ydCBzcGVjaWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3MuZnJvbnRlbmRNb2RlbEZpbGVQYXRoIC0gR2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLnNvdXJjZUZpbGUgLSBTb3VyY2UgZmlsZSB0aGF0IGRlY2xhcmVkIHRoZSBKU0RvYyB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zcGVjaWZpZXIgLSBTb3VyY2UtZmlsZSBpbXBvcnQgc3BlY2lmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBSZXdyaXR0ZW4gZnJvbnRlbmQtbW9kZWwgaW1wb3J0IHNwZWNpZmllciwgb3IgbnVsbCB3aGVuIGJhY2tlbmQtbG9jYWwuXG4gICAqL1xuICBmcm9udGVuZFJlc29sdmFibGVKc0RvY0ltcG9ydFNwZWNpZmllcih7ZnJvbnRlbmRNb2RlbEZpbGVQYXRoLCBzb3VyY2VGaWxlLCBzcGVjaWZpZXJ9KSB7XG4gICAgaWYgKCFzb3VyY2VGaWxlIHx8ICFmcm9udGVuZE1vZGVsRmlsZVBhdGgpIHJldHVybiBudWxsXG4gICAgaWYgKCFzcGVjaWZpZXIuc3RhcnRzV2l0aChcIi5cIikgJiYgIXNwZWNpZmllci5zdGFydHNXaXRoKFwiL1wiKSkgcmV0dXJuIHNwZWNpZmllclxuXG4gICAgY29uc3QgaW1wb3J0ZWRQYXRoID0gcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShzb3VyY2VGaWxlKSwgc3BlY2lmaWVyKVxuICAgIGNvbnN0IG1vZGVsSW1wb3J0U3BlY2lmaWVyID0gdGhpcy5mcm9udGVuZE1vZGVsSW1wb3J0U3BlY2lmaWVyRm9yQmFja2VuZE1vZGVsUGF0aCh7XG4gICAgICBmcm9udGVuZE1vZGVsRmlsZVBhdGgsXG4gICAgICBpbXBvcnRlZFBhdGhcbiAgICB9KVxuXG4gICAgaWYgKG1vZGVsSW1wb3J0U3BlY2lmaWVyKSByZXR1cm4gbW9kZWxJbXBvcnRTcGVjaWZpZXJcblxuICAgIGlmICh0aGlzLmZpbGVQYXRoSXNXaXRoaW5BbnlEaXJlY3Rvcnkoe2RpcmVjdG9yaWVzOiB0aGlzLmZyb250ZW5kTW9kZWxKc0RvY1NvdXJjZURpcmVjdG9yaWVzKCksIGZpbGVQYXRoOiBpbXBvcnRlZFBhdGh9KSkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZWxhdGl2ZUltcG9ydFNwZWNpZmllcih7ZnJvbUZpbGU6IGZyb250ZW5kTW9kZWxGaWxlUGF0aCwgdG9GaWxlOiBpbXBvcnRlZFBhdGh9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgaW1wb3J0IHNwZWNpZmllciBmb3IgYmFja2VuZCBtb2RlbCBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZnJvbnRlbmRNb2RlbEZpbGVQYXRoIC0gR2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW1wb3J0ZWRQYXRoIC0gU291cmNlLWZpbGUgaW1wb3J0IHBhdGggcmVzb2x2ZWQgZnJvbSBKU0RvYy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gR2VuZXJhdGVkIGZyb250ZW5kLW1vZGVsIGltcG9ydCBzcGVjaWZpZXIsIG9yIG51bGwgd2hlbiB0aGUgcGF0aCBpcyBub3QgYSByZWdpc3RlcmVkIG1vZGVsIGZpbGUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsSW1wb3J0U3BlY2lmaWVyRm9yQmFja2VuZE1vZGVsUGF0aCh7ZnJvbnRlbmRNb2RlbEZpbGVQYXRoLCBpbXBvcnRlZFBhdGh9KSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbHNEaXJlY3RvcnkgPSBwYXRoLmRpcm5hbWUoZnJvbnRlbmRNb2RlbEZpbGVQYXRoKVxuICAgIGNvbnN0IGltcG9ydGVkTW9kZWxQYXRoID0gaW1wb3J0ZWRQYXRoLmVuZHNXaXRoKFwiLmpzXCIpID8gaW1wb3J0ZWRQYXRoIDogYCR7aW1wb3J0ZWRQYXRofS5qc2BcblxuICAgIGZvciAoY29uc3QgbW9kZWxGaWxlTmFtZSBvZiB0aGlzLmdlbmVyYXRlZEZyb250ZW5kTW9kZWxGaWxlTmFtZXMoKSkge1xuICAgICAgZm9yIChjb25zdCBzb3VyY2VEaXJlY3Rvcnkgb2YgdGhpcy5mcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VEaXJlY3RvcmllcygpKSB7XG4gICAgICAgIGNvbnN0IG1vZGVsc0RpcmVjdG9yeSA9IHBhdGguam9pbihzb3VyY2VEaXJlY3RvcnksIFwibW9kZWxzXCIpXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZU1vZGVsUGF0aCA9IHBhdGguam9pbihtb2RlbHNEaXJlY3RvcnksIG1vZGVsRmlsZU5hbWUpXG5cbiAgICAgICAgaWYgKHBhdGgucmVzb2x2ZShjYW5kaWRhdGVNb2RlbFBhdGgpICE9PSBwYXRoLnJlc29sdmUoaW1wb3J0ZWRNb2RlbFBhdGgpKSBjb250aW51ZVxuXG4gICAgICAgIHJldHVybiB0aGlzLnJlbGF0aXZlSW1wb3J0U3BlY2lmaWVyKHtcbiAgICAgICAgICBmcm9tRmlsZTogZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgICAgIHRvRmlsZTogcGF0aC5qb2luKGZyb250ZW5kTW9kZWxzRGlyZWN0b3J5LCBtb2RlbEZpbGVOYW1lKVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgZmlsZSBuYW1lcy5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIEZyb250ZW5kIG1vZGVsIGZpbGVuYW1lcyB0aGF0IHRoaXMgZ2VuZXJhdGlvbiBydW4gY2FuIGVtaXQuXG4gICAqL1xuICBnZW5lcmF0ZWRGcm9udGVuZE1vZGVsRmlsZU5hbWVzKCkge1xuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgZmlsZU5hbWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgICBjb25zdCByZXNvdXJjZXMgPSB0aGlzLnJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgICBmb3IgKGNvbnN0IHJlc291cmNlTW9kZWxOYW1lIG9mIE9iamVjdC5rZXlzKHJlc291cmNlcykpIHtcbiAgICAgICAgY29uc3QgY2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShyZXNvdXJjZU1vZGVsTmFtZS5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIikpXG5cbiAgICAgICAgZmlsZU5hbWVzLmFkZChgJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoY2xhc3NOYW1lKSl9LmpzYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZU5hbWVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGl2ZSBpbXBvcnQgc3BlY2lmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZnJvbUZpbGUgLSBTb3VyY2UgZmlsZSB0aGF0IHdpbGwgY29udGFpbiB0aGUgaW1wb3J0IGV4cHJlc3Npb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRvRmlsZSAtIEZpbGUgYmVpbmcgaW1wb3J0ZWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVsYXRpdmUgaW1wb3J0IHNwZWNpZmllci5cbiAgICovXG4gIHJlbGF0aXZlSW1wb3J0U3BlY2lmaWVyKHtmcm9tRmlsZSwgdG9GaWxlfSkge1xuICAgIGxldCByZWxhdGl2ZVNwZWNpZmllciA9IHBhdGgucmVsYXRpdmUocGF0aC5kaXJuYW1lKGZyb21GaWxlKSwgdG9GaWxlKS5zcGxpdChwYXRoLnNlcCkuam9pbihcIi9cIilcblxuICAgIGlmICghcmVsYXRpdmVTcGVjaWZpZXIuc3RhcnRzV2l0aChcIi5cIikpIHtcbiAgICAgIHJlbGF0aXZlU3BlY2lmaWVyID0gYC4vJHtyZWxhdGl2ZVNwZWNpZmllcn1gXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlbGF0aXZlU3BlY2lmaWVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaWxlIHBhdGggaXMgd2l0aGluIGFueSBkaXJlY3RvcnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRpcmVjdG9yaWVzIC0gQ2FuZGlkYXRlIHBhcmVudCBkaXJlY3Rvcmllcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZVBhdGggLSBGaWxlIHBhdGggdG8gdGVzdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZmlsZSBwYXRoIGlzIHVuZGVyIG9uZSBjYW5kaWRhdGUgZGlyZWN0b3J5LlxuICAgKi9cbiAgZmlsZVBhdGhJc1dpdGhpbkFueURpcmVjdG9yeSh7ZGlyZWN0b3JpZXMsIGZpbGVQYXRofSkge1xuICAgIHJldHVybiBkaXJlY3Rvcmllcy5zb21lKChkaXJlY3RvcnkpID0+IHtcbiAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHBhdGgucmVsYXRpdmUocGF0aC5yZXNvbHZlKGRpcmVjdG9yeSksIHBhdGgucmVzb2x2ZShmaWxlUGF0aCkpXG5cbiAgICAgIHJldHVybiByZWxhdGl2ZVBhdGggPT09IFwiXCIgfHwgKCFyZWxhdGl2ZVBhdGguc3RhcnRzV2l0aChcIi4uXCIpICYmICFwYXRoLmlzQWJzb2x1dGUocmVsYXRpdmVQYXRoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVzY2FwZXMgdGV4dCBmb3IgdXNlIGluc2lkZSBhIFJlZ0V4cC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gZXNjYXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlZ0V4cC1zYWZlIHZhbHVlLlxuICAgKi9cbiAgZXNjYXBlUmVnRXhwKHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgSlNEb2MgcGFyYW0gYmxvY2ssIHBhcmFtZXRlciBsaXN0LCBwYXlsb2FkLWFyZ3VtZW50IGV4cHJlc3Npb24sIGFuZFxuICAgKiByZXR1cm4gdHlwZSBmb3IgYSBjdXN0b20gY29tbWFuZCBtZXRob2QuIFdpdGggZGVjbGFyZWQgYGFyZ3NgIGVhY2ggYmVjb21lcyBhXG4gICAqIG5hbWVkLCB0eXBlZCBwYXJhbWV0ZXIgbWFwcGVkIHBvc2l0aW9uYWxseSBpbnRvIHRoZSBjb21tYW5kIHBheWxvYWQ7IHdpdGhvdXRcbiAgICogdGhlbSB0aGUgbWV0aG9kIHN0YXlzIHZhcmlhZGljLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9Pn0gYXJncy5jb21tYW5kTWV0YWRhdGEgLSBQZXItY29tbWFuZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWV0aG9kTmFtZSAtIENvbW1hbmQgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7cGFyYW1Eb2NzOiBzdHJpbmcsIHBhcmFtZXRlcnM6IHN0cmluZywgcGF5bG9hZEFyZ3VtZW50czogc3RyaW5nLCByZXR1cm5UeXBlOiBzdHJpbmd9fSAtIEdlbmVyYXRpb24gcGllY2VzLlxuICAgKi9cbiAgY3VzdG9tQ29tbWFuZE1ldGhvZFNpZ25hdHVyZSh7Y29tbWFuZE1ldGFkYXRhLCBtZXRob2ROYW1lfSkge1xuICAgIGNvbnN0IG1ldGFkYXRhID0gY29tbWFuZE1ldGFkYXRhW21ldGhvZE5hbWVdIHx8IHthcmdzOiBbXSwgcmV0dXJuVHlwZTogbnVsbH1cbiAgICBjb25zdCByZXR1cm5UeXBlID0gbWV0YWRhdGEucmV0dXJuVHlwZSB8fCBcIlJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5cIlxuXG4gICAgaWYgKG1ldGFkYXRhLmFyZ3MubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgcGFyYW1ldGVyTmFtZXMgPSBtZXRhZGF0YS5hcmdzLm1hcCgoYXJnKSA9PiBhcmcubmFtZSlcbiAgICAgIC8vIEEgc2luZ2xlIGFyZ3Mgb2JqZWN0IHdob3NlIGV2ZXJ5IGZpZWxkIGlzIG9wdGlvbmFsIGFjY2VwdHMgYHt9YCwgc28gZGVmYXVsdFxuICAgICAgLy8gdGhlIHBhcmFtZXRlciBhbmQgbWFyayBpdCBvcHRpb25hbCDigJQgY2FsbGVycyBjYW4gdGhlbiBvbWl0IGl0IGVudGlyZWx5XG4gICAgICAvLyAoYHJlY29yZC5jb21tYW5kKClgIGluc3RlYWQgb2YgYHJlY29yZC5jb21tYW5kKHt9KWApLiBSZXF1aXJlZC1maWVsZCBhcmdzIGtlZXBcbiAgICAgIC8vIHRoZSBtYW5kYXRvcnkgcGFyYW1ldGVyIChhIGB7fWAgZGVmYXVsdCB3b3VsZG4ndCBzYXRpc2Z5IHRoZWlyIHR5cGUpLlxuICAgICAgY29uc3QgZGVmYXVsdHNUb0VtcHR5T2JqZWN0ID0gbWV0YWRhdGEuYXJncy5sZW5ndGggPT09IDEgJiYgdGhpcy5hcmdUeXBlQWNjZXB0c0VtcHR5T2JqZWN0KG1ldGFkYXRhLmFyZ3NbMF0udHlwZSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcGFyYW1Eb2NzOiBtZXRhZGF0YS5hcmdzLm1hcCgoYXJnKSA9PiBgICAgKiBAcGFyYW0geyR7YXJnLnR5cGV9fSAke2RlZmF1bHRzVG9FbXB0eU9iamVjdCA/IGBbJHthcmcubmFtZX1dYCA6IGFyZy5uYW1lfSAtIENvbW1hbmQgYXJndW1lbnQuXFxuYCkuam9pbihcIlwiKSxcbiAgICAgICAgcGFyYW1ldGVyczogZGVmYXVsdHNUb0VtcHR5T2JqZWN0ID8gYCR7cGFyYW1ldGVyTmFtZXNbMF19ID0ge31gIDogcGFyYW1ldGVyTmFtZXMuam9pbihcIiwgXCIpLFxuICAgICAgICBwYXlsb2FkQXJndW1lbnRzOiBgWyR7cGFyYW1ldGVyTmFtZXMuam9pbihcIiwgXCIpfV1gLFxuICAgICAgICByZXR1cm5UeXBlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHBhcmFtRG9jczogXCIgICAqIEBwYXJhbSB7Li4uRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlfSBjb21tYW5kQXJndW1lbnRzIC0gQ3VzdG9tIGNvbW1hbmQgYXJndW1lbnRzLlxcblwiLFxuICAgICAgcGFyYW1ldGVyczogXCIuLi5jb21tYW5kQXJndW1lbnRzXCIsXG4gICAgICBwYXlsb2FkQXJndW1lbnRzOiBcImNvbW1hbmRBcmd1bWVudHNcIixcbiAgICAgIHJldHVyblR5cGVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIHNpbmdsZSBjb21tYW5kLWFyZ3MgSlNEb2MgdHlwZSBpcyBrbm93biB0byBhY2NlcHQgYW4gZW1wdHkgb2JqZWN0IGB7fWA6XG4gICAqIGEgc2luZ2xlIGJhbGFuY2VkIG9iamVjdCBsaXRlcmFsIHdob3NlIHRvcC1sZXZlbCBtZW1iZXJzIGFyZSBhbGwgb3B0aW9uYWwgKGBuYW1lPzpgKVxuICAgKiBvciBpbmRleCBzaWduYXR1cmVzIChgW2s6IC4uLl06YCkuIEFueXRoaW5nIGVsc2UgcmV0dXJucyBmYWxzZSBzbyB0aGUgcGFyYW1ldGVyIHN0YXlzXG4gICAqIHJlcXVpcmVkIOKAlCBpbmNsdWRpbmcgYSByZXF1aXJlZCBtZW1iZXIsIGEgbm9uLW9iamVjdC1saXRlcmFsIChhIHBvc2l0aW9uYWwgYG51bWJlcmAsXG4gICAqIGEgYFJlY29yZDwuLi4+YCAvIGBQYXJ0aWFsPC4uLj5gIHdob3NlIGtleS93cmFwcGVyIG1heSBzdGlsbCByZXF1aXJlIGRhdGEpLCBhbmQgYW55XG4gICAqIGludGVyc2VjdGlvbi91bmlvbiAoZS5nLiBge2E/OiB4fSAmIHtiOiBzdHJpbmd9YCksIHdoZXJlIGB7fWAgaXMgbm90IGFzc2lnbmFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gVGhlIGFyZydzIEpTRG9jIHR5cGUgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBnZW5lcmF0ZWQgcGFyYW1ldGVyIGNhbiBkZWZhdWx0IHRvIGB7fWAuXG4gICAqL1xuICBhcmdUeXBlQWNjZXB0c0VtcHR5T2JqZWN0KHR5cGUpIHtcbiAgICBjb25zdCB0cmltbWVkVHlwZSA9IHR5cGUudHJpbSgpXG5cbiAgICAvLyBNdXN0IGJlIGEgc2luZ2xlIGJhbGFuY2VkIG9iamVjdCBsaXRlcmFsOiBzdGFydHMgd2l0aCBge2AsIGVuZHMgd2l0aCBgfWAsIGFuZCB0aGVcbiAgICAvLyBvcGVuaW5nIGJyYWNlIGNsb3NlcyBvbmx5IGF0IHRoZSBmaW5hbCBjaGFyYWN0ZXIuIFRoaXMgcmVqZWN0cyBpbnRlcnNlY3Rpb25zL3VuaW9uc1xuICAgIC8vIGxpa2UgYHthPzogeH0gJiB7Yjogc3RyaW5nfWAgdGhhdCBtZXJlbHkgaGFwcGVuIHRvIHN0YXJ0IGB7YCBhbmQgZW5kIGB9YC5cbiAgICBpZiAoISh0cmltbWVkVHlwZS5zdGFydHNXaXRoKFwie1wiKSAmJiB0cmltbWVkVHlwZS5lbmRzV2l0aChcIn1cIikpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoIXRoaXMuaXNTaW5nbGVCYWxhbmNlZE9iamVjdExpdGVyYWwodHJpbW1lZFR5cGUpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGlubmVyID0gdHJpbW1lZFR5cGUuc2xpY2UoMSwgLTEpXG5cbiAgICBmb3IgKGNvbnN0IG1lbWJlciBvZiB0aGlzLnNwbGl0VG9wTGV2ZWxUeXBlTWVtYmVycyhpbm5lcikpIHtcbiAgICAgIGNvbnN0IGNvbG9uSW5kZXggPSB0aGlzLnRvcExldmVsQ29sb25JbmRleChtZW1iZXIpXG5cbiAgICAgIC8vIE5vIHRvcC1sZXZlbCBjb2xvbjogYSBjYWxsL2NvbnN0cnVjdC9tYXBwZWQgc2lnbmF0dXJlIG9yIG1hbGZvcm1lZCBtZW1iZXIg4oCUXG4gICAgICAvLyBjYW4ndCBjb25maXJtIGl0J3Mgb3B0aW9uYWwsIHNvIHRyZWF0IHRoZSB0eXBlIGFzIG5vdCBlbXB0eS1kZWZhdWx0YWJsZS5cbiAgICAgIGlmIChjb2xvbkluZGV4IDwgMCkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGNvbnN0IGtleSA9IG1lbWJlci5zbGljZSgwLCBjb2xvbkluZGV4KS50cmltKClcblxuICAgICAgLy8gSW5kZXggc2lnbmF0dXJlcyAoYFtrOiBzdHJpbmddYCkgZG9uJ3QgcmVxdWlyZSBhIHZhbHVlOyBvcHRpb25hbCBwcm9wcyBlbmQgaW4gYD9gLlxuICAgICAgLy8gQW55dGhpbmcgZWxzZSBpcyBhIHJlcXVpcmVkIHByb3BlcnR5LCBzbyBge31gIHdvdWxkIG5vdCBzYXRpc2Z5IHRoZSB0eXBlLlxuICAgICAgaWYgKCFrZXkuc3RhcnRzV2l0aChcIltcIikgJiYgIWtleS5lbmRzV2l0aChcIj9cIikpIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogU3BsaXRzIHRoZSBpbm5lciBib2R5IG9mIGFuIG9iamVjdC1saXRlcmFsIHR5cGUgaW50byBpdHMgdG9wLWxldmVsIG1lbWJlcnMsXG4gICAqIHJlc3BlY3RpbmcgbmVzdGVkIGB7fWAgLyBgW11gIC8gYDw+YCAvIGAoKWAgc28gZmllbGQgdHlwZXMgbGlrZSBgc3RyaW5nW10gfCBudWxsYFxuICAgKiBvciBge2E6IGJ9YCBhcmVuJ3Qgc3BsaXQgbWlkLXR5cGUuIE1lbWJlcnMgYXJlIHNlcGFyYXRlZCBieSBgLGAgb3IgYDtgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaW5uZXIgLSBPYmplY3QtbGl0ZXJhbCBib2R5ICh3aXRob3V0IHRoZSBvdXRlciBicmFjZXMpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVHJpbW1lZCBub24tZW1wdHkgdG9wLWxldmVsIG1lbWJlcnMuXG4gICAqL1xuICBzcGxpdFRvcExldmVsVHlwZU1lbWJlcnMoaW5uZXIpIHtcbiAgICBjb25zdCBtZW1iZXJzID0gW11cbiAgICBsZXQgZGVwdGggPSAwXG4gICAgbGV0IHN0YXJ0ID0gMFxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGlubmVyLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgY2hhcmFjdGVyID0gaW5uZXJbaW5kZXhdXG5cbiAgICAgIGlmIChjaGFyYWN0ZXIgPT09IFwie1wiIHx8IGNoYXJhY3RlciA9PT0gXCJbXCIgfHwgY2hhcmFjdGVyID09PSBcIjxcIiB8fCBjaGFyYWN0ZXIgPT09IFwiKFwiKSB7XG4gICAgICAgIGRlcHRoICs9IDFcbiAgICAgIH0gZWxzZSBpZiAoY2hhcmFjdGVyID09PSBcIn1cIiB8fCBjaGFyYWN0ZXIgPT09IFwiXVwiIHx8IGNoYXJhY3RlciA9PT0gXCI+XCIgfHwgY2hhcmFjdGVyID09PSBcIilcIikge1xuICAgICAgICBkZXB0aCAtPSAxXG4gICAgICB9IGVsc2UgaWYgKChjaGFyYWN0ZXIgPT09IFwiLFwiIHx8IGNoYXJhY3RlciA9PT0gXCI7XCIpICYmIGRlcHRoID09PSAwKSB7XG4gICAgICAgIG1lbWJlcnMucHVzaChpbm5lci5zbGljZShzdGFydCwgaW5kZXgpKVxuICAgICAgICBzdGFydCA9IGluZGV4ICsgMVxuICAgICAgfVxuICAgIH1cblxuICAgIG1lbWJlcnMucHVzaChpbm5lci5zbGljZShzdGFydCkpXG5cbiAgICByZXR1cm4gbWVtYmVycy5tYXAoKG1lbWJlcikgPT4gbWVtYmVyLnRyaW0oKSkuZmlsdGVyKChtZW1iZXIpID0+IG1lbWJlci5sZW5ndGggPiAwKVxuICB9XG5cbiAgLyoqXG4gICAqIEluZGV4IG9mIHRoZSBmaXJzdCB0b3AtbGV2ZWwgYDpgIGluIGFuIG9iamVjdC1saXRlcmFsIG1lbWJlciwgaWdub3JpbmcgY29sb25zXG4gICAqIG5lc3RlZCBpbnNpZGUgYHt9YCAvIGBbXWAgLyBgPD5gIC8gYCgpYCAoZS5nLiBhbiBpbmRleCBzaWduYXR1cmUgYFtrOiBzdHJpbmddYCkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZW1iZXIgLSBBIHNpbmdsZSBvYmplY3QtbGl0ZXJhbCBtZW1iZXIuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGNvbG9uIGluZGV4LCBvciAtMSB3aGVuIG5vbmUgaXMgZm91bmQgYXQgdGhlIHRvcCBsZXZlbC5cbiAgICovXG4gIHRvcExldmVsQ29sb25JbmRleChtZW1iZXIpIHtcbiAgICBsZXQgZGVwdGggPSAwXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbWVtYmVyLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgY2hhcmFjdGVyID0gbWVtYmVyW2luZGV4XVxuXG4gICAgICBpZiAoY2hhcmFjdGVyID09PSBcIntcIiB8fCBjaGFyYWN0ZXIgPT09IFwiW1wiIHx8IGNoYXJhY3RlciA9PT0gXCI8XCIgfHwgY2hhcmFjdGVyID09PSBcIihcIikge1xuICAgICAgICBkZXB0aCArPSAxXG4gICAgICB9IGVsc2UgaWYgKGNoYXJhY3RlciA9PT0gXCJ9XCIgfHwgY2hhcmFjdGVyID09PSBcIl1cIiB8fCBjaGFyYWN0ZXIgPT09IFwiPlwiIHx8IGNoYXJhY3RlciA9PT0gXCIpXCIpIHtcbiAgICAgICAgZGVwdGggLT0gMVxuICAgICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT09IFwiOlwiICYmIGRlcHRoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBpbmRleFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHR5cGUgaXMgYSBzaW5nbGUgYmFsYW5jZWQgb2JqZWN0IGxpdGVyYWwg4oCUIGl0cyBsZWFkaW5nIGB7YCBjbG9zZXMgb25seVxuICAgKiBhdCB0aGUgZmluYWwgY2hhcmFjdGVyLiBSZWplY3RzIHRvcC1sZXZlbCBpbnRlcnNlY3Rpb25zL3VuaW9ucyBsaWtlIGB7YT86IHh9ICYge2I6IHl9YFxuICAgKiBvciBge2E/OiB4fSB8IHN0cmluZ2Agd2hvc2UgYnJhY2UgZGVwdGggcmV0dXJucyB0byAwIGJlZm9yZSB0aGUgZW5kLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIEEgdHJpbW1lZCB0eXBlIHN0cmluZyB0aGF0IHN0YXJ0cyB3aXRoIGB7YCBhbmQgZW5kcyB3aXRoIGB9YC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYnJhY2VzIHdyYXAgdGhlIHdob2xlIHR5cGUuXG4gICAqL1xuICBpc1NpbmdsZUJhbGFuY2VkT2JqZWN0TGl0ZXJhbCh0eXBlKSB7XG4gICAgbGV0IGRlcHRoID0gMFxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IHR5cGUubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICBjb25zdCBjaGFyYWN0ZXIgPSB0eXBlW2luZGV4XVxuXG4gICAgICBpZiAoY2hhcmFjdGVyID09PSBcIntcIiB8fCBjaGFyYWN0ZXIgPT09IFwiW1wiIHx8IGNoYXJhY3RlciA9PT0gXCI8XCIgfHwgY2hhcmFjdGVyID09PSBcIihcIikge1xuICAgICAgICBkZXB0aCArPSAxXG4gICAgICB9IGVsc2UgaWYgKGNoYXJhY3RlciA9PT0gXCJ9XCIgfHwgY2hhcmFjdGVyID09PSBcIl1cIiB8fCBjaGFyYWN0ZXIgPT09IFwiPlwiIHx8IGNoYXJhY3RlciA9PT0gXCIpXCIpIHtcbiAgICAgICAgZGVwdGggLT0gMVxuXG4gICAgICAgIC8vIFRoZSBvcGVuaW5nIGJyYWNlIGJhbGFuY2VkIGJlZm9yZSB0aGUgZW5kLCBzbyBzb21ldGhpbmcgZm9sbG93cyB0aGUgbGl0ZXJhbC5cbiAgICAgICAgaWYgKGRlcHRoID09PSAwICYmIGluZGV4IDwgdHlwZS5sZW5ndGggLSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGVwdGggPT09IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnJpY2hlcyBjdXN0b20tY29tbWFuZCBtZXRhZGF0YSBieSBkZXJpdmluZyBhIGNvbW1hbmQncyB0eXBlZCBhcmdzIGFuZCByZXR1cm5cbiAgICogdHlwZSBmcm9tIHRoZSBiYWNrZW5kIHJlc291cmNlIG1ldGhvZCdzIGBAcGFyYW1gL2BAcmV0dXJuc2AgSlNEb2Mgd2hlbiB0aGV5IGFyZVxuICAgKiBub3QgYWxyZWFkeSBkZWNsYXJlZCBpbiBgcmVzb3VyY2VDb25maWdgLiBQcmVjZWRlbmNlOiBleHBsaWNpdCBgcmVzb3VyY2VDb25maWdgXG4gICAqIGB7YXJncywgcmV0dXJuVHlwZX1gIHdpbnMsIHRoZW4gdGhlIGRlcml2ZWQgYmFja2VuZC1tZXRob2QgSlNEb2MsIHRoZW4gdGhlIGdlbmVyaWNcbiAgICogZGVmYXVsdC4gTW9kZWwtY2xhc3MgaWRlbnRpZmllcnMgaW4gdGhlIGRlcml2ZWQgdHlwZXMgYXJlIGRvd25ncmFkZWQgdG8gYGFueWBcbiAgICogYmVjYXVzZSB0aGUgZnJvbnRlbmQgcmVjZWl2ZXMgYSBzZXJpYWxpemVkIHJlY29yZCwgbm90IGEgbW9kZWwgaW5zdGFuY2UsIHdoaWNoIHRoZVxuICAgKiBjb25zdW1lciBoeWRyYXRlcyB3aXRoIGBNb2RlbC5pbnN0YW50aWF0ZUZyb21SZXNwb25zZSguLi4pYC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT59IGFyZ3MuY29tbWFuZE1ldGFkYXRhIC0gRGVjbGFyZWQgcGVyLWNvbW1hbmQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuY29tbWFuZE5hbWVzIC0gQ29tbWFuZCBtZXRob2QgbmFtZXMgdG8gcmVzb2x2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZnJvbnRlbmRNb2RlbEZpbGVQYXRoIC0gR2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MucmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9Pj59IC0gRW5yaWNoZWQgbWV0YWRhdGEuXG4gICAqL1xuICBhc3luYyBjb21tYW5kTWV0YWRhdGFXaXRoUmVzb3VyY2VKc0RvYyh7Y29tbWFuZE1ldGFkYXRhLCBjb21tYW5kTmFtZXMsIGZyb250ZW5kTW9kZWxGaWxlUGF0aCwgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHJldHVybiBjb21tYW5kTWV0YWRhdGFcblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT59ICovXG4gICAgY29uc3QgZW5yaWNoZWQgPSB7Li4uY29tbWFuZE1ldGFkYXRhfVxuXG4gICAgZm9yIChjb25zdCBjb21tYW5kTmFtZSBvZiBjb21tYW5kTmFtZXMpIHtcbiAgICAgIGNvbnN0IGRlY2xhcmVkID0gY29tbWFuZE1ldGFkYXRhW2NvbW1hbmROYW1lXSB8fCB7YXJnczogW10sIHJldHVyblR5cGU6IG51bGx9XG4gICAgICBjb25zdCBzb3VyY2VDbGFzc05hbWUgPSB0aGlzLm1ldGhvZE93bmVyQ2xhc3NOYW1lKHttZXRob2ROYW1lOiBjb21tYW5kTmFtZSwgdGFyZ2V0Q2xhc3M6IHJlc291cmNlQ2xhc3N9KVxuXG4gICAgICBpZiAoIXNvdXJjZUNsYXNzTmFtZSkge1xuICAgICAgICBlbnJpY2hlZFtjb21tYW5kTmFtZV0gPSBkZWNsYXJlZFxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGxldCByZXR1cm5UeXBlID0gZGVjbGFyZWQucmV0dXJuVHlwZVxuXG4gICAgICBpZiAoIXJldHVyblR5cGUpIHtcbiAgICAgICAgY29uc3QganNEb2NSZXR1cm5UeXBlID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFJldHVyblR5cGVEZWZpbml0aW9uKHttZXRob2ROYW1lOiBjb21tYW5kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSlcblxuICAgICAgICBpZiAoanNEb2NSZXR1cm5UeXBlKSB7XG4gICAgICAgICAgcmV0dXJuVHlwZSA9IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlQ29tbWFuZEpzRG9jVHlwZSh7XG4gICAgICAgICAgICBmcm9udGVuZE1vZGVsRmlsZVBhdGgsXG4gICAgICAgICAgICBpbXBvcnRBbGlhc2VzOiBqc0RvY1JldHVyblR5cGUuaW1wb3J0QWxpYXNlcyxcbiAgICAgICAgICAgIGpzRG9jVHlwZTogdGhpcy51bndyYXBwZWRQcm9taXNlSnNEb2NUeXBlKHtqc0RvY1R5cGU6IGpzRG9jUmV0dXJuVHlwZS50eXBlfSksXG4gICAgICAgICAgICBzb3VyY2VGaWxlOiBqc0RvY1JldHVyblR5cGUuc291cmNlRmlsZVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbGV0IGFyZ3MgPSBkZWNsYXJlZC5hcmdzXG5cbiAgICAgIGlmICghYXJncyB8fCBhcmdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBjb25zdCBqc0RvY1BhcmFtZXRlcnMgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUGFyYW1ldGVycyh7bWV0aG9kTmFtZTogY29tbWFuZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pXG4gICAgICAgIC8vIFNraXAgb2JqZWN0LXByb3BlcnR5IHRhZ3MgKGBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXNzYWdlYCk7IG9ubHkgdGhlXG4gICAgICAgIC8vIHRvcC1sZXZlbCBwYXJhbWV0ZXJzIG1hcCB0byBtZXRob2QgYXJndW1lbnRzLCBvdGhlcndpc2UgdGhlIHNoYXJlZFxuICAgICAgICAvLyBgQHBhcmFtIHtvYmplY3R9IGFyZ3NgICsgcHJvcGVydHkgc3R5bGUgd291bGQgZW1pdCBgbmFtZShhcmdzLCBhcmdzKWAuXG4gICAgICAgIGNvbnN0IHRvcExldmVsUGFyYW1ldGVycyA9IChqc0RvY1BhcmFtZXRlcnMgfHwgW10pLmZpbHRlcigocGFyYW1ldGVyKSA9PiB0eXBlb2YgcGFyYW1ldGVyLm5hbWUgPT09IFwic3RyaW5nXCIgJiYgIXBhcmFtZXRlci5uYW1lLmluY2x1ZGVzKFwiLlwiKSlcblxuICAgICAgICBpZiAodG9wTGV2ZWxQYXJhbWV0ZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBhcmdzID0gdG9wTGV2ZWxQYXJhbWV0ZXJzLm1hcCgocGFyYW1ldGVyKSA9PiAoe1xuICAgICAgICAgICAgbmFtZTogLyoqIEB0eXBlIHtzdHJpbmd9ICovIChwYXJhbWV0ZXIubmFtZSksXG4gICAgICAgICAgICB0eXBlOiB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZUNvbW1hbmRKc0RvY1R5cGUoe1xuICAgICAgICAgICAgICBmcm9udGVuZE1vZGVsRmlsZVBhdGgsXG4gICAgICAgICAgICAgIGltcG9ydEFsaWFzZXM6IHBhcmFtZXRlci5pbXBvcnRBbGlhc2VzLFxuICAgICAgICAgICAgICBqc0RvY1R5cGU6IHBhcmFtZXRlci50eXBlLFxuICAgICAgICAgICAgICBzb3VyY2VGaWxlOiBwYXJhbWV0ZXIuc291cmNlRmlsZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBlbnJpY2hlZFtjb21tYW5kTmFtZV0gPSB7YXJnczogYXJncyB8fCBbXSwgcmV0dXJuVHlwZTogcmV0dXJuVHlwZSB8fCBudWxsfVxuICAgIH1cblxuICAgIHJldHVybiBlbnJpY2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdW53cmFwcGVkIHByb21pc2UganMgZG9jIHR5cGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qc0RvY1R5cGUgLSBKU0RvYyB0eXBlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcmVzb2x2ZWQgdmFsdWUgdHlwZSBmb3Igc2VyaWFsaXplZCBmcm9udGVuZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgdW53cmFwcGVkUHJvbWlzZUpzRG9jVHlwZSh7anNEb2NUeXBlfSkge1xuICAgIGNvbnN0IHByb21pc2VQcmVmaXggPSBcIlByb21pc2U8XCJcblxuICAgIGlmICghanNEb2NUeXBlLnN0YXJ0c1dpdGgocHJvbWlzZVByZWZpeCkpIHJldHVybiBqc0RvY1R5cGVcblxuICAgIGlmICghanNEb2NUeXBlLmVuZHNXaXRoKFwiPlwiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBQcm9taXNlIEpTRG9jIHR5cGUgdG8gZW5kIHdpdGggJz4nOiAke2pzRG9jVHlwZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkVHlwZSA9IGpzRG9jVHlwZS5zbGljZShwcm9taXNlUHJlZml4Lmxlbmd0aCwgLTEpLnRyaW0oKVxuXG4gICAgaWYgKHJlc29sdmVkVHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIFByb21pc2UgSlNEb2MgdHlwZSB0byBjb250YWluIGEgcmVzb2x2ZWQgdHlwZTogJHtqc0RvY1R5cGV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzb2x2ZWRUeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtZXRob2Qgb3duZXIgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gYXJncy50YXJnZXRDbGFzcyAtIFRhcmdldCBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ2xhc3MgbmFtZSB0aGF0IGRlY2xhcmVzIHRoZSBtZXRob2QuXG4gICAqL1xuICBtZXRob2RPd25lckNsYXNzTmFtZSh7bWV0aG9kTmFtZSwgdGFyZ2V0Q2xhc3N9KSB7XG4gICAgbGV0IHByb3RvdHlwZSA9IHRhcmdldENsYXNzLnByb3RvdHlwZVxuXG4gICAgd2hpbGUgKHByb3RvdHlwZSAmJiBwcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocHJvdG90eXBlLCBtZXRob2ROYW1lKSkge1xuICAgICAgICBjb25zdCBkZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90b3R5cGUsIG1ldGhvZE5hbWUpXG5cbiAgICAgICAgaWYgKHR5cGVvZiBkZXNjcmlwdG9yPy52YWx1ZSAhPSBcImZ1bmN0aW9uXCIpIHJldHVybiBudWxsXG5cbiAgICAgICAgY29uc3QgY29uc3RydWN0b3JOYW1lID0gcHJvdG90eXBlLmNvbnN0cnVjdG9yPy5uYW1lXG5cbiAgICAgICAgaWYgKHR5cGVvZiBjb25zdHJ1Y3Rvck5hbWUgPT0gXCJzdHJpbmdcIiAmJiBjb25zdHJ1Y3Rvck5hbWUubGVuZ3RoID4gMCkgcmV0dXJuIGNvbnN0cnVjdG9yTmFtZVxuXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwcm90b3R5cGUpXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIG1ldGhvZCByZXR1cm4gdHlwZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc291cmNlQ2xhc3NOYW1lIC0gU291cmNlIGNsYXNzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIEpTRG9jIHJldHVybiB0eXBlIHdoZW4gZG9jdW1lbnRlZC5cbiAgICovXG4gIGFzeW5jIHJlc291cmNlTWV0aG9kUmV0dXJuVHlwZSh7bWV0aG9kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSkge1xuICAgIGNvbnN0IHJldHVyblR5cGUgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUmV0dXJuVHlwZURlZmluaXRpb24oe21ldGhvZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pXG5cbiAgICByZXR1cm4gcmV0dXJuVHlwZSA/IHJldHVyblR5cGUudHlwZSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIG1ldGhvZCByZXR1cm4gdHlwZSBkZWZpbml0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zb3VyY2VDbGFzc05hbWUgLSBTb3VyY2UgY2xhc3MgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlIHwgbnVsbD59IC0gSlNEb2MgcmV0dXJuIHR5cGUgZGVmaW5pdGlvbiB3aGVuIGRvY3VtZW50ZWQuXG4gICAqL1xuICBhc3luYyByZXNvdXJjZU1ldGhvZFJldHVyblR5cGVEZWZpbml0aW9uKHttZXRob2ROYW1lLCBzb3VyY2VDbGFzc05hbWV9KSB7XG4gICAgY29uc3QgcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcyA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcygpXG4gICAgY29uc3QgcmV0dXJuVHlwZUtleSA9IGAke3NvdXJjZUNsYXNzTmFtZX0uJHttZXRob2ROYW1lfWBcblxuICAgIGlmICghcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcy5oYXMocmV0dXJuVHlwZUtleSkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZXR1cm5UeXBlID0gcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcy5nZXQocmV0dXJuVHlwZUtleSlcblxuICAgIGlmICghcmV0dXJuVHlwZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBKU0RvYyByZXR1cm4gdHlwZSBmb3IgJHtyZXR1cm5UeXBlS2V5fWApXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiByZXR1cm5UeXBlLnR5cGUgIT0gXCJzdHJpbmdcIiB8fCByZXR1cm5UeXBlLnR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBub24tZW1wdHkgSlNEb2MgcmV0dXJuIHR5cGUgZm9yICR7cmV0dXJuVHlwZUtleX1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXR1cm5UeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcGFyYW1ldGVyIHR5cGUuXG4gICAqIEBwYXJhbSB7e21ldGhvZE5hbWU6IHN0cmluZywgcGFyYW1ldGVySW5kZXg6IG51bWJlciwgc291cmNlQ2xhc3NOYW1lOiBzdHJpbmd9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBKU0RvYyBwYXJhbWV0ZXIgdHlwZSB3aGVuIGRvY3VtZW50ZWQuXG4gICAqL1xuICBhc3luYyByZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGUoe21ldGhvZE5hbWUsIHBhcmFtZXRlckluZGV4LCBzb3VyY2VDbGFzc05hbWV9KSB7XG4gICAgY29uc3QgcGFyYW1ldGVycyA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJzKHttZXRob2ROYW1lLCBzb3VyY2VDbGFzc05hbWV9KVxuXG4gICAgaWYgKCFwYXJhbWV0ZXJzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcGFyYW1ldGVyID0gcGFyYW1ldGVyc1twYXJhbWV0ZXJJbmRleF1cblxuICAgIGlmIChwYXJhbWV0ZXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGxcblxuICAgIGlmIChwYXJhbWV0ZXIudHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG5vbi1lbXB0eSBKU0RvYyBwYXJhbWV0ZXIgdHlwZSBmb3IgJHtzb3VyY2VDbGFzc05hbWV9LiR7bWV0aG9kTmFtZX0gcGFyYW1ldGVyICR7cGFyYW1ldGVySW5kZXh9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyYW1ldGVyLnR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIG1ldGhvZCBwYXJhbWV0ZXJzLlxuICAgKiBAcGFyYW0ge3ttZXRob2ROYW1lOiBzdHJpbmcsIHNvdXJjZUNsYXNzTmFtZTogc3RyaW5nfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlW10gfCBudWxsPn0gLSBKU0RvYyBwYXJhbWV0ZXJzIChuYW1lICsgdHlwZSkgd2hlbiBkb2N1bWVudGVkLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJzKHttZXRob2ROYW1lLCBzb3VyY2VDbGFzc05hbWV9KSB7XG4gICAgY29uc3QgcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcyA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcygpXG4gICAgY29uc3QgcGFyYW1ldGVyVHlwZXNLZXkgPSBgJHtzb3VyY2VDbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gXG5cbiAgICBpZiAoIXJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMuaGFzKHBhcmFtZXRlclR5cGVzS2V5KSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHBhcmFtZXRlcnMgPSByZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzLmdldChwYXJhbWV0ZXJUeXBlc0tleSlcblxuICAgIGlmICghcGFyYW1ldGVycykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBKU0RvYyBwYXJhbWV0ZXJzIGZvciAke3BhcmFtZXRlclR5cGVzS2V5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcmFtZXRlcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIG1ldGhvZCByZXR1cm4gdHlwZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZT4+fSAtIFJlc291cmNlIG1ldGhvZCByZXR1cm4gdHlwZXMga2V5ZWQgYnkgQ2xhc3NOYW1lLm1ldGhvZE5hbWUuXG4gICAqL1xuICBhc3luYyByZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzKCkge1xuICAgIGlmICh0aGlzLl9yZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzKSByZXR1cm4gdGhpcy5fcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlc1xuXG4gICAgY29uc3Qgc291cmNlRmlsZXMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxKc0RvY1NvdXJjZUZpbGVzKClcbiAgICBjb25zdCByZXR1cm5UeXBlcyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIHNvdXJjZUZpbGVzKSB7XG4gICAgICBjb25zdCBzb3VyY2VUZXh0ID0gYXdhaXQgZnMucmVhZEZpbGUoc291cmNlRmlsZSwgXCJ1dGY4XCIpXG5cbiAgICAgIHRoaXMuYWRkUmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlc0Zyb21Tb3VyY2Uoe3JldHVyblR5cGVzLCBzb3VyY2VGaWxlLCBzb3VyY2VUZXh0fSlcbiAgICB9XG5cbiAgICB0aGlzLl9yZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzID0gcmV0dXJuVHlwZXNcblxuICAgIHJldHVybiByZXR1cm5UeXBlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgbWV0aG9kIHBhcmFtZXRlciB0eXBlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgUmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlW10+Pn0gLSBSZXNvdXJjZSBtZXRob2QgcGFyYW1ldGVycyBrZXllZCBieSBDbGFzc05hbWUubWV0aG9kTmFtZS5cbiAgICovXG4gIGFzeW5jIHJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMoKSB7XG4gICAgaWYgKHRoaXMuX3Jlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMpIHJldHVybiB0aGlzLl9yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzXG5cbiAgICBjb25zdCBzb3VyY2VGaWxlcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRmlsZXMoKVxuICAgIGNvbnN0IHBhcmFtZXRlclR5cGVzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2Ygc291cmNlRmlsZXMpIHtcbiAgICAgIGNvbnN0IHNvdXJjZVRleHQgPSBhd2FpdCBmcy5yZWFkRmlsZShzb3VyY2VGaWxlLCBcInV0ZjhcIilcblxuICAgICAgdGhpcy5hZGRSZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzRnJvbVNvdXJjZSh7cGFyYW1ldGVyVHlwZXMsIHNvdXJjZUZpbGUsIHNvdXJjZVRleHR9KVxuICAgIH1cblxuICAgIHRoaXMuX3Jlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMgPSBwYXJhbWV0ZXJUeXBlc1xuXG4gICAgcmV0dXJuIHBhcmFtZXRlclR5cGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBKU0RvYyBzb3VyY2UgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBKYXZhU2NyaXB0IHNvdXJjZSBmaWxlcyB0aGF0IGNhbiBkZWZpbmUgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzIGFuZCBtb2RlbCBhY2Nlc3NvcnMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VGaWxlcygpIHtcbiAgICBjb25zdCBzb3VyY2VGaWxlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHNvdXJjZURpcmVjdG9yeSBvZiB0aGlzLmZyb250ZW5kTW9kZWxKc0RvY1NvdXJjZURpcmVjdG9yaWVzKCkpIHtcbiAgICAgIHNvdXJjZUZpbGVzLnB1c2goLi4uYXdhaXQgdGhpcy5qYXZhc2NyaXB0RmlsZXNJbkRpcmVjdG9yeShzb3VyY2VEaXJlY3RvcnkpKVxuICAgIH1cblxuICAgIHJldHVybiBzb3VyY2VGaWxlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgSlNEb2Mgc291cmNlIGRpcmVjdG9yaWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU291cmNlIGRpcmVjdG9yaWVzIHRvIHNjYW4gZm9yIGdlbmVyYXRlZCBmcm9udGVuZC1tb2RlbCBKU0RvYy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxKc0RvY1NvdXJjZURpcmVjdG9yaWVzKCkge1xuICAgIGNvbnN0IHNvdXJjZURpcmVjdG9yaWVzID0gbmV3IFNldChbcGF0aC5qb2luKHRoaXMuZGlyZWN0b3J5KCksIFwic3JjXCIpXSlcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICAgIGlmICh0eXBlb2YgYmFja2VuZFByb2plY3QucGF0aCA9PSBcInN0cmluZ1wiICYmIGJhY2tlbmRQcm9qZWN0LnBhdGgubGVuZ3RoID4gMCkge1xuICAgICAgICBzb3VyY2VEaXJlY3Rvcmllcy5hZGQocGF0aC5qb2luKGJhY2tlbmRQcm9qZWN0LnBhdGgsIFwic3JjXCIpKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5mcm9tKHNvdXJjZURpcmVjdG9yaWVzKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgcmVzb3VyY2UgbWV0aG9kIHJldHVybiB0eXBlcyBmcm9tIHNvdXJjZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7TWFwPHN0cmluZywgUmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlPn0gYXJncy5yZXR1cm5UeXBlcyAtIE11dGFibGUgcmV0dXJuIHR5cGVzIG1hcC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbYXJncy5zb3VyY2VGaWxlXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNvdXJjZVRleHQgLSBTb3VyY2UgdGV4dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRSZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzRnJvbVNvdXJjZSh7cmV0dXJuVHlwZXMsIHNvdXJjZUZpbGUgPSBudWxsLCBzb3VyY2VUZXh0fSkge1xuICAgIGNvbnN0IGNsYXNzUmVnZXggPSAvY2xhc3NcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxccysoPzpleHRlbmRzXFxzK1tee10rKT9cXHsvZ1xuICAgIGNvbnN0IGltcG9ydEFsaWFzZXMgPSB0aGlzLmpzRG9jSW1wb3J0QWxpYXNlc0Zyb21Tb3VyY2Uoc291cmNlVGV4dClcbiAgICBsZXQgY2xhc3NNYXRjaFxuXG4gICAgd2hpbGUgKChjbGFzc01hdGNoID0gY2xhc3NSZWdleC5leGVjKHNvdXJjZVRleHQpKSkge1xuICAgICAgY29uc3QgY2xhc3NOYW1lID0gY2xhc3NNYXRjaFsxXVxuICAgICAgY29uc3QgY2xhc3NCb2R5U3RhcnQgPSBjbGFzc1JlZ2V4Lmxhc3RJbmRleFxuICAgICAgY29uc3QgY2xhc3NCb2R5RW5kID0gdGhpcy5tYXRjaGluZ0JyYWNlSW5kZXgoe29wZW5JbmRleDogY2xhc3NCb2R5U3RhcnQgLSAxLCBzb3VyY2VUZXh0fSlcblxuICAgICAgaWYgKGNsYXNzQm9keUVuZCA9PSBudWxsKSB7XG4gICAgICAgIC8vIFRoZSBicmFjZSBtYXRjaGVyIGNhbid0IHRva2VuaXplIGV2ZXJ5IGNvbnN0cnVjdCAoZS5nLiBhIHJlZ2V4IGxpdGVyYWxcbiAgICAgICAgLy8gd2hvc2UgcXVvdGVzIGxvb2sgbGlrZSBzdHJpbmcgZGVsaW1pdGVycyksIHNvIGl0IGNhbiBmYWlsIHRvIGxvY2F0ZSBhXG4gICAgICAgIC8vIGNsYXNzIGJvZHkuIFNraXAgbWV0YWRhdGEgZXh0cmFjdGlvbiBmb3IgdGhhdCBjbGFzcyByYXRoZXIgdGhhblxuICAgICAgICAvLyBhYm9ydGluZyB0aGUgd2hvbGUgZnJvbnRlbmQtbW9kZWwgZ2VuZXJhdGlvbjsgcmVzb3VyY2VzIHRoYXQgcGFyc2VcbiAgICAgICAgLy8gY2xlYW5seSBzdGlsbCBnZXQgdGhlaXIgSlNEb2MtZGVyaXZlZCByZXR1cm4vcGFyYW0gdHlwZXMuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNsYXNzQm9keSA9IHNvdXJjZVRleHQuc2xpY2UoY2xhc3NCb2R5U3RhcnQsIGNsYXNzQm9keUVuZClcbiAgICAgIGNvbnN0IGpzRG9jUmVnZXggPSAvXFwvXFwqXFwqKFtcXHNcXFNdKj8pXFwqXFwvL2dcbiAgICAgIGxldCBqc0RvY01hdGNoXG5cbiAgICAgIHdoaWxlICgoanNEb2NNYXRjaCA9IGpzRG9jUmVnZXguZXhlYyhjbGFzc0JvZHkpKSkge1xuICAgICAgICBjb25zdCBzb3VyY2VBZnRlckpzRG9jID0gY2xhc3NCb2R5LnNsaWNlKGpzRG9jUmVnZXgubGFzdEluZGV4KVxuICAgICAgICBjb25zdCBtZXRob2RNYXRjaCA9IHNvdXJjZUFmdGVySnNEb2MubWF0Y2goL15cXHMqKD86YXN5bmNcXHMrKT8oW0EtWmEtel8kXVtcXHckXSopXFxzKlxcKC8pXG5cbiAgICAgICAgaWYgKCFtZXRob2RNYXRjaCkgY29udGludWVcblxuICAgICAgICBjb25zdCBtZXRob2ROYW1lID0gbWV0aG9kTWF0Y2hbMV1cblxuICAgICAgICBjb25zdCByZXR1cm5UeXBlID0gdGhpcy5qc0RvY1JldHVyblR5cGUoanNEb2NNYXRjaFsxXSlcblxuICAgICAgICBpZiAocmV0dXJuVHlwZSkge1xuICAgICAgICAgIHJldHVyblR5cGVzLnNldChgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gLCB7aW1wb3J0QWxpYXNlcywgc291cmNlRmlsZSwgdHlwZTogcmV0dXJuVHlwZX0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY2xhc3NSZWdleC5sYXN0SW5kZXggPSBjbGFzc0JvZHlFbmQgKyAxXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgcmVzb3VyY2UgbWV0aG9kIHBhcmFtZXRlciB0eXBlcyBmcm9tIHNvdXJjZS5cbiAgICogQHBhcmFtIHt7cGFyYW1ldGVyVHlwZXM6IE1hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZVtdPiwgc291cmNlRmlsZT86IHN0cmluZyB8IG51bGwsIHNvdXJjZVRleHQ6IHN0cmluZ319IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkUmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlc0Zyb21Tb3VyY2Uoe3BhcmFtZXRlclR5cGVzLCBzb3VyY2VGaWxlID0gbnVsbCwgc291cmNlVGV4dH0pIHtcbiAgICBjb25zdCBjbGFzc1JlZ2V4ID0gL2NsYXNzXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXHMrKD86ZXh0ZW5kc1xccytbXntdKyk/XFx7L2dcbiAgICBjb25zdCBpbXBvcnRBbGlhc2VzID0gdGhpcy5qc0RvY0ltcG9ydEFsaWFzZXNGcm9tU291cmNlKHNvdXJjZVRleHQpXG4gICAgbGV0IGNsYXNzTWF0Y2hcblxuICAgIHdoaWxlICgoY2xhc3NNYXRjaCA9IGNsYXNzUmVnZXguZXhlYyhzb3VyY2VUZXh0KSkpIHtcbiAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IGNsYXNzTWF0Y2hbMV1cbiAgICAgIGNvbnN0IGNsYXNzQm9keVN0YXJ0ID0gY2xhc3NSZWdleC5sYXN0SW5kZXhcbiAgICAgIGNvbnN0IGNsYXNzQm9keUVuZCA9IHRoaXMubWF0Y2hpbmdCcmFjZUluZGV4KHtvcGVuSW5kZXg6IGNsYXNzQm9keVN0YXJ0IC0gMSwgc291cmNlVGV4dH0pXG5cbiAgICAgIGlmIChjbGFzc0JvZHlFbmQgPT0gbnVsbCkge1xuICAgICAgICAvLyBUaGUgYnJhY2UgbWF0Y2hlciBjYW4ndCB0b2tlbml6ZSBldmVyeSBjb25zdHJ1Y3QgKGUuZy4gYSByZWdleCBsaXRlcmFsXG4gICAgICAgIC8vIHdob3NlIHF1b3RlcyBsb29rIGxpa2Ugc3RyaW5nIGRlbGltaXRlcnMpLCBzbyBpdCBjYW4gZmFpbCB0byBsb2NhdGUgYVxuICAgICAgICAvLyBjbGFzcyBib2R5LiBTa2lwIG1ldGFkYXRhIGV4dHJhY3Rpb24gZm9yIHRoYXQgY2xhc3MgcmF0aGVyIHRoYW5cbiAgICAgICAgLy8gYWJvcnRpbmcgdGhlIHdob2xlIGZyb250ZW5kLW1vZGVsIGdlbmVyYXRpb247IHJlc291cmNlcyB0aGF0IHBhcnNlXG4gICAgICAgIC8vIGNsZWFubHkgc3RpbGwgZ2V0IHRoZWlyIEpTRG9jLWRlcml2ZWQgcmV0dXJuL3BhcmFtIHR5cGVzLlxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjbGFzc0JvZHkgPSBzb3VyY2VUZXh0LnNsaWNlKGNsYXNzQm9keVN0YXJ0LCBjbGFzc0JvZHlFbmQpXG4gICAgICBjb25zdCBqc0RvY1JlZ2V4ID0gL1xcL1xcKlxcKihbXFxzXFxTXSo/KVxcKlxcLy9nXG4gICAgICBsZXQganNEb2NNYXRjaFxuXG4gICAgICB3aGlsZSAoKGpzRG9jTWF0Y2ggPSBqc0RvY1JlZ2V4LmV4ZWMoY2xhc3NCb2R5KSkpIHtcbiAgICAgICAgY29uc3Qgc291cmNlQWZ0ZXJKc0RvYyA9IGNsYXNzQm9keS5zbGljZShqc0RvY1JlZ2V4Lmxhc3RJbmRleClcbiAgICAgICAgY29uc3QgbWV0aG9kTWF0Y2ggPSBzb3VyY2VBZnRlckpzRG9jLm1hdGNoKC9eXFxzKig/OmFzeW5jXFxzKyk/KFtBLVphLXpfJF1bXFx3JF0qKVxccypcXCgvKVxuXG4gICAgICAgIGlmICghbWV0aG9kTWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgbWV0aG9kTmFtZSA9IG1ldGhvZE1hdGNoWzFdXG4gICAgICAgIGNvbnN0IGpzRG9jUGFyYW1ldGVycyA9IHRoaXMuanNEb2NQYXJhbWV0ZXJzKGpzRG9jTWF0Y2hbMV0pXG5cbiAgICAgICAgaWYgKGpzRG9jUGFyYW1ldGVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcGFyYW1ldGVyVHlwZXMuc2V0KGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWAsIGpzRG9jUGFyYW1ldGVycy5tYXAoKHBhcmFtZXRlcikgPT4gKHsuLi5wYXJhbWV0ZXIsIGltcG9ydEFsaWFzZXMsIHNvdXJjZUZpbGV9KSkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY2xhc3NSZWdleC5sYXN0SW5kZXggPSBjbGFzc0JvZHlFbmQgKyAxXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgSlNEb2MgaW1wb3J0IGFsaWFzZXMgZnJvbSBzb3VyY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzb3VyY2VUZXh0IC0gU291cmNlIHRleHQuXG4gICAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBSZXNvdXJjZUpzRG9jSW1wb3J0QWxpYXM+fSAtIEltcG9ydCBhbGlhc2VzIGtleWVkIGJ5IGxvY2FsIG5hbWUuXG4gICAqL1xuICBqc0RvY0ltcG9ydEFsaWFzZXNGcm9tU291cmNlKHNvdXJjZVRleHQpIHtcbiAgICBjb25zdCBpbXBvcnRBbGlhc2VzID0gbmV3IE1hcCgpXG4gICAgY29uc3QgaW1wb3J0UmVnZXggPSAvQGltcG9ydFxccypcXHtcXHMqKFtefV0rPylcXHMqXFx9XFxzKmZyb21cXHMqW1wiJ10oW15cIiddKylbXCInXS9nXG4gICAgbGV0IGltcG9ydE1hdGNoXG5cbiAgICB3aGlsZSAoKGltcG9ydE1hdGNoID0gaW1wb3J0UmVnZXguZXhlYyhzb3VyY2VUZXh0KSkpIHtcbiAgICAgIGNvbnN0IGltcG9ydExpc3QgPSBpbXBvcnRNYXRjaFsxXVxuICAgICAgY29uc3Qgc3BlY2lmaWVyID0gaW1wb3J0TWF0Y2hbMl1cblxuICAgICAgZm9yIChjb25zdCByYXdJbXBvcnRFbnRyeSBvZiBpbXBvcnRMaXN0LnNwbGl0KFwiLFwiKSkge1xuICAgICAgICBjb25zdCBpbXBvcnRFbnRyeSA9IHJhd0ltcG9ydEVudHJ5LnRyaW0oKVxuXG4gICAgICAgIGlmIChpbXBvcnRFbnRyeS5sZW5ndGggPCAxKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGVudHJ5TWF0Y2ggPSBpbXBvcnRFbnRyeS5tYXRjaCgvXihkZWZhdWx0fFtBLVphLXpfJF1bXFx3JF0qKSg/Olxccythc1xccysoW0EtWmEtel8kXVtcXHckXSopKT8kLylcblxuICAgICAgICBpZiAoIWVudHJ5TWF0Y2gpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBwYXJzZSBKU0RvYyBAaW1wb3J0IGVudHJ5OiAke2ltcG9ydEVudHJ5fWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbXBvcnRlZE5hbWUgPSBlbnRyeU1hdGNoWzFdXG4gICAgICAgIGNvbnN0IGFsaWFzTmFtZSA9IGVudHJ5TWF0Y2hbMl0gfHwgaW1wb3J0ZWROYW1lXG5cbiAgICAgICAgaW1wb3J0QWxpYXNlcy5zZXQoYWxpYXNOYW1lLCB7aW1wb3J0ZWROYW1lLCBzcGVjaWZpZXJ9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBpbXBvcnRBbGlhc2VzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgcmV0dXJuIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqc0RvY1RleHQgLSBKU0RvYyB0ZXh0IGluc2lkZSBjb21tZW50IG1hcmtlcnMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEpTRG9jIHJldHVybiB0eXBlIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIGpzRG9jUmV0dXJuVHlwZShqc0RvY1RleHQpIHtcbiAgICBjb25zdCByZXR1cm5zTWF0Y2ggPSBqc0RvY1RleHQubWF0Y2goL0ByZXR1cm5zP1xccypcXHsvKVxuXG4gICAgaWYgKCFyZXR1cm5zTWF0Y2ggfHwgcmV0dXJuc01hdGNoLmluZGV4ID09IG51bGwpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB0eXBlT3BlbkluZGV4ID0gcmV0dXJuc01hdGNoLmluZGV4ICsgcmV0dXJuc01hdGNoWzBdLmxlbmd0aCAtIDFcbiAgICBjb25zdCB0eXBlQ2xvc2VJbmRleCA9IHRoaXMubWF0Y2hpbmdCcmFjZUluZGV4KHtvcGVuSW5kZXg6IHR5cGVPcGVuSW5kZXgsIHNvdXJjZVRleHQ6IGpzRG9jVGV4dH0pXG5cbiAgICBpZiAodHlwZUNsb3NlSW5kZXggPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgcGFyc2UgSlNEb2MgcmV0dXJuIHR5cGUgZnJvbTogJHtqc0RvY1RleHR9YClcbiAgICB9XG5cbiAgICBjb25zdCByZXR1cm5UeXBlID0gdGhpcy5ub3JtYWxpemVKc0RvY1R5cGUoanNEb2NUZXh0LnNsaWNlKHR5cGVPcGVuSW5kZXggKyAxLCB0eXBlQ2xvc2VJbmRleCkpXG5cbiAgICBpZiAocmV0dXJuVHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG5vbi1lbXB0eSBKU0RvYyByZXR1cm4gdHlwZSBpbjogJHtqc0RvY1RleHR9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmV0dXJuVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIENvbGxhcHNlcyBhIEpTRG9jIHR5cGUgc3Bhbm5pbmcgbXVsdGlwbGUgY29tbWVudCBsaW5lcyBpbnRvIGEgc2luZ2xlIGxpbmUgc28gaXQgY2FuXG4gICAqIGJlIGVtaXR0ZWQgaW50byBhbiBpbmxpbmUgdHlwZS1hc3NlcnRpb24gY2FzdC4gQSBtdWx0aWxpbmUgYmFja2VuZCByZXR1cm4gdHlwZSBrZWVwc1xuICAgKiBpdHMgbGVhZGluZyBjb250aW51YXRpb24gYXN0ZXJpc2tzIGluIHRoZSBjYXB0dXJlZCBzdWJzdHJpbmcsIHdoaWNoIGFyZSBpbnZhbGlkIGluc2lkZVxuICAgKiBhbiBpbmxpbmUgY2FzdCBhbmQgbWFrZSBUeXBlU2NyaXB0IHJlYWQgdGhlIGFzc2VydGVkIHR5cGUgYXMgYHVuZGVmaW5lZGAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqc0RvY1R5cGUgLSBSYXcgY2FwdHVyZWQgSlNEb2MgdHlwZSwgcG9zc2libHkgbXVsdGlsaW5lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNpbmdsZS1saW5lIEpTRG9jIHR5cGUuXG4gICAqL1xuICBub3JtYWxpemVKc0RvY1R5cGUoanNEb2NUeXBlKSB7XG4gICAgcmV0dXJuIGpzRG9jVHlwZS5yZXBsYWNlKC9cXHMqXFxuXFxzKlxcKj9bIFxcdF0qL2csIFwiIFwiKS50cmltKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpzIGRvYyBwYXJhbWV0ZXJzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ganNEb2NUZXh0IC0gSlNEb2MgdGV4dCBpbnNpZGUgY29tbWVudCBtYXJrZXJzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e25hbWU6IHN0cmluZyB8IG51bGwsIHR5cGU6IHN0cmluZ30+fSAtIEpTRG9jIHBhcmFtZXRlcnMgKG5hbWUgKyB0eXBlKSBpbiBkZWNsYXJhdGlvbiBvcmRlci5cbiAgICovXG4gIGpzRG9jUGFyYW1ldGVycyhqc0RvY1RleHQpIHtcbiAgICBjb25zdCBwYXJhbWV0ZXJzID0gW11cbiAgICBjb25zdCBwYXJhbVJlZ2V4ID0gL0BwYXJhbVxccypcXHsvZ1xuICAgIGxldCBfcGFyYW1NYXRjaFxuXG4gICAgd2hpbGUgKChfcGFyYW1NYXRjaCA9IHBhcmFtUmVnZXguZXhlYyhqc0RvY1RleHQpKSkge1xuICAgICAgY29uc3QgdHlwZU9wZW5JbmRleCA9IHBhcmFtUmVnZXgubGFzdEluZGV4IC0gMVxuICAgICAgY29uc3QgdHlwZUNsb3NlSW5kZXggPSB0aGlzLm1hdGNoaW5nQnJhY2VJbmRleCh7b3BlbkluZGV4OiB0eXBlT3BlbkluZGV4LCBzb3VyY2VUZXh0OiBqc0RvY1RleHR9KVxuXG4gICAgICBpZiAodHlwZUNsb3NlSW5kZXggPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBwYXJzZSBKU0RvYyBwYXJhbWV0ZXIgdHlwZSBmcm9tOiAke2pzRG9jVGV4dH1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCB0eXBlID0gdGhpcy5ub3JtYWxpemVKc0RvY1R5cGUoanNEb2NUZXh0LnNsaWNlKHR5cGVPcGVuSW5kZXggKyAxLCB0eXBlQ2xvc2VJbmRleCkpXG5cbiAgICAgIGlmICh0eXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBub24tZW1wdHkgSlNEb2MgcGFyYW1ldGVyIHR5cGUgaW46ICR7anNEb2NUZXh0fWApXG4gICAgICB9XG5cbiAgICAgIC8vIEFmdGVyIHRoZSBjbG9zaW5nIGJyYWNlIHRoZSBwYXJhbWV0ZXIgbmFtZSBmb2xsb3dzIChvcHRpb25hbGx5IGJyYWNrZXRlZFxuICAgICAgLy8gZm9yIGBAcGFyYW0ge3R5cGV9IFtuYW1lXWApLiBDYXB0dXJlIHRoZSBsZWFkaW5nIG5hbWUgdG9rZW4g4oCUIGluY2x1ZGluZyBhbnlcbiAgICAgIC8vIGRvdHRlZCBwYXRoIHNvIG9iamVjdC1wcm9wZXJ0eSB0YWdzIGxpa2UgYEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1lc3NhZ2VgIHN0YXlcbiAgICAgIC8vIGRpc3Rpbmd1aXNoYWJsZSBmcm9tIHRoZSB0b3AtbGV2ZWwgYEBwYXJhbSB7b2JqZWN0fSBhcmdzYCBwYXJhbWV0ZXIuXG4gICAgICBjb25zdCBuYW1lTWF0Y2ggPSBqc0RvY1RleHQuc2xpY2UodHlwZUNsb3NlSW5kZXggKyAxKS5tYXRjaCgvXlxccypcXFs/XFxzKihbQS1aYS16XyRdW1xcdyQuXSopLylcblxuICAgICAgcGFyYW1ldGVycy5wdXNoKHtuYW1lOiBuYW1lTWF0Y2ggPyBuYW1lTWF0Y2hbMV0gOiBudWxsLCB0eXBlfSlcbiAgICAgIHBhcmFtUmVnZXgubGFzdEluZGV4ID0gdHlwZUNsb3NlSW5kZXggKyAxXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcmFtZXRlcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGphdmFzY3JpcHQgZmlsZXMgaW4gZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlyZWN0b3J5IC0gRGlyZWN0b3J5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBKYXZhU2NyaXB0IHNvdXJjZSBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgamF2YXNjcmlwdEZpbGVzSW5EaXJlY3RvcnkoZGlyZWN0b3J5KSB7XG4gICAgbGV0IGVudHJpZXNcblxuICAgIHRyeSB7XG4gICAgICBlbnRyaWVzID0gYXdhaXQgZnMucmVhZGRpcihkaXJlY3RvcnksIHt3aXRoRmlsZVR5cGVzOiB0cnVlfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yICYmIHR5cGVvZiBlcnJvciA9PSBcIm9iamVjdFwiICYmIFwiY29kZVwiIGluIGVycm9yICYmIGVycm9yLmNvZGUgPT09IFwiRU5PRU5UXCIpIHJldHVybiBbXVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIGNvbnN0IGZpbGVQYXRocyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgIGNvbnN0IGVudHJ5UGF0aCA9IHBhdGguam9pbihkaXJlY3RvcnksIGVudHJ5Lm5hbWUpXG5cbiAgICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgIGZpbGVQYXRocy5wdXNoKC4uLmF3YWl0IHRoaXMuamF2YXNjcmlwdEZpbGVzSW5EaXJlY3RvcnkoZW50cnlQYXRoKSlcbiAgICAgIH0gZWxzZSBpZiAoZW50cnkuaXNGaWxlKCkgJiYgL1xcLihtanN8anN8anN4fHRzKSQvLnRlc3QoZW50cnkubmFtZSkpIHtcbiAgICAgICAgZmlsZVBhdGhzLnB1c2goZW50cnlQYXRoKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWxlUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhIG1hdGNoaW5nIGNsb3NpbmcgYnJhY2Ugd2hpbGUgcmVzcGVjdGluZyBKYXZhU2NyaXB0IHN0cmluZ3MgYW5kIGNvbW1lbnRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mub3BlbkluZGV4IC0gT3BlbmluZyBicmFjZSBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc291cmNlVGV4dCAtIFNvdXJjZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBDbG9zaW5nIGJyYWNlIGluZGV4IHdoZW4gZm91bmQuXG4gICAqL1xuICBtYXRjaGluZ0JyYWNlSW5kZXgoe29wZW5JbmRleCwgc291cmNlVGV4dH0pIHtcbiAgICBpZiAoc291cmNlVGV4dFtvcGVuSW5kZXhdICE9PSBcIntcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvcGVuaW5nIGJyYWNlIGF0IGluZGV4ICR7b3BlbkluZGV4fWApXG4gICAgfVxuXG4gICAgbGV0IGRlcHRoID0gMFxuICAgIGxldCBpbkJsb2NrQ29tbWVudCA9IGZhbHNlXG4gICAgbGV0IGluTGluZUNvbW1lbnQgPSBmYWxzZVxuICAgIGxldCBpblN0cmluZyA9IFwiXCJcblxuICAgIGZvciAobGV0IGluZGV4ID0gb3BlbkluZGV4OyBpbmRleCA8IHNvdXJjZVRleHQubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICBjb25zdCBjaGFyID0gc291cmNlVGV4dFtpbmRleF1cbiAgICAgIGNvbnN0IG5leHRDaGFyID0gc291cmNlVGV4dFtpbmRleCArIDFdXG4gICAgICBjb25zdCBwcmV2aW91c0NoYXIgPSBzb3VyY2VUZXh0W2luZGV4IC0gMV1cblxuICAgICAgaWYgKGluTGluZUNvbW1lbnQpIHtcbiAgICAgICAgaWYgKGNoYXIgPT09IFwiXFxuXCIpIGluTGluZUNvbW1lbnQgPSBmYWxzZVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpbkJsb2NrQ29tbWVudCkge1xuICAgICAgICBpZiAoY2hhciA9PT0gXCIqXCIgJiYgbmV4dENoYXIgPT09IFwiL1wiKSB7XG4gICAgICAgICAgaW5CbG9ja0NvbW1lbnQgPSBmYWxzZVxuICAgICAgICAgIGluZGV4KytcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpblN0cmluZykge1xuICAgICAgICBpZiAoY2hhciA9PT0gaW5TdHJpbmcgJiYgcHJldmlvdXNDaGFyICE9PSBcIlxcXFxcIikgaW5TdHJpbmcgPSBcIlwiXG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiL1wiICYmIG5leHRDaGFyID09PSBcIi9cIikge1xuICAgICAgICBpbkxpbmVDb21tZW50ID0gdHJ1ZVxuICAgICAgICBpbmRleCsrXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIi9cIiAmJiBuZXh0Q2hhciA9PT0gXCIqXCIpIHtcbiAgICAgICAgaW5CbG9ja0NvbW1lbnQgPSB0cnVlXG4gICAgICAgIGluZGV4KytcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiXFxcIlwiIHx8IGNoYXIgPT09IFwiJ1wiIHx8IGNoYXIgPT09IFwiYFwiKSB7XG4gICAgICAgIGluU3RyaW5nID0gY2hhclxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgICAgZGVwdGgrK1xuICAgICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgICBkZXB0aC0tXG5cbiAgICAgICAgaWYgKGRlcHRoID09PSAwKSByZXR1cm4gaW5kZXhcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgbW9kZWwgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbH0gLSBBdHRyaWJ1dGUgY29uZmlnIGluZmVycmVkIGZyb20gdGhlIGJhY2tlbmQgbW9kZWwgd2hlbiBhdmFpbGFibGUuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0Zvck1vZGVsQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGlmICghbW9kZWxDbGFzcykge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAoIXJlc29sdmVkQXR0cmlidXRlTmFtZSkgcmV0dXJuIG51bGxcblxuICAgIGxldCBjb2x1bW5OYW1lXG5cbiAgICB0cnkge1xuICAgICAgY29sdW1uTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Jlc29sdmVkQXR0cmlidXRlTmFtZV1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhcInVzZWQgYmVmb3JlIGluaXRpYWxpemF0aW9uXCIpKSByZXR1cm4gbnVsbFxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIGlmICghY29sdW1uTmFtZSkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBsZXQgY29sdW1uXG5cbiAgICB0cnkge1xuICAgICAgY29sdW1uID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5zSGFzaCgpW2NvbHVtbk5hbWVdXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJ1c2VkIGJlZm9yZSBpbml0aWFsaXphdGlvblwiKSkgcmV0dXJuIG51bGxcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gY29sdW1uID8gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckNvbHVtbih7Y29sdW1ufSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGZvciBjb2x1bW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdH0gYXJncy5jb2x1bW4gLSBEYXRhYmFzZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30gLSBBdHRyaWJ1dGUgY29uZmlnIGluZmVycmVkIGZyb20gdGhlIGRhdGFiYXNlIGNvbHVtbi5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yQ29sdW1uKHtjb2x1bW59KSB7XG4gICAgY29uc3QgdHlwZSA9IGNvbHVtbi5nZXRUeXBlKClcblxuICAgIGlmICh0eXBlb2YgdHlwZSAhPSBcInN0cmluZ1wiIHx8IHR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBub24tZW1wdHkgY29sdW1uIHR5cGUgZm9yIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBpbmZlcmVuY2UsIGdvdDogJHt0eXBlfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG51bGw6IGNvbHVtbi5nZXROdWxsKCksXG4gICAgICB0eXBlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwcyBmb3IgbW9kZWwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MubW9kZWxDb25maWcgLSBNb2RlbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gW2FyZ3MucmVzb3VyY2VDbGFzc10gLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge0FycmF5PHthdXRvbG9hZDogYm9vbGVhbiwgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB0YXJnZXRDbGFzc05hbWU6IHN0cmluZywgdGFyZ2V0RmlsZU5hbWU6IHN0cmluZywgdHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn0+fSAtIFJlbGF0aW9uc2hpcHMuXG4gICAqL1xuICByZWxhdGlvbnNoaXBzRm9yTW9kZWwoe2NsYXNzTmFtZSwgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IG1vZGVsQ29uZmlnLnJlbGF0aW9uc2hpcHNcblxuICAgIGlmIChyZWxhdGlvbnNoaXBzID09PSB1bmRlZmluZWQgfHwgcmVsYXRpb25zaGlwcyA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICcke2NsYXNzTmFtZX0nIGhhcyBpbnZhbGlkIHJlbGF0aW9uc2hpcHMgY29uZmlnIOKAlCBtdXN0IGJlIGFuIGFycmF5IG9mIHJlbGF0aW9uc2hpcCBuYW1lcywgZ290ICR7dHlwZW9mIHJlbGF0aW9uc2hpcHN9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwcy5tYXAoKHJlbGF0aW9uc2hpcE5hbWUpID0+IHRoaXMuaW5mZXJyZWRSZWxhdGlvbnNoaXBEZWZpbml0aW9uKHtjbGFzc05hbWUsIHJlbGF0aW9uc2hpcE5hbWUsIHJlc291cmNlQ2xhc3N9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZmVycmVkIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gW2FyZ3MucmVzb3VyY2VDbGFzc10gLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge3thdXRvbG9hZDogYm9vbGVhbiwgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB0YXJnZXRDbGFzc05hbWU6IHN0cmluZywgdGFyZ2V0RmlsZU5hbWU6IHN0cmluZywgdHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn19IEluZmVycmVkIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKi9cbiAgaW5mZXJyZWRSZWxhdGlvbnNoaXBEZWZpbml0aW9uKHtjbGFzc05hbWUsIHJlbGF0aW9uc2hpcE5hbWUsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MgPyByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKSA6IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldE1vZGVsQ2xhc3MoY2xhc3NOYW1lKVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gcmVsYXRpb25zaGlwLmdldFR5cGUoKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiYmVsb25nc1RvXCIgJiYgcmVsYXRpb25zaGlwVHlwZSAhPT0gXCJoYXNPbmVcIiAmJiByZWxhdGlvbnNoaXBUeXBlICE9PSBcImhhc01hbnlcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAnJHtjbGFzc05hbWV9JyByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nIGhhcyB1bnN1cHBvcnRlZCB0eXBlICcke3JlbGF0aW9uc2hpcFR5cGV9J2ApXG4gICAgfVxuXG4gICAgbGV0IHRhcmdldENsYXNzTmFtZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgIHRhcmdldENsYXNzTmFtZSA9IHRhcmdldE1vZGVsQ2xhc3M/LmdldE1vZGVsTmFtZSgpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBNb2RlbCBjbGFzcyBub3QgcmVnaXN0ZXJlZCB5ZXQg4oCUIGZhbGwgYmFjayB0byBjbGFzc05hbWUgZnJvbSByZWxhdGlvbnNoaXAgZGVmaW5pdGlvblxuICAgIH1cblxuICAgIGlmICghdGFyZ2V0Q2xhc3NOYW1lKSB7XG4gICAgICB0YXJnZXRDbGFzc05hbWUgPSByZWxhdGlvbnNoaXAuY2xhc3NOYW1lXG5cbiAgICAgIGlmICghdGFyZ2V0Q2xhc3NOYW1lKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJyR7Y2xhc3NOYW1lfScgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9JyBoYXMgbm8gdGFyZ2V0IG1vZGVsIGNsYXNzYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYXV0b2xvYWQ6IHJlbGF0aW9uc2hpcC5nZXRBdXRvbG9hZCgpLFxuICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgIHRhcmdldENsYXNzTmFtZSxcbiAgICAgIHRhcmdldEZpbGVOYW1lOiBpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUodGFyZ2V0Q2xhc3NOYW1lKSksXG4gICAgICB0eXBlOiByZWxhdGlvbnNoaXBUeXBlXG4gICAgfVxuICB9XG59XG4iXX0=
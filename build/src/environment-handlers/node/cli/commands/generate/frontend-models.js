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
        fileContent += "}\n";
        fileContent += "\n";
        fileContent += `FrontendModelBase.registerModel(${className})\n`;
        fileContent += "\n";
        // Static generic methods cannot retain the generated subclass identity when structurally compared.
        fileContent += `const Generated${className}Class = /** @type {Omit<typeof ${className}, "onDestroy"> & {onDestroy: (callback: (payload: {id: ${eventPrimaryKeyValueType}}) => void, options?: import(${JSON.stringify(importPath)}).FrontendModelEventOptions) => Promise<() => void>}} */ (/** @type {unknown} */ (${className}))\n`;
        fileContent += "\n";
        fileContent += `export {Generated${className}Class as ${className}}\n`;
        fileContent += "\n";
        fileContent += `export default Generated${className}Class\n`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL2dlbmVyYXRlL2Zyb250ZW5kLW1vZGVscy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSxvQ0FBb0MsQ0FBQTtBQUM1RCxPQUFPLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDNUIsT0FBTyxtQkFBbUIsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1RCxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLDhCQUE4QixFQUFFLG1EQUFtRCxFQUFDLE1BQU0sc0RBQXNELENBQUE7QUFDeEosT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGdEQUFnRCxFQUFDLE1BQU0sdURBQXVELENBQUE7QUFDaEssT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0seURBQXlELENBQUE7QUFFaEg7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNIOzs7R0FHRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUNILE1BQU0sa0NBQWtDLEdBQUcsb0NBQW9DLENBQUE7QUFFL0UsbUdBQW1HO0FBQ25HLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0JBQXlCLFNBQVEsV0FBVztJQUMvRCwyREFBMkQ7SUFDM0QsMEJBQTBCLEdBQUcsSUFBSSxDQUFBO0lBRWpDLGdFQUFnRTtJQUNoRSw2QkFBNkIsR0FBRyxJQUFJLENBQUE7SUFFcEM7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUM3QyxNQUFNLGVBQWUsR0FBRyxhQUFhLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtRQUUxRCxNQUFN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Z0JBQWdCLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDeEcsTUFBTSxJQUFJLEtBQUssQ0FBQyxVQUFVLFNBQVMsbUJBQW1CLGdCQUFnQiwyQkFBMkIsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZILENBQUM7UUFFRCxJQUFJLGVBQWUsQ0FBQTtRQUVuQixJQUFJLENBQUM7WUFDSCxNQUFNLGdCQUFnQixHQUFHLFlBQVksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1lBRTNELGVBQWUsR0FBRyxnQkFBZ0IsRUFBRSxZQUFZLEVBQUUsQ0FBQTtRQUNwRCxDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1AsdUZBQXVGO1FBQ3pGLENBQUM7UUFFRCxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7WUFDckIsZUFBZSxHQUFHLFlBQVksQ0FBQyxTQUFTLENBQUE7WUFFeEMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO2dCQUNyQixNQUFNLElBQUksS0FBSyxDQUFDLFVBQVUsU0FBUyxtQkFBbUIsZ0JBQWdCLDZCQUE2QixDQUFDLENBQUE7WUFDdEcsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPO1lBQ0wsUUFBUSxFQUFFLFlBQVksQ0FBQyxXQUFXLEVBQUU7WUFDcEMsZ0JBQWdCO1lBQ2hCLGVBQWU7WUFDZixjQUFjLEVBQUUsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBQzVFLElBQUksRUFBRSxnQkFBZ0I7U0FDdkIsQ0FBQTtJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCBnZW5lcmF0ZWRGaWxlQmFubmVyIGZyb20gXCIuL2dlbmVyYXRlZC1maWxlLWJhbm5lci5qc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VJc0J1aWx0SW4sIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2Zyb250ZW5kLW1vZGVscy9idWlsdC1pbi1yZXNvdXJjZXMuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb259IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCJcblxuLyoqXG4gKiBBdHRyaWJ1dGUgbWV0YWRhdGEgdXNlZCBmb3IgZ2VuZXJhdGVkIGZyb250ZW5kLW1vZGVsIEpTRG9jLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRBdHRyaWJ1dGVDb25maWdcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBDb2x1bW4gdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29sdW1uVHlwZV0gLSBDb2x1bW4gdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbc3FsVHlwZV0gLSBTUUwgdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YVR5cGVdIC0gRGF0YSB0eXBlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtqc0RvY1R5cGVdIC0gRXhhY3QgSlNEb2MgdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBBdHRyaWJ1dGUgbmFtZSB3aGVuIGNvbmZpZ3VyZWQgYXMgYW4gYXJyYXkgZW50cnkuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtudWxsXSAtIFdoZXRoZXIgbnVsbCBpcyBhbGxvd2VkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc2VsZWN0ZWRCeURlZmF1bHRdIC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGlzIHNlbGVjdGVkIGJ5IGRlZmF1bHQuXG4gKiBAcHJvcGVydHkgeygpID0+IHN0cmluZ30gW2dldFR5cGVdIC0gUmV0dXJucyBjb2x1bW4gdHlwZS5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gYm9vbGVhbn0gW2dldE51bGxdIC0gUmV0dXJucyB3aGV0aGVyIG51bGwgaXMgYWxsb3dlZC5cbiAqL1xuLyoqXG4gKiBQZXJtaXQgc3BlYyByZXR1cm5lZCBieSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMgZHVyaW5nIGdlbmVyYXRpb24uXG4gKiBAdHlwZWRlZiB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEdlbmVyYXRvclBlcm1pdFNwZWM+Pn0gRnJvbnRlbmRNb2RlbEdlbmVyYXRvclBlcm1pdFNwZWNcbiAqL1xuLyoqXG4gKiBKU0RvYyBpbXBvcnQgYWxpYXMgZXh0cmFjdGVkIGZyb20gYSBiYWNrZW5kIHJlc291cmNlIHNvdXJjZSBmaWxlLlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb3VyY2VKc0RvY0ltcG9ydEFsaWFzXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaW1wb3J0ZWROYW1lIC0gRXhwb3J0ZWQgdHlwZSBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNwZWNpZmllciAtIEltcG9ydCBzcGVjaWZpZXIgZnJvbSB0aGUgc291cmNlIGZpbGUuXG4gKi9cbi8qKlxuICogSlNEb2MgcmV0dXJuIHR5cGUgZXh0cmFjdGVkIGZyb20gYSBiYWNrZW5kIHJlc291cmNlIG1ldGhvZC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZVxuICogQHByb3BlcnR5IHtNYXA8c3RyaW5nLCBSZXNvdXJjZUpzRG9jSW1wb3J0QWxpYXM+fSBpbXBvcnRBbGlhc2VzIC0gSW1wb3J0IGFsaWFzZXMgdmlzaWJsZSBpbiB0aGUgc291cmNlIGZpbGUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHNvdXJjZUZpbGUgLSBTb3VyY2UgZmlsZSB0aGF0IGRlY2xhcmVkIHRoZSBtZXRob2QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdHlwZSAtIEpTRG9jIHJldHVybiB0eXBlLlxuICovXG4vKipcbiAqIEpTRG9jIHBhcmFtZXRlciB0eXBlIGV4dHJhY3RlZCBmcm9tIGEgYmFja2VuZCByZXNvdXJjZSBtZXRob2QuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVcbiAqIEBwcm9wZXJ0eSB7TWFwPHN0cmluZywgUmVzb3VyY2VKc0RvY0ltcG9ydEFsaWFzPn0gaW1wb3J0QWxpYXNlcyAtIEltcG9ydCBhbGlhc2VzIHZpc2libGUgaW4gdGhlIHNvdXJjZSBmaWxlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBuYW1lIC0gUGFyYW1ldGVyIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHNvdXJjZUZpbGUgLSBTb3VyY2UgZmlsZSB0aGF0IGRlY2xhcmVkIHRoZSBtZXRob2QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdHlwZSAtIEpTRG9jIHBhcmFtZXRlciB0eXBlLlxuICovXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfUkVHRU5FUkFURV9DT01NQU5EID0gXCJ2ZWxvY2lvdXMgZ2VuZXJhdGU6ZnJvbnRlbmQtbW9kZWxzXCJcblxuLyoqIE5vZGUgQ0xJIGNvbW1hbmQgdGhhdCBnZW5lcmF0ZXMgZnJvbnRlbmQgbW9kZWwgY2xhc3NlcyBmcm9tIGJhY2tlbmQgcHJvamVjdCByZXNvdXJjZSBjb25maWcuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBEYkdlbmVyYXRlRnJvbnRlbmRNb2RlbHMgZXh0ZW5kcyBCYXNlQ29tbWFuZCB7XG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlPiB8IG51bGx9ICovXG4gIF9yZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzID0gbnVsbFxuXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlW10+IHwgbnVsbH0gKi9cbiAgX3Jlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMgPSBudWxsXG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBmaWxlcyBhcmUgZ2VuZXJhdGVkLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBiYWNrZW5kUHJvamVjdHMgPSBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpXG5cbiAgICBhd2FpdCBjb25maWd1cmF0aW9uLmluaXRpYWxpemVNb2RlbHMoKVxuXG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuXG4gICAgaWYgKHR5cGVvZiBlbnZpcm9ubWVudEhhbmRsZXIuYXV0b0Rpc2NvdmVyUmVzb3VyY2VzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5hdXRvRGlzY292ZXJSZXNvdXJjZXMoY29uZmlndXJhdGlvbilcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoYmFja2VuZFByb2plY3RzKSB8fCBiYWNrZW5kUHJvamVjdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBiYWNrZW5kIHByb2plY3RzIGNvbmZpZ3VyZWQuIENvbmZpZ3VyZSAnYmFja2VuZFByb2plY3RzJyBpbiB5b3VyIGNvbmZpZ3VyYXRpb24gZmlyc3RcIilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFbnN1cmVkIGRpcmVjdG9yaWVzLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBlbnN1cmVkRGlyZWN0b3JpZXMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBHZW5lcmF0ZWQgbW9kZWwgbmFtZXMgYnkgZGlyZWN0b3J5LlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj59ICovXG4gICAgY29uc3QgZ2VuZXJhdGVkTW9kZWxOYW1lc0J5RGlyZWN0b3J5ID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVkIGZpbGVzIGJ5IGRpcmVjdG9yeS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgQXJyYXk8e2NsYXNzTmFtZTogc3RyaW5nLCBmaWxlTmFtZTogc3RyaW5nfT4+fSAqL1xuICAgIGNvbnN0IGdlbmVyYXRlZEZpbGVzQnlEaXJlY3RvcnkgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICAvLyBDYW5vbmljYWxpemUgdGhlIG91dHB1dCBkaXJlY3Rvcnkgc28gZXF1aXZhbGVudCBzcGVsbGluZ3MgKGEgdHJhaWxpbmdcbiAgICAgIC8vIHNsYXNoLCBgLmAvYC4uYCBzZWdtZW50cywgZHVwbGljYXRlIHNlcGFyYXRvcnMsIHJlbGF0aXZlIHZzIGFic29sdXRlKVxuICAgICAgLy8gcmVzb2x2ZSB0byBhIHNpbmdsZSBrZXkuIE90aGVyd2lzZSB0aGUgcGVyLWRpcmVjdG9yeSBtYXBzIGJlbG93IHRyZWF0XG4gICAgICAvLyB0aGVtIGFzIGRpZmZlcmVudCBkaXJlY3RvcmllcywgZHVwbGljYXRlIGNsYXNzIG5hbWVzIHNsaXAgcGFzdCBkZXRlY3Rpb24sXG4gICAgICAvLyBhbmQgdGhlIHNwbGl0IGJ1Y2tldHMgd3JpdGUgaW5jb21wbGV0ZSBpbmRleC5qcy9zZXR1cC5qcyBmb3IgZmlsZXMgdGhhdFxuICAgICAgLy8gYWN0dWFsbHkgbGFuZCBpbiB0aGUgc2FtZSBkaXJlY3Rvcnkgb24gZGlzay5cbiAgICAgIGNvbnN0IGZyb250ZW5kTW9kZWxzRGlyID0gcGF0aC5yZXNvbHZlKHRoaXMuZnJvbnRlbmRNb2RlbHNEaXJlY3RvcnlGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdCkpXG4gICAgICBjb25zdCBpbXBvcnRQYXRoID0gdGhpcy5pbXBvcnRQYXRoRm9yRnJvbnRlbmRNb2RlbHNEaXJlY3RvcnkoZnJvbnRlbmRNb2RlbHNEaXIpXG5cbiAgICAgIGlmICghZW5zdXJlZERpcmVjdG9yaWVzLmhhcyhmcm9udGVuZE1vZGVsc0RpcikpIHtcbiAgICAgICAgYXdhaXQgZnMubWtkaXIoZnJvbnRlbmRNb2RlbHNEaXIsIHtyZWN1cnNpdmU6IHRydWV9KVxuICAgICAgICBlbnN1cmVkRGlyZWN0b3JpZXMuYWRkKGZyb250ZW5kTW9kZWxzRGlyKVxuICAgICAgfVxuXG4gICAgICBpZiAoIWdlbmVyYXRlZEZpbGVzQnlEaXJlY3RvcnkuaGFzKGZyb250ZW5kTW9kZWxzRGlyKSkge1xuICAgICAgICBnZW5lcmF0ZWRGaWxlc0J5RGlyZWN0b3J5LnNldChmcm9udGVuZE1vZGVsc0RpciwgW10pXG4gICAgICB9XG5cbiAgICAgIGlmICghZ2VuZXJhdGVkTW9kZWxOYW1lc0J5RGlyZWN0b3J5Lmhhcyhmcm9udGVuZE1vZGVsc0RpcikpIHtcbiAgICAgICAgZ2VuZXJhdGVkTW9kZWxOYW1lc0J5RGlyZWN0b3J5LnNldChmcm9udGVuZE1vZGVsc0RpciwgbmV3IFNldCgpKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBnZW5lcmF0ZWRGaWxlcyA9IGdlbmVyYXRlZEZpbGVzQnlEaXJlY3RvcnkuZ2V0KGZyb250ZW5kTW9kZWxzRGlyKVxuICAgICAgY29uc3QgZ2VuZXJhdGVkTW9kZWxOYW1lcyA9IGdlbmVyYXRlZE1vZGVsTmFtZXNCeURpcmVjdG9yeS5nZXQoZnJvbnRlbmRNb2RlbHNEaXIpXG5cbiAgICAgIGlmICghZ2VuZXJhdGVkRmlsZXMpIHRocm93IG5ldyBFcnJvcihgR2VuZXJhdGVkIGZpbGVzIGxpc3QgbWlzc2luZyBmb3IgJHtmcm9udGVuZE1vZGVsc0Rpcn1gKVxuICAgICAgaWYgKCFnZW5lcmF0ZWRNb2RlbE5hbWVzKSB0aHJvdyBuZXcgRXJyb3IoYEdlbmVyYXRlZCBtb2RlbCBuYW1lcyBzZXQgbWlzc2luZyBmb3IgJHtmcm9udGVuZE1vZGVsc0Rpcn1gKVxuICAgICAgY29uc3QgcmVzb3VyY2VzID0gdGhpcy5yZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcbiAgICAgIGNvbnN0IGF2YWlsYWJsZUZyb250ZW5kTW9kZWxDbGFzc05hbWVzID0gdGhpcy5hdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcyhyZXNvdXJjZXMpXG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWxDbGFzc05hbWUgaW4gcmVzb3VyY2VzKSB7XG4gICAgICAgIGNvbnN0IG1vZGVsQ29uZmlnID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlc1ttb2RlbENsYXNzTmFtZV0pXG4gICAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUobW9kZWxDbGFzc05hbWUucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpKVxuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IGAke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShjbGFzc05hbWUpKX0uanNgXG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gYCR7ZnJvbnRlbmRNb2RlbHNEaXJ9LyR7ZmlsZU5hbWV9YFxuXG4gICAgICAgIGlmICghbW9kZWxDb25maWcpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZGVmaW5pdGlvbiBmb3IgJyR7Y2xhc3NOYW1lfSdgKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzb2x2ZWRSZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZXNbbW9kZWxDbGFzc05hbWVdKVxuICAgICAgICAvLyBBbiBhYnN0cmFjdCBiYXNlIHJlc291cmNlIChubyBzdGF0aWMgTW9kZWxDbGFzcyDigJQgZS5nLiBhbiBhcHAncyBzaGFyZWRcbiAgICAgICAgLy8gYEJhc2VSZXNvdXJjZWAgdGhhdCBvdGhlciByZXNvdXJjZXMgZXh0ZW5kKSBjYW4ndCBiYWNrIGEgZ2VuZXJhdGVkXG4gICAgICAgIC8vIGZyb250ZW5kIG1vZGVsLiBUcmVhdCBpdCBhcyByZXNvdXJjZS1sZXNzIHNvIHRoZSBnZW5lcmF0b3IgZmFsbHMgYmFja1xuICAgICAgICAvLyB0byBieS1uYW1lIG1vZGVsIGxvb2t1cCArIGVtcHR5IHdyaXRlIHBhcmFtcyBpbnN0ZWFkIG9mIHRocm93aW5nIHdoZW5cbiAgICAgICAgLy8gaXQgZWFnZXJseSBjYWxscyBgbW9kZWxDbGFzcygpYCAvIGBwZXJtaXR0ZWRQYXJhbXMoKWAgb24gaXQuXG4gICAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSByZXNvbHZlZFJlc291cmNlQ2xhc3MgJiYgcmVzb2x2ZWRSZXNvdXJjZUNsYXNzLk1vZGVsQ2xhc3MgPyByZXNvbHZlZFJlc291cmNlQ2xhc3MgOiBudWxsXG5cbiAgICAgICAgdGhpcy52YWxpZGF0ZU1vZGVsQ29uZmlnKHthdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcywgY2xhc3NOYW1lLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pXG5cbiAgICAgICAgaWYgKGdlbmVyYXRlZE1vZGVsTmFtZXMuaGFzKGNsYXNzTmFtZSkpIHtcbiAgICAgICAgICBpZiAoZnJvbnRlbmRNb2RlbFJlc291cmNlSXNCdWlsdEluKHttb2RlbE5hbWU6IG1vZGVsQ2xhc3NOYW1lLCByZXNvdXJjZURlZmluaXRpb246IHJlc291cmNlc1ttb2RlbENsYXNzTmFtZV19KSkge1xuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYER1cGxpY2F0ZSBmcm9udGVuZCBtb2RlbCBkZWZpbml0aW9uIGZvciAnJHtjbGFzc05hbWV9J2ApXG4gICAgICAgIH1cblxuICAgICAgICBnZW5lcmF0ZWRNb2RlbE5hbWVzLmFkZChjbGFzc05hbWUpXG5cbiAgICAgICAgY29uc3QgZmlsZUNvbnRlbnQgPSBhd2FpdCB0aGlzLmJ1aWxkTW9kZWxGaWxlQ29udGVudCh7XG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aDogZmlsZVBhdGgsXG4gICAgICAgICAgaW1wb3J0UGF0aCxcbiAgICAgICAgICBtb2RlbENsYXNzOiByZXNvdXJjZUNsYXNzID8gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKCkgOiBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpW2NsYXNzTmFtZV0sXG4gICAgICAgICAgbW9kZWxDb25maWcsXG4gICAgICAgICAgcmVzb3VyY2VDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgZmlsZUNvbnRlbnQpXG4gICAgICAgIGdlbmVyYXRlZEZpbGVzLnB1c2goe2NsYXNzTmFtZSwgZmlsZU5hbWV9KVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBjcmVhdGUgc3JjL2Zyb250ZW5kLW1vZGVscy8ke2ZpbGVOYW1lfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbZnJvbnRlbmRNb2RlbHNEaXIsIGdlbmVyYXRlZEZpbGVzXSBvZiBnZW5lcmF0ZWRGaWxlc0J5RGlyZWN0b3J5KSB7XG4gICAgICAvLyBUaGUgaW5kZXguanMgYmFycmVsIGlzIG5vIGxvbmdlciBnZW5lcmF0ZWQg4oCUIG5vdGhpbmcgaW1wb3J0cyBpdCAobW9kZWxzIGFyZVxuICAgICAgLy8gaW1wb3J0ZWQgYnkgZmlsZSBwYXRoLCBhbmQgc2V0dXAuanMgcGVyZm9ybXMgdGhlIHJlZ2lzdHJhdGlvbiBzaWRlLWVmZmVjdHMpLlxuICAgICAgLy8gUmVtb3ZlIGFueSBzdGFsZSBvbmUgbGVmdCBmcm9tIGFuIG9sZGVyIGdlbmVyYXRvci5cbiAgICAgIGF3YWl0IGZzLnJtKGAke2Zyb250ZW5kTW9kZWxzRGlyfS9pbmRleC5qc2AsIHtmb3JjZTogdHJ1ZX0pXG5cbiAgICAgIGNvbnN0IHNldHVwQ29udGVudCA9IHRoaXMuYnVpbGRTZXR1cEZpbGVDb250ZW50KGdlbmVyYXRlZEZpbGVzKVxuXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUoYCR7ZnJvbnRlbmRNb2RlbHNEaXJ9L3NldHVwLmpzYCwgc2V0dXBDb250ZW50KVxuXG4gICAgICBjb25zb2xlLmxvZyhcImNyZWF0ZSBzcmMvZnJvbnRlbmQtbW9kZWxzL3NldHVwLmpzXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdmFsaWRhdGUgbW9kZWwgY29uZmlnLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gYXJncy5hdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcyAtIEF2YWlsYWJsZSBmcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lcyBpbiBiYWNrZW5kIHByb2plY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5tb2RlbENvbmZpZyAtIE1vZGVsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSBbYXJncy5yZXNvdXJjZUNsYXNzXSAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB2YWxpZGF0ZU1vZGVsQ29uZmlnKHthdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcywgY2xhc3NOYW1lLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBjb25zdCBhYmlsaXRpZXMgPSBtb2RlbENvbmZpZy5hYmlsaXRpZXNcblxuICAgIGlmICghYWJpbGl0aWVzIHx8IHR5cGVvZiBhYmlsaXRpZXMgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJyR7Y2xhc3NOYW1lfScgaXMgbWlzc2luZyByZXF1aXJlZCAnYWJpbGl0aWVzJyBjb25maWdgKVxuICAgIH1cblxuICAgIGNvbnN0IHJlYWRBY3Rpb25zID0gW1xuICAgICAge2FjdGlvbjogXCJpbmRleFwiLCBhYmlsaXR5QWN0aW9uOiBhYmlsaXRpZXMuaW5kZXh9LFxuICAgICAge2FjdGlvbjogXCJmaW5kXCIsIGFiaWxpdHlBY3Rpb246IGFiaWxpdGllcy5maW5kfVxuICAgIF1cblxuICAgIGZvciAoY29uc3Qge2FjdGlvbiwgYWJpbGl0eUFjdGlvbn0gb2YgcmVhZEFjdGlvbnMpIHtcbiAgICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAnJHtjbGFzc05hbWV9JyBpcyBtaXNzaW5nIHJlcXVpcmVkIGFiaWxpdGllcy4ke2FjdGlvbn0gY29uZmlnYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gbW9kZWxDb25maWcucmVsYXRpb25zaGlwc1xuXG4gICAgaWYgKHJlbGF0aW9uc2hpcHMgPT09IHVuZGVmaW5lZCkgcmV0dXJuXG5cbiAgICBjb25zdCBub3JtYWxpemVkUmVsYXRpb25zaGlwcyA9IHRoaXMucmVsYXRpb25zaGlwc0Zvck1vZGVsKHtjbGFzc05hbWUsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSlcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIG5vcm1hbGl6ZWRSZWxhdGlvbnNoaXBzKSB7XG4gICAgICBpZiAoIWF2YWlsYWJsZUZyb250ZW5kTW9kZWxDbGFzc05hbWVzLmhhcyhyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICcke2NsYXNzTmFtZX0nIHJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0nIHJlZmVyZW5jZXMgJyR7cmVsYXRpb25zaGlwLnRhcmdldENsYXNzTmFtZX0nLCBidXQgbm8gZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZXhpc3RzIGZvciB0aGF0IHRhcmdldCBpbiB0aGlzIGJhY2tlbmQgcHJvamVjdGApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2VzIGZvciBiYWNrZW5kIHByb2plY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbj59IC0gUmVzb3VyY2UgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbW9kZWwgY2xhc3MgbmFtZS5cbiAgICovXG4gIHJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KSB7XG4gICAgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF2YWlsYWJsZSBmcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb24+fSByZXNvdXJjZXMgLSBSZXNvdXJjZSBjb25maWd1cmF0aW9uIGtleWVkIGJ5IG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBBdmFpbGFibGUgZnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZXMuXG4gICAqL1xuICBhdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcyhyZXNvdXJjZXMpIHtcbiAgICAvKipcbiAgICAgKiBDbGFzcyBuYW1lcy5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgY2xhc3NOYW1lcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCByZXNvdXJjZU1vZGVsTmFtZSBpbiByZXNvdXJjZXMpIHtcbiAgICAgIGNsYXNzTmFtZXMuYWRkKGluZmxlY3Rpb24uY2FtZWxpemUocmVzb3VyY2VNb2RlbE5hbWUucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpKSlcbiAgICB9XG5cbiAgICByZXR1cm4gY2xhc3NOYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWxzIGRpcmVjdG9yeSBmb3IgYmFja2VuZCBwcm9qZWN0LlxuICAgKiBAcGFyYW0ge3tmcm9udGVuZE1vZGVsc091dHB1dFBhdGg/OiBzdHJpbmd9fSBiYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBjb25maWcuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQWJzb2x1dGUgZnJvbnRlbmQgbW9kZWxzIG91dHB1dCBkaXJlY3RvcnkuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsc0RpcmVjdG9yeUZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KSB7XG4gICAgY29uc3Qgb3V0cHV0UGF0aCA9IGJhY2tlbmRQcm9qZWN0LmZyb250ZW5kTW9kZWxzT3V0cHV0UGF0aCB8fCB0aGlzLmRpcmVjdG9yeSgpXG5cbiAgICByZXR1cm4gYCR7b3V0cHV0UGF0aH0vc3JjL2Zyb250ZW5kLW1vZGVsc2BcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGltcG9ydCBwYXRoIGZvciBmcm9udGVuZCBtb2RlbHMgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZnJvbnRlbmRNb2RlbHNEaXIgLSBGcm9udGVuZCBtb2RlbHMgb3V0cHV0IGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBCYXNlIGNsYXNzIGltcG9ydCBwYXRoLlxuICAgKi9cbiAgaW1wb3J0UGF0aEZvckZyb250ZW5kTW9kZWxzRGlyZWN0b3J5KGZyb250ZW5kTW9kZWxzRGlyKSB7XG4gICAgY29uc3QgZGV2TW9kZSA9IGZyb250ZW5kTW9kZWxzRGlyLmluY2x1ZGVzKFwiL3NwZWMvZHVtbXkvc3JjL2Zyb250ZW5kLW1vZGVsc1wiKVxuXG4gICAgaWYgKGRldk1vZGUpIHtcbiAgICAgIHJldHVybiBcIi4uLy4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiXG4gICAgfVxuXG4gICAgcmV0dXJuIFwidmVsb2Npb3VzL2J1aWxkL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBtb2RlbCBmaWxlIGNvbnRlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTWV0aG9kIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZyb250ZW5kTW9kZWxGaWxlUGF0aCAtIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmltcG9ydFBhdGggLSBCYXNlIGNsYXNzIGltcG9ydCBwYXRoLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLm1vZGVsQ29uZmlnIC0gTW9kZWwgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IFthcmdzLnJlc291cmNlQ2xhc3NdIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gR2VuZXJhdGVkIGZpbGUgY29udGVudC5cbiAgICovXG4gIGFzeW5jIGJ1aWxkTW9kZWxGaWxlQ29udGVudCh7Y2xhc3NOYW1lLCBmcm9udGVuZE1vZGVsRmlsZVBhdGgsIGltcG9ydFBhdGgsIG1vZGVsQ2xhc3MsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLmF0dHJpYnV0ZURlZmluaXRpb25zRm9yTW9kZWwoe2NsYXNzTmFtZSwgbW9kZWxDbGFzcywgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSB0aGlzLnJlbGF0aW9uc2hpcHNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBtb2RlbENvbmZpZy5hdHRhY2htZW50cyAmJiB0eXBlb2YgbW9kZWxDb25maWcuYXR0YWNobWVudHMgPT09IFwib2JqZWN0XCJcbiAgICAgID8gbW9kZWxDb25maWcuYXR0YWNobWVudHNcbiAgICAgIDoge31cbiAgICBjb25zdCBhdHRyaWJ1dGVzVHlwZU5hbWUgPSBgJHtjbGFzc05hbWV9QXR0cmlidXRlc2BcbiAgICBjb25zdCBjcmVhdGVBdHRyaWJ1dGVzVHlwZU5hbWUgPSBgJHtjbGFzc05hbWV9Q3JlYXRlQXR0cmlidXRlc2BcbiAgICBjb25zdCB1cGRhdGVBdHRyaWJ1dGVzVHlwZU5hbWUgPSBgJHtjbGFzc05hbWV9VXBkYXRlQXR0cmlidXRlc2BcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IGF0dHJpYnV0ZXMubWFwKChhdHRyaWJ1dGUpID0+IGF0dHJpYnV0ZS5uYW1lKVxuICAgIGNvbnN0IHBlcm1pdHRlZENyZWF0ZVBhcmFtcyA9IHRoaXMucGVybWl0dGVkUGFyYW1zRm9yR2VuZXJhdG9yKHJlc291cmNlQ2xhc3MgfHwgbnVsbCwgXCJjcmVhdGVcIilcbiAgICBjb25zdCBwZXJtaXR0ZWRVcGRhdGVQYXJhbXMgPSB0aGlzLnBlcm1pdHRlZFBhcmFtc0ZvckdlbmVyYXRvcihyZXNvdXJjZUNsYXNzIHx8IG51bGwsIFwidXBkYXRlXCIpXG4gICAgY29uc3QgbmVzdGVkV3JpdGVUeXBlcyA9IHRoaXMubmVzdGVkV3JpdGVUeXBlc0Zvck1vZGVsKHtjbGFzc05hbWUsIHBlcm1pdHRlZFBhcmFtczogcGVybWl0dGVkQ3JlYXRlUGFyYW1zLmNvbmNhdChwZXJtaXR0ZWRVcGRhdGVQYXJhbXMpLCByZWxhdGlvbnNoaXBzfSlcbiAgICBjb25zdCB1c2VzVHJhbnNwb3J0VmFsdWUgPSBhdHRyaWJ1dGVzLnNvbWUoKGF0dHJpYnV0ZSkgPT4gYXR0cmlidXRlLmpzRG9jVHlwZS5pbmNsdWRlcyhcIkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVwiKSlcbiAgICAgIHx8IG5lc3RlZFdyaXRlVHlwZXMuc29tZSgobmVzdGVkV3JpdGVUeXBlKSA9PiBuZXN0ZWRXcml0ZVR5cGUuYXR0cmlidXRlcy5zb21lKChhdHRyaWJ1dGUpID0+IGF0dHJpYnV0ZS50eXBlLmluY2x1ZGVzKFwiRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXCIpKSlcbiAgICBjb25zdCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0ge1xuICAgICAgY3JlYXRlOiBtb2RlbENvbmZpZy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmNyZWF0ZSB8fCBcImNyZWF0ZVwiLFxuICAgICAgaW5kZXg6IG1vZGVsQ29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMuaW5kZXggfHwgXCJpbmRleFwiXG4gICAgfVxuICAgIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHtcbiAgICAgIGF0dGFjaDogbW9kZWxDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzLmF0dGFjaCB8fCBcImF0dGFjaFwiLFxuICAgICAgZGVzdHJveTogbW9kZWxDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzLmRlc3Ryb3kgfHwgXCJkZXN0cm95XCIsXG4gICAgICBkb3dubG9hZDogbW9kZWxDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzLmRvd25sb2FkIHx8IFwiZG93bmxvYWRcIixcbiAgICAgIGZpbmQ6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy5maW5kIHx8IFwiZmluZFwiLFxuICAgICAgdXBkYXRlOiBtb2RlbENvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMudXBkYXRlIHx8IFwidXBkYXRlXCIsXG4gICAgICB1cmw6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy51cmwgfHwgXCJ1cmxcIlxuICAgIH1cbiAgICBjb25zdCBjb2xsZWN0aW9uQ29tbWFuZHMgPSBtb2RlbENvbmZpZy5jb2xsZWN0aW9uQ29tbWFuZHNcbiAgICBjb25zdCBtZW1iZXJDb21tYW5kcyA9IG1vZGVsQ29uZmlnLm1lbWJlckNvbW1hbmRzXG4gICAgY29uc3QgZGVjbGFyZWRDb21tYW5kTWV0YWRhdGEgPSBtb2RlbENvbmZpZy5jb21tYW5kTWV0YWRhdGEgfHwge31cbiAgICBjb25zdCBjb21tYW5kTWV0YWRhdGEgPSBhd2FpdCB0aGlzLmNvbW1hbmRNZXRhZGF0YVdpdGhSZXNvdXJjZUpzRG9jKHtcbiAgICAgIGNvbW1hbmRNZXRhZGF0YTogZGVjbGFyZWRDb21tYW5kTWV0YWRhdGEsXG4gICAgICBjb21tYW5kTmFtZXM6IFsuLi5PYmplY3Qua2V5cyhjb2xsZWN0aW9uQ29tbWFuZHMpLCAuLi5PYmplY3Qua2V5cyhtZW1iZXJDb21tYW5kcyldLFxuICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgcmVzb3VyY2VDbGFzc1xuICAgIH0pXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc0FyZURlZmF1bHQgPSBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmNyZWF0ZSA9PT0gXCJjcmVhdGVcIiAmJiBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmluZGV4ID09PSBcImluZGV4XCJcbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHNBcmVEZWZhdWx0ID0gYnVpbHRJbk1lbWJlckNvbW1hbmRzLmF0dGFjaCA9PT0gXCJhdHRhY2hcIlxuICAgICAgJiYgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmRlc3Ryb3kgPT09IFwiZGVzdHJveVwiXG4gICAgICAmJiBidWlsdEluTWVtYmVyQ29tbWFuZHMuZG93bmxvYWQgPT09IFwiZG93bmxvYWRcIlxuICAgICAgJiYgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmZpbmQgPT09IFwiZmluZFwiXG4gICAgICAmJiBidWlsdEluTWVtYmVyQ29tbWFuZHMudXBkYXRlID09PSBcInVwZGF0ZVwiXG4gICAgICAmJiBidWlsdEluTWVtYmVyQ29tbWFuZHMudXJsID09PSBcInVybFwiXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlGb3JSZXNvdXJjZSh7YXR0cmlidXRlTmFtZXMsIG1vZGVsQ2xhc3MsIG1vZGVsQ29uZmlnfSlcbiAgICBjb25zdCBwcmltYXJ5S2V5VmFsdWVUeXBlID0gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleVZhbHVlVHlwZSh7YXR0cmlidXRlc1R5cGVOYW1lLCBwcmltYXJ5S2V5fSlcbiAgICBjb25zdCBldmVudFByaW1hcnlLZXlWYWx1ZVR5cGUgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleVZhbHVlVHlwZSA6IFwic3RyaW5nXCJcblxuICAgIGxldCBmaWxlQ29udGVudCA9IGdlbmVyYXRlZEZpbGVCYW5uZXIoRlJPTlRFTkRfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORClcblxuICAgIGZpbGVDb250ZW50ICs9IGBpbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2UgZnJvbSBcIiR7aW1wb3J0UGF0aH1cIlxcbmBcblxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZy5cXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEB0eXBlZGVmIHtpbXBvcnQoXCIke2ltcG9ydFBhdGh9XCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgKiBGYWxsYmFjayBhdHRyaWJ1dGUgdmFsdWUgdHlwZSBmb3IgZ2VuZXJhdGVkIGZpZWxkcyB3aXRob3V0IG5hcnJvd2VyIG1ldGFkYXRhLlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEB0eXBlZGVmIHtpbXBvcnQoXCIke2ltcG9ydFBhdGh9XCIpLkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZX0gRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBpZiAodXNlc1RyYW5zcG9ydFZhbHVlKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqIFZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBhbmQgZGVzZXJpYWxpemF0aW9uLlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge2ltcG9ydChcIiR7aW1wb3J0UGF0aH1cIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblwiXG4gICAgfVxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqICR7YXR0cmlidXRlc1R5cGVOYW1lfSB0eXBlLlxcbmBcbiAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge29iamVjdH0gJHthdHRyaWJ1dGVzVHlwZU5hbWV9XFxuYFxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAcHJvcGVydHkgeyR7YXR0cmlidXRlLmpzRG9jVHlwZX19ICR7YXR0cmlidXRlLm5hbWV9IC0gQXR0cmlidXRlIHZhbHVlLlxcbmBcbiAgICB9XG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgKi9cXG5cIlxuICAgIGZvciAoY29uc3QgbmVzdGVkV3JpdGVUeXBlIG9mIG5lc3RlZFdyaXRlVHlwZXMpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiLyoqXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBBdHRyaWJ1dGVzIGFjY2VwdGVkIGZvciBuZXN0ZWQgJHtuZXN0ZWRXcml0ZVR5cGUucmVsYXRpb25zaGlwTmFtZX0gd3JpdGVzLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAdHlwZWRlZiB7b2JqZWN0fSAke25lc3RlZFdyaXRlVHlwZS50eXBlTmFtZX1cXG5gXG4gICAgICBmb3IgKGNvbnN0IG5lc3RlZEF0dHJpYnV0ZSBvZiBuZXN0ZWRXcml0ZVR5cGUuYXR0cmlidXRlcykge1xuICAgICAgICBmaWxlQ29udGVudCArPSBgICogQHByb3BlcnR5IHske25lc3RlZEF0dHJpYnV0ZS50eXBlfX0gWyR7bmVzdGVkQXR0cmlidXRlLm5hbWV9XSAtIE5lc3RlZCAke25lc3RlZEF0dHJpYnV0ZS5uYW1lfSB2YWx1ZS5cXG5gXG4gICAgICB9XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblwiXG4gICAgfVxuICAgIGZpbGVDb250ZW50ICs9IGF3YWl0IHRoaXMud3JpdGVBdHRyaWJ1dGVzVHlwZWRlZih7YXR0cmlidXRlcywgYXR0cmlidXRlc1R5cGVOYW1lLCBtb2RlbENsYXNzLCBuZXN0ZWRXcml0ZVR5cGVzLCBwZXJtaXR0ZWRQYXJhbXM6IHBlcm1pdHRlZENyZWF0ZVBhcmFtcywgcmVzb3VyY2VDbGFzcywgdHlwZU5hbWU6IGNyZWF0ZUF0dHJpYnV0ZXNUeXBlTmFtZX0pXG4gICAgZmlsZUNvbnRlbnQgKz0gYXdhaXQgdGhpcy53cml0ZUF0dHJpYnV0ZXNUeXBlZGVmKHthdHRyaWJ1dGVzLCBhdHRyaWJ1dGVzVHlwZU5hbWUsIG1vZGVsQ2xhc3MsIG5lc3RlZFdyaXRlVHlwZXMsIHBlcm1pdHRlZFBhcmFtczogcGVybWl0dGVkVXBkYXRlUGFyYW1zLCByZXNvdXJjZUNsYXNzLCB0eXBlTmFtZTogdXBkYXRlQXR0cmlidXRlc1R5cGVOYW1lfSlcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEZyb250ZW5kIG1vZGVsIGZvciAke2NsYXNzTmFtZX0uXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IGAgKiBAYXVnbWVudHMge0Zyb250ZW5kTW9kZWxCYXNlPCR7YXR0cmlidXRlc1R5cGVOYW1lfSwgJHtjcmVhdGVBdHRyaWJ1dGVzVHlwZU5hbWV9LCAke3VwZGF0ZUF0dHJpYnV0ZXNUeXBlTmFtZX0sICR7cHJpbWFyeUtleVZhbHVlVHlwZX0sICR7ZXZlbnRQcmltYXJ5S2V5VmFsdWVUeXBlfT59XFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgY2xhc3MgJHtjbGFzc05hbWV9IGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2Uge1xcbmBcbiAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlnLiAqL1xcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICAgIHJldHVybiB7XFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICAgICAgbW9kZWxOYW1lOiAke0pTT04uc3RyaW5naWZ5KGNsYXNzTmFtZSl9LFxcbmBcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgYXR0YWNobWVudHM6IHtcXG5cIlxuICAgICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIGF0dGFjaG1lbnRDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgICBjb25zdCBhdHRhY2htZW50VHlwZSA9IGF0dGFjaG1lbnRDb25maWcgJiYgdHlwZW9mIGF0dGFjaG1lbnRDb25maWcgPT09IFwib2JqZWN0XCIgJiYgYXR0YWNobWVudENvbmZpZy50eXBlID09PSBcImhhc01hbnlcIlxuICAgICAgICAgID8gXCJoYXNNYW55XCJcbiAgICAgICAgICA6IFwiaGFzT25lXCJcblxuICAgICAgICBpZiAoYXR0YWNobWVudENvbmZpZy5zeW5jKSB7XG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgJHthdHRhY2htZW50TmFtZX06IHtcXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgICAgICAgc3luYzoge1xcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgICAgIGZldGNoOiAke0pTT04uc3RyaW5naWZ5KGF0dGFjaG1lbnRDb25maWcuc3luYy5mZXRjaCl9LFxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgICAgICAgICAgb2ZmbGluZVJlcXVpcmVtZW50OiAke0pTT04uc3RyaW5naWZ5KGF0dGFjaG1lbnRDb25maWcuc3luYy5vZmZsaW5lUmVxdWlyZW1lbnQpfSxcXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgICAgIHJldGVudGlvbjogJHtKU09OLnN0cmluZ2lmeShhdHRhY2htZW50Q29uZmlnLnN5bmMucmV0ZW50aW9uKX0sXFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgICAgIH0sXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgICAgICAgIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoYXR0YWNobWVudFR5cGUpfVxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICAgICAgfSxcXG5cIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICAgICR7YXR0YWNobWVudE5hbWV9OiB7dHlwZTogJHtKU09OLnN0cmluZ2lmeShhdHRhY2htZW50VHlwZSl9fSxcXG5gXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgfSxcXG5cIlxuICAgIH1cbiAgICBmaWxlQ29udGVudCArPSB0aGlzLmZvcm1hdHRlZEFycmF5UHJvcGVydHkoe1xuICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgcHJvcGVydHlOYW1lOiBcImF0dHJpYnV0ZXNcIixcbiAgICAgIHZhbHVlczogYXR0cmlidXRlTmFtZXNcbiAgICB9KVxuICAgIGlmICghYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc0FyZURlZmF1bHQpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IHRoaXMuZm9ybWF0dGVkT2JqZWN0UHJvcGVydHkoe1xuICAgICAgICBmaWx0ZXJEZWZhdWx0VmFsdWVzOiB7Y3JlYXRlOiBcImNyZWF0ZVwiLCBpbmRleDogXCJpbmRleFwifSxcbiAgICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgICBwcm9wZXJ0eU5hbWU6IFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiLFxuICAgICAgICB2YWx1ZXM6IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmICghYnVpbHRJbk1lbWJlckNvbW1hbmRzQXJlRGVmYXVsdCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRPYmplY3RQcm9wZXJ0eSh7XG4gICAgICAgIGZpbHRlckRlZmF1bHRWYWx1ZXM6IHtcbiAgICAgICAgICBhdHRhY2g6IFwiYXR0YWNoXCIsXG4gICAgICAgICAgZGVzdHJveTogXCJkZXN0cm95XCIsXG4gICAgICAgICAgZG93bmxvYWQ6IFwiZG93bmxvYWRcIixcbiAgICAgICAgICBmaW5kOiBcImZpbmRcIixcbiAgICAgICAgICB1cGRhdGU6IFwidXBkYXRlXCIsXG4gICAgICAgICAgdXJsOiBcInVybFwiXG4gICAgICAgIH0sXG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiLFxuICAgICAgICB2YWx1ZXM6IGJ1aWx0SW5NZW1iZXJDb21tYW5kc1xuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKGNvbGxlY3Rpb25Db21tYW5kcykubGVuZ3RoID4gMCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRDb21tYW5kc1Byb3BlcnR5KHtcbiAgICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgICBwcm9wZXJ0eU5hbWU6IFwiY29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gICAgICAgIHZhbHVlczogY29sbGVjdGlvbkNvbW1hbmRzXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXMobWVtYmVyQ29tbWFuZHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IHRoaXMuZm9ybWF0dGVkQ29tbWFuZHNQcm9wZXJ0eSh7XG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcIm1lbWJlckNvbW1hbmRzXCIsXG4gICAgICAgIHZhbHVlczogbWVtYmVyQ29tbWFuZHNcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmIChwcmltYXJ5S2V5ICE9PSBcImlkXCIpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBwcmltYXJ5S2V5OiAke0pTT04uc3RyaW5naWZ5KHByaW1hcnlLZXkpfSxcXG5gXG4gICAgfVxuICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWVzID0gdGhpcy5uZXN0ZWRSZWxhdGlvbnNoaXBOYW1lc0ZvckdlbmVyYXRvcihyZXNvdXJjZUNsYXNzIHx8IG51bGwpXG4gICAgaWYgKG5lc3RlZFJlbGF0aW9uc2hpcE5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgbmVzdGVkQXR0cmlidXRlczoge1xcblwiXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgbmVzdGVkUmVsYXRpb25zaGlwTmFtZXMpIHtcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgJHtyZWxhdGlvbnNoaXBOYW1lfToge30sXFxuYFxuICAgICAgfVxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgICB9LFxcblwiXG4gICAgfVxuICAgIGlmIChtb2RlbENvbmZpZy5zeW5jPy5lbmFibGVkKSB7XG4gICAgICBmaWxlQ29udGVudCArPSB0aGlzLmZvcm1hdHRlZEpzb25Qcm9wZXJ0eSh7XG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcInN5bmNcIixcbiAgICAgICAgdmFsdWU6IG1vZGVsQ29uZmlnLnN5bmNcbiAgICAgIH0pXG4gICAgfVxuICAgIGZpbGVDb250ZW50ICs9IFwiICAgIH1cXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcblxuICAgIGlmIChyZWxhdGlvbnNoaXBzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKiogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHt0eXBlOiBcXFwiYmVsb25nc1RvXFxcIiB8IFxcXCJoYXNPbmVcXFwiIHwgXFxcImhhc01hbnlcXFwiLCBhdXRvbG9hZD86IGJvb2xlYW59Pn0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMuICovXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKSB7XFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIHJldHVybiB7XFxuXCJcbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgY29uc3QgcGFydHMgPSBbYHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkocmVsYXRpb25zaGlwLnR5cGUpfWBdXG5cbiAgICAgICAgaWYgKHJlbGF0aW9uc2hpcC5hdXRvbG9hZCA9PT0gZmFsc2UpIHBhcnRzLnB1c2goXCJhdXRvbG9hZDogZmFsc2VcIilcblxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgICAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX06IHske3BhcnRzLmpvaW4oXCIsIFwiKX19LFxcbmBcbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIH1cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIH1cXG5cIlxuXG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIFJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcyBuYW1lcy4gKi9cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIHN0YXRpYyByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKSB7XFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIHJldHVybiB7XFxuXCJcbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9OiAke0pTT04uc3RyaW5naWZ5KHJlbGF0aW9uc2hpcC50YXJnZXRDbGFzc05hbWUpfSxcXG5gXG4gICAgICB9XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICB9XFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBhdHRyaWJ1dGVzKSB7XG4gICAgICBjb25zdCBjYW1lbGl6ZWRBdHRyaWJ1dGUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZS5uYW1lLCB0cnVlKVxuICAgICAgY29uc3QgY2FtZWxpemVkQXR0cmlidXRlVXBwZXIgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZS5uYW1lKVxuICAgICAgY29uc3QgYXR0cmlidXRlVHlwZSA9IGAke2F0dHJpYnV0ZXNUeXBlTmFtZX1bJHtKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGUubmFtZSl9XWBcbiAgICAgIGNvbnN0IHNldHRlckF0dHJpYnV0ZVR5cGUgPSBhd2FpdCB0aGlzLmZyb250ZW5kV3JpdGVBdHRyaWJ1dGVUeXBlKHtcbiAgICAgICAgYXR0cmlidXRlLFxuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBhdHRyaWJ1dGUubmFtZSxcbiAgICAgICAgYXR0cmlidXRlc1R5cGVOYW1lLFxuICAgICAgICByZXNvdXJjZUNsYXNzXG4gICAgICB9KVxuXG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICAvKiogQHJldHVybnMgeyR7YXR0cmlidXRlVHlwZX19IC0gQXR0cmlidXRlIHZhbHVlLiAqL1xcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7Y2FtZWxpemVkQXR0cmlidXRlfSgpIHsgcmV0dXJuIC8qKiBAdHlwZSB7JHthdHRyaWJ1dGVUeXBlfX0gKi8gKHRoaXMucmVhZEF0dHJpYnV0ZSgke0pTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZS5uYW1lKX0pKSB9XFxuYFxuXG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEBwYXJhbSB7JHtzZXR0ZXJBdHRyaWJ1dGVUeXBlfX0gbmV3VmFsdWUgLSBOZXcgYXR0cmlidXRlIHZhbHVlLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHske3NldHRlckF0dHJpYnV0ZVR5cGV9fSAtIEFzc2lnbmVkIHZhbHVlLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgc2V0JHtjYW1lbGl6ZWRBdHRyaWJ1dGVVcHBlcn0obmV3VmFsdWUpIHsgcmV0dXJuIC8qKiBAdHlwZSB7JHtzZXR0ZXJBdHRyaWJ1dGVUeXBlfX0gKi8gKHRoaXMuc2V0QXR0cmlidXRlKCR7SlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlLm5hbWUpfSwgbmV3VmFsdWUpKSB9XFxuYFxuICAgIH1cblxuICAgIGZvciAoY29uc3QgbWV0aG9kTmFtZSBvZiBPYmplY3Qua2V5cyhjb2xsZWN0aW9uQ29tbWFuZHMpKSB7XG4gICAgICBjb25zdCBzaWduYXR1cmUgPSB0aGlzLmN1c3RvbUNvbW1hbmRNZXRob2RTaWduYXR1cmUoe2NvbW1hbmRNZXRhZGF0YSwgbWV0aG9kTmFtZX0pXG5cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUnVucyAke21ldGhvZE5hbWV9LlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IHNpZ25hdHVyZS5wYXJhbURvY3NcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtQcm9taXNlPCR7c2lnbmF0dXJlLnJldHVyblR5cGV9Pn0gLSBDb21tYW5kIHJlc3BvbnNlLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgc3RhdGljIGFzeW5jICR7bWV0aG9kTmFtZX0oJHtzaWduYXR1cmUucGFyYW1ldGVyc30pIHtcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgIHJldHVybiAvKiogQHR5cGUgeyR7c2lnbmF0dXJlLnJldHVyblR5cGV9fSAqLyAoYXdhaXQgdGhpcy5leGVjdXRlQ3VzdG9tQ29tbWFuZCh7XFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIGNvbW1hbmROYW1lOiAke0pTT04uc3RyaW5naWZ5KGNvbGxlY3Rpb25Db21tYW5kc1ttZXRob2ROYW1lXSl9LFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBjb21tYW5kVHlwZTogJHtKU09OLnN0cmluZ2lmeShjb2xsZWN0aW9uQ29tbWFuZHNbbWV0aG9kTmFtZV0pfSxcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgICAgcGF5bG9hZDogJHtjbGFzc05hbWV9Lm5vcm1hbGl6ZUN1c3RvbUNvbW1hbmRQYXlsb2FkQXJndW1lbnRzKCR7c2lnbmF0dXJlLnBheWxvYWRBcmd1bWVudHN9KSxcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICAgIHJlc291cmNlUGF0aDogdGhpcy5yZXNvdXJjZVBhdGgoKVxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICB9KSlcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIH1cXG5cIlxuICAgIH1cblxuICAgIGZvciAoY29uc3QgbWV0aG9kTmFtZSBvZiBPYmplY3Qua2V5cyhtZW1iZXJDb21tYW5kcykpIHtcbiAgICAgIGNvbnN0IHNpZ25hdHVyZSA9IHRoaXMuY3VzdG9tQ29tbWFuZE1ldGhvZFNpZ25hdHVyZSh7Y29tbWFuZE1ldGFkYXRhLCBtZXRob2ROYW1lfSlcblxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSdW5zICR7bWV0aG9kTmFtZX0uXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gc2lnbmF0dXJlLnBhcmFtRG9jc1xuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge1Byb21pc2U8JHtzaWduYXR1cmUucmV0dXJuVHlwZX0+fSAtIENvbW1hbmQgcmVzcG9uc2UuXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICBhc3luYyAke21ldGhvZE5hbWV9KCR7c2lnbmF0dXJlLnBhcmFtZXRlcnN9KSB7XFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICByZXR1cm4gLyoqIEB0eXBlIHske3NpZ25hdHVyZS5yZXR1cm5UeXBlfX0gKi8gKGF3YWl0ICR7Y2xhc3NOYW1lfS5leGVjdXRlQ3VzdG9tQ29tbWFuZCh7XFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIGNvbW1hbmROYW1lOiAke0pTT04uc3RyaW5naWZ5KG1lbWJlckNvbW1hbmRzW21ldGhvZE5hbWVdKX0sXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIGNvbW1hbmRUeXBlOiAke0pTT04uc3RyaW5naWZ5KG1lbWJlckNvbW1hbmRzW21ldGhvZE5hbWVdKX0sXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIG1lbWJlcklkOiB0aGlzLnNjYWxhclByaW1hcnlLZXlWYWx1ZSgke0pTT04uc3RyaW5naWZ5KGBDdXN0b20gbWVtYmVyIGNvbW1hbmQgJHtjbGFzc05hbWV9IyR7bWV0aG9kTmFtZX1gKX0pLFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBwYXlsb2FkOiAke2NsYXNzTmFtZX0ubm9ybWFsaXplQ3VzdG9tQ29tbWFuZFBheWxvYWRBcmd1bWVudHMoJHtzaWduYXR1cmUucGF5bG9hZEFyZ3VtZW50c30pLFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICByZXNvdXJjZVBhdGg6ICR7Y2xhc3NOYW1lfS5yZXNvdXJjZVBhdGgoKVxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIH0pKVxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgfVxcblwiXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgcmVsYXRpb25zaGlwcykge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZCA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRJbXBvcnRQYXRoID0gYC4vJHtyZWxhdGlvbnNoaXAudGFyZ2V0RmlsZU5hbWV9LmpzYFxuICAgICAgY29uc3QgdGFyZ2V0SW5zdGFuY2VUeXBlID0gYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHRhcmdldEltcG9ydFBhdGgpfSkuJHtyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lfWBcbiAgICAgIGNvbnN0IHRhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlID0gYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHRhcmdldEltcG9ydFBhdGgpfSkuJHtyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lfUNyZWF0ZUF0dHJpYnV0ZXNgXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAudHlwZSA9PSBcImhhc01hbnlcIikge1xuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9IHJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDwke2NsYXNzTmFtZX0sICR7dGFyZ2V0SW5zdGFuY2VUeXBlfSwgJHt0YXJnZXRDcmVhdGVBdHRyaWJ1dGVzVHlwZX0+fSAtIFJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKSB7IHJldHVybiAvKiogQHR5cGUge2ltcG9ydCgke0pTT04uc3RyaW5naWZ5KGltcG9ydFBhdGgpfSkuRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8JHtjbGFzc05hbWV9LCAke3RhcmdldEluc3RhbmNlVHlwZX0sICR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9Pn0gKi8gKHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKCR7SlNPTi5zdHJpbmdpZnkocmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWUpfSkpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUmV0dXJucyAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfS5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPCR7Y2xhc3NOYW1lfSwgJHt0YXJnZXRJbnN0YW5jZVR5cGV9LCAke3RhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlfT59IC0gUmVsYXRpb25zaGlwIGhlbHBlci5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfSgpIHsgcmV0dXJuIHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKSB9XFxuYFxuXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIFJldHVybnMgbG9hZGVkICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge0FycmF5PCR7dGFyZ2V0SW5zdGFuY2VUeXBlfT59IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWxzLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9TG9hZGVkKCkgeyByZXR1cm4gdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLmxvYWRlZCgpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogTG9hZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTwke3RhcmdldEluc3RhbmNlVHlwZX0+Pn0gLSBMb2FkZWQgcmVsYXRlZCBtb2RlbHMuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgbG9hZCR7cmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZH0oKSB7IHJldHVybiBhd2FpdCB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkubG9hZCgpIH1cXG5gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9IHJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8JHtjbGFzc05hbWV9LCAke3RhcmdldEluc3RhbmNlVHlwZX0sICR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9Pn0gLSBSZWxhdGlvbnNoaXAgaGVscGVyLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDwke2NsYXNzTmFtZX0sICR7dGFyZ2V0SW5zdGFuY2VUeXBlfSwgJHt0YXJnZXRDcmVhdGVBdHRyaWJ1dGVzVHlwZX0+fSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoJHtKU09OLnN0cmluZ2lmeShyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZSl9KSkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMgeyR7dGFyZ2V0SW5zdGFuY2VUeXBlfSB8IG51bGx9IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0oKSB7IHJldHVybiB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkubG9hZGVkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBCdWlsZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0geyR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9fSBbYXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzIGZvciB0aGUgbmV3IHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7JHt0YXJnZXRJbnN0YW5jZVR5cGV9fSAtIEJ1aWx0IHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYnVpbGQke3JlbGF0aW9uc2hpcE5hbWVDYW1lbGl6ZWR9KGF0dHJpYnV0ZXMgPSB7fSkgeyByZXR1cm4gdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLmJ1aWxkKGF0dHJpYnV0ZXMpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogTG9hZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwke3RhcmdldEluc3RhbmNlVHlwZX0gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRlZCBtb2RlbC5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICBhc3luYyBsb2FkJHtyZWxhdGlvbnNoaXBOYW1lQ2FtZWxpemVkfSgpIHsgcmV0dXJuIGF3YWl0IHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKS5sb2FkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zIG9yIGxvYWRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge1Byb21pc2U8JHt0YXJnZXRJbnN0YW5jZVR5cGV9IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1PckxvYWQoKSB7IHJldHVybiBhd2FpdCB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkub3JMb2FkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBTZXRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHske3RhcmdldEluc3RhbmNlVHlwZX0gfCBudWxsfSBtb2RlbCAtIFJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICogQHJldHVybnMge3ZvaWR9XFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgIHNldCR7cmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZH0obW9kZWwpIHsgdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLnNldExvYWRlZChtb2RlbCkgfVxcbmBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmaWxlQ29udGVudCArPSBcIn1cXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgRnJvbnRlbmRNb2RlbEJhc2UucmVnaXN0ZXJNb2RlbCgke2NsYXNzTmFtZX0pXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAvLyBTdGF0aWMgZ2VuZXJpYyBtZXRob2RzIGNhbm5vdCByZXRhaW4gdGhlIGdlbmVyYXRlZCBzdWJjbGFzcyBpZGVudGl0eSB3aGVuIHN0cnVjdHVyYWxseSBjb21wYXJlZC5cbiAgICBmaWxlQ29udGVudCArPSBgY29uc3QgR2VuZXJhdGVkJHtjbGFzc05hbWV9Q2xhc3MgPSAvKiogQHR5cGUge09taXQ8dHlwZW9mICR7Y2xhc3NOYW1lfSwgXCJvbkRlc3Ryb3lcIj4gJiB7b25EZXN0cm95OiAoY2FsbGJhY2s6IChwYXlsb2FkOiB7aWQ6ICR7ZXZlbnRQcmltYXJ5S2V5VmFsdWVUeXBlfX0pID0+IHZvaWQsIG9wdGlvbnM/OiBpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnMpID0+IFByb21pc2U8KCkgPT4gdm9pZD59fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoJHtjbGFzc05hbWV9KSlcXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IGBleHBvcnQge0dlbmVyYXRlZCR7Y2xhc3NOYW1lfUNsYXNzIGFzICR7Y2xhc3NOYW1lfX1cXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IGBleHBvcnQgZGVmYXVsdCBHZW5lcmF0ZWQke2NsYXNzTmFtZX1DbGFzc1xcbmBcblxuICAgIHJldHVybiBmaWxlQ29udGVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgc2V0dXAgZmlsZSBjb250ZW50LlxuICAgKiBAcGFyYW0ge0FycmF5PHtjbGFzc05hbWU6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZ30+fSBnZW5lcmF0ZWRGaWxlcyAtIEdlbmVyYXRlZCBtb2RlbCBmaWxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTZXR1cCBmaWxlIGNvbnRlbnQgd2l0aCBzaWRlLWVmZmVjdCBpbXBvcnRzIGZvciBtb2RlbCByZWdpc3RyYXRpb24uXG4gICAqL1xuICBidWlsZFNldHVwRmlsZUNvbnRlbnQoZ2VuZXJhdGVkRmlsZXMpIHtcbiAgICBsZXQgY29udGVudCA9IGdlbmVyYXRlZEZpbGVCYW5uZXIoRlJPTlRFTkRfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORClcblxuICAgIGZvciAoY29uc3Qge2ZpbGVOYW1lfSBvZiBnZW5lcmF0ZWRGaWxlcykge1xuICAgICAgY29udGVudCArPSBgaW1wb3J0IFwiLi8ke2ZpbGVOYW1lfVwiXFxuYFxuICAgIH1cblxuICAgIHJldHVybiBjb250ZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3cml0ZSBhdHRyaWJ1dGVzIHR5cGVkZWYuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge0FycmF5PHtqc0RvY1R5cGU6IHN0cmluZywgbmFtZTogc3RyaW5nLCB3cml0ZUpzRG9jVHlwZTogc3RyaW5nfT59IGFyZ3MuYXR0cmlidXRlcyAtIEdlbmVyYXRlZCByZWFkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZXNUeXBlTmFtZSAtIEdlbmVyYXRlZCByZWFkIGF0dHJpYnV0ZXMgdHlwZWRlZiBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtBcnJheTx7YXR0cmlidXRlczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdHlwZU5hbWU6IHN0cmluZ30+fSBhcmdzLm5lc3RlZFdyaXRlVHlwZXMgLSBOZXN0ZWQgd3JpdGUgdHlwZWRlZnMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEdlbmVyYXRvclBlcm1pdFNwZWN9IGFyZ3MucGVybWl0dGVkUGFyYW1zIC0gUmVzb3VyY2UgcGVybWl0dGVkIHBhcmFtcyBzcGVjLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5yZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGVOYW1lIC0gVHlwZWRlZiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEdlbmVyYXRlZCB0eXBlZGVmIHNvdXJjZS5cbiAgICovXG4gIGFzeW5jIHdyaXRlQXR0cmlidXRlc1R5cGVkZWYoe2F0dHJpYnV0ZXMsIGF0dHJpYnV0ZXNUeXBlTmFtZSwgbW9kZWxDbGFzcywgbmVzdGVkV3JpdGVUeXBlcywgcGVybWl0dGVkUGFyYW1zLCByZXNvdXJjZUNsYXNzLCB0eXBlTmFtZX0pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVMaW5lcyA9IFtdXG5cbiAgICBsZXQgb3V0cHV0ID0gXCIvKipcXG5cIlxuXG4gICAgY29uc3QgYXR0cmlidXRlc0J5TmFtZSA9IG5ldyBNYXAoYXR0cmlidXRlcy5tYXAoKGF0dHJpYnV0ZSkgPT4gW2F0dHJpYnV0ZS5uYW1lLCBhdHRyaWJ1dGVdKSlcbiAgICBjb25zdCBuZXN0ZWRXcml0ZVR5cGVzQnlLZXkgPSBuZXcgTWFwKG5lc3RlZFdyaXRlVHlwZXMubWFwKChuZXN0ZWRXcml0ZVR5cGUpID0+IFtgJHtuZXN0ZWRXcml0ZVR5cGUucmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzYCwgbmVzdGVkV3JpdGVUeXBlXSkpXG4gICAgY29uc3QgZW1pdHRlZEF0dHJpYnV0ZU5hbWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBlcm1pdHRlZFBhcmFtcykge1xuICAgICAgaWYgKHR5cGVvZiBlbnRyeSA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmZyb250ZW5kV3JpdGVBdHRyaWJ1dGVOYW1lKHthdHRyaWJ1dGVOYW1lOiBlbnRyeSwgYXR0cmlidXRlc0J5TmFtZSwgbW9kZWxDbGFzc30pXG5cbiAgICAgICAgaWYgKGVtaXR0ZWRBdHRyaWJ1dGVOYW1lcy5oYXMoYXR0cmlidXRlTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgZW1pdHRlZEF0dHJpYnV0ZU5hbWVzLmFkZChhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICAgIGNvbnN0IHR5cGUgPSBhd2FpdCB0aGlzLmZyb250ZW5kV3JpdGVBdHRyaWJ1dGVUeXBlKHtcbiAgICAgICAgICBhdHRyaWJ1dGU6IGF0dHJpYnV0ZXNCeU5hbWUuZ2V0KGF0dHJpYnV0ZU5hbWUpLFxuICAgICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgYXR0cmlidXRlc1R5cGVOYW1lLFxuICAgICAgICAgIHJlc291cmNlQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhdHRyaWJ1dGVMaW5lcy5wdXNoKGAgKiBAcHJvcGVydHkgeyR7dHlwZX19IFske2F0dHJpYnV0ZU5hbWV9XSAtIFBlcm1pdHRlZCAke2F0dHJpYnV0ZU5hbWV9IHZhbHVlLlxcbmApXG4gICAgICB9IGVsc2UgaWYgKGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGVudHJ5KSkge1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhlbnRyeSkpIHtcbiAgICAgICAgICBjb25zdCBuZXN0ZWRXcml0ZVR5cGUgPSBuZXN0ZWRXcml0ZVR5cGVzQnlLZXkuZ2V0KGtleSlcbiAgICAgICAgICBjb25zdCB0eXBlID0gbmVzdGVkV3JpdGVUeXBlID8gYEFycmF5PCR7bmVzdGVkV3JpdGVUeXBlLnR5cGVOYW1lfT5gIDogXCJBcnJheTxvYmplY3Q+XCJcblxuICAgICAgICAgIGF0dHJpYnV0ZUxpbmVzLnB1c2goYCAqIEBwcm9wZXJ0eSB7JHt0eXBlfX0gWyR7a2V5fV0gLSBQZXJtaXR0ZWQgbmVzdGVkICR7a2V5fSB2YWx1ZXMuXFxuYClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIG91dHB1dCArPSBgICogQXR0cmlidXRlcyBhY2NlcHRlZCBieSAke3R5cGVOYW1lfS5cXG5gXG4gICAgaWYgKGF0dHJpYnV0ZUxpbmVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgb3V0cHV0ICs9IGAgKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgbmV2ZXI+fSAke3R5cGVOYW1lfVxcbmBcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0cHV0ICs9IGAgKiBAdHlwZWRlZiB7b2JqZWN0fSAke3R5cGVOYW1lfVxcbmBcbiAgICAgIG91dHB1dCArPSBhdHRyaWJ1dGVMaW5lcy5qb2luKFwiXCIpXG4gICAgfVxuICAgIG91dHB1dCArPSBcIiAqL1xcblwiXG5cbiAgICByZXR1cm4gb3V0cHV0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCB3cml0ZSBhdHRyaWJ1dGUgdHlwZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlOiB7anNEb2NUeXBlOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgd3JpdGVKc0RvY1R5cGU6IHN0cmluZ30gfCB1bmRlZmluZWQsIGF0dHJpYnV0ZU5hbWU6IHN0cmluZywgYXR0cmlidXRlc1R5cGVOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH19IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSlNEb2MgdHlwZSBmb3IgdGhlIHBlcm1pdHRlZCB3cml0ZSBmaWVsZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kV3JpdGVBdHRyaWJ1dGVUeXBlKHthdHRyaWJ1dGUsIGF0dHJpYnV0ZU5hbWUsIGF0dHJpYnV0ZXNUeXBlTmFtZSwgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBjb25zdCBzZXR0ZXJQYXJhbWV0ZXJUeXBlID0gYXdhaXQgdGhpcy5mcm9udGVuZFdyaXRlQXR0cmlidXRlU2V0dGVyUGFyYW1ldGVyVHlwZSh7YXR0cmlidXRlTmFtZSwgcmVzb3VyY2VDbGFzc30pXG5cbiAgICBpZiAoc2V0dGVyUGFyYW1ldGVyVHlwZSkgcmV0dXJuIGAke3NldHRlclBhcmFtZXRlclR5cGV9IHwgbnVsbGBcblxuICAgIGlmICghYXR0cmlidXRlKSByZXR1cm4gXCJGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcIlxuXG4gICAgaWYgKGF0dHJpYnV0ZS5qc0RvY1R5cGUudHJpbSgpID09PSBcIm51bGxcIikgcmV0dXJuIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCJcblxuICAgIGlmIChhdHRyaWJ1dGUud3JpdGVKc0RvY1R5cGUgIT09IGF0dHJpYnV0ZS5qc0RvY1R5cGUpIHJldHVybiBhdHRyaWJ1dGUud3JpdGVKc0RvY1R5cGVcblxuICAgIHJldHVybiBgJHthdHRyaWJ1dGVzVHlwZU5hbWV9WyR7SlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlLm5hbWUpfV0gfCBudWxsYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgd3JpdGUgYXR0cmlidXRlIHNldHRlciBwYXJhbWV0ZXIgdHlwZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBTZXR0ZXIgdmFsdWUgcGFyYW1ldGVyIHR5cGUgd2hlbiBpdCBpcyB1c2VmdWwgZm9yIGdlbmVyYXRpb24uXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFdyaXRlQXR0cmlidXRlU2V0dGVyUGFyYW1ldGVyVHlwZSh7YXR0cmlidXRlTmFtZSwgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBpZiAoIXJlc291cmNlQ2xhc3M/Lm5hbWUpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBtZXRob2ROYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lKX1BdHRyaWJ1dGVgXG4gICAgY29uc3QgcGFyYW1ldGVyVHlwZSA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlKHtcbiAgICAgIG1ldGhvZE5hbWUsXG4gICAgICBwYXJhbWV0ZXJJbmRleDogMSxcbiAgICAgIHNvdXJjZUNsYXNzTmFtZTogcmVzb3VyY2VDbGFzcy5uYW1lXG4gICAgfSlcblxuICAgIGlmICghcGFyYW1ldGVyVHlwZSkgcmV0dXJuIG51bGxcbiAgICBpZiAodGhpcy5pc0Jyb2FkR2VuZXJhdGVkVHlwZShwYXJhbWV0ZXJUeXBlKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBwYXJhbWV0ZXJUeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBicm9hZCBnZW5lcmF0ZWQgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVHlwZSAtIEpTRG9jIHR5cGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHR5cGUgaXMgdG9vIGJyb2FkIHRvIGltcHJvdmUgZ2VuZXJhdGVkIHdyaXRlIHR5cGluZy5cbiAgICovXG4gIGlzQnJvYWRHZW5lcmF0ZWRUeXBlKGpzRG9jVHlwZSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0ganNEb2NUeXBlLnRyaW0oKVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRUeXBlID09PSBcIj9cIlxuICAgICAgfHwgbm9ybWFsaXplZFR5cGUgPT09IFwiYW55XCJcbiAgICAgIHx8IG5vcm1hbGl6ZWRUeXBlID09PSBcIm9iamVjdFwiXG4gICAgICB8fCBub3JtYWxpemVkVHlwZSA9PT0gXCJ1bmtub3duXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHBlcm1pdHRlZCB3cml0ZSBhdHRyaWJ1dGUgdG8gdGhlIGdlbmVyYXRlZCBmcm9udGVuZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZTogc3RyaW5nLCBhdHRyaWJ1dGVzQnlOYW1lOiBNYXA8c3RyaW5nLCB7anNEb2NUeXBlOiBzdHJpbmcsIG5hbWU6IHN0cmluZ30+LCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZyb250ZW5kIGF0dHJpYnV0ZSBuYW1lIHVzZWQgYnkgZ2VuZXJhdGVkIGFjY2Vzc29ycy5cbiAgICovXG4gIGZyb250ZW5kV3JpdGVBdHRyaWJ1dGVOYW1lKHthdHRyaWJ1dGVOYW1lLCBhdHRyaWJ1dGVzQnlOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGlmIChhdHRyaWJ1dGVzQnlOYW1lLmhhcyhhdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIGF0dHJpYnV0ZU5hbWVcblxuICAgIGlmIChtb2RlbENsYXNzKSB7XG4gICAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUgJiYgYXR0cmlidXRlc0J5TmFtZS5oYXMocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIHJlc29sdmVkQXR0cmlidXRlTmFtZVxuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lLCB0cnVlKS50b0xvd2VyQ2FzZSgpXG4gICAgY29uc3QgbWF0Y2hpbmdBdHRyaWJ1dGVOYW1lID0gQXJyYXkuZnJvbShhdHRyaWJ1dGVzQnlOYW1lLmtleXMoKSkuZmluZCgoY2FuZGlkYXRlTmFtZSkgPT4gY2FuZGlkYXRlTmFtZS50b0xvd2VyQ2FzZSgpID09PSBub3JtYWxpemVkQXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChtYXRjaGluZ0F0dHJpYnV0ZU5hbWUpIHJldHVybiBtYXRjaGluZ0F0dHJpYnV0ZU5hbWVcblxuICAgIC8vIFdyaXRlLW9ubHkgdmlydHVhbCBwYXJhbXMgYXJlIHZhbGlkIHBlcm1pdHRlZCBwYXJhbXMgZXZlbiB3aGVuIHRoZXkgaGF2ZSBubyByZWFkIGF0dHJpYnV0ZS5cbiAgICByZXR1cm4gYXR0cmlidXRlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmVzdGVkIHdyaXRlIHR5cGVzIGZvciBtb2RlbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEdlbmVyYXRvclBlcm1pdFNwZWN9IGFyZ3MucGVybWl0dGVkUGFyYW1zIC0gQ29tYmluZWQgcGVybWl0dGVkIHBhcmFtcyBzcGVjcy5cbiAgICogQHBhcmFtIHtBcnJheTx7YXV0b2xvYWQ6IGJvb2xlYW4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdGFyZ2V0Q2xhc3NOYW1lOiBzdHJpbmcsIHRhcmdldEZpbGVOYW1lOiBzdHJpbmcsIHR5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9Pn0gYXJncy5yZWxhdGlvbnNoaXBzIC0gR2VuZXJhdGVkIHJlbGF0aW9uc2hpcHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7YXR0cmlidXRlczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdHlwZU5hbWU6IHN0cmluZ30+fSAtIE5lc3RlZCB3cml0ZSB0eXBlZGVmcy5cbiAgICovXG4gIG5lc3RlZFdyaXRlVHlwZXNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBwZXJtaXR0ZWRQYXJhbXMsIHJlbGF0aW9uc2hpcHN9KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwc0J5TmFtZSA9IG5ldyBNYXAocmVsYXRpb25zaGlwcy5tYXAoKHJlbGF0aW9uc2hpcCkgPT4gW3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBdKSlcbiAgICBjb25zdCBuZXN0ZWRXcml0ZVR5cGVzQnlOYW1lID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBlcm1pdHRlZFBhcmFtcykge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5KSkgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZW50cnkpKSB7XG4gICAgICAgIGlmICgha2V5LmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkgY29udGludWVcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGtleS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuICAgICAgICBjb25zdCBuZXN0ZWRTcGVjID0gZW50cnlba2V5XVxuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSByZWxhdGlvbnNoaXBzQnlOYW1lLmdldChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgICBsZXQgdGFyZ2V0TW9kZWxDbGFzc1xuXG4gICAgICAgIGlmIChyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwLnRhcmdldENsYXNzTmFtZSlcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3MgPSB1bmRlZmluZWRcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmVzdGVkV3JpdGVUeXBlc0J5TmFtZS5oYXMocmVsYXRpb25zaGlwTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgbmVzdGVkV3JpdGVUeXBlc0J5TmFtZS5zZXQocmVsYXRpb25zaGlwTmFtZSwge1xuICAgICAgICAgIGF0dHJpYnV0ZXM6IHRoaXMubmVzdGVkV3JpdGVBdHRyaWJ1dGVzRm9yU3BlYyh7bmVzdGVkU3BlYywgdGFyZ2V0TW9kZWxDbGFzc30pLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdHlwZU5hbWU6IGAke2NsYXNzTmFtZX0ke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9TmVzdGVkQXR0cmlidXRlc2BcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShuZXN0ZWRXcml0ZVR5cGVzQnlOYW1lLnZhbHVlcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmVzdGVkIHdyaXRlIGF0dHJpYnV0ZXMgZm9yIHNwZWMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIG9iamVjdD4+IHwgb2JqZWN0IHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5uZXN0ZWRTcGVjIC0gTmVzdGVkIHBlcm1pdCBzcGVjLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IGJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9Pn0gLSBOZXN0ZWQgd3JpdGUgYXR0cmlidXRlcy5cbiAgICovXG4gIG5lc3RlZFdyaXRlQXR0cmlidXRlc0ZvclNwZWMoe25lc3RlZFNwZWMsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG5lc3RlZFNwZWMpKSByZXR1cm4gW11cblxuICAgIHJldHVybiBuZXN0ZWRTcGVjLmZpbHRlcigoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PSBcInN0cmluZ1wiKS5tYXAoKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRhcmdldE1vZGVsQ2xhc3M/LnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpIHx8IGF0dHJpYnV0ZU5hbWVcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZUNvbmZpZyA9IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JNb2RlbEF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZTogcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzfSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICB0eXBlOiBhdHRyaWJ1dGVDb25maWcgPyB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kV3JpdGVBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZ30pIDogXCJGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJtaXR0ZWQgcGFyYW1zIGZvciBnZW5lcmF0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSByZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCJ9IGFjdGlvbiAtIFdyaXRlIGFjdGlvbi5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxHZW5lcmF0b3JQZXJtaXRTcGVjfSAtIFBlcm1pdHRlZCBwYXJhbXMgc3BlYy5cbiAgICovXG4gIHBlcm1pdHRlZFBhcmFtc0ZvckdlbmVyYXRvcihyZXNvdXJjZUNsYXNzLCBhY3Rpb24pIHtcbiAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHJldHVybiBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuXG4gICAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvcihyZXNvdXJjZUNsYXNzKVxuICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgUmVzb3VyY2VDbGFzcyh7XG4gICAgICAgIGFiaWxpdHk6IHVuZGVmaW5lZCxcbiAgICAgICAgY29udGV4dDoge30sXG4gICAgICAgIGxvY2Fsczoge30sXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIG1vZGVsTmFtZTogbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgcGFyYW1zOiB7fSxcbiAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHthdHRyaWJ1dGVzOiBbXX0pXG4gICAgICB9KVxuICAgICAgY29uc3Qgc3BlYyA9IGluc3RhbmNlLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uLCBhYmlsaXR5OiB1bmRlZmluZWQsIGxvY2Fsczoge30sIHBhcmFtczoge319KVxuXG4gICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShzcGVjKSA/IHNwZWMgOiBbXVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBpbnZva2UgJHtyZXNvdXJjZUNsYXNzLm5hbWV9LnBlcm1pdHRlZFBhcmFtcygpIHdoaWxlIGdlbmVyYXRpbmcgZnJvbnRlbmQgbW9kZWwgd3JpdGUgdHlwZXM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbnZva2VzIGEgYmFja2VuZCByZXNvdXJjZSdzIGBwZXJtaXR0ZWRQYXJhbXMoKWAgaW5zdGFuY2UgbWV0aG9kIGF0XG4gICAqIGdlbmVyYXRpb24gdGltZSBhbmQgZXh0cmFjdHMgdGhlIHJlbGF0aW9uc2hpcCBuYW1lcyB0aGF0IGFjY2VwdFxuICAgKiBuZXN0ZWQgd3JpdGVzIChge2Zvb0F0dHJpYnV0ZXM6IFsuLi5dfWAgZW50cmllcykuIFRoZSBnZW5lcmF0b3JcbiAgICogZW1pdHMgdGhvc2UgbmFtZXMgaW50byB0aGUgZnJvbnRlbmQgbW9kZWwncyBgcmVzb3VyY2VDb25maWcoKWAgc29cbiAgICogdGhlIGNsaWVudCBgc2F2ZSgpYCB3YWxrZXIga25vd3Mgd2hpY2ggcmVsYXRpb25zaGlwcyB0byBzaGlwLlxuICAgKlxuICAgKiBDb25zdHJ1Y3RlZCB3aXRoIG5vIGNvbnRyb2xsZXIvYWJpbGl0eSBzbyByZXNvdXJjZSBvdmVycmlkZXMgbXVzdFxuICAgKiBzdXBwb3J0IGJlaW5nIGNhbGxlZCB3aXRob3V0IGEgcmVxdWVzdCBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gcmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gUmVsYXRpb25zaGlwIG5hbWVzIHRoYXQgYWNjZXB0IG5lc3RlZCB3cml0ZXMgKGVtcHR5IHdoZW4gbm9uZSkuXG4gICAqL1xuICBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lc0ZvckdlbmVyYXRvcihyZXNvdXJjZUNsYXNzKSB7XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzKSByZXR1cm4gW11cblxuICAgIGxldCBzcGVjXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG5cbiAgICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yKHJlc291cmNlQ2xhc3MpXG4gICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBSZXNvdXJjZUNsYXNzKHtcbiAgICAgICAgYWJpbGl0eTogdW5kZWZpbmVkLFxuICAgICAgICBjb250ZXh0OiB7fSxcbiAgICAgICAgbG9jYWxzOiB7fSxcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgbW9kZWxOYW1lOiBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICBwYXJhbXM6IHt9LFxuICAgICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqLyAoe2F0dHJpYnV0ZXM6IFtdfSlcbiAgICAgIH0pXG4gICAgICBzcGVjID0gaW5zdGFuY2UucGVybWl0dGVkUGFyYW1zKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gaW52b2tlICR7cmVzb3VyY2VDbGFzcy5uYW1lfS5wZXJtaXR0ZWRQYXJhbXMoKSB3aGlsZSBnZW5lcmF0aW5nIGZyb250ZW5kIG1vZGVsczogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNwZWMpKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIFJlbGF0aW9uc2hpcCBuYW1lcy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzcGVjKSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5KSkgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZW50cnkpKSB7XG4gICAgICAgIGlmICgha2V5LmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkgY29udGludWVcbiAgICAgICAgY29uc3QgbmFtZSA9IGtleS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuICAgICAgICBpZiAobmFtZSkgcmVsYXRpb25zaGlwTmFtZXMucHVzaChuYW1lKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBOYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIGFycmF5IHByb3BlcnR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZvcm1hdHRpbmcgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW5kZW50IC0gQmFzZSBpbmRlbnRhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvcGVydHlOYW1lIC0gT2JqZWN0IHByb3BlcnR5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MudmFsdWVzIC0gU3RyaW5nIHZhbHVlcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgbXVsdGlsaW5lIGFycmF5IHByb3BlcnR5LlxuICAgKi9cbiAgZm9ybWF0dGVkQXJyYXlQcm9wZXJ0eSh7aW5kZW50LCBwcm9wZXJ0eU5hbWUsIHZhbHVlc30pIHtcbiAgICBsZXQgb3V0cHV0ID0gYCR7aW5kZW50fSR7cHJvcGVydHlOYW1lfTogW1xcbmBcblxuICAgIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB7XG4gICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fSAgJHtKU09OLnN0cmluZ2lmeSh2YWx1ZSl9LFxcbmBcbiAgICB9XG5cbiAgICBvdXRwdXQgKz0gYCR7aW5kZW50fV0sXFxuYFxuXG4gICAgcmV0dXJuIG91dHB1dFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIGNvbW1hbmRzIHByb3BlcnR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZvcm1hdHRpbmcgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW5kZW50IC0gQmFzZSBpbmRlbnRhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvcGVydHlOYW1lIC0gT2JqZWN0IHByb3BlcnR5IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gYXJncy52YWx1ZXMgLSBDb21tYW5kIGtleS12YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRm9ybWF0dGVkIG11bHRpbGluZSBhcnJheSBwcm9wZXJ0eS4gQWx3YXlzIGVtaXRzXG4gICAqICAgdGhlIGNhbWVsQ2FzZSBtZXRob2QtbmFtZSBhcnJheSBmb3JtIChgbWVtYmVyQ29tbWFuZHM6IFtcInVwZGF0ZUFjY2Vzc1wiXWApXG4gICAqICAgc28gdGhlIGdlbmVyYXRlZCBjb25maWcgbWF0Y2hlcyB0aGUgY2Fub25pY2FsXG4gICAqICAgYEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZy57Y29sbGVjdGlvbixtZW1iZXJ9Q29tbWFuZHM6IHN0cmluZ1tdYFxuICAgKiAgIHNoYXBlLiBUaGUgcnVudGltZSBkZXJpdmVzIHRoZSBjb21tYW5kIHNsdWcgZnJvbSB0aGUgY2FtZWxDYXNlXG4gICAqICAgbWV0aG9kIG5hbWU7IGNvbnN1bWVycyBuZXZlciBuZWVkIHRvIHdyaXRlIG91dFxuICAgKiAgIGB7dXBkYXRlQWNjZXNzOiBcInVwZGF0ZS1hY2Nlc3NcIn1gIGJ5IGhhbmQuXG4gICAqL1xuICBmb3JtYXR0ZWRDb21tYW5kc1Byb3BlcnR5KHtpbmRlbnQsIHByb3BlcnR5TmFtZSwgdmFsdWVzfSkge1xuICAgIHJldHVybiB0aGlzLmZvcm1hdHRlZEFycmF5UHJvcGVydHkoe2luZGVudCwgcHJvcGVydHlOYW1lLCB2YWx1ZXM6IE9iamVjdC5rZXlzKHZhbHVlcyl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIG9iamVjdCBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGb3JtYXR0aW5nIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmluZGVudCAtIEJhc2UgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb3BlcnR5TmFtZSAtIE9iamVjdCBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IGFyZ3MudmFsdWVzIC0gT2JqZWN0IGtleS12YWx1ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gW2FyZ3MuZmlsdGVyRGVmYXVsdFZhbHVlc10gLSBEZWZhdWx0IHZhbHVlcyB0byBvbWl0IGZyb20gb3V0cHV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBtdWx0aWxpbmUgb2JqZWN0IHByb3BlcnR5LlxuICAgKi9cbiAgZm9ybWF0dGVkT2JqZWN0UHJvcGVydHkoe2ZpbHRlckRlZmF1bHRWYWx1ZXMsIGluZGVudCwgcHJvcGVydHlOYW1lLCB2YWx1ZXN9KSB7XG4gICAgbGV0IG91dHB1dCA9IGAke2luZGVudH0ke3Byb3BlcnR5TmFtZX06IHtcXG5gXG5cbiAgICBmb3IgKGNvbnN0IG9iamVjdEtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZXMpKSB7XG4gICAgICBpZiAoZmlsdGVyRGVmYXVsdFZhbHVlcyAmJiBmaWx0ZXJEZWZhdWx0VmFsdWVzW29iamVjdEtleV0gPT09IHZhbHVlc1tvYmplY3RLZXldKSBjb250aW51ZVxuXG4gICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fSAgJHtvYmplY3RLZXl9OiAke0pTT04uc3RyaW5naWZ5KHZhbHVlc1tvYmplY3RLZXldKX0sXFxuYFxuICAgIH1cblxuICAgIG91dHB1dCArPSBgJHtpbmRlbnR9fSxcXG5gXG5cbiAgICByZXR1cm4gb3V0cHV0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JtYXR0ZWQgSlNPTiBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGb3JtYXR0aW5nIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmluZGVudCAtIEJhc2UgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb3BlcnR5TmFtZSAtIE9iamVjdCBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGFyZ3MudmFsdWUgLSBKU09OLWNvbXBhdGlibGUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRm9ybWF0dGVkIHByb3BlcnR5LlxuICAgKi9cbiAgZm9ybWF0dGVkSnNvblByb3BlcnR5KHtpbmRlbnQsIHByb3BlcnR5TmFtZSwgdmFsdWV9KSB7XG4gICAgcmV0dXJuIGAke2luZGVudH0ke3Byb3BlcnR5TmFtZX06ICR7dGhpcy5mb3JtYXR0ZWRKc29uVmFsdWUoe2luZGVudCwgdmFsdWV9KX0sXFxuYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIEpTT04gdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRm9ybWF0dGluZyBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbmRlbnQgLSBJbmRlbnRhdGlvbiBiZWZvcmUgdGhpcyB2YWx1ZS5cbiAgICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnZhbHVlIC0gSlNPTi1jb21wYXRpYmxlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCB2YWx1ZS5cbiAgICovXG4gIGZvcm1hdHRlZEpzb25WYWx1ZSh7aW5kZW50LCB2YWx1ZX0pIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGxldCBvdXRwdXQgPSBcIltcXG5cIlxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHZhbHVlKSB7XG4gICAgICAgIG91dHB1dCArPSBgJHtpbmRlbnR9ICAke3RoaXMuZm9ybWF0dGVkSnNvblZhbHVlKHtpbmRlbnQ6IGAke2luZGVudH0gIGAsIHZhbHVlOiBlbnRyeX0pfSxcXG5gXG4gICAgICB9XG5cbiAgICAgIG91dHB1dCArPSBgJHtpbmRlbnR9XWBcblxuICAgICAgcmV0dXJuIG91dHB1dFxuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGxldCBvdXRwdXQgPSBcIntcXG5cIlxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZSkpIHtcbiAgICAgICAgb3V0cHV0ICs9IGAke2luZGVudH0gICR7dGhpcy5mb3JtYXR0ZWRPYmplY3RLZXkoa2V5KX06ICR7dGhpcy5mb3JtYXR0ZWRKc29uVmFsdWUoe2luZGVudDogYCR7aW5kZW50fSAgYCwgdmFsdWU6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh2YWx1ZSlba2V5XX0pfSxcXG5gXG4gICAgICB9XG5cbiAgICAgIG91dHB1dCArPSBgJHtpbmRlbnR9fWBcblxuICAgICAgcmV0dXJuIG91dHB1dFxuICAgIH1cblxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBvYmplY3Qga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gT2JqZWN0IGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBKYXZhU2NyaXB0IG9iamVjdCBrZXkuXG4gICAqL1xuICBmb3JtYXR0ZWRPYmplY3RLZXkoa2V5KSB7XG4gICAgcmV0dXJuIC9eW0EtWmEtel8kXVtcXHckXSokLy50ZXN0KGtleSkgPyBrZXkgOiBKU09OLnN0cmluZ2lmeShrZXkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRyaWJ1dGUgZGVmaW5pdGlvbnMgZm9yIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5tb2RlbENvbmZpZyAtIE1vZGVsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSBbYXJncy5yZXNvdXJjZUNsYXNzXSAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7anNEb2NUeXBlOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgd3JpdGVKc0RvY1R5cGU6IHN0cmluZ30+Pn0gLSBBdHRyaWJ1dGUgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBhc3luYyBhdHRyaWJ1dGVEZWZpbml0aW9uc0Zvck1vZGVsKHtjbGFzc05hbWUsIG1vZGVsQ2xhc3MsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGxldCBhdHRyaWJ1dGVzID0gbW9kZWxDb25maWcuYXR0cmlidXRlc1xuXG4gICAgLy8gQXV0by1kZXJpdmUgYXR0cmlidXRlcyBmcm9tIG1vZGVsIGNvbHVtbnMgd2hlbiBub3QgZXhwbGljaXRseSBkZWZpbmVkXG4gICAgaWYgKCghYXR0cmlidXRlcyB8fCAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSAmJiBhdHRyaWJ1dGVzLmxlbmd0aCA9PT0gMCkpICYmIG1vZGVsQ2xhc3MpIHtcbiAgICAgIGNvbnN0IGNvbHVtbnMgPSBtb2RlbENsYXNzLmdldENvbHVtbnMoKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShjb2x1bW5zKSkge1xuICAgICAgICBhdHRyaWJ1dGVzID0gY29sdW1ucy5tYXAoKGNvbHVtbikgPT4gaW5mbGVjdGlvbi5jYW1lbGl6ZShjb2x1bW4uZ2V0TmFtZSgpLCB0cnVlKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgYXR0cmlidXRlRGVmaW5pdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZURlZmluaXRpb24gb2YgYXR0cmlidXRlcykge1xuICAgICAgICAvKiogQHR5cGUge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbH0gKi9cbiAgICAgICAgbGV0IGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcgPSBudWxsXG4gICAgICAgIGxldCBhdHRyaWJ1dGVOYW1lXG5cbiAgICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVEZWZpbml0aW9uID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lID0gYXR0cmlidXRlRGVmaW5pdGlvblxuICAgICAgICB9IGVsc2UgaWYgKGF0dHJpYnV0ZURlZmluaXRpb24gJiYgdHlwZW9mIGF0dHJpYnV0ZURlZmluaXRpb24gPT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVEZWZpbml0aW9uKSkge1xuICAgICAgICAgIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcgPSAvKiogQHR5cGUge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnfSAqLyAoYXR0cmlidXRlRGVmaW5pdGlvbilcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lID0gY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZy5uYW1lXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZU5hbWUgIT0gXCJzdHJpbmdcIiB8fCBhdHRyaWJ1dGVOYW1lLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBhcnJheSBlbnRyaWVzIHRvIGJlIHN0cmluZ3Mgb3Igb2JqZWN0cyB3aXRoIGEgbmFtZSwgZ290OiAke0pTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZURlZmluaXRpb24pfWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdHRyaWJ1dGVDb25maWcgPSBhd2FpdCB0aGlzLnJlc29sdmVkRnJvbnRlbmRBdHRyaWJ1dGVDb25maWcoe1xuICAgICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcsXG4gICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICByZXNvdXJjZUNsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29uc3QgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgPSB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yR2VuZXJhdGVkQXR0cmlidXRlKHtcbiAgICAgICAgICBhdHRyaWJ1dGVDb25maWcsXG4gICAgICAgICAgYXR0cmlidXRlTmFtZSxcbiAgICAgICAgICBtb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXR0cmlidXRlRGVmaW5pdGlvbnMucHVzaCh7XG4gICAgICAgICAganNEb2NUeXBlOiB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWc6IGZyb250ZW5kQXR0cmlidXRlQ29uZmlnfSksXG4gICAgICAgICAgbmFtZTogYXR0cmlidXRlTmFtZSxcbiAgICAgICAgICB3cml0ZUpzRG9jVHlwZTogdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZFdyaXRlQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWc6IGZyb250ZW5kQXR0cmlidXRlQ29uZmlnfSlcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZURlZmluaXRpb25zXG4gICAgfVxuXG4gICAgaWYgKCFhdHRyaWJ1dGVzIHx8IHR5cGVvZiBhdHRyaWJ1dGVzICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICdhdHRyaWJ1dGVzJyBhcyBhcnJheSBvciBvYmplY3QgYnV0IGdvdDogJHthdHRyaWJ1dGVzfWApXG4gICAgfVxuXG4gICAgY29uc3QgYXR0cmlidXRlRGVmaW5pdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVDb25maWcgPSBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgICBjb25zdCBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnID0gYXR0cmlidXRlQ29uZmlnICYmIHR5cGVvZiBhdHRyaWJ1dGVDb25maWcgPT09IFwib2JqZWN0XCJcbiAgICAgICAgPyAvKiogQHR5cGUge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnfSAqLyAoYXR0cmlidXRlQ29uZmlnKVxuICAgICAgICA6IG51bGxcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVDb25maWcgPSBhd2FpdCB0aGlzLnJlc29sdmVkRnJvbnRlbmRBdHRyaWJ1dGVDb25maWcoe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcsXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIHJlc291cmNlQ2xhc3NcbiAgICAgIH0pXG4gICAgICBjb25zdCBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyA9IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JHZW5lcmF0ZWRBdHRyaWJ1dGUoe1xuICAgICAgICBhdHRyaWJ1dGVDb25maWc6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVDb25maWcsXG4gICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIG1vZGVsQ2xhc3NcbiAgICAgIH0pXG5cbiAgICAgIGF0dHJpYnV0ZURlZmluaXRpb25zLnB1c2goe1xuICAgICAgICBqc0RvY1R5cGU6IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZzogZnJvbnRlbmRBdHRyaWJ1dGVDb25maWd9KSxcbiAgICAgICAgbmFtZTogYXR0cmlidXRlTmFtZSxcbiAgICAgICAgd3JpdGVKc0RvY1R5cGU6IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnOiBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30pXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVEZWZpbml0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgZ2VuZXJhdGVkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlQ29uZmlnOiBGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZywgYXR0cmlidXRlTmFtZTogc3RyaW5nLCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWd9IC0gQXR0cmlidXRlIGNvbmZpZyB1c2VkIGZvciBnZW5lcmF0ZWQgSlNEb2MuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckdlbmVyYXRlZEF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnLCBhdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGlmICghdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUlzTW9kZWxQcmltYXJ5S2V5KHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkpIHJldHVybiBhdHRyaWJ1dGVDb25maWdcbiAgICBpZiAodGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0hhc051bGxhYmlsaXR5KGF0dHJpYnV0ZUNvbmZpZykpIHJldHVybiBhdHRyaWJ1dGVDb25maWdcblxuICAgIHJldHVybiB7Li4uYXR0cmlidXRlQ29uZmlnLCBudWxsOiBmYWxzZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBpcyBtb2RlbCBwcmltYXJ5IGtleS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZTogc3RyaW5nLCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgaXMgdGhlIG1vZGVsIHByaW1hcnkga2V5LlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVJc01vZGVsUHJpbWFyeUtleSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2YgQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSA/IHByaW1hcnlLZXkgOiBbcHJpbWFyeUtleV0pIHtcbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBjb2x1bW5OYW1lKSByZXR1cm4gdHJ1ZVxuICAgICAgaWYgKG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoY29sdW1uTmFtZSkgPT09IGF0dHJpYnV0ZU5hbWUpIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHByaW1hcnkga2V5IGZyb20gZXhwbGljaXQgcmVzb3VyY2UgY29uZmlnIG9yIHRoZSBiYWNrZW5kIG1vZGVsLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lczogQXJyYXk8c3RyaW5nPiwgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBtb2RlbENvbmZpZzogaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn19IGFyZ3MgLSBQcmltYXJ5IGtleSByZXNvbHV0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBBcnJheTxzdHJpbmc+fSAtIEZyb250ZW5kLW1vZGVsIHByaW1hcnkga2V5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlGb3JSZXNvdXJjZSh7YXR0cmlidXRlTmFtZXMsIG1vZGVsQ2xhc3MsIG1vZGVsQ29uZmlnfSkge1xuICAgIGlmIChtb2RlbENvbmZpZy5wcmltYXJ5S2V5KSB7XG4gICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZWRDb25maWd1cmVkUHJpbWFyeUtleSh7YXR0cmlidXRlTmFtZXMsIHByaW1hcnlLZXk6IG1vZGVsQ29uZmlnLnByaW1hcnlLZXl9KVxuICAgIH1cblxuICAgIGlmICghbW9kZWxDbGFzcykgcmV0dXJuIFwiaWRcIlxuXG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlGb3JNb2RlbENsYXNzKHthdHRyaWJ1dGVOYW1lcywgbW9kZWxDbGFzc30pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBnZW5lcmF0ZWQgbW9kZWwncyBjb25jcmV0ZSBwcmltYXJ5LWtleSB2YWx1ZSB0eXBlLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzVHlwZU5hbWU6IHN0cmluZywgcHJpbWFyeUtleTogc3RyaW5nIHwgc3RyaW5nW119fSBhcmdzIC0gUHJpbWFyeS1rZXkgdHlwZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSlNEb2MgdHlwZSBleHByZXNzaW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlWYWx1ZVR5cGUoe2F0dHJpYnV0ZXNUeXBlTmFtZSwgcHJpbWFyeUtleX0pIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkge1xuICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBwcmltYXJ5S2V5Lm1hcCgoYXR0cmlidXRlTmFtZSkgPT4gSlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlTmFtZSkpLmpvaW4oXCIgfCBcIilcblxuICAgICAgcmV0dXJuIGBQaWNrPCR7YXR0cmlidXRlc1R5cGVOYW1lfSwgJHthdHRyaWJ1dGVOYW1lc30+YFxuICAgIH1cblxuICAgIHJldHVybiBgJHthdHRyaWJ1dGVzVHlwZU5hbWV9WyR7SlNPTi5zdHJpbmdpZnkocHJpbWFyeUtleSl9XWBcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYW4gZXhwbGljaXRseSBjb25maWd1cmVkIGZyb250ZW5kLW1vZGVsIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lczogQXJyYXk8c3RyaW5nPiwgcHJpbWFyeUtleTogc3RyaW5nIHwgc3RyaW5nW119fSBhcmdzIC0gQ29uZmlndXJlZCBwcmltYXJ5IGtleSBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgc3RyaW5nW119IC0gQ29uZmlndXJlZCBwcmltYXJ5IGtleS5cbiAgICovXG4gIHZhbGlkYXRlZENvbmZpZ3VyZWRQcmltYXJ5S2V5KHthdHRyaWJ1dGVOYW1lcywgcHJpbWFyeUtleX0pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlcyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXldXG5cbiAgICBpZiAocHJpbWFyeUtleUF0dHJpYnV0ZXMubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBjb21wb3NpdGUgcHJpbWFyeSBrZXkgbXVzdCBjb250YWluIGF0IGxlYXN0IG9uZSBhdHRyaWJ1dGUuXCIpXG4gICAgfVxuXG4gICAgaWYgKG5ldyBTZXQocHJpbWFyeUtleUF0dHJpYnV0ZXMpLnNpemUgIT09IHByaW1hcnlLZXlBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBjb21wb3NpdGUgcHJpbWFyeSBrZXkgYXR0cmlidXRlcyBtdXN0IGJlIHVuaXF1ZS5cIilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgcHJpbWFyeUtleUF0dHJpYnV0ZXMpIHtcbiAgICAgIGlmICghYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIHByaW1hcnkga2V5IFwiJHthdHRyaWJ1dGVOYW1lfVwiIGlzIG5vdCBhIGdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUuYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcHJpbWFyeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBiYWNrZW5kIHByaW1hcnkga2V5IHRvIGdlbmVyYXRlZCBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWVzOiBBcnJheTxzdHJpbmc+LCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gUHJpbWFyeSBrZXkgcmVzb2x1dGlvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nPn0gLSBGcm9udGVuZC1tb2RlbCBwcmltYXJ5IGtleSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5Rm9yTW9kZWxDbGFzcyh7YXR0cmlidXRlTmFtZXMsIG1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICBpZiAocHJpbWFyeUtleSA9PT0gXCJpZFwiKSByZXR1cm4gXCJpZFwiXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkge1xuICAgICAgcmV0dXJuIHByaW1hcnlLZXkubWFwKChjb2x1bW5OYW1lKSA9PiB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5QXR0cmlidXRlTmFtZSh7YXR0cmlidXRlTmFtZXMsIGNvbHVtbk5hbWUsIG1vZGVsQ2xhc3N9KSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleUF0dHJpYnV0ZU5hbWUoe2F0dHJpYnV0ZU5hbWVzLCBjb2x1bW5OYW1lOiBwcmltYXJ5S2V5LCBtb2RlbENsYXNzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBvbmUgYmFja2VuZCBwcmltYXJ5IGtleSBjb2x1bW4gdG8gYSBnZW5lcmF0ZWQgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWVzOiBBcnJheTxzdHJpbmc+LCBjb2x1bW5OYW1lOiBzdHJpbmcsIG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19IGFyZ3MgLSBQcmltYXJ5IGtleSBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZyb250ZW5kLW1vZGVsIHByaW1hcnkga2V5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlBdHRyaWJ1dGVOYW1lKHthdHRyaWJ1dGVOYW1lcywgY29sdW1uTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoY29sdW1uTmFtZSkpIHJldHVybiBjb2x1bW5OYW1lXG5cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb2x1bW5OYW1lKVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWUgJiYgYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsQ2xhc3MubmFtZX0ucHJpbWFyeUtleSgpIGNvbHVtbiBcIiR7Y29sdW1uTmFtZX1cIiBkb2VzIG5vdCByZXNvbHZlIHRvIGEgZ2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZS5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZnJvbSBleHBsaWNpdCBtZXRhZGF0YSwgcmVzb3VyY2UgbWV0aG9kcywgbW9kZWwgY29sdW1ucywgdHJhbnNsYXRlZCBjb2x1bW5zLCBvciBtb2RlbCBhY2Nlc3NvciBKU0RvYy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBGcm9udGVuZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGx9IGFyZ3MuY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZyAtIFJlc291cmNlLXByb3ZpZGVkIGF0dHJpYnV0ZSBjb25maWcuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5yZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kQXR0cmlidXRlQ29uZmlnPn0gLSBSZXNvbHZlZCBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZWRGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyh7YXR0cmlidXRlTmFtZSwgY2xhc3NOYW1lLCBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnLCBtb2RlbENsYXNzLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGNvbnN0IGluZmVycmVkUmVzb3VyY2VDb25maWcgPSBhd2FpdCB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yUmVzb3VyY2VBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIHJlc291cmNlQ2xhc3N9KVxuICAgIGNvbnN0IGluZmVycmVkQ29sdW1uQ29uZmlnID0gaW5mZXJyZWRSZXNvdXJjZUNvbmZpZ1xuICAgICAgPyBudWxsXG4gICAgICA6IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JNb2RlbEF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pXG4gICAgY29uc3QgaW5mZXJyZWRUcmFuc2xhdGVkQ29uZmlnID0gaW5mZXJyZWRSZXNvdXJjZUNvbmZpZyB8fCBpbmZlcnJlZENvbHVtbkNvbmZpZ1xuICAgICAgPyBudWxsXG4gICAgICA6IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JUcmFuc2xhdGVkQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzLCByZXNvdXJjZUNsYXNzfSlcbiAgICBjb25zdCBpbmZlcnJlZE1vZGVsQWNjZXNzb3JDb25maWcgPSBpbmZlcnJlZFJlc291cmNlQ29uZmlnIHx8IGluZmVycmVkQ29sdW1uQ29uZmlnIHx8IGluZmVycmVkVHJhbnNsYXRlZENvbmZpZ1xuICAgICAgPyBudWxsXG4gICAgICA6IGF3YWl0IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JNb2RlbEFjY2Vzc29yKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSlcbiAgICBjb25zdCBpbmZlcnJlZENvbmZpZyA9IGluZmVycmVkUmVzb3VyY2VDb25maWcgfHwgaW5mZXJyZWRDb2x1bW5Db25maWcgfHwgaW5mZXJyZWRUcmFuc2xhdGVkQ29uZmlnIHx8IGluZmVycmVkTW9kZWxBY2Nlc3NvckNvbmZpZ1xuXG4gICAgaWYgKGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcgJiYgdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0hhc1R5cGUoY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZykpIHtcbiAgICAgIHJldHVybiBpbmZlcnJlZENvbmZpZ1xuICAgICAgICA/IHsuLi5pbmZlcnJlZENvbmZpZywgLi4uY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZ31cbiAgICAgICAgOiBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnXG4gICAgfVxuXG4gICAgaWYgKGluZmVycmVkQ29uZmlnKSB7XG4gICAgICByZXR1cm4gY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZ1xuICAgICAgICA/IHsuLi5pbmZlcnJlZENvbmZpZywgLi4uY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZ31cbiAgICAgICAgOiBpbmZlcnJlZENvbmZpZ1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGluZmVyIEpTRG9jIHR5cGUgZm9yIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSAnJHtjbGFzc05hbWV9IyR7YXR0cmlidXRlTmFtZX0nLiBBZGQgYSBiYWNrZW5kIG1vZGVsIGNvbHVtbiwgdHJhbnNsYXRpb24gdGFibGUgY29sdW1uLCBleHBsaWNpdCByZXNvdXJjZSBtZXRhZGF0YSwgb3IgYSBAcmV0dXJucyBKU0RvYyB0eXBlIG9uICR7cmVzb3VyY2VDbGFzcz8ubmFtZSB8fCBcInRoZSByZXNvdXJjZVwifS4ke2F0dHJpYnV0ZU5hbWV9QXR0cmlidXRlKCkuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgaGFzIHR5cGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb25maWcgZGVjbGFyZXMgYSB0eXBlIHNvdXJjZS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnSGFzVHlwZShhdHRyaWJ1dGVDb25maWcpIHtcbiAgICByZXR1cm4gdHlwZW9mIHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVUeXBlVmFsdWUoYXR0cmlidXRlQ29uZmlnKSA9PSBcInN0cmluZ1wiXG4gICAgICB8fCB0eXBlb2YgYXR0cmlidXRlQ29uZmlnPy5qc0RvY1R5cGUgPT0gXCJzdHJpbmdcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBoYXMgbnVsbGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb25maWcgZGVjbGFyZXMgbnVsbGFiaWxpdHkuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0hhc051bGxhYmlsaXR5KGF0dHJpYnV0ZUNvbmZpZykge1xuICAgIGlmICghYXR0cmlidXRlQ29uZmlnIHx8IHR5cGVvZiBhdHRyaWJ1dGVDb25maWcgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYXR0cmlidXRlQ29uZmlnLCBcIm51bGxcIikpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5nZXROdWxsID09IFwiZnVuY3Rpb25cIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHR5cGUgZm9yIGZyb250ZW5kIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEpTRG9jIHR5cGUuXG4gICAqL1xuICBqc0RvY1R5cGVGb3JGcm9udGVuZEF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnfSkge1xuICAgIGlmIChhdHRyaWJ1dGVDb25maWcgJiYgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGUgPT0gXCJzdHJpbmdcIiAmJiBhdHRyaWJ1dGVDb25maWcuanNEb2NUeXBlLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVDb25maWcuanNEb2NUeXBlXG4gICAgfVxuXG4gICAgY29uc3QganNEb2NUeXBlID0gdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZEF0dHJpYnV0ZUJhc2VUeXBlKGF0dHJpYnV0ZUNvbmZpZylcblxuICAgIGlmICghdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNhbkJlTnVsbChhdHRyaWJ1dGVDb25maWcpKSB7XG4gICAgICByZXR1cm4ganNEb2NUeXBlXG4gICAgfVxuXG4gICAgcmV0dXJuIGAke2pzRG9jVHlwZX0gfCBudWxsYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHR5cGUgZm9yIGZyb250ZW5kIHdyaXRlIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEpTRG9jIHR5cGUgYWNjZXB0ZWQgYnkgY3JlYXRlL3VwZGF0ZSBwYXlsb2Fkcy5cbiAgICovXG4gIGpzRG9jVHlwZUZvckZyb250ZW5kV3JpdGVBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZ30pIHtcbiAgICBpZiAoYXR0cmlidXRlQ29uZmlnICYmIHR5cGVvZiBhdHRyaWJ1dGVDb25maWcuanNEb2NUeXBlID09IFwic3RyaW5nXCIgJiYgYXR0cmlidXRlQ29uZmlnLmpzRG9jVHlwZS5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gYXR0cmlidXRlQ29uZmlnLmpzRG9jVHlwZVxuICAgIH1cblxuICAgIGNvbnN0IGpzRG9jVHlwZSA9IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZUJhc2VUeXBlKGF0dHJpYnV0ZUNvbmZpZylcblxuICAgIGlmICghdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNhbkJlTnVsbChhdHRyaWJ1dGVDb25maWcpKSB7XG4gICAgICByZXR1cm4ganNEb2NUeXBlXG4gICAgfVxuXG4gICAgcmV0dXJuIGAke2pzRG9jVHlwZX0gfCBudWxsYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHR5cGUgZm9yIGZyb250ZW5kIHdyaXRlIGF0dHJpYnV0ZSBiYXNlIHR5cGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBOb24tbnVsbGFibGUgSlNEb2MgdHlwZSBhY2NlcHRlZCBieSBjcmVhdGUvdXBkYXRlIHBheWxvYWRzLlxuICAgKi9cbiAganNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZUJhc2VUeXBlKGF0dHJpYnV0ZUNvbmZpZykge1xuICAgIGNvbnN0IHJlYWRUeXBlID0gdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZEF0dHJpYnV0ZUJhc2VUeXBlKGF0dHJpYnV0ZUNvbmZpZylcblxuICAgIGlmICghdGhpcy5mcm9udGVuZEF0dHJpYnV0ZVR5cGVJc1RlbXBvcmFsKGF0dHJpYnV0ZUNvbmZpZykpIHJldHVybiByZWFkVHlwZVxuXG4gICAgcmV0dXJuIGAke3JlYWRUeXBlfSB8IHN0cmluZ2BcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpzIGRvYyB0eXBlIGZvciBmcm9udGVuZCBhdHRyaWJ1dGUgYmFzZSB0eXBlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9uLW51bGxhYmxlIEpTRG9jIHR5cGUuXG4gICAqL1xuICBqc0RvY1R5cGVGb3JGcm9udGVuZEF0dHJpYnV0ZUJhc2VUeXBlKGF0dHJpYnV0ZUNvbmZpZykge1xuICAgIGlmICghYXR0cmlidXRlQ29uZmlnIHx8IHR5cGVvZiBhdHRyaWJ1dGVDb25maWcgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBcIkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVwiXG4gICAgfVxuXG4gICAgY29uc3QgdHlwZSA9IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVUeXBlVmFsdWUoYXR0cmlidXRlQ29uZmlnKVxuXG4gICAgaWYgKHR5cGUgPT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHJldHVybiBcImJvb2xlYW5cIlxuICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcImpzb25cIiB8fCB0eXBlID09IFwianNvbmJcIikge1xuICAgICAgcmV0dXJuIFwiRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXCJcbiAgICB9IGVsc2UgaWYgKHR5cGUgJiYgW1wiYmxvYlwiLCBcImNoYXJcIiwgXCJudmFyY2hhclwiLCBcInZhcmNoYXJcIiwgXCJ0ZXh0XCIsIFwibG9uZ3RleHRcIiwgXCJtZWRpdW10ZXh0XCIsIFwidGlueXRleHRcIiwgXCJ1dWlkXCIsIFwiY2hhcmFjdGVyIHZhcnlpbmdcIl0uaW5jbHVkZXModHlwZSkpIHtcbiAgICAgIHJldHVybiBcInN0cmluZ1wiXG4gICAgfSBlbHNlIGlmICh0eXBlICYmIFtcImJpdFwiLCBcImJpZ2ludFwiLCBcImRlY2ltYWxcIiwgXCJkb3VibGVcIiwgXCJkb3VibGUgcHJlY2lzaW9uXCIsIFwiZmxvYXRcIiwgXCJpbnRcIiwgXCJpbnRlZ2VyXCIsIFwibnVtZXJpY1wiLCBcInJlYWxcIiwgXCJzbWFsbGludFwiLCBcInRpbnlpbnRcIl0uaW5jbHVkZXModHlwZSkpIHtcbiAgICAgIHJldHVybiBcIm51bWJlclwiXG4gICAgfSBlbHNlIGlmICh0aGlzLmZyb250ZW5kQXR0cmlidXRlVHlwZUlzVGVtcG9yYWwoYXR0cmlidXRlQ29uZmlnKSkge1xuICAgICAgcmV0dXJuIFwiRGF0ZVwiXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBcIkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIHR5cGUgaXMgdGVtcG9yYWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIHJlcHJlc2VudHMgYSBkYXRlL3RpbWUgdmFsdWUuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZVR5cGVJc1RlbXBvcmFsKGF0dHJpYnV0ZUNvbmZpZykge1xuICAgIGlmICghYXR0cmlidXRlQ29uZmlnIHx8IHR5cGVvZiBhdHRyaWJ1dGVDb25maWcgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgdHlwZSA9IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVUeXBlVmFsdWUoYXR0cmlidXRlQ29uZmlnKVxuXG4gICAgcmV0dXJuIHR5cGUgPyBbXCJkYXRlXCIsIFwiZGF0ZXRpbWVcIiwgXCJ0aW1lc3RhbXBcIiwgXCJ0aW1lc3RhbXAgd2l0aG91dCB0aW1lIHpvbmVcIiwgXCJ0aW1lc3RhbXB0elwiXS5pbmNsdWRlcyh0eXBlKSA6IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY2FuIGJlIG51bGwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGFsbG93cyBudWxsIHZhbHVlcy5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlQ2FuQmVOdWxsKGF0dHJpYnV0ZUNvbmZpZykge1xuICAgIGlmICghYXR0cmlidXRlQ29uZmlnIHx8IHR5cGVvZiBhdHRyaWJ1dGVDb25maWcgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYXR0cmlidXRlQ29uZmlnLmdldE51bGwgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXR0cmlidXRlQ29uZmlnLmdldE51bGwoKSA9PT0gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVDb25maWcubnVsbCA9PT0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIHR5cGUgdmFsdWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gTm9ybWFsaXplZCBjb2x1bW4gdHlwZS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlVHlwZVZhbHVlKGF0dHJpYnV0ZUNvbmZpZykge1xuICAgIGlmICghYXR0cmlidXRlQ29uZmlnIHx8IHR5cGVvZiBhdHRyaWJ1dGVDb25maWcgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVDb25maWcuZ2V0VHlwZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBTdHJpbmcoYXR0cmlidXRlQ29uZmlnLmdldFR5cGUoKSlcbiAgICB9XG5cbiAgICBjb25zdCB0eXBlVmFsdWUgPSBhdHRyaWJ1dGVDb25maWcudHlwZSB8fCBhdHRyaWJ1dGVDb25maWcuY29sdW1uVHlwZSB8fCBhdHRyaWJ1dGVDb25maWcuc3FsVHlwZSB8fCBhdHRyaWJ1dGVDb25maWcuZGF0YVR5cGVcblxuICAgIGlmICh0eXBlb2YgdHlwZVZhbHVlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIHJldHVybiB0eXBlVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIHJlc291cmNlIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MucmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGw+fSAtIEF0dHJpYnV0ZSBjb25maWcgaW5mZXJyZWQgZnJvbSByZXNvdXJjZSBtZXRob2QgSlNEb2MuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvclJlc291cmNlQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGlmICghcmVzb3VyY2VDbGFzcykgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBgJHthdHRyaWJ1dGVOYW1lfUF0dHJpYnV0ZWBcbiAgICBjb25zdCBvd25lckNsYXNzTmFtZSA9IHRoaXMubWV0aG9kT3duZXJDbGFzc05hbWUoe21ldGhvZE5hbWUsIHRhcmdldENsYXNzOiByZXNvdXJjZUNsYXNzfSlcblxuICAgIGlmICghb3duZXJDbGFzc05hbWUpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBqc0RvY1R5cGUgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUmV0dXJuVHlwZSh7XG4gICAgICBtZXRob2ROYW1lLFxuICAgICAgc291cmNlQ2xhc3NOYW1lOiBvd25lckNsYXNzTmFtZVxuICAgIH0pXG5cbiAgICByZXR1cm4ganNEb2NUeXBlID8ge2pzRG9jVHlwZTogdGhpcy51bndyYXBwZWRQcm9taXNlSnNEb2NUeXBlKHtqc0RvY1R5cGV9KX0gOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGZvciB0cmFuc2xhdGVkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbH0gLSBBdHRyaWJ1dGUgY29uZmlnIGluZmVycmVkIGZyb20gdHJhbnNsYXRlZCBhdHRyaWJ1dGUgY29sdW1ucy5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yVHJhbnNsYXRlZEF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHJldHVybiBudWxsXG4gICAgaWYgKCF0aGlzLmZyb250ZW5kQXR0cmlidXRlSXNUcmFuc2xhdGVkKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzLCByZXNvdXJjZUNsYXNzfSkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBUcmFuc2xhdGlvbkNsYXNzID0gbW9kZWxDbGFzcy5nZXRUcmFuc2xhdGlvbkNsYXNzKClcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBsZXQgY29sdW1uXG5cbiAgICB0cnkge1xuICAgICAgY29sdW1uID0gVHJhbnNsYXRpb25DbGFzcy5nZXRDb2x1bW5zSGFzaCgpW2NvbHVtbk5hbWVdXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIChlcnJvci5tZXNzYWdlLmluY2x1ZGVzKFwiaGFzbid0IGJlZW4gaW5pdGlhbGl6ZWQgeWV0XCIpIHx8IGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJ1c2VkIGJlZm9yZSBpbml0aWFsaXphdGlvblwiKSkpIHJldHVybiBudWxsXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbHVtbiA/IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JDb2x1bW4oe2NvbHVtbn0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGlzIHRyYW5zbGF0ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5yZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGZyb250ZW5kIGF0dHJpYnV0ZSBpcyB0cmFuc2xhdGVkLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVJc1RyYW5zbGF0ZWQoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgaWYgKHJlc291cmNlQ2xhc3MpIHtcbiAgICAgIGNvbnN0IHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gcmVzb3VyY2VDbGFzcy50cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHRyYW5zbGF0ZWRBdHRyaWJ1dGVzKSAmJiB0cmFuc2xhdGVkQXR0cmlidXRlcy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBjb25zdCB0cmFuc2xhdGlvbnMgPSBtb2RlbENsYXNzLl90cmFuc2xhdGlvbnNcblxuICAgIHJldHVybiBCb29sZWFuKHRyYW5zbGF0aW9ucyAmJiB0eXBlb2YgdHJhbnNsYXRpb25zID09IFwib2JqZWN0XCIgJiYgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRyYW5zbGF0aW9ucywgYXR0cmlidXRlTmFtZSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGZvciBtb2RlbCBhY2Nlc3Nvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbD59IC0gQXR0cmlidXRlIGNvbmZpZyBpbmZlcnJlZCBmcm9tIG1vZGVsIGFjY2Vzc29yIEpTRG9jLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JNb2RlbEFjY2Vzc29yKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGlmICghbW9kZWxDbGFzcykgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG93bmVyQ2xhc3NOYW1lID0gdGhpcy5tZXRob2RPd25lckNsYXNzTmFtZSh7bWV0aG9kTmFtZTogYXR0cmlidXRlTmFtZSwgdGFyZ2V0Q2xhc3M6IG1vZGVsQ2xhc3N9KVxuXG4gICAgaWYgKCFvd25lckNsYXNzTmFtZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGpzRG9jVHlwZSA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlKHtcbiAgICAgIG1ldGhvZE5hbWU6IGF0dHJpYnV0ZU5hbWUsXG4gICAgICBzb3VyY2VDbGFzc05hbWU6IG93bmVyQ2xhc3NOYW1lXG4gICAgfSlcblxuICAgIC8vIEZyb250ZW5kIGF0dHJpYnV0ZXMgaG9sZCB0aGUgc2VyaWFsaXplZCAocmVzb2x2ZWQpIHZhbHVlLCBzbyBhbiBhc3luY1xuICAgIC8vIGJhY2tlbmQgYWNjZXNzb3IgdHlwZWQgYFByb21pc2U8bnVtYmVyPmAgbXVzdCBzdXJmYWNlIGFzIGBudW1iZXJgIOKAlCB0aGVcbiAgICAvLyBzYW1lIHVud3JhcHBpbmcgdGhlIHJlc291cmNlLW1ldGhvZCBpbmZlcmVuY2UgcGF0aCBhcHBsaWVzLlxuICAgIHJldHVybiBqc0RvY1R5cGVcbiAgICAgID8ge2pzRG9jVHlwZTogdGhpcy5mcm9udGVuZFJlc29sdmFibGVBdHRyaWJ1dGVKc0RvY1R5cGUodGhpcy51bndyYXBwZWRQcm9taXNlSnNEb2NUeXBlKHtqc0RvY1R5cGV9KSl9XG4gICAgICA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGJhY2tlbmQgYWNjZXNzb3IncyBgQHJldHVybnNgIGNhbiByZWZlcmVuY2UgdHlwZXMgdGhhdCBleGlzdCBvbmx5IG9uIHRoZVxuICAgKiBiYWNrZW5kIChlLmcuIGEgbW9kZWwtbG9jYWwgYEB0eXBlZGVmIEFnZW50UnVuUGxhbm5pbmdBcnRpZmFjdGApLiBUaGUgZnJvbnRlbmRcbiAgICogbW9kZWwgY2FuJ3QgcmVzb2x2ZSB0aG9zZSwgc28gZmFsbCBiYWNrIHRvIGBhbnlgIHJhdGhlciB0aGFuIGVtaXR0aW5nIGFuXG4gICAqIHVuZGVmaW5lZCB0eXBlIG5hbWUuIFR5cGVzIGJ1aWx0IG9ubHkgZnJvbSBwcmltaXRpdmVzIGFuZCBrbm93biBnZW5lcmljXG4gICAqIGJ1aWx0aW5zIHBhc3MgdGhyb3VnaCB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqc0RvY1R5cGUgLSBSZXNvbHZlZCAoUHJvbWlzZS11bndyYXBwZWQpIGF0dHJpYnV0ZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEEgZnJvbnRlbmQtcmVzb2x2YWJsZSBhdHRyaWJ1dGUgdHlwZS5cbiAgICovXG4gIGZyb250ZW5kUmVzb2x2YWJsZUF0dHJpYnV0ZUpzRG9jVHlwZShqc0RvY1R5cGUpIHtcbiAgICBjb25zdCBzYWZlVHlwZUlkZW50aWZpZXJzID0gdGhpcy5mcm9udGVuZFJlc29sdmFibGVUeXBlSWRlbnRpZmllcnMoKVxuICAgIGNvbnN0IHJlZmVyZW5jZWRJZGVudGlmaWVycyA9IGpzRG9jVHlwZS5tYXRjaCgvW0EtWl1bQS1aYS16MC05XyRdKi9nKSB8fCBbXVxuXG4gICAgaWYgKHJlZmVyZW5jZWRJZGVudGlmaWVycy5zb21lKChpZGVudGlmaWVyKSA9PiAhc2FmZVR5cGVJZGVudGlmaWVycy5oYXMoaWRlbnRpZmllcikpKSB7XG4gICAgICByZXR1cm4gXCJhbnlcIlxuICAgIH1cblxuICAgIHJldHVybiBqc0RvY1R5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXBpdGFsaXplZCBpZGVudGlmaWVycyBhIGdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBjYW4gcmVzb2x2ZSBvbiBpdHMgb3duXG4gICAqIChwcmltaXRpdmVzIGFyZSBsb3dlci1jYXNlIGFuZCBtYXRjaGVkIHNlcGFyYXRlbHkpLCBzbyBvbmx5IGZyYW1ld29yay1vd25lZFxuICAgKiBhbmQgYnVpbHRpbiBnZW5lcmljIHR5cGVzIGFyZSBsaXN0ZWQuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBGcm9udGVuZC1yZXNvbHZhYmxlIHR5cGUgaWRlbnRpZmllcnMuXG4gICAqL1xuICBmcm9udGVuZFJlc29sdmFibGVUeXBlSWRlbnRpZmllcnMoKSB7XG4gICAgcmV0dXJuIG5ldyBTZXQoW1xuICAgICAgXCJBcnJheVwiLCBcIkRhdGVcIiwgXCJFeGNsdWRlXCIsIFwiRXh0cmFjdFwiLCBcIkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVwiLCBcIkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVwiLFxuICAgICAgXCJNYXBcIiwgXCJOb25OdWxsYWJsZVwiLCBcIk9taXRcIiwgXCJQYXJ0aWFsXCIsIFwiUGlja1wiLCBcIlByb21pc2VcIiwgXCJSZWFkb25seVwiLCBcIlJlYWRvbmx5QXJyYXlcIiwgXCJSZWNvcmRcIixcbiAgICAgIFwiUmVxdWlyZWRcIiwgXCJSZXR1cm5UeXBlXCIsIFwiU2V0XCJcbiAgICBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJld3JpdGVzIGEgY3VzdG9tLWNvbW1hbmQgcGFyYW0vcmV0dXJuIEpTRG9jIHR5cGUgc28gaXQgcmVzb2x2ZXMgaW4gdGhlIGdlbmVyYXRlZFxuICAgKiBmcm9udGVuZCBtb2RlbDogYmFja2VuZCBtb2RlbCBpbXBvcnRzIGFyZSBtYXBwZWQgdG8gZ2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsXG4gICAqIGltcG9ydHMsIGFuZCBvdGhlcndpc2Ugbm9uLWZyb250ZW5kLXJlc29sdmFibGUgaWRlbnRpZmllcnMgYmVjb21lIGBhbnlgIGluIHBsYWNlXG4gICAqIHNvIHNpYmxpbmcgc2NhbGFyIGZpZWxkcyBrZWVwIHRoZWlyIHJlYWwgdHlwZXMuIFRoZSB3b3JkIGJvdW5kYXJ5IGF2b2lkcyBtYXRjaGluZ1xuICAgKiB0aGUgY2FwaXRhbGl6ZWQgbWlkZGxlIG9mIGEgY2FtZWxDYXNlIHByb3BlcnR5IG5hbWUgKGUuZy4gYGFkanVzdGVkVG90YWxDZW50c2ApLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmZyb250ZW5kTW9kZWxGaWxlUGF0aCAtIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7TWFwPHN0cmluZywgUmVzb3VyY2VKc0RvY0ltcG9ydEFsaWFzPn0gYXJncy5pbXBvcnRBbGlhc2VzIC0gSW1wb3J0IGFsaWFzZXMgdmlzaWJsZSB0byB0aGUgc291cmNlIG1ldGhvZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuanNEb2NUeXBlIC0gUmVzb2x2ZWQgKFByb21pc2UtdW53cmFwcGVkKSBKU0RvYyB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3Muc291cmNlRmlsZSAtIFNvdXJjZSBmaWxlIHRoYXQgZGVjbGFyZWQgdGhlIG1ldGhvZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBIGZyb250ZW5kLXJlc29sdmFibGUgSlNEb2MgdHlwZS5cbiAgICovXG4gIGZyb250ZW5kUmVzb2x2YWJsZUNvbW1hbmRKc0RvY1R5cGUoe2Zyb250ZW5kTW9kZWxGaWxlUGF0aCwgaW1wb3J0QWxpYXNlcywganNEb2NUeXBlLCBzb3VyY2VGaWxlfSkge1xuICAgIGNvbnN0IHNhZmVUeXBlSWRlbnRpZmllcnMgPSB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZVR5cGVJZGVudGlmaWVycygpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBwcmVzZXJ2ZWRJbXBvcnRzID0gW11cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgYW4gaW1wb3J0IGV4cHJlc3Npb24gYmVoaW5kIGEgbG93ZXJjYXNlIHBsYWNlaG9sZGVyIHdoaWxlIGdlbmVyaWNcbiAgICAgKiBpZGVudGlmaWVyIGNsZWFudXAgcnVucy5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gaW1wb3J0RXhwcmVzc2lvbiAtIEltcG9ydCBleHByZXNzaW9uIHRvIHByZXNlcnZlLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFBsYWNlaG9sZGVyIGluc2VydGVkIGludG8gdGhlIHR5cGUgc3RyaW5nLlxuICAgICAqL1xuICAgIGNvbnN0IHByZXNlcnZlSW1wb3J0RXhwcmVzc2lvbiA9IChpbXBvcnRFeHByZXNzaW9uKSA9PiB7XG4gICAgICBjb25zdCBwbGFjZWhvbGRlciA9IGBfX3ZlbG9jaW91c19pbXBvcnRfcGxhY2Vob2xkZXJfJHtwcmVzZXJ2ZWRJbXBvcnRzLmxlbmd0aH1fX2BcblxuICAgICAgcHJlc2VydmVkSW1wb3J0cy5wdXNoKGltcG9ydEV4cHJlc3Npb24pXG5cbiAgICAgIHJldHVybiBwbGFjZWhvbGRlclxuICAgIH1cblxuICAgIHRoaXMuYXNzZXJ0Tm9CYWNrZW5kTG9jYWxDb21tYW5kVHlwZUV4cHJlc3Npb25zKGpzRG9jVHlwZSlcblxuICAgIGNvbnN0IHdpdGhSZXdyaXR0ZW5JbmxpbmVJbXBvcnRzID0ganNEb2NUeXBlXG4gICAgICAvLyBBIHR5cGUgdGhhdCByZWFjaGVzIGludG8gYSBiYWNrZW5kIHNvdXJjZSBmaWxlIHZpYSBgaW1wb3J0KFwiLi4uXCIpYFxuICAgICAgLy8gKG9wdGlvbmFsbHkgYC5NZW1iZXJgIGFuZCBgW11gKSBpcyBmcm9udGVuZC1yZXNvbHZhYmxlIG9ubHkgd2hlbiBpdFxuICAgICAgLy8gcG9pbnRzIGF0IGEgZ2VuZXJhdGVkIG1vZGVsIGZpbGU7IG90aGVyIGJhY2tlbmQtbG9jYWwgaW1wb3J0cyBjb2xsYXBzZVxuICAgICAgLy8gdG8gYGFueWAgc28gaGVscGVyL3NlcnZpY2UgaW1wbGVtZW50YXRpb24gZGV0YWlscyBkbyBub3QgbGVhay5cbiAgICAgIC5yZXBsYWNlKC9pbXBvcnRcXChcXHMqW1wiJ10oW15cIiddKilbXCInXVxccypcXCkoKD86XFxzKlxcLlxccypbQS1aYS16XyRdW1xcdyRdKikqKSgoPzpcXHMqXFxbXFxzKlxcXSkqKS9nLCAoX21hdGNoLCBzcGVjaWZpZXIsIG1lbWJlckNoYWluLCBhcnJheVN1ZmZpeCkgPT4ge1xuICAgICAgICBjb25zdCByZXdyaXR0ZW5TcGVjaWZpZXIgPSB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZUpzRG9jSW1wb3J0U3BlY2lmaWVyKHtcbiAgICAgICAgICBmcm9udGVuZE1vZGVsRmlsZVBhdGgsXG4gICAgICAgICAgc291cmNlRmlsZSxcbiAgICAgICAgICBzcGVjaWZpZXJcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoIXJld3JpdHRlblNwZWNpZmllcikgcmV0dXJuIFwiYW55XCJcblxuICAgICAgICByZXR1cm4gcHJlc2VydmVJbXBvcnRFeHByZXNzaW9uKGBpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShyZXdyaXR0ZW5TcGVjaWZpZXIpfSkke21lbWJlckNoYWluLnJlcGxhY2UoL1xccysvZywgXCJcIil9JHthcnJheVN1ZmZpeC5yZXBsYWNlKC9cXHMrL2csIFwiXCIpfWApXG4gICAgICB9KVxuXG4gICAgbGV0IHdpdGhSZXdyaXR0ZW5BbGlhc2VzID0gd2l0aFJld3JpdHRlbklubGluZUltcG9ydHNcblxuICAgIGZvciAoY29uc3QgW2FsaWFzTmFtZSwgaW1wb3J0QWxpYXNdIG9mIGltcG9ydEFsaWFzZXMpIHtcbiAgICAgIGNvbnN0IHJld3JpdHRlblNwZWNpZmllciA9IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlSnNEb2NJbXBvcnRTcGVjaWZpZXIoe1xuICAgICAgICBmcm9udGVuZE1vZGVsRmlsZVBhdGgsXG4gICAgICAgIHNvdXJjZUZpbGUsXG4gICAgICAgIHNwZWNpZmllcjogaW1wb3J0QWxpYXMuc3BlY2lmaWVyXG4gICAgICB9KVxuXG4gICAgICBpZiAoIXJld3JpdHRlblNwZWNpZmllcikgY29udGludWVcblxuICAgICAgY29uc3QgYWxpYXNSZWdleCA9IG5ldyBSZWdFeHAoYFxcXFxiJHt0aGlzLmVzY2FwZVJlZ0V4cChhbGlhc05hbWUpfVxcXFxiYCwgXCJnXCIpXG5cbiAgICAgIHdpdGhSZXdyaXR0ZW5BbGlhc2VzID0gd2l0aFJld3JpdHRlbkFsaWFzZXMucmVwbGFjZShhbGlhc1JlZ2V4LCBwcmVzZXJ2ZUltcG9ydEV4cHJlc3Npb24oYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHJld3JpdHRlblNwZWNpZmllcil9KS4ke2ltcG9ydEFsaWFzLmltcG9ydGVkTmFtZX1gKSlcbiAgICB9XG5cbiAgICBjb25zdCBzYW5pdGl6ZWQgPSB3aXRoUmV3cml0dGVuQWxpYXNlc1xuICAgICAgLy8gUmVtYWluaW5nIGNhcGl0YWxpemVkIGlkZW50aWZpZXJzIGFyZSBtb2RlbCBjbGFzc2VzIG9yIG90aGVyd2lzZSBub24tcmVzb2x2YWJsZVxuICAgICAgLy8gdHlwZXM7IGRvd25ncmFkZSBlYWNoIGluIHBsYWNlIHNvIHNpYmxpbmcgc2NhbGFyIGZpZWxkcyBrZWVwIHRoZWlyIHJlYWwgdHlwZXMuXG4gICAgICAucmVwbGFjZSgvXFxiW0EtWl1bQS1aYS16MC05XyRdKi9nLCAoaWRlbnRpZmllcikgPT4gc2FmZVR5cGVJZGVudGlmaWVycy5oYXMoaWRlbnRpZmllcikgPyBpZGVudGlmaWVyIDogXCJhbnlcIilcblxuICAgIHJldHVybiBwcmVzZXJ2ZWRJbXBvcnRzLnJlZHVjZShcbiAgICAgICh0eXBlLCBpbXBvcnRFeHByZXNzaW9uLCBpbmRleCkgPT4gdHlwZS5yZXBsYWNlQWxsKGBfX3ZlbG9jaW91c19pbXBvcnRfcGxhY2Vob2xkZXJfJHtpbmRleH1fX2AsIGltcG9ydEV4cHJlc3Npb24pLFxuICAgICAgc2FuaXRpemVkXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJhaXNlcyB3aGVuIGEgY29tbWFuZCBKU0RvYyB0eXBlIHJlZmVyZW5jZXMgYSBiYWNrZW5kLWxvY2FsIGhlbHBlciBleHByZXNzaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ganNEb2NUeXBlIC0gQ29tbWFuZCBKU0RvYyB0eXBlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXNzZXJ0Tm9CYWNrZW5kTG9jYWxDb21tYW5kVHlwZUV4cHJlc3Npb25zKGpzRG9jVHlwZSkge1xuICAgIGNvbnN0IGxvY2FsUmV0dXJuVHlwZU1hdGNoID0ganNEb2NUeXBlLm1hdGNoKC9cXGIoPzpBd2FpdGVkXFxzKjxcXHMqKT9SZXR1cm5UeXBlXFxzKjxcXHMqdHlwZW9mXFxzK1tBLVphLXpfJF1bXFx3JF0qXFxzKj5cXHMqPj8vKVxuXG4gICAgaWYgKCFsb2NhbFJldHVyblR5cGVNYXRjaCkgcmV0dXJuXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEN1c3RvbSBjb21tYW5kIEpTRG9jIHR5cGUgY2Fubm90IHVzZSBiYWNrZW5kLWxvY2FsIFJldHVyblR5cGUgZXhwcmVzc2lvbnMgaW4gZ2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsczogJHtsb2NhbFJldHVyblR5cGVNYXRjaFswXX0uIE1vdmUgdGhlIHBheWxvYWQgc2hhcGUgdG8gYSBzaGFyZWQgdHlwZWRlZiBhbmQgcmV0dXJuIHRoYXQgdHlwZSBmcm9tIHRoZSBjb21tYW5kIG1ldGhvZC5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgcmVzb2x2YWJsZSBqcyBkb2MgaW1wb3J0IHNwZWNpZmllci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5mcm9udGVuZE1vZGVsRmlsZVBhdGggLSBHZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3Muc291cmNlRmlsZSAtIFNvdXJjZSBmaWxlIHRoYXQgZGVjbGFyZWQgdGhlIEpTRG9jIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNwZWNpZmllciAtIFNvdXJjZS1maWxlIGltcG9ydCBzcGVjaWZpZXIuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJld3JpdHRlbiBmcm9udGVuZC1tb2RlbCBpbXBvcnQgc3BlY2lmaWVyLCBvciBudWxsIHdoZW4gYmFja2VuZC1sb2NhbC5cbiAgICovXG4gIGZyb250ZW5kUmVzb2x2YWJsZUpzRG9jSW1wb3J0U3BlY2lmaWVyKHtmcm9udGVuZE1vZGVsRmlsZVBhdGgsIHNvdXJjZUZpbGUsIHNwZWNpZmllcn0pIHtcbiAgICBpZiAoIXNvdXJjZUZpbGUgfHwgIWZyb250ZW5kTW9kZWxGaWxlUGF0aCkgcmV0dXJuIG51bGxcbiAgICBpZiAoIXNwZWNpZmllci5zdGFydHNXaXRoKFwiLlwiKSAmJiAhc3BlY2lmaWVyLnN0YXJ0c1dpdGgoXCIvXCIpKSByZXR1cm4gc3BlY2lmaWVyXG5cbiAgICBjb25zdCBpbXBvcnRlZFBhdGggPSBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHNvdXJjZUZpbGUpLCBzcGVjaWZpZXIpXG4gICAgY29uc3QgbW9kZWxJbXBvcnRTcGVjaWZpZXIgPSB0aGlzLmZyb250ZW5kTW9kZWxJbXBvcnRTcGVjaWZpZXJGb3JCYWNrZW5kTW9kZWxQYXRoKHtcbiAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgIGltcG9ydGVkUGF0aFxuICAgIH0pXG5cbiAgICBpZiAobW9kZWxJbXBvcnRTcGVjaWZpZXIpIHJldHVybiBtb2RlbEltcG9ydFNwZWNpZmllclxuXG4gICAgaWYgKHRoaXMuZmlsZVBhdGhJc1dpdGhpbkFueURpcmVjdG9yeSh7ZGlyZWN0b3JpZXM6IHRoaXMuZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRGlyZWN0b3JpZXMoKSwgZmlsZVBhdGg6IGltcG9ydGVkUGF0aH0pKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnJlbGF0aXZlSW1wb3J0U3BlY2lmaWVyKHtmcm9tRmlsZTogZnJvbnRlbmRNb2RlbEZpbGVQYXRoLCB0b0ZpbGU6IGltcG9ydGVkUGF0aH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBpbXBvcnQgc3BlY2lmaWVyIGZvciBiYWNrZW5kIG1vZGVsIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mcm9udGVuZE1vZGVsRmlsZVBhdGggLSBHZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbXBvcnRlZFBhdGggLSBTb3VyY2UtZmlsZSBpbXBvcnQgcGF0aCByZXNvbHZlZCBmcm9tIEpTRG9jLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBHZW5lcmF0ZWQgZnJvbnRlbmQtbW9kZWwgaW1wb3J0IHNwZWNpZmllciwgb3IgbnVsbCB3aGVuIHRoZSBwYXRoIGlzIG5vdCBhIHJlZ2lzdGVyZWQgbW9kZWwgZmlsZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxJbXBvcnRTcGVjaWZpZXJGb3JCYWNrZW5kTW9kZWxQYXRoKHtmcm9udGVuZE1vZGVsRmlsZVBhdGgsIGltcG9ydGVkUGF0aH0pIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsc0RpcmVjdG9yeSA9IHBhdGguZGlybmFtZShmcm9udGVuZE1vZGVsRmlsZVBhdGgpXG4gICAgY29uc3QgaW1wb3J0ZWRNb2RlbFBhdGggPSBpbXBvcnRlZFBhdGguZW5kc1dpdGgoXCIuanNcIikgPyBpbXBvcnRlZFBhdGggOiBgJHtpbXBvcnRlZFBhdGh9LmpzYFxuXG4gICAgZm9yIChjb25zdCBtb2RlbEZpbGVOYW1lIG9mIHRoaXMuZ2VuZXJhdGVkRnJvbnRlbmRNb2RlbEZpbGVOYW1lcygpKSB7XG4gICAgICBmb3IgKGNvbnN0IHNvdXJjZURpcmVjdG9yeSBvZiB0aGlzLmZyb250ZW5kTW9kZWxKc0RvY1NvdXJjZURpcmVjdG9yaWVzKCkpIHtcbiAgICAgICAgY29uc3QgbW9kZWxzRGlyZWN0b3J5ID0gcGF0aC5qb2luKHNvdXJjZURpcmVjdG9yeSwgXCJtb2RlbHNcIilcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlTW9kZWxQYXRoID0gcGF0aC5qb2luKG1vZGVsc0RpcmVjdG9yeSwgbW9kZWxGaWxlTmFtZSlcblxuICAgICAgICBpZiAocGF0aC5yZXNvbHZlKGNhbmRpZGF0ZU1vZGVsUGF0aCkgIT09IHBhdGgucmVzb2x2ZShpbXBvcnRlZE1vZGVsUGF0aCkpIGNvbnRpbnVlXG5cbiAgICAgICAgcmV0dXJuIHRoaXMucmVsYXRpdmVJbXBvcnRTcGVjaWZpZXIoe1xuICAgICAgICAgIGZyb21GaWxlOiBmcm9udGVuZE1vZGVsRmlsZVBhdGgsXG4gICAgICAgICAgdG9GaWxlOiBwYXRoLmpvaW4oZnJvbnRlbmRNb2RlbHNEaXJlY3RvcnksIG1vZGVsRmlsZU5hbWUpXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRnJvbnRlbmQgbW9kZWwgZmlsZW5hbWVzIHRoYXQgdGhpcyBnZW5lcmF0aW9uIHJ1biBjYW4gZW1pdC5cbiAgICovXG4gIGdlbmVyYXRlZEZyb250ZW5kTW9kZWxGaWxlTmFtZXMoKSB7XG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBmaWxlTmFtZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlcyA9IHRoaXMucmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VNb2RlbE5hbWUgb2YgT2JqZWN0LmtleXMocmVzb3VyY2VzKSkge1xuICAgICAgICBjb25zdCBjbGFzc05hbWUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKHJlc291cmNlTW9kZWxOYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcblxuICAgICAgICBmaWxlTmFtZXMuYWRkKGAke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShjbGFzc05hbWUpKX0uanNgKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWxlTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aXZlIGltcG9ydCBzcGVjaWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mcm9tRmlsZSAtIFNvdXJjZSBmaWxlIHRoYXQgd2lsbCBjb250YWluIHRoZSBpbXBvcnQgZXhwcmVzc2lvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudG9GaWxlIC0gRmlsZSBiZWluZyBpbXBvcnRlZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSZWxhdGl2ZSBpbXBvcnQgc3BlY2lmaWVyLlxuICAgKi9cbiAgcmVsYXRpdmVJbXBvcnRTcGVjaWZpZXIoe2Zyb21GaWxlLCB0b0ZpbGV9KSB7XG4gICAgbGV0IHJlbGF0aXZlU3BlY2lmaWVyID0gcGF0aC5yZWxhdGl2ZShwYXRoLmRpcm5hbWUoZnJvbUZpbGUpLCB0b0ZpbGUpLnNwbGl0KHBhdGguc2VwKS5qb2luKFwiL1wiKVxuXG4gICAgaWYgKCFyZWxhdGl2ZVNwZWNpZmllci5zdGFydHNXaXRoKFwiLlwiKSkge1xuICAgICAgcmVsYXRpdmVTcGVjaWZpZXIgPSBgLi8ke3JlbGF0aXZlU3BlY2lmaWVyfWBcbiAgICB9XG5cbiAgICByZXR1cm4gcmVsYXRpdmVTcGVjaWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbGUgcGF0aCBpcyB3aXRoaW4gYW55IGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGlyZWN0b3JpZXMgLSBDYW5kaWRhdGUgcGFyZW50IGRpcmVjdG9yaWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5maWxlUGF0aCAtIEZpbGUgcGF0aCB0byB0ZXN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBmaWxlIHBhdGggaXMgdW5kZXIgb25lIGNhbmRpZGF0ZSBkaXJlY3RvcnkuXG4gICAqL1xuICBmaWxlUGF0aElzV2l0aGluQW55RGlyZWN0b3J5KHtkaXJlY3RvcmllcywgZmlsZVBhdGh9KSB7XG4gICAgcmV0dXJuIGRpcmVjdG9yaWVzLnNvbWUoKGRpcmVjdG9yeSkgPT4ge1xuICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcGF0aC5yZWxhdGl2ZShwYXRoLnJlc29sdmUoZGlyZWN0b3J5KSwgcGF0aC5yZXNvbHZlKGZpbGVQYXRoKSlcblxuICAgICAgcmV0dXJuIHJlbGF0aXZlUGF0aCA9PT0gXCJcIiB8fCAoIXJlbGF0aXZlUGF0aC5zdGFydHNXaXRoKFwiLi5cIikgJiYgIXBhdGguaXNBYnNvbHV0ZShyZWxhdGl2ZVBhdGgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXNjYXBlcyB0ZXh0IGZvciB1c2UgaW5zaWRlIGEgUmVnRXhwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBWYWx1ZSB0byBlc2NhcGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVnRXhwLXNhZmUgdmFsdWUuXG4gICAqL1xuICBlc2NhcGVSZWdFeHAodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBKU0RvYyBwYXJhbSBibG9jaywgcGFyYW1ldGVyIGxpc3QsIHBheWxvYWQtYXJndW1lbnQgZXhwcmVzc2lvbiwgYW5kXG4gICAqIHJldHVybiB0eXBlIGZvciBhIGN1c3RvbSBjb21tYW5kIG1ldGhvZC4gV2l0aCBkZWNsYXJlZCBgYXJnc2AgZWFjaCBiZWNvbWVzIGFcbiAgICogbmFtZWQsIHR5cGVkIHBhcmFtZXRlciBtYXBwZWQgcG9zaXRpb25hbGx5IGludG8gdGhlIGNvbW1hbmQgcGF5bG9hZDsgd2l0aG91dFxuICAgKiB0aGVtIHRoZSBtZXRob2Qgc3RheXMgdmFyaWFkaWMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fSBhcmdzLmNvbW1hbmRNZXRhZGF0YSAtIFBlci1jb21tYW5kIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXRob2ROYW1lIC0gQ29tbWFuZCBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3twYXJhbURvY3M6IHN0cmluZywgcGFyYW1ldGVyczogc3RyaW5nLCBwYXlsb2FkQXJndW1lbnRzOiBzdHJpbmcsIHJldHVyblR5cGU6IHN0cmluZ319IC0gR2VuZXJhdGlvbiBwaWVjZXMuXG4gICAqL1xuICBjdXN0b21Db21tYW5kTWV0aG9kU2lnbmF0dXJlKHtjb21tYW5kTWV0YWRhdGEsIG1ldGhvZE5hbWV9KSB7XG4gICAgY29uc3QgbWV0YWRhdGEgPSBjb21tYW5kTWV0YWRhdGFbbWV0aG9kTmFtZV0gfHwge2FyZ3M6IFtdLCByZXR1cm5UeXBlOiBudWxsfVxuICAgIGNvbnN0IHJldHVyblR5cGUgPSBtZXRhZGF0YS5yZXR1cm5UeXBlIHx8IFwiUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPlwiXG5cbiAgICBpZiAobWV0YWRhdGEuYXJncy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwYXJhbWV0ZXJOYW1lcyA9IG1ldGFkYXRhLmFyZ3MubWFwKChhcmcpID0+IGFyZy5uYW1lKVxuICAgICAgLy8gQSBzaW5nbGUgYXJncyBvYmplY3Qgd2hvc2UgZXZlcnkgZmllbGQgaXMgb3B0aW9uYWwgYWNjZXB0cyBge31gLCBzbyBkZWZhdWx0XG4gICAgICAvLyB0aGUgcGFyYW1ldGVyIGFuZCBtYXJrIGl0IG9wdGlvbmFsIOKAlCBjYWxsZXJzIGNhbiB0aGVuIG9taXQgaXQgZW50aXJlbHlcbiAgICAgIC8vIChgcmVjb3JkLmNvbW1hbmQoKWAgaW5zdGVhZCBvZiBgcmVjb3JkLmNvbW1hbmQoe30pYCkuIFJlcXVpcmVkLWZpZWxkIGFyZ3Mga2VlcFxuICAgICAgLy8gdGhlIG1hbmRhdG9yeSBwYXJhbWV0ZXIgKGEgYHt9YCBkZWZhdWx0IHdvdWxkbid0IHNhdGlzZnkgdGhlaXIgdHlwZSkuXG4gICAgICBjb25zdCBkZWZhdWx0c1RvRW1wdHlPYmplY3QgPSBtZXRhZGF0YS5hcmdzLmxlbmd0aCA9PT0gMSAmJiB0aGlzLmFyZ1R5cGVBY2NlcHRzRW1wdHlPYmplY3QobWV0YWRhdGEuYXJnc1swXS50eXBlKVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBwYXJhbURvY3M6IG1ldGFkYXRhLmFyZ3MubWFwKChhcmcpID0+IGAgICAqIEBwYXJhbSB7JHthcmcudHlwZX19ICR7ZGVmYXVsdHNUb0VtcHR5T2JqZWN0ID8gYFske2FyZy5uYW1lfV1gIDogYXJnLm5hbWV9IC0gQ29tbWFuZCBhcmd1bWVudC5cXG5gKS5qb2luKFwiXCIpLFxuICAgICAgICBwYXJhbWV0ZXJzOiBkZWZhdWx0c1RvRW1wdHlPYmplY3QgPyBgJHtwYXJhbWV0ZXJOYW1lc1swXX0gPSB7fWAgOiBwYXJhbWV0ZXJOYW1lcy5qb2luKFwiLCBcIiksXG4gICAgICAgIHBheWxvYWRBcmd1bWVudHM6IGBbJHtwYXJhbWV0ZXJOYW1lcy5qb2luKFwiLCBcIil9XWAsXG4gICAgICAgIHJldHVyblR5cGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcGFyYW1Eb2NzOiBcIiAgICogQHBhcmFtIHsuLi5Gcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWV9IGNvbW1hbmRBcmd1bWVudHMgLSBDdXN0b20gY29tbWFuZCBhcmd1bWVudHMuXFxuXCIsXG4gICAgICBwYXJhbWV0ZXJzOiBcIi4uLmNvbW1hbmRBcmd1bWVudHNcIixcbiAgICAgIHBheWxvYWRBcmd1bWVudHM6IFwiY29tbWFuZEFyZ3VtZW50c1wiLFxuICAgICAgcmV0dXJuVHlwZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgc2luZ2xlIGNvbW1hbmQtYXJncyBKU0RvYyB0eXBlIGlzIGtub3duIHRvIGFjY2VwdCBhbiBlbXB0eSBvYmplY3QgYHt9YDpcbiAgICogYSBzaW5nbGUgYmFsYW5jZWQgb2JqZWN0IGxpdGVyYWwgd2hvc2UgdG9wLWxldmVsIG1lbWJlcnMgYXJlIGFsbCBvcHRpb25hbCAoYG5hbWU/OmApXG4gICAqIG9yIGluZGV4IHNpZ25hdHVyZXMgKGBbazogLi4uXTpgKS4gQW55dGhpbmcgZWxzZSByZXR1cm5zIGZhbHNlIHNvIHRoZSBwYXJhbWV0ZXIgc3RheXNcbiAgICogcmVxdWlyZWQg4oCUIGluY2x1ZGluZyBhIHJlcXVpcmVkIG1lbWJlciwgYSBub24tb2JqZWN0LWxpdGVyYWwgKGEgcG9zaXRpb25hbCBgbnVtYmVyYCxcbiAgICogYSBgUmVjb3JkPC4uLj5gIC8gYFBhcnRpYWw8Li4uPmAgd2hvc2Uga2V5L3dyYXBwZXIgbWF5IHN0aWxsIHJlcXVpcmUgZGF0YSksIGFuZCBhbnlcbiAgICogaW50ZXJzZWN0aW9uL3VuaW9uIChlLmcuIGB7YT86IHh9ICYge2I6IHN0cmluZ31gKSwgd2hlcmUgYHt9YCBpcyBub3QgYXNzaWduYWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBUaGUgYXJnJ3MgSlNEb2MgdHlwZSBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGdlbmVyYXRlZCBwYXJhbWV0ZXIgY2FuIGRlZmF1bHQgdG8gYHt9YC5cbiAgICovXG4gIGFyZ1R5cGVBY2NlcHRzRW1wdHlPYmplY3QodHlwZSkge1xuICAgIGNvbnN0IHRyaW1tZWRUeXBlID0gdHlwZS50cmltKClcblxuICAgIC8vIE11c3QgYmUgYSBzaW5nbGUgYmFsYW5jZWQgb2JqZWN0IGxpdGVyYWw6IHN0YXJ0cyB3aXRoIGB7YCwgZW5kcyB3aXRoIGB9YCwgYW5kIHRoZVxuICAgIC8vIG9wZW5pbmcgYnJhY2UgY2xvc2VzIG9ubHkgYXQgdGhlIGZpbmFsIGNoYXJhY3Rlci4gVGhpcyByZWplY3RzIGludGVyc2VjdGlvbnMvdW5pb25zXG4gICAgLy8gbGlrZSBge2E/OiB4fSAmIHtiOiBzdHJpbmd9YCB0aGF0IG1lcmVseSBoYXBwZW4gdG8gc3RhcnQgYHtgIGFuZCBlbmQgYH1gLlxuICAgIGlmICghKHRyaW1tZWRUeXBlLnN0YXJ0c1dpdGgoXCJ7XCIpICYmIHRyaW1tZWRUeXBlLmVuZHNXaXRoKFwifVwiKSkpIHJldHVybiBmYWxzZVxuICAgIGlmICghdGhpcy5pc1NpbmdsZUJhbGFuY2VkT2JqZWN0TGl0ZXJhbCh0cmltbWVkVHlwZSkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgaW5uZXIgPSB0cmltbWVkVHlwZS5zbGljZSgxLCAtMSlcblxuICAgIGZvciAoY29uc3QgbWVtYmVyIG9mIHRoaXMuc3BsaXRUb3BMZXZlbFR5cGVNZW1iZXJzKGlubmVyKSkge1xuICAgICAgY29uc3QgY29sb25JbmRleCA9IHRoaXMudG9wTGV2ZWxDb2xvbkluZGV4KG1lbWJlcilcblxuICAgICAgLy8gTm8gdG9wLWxldmVsIGNvbG9uOiBhIGNhbGwvY29uc3RydWN0L21hcHBlZCBzaWduYXR1cmUgb3IgbWFsZm9ybWVkIG1lbWJlciDigJRcbiAgICAgIC8vIGNhbid0IGNvbmZpcm0gaXQncyBvcHRpb25hbCwgc28gdHJlYXQgdGhlIHR5cGUgYXMgbm90IGVtcHR5LWRlZmF1bHRhYmxlLlxuICAgICAgaWYgKGNvbG9uSW5kZXggPCAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3Qga2V5ID0gbWVtYmVyLnNsaWNlKDAsIGNvbG9uSW5kZXgpLnRyaW0oKVxuXG4gICAgICAvLyBJbmRleCBzaWduYXR1cmVzIChgW2s6IHN0cmluZ11gKSBkb24ndCByZXF1aXJlIGEgdmFsdWU7IG9wdGlvbmFsIHByb3BzIGVuZCBpbiBgP2AuXG4gICAgICAvLyBBbnl0aGluZyBlbHNlIGlzIGEgcmVxdWlyZWQgcHJvcGVydHksIHNvIGB7fWAgd291bGQgbm90IHNhdGlzZnkgdGhlIHR5cGUuXG4gICAgICBpZiAoIWtleS5zdGFydHNXaXRoKFwiW1wiKSAmJiAha2V5LmVuZHNXaXRoKFwiP1wiKSkgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGxpdHMgdGhlIGlubmVyIGJvZHkgb2YgYW4gb2JqZWN0LWxpdGVyYWwgdHlwZSBpbnRvIGl0cyB0b3AtbGV2ZWwgbWVtYmVycyxcbiAgICogcmVzcGVjdGluZyBuZXN0ZWQgYHt9YCAvIGBbXWAgLyBgPD5gIC8gYCgpYCBzbyBmaWVsZCB0eXBlcyBsaWtlIGBzdHJpbmdbXSB8IG51bGxgXG4gICAqIG9yIGB7YTogYn1gIGFyZW4ndCBzcGxpdCBtaWQtdHlwZS4gTWVtYmVycyBhcmUgc2VwYXJhdGVkIGJ5IGAsYCBvciBgO2AuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpbm5lciAtIE9iamVjdC1saXRlcmFsIGJvZHkgKHdpdGhvdXQgdGhlIG91dGVyIGJyYWNlcykuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUcmltbWVkIG5vbi1lbXB0eSB0b3AtbGV2ZWwgbWVtYmVycy5cbiAgICovXG4gIHNwbGl0VG9wTGV2ZWxUeXBlTWVtYmVycyhpbm5lcikge1xuICAgIGNvbnN0IG1lbWJlcnMgPSBbXVxuICAgIGxldCBkZXB0aCA9IDBcbiAgICBsZXQgc3RhcnQgPSAwXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgaW5uZXIubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICBjb25zdCBjaGFyYWN0ZXIgPSBpbm5lcltpbmRleF1cblxuICAgICAgaWYgKGNoYXJhY3RlciA9PT0gXCJ7XCIgfHwgY2hhcmFjdGVyID09PSBcIltcIiB8fCBjaGFyYWN0ZXIgPT09IFwiPFwiIHx8IGNoYXJhY3RlciA9PT0gXCIoXCIpIHtcbiAgICAgICAgZGVwdGggKz0gMVxuICAgICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT09IFwifVwiIHx8IGNoYXJhY3RlciA9PT0gXCJdXCIgfHwgY2hhcmFjdGVyID09PSBcIj5cIiB8fCBjaGFyYWN0ZXIgPT09IFwiKVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDFcbiAgICAgIH0gZWxzZSBpZiAoKGNoYXJhY3RlciA9PT0gXCIsXCIgfHwgY2hhcmFjdGVyID09PSBcIjtcIikgJiYgZGVwdGggPT09IDApIHtcbiAgICAgICAgbWVtYmVycy5wdXNoKGlubmVyLnNsaWNlKHN0YXJ0LCBpbmRleCkpXG4gICAgICAgIHN0YXJ0ID0gaW5kZXggKyAxXG4gICAgICB9XG4gICAgfVxuXG4gICAgbWVtYmVycy5wdXNoKGlubmVyLnNsaWNlKHN0YXJ0KSlcblxuICAgIHJldHVybiBtZW1iZXJzLm1hcCgobWVtYmVyKSA9PiBtZW1iZXIudHJpbSgpKS5maWx0ZXIoKG1lbWJlcikgPT4gbWVtYmVyLmxlbmd0aCA+IDApXG4gIH1cblxuICAvKipcbiAgICogSW5kZXggb2YgdGhlIGZpcnN0IHRvcC1sZXZlbCBgOmAgaW4gYW4gb2JqZWN0LWxpdGVyYWwgbWVtYmVyLCBpZ25vcmluZyBjb2xvbnNcbiAgICogbmVzdGVkIGluc2lkZSBge31gIC8gYFtdYCAvIGA8PmAgLyBgKClgIChlLmcuIGFuIGluZGV4IHNpZ25hdHVyZSBgW2s6IHN0cmluZ11gKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lbWJlciAtIEEgc2luZ2xlIG9iamVjdC1saXRlcmFsIG1lbWJlci5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgY29sb24gaW5kZXgsIG9yIC0xIHdoZW4gbm9uZSBpcyBmb3VuZCBhdCB0aGUgdG9wIGxldmVsLlxuICAgKi9cbiAgdG9wTGV2ZWxDb2xvbkluZGV4KG1lbWJlcikge1xuICAgIGxldCBkZXB0aCA9IDBcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtZW1iZXIubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICBjb25zdCBjaGFyYWN0ZXIgPSBtZW1iZXJbaW5kZXhdXG5cbiAgICAgIGlmIChjaGFyYWN0ZXIgPT09IFwie1wiIHx8IGNoYXJhY3RlciA9PT0gXCJbXCIgfHwgY2hhcmFjdGVyID09PSBcIjxcIiB8fCBjaGFyYWN0ZXIgPT09IFwiKFwiKSB7XG4gICAgICAgIGRlcHRoICs9IDFcbiAgICAgIH0gZWxzZSBpZiAoY2hhcmFjdGVyID09PSBcIn1cIiB8fCBjaGFyYWN0ZXIgPT09IFwiXVwiIHx8IGNoYXJhY3RlciA9PT0gXCI+XCIgfHwgY2hhcmFjdGVyID09PSBcIilcIikge1xuICAgICAgICBkZXB0aCAtPSAxXG4gICAgICB9IGVsc2UgaWYgKGNoYXJhY3RlciA9PT0gXCI6XCIgJiYgZGVwdGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGluZGV4XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIC0xXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgdHlwZSBpcyBhIHNpbmdsZSBiYWxhbmNlZCBvYmplY3QgbGl0ZXJhbCDigJQgaXRzIGxlYWRpbmcgYHtgIGNsb3NlcyBvbmx5XG4gICAqIGF0IHRoZSBmaW5hbCBjaGFyYWN0ZXIuIFJlamVjdHMgdG9wLWxldmVsIGludGVyc2VjdGlvbnMvdW5pb25zIGxpa2UgYHthPzogeH0gJiB7YjogeX1gXG4gICAqIG9yIGB7YT86IHh9IHwgc3RyaW5nYCB3aG9zZSBicmFjZSBkZXB0aCByZXR1cm5zIHRvIDAgYmVmb3JlIHRoZSBlbmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gQSB0cmltbWVkIHR5cGUgc3RyaW5nIHRoYXQgc3RhcnRzIHdpdGggYHtgIGFuZCBlbmRzIHdpdGggYH1gLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBicmFjZXMgd3JhcCB0aGUgd2hvbGUgdHlwZS5cbiAgICovXG4gIGlzU2luZ2xlQmFsYW5jZWRPYmplY3RMaXRlcmFsKHR5cGUpIHtcbiAgICBsZXQgZGVwdGggPSAwXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgdHlwZS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IGNoYXJhY3RlciA9IHR5cGVbaW5kZXhdXG5cbiAgICAgIGlmIChjaGFyYWN0ZXIgPT09IFwie1wiIHx8IGNoYXJhY3RlciA9PT0gXCJbXCIgfHwgY2hhcmFjdGVyID09PSBcIjxcIiB8fCBjaGFyYWN0ZXIgPT09IFwiKFwiKSB7XG4gICAgICAgIGRlcHRoICs9IDFcbiAgICAgIH0gZWxzZSBpZiAoY2hhcmFjdGVyID09PSBcIn1cIiB8fCBjaGFyYWN0ZXIgPT09IFwiXVwiIHx8IGNoYXJhY3RlciA9PT0gXCI+XCIgfHwgY2hhcmFjdGVyID09PSBcIilcIikge1xuICAgICAgICBkZXB0aCAtPSAxXG5cbiAgICAgICAgLy8gVGhlIG9wZW5pbmcgYnJhY2UgYmFsYW5jZWQgYmVmb3JlIHRoZSBlbmQsIHNvIHNvbWV0aGluZyBmb2xsb3dzIHRoZSBsaXRlcmFsLlxuICAgICAgICBpZiAoZGVwdGggPT09IDAgJiYgaW5kZXggPCB0eXBlLmxlbmd0aCAtIDEpIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBkZXB0aCA9PT0gMFxuICB9XG5cbiAgLyoqXG4gICAqIEVucmljaGVzIGN1c3RvbS1jb21tYW5kIG1ldGFkYXRhIGJ5IGRlcml2aW5nIGEgY29tbWFuZCdzIHR5cGVkIGFyZ3MgYW5kIHJldHVyblxuICAgKiB0eXBlIGZyb20gdGhlIGJhY2tlbmQgcmVzb3VyY2UgbWV0aG9kJ3MgYEBwYXJhbWAvYEByZXR1cm5zYCBKU0RvYyB3aGVuIHRoZXkgYXJlXG4gICAqIG5vdCBhbHJlYWR5IGRlY2xhcmVkIGluIGByZXNvdXJjZUNvbmZpZ2AuIFByZWNlZGVuY2U6IGV4cGxpY2l0IGByZXNvdXJjZUNvbmZpZ2BcbiAgICogYHthcmdzLCByZXR1cm5UeXBlfWAgd2lucywgdGhlbiB0aGUgZGVyaXZlZCBiYWNrZW5kLW1ldGhvZCBKU0RvYywgdGhlbiB0aGUgZ2VuZXJpY1xuICAgKiBkZWZhdWx0LiBNb2RlbC1jbGFzcyBpZGVudGlmaWVycyBpbiB0aGUgZGVyaXZlZCB0eXBlcyBhcmUgZG93bmdyYWRlZCB0byBgYW55YFxuICAgKiBiZWNhdXNlIHRoZSBmcm9udGVuZCByZWNlaXZlcyBhIHNlcmlhbGl6ZWQgcmVjb3JkLCBub3QgYSBtb2RlbCBpbnN0YW5jZSwgd2hpY2ggdGhlXG4gICAqIGNvbnN1bWVyIGh5ZHJhdGVzIHdpdGggYE1vZGVsLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKC4uLilgLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9Pn0gYXJncy5jb21tYW5kTWV0YWRhdGEgLSBEZWNsYXJlZCBwZXItY29tbWFuZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5jb21tYW5kTmFtZXMgLSBDb21tYW5kIG1ldGhvZCBuYW1lcyB0byByZXNvbHZlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mcm9udGVuZE1vZGVsRmlsZVBhdGggLSBHZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5yZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+Pn0gLSBFbnJpY2hlZCBtZXRhZGF0YS5cbiAgICovXG4gIGFzeW5jIGNvbW1hbmRNZXRhZGF0YVdpdGhSZXNvdXJjZUpzRG9jKHtjb21tYW5kTWV0YWRhdGEsIGNvbW1hbmROYW1lcywgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGlmICghcmVzb3VyY2VDbGFzcykgcmV0dXJuIGNvbW1hbmRNZXRhZGF0YVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9Pn0gKi9cbiAgICBjb25zdCBlbnJpY2hlZCA9IHsuLi5jb21tYW5kTWV0YWRhdGF9XG5cbiAgICBmb3IgKGNvbnN0IGNvbW1hbmROYW1lIG9mIGNvbW1hbmROYW1lcykge1xuICAgICAgY29uc3QgZGVjbGFyZWQgPSBjb21tYW5kTWV0YWRhdGFbY29tbWFuZE5hbWVdIHx8IHthcmdzOiBbXSwgcmV0dXJuVHlwZTogbnVsbH1cbiAgICAgIGNvbnN0IHNvdXJjZUNsYXNzTmFtZSA9IHRoaXMubWV0aG9kT3duZXJDbGFzc05hbWUoe21ldGhvZE5hbWU6IGNvbW1hbmROYW1lLCB0YXJnZXRDbGFzczogcmVzb3VyY2VDbGFzc30pXG5cbiAgICAgIGlmICghc291cmNlQ2xhc3NOYW1lKSB7XG4gICAgICAgIGVucmljaGVkW2NvbW1hbmROYW1lXSA9IGRlY2xhcmVkXG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbGV0IHJldHVyblR5cGUgPSBkZWNsYXJlZC5yZXR1cm5UeXBlXG5cbiAgICAgIGlmICghcmV0dXJuVHlwZSkge1xuICAgICAgICBjb25zdCBqc0RvY1JldHVyblR5cGUgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUmV0dXJuVHlwZURlZmluaXRpb24oe21ldGhvZE5hbWU6IGNvbW1hbmROYW1lLCBzb3VyY2VDbGFzc05hbWV9KVxuXG4gICAgICAgIGlmIChqc0RvY1JldHVyblR5cGUpIHtcbiAgICAgICAgICByZXR1cm5UeXBlID0gdGhpcy5mcm9udGVuZFJlc29sdmFibGVDb21tYW5kSnNEb2NUeXBlKHtcbiAgICAgICAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgICAgICAgIGltcG9ydEFsaWFzZXM6IGpzRG9jUmV0dXJuVHlwZS5pbXBvcnRBbGlhc2VzLFxuICAgICAgICAgICAganNEb2NUeXBlOiB0aGlzLnVud3JhcHBlZFByb21pc2VKc0RvY1R5cGUoe2pzRG9jVHlwZToganNEb2NSZXR1cm5UeXBlLnR5cGV9KSxcbiAgICAgICAgICAgIHNvdXJjZUZpbGU6IGpzRG9jUmV0dXJuVHlwZS5zb3VyY2VGaWxlXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBsZXQgYXJncyA9IGRlY2xhcmVkLmFyZ3NcblxuICAgICAgaWYgKCFhcmdzIHx8IGFyZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGNvbnN0IGpzRG9jUGFyYW1ldGVycyA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJzKHttZXRob2ROYW1lOiBjb21tYW5kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSlcbiAgICAgICAgLy8gU2tpcCBvYmplY3QtcHJvcGVydHkgdGFncyAoYEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1lc3NhZ2VgKTsgb25seSB0aGVcbiAgICAgICAgLy8gdG9wLWxldmVsIHBhcmFtZXRlcnMgbWFwIHRvIG1ldGhvZCBhcmd1bWVudHMsIG90aGVyd2lzZSB0aGUgc2hhcmVkXG4gICAgICAgIC8vIGBAcGFyYW0ge29iamVjdH0gYXJnc2AgKyBwcm9wZXJ0eSBzdHlsZSB3b3VsZCBlbWl0IGBuYW1lKGFyZ3MsIGFyZ3MpYC5cbiAgICAgICAgY29uc3QgdG9wTGV2ZWxQYXJhbWV0ZXJzID0gKGpzRG9jUGFyYW1ldGVycyB8fCBbXSkuZmlsdGVyKChwYXJhbWV0ZXIpID0+IHR5cGVvZiBwYXJhbWV0ZXIubmFtZSA9PT0gXCJzdHJpbmdcIiAmJiAhcGFyYW1ldGVyLm5hbWUuaW5jbHVkZXMoXCIuXCIpKVxuXG4gICAgICAgIGlmICh0b3BMZXZlbFBhcmFtZXRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGFyZ3MgPSB0b3BMZXZlbFBhcmFtZXRlcnMubWFwKChwYXJhbWV0ZXIpID0+ICh7XG4gICAgICAgICAgICBuYW1lOiAvKiogQHR5cGUge3N0cmluZ30gKi8gKHBhcmFtZXRlci5uYW1lKSxcbiAgICAgICAgICAgIHR5cGU6IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlQ29tbWFuZEpzRG9jVHlwZSh7XG4gICAgICAgICAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgICAgICAgICAgaW1wb3J0QWxpYXNlczogcGFyYW1ldGVyLmltcG9ydEFsaWFzZXMsXG4gICAgICAgICAgICAgIGpzRG9jVHlwZTogcGFyYW1ldGVyLnR5cGUsXG4gICAgICAgICAgICAgIHNvdXJjZUZpbGU6IHBhcmFtZXRlci5zb3VyY2VGaWxlXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0pKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGVucmljaGVkW2NvbW1hbmROYW1lXSA9IHthcmdzOiBhcmdzIHx8IFtdLCByZXR1cm5UeXBlOiByZXR1cm5UeXBlIHx8IG51bGx9XG4gICAgfVxuXG4gICAgcmV0dXJuIGVucmljaGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bndyYXBwZWQgcHJvbWlzZSBqcyBkb2MgdHlwZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpzRG9jVHlwZSAtIEpTRG9jIHR5cGUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSByZXNvbHZlZCB2YWx1ZSB0eXBlIGZvciBzZXJpYWxpemVkIGZyb250ZW5kIGF0dHJpYnV0ZXMuXG4gICAqL1xuICB1bndyYXBwZWRQcm9taXNlSnNEb2NUeXBlKHtqc0RvY1R5cGV9KSB7XG4gICAgY29uc3QgcHJvbWlzZVByZWZpeCA9IFwiUHJvbWlzZTxcIlxuXG4gICAgaWYgKCFqc0RvY1R5cGUuc3RhcnRzV2l0aChwcm9taXNlUHJlZml4KSkgcmV0dXJuIGpzRG9jVHlwZVxuXG4gICAgaWYgKCFqc0RvY1R5cGUuZW5kc1dpdGgoXCI+XCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIFByb21pc2UgSlNEb2MgdHlwZSB0byBlbmQgd2l0aCAnPic6ICR7anNEb2NUeXBlfWApXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRUeXBlID0ganNEb2NUeXBlLnNsaWNlKHByb21pc2VQcmVmaXgubGVuZ3RoLCAtMSkudHJpbSgpXG5cbiAgICBpZiAocmVzb2x2ZWRUeXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgUHJvbWlzZSBKU0RvYyB0eXBlIHRvIGNvbnRhaW4gYSByZXNvbHZlZCB0eXBlOiAke2pzRG9jVHlwZX1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXNvbHZlZFR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1ldGhvZCBvd25lciBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBhcmdzLnRhcmdldENsYXNzIC0gVGFyZ2V0IGNsYXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBDbGFzcyBuYW1lIHRoYXQgZGVjbGFyZXMgdGhlIG1ldGhvZC5cbiAgICovXG4gIG1ldGhvZE93bmVyQ2xhc3NOYW1lKHttZXRob2ROYW1lLCB0YXJnZXRDbGFzc30pIHtcbiAgICBsZXQgcHJvdG90eXBlID0gdGFyZ2V0Q2xhc3MucHJvdG90eXBlXG5cbiAgICB3aGlsZSAocHJvdG90eXBlICYmIHByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChwcm90b3R5cGUsIG1ldGhvZE5hbWUpKSB7XG4gICAgICAgIGNvbnN0IGRlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvdHlwZSwgbWV0aG9kTmFtZSlcblxuICAgICAgICBpZiAodHlwZW9mIGRlc2NyaXB0b3I/LnZhbHVlICE9IFwiZnVuY3Rpb25cIikgcmV0dXJuIG51bGxcblxuICAgICAgICBjb25zdCBjb25zdHJ1Y3Rvck5hbWUgPSBwcm90b3R5cGUuY29uc3RydWN0b3I/Lm5hbWVcblxuICAgICAgICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yTmFtZSA9PSBcInN0cmluZ1wiICYmIGNvbnN0cnVjdG9yTmFtZS5sZW5ndGggPiAwKSByZXR1cm4gY29uc3RydWN0b3JOYW1lXG5cbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHByb3RvdHlwZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgbWV0aG9kIHJldHVybiB0eXBlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zb3VyY2VDbGFzc05hbWUgLSBTb3VyY2UgY2xhc3MgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gSlNEb2MgcmV0dXJuIHR5cGUgd2hlbiBkb2N1bWVudGVkLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlKHttZXRob2ROYW1lLCBzb3VyY2VDbGFzc05hbWV9KSB7XG4gICAgY29uc3QgcmV0dXJuVHlwZSA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlRGVmaW5pdGlvbih7bWV0aG9kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSlcblxuICAgIHJldHVybiByZXR1cm5UeXBlID8gcmV0dXJuVHlwZS50eXBlIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgbWV0aG9kIHJldHVybiB0eXBlIGRlZmluaXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNvdXJjZUNsYXNzTmFtZSAtIFNvdXJjZSBjbGFzcyBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNvdXJjZU1ldGhvZFJldHVyblR5cGUgfCBudWxsPn0gLSBKU0RvYyByZXR1cm4gdHlwZSBkZWZpbml0aW9uIHdoZW4gZG9jdW1lbnRlZC5cbiAgICovXG4gIGFzeW5jIHJlc291cmNlTWV0aG9kUmV0dXJuVHlwZURlZmluaXRpb24oe21ldGhvZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pIHtcbiAgICBjb25zdCByZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzKClcbiAgICBjb25zdCByZXR1cm5UeXBlS2V5ID0gYCR7c291cmNlQ2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YFxuXG4gICAgaWYgKCFyZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzLmhhcyhyZXR1cm5UeXBlS2V5KSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJldHVyblR5cGUgPSByZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzLmdldChyZXR1cm5UeXBlS2V5KVxuXG4gICAgaWYgKCFyZXR1cm5UeXBlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIEpTRG9jIHJldHVybiB0eXBlIGZvciAke3JldHVyblR5cGVLZXl9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHJldHVyblR5cGUudHlwZSAhPSBcInN0cmluZ1wiIHx8IHJldHVyblR5cGUudHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG5vbi1lbXB0eSBKU0RvYyByZXR1cm4gdHlwZSBmb3IgJHtyZXR1cm5UeXBlS2V5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJldHVyblR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIG1ldGhvZCBwYXJhbWV0ZXIgdHlwZS5cbiAgICogQHBhcmFtIHt7bWV0aG9kTmFtZTogc3RyaW5nLCBwYXJhbWV0ZXJJbmRleDogbnVtYmVyLCBzb3VyY2VDbGFzc05hbWU6IHN0cmluZ319IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIEpTRG9jIHBhcmFtZXRlciB0eXBlIHdoZW4gZG9jdW1lbnRlZC5cbiAgICovXG4gIGFzeW5jIHJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZSh7bWV0aG9kTmFtZSwgcGFyYW1ldGVySW5kZXgsIHNvdXJjZUNsYXNzTmFtZX0pIHtcbiAgICBjb25zdCBwYXJhbWV0ZXJzID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFBhcmFtZXRlcnMoe21ldGhvZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pXG5cbiAgICBpZiAoIXBhcmFtZXRlcnMpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwYXJhbWV0ZXIgPSBwYXJhbWV0ZXJzW3BhcmFtZXRlckluZGV4XVxuXG4gICAgaWYgKHBhcmFtZXRlciA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKHBhcmFtZXRlci50eXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbm9uLWVtcHR5IEpTRG9jIHBhcmFtZXRlciB0eXBlIGZvciAke3NvdXJjZUNsYXNzTmFtZX0uJHttZXRob2ROYW1lfSBwYXJhbWV0ZXIgJHtwYXJhbWV0ZXJJbmRleH1gKVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbWV0ZXIudHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgbWV0aG9kIHBhcmFtZXRlcnMuXG4gICAqIEBwYXJhbSB7e21ldGhvZE5hbWU6IHN0cmluZywgc291cmNlQ2xhc3NOYW1lOiBzdHJpbmd9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVbXSB8IG51bGw+fSAtIEpTRG9jIHBhcmFtZXRlcnMgKG5hbWUgKyB0eXBlKSB3aGVuIGRvY3VtZW50ZWQuXG4gICAqL1xuICBhc3luYyByZXNvdXJjZU1ldGhvZFBhcmFtZXRlcnMoe21ldGhvZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pIHtcbiAgICBjb25zdCByZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzKClcbiAgICBjb25zdCBwYXJhbWV0ZXJUeXBlc0tleSA9IGAke3NvdXJjZUNsYXNzTmFtZX0uJHttZXRob2ROYW1lfWBcblxuICAgIGlmICghcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcy5oYXMocGFyYW1ldGVyVHlwZXNLZXkpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcGFyYW1ldGVycyA9IHJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMuZ2V0KHBhcmFtZXRlclR5cGVzS2V5KVxuXG4gICAgaWYgKCFwYXJhbWV0ZXJzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIEpTRG9jIHBhcmFtZXRlcnMgZm9yICR7cGFyYW1ldGVyVHlwZXNLZXl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyYW1ldGVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgbWV0aG9kIHJldHVybiB0eXBlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgUmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlPj59IC0gUmVzb3VyY2UgbWV0aG9kIHJldHVybiB0eXBlcyBrZXllZCBieSBDbGFzc05hbWUubWV0aG9kTmFtZS5cbiAgICovXG4gIGFzeW5jIHJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMoKSB7XG4gICAgaWYgKHRoaXMuX3Jlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMpIHJldHVybiB0aGlzLl9yZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzXG5cbiAgICBjb25zdCBzb3VyY2VGaWxlcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRmlsZXMoKVxuICAgIGNvbnN0IHJldHVyblR5cGVzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2Ygc291cmNlRmlsZXMpIHtcbiAgICAgIGNvbnN0IHNvdXJjZVRleHQgPSBhd2FpdCBmcy5yZWFkRmlsZShzb3VyY2VGaWxlLCBcInV0ZjhcIilcblxuICAgICAgdGhpcy5hZGRSZXNvdXJjZU1ldGhvZFJldHVyblR5cGVzRnJvbVNvdXJjZSh7cmV0dXJuVHlwZXMsIHNvdXJjZUZpbGUsIHNvdXJjZVRleHR9KVxuICAgIH1cblxuICAgIHRoaXMuX3Jlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMgPSByZXR1cm5UeXBlc1xuXG4gICAgcmV0dXJuIHJldHVyblR5cGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcGFyYW1ldGVyIHR5cGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBSZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVbXT4+fSAtIFJlc291cmNlIG1ldGhvZCBwYXJhbWV0ZXJzIGtleWVkIGJ5IENsYXNzTmFtZS5tZXRob2ROYW1lLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcygpIHtcbiAgICBpZiAodGhpcy5fcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcykgcmV0dXJuIHRoaXMuX3Jlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXNcblxuICAgIGNvbnN0IHNvdXJjZUZpbGVzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VGaWxlcygpXG4gICAgY29uc3QgcGFyYW1ldGVyVHlwZXMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBzb3VyY2VGaWxlcykge1xuICAgICAgY29uc3Qgc291cmNlVGV4dCA9IGF3YWl0IGZzLnJlYWRGaWxlKHNvdXJjZUZpbGUsIFwidXRmOFwiKVxuXG4gICAgICB0aGlzLmFkZFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXNGcm9tU291cmNlKHtwYXJhbWV0ZXJUeXBlcywgc291cmNlRmlsZSwgc291cmNlVGV4dH0pXG4gICAgfVxuXG4gICAgdGhpcy5fcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcyA9IHBhcmFtZXRlclR5cGVzXG5cbiAgICByZXR1cm4gcGFyYW1ldGVyVHlwZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIEpTRG9jIHNvdXJjZSBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIEphdmFTY3JpcHQgc291cmNlIGZpbGVzIHRoYXQgY2FuIGRlZmluZSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMgYW5kIG1vZGVsIGFjY2Vzc29ycy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxKc0RvY1NvdXJjZUZpbGVzKCkge1xuICAgIGNvbnN0IHNvdXJjZUZpbGVzID0gW11cblxuICAgIGZvciAoY29uc3Qgc291cmNlRGlyZWN0b3J5IG9mIHRoaXMuZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRGlyZWN0b3JpZXMoKSkge1xuICAgICAgc291cmNlRmlsZXMucHVzaCguLi5hd2FpdCB0aGlzLmphdmFzY3JpcHRGaWxlc0luRGlyZWN0b3J5KHNvdXJjZURpcmVjdG9yeSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHNvdXJjZUZpbGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBKU0RvYyBzb3VyY2UgZGlyZWN0b3JpZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTb3VyY2UgZGlyZWN0b3JpZXMgdG8gc2NhbiBmb3IgZ2VuZXJhdGVkIGZyb250ZW5kLW1vZGVsIEpTRG9jLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRGlyZWN0b3JpZXMoKSB7XG4gICAgY29uc3Qgc291cmNlRGlyZWN0b3JpZXMgPSBuZXcgU2V0KFtwYXRoLmpvaW4odGhpcy5kaXJlY3RvcnkoKSwgXCJzcmNcIildKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgICAgaWYgKHR5cGVvZiBiYWNrZW5kUHJvamVjdC5wYXRoID09IFwic3RyaW5nXCIgJiYgYmFja2VuZFByb2plY3QucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICAgIHNvdXJjZURpcmVjdG9yaWVzLmFkZChwYXRoLmpvaW4oYmFja2VuZFByb2plY3QucGF0aCwgXCJzcmNcIikpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIEFycmF5LmZyb20oc291cmNlRGlyZWN0b3JpZXMpXG4gIH1cblxuICAvKipcbiAgICogQWRkcyByZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGVzIGZyb20gc291cmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtNYXA8c3RyaW5nLCBSZXNvdXJjZU1ldGhvZFJldHVyblR5cGU+fSBhcmdzLnJldHVyblR5cGVzIC0gTXV0YWJsZSByZXR1cm4gdHlwZXMgbWFwLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IFthcmdzLnNvdXJjZUZpbGVdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc291cmNlVGV4dCAtIFNvdXJjZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXNGcm9tU291cmNlKHtyZXR1cm5UeXBlcywgc291cmNlRmlsZSA9IG51bGwsIHNvdXJjZVRleHR9KSB7XG4gICAgY29uc3QgY2xhc3NSZWdleCA9IC9jbGFzc1xccysoW0EtWmEtel8kXVtcXHckXSopXFxzKyg/OmV4dGVuZHNcXHMrW157XSspP1xcey9nXG4gICAgY29uc3QgaW1wb3J0QWxpYXNlcyA9IHRoaXMuanNEb2NJbXBvcnRBbGlhc2VzRnJvbVNvdXJjZShzb3VyY2VUZXh0KVxuICAgIGxldCBjbGFzc01hdGNoXG5cbiAgICB3aGlsZSAoKGNsYXNzTWF0Y2ggPSBjbGFzc1JlZ2V4LmV4ZWMoc291cmNlVGV4dCkpKSB7XG4gICAgICBjb25zdCBjbGFzc05hbWUgPSBjbGFzc01hdGNoWzFdXG4gICAgICBjb25zdCBjbGFzc0JvZHlTdGFydCA9IGNsYXNzUmVnZXgubGFzdEluZGV4XG4gICAgICBjb25zdCBjbGFzc0JvZHlFbmQgPSB0aGlzLm1hdGNoaW5nQnJhY2VJbmRleCh7b3BlbkluZGV4OiBjbGFzc0JvZHlTdGFydCAtIDEsIHNvdXJjZVRleHR9KVxuXG4gICAgICBpZiAoY2xhc3NCb2R5RW5kID09IG51bGwpIHtcbiAgICAgICAgLy8gVGhlIGJyYWNlIG1hdGNoZXIgY2FuJ3QgdG9rZW5pemUgZXZlcnkgY29uc3RydWN0IChlLmcuIGEgcmVnZXggbGl0ZXJhbFxuICAgICAgICAvLyB3aG9zZSBxdW90ZXMgbG9vayBsaWtlIHN0cmluZyBkZWxpbWl0ZXJzKSwgc28gaXQgY2FuIGZhaWwgdG8gbG9jYXRlIGFcbiAgICAgICAgLy8gY2xhc3MgYm9keS4gU2tpcCBtZXRhZGF0YSBleHRyYWN0aW9uIGZvciB0aGF0IGNsYXNzIHJhdGhlciB0aGFuXG4gICAgICAgIC8vIGFib3J0aW5nIHRoZSB3aG9sZSBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uOyByZXNvdXJjZXMgdGhhdCBwYXJzZVxuICAgICAgICAvLyBjbGVhbmx5IHN0aWxsIGdldCB0aGVpciBKU0RvYy1kZXJpdmVkIHJldHVybi9wYXJhbSB0eXBlcy5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgY2xhc3NCb2R5ID0gc291cmNlVGV4dC5zbGljZShjbGFzc0JvZHlTdGFydCwgY2xhc3NCb2R5RW5kKVxuICAgICAgY29uc3QganNEb2NSZWdleCA9IC9cXC9cXCpcXCooW1xcc1xcU10qPylcXCpcXC8vZ1xuICAgICAgbGV0IGpzRG9jTWF0Y2hcblxuICAgICAgd2hpbGUgKChqc0RvY01hdGNoID0ganNEb2NSZWdleC5leGVjKGNsYXNzQm9keSkpKSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZUFmdGVySnNEb2MgPSBjbGFzc0JvZHkuc2xpY2UoanNEb2NSZWdleC5sYXN0SW5kZXgpXG4gICAgICAgIGNvbnN0IG1ldGhvZE1hdGNoID0gc291cmNlQWZ0ZXJKc0RvYy5tYXRjaCgvXlxccyooPzphc3luY1xccyspPyhbQS1aYS16XyRdW1xcdyRdKilcXHMqXFwoLylcblxuICAgICAgICBpZiAoIW1ldGhvZE1hdGNoKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBtZXRob2RNYXRjaFsxXVxuXG4gICAgICAgIGNvbnN0IHJldHVyblR5cGUgPSB0aGlzLmpzRG9jUmV0dXJuVHlwZShqc0RvY01hdGNoWzFdKVxuXG4gICAgICAgIGlmIChyZXR1cm5UeXBlKSB7XG4gICAgICAgICAgcmV0dXJuVHlwZXMuc2V0KGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWAsIHtpbXBvcnRBbGlhc2VzLCBzb3VyY2VGaWxlLCB0eXBlOiByZXR1cm5UeXBlfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjbGFzc1JlZ2V4Lmxhc3RJbmRleCA9IGNsYXNzQm9keUVuZCArIDFcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyByZXNvdXJjZSBtZXRob2QgcGFyYW1ldGVyIHR5cGVzIGZyb20gc291cmNlLlxuICAgKiBAcGFyYW0ge3twYXJhbWV0ZXJUeXBlczogTWFwPHN0cmluZywgUmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlW10+LCBzb3VyY2VGaWxlPzogc3RyaW5nIHwgbnVsbCwgc291cmNlVGV4dDogc3RyaW5nfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRSZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzRnJvbVNvdXJjZSh7cGFyYW1ldGVyVHlwZXMsIHNvdXJjZUZpbGUgPSBudWxsLCBzb3VyY2VUZXh0fSkge1xuICAgIGNvbnN0IGNsYXNzUmVnZXggPSAvY2xhc3NcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxccysoPzpleHRlbmRzXFxzK1tee10rKT9cXHsvZ1xuICAgIGNvbnN0IGltcG9ydEFsaWFzZXMgPSB0aGlzLmpzRG9jSW1wb3J0QWxpYXNlc0Zyb21Tb3VyY2Uoc291cmNlVGV4dClcbiAgICBsZXQgY2xhc3NNYXRjaFxuXG4gICAgd2hpbGUgKChjbGFzc01hdGNoID0gY2xhc3NSZWdleC5leGVjKHNvdXJjZVRleHQpKSkge1xuICAgICAgY29uc3QgY2xhc3NOYW1lID0gY2xhc3NNYXRjaFsxXVxuICAgICAgY29uc3QgY2xhc3NCb2R5U3RhcnQgPSBjbGFzc1JlZ2V4Lmxhc3RJbmRleFxuICAgICAgY29uc3QgY2xhc3NCb2R5RW5kID0gdGhpcy5tYXRjaGluZ0JyYWNlSW5kZXgoe29wZW5JbmRleDogY2xhc3NCb2R5U3RhcnQgLSAxLCBzb3VyY2VUZXh0fSlcblxuICAgICAgaWYgKGNsYXNzQm9keUVuZCA9PSBudWxsKSB7XG4gICAgICAgIC8vIFRoZSBicmFjZSBtYXRjaGVyIGNhbid0IHRva2VuaXplIGV2ZXJ5IGNvbnN0cnVjdCAoZS5nLiBhIHJlZ2V4IGxpdGVyYWxcbiAgICAgICAgLy8gd2hvc2UgcXVvdGVzIGxvb2sgbGlrZSBzdHJpbmcgZGVsaW1pdGVycyksIHNvIGl0IGNhbiBmYWlsIHRvIGxvY2F0ZSBhXG4gICAgICAgIC8vIGNsYXNzIGJvZHkuIFNraXAgbWV0YWRhdGEgZXh0cmFjdGlvbiBmb3IgdGhhdCBjbGFzcyByYXRoZXIgdGhhblxuICAgICAgICAvLyBhYm9ydGluZyB0aGUgd2hvbGUgZnJvbnRlbmQtbW9kZWwgZ2VuZXJhdGlvbjsgcmVzb3VyY2VzIHRoYXQgcGFyc2VcbiAgICAgICAgLy8gY2xlYW5seSBzdGlsbCBnZXQgdGhlaXIgSlNEb2MtZGVyaXZlZCByZXR1cm4vcGFyYW0gdHlwZXMuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNsYXNzQm9keSA9IHNvdXJjZVRleHQuc2xpY2UoY2xhc3NCb2R5U3RhcnQsIGNsYXNzQm9keUVuZClcbiAgICAgIGNvbnN0IGpzRG9jUmVnZXggPSAvXFwvXFwqXFwqKFtcXHNcXFNdKj8pXFwqXFwvL2dcbiAgICAgIGxldCBqc0RvY01hdGNoXG5cbiAgICAgIHdoaWxlICgoanNEb2NNYXRjaCA9IGpzRG9jUmVnZXguZXhlYyhjbGFzc0JvZHkpKSkge1xuICAgICAgICBjb25zdCBzb3VyY2VBZnRlckpzRG9jID0gY2xhc3NCb2R5LnNsaWNlKGpzRG9jUmVnZXgubGFzdEluZGV4KVxuICAgICAgICBjb25zdCBtZXRob2RNYXRjaCA9IHNvdXJjZUFmdGVySnNEb2MubWF0Y2goL15cXHMqKD86YXN5bmNcXHMrKT8oW0EtWmEtel8kXVtcXHckXSopXFxzKlxcKC8pXG5cbiAgICAgICAgaWYgKCFtZXRob2RNYXRjaCkgY29udGludWVcblxuICAgICAgICBjb25zdCBtZXRob2ROYW1lID0gbWV0aG9kTWF0Y2hbMV1cbiAgICAgICAgY29uc3QganNEb2NQYXJhbWV0ZXJzID0gdGhpcy5qc0RvY1BhcmFtZXRlcnMoanNEb2NNYXRjaFsxXSlcblxuICAgICAgICBpZiAoanNEb2NQYXJhbWV0ZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBwYXJhbWV0ZXJUeXBlcy5zZXQoYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YCwganNEb2NQYXJhbWV0ZXJzLm1hcCgocGFyYW1ldGVyKSA9PiAoey4uLnBhcmFtZXRlciwgaW1wb3J0QWxpYXNlcywgc291cmNlRmlsZX0pKSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjbGFzc1JlZ2V4Lmxhc3RJbmRleCA9IGNsYXNzQm9keUVuZCArIDFcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBKU0RvYyBpbXBvcnQgYWxpYXNlcyBmcm9tIHNvdXJjZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNvdXJjZVRleHQgLSBTb3VyY2UgdGV4dC5cbiAgICogQHJldHVybnMge01hcDxzdHJpbmcsIFJlc291cmNlSnNEb2NJbXBvcnRBbGlhcz59IC0gSW1wb3J0IGFsaWFzZXMga2V5ZWQgYnkgbG9jYWwgbmFtZS5cbiAgICovXG4gIGpzRG9jSW1wb3J0QWxpYXNlc0Zyb21Tb3VyY2Uoc291cmNlVGV4dCkge1xuICAgIGNvbnN0IGltcG9ydEFsaWFzZXMgPSBuZXcgTWFwKClcbiAgICBjb25zdCBpbXBvcnRSZWdleCA9IC9AaW1wb3J0XFxzKlxce1xccyooW159XSs/KVxccypcXH1cXHMqZnJvbVxccypbXCInXShbXlwiJ10rKVtcIiddL2dcbiAgICBsZXQgaW1wb3J0TWF0Y2hcblxuICAgIHdoaWxlICgoaW1wb3J0TWF0Y2ggPSBpbXBvcnRSZWdleC5leGVjKHNvdXJjZVRleHQpKSkge1xuICAgICAgY29uc3QgaW1wb3J0TGlzdCA9IGltcG9ydE1hdGNoWzFdXG4gICAgICBjb25zdCBzcGVjaWZpZXIgPSBpbXBvcnRNYXRjaFsyXVxuXG4gICAgICBmb3IgKGNvbnN0IHJhd0ltcG9ydEVudHJ5IG9mIGltcG9ydExpc3Quc3BsaXQoXCIsXCIpKSB7XG4gICAgICAgIGNvbnN0IGltcG9ydEVudHJ5ID0gcmF3SW1wb3J0RW50cnkudHJpbSgpXG5cbiAgICAgICAgaWYgKGltcG9ydEVudHJ5Lmxlbmd0aCA8IDEpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgZW50cnlNYXRjaCA9IGltcG9ydEVudHJ5Lm1hdGNoKC9eKGRlZmF1bHR8W0EtWmEtel8kXVtcXHckXSopKD86XFxzK2FzXFxzKyhbQS1aYS16XyRdW1xcdyRdKikpPyQvKVxuXG4gICAgICAgIGlmICghZW50cnlNYXRjaCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IHBhcnNlIEpTRG9jIEBpbXBvcnQgZW50cnk6ICR7aW1wb3J0RW50cnl9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGltcG9ydGVkTmFtZSA9IGVudHJ5TWF0Y2hbMV1cbiAgICAgICAgY29uc3QgYWxpYXNOYW1lID0gZW50cnlNYXRjaFsyXSB8fCBpbXBvcnRlZE5hbWVcblxuICAgICAgICBpbXBvcnRBbGlhc2VzLnNldChhbGlhc05hbWUsIHtpbXBvcnRlZE5hbWUsIHNwZWNpZmllcn0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGltcG9ydEFsaWFzZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpzIGRvYyByZXR1cm4gdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVGV4dCAtIEpTRG9jIHRleHQgaW5zaWRlIGNvbW1lbnQgbWFya2Vycy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gSlNEb2MgcmV0dXJuIHR5cGUgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAganNEb2NSZXR1cm5UeXBlKGpzRG9jVGV4dCkge1xuICAgIGNvbnN0IHJldHVybnNNYXRjaCA9IGpzRG9jVGV4dC5tYXRjaCgvQHJldHVybnM/XFxzKlxcey8pXG5cbiAgICBpZiAoIXJldHVybnNNYXRjaCB8fCByZXR1cm5zTWF0Y2guaW5kZXggPT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHR5cGVPcGVuSW5kZXggPSByZXR1cm5zTWF0Y2guaW5kZXggKyByZXR1cm5zTWF0Y2hbMF0ubGVuZ3RoIC0gMVxuICAgIGNvbnN0IHR5cGVDbG9zZUluZGV4ID0gdGhpcy5tYXRjaGluZ0JyYWNlSW5kZXgoe29wZW5JbmRleDogdHlwZU9wZW5JbmRleCwgc291cmNlVGV4dDoganNEb2NUZXh0fSlcblxuICAgIGlmICh0eXBlQ2xvc2VJbmRleCA9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBwYXJzZSBKU0RvYyByZXR1cm4gdHlwZSBmcm9tOiAke2pzRG9jVGV4dH1gKVxuICAgIH1cblxuICAgIGNvbnN0IHJldHVyblR5cGUgPSB0aGlzLm5vcm1hbGl6ZUpzRG9jVHlwZShqc0RvY1RleHQuc2xpY2UodHlwZU9wZW5JbmRleCArIDEsIHR5cGVDbG9zZUluZGV4KSlcblxuICAgIGlmIChyZXR1cm5UeXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbm9uLWVtcHR5IEpTRG9jIHJldHVybiB0eXBlIGluOiAke2pzRG9jVGV4dH1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXR1cm5UeXBlXG4gIH1cblxuICAvKipcbiAgICogQ29sbGFwc2VzIGEgSlNEb2MgdHlwZSBzcGFubmluZyBtdWx0aXBsZSBjb21tZW50IGxpbmVzIGludG8gYSBzaW5nbGUgbGluZSBzbyBpdCBjYW5cbiAgICogYmUgZW1pdHRlZCBpbnRvIGFuIGlubGluZSB0eXBlLWFzc2VydGlvbiBjYXN0LiBBIG11bHRpbGluZSBiYWNrZW5kIHJldHVybiB0eXBlIGtlZXBzXG4gICAqIGl0cyBsZWFkaW5nIGNvbnRpbnVhdGlvbiBhc3Rlcmlza3MgaW4gdGhlIGNhcHR1cmVkIHN1YnN0cmluZywgd2hpY2ggYXJlIGludmFsaWQgaW5zaWRlXG4gICAqIGFuIGlubGluZSBjYXN0IGFuZCBtYWtlIFR5cGVTY3JpcHQgcmVhZCB0aGUgYXNzZXJ0ZWQgdHlwZSBhcyBgdW5kZWZpbmVkYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVHlwZSAtIFJhdyBjYXB0dXJlZCBKU0RvYyB0eXBlLCBwb3NzaWJseSBtdWx0aWxpbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2luZ2xlLWxpbmUgSlNEb2MgdHlwZS5cbiAgICovXG4gIG5vcm1hbGl6ZUpzRG9jVHlwZShqc0RvY1R5cGUpIHtcbiAgICByZXR1cm4ganNEb2NUeXBlLnJlcGxhY2UoL1xccypcXG5cXHMqXFwqP1sgXFx0XSovZywgXCIgXCIpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHBhcmFtZXRlcnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqc0RvY1RleHQgLSBKU0RvYyB0ZXh0IGluc2lkZSBjb21tZW50IG1hcmtlcnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7bmFtZTogc3RyaW5nIHwgbnVsbCwgdHlwZTogc3RyaW5nfT59IC0gSlNEb2MgcGFyYW1ldGVycyAobmFtZSArIHR5cGUpIGluIGRlY2xhcmF0aW9uIG9yZGVyLlxuICAgKi9cbiAganNEb2NQYXJhbWV0ZXJzKGpzRG9jVGV4dCkge1xuICAgIGNvbnN0IHBhcmFtZXRlcnMgPSBbXVxuICAgIGNvbnN0IHBhcmFtUmVnZXggPSAvQHBhcmFtXFxzKlxcey9nXG4gICAgbGV0IF9wYXJhbU1hdGNoXG5cbiAgICB3aGlsZSAoKF9wYXJhbU1hdGNoID0gcGFyYW1SZWdleC5leGVjKGpzRG9jVGV4dCkpKSB7XG4gICAgICBjb25zdCB0eXBlT3BlbkluZGV4ID0gcGFyYW1SZWdleC5sYXN0SW5kZXggLSAxXG4gICAgICBjb25zdCB0eXBlQ2xvc2VJbmRleCA9IHRoaXMubWF0Y2hpbmdCcmFjZUluZGV4KHtvcGVuSW5kZXg6IHR5cGVPcGVuSW5kZXgsIHNvdXJjZVRleHQ6IGpzRG9jVGV4dH0pXG5cbiAgICAgIGlmICh0eXBlQ2xvc2VJbmRleCA9PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IHBhcnNlIEpTRG9jIHBhcmFtZXRlciB0eXBlIGZyb206ICR7anNEb2NUZXh0fWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHR5cGUgPSB0aGlzLm5vcm1hbGl6ZUpzRG9jVHlwZShqc0RvY1RleHQuc2xpY2UodHlwZU9wZW5JbmRleCArIDEsIHR5cGVDbG9zZUluZGV4KSlcblxuICAgICAgaWYgKHR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG5vbi1lbXB0eSBKU0RvYyBwYXJhbWV0ZXIgdHlwZSBpbjogJHtqc0RvY1RleHR9YClcbiAgICAgIH1cblxuICAgICAgLy8gQWZ0ZXIgdGhlIGNsb3NpbmcgYnJhY2UgdGhlIHBhcmFtZXRlciBuYW1lIGZvbGxvd3MgKG9wdGlvbmFsbHkgYnJhY2tldGVkXG4gICAgICAvLyBmb3IgYEBwYXJhbSB7dHlwZX0gW25hbWVdYCkuIENhcHR1cmUgdGhlIGxlYWRpbmcgbmFtZSB0b2tlbiDigJQgaW5jbHVkaW5nIGFueVxuICAgICAgLy8gZG90dGVkIHBhdGggc28gb2JqZWN0LXByb3BlcnR5IHRhZ3MgbGlrZSBgQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWVzc2FnZWAgc3RheVxuICAgICAgLy8gZGlzdGluZ3Vpc2hhYmxlIGZyb20gdGhlIHRvcC1sZXZlbCBgQHBhcmFtIHtvYmplY3R9IGFyZ3NgIHBhcmFtZXRlci5cbiAgICAgIGNvbnN0IG5hbWVNYXRjaCA9IGpzRG9jVGV4dC5zbGljZSh0eXBlQ2xvc2VJbmRleCArIDEpLm1hdGNoKC9eXFxzKlxcWz9cXHMqKFtBLVphLXpfJF1bXFx3JC5dKikvKVxuXG4gICAgICBwYXJhbWV0ZXJzLnB1c2goe25hbWU6IG5hbWVNYXRjaCA/IG5hbWVNYXRjaFsxXSA6IG51bGwsIHR5cGV9KVxuICAgICAgcGFyYW1SZWdleC5sYXN0SW5kZXggPSB0eXBlQ2xvc2VJbmRleCArIDFcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyYW1ldGVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgamF2YXNjcmlwdCBmaWxlcyBpbiBkaXJlY3RvcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaXJlY3RvcnkgLSBEaXJlY3RvcnkgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIEphdmFTY3JpcHQgc291cmNlIGZpbGUgcGF0aHMuXG4gICAqL1xuICBhc3luYyBqYXZhc2NyaXB0RmlsZXNJbkRpcmVjdG9yeShkaXJlY3RvcnkpIHtcbiAgICBsZXQgZW50cmllc1xuXG4gICAgdHJ5IHtcbiAgICAgIGVudHJpZXMgPSBhd2FpdCBmcy5yZWFkZGlyKGRpcmVjdG9yeSwge3dpdGhGaWxlVHlwZXM6IHRydWV9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgJiYgdHlwZW9mIGVycm9yID09IFwib2JqZWN0XCIgJiYgXCJjb2RlXCIgaW4gZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gXCJFTk9FTlRcIikgcmV0dXJuIFtdXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgY29uc3QgZmlsZVBhdGhzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgY29uc3QgZW50cnlQYXRoID0gcGF0aC5qb2luKGRpcmVjdG9yeSwgZW50cnkubmFtZSlcblxuICAgICAgaWYgKGVudHJ5LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgZmlsZVBhdGhzLnB1c2goLi4uYXdhaXQgdGhpcy5qYXZhc2NyaXB0RmlsZXNJbkRpcmVjdG9yeShlbnRyeVBhdGgpKVxuICAgICAgfSBlbHNlIGlmIChlbnRyeS5pc0ZpbGUoKSAmJiAvXFwuKG1qc3xqc3xqc3h8dHMpJC8udGVzdChlbnRyeS5uYW1lKSkge1xuICAgICAgICBmaWxlUGF0aHMucHVzaChlbnRyeVBhdGgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVQYXRoc1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGEgbWF0Y2hpbmcgY2xvc2luZyBicmFjZSB3aGlsZSByZXNwZWN0aW5nIEphdmFTY3JpcHQgc3RyaW5ncyBhbmQgY29tbWVudHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5vcGVuSW5kZXggLSBPcGVuaW5nIGJyYWNlIGluZGV4LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zb3VyY2VUZXh0IC0gU291cmNlIHRleHQuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIENsb3NpbmcgYnJhY2UgaW5kZXggd2hlbiBmb3VuZC5cbiAgICovXG4gIG1hdGNoaW5nQnJhY2VJbmRleCh7b3BlbkluZGV4LCBzb3VyY2VUZXh0fSkge1xuICAgIGlmIChzb3VyY2VUZXh0W29wZW5JbmRleF0gIT09IFwie1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9wZW5pbmcgYnJhY2UgYXQgaW5kZXggJHtvcGVuSW5kZXh9YClcbiAgICB9XG5cbiAgICBsZXQgZGVwdGggPSAwXG4gICAgbGV0IGluQmxvY2tDb21tZW50ID0gZmFsc2VcbiAgICBsZXQgaW5MaW5lQ29tbWVudCA9IGZhbHNlXG4gICAgbGV0IGluU3RyaW5nID0gXCJcIlxuXG4gICAgZm9yIChsZXQgaW5kZXggPSBvcGVuSW5kZXg7IGluZGV4IDwgc291cmNlVGV4dC5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGNvbnN0IGNoYXIgPSBzb3VyY2VUZXh0W2luZGV4XVxuICAgICAgY29uc3QgbmV4dENoYXIgPSBzb3VyY2VUZXh0W2luZGV4ICsgMV1cbiAgICAgIGNvbnN0IHByZXZpb3VzQ2hhciA9IHNvdXJjZVRleHRbaW5kZXggLSAxXVxuXG4gICAgICBpZiAoaW5MaW5lQ29tbWVudCkge1xuICAgICAgICBpZiAoY2hhciA9PT0gXCJcXG5cIikgaW5MaW5lQ29tbWVudCA9IGZhbHNlXG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGluQmxvY2tDb21tZW50KSB7XG4gICAgICAgIGlmIChjaGFyID09PSBcIipcIiAmJiBuZXh0Q2hhciA9PT0gXCIvXCIpIHtcbiAgICAgICAgICBpbkJsb2NrQ29tbWVudCA9IGZhbHNlXG4gICAgICAgICAgaW5kZXgrK1xuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGluU3RyaW5nKSB7XG4gICAgICAgIGlmIChjaGFyID09PSBpblN0cmluZyAmJiBwcmV2aW91c0NoYXIgIT09IFwiXFxcXFwiKSBpblN0cmluZyA9IFwiXCJcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCIvXCIgJiYgbmV4dENoYXIgPT09IFwiL1wiKSB7XG4gICAgICAgIGluTGluZUNvbW1lbnQgPSB0cnVlXG4gICAgICAgIGluZGV4KytcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiL1wiICYmIG5leHRDaGFyID09PSBcIipcIikge1xuICAgICAgICBpbkJsb2NrQ29tbWVudCA9IHRydWVcbiAgICAgICAgaW5kZXgrK1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCJcXFwiXCIgfHwgY2hhciA9PT0gXCInXCIgfHwgY2hhciA9PT0gXCJgXCIpIHtcbiAgICAgICAgaW5TdHJpbmcgPSBjaGFyXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgICBkZXB0aCsrXG4gICAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICAgIGRlcHRoLS1cblxuICAgICAgICBpZiAoZGVwdGggPT09IDApIHJldHVybiBpbmRleFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGZvciBtb2RlbCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsfSAtIEF0dHJpYnV0ZSBjb25maWcgaW5mZXJyZWQgZnJvbSB0aGUgYmFja2VuZCBtb2RlbCB3aGVuIGF2YWlsYWJsZS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yTW9kZWxBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFtb2RlbENsYXNzKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmICghcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKSByZXR1cm4gbnVsbFxuXG4gICAgbGV0IGNvbHVtbk5hbWVcblxuICAgIHRyeSB7XG4gICAgICBjb2x1bW5OYW1lID0gbW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lXVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKFwidXNlZCBiZWZvcmUgaW5pdGlhbGl6YXRpb25cIikpIHJldHVybiBudWxsXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGxldCBjb2x1bW5cblxuICAgIHRyeSB7XG4gICAgICBjb2x1bW4gPSBtb2RlbENsYXNzLmdldENvbHVtbnNIYXNoKClbY29sdW1uTmFtZV1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhcInVzZWQgYmVmb3JlIGluaXRpYWxpemF0aW9uXCIpKSByZXR1cm4gbnVsbFxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiBjb2x1bW4gPyB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yQ29sdW1uKHtjb2x1bW59KSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIGNvbHVtbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbHVtbiAtIERhdGFiYXNlIGNvbHVtbi5cbiAgICogQHJldHVybnMge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnfSAtIEF0dHJpYnV0ZSBjb25maWcgaW5mZXJyZWQgZnJvbSB0aGUgZGF0YWJhc2UgY29sdW1uLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JDb2x1bW4oe2NvbHVtbn0pIHtcbiAgICBjb25zdCB0eXBlID0gY29sdW1uLmdldFR5cGUoKVxuXG4gICAgaWYgKHR5cGVvZiB0eXBlICE9IFwic3RyaW5nXCIgfHwgdHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG5vbi1lbXB0eSBjb2x1bW4gdHlwZSBmb3IgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIGluZmVyZW5jZSwgZ290OiAke3R5cGV9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgbnVsbDogY29sdW1uLmdldE51bGwoKSxcbiAgICAgIHR5cGVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXBzIGZvciBtb2RlbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5tb2RlbENvbmZpZyAtIE1vZGVsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSBbYXJncy5yZXNvdXJjZUNsYXNzXSAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e2F1dG9sb2FkOiBib29sZWFuLCByZWxhdGlvbnNoaXBOYW1lOiBzdHJpbmcsIHRhcmdldENsYXNzTmFtZTogc3RyaW5nLCB0YXJnZXRGaWxlTmFtZTogc3RyaW5nLCB0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifT59IC0gUmVsYXRpb25zaGlwcy5cbiAgICovXG4gIHJlbGF0aW9uc2hpcHNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gbW9kZWxDb25maWcucmVsYXRpb25zaGlwc1xuXG4gICAgaWYgKHJlbGF0aW9uc2hpcHMgPT09IHVuZGVmaW5lZCB8fCByZWxhdGlvbnNoaXBzID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJyR7Y2xhc3NOYW1lfScgaGFzIGludmFsaWQgcmVsYXRpb25zaGlwcyBjb25maWcg4oCUIG11c3QgYmUgYW4gYXJyYXkgb2YgcmVsYXRpb25zaGlwIG5hbWVzLCBnb3QgJHt0eXBlb2YgcmVsYXRpb25zaGlwc31gKVxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBzLm1hcCgocmVsYXRpb25zaGlwTmFtZSkgPT4gdGhpcy5pbmZlcnJlZFJlbGF0aW9uc2hpcERlZmluaXRpb24oe2NsYXNzTmFtZSwgcmVsYXRpb25zaGlwTmFtZSwgcmVzb3VyY2VDbGFzc30pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5mZXJyZWQgcmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSBbYXJncy5yZXNvdXJjZUNsYXNzXSAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7e2F1dG9sb2FkOiBib29sZWFuLCByZWxhdGlvbnNoaXBOYW1lOiBzdHJpbmcsIHRhcmdldENsYXNzTmFtZTogc3RyaW5nLCB0YXJnZXRGaWxlTmFtZTogc3RyaW5nLCB0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifX0gSW5mZXJyZWQgcmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqL1xuICBpbmZlcnJlZFJlbGF0aW9uc2hpcERlZmluaXRpb24oe2NsYXNzTmFtZSwgcmVsYXRpb25zaGlwTmFtZSwgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gcmVzb3VyY2VDbGFzcyA/IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpIDogdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0TW9kZWxDbGFzcyhjbGFzc05hbWUpXG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcFR5cGUgPSByZWxhdGlvbnNoaXAuZ2V0VHlwZSgpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwVHlwZSAhPT0gXCJiZWxvbmdzVG9cIiAmJiByZWxhdGlvbnNoaXBUeXBlICE9PSBcImhhc09uZVwiICYmIHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiaGFzTWFueVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICcke2NsYXNzTmFtZX0nIHJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXBOYW1lfScgaGFzIHVuc3VwcG9ydGVkIHR5cGUgJyR7cmVsYXRpb25zaGlwVHlwZX0nYClcbiAgICB9XG5cbiAgICBsZXQgdGFyZ2V0Q2xhc3NOYW1lXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgdGFyZ2V0Q2xhc3NOYW1lID0gdGFyZ2V0TW9kZWxDbGFzcz8uZ2V0TW9kZWxOYW1lKClcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIE1vZGVsIGNsYXNzIG5vdCByZWdpc3RlcmVkIHlldCDigJQgZmFsbCBiYWNrIHRvIGNsYXNzTmFtZSBmcm9tIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9uXG4gICAgfVxuXG4gICAgaWYgKCF0YXJnZXRDbGFzc05hbWUpIHtcbiAgICAgIHRhcmdldENsYXNzTmFtZSA9IHJlbGF0aW9uc2hpcC5jbGFzc05hbWVcblxuICAgICAgaWYgKCF0YXJnZXRDbGFzc05hbWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAnJHtjbGFzc05hbWV9JyByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nIGhhcyBubyB0YXJnZXQgbW9kZWwgY2xhc3NgKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhdXRvbG9hZDogcmVsYXRpb25zaGlwLmdldEF1dG9sb2FkKCksXG4gICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgdGFyZ2V0Q2xhc3NOYW1lLFxuICAgICAgdGFyZ2V0RmlsZU5hbWU6IGluZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZSh0YXJnZXRDbGFzc05hbWUpKSxcbiAgICAgIHR5cGU6IHJlbGF0aW9uc2hpcFR5cGVcbiAgICB9XG4gIH1cbn1cbiJdfQ==
import BaseCommand from "../../../../../cli/base-command.js";
import fs from "fs/promises";
import generatedFileBanner from "./generated-file-banner.js";
import path from "node:path";
import * as inflection from "inflection";
import { frontendModelResourceIsBuiltIn, frontendModelResourcesWithBuiltInsForBackendProject } from "../../../../../frontend-models/built-in-resources.js";
import { frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition } from "../../../../../frontend-models/resource-definition.js";
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
        fileContent += ` * @augments {FrontendModelBase<${attributesTypeName}, ${createAttributesTypeName}, ${updateAttributesTypeName}>}\n`;
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
        const primaryKey = this.frontendModelPrimaryKeyForResource({ attributeNames, modelClass, modelConfig });
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
            fileContent += "      memberId: this.primaryKeyValue(),\n";
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
            const instance = new resourceClass({
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
            const instance = new resourceClass({
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
        if (typeof primaryKey != "string" || primaryKey.length < 1)
            return false;
        if (attributeName === primaryKey)
            return true;
        return modelClass.resolveAttributeName(primaryKey) === attributeName;
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
     * Validates an explicitly configured frontend-model primary key.
     * @param {{attributeNames: Array<string>, primaryKey: string}} args - Configured primary key args.
     * @returns {string} - Configured primary key.
     */
    validatedConfiguredPrimaryKey({ attributeNames, primaryKey }) {
        if (attributeNames.includes(primaryKey))
            return primaryKey;
        throw new Error(`Configured frontend model primary key "${primaryKey}" is not a generated frontend model attribute.`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL2dlbmVyYXRlL2Zyb250ZW5kLW1vZGVscy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSxvQ0FBb0MsQ0FBQTtBQUM1RCxPQUFPLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDNUIsT0FBTyxtQkFBbUIsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1RCxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLDhCQUE4QixFQUFFLG1EQUFtRCxFQUFDLE1BQU0sc0RBQXNELENBQUE7QUFDeEosT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGdEQUFnRCxFQUFDLE1BQU0sdURBQXVELENBQUE7QUFFaEs7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNIOzs7R0FHRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUNILE1BQU0sa0NBQWtDLEdBQUcsb0NBQW9DLENBQUE7QUFFL0UsbUdBQW1HO0FBQ25HLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0JBQXlCLFNBQVEsV0FBVztJQUMvRCwyREFBMkQ7SUFDM0QsMEJBQTBCLEdBQUcsSUFBSSxDQUFBO0lBRWpDLGdFQUFnRTtJQUNoRSw2QkFBNkIsR0FBRyxJQUFJLENBQUE7SUFFcEM7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUM3QyxNQUFNLGVBQWUsR0FBRyxhQUFhLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtRQUUxRCxNQUFNLGFBQWEsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRXRDLE1BQU0sa0JBQWtC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LGVBQWU7WUFDZixjQUFjLEVBQUUsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBQzVFLElBQUksRUFBRSxnQkFBZ0I7U0FDdkIsQ0FBQTtJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCBnZW5lcmF0ZWRGaWxlQmFubmVyIGZyb20gXCIuL2dlbmVyYXRlZC1maWxlLWJhbm5lci5qc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VJc0J1aWx0SW4sIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2Zyb250ZW5kLW1vZGVscy9idWlsdC1pbi1yZXNvdXJjZXMuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb259IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5cbi8qKlxuICogQXR0cmlidXRlIG1ldGFkYXRhIHVzZWQgZm9yIGdlbmVyYXRlZCBmcm9udGVuZC1tb2RlbCBKU0RvYy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kQXR0cmlidXRlQ29uZmlnXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3R5cGVdIC0gQ29sdW1uIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbHVtblR5cGVdIC0gQ29sdW1uIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3NxbFR5cGVdIC0gU1FMIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RhdGFUeXBlXSAtIERhdGEgdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbanNEb2NUeXBlXSAtIEV4YWN0IEpTRG9jIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gQXR0cmlidXRlIG5hbWUgd2hlbiBjb25maWd1cmVkIGFzIGFuIGFycmF5IGVudHJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbbnVsbF0gLSBXaGV0aGVyIG51bGwgaXMgYWxsb3dlZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NlbGVjdGVkQnlEZWZhdWx0XSAtIFdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBpcyBzZWxlY3RlZCBieSBkZWZhdWx0LlxuICogQHByb3BlcnR5IHsoKSA9PiBzdHJpbmd9IFtnZXRUeXBlXSAtIFJldHVybnMgY29sdW1uIHR5cGUuXG4gKiBAcHJvcGVydHkgeygpID0+IGJvb2xlYW59IFtnZXROdWxsXSAtIFJldHVybnMgd2hldGhlciBudWxsIGlzIGFsbG93ZWQuXG4gKi9cbi8qKlxuICogUGVybWl0IHNwZWMgcmV0dXJuZWQgYnkgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzIGR1cmluZyBnZW5lcmF0aW9uLlxuICogQHR5cGVkZWYge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxHZW5lcmF0b3JQZXJtaXRTcGVjPj59IEZyb250ZW5kTW9kZWxHZW5lcmF0b3JQZXJtaXRTcGVjXG4gKi9cbi8qKlxuICogSlNEb2MgaW1wb3J0IGFsaWFzIGV4dHJhY3RlZCBmcm9tIGEgYmFja2VuZCByZXNvdXJjZSBzb3VyY2UgZmlsZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJlc291cmNlSnNEb2NJbXBvcnRBbGlhc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGltcG9ydGVkTmFtZSAtIEV4cG9ydGVkIHR5cGUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzcGVjaWZpZXIgLSBJbXBvcnQgc3BlY2lmaWVyIGZyb20gdGhlIHNvdXJjZSBmaWxlLlxuICovXG4vKipcbiAqIEpTRG9jIHJldHVybiB0eXBlIGV4dHJhY3RlZCBmcm9tIGEgYmFja2VuZCByZXNvdXJjZSBtZXRob2QuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZXNvdXJjZU1ldGhvZFJldHVyblR5cGVcbiAqIEBwcm9wZXJ0eSB7TWFwPHN0cmluZywgUmVzb3VyY2VKc0RvY0ltcG9ydEFsaWFzPn0gaW1wb3J0QWxpYXNlcyAtIEltcG9ydCBhbGlhc2VzIHZpc2libGUgaW4gdGhlIHNvdXJjZSBmaWxlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBzb3VyY2VGaWxlIC0gU291cmNlIGZpbGUgdGhhdCBkZWNsYXJlZCB0aGUgbWV0aG9kLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHR5cGUgLSBKU0RvYyByZXR1cm4gdHlwZS5cbiAqL1xuLyoqXG4gKiBKU0RvYyBwYXJhbWV0ZXIgdHlwZSBleHRyYWN0ZWQgZnJvbSBhIGJhY2tlbmQgcmVzb3VyY2UgbWV0aG9kLlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlXG4gKiBAcHJvcGVydHkge01hcDxzdHJpbmcsIFJlc291cmNlSnNEb2NJbXBvcnRBbGlhcz59IGltcG9ydEFsaWFzZXMgLSBJbXBvcnQgYWxpYXNlcyB2aXNpYmxlIGluIHRoZSBzb3VyY2UgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gbmFtZSAtIFBhcmFtZXRlciBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBzb3VyY2VGaWxlIC0gU291cmNlIGZpbGUgdGhhdCBkZWNsYXJlZCB0aGUgbWV0aG9kLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHR5cGUgLSBKU0RvYyBwYXJhbWV0ZXIgdHlwZS5cbiAqL1xuY29uc3QgRlJPTlRFTkRfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORCA9IFwidmVsb2Npb3VzIGdlbmVyYXRlOmZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKiBOb2RlIENMSSBjb21tYW5kIHRoYXQgZ2VuZXJhdGVzIGZyb250ZW5kIG1vZGVsIGNsYXNzZXMgZnJvbSBiYWNrZW5kIHByb2plY3QgcmVzb3VyY2UgY29uZmlnLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJHZW5lcmF0ZUZyb250ZW5kTW9kZWxzIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZT4gfCBudWxsfSAqL1xuICBfcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcyA9IG51bGxcblxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZVtdPiB8IG51bGx9ICovXG4gIF9yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzID0gbnVsbFxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZmlsZXMgYXJlIGdlbmVyYXRlZC5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuXG4gICAgYXdhaXQgY29uZmlndXJhdGlvbi5pbml0aWFsaXplTW9kZWxzKClcblxuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmICh0eXBlb2YgZW52aXJvbm1lbnRIYW5kbGVyLmF1dG9EaXNjb3ZlclJlc291cmNlcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuYXV0b0Rpc2NvdmVyUmVzb3VyY2VzKGNvbmZpZ3VyYXRpb24pXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGJhY2tlbmRQcm9qZWN0cykgfHwgYmFja2VuZFByb2plY3RzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gYmFja2VuZCBwcm9qZWN0cyBjb25maWd1cmVkLiBDb25maWd1cmUgJ2JhY2tlbmRQcm9qZWN0cycgaW4geW91ciBjb25maWd1cmF0aW9uIGZpcnN0XCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRW5zdXJlZCBkaXJlY3Rvcmllcy5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgZW5zdXJlZERpcmVjdG9yaWVzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVkIG1vZGVsIG5hbWVzIGJ5IGRpcmVjdG9yeS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgU2V0PHN0cmluZz4+fSAqL1xuICAgIGNvbnN0IGdlbmVyYXRlZE1vZGVsTmFtZXNCeURpcmVjdG9yeSA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlZCBmaWxlcyBieSBkaXJlY3RvcnkuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIEFycmF5PHtjbGFzc05hbWU6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZ30+Pn0gKi9cbiAgICBjb25zdCBnZW5lcmF0ZWRGaWxlc0J5RGlyZWN0b3J5ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgICAgLy8gQ2Fub25pY2FsaXplIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHNvIGVxdWl2YWxlbnQgc3BlbGxpbmdzIChhIHRyYWlsaW5nXG4gICAgICAvLyBzbGFzaCwgYC5gL2AuLmAgc2VnbWVudHMsIGR1cGxpY2F0ZSBzZXBhcmF0b3JzLCByZWxhdGl2ZSB2cyBhYnNvbHV0ZSlcbiAgICAgIC8vIHJlc29sdmUgdG8gYSBzaW5nbGUga2V5LiBPdGhlcndpc2UgdGhlIHBlci1kaXJlY3RvcnkgbWFwcyBiZWxvdyB0cmVhdFxuICAgICAgLy8gdGhlbSBhcyBkaWZmZXJlbnQgZGlyZWN0b3JpZXMsIGR1cGxpY2F0ZSBjbGFzcyBuYW1lcyBzbGlwIHBhc3QgZGV0ZWN0aW9uLFxuICAgICAgLy8gYW5kIHRoZSBzcGxpdCBidWNrZXRzIHdyaXRlIGluY29tcGxldGUgaW5kZXguanMvc2V0dXAuanMgZm9yIGZpbGVzIHRoYXRcbiAgICAgIC8vIGFjdHVhbGx5IGxhbmQgaW4gdGhlIHNhbWUgZGlyZWN0b3J5IG9uIGRpc2suXG4gICAgICBjb25zdCBmcm9udGVuZE1vZGVsc0RpciA9IHBhdGgucmVzb2x2ZSh0aGlzLmZyb250ZW5kTW9kZWxzRGlyZWN0b3J5Rm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpKVxuICAgICAgY29uc3QgaW1wb3J0UGF0aCA9IHRoaXMuaW1wb3J0UGF0aEZvckZyb250ZW5kTW9kZWxzRGlyZWN0b3J5KGZyb250ZW5kTW9kZWxzRGlyKVxuXG4gICAgICBpZiAoIWVuc3VyZWREaXJlY3Rvcmllcy5oYXMoZnJvbnRlbmRNb2RlbHNEaXIpKSB7XG4gICAgICAgIGF3YWl0IGZzLm1rZGlyKGZyb250ZW5kTW9kZWxzRGlyLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgICAgICAgZW5zdXJlZERpcmVjdG9yaWVzLmFkZChmcm9udGVuZE1vZGVsc0RpcilcbiAgICAgIH1cblxuICAgICAgaWYgKCFnZW5lcmF0ZWRGaWxlc0J5RGlyZWN0b3J5Lmhhcyhmcm9udGVuZE1vZGVsc0RpcikpIHtcbiAgICAgICAgZ2VuZXJhdGVkRmlsZXNCeURpcmVjdG9yeS5zZXQoZnJvbnRlbmRNb2RlbHNEaXIsIFtdKVxuICAgICAgfVxuXG4gICAgICBpZiAoIWdlbmVyYXRlZE1vZGVsTmFtZXNCeURpcmVjdG9yeS5oYXMoZnJvbnRlbmRNb2RlbHNEaXIpKSB7XG4gICAgICAgIGdlbmVyYXRlZE1vZGVsTmFtZXNCeURpcmVjdG9yeS5zZXQoZnJvbnRlbmRNb2RlbHNEaXIsIG5ldyBTZXQoKSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgZ2VuZXJhdGVkRmlsZXMgPSBnZW5lcmF0ZWRGaWxlc0J5RGlyZWN0b3J5LmdldChmcm9udGVuZE1vZGVsc0RpcilcbiAgICAgIGNvbnN0IGdlbmVyYXRlZE1vZGVsTmFtZXMgPSBnZW5lcmF0ZWRNb2RlbE5hbWVzQnlEaXJlY3RvcnkuZ2V0KGZyb250ZW5kTW9kZWxzRGlyKVxuXG4gICAgICBpZiAoIWdlbmVyYXRlZEZpbGVzKSB0aHJvdyBuZXcgRXJyb3IoYEdlbmVyYXRlZCBmaWxlcyBsaXN0IG1pc3NpbmcgZm9yICR7ZnJvbnRlbmRNb2RlbHNEaXJ9YClcbiAgICAgIGlmICghZ2VuZXJhdGVkTW9kZWxOYW1lcykgdGhyb3cgbmV3IEVycm9yKGBHZW5lcmF0ZWQgbW9kZWwgbmFtZXMgc2V0IG1pc3NpbmcgZm9yICR7ZnJvbnRlbmRNb2RlbHNEaXJ9YClcbiAgICAgIGNvbnN0IHJlc291cmNlcyA9IHRoaXMucmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gICAgICBjb25zdCBhdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcyA9IHRoaXMuYXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMocmVzb3VyY2VzKVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3NOYW1lIGluIHJlc291cmNlcykge1xuICAgICAgICBjb25zdCBtb2RlbENvbmZpZyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZXNbbW9kZWxDbGFzc05hbWVdKVxuICAgICAgICBjb25zdCBjbGFzc05hbWUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKG1vZGVsQ2xhc3NOYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcbiAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBgJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoY2xhc3NOYW1lKSl9LmpzYFxuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGAke2Zyb250ZW5kTW9kZWxzRGlyfS8ke2ZpbGVOYW1lfWBcblxuICAgICAgICBpZiAoIW1vZGVsQ29uZmlnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGRlZmluaXRpb24gZm9yICcke2NsYXNzTmFtZX0nYClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc29sdmVkUmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VzW21vZGVsQ2xhc3NOYW1lXSlcbiAgICAgICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgY2FuJ3QgYmFjayBhIGdlbmVyYXRlZFxuICAgICAgICAvLyBmcm9udGVuZCBtb2RlbC4gVHJlYXQgaXQgYXMgcmVzb3VyY2UtbGVzcyBzbyB0aGUgZ2VuZXJhdG9yIGZhbGxzIGJhY2tcbiAgICAgICAgLy8gdG8gYnktbmFtZSBtb2RlbCBsb29rdXAgKyBlbXB0eSB3cml0ZSBwYXJhbXMgaW5zdGVhZCBvZiB0aHJvd2luZyB3aGVuXG4gICAgICAgIC8vIGl0IGVhZ2VybHkgY2FsbHMgYG1vZGVsQ2xhc3MoKWAgLyBgcGVybWl0dGVkUGFyYW1zKClgIG9uIGl0LlxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gcmVzb2x2ZWRSZXNvdXJjZUNsYXNzICYmIHJlc29sdmVkUmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzID8gcmVzb2x2ZWRSZXNvdXJjZUNsYXNzIDogbnVsbFxuXG4gICAgICAgIHRoaXMudmFsaWRhdGVNb2RlbENvbmZpZyh7YXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMsIGNsYXNzTmFtZSwgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KVxuXG4gICAgICAgIGlmIChnZW5lcmF0ZWRNb2RlbE5hbWVzLmhhcyhjbGFzc05hbWUpKSB7XG4gICAgICAgICAgaWYgKGZyb250ZW5kTW9kZWxSZXNvdXJjZUlzQnVpbHRJbih7bW9kZWxOYW1lOiBtb2RlbENsYXNzTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uOiByZXNvdXJjZXNbbW9kZWxDbGFzc05hbWVdfSkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBEdXBsaWNhdGUgZnJvbnRlbmQgbW9kZWwgZGVmaW5pdGlvbiBmb3IgJyR7Y2xhc3NOYW1lfSdgKVxuICAgICAgICB9XG5cbiAgICAgICAgZ2VuZXJhdGVkTW9kZWxOYW1lcy5hZGQoY2xhc3NOYW1lKVxuXG4gICAgICAgIGNvbnN0IGZpbGVDb250ZW50ID0gYXdhaXQgdGhpcy5idWlsZE1vZGVsRmlsZUNvbnRlbnQoe1xuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBmcm9udGVuZE1vZGVsRmlsZVBhdGg6IGZpbGVQYXRoLFxuICAgICAgICAgIGltcG9ydFBhdGgsXG4gICAgICAgICAgbW9kZWxDbGFzczogcmVzb3VyY2VDbGFzcyA/IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpIDogY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVtjbGFzc05hbWVdLFxuICAgICAgICAgIG1vZGVsQ29uZmlnLFxuICAgICAgICAgIHJlc291cmNlQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIGZpbGVDb250ZW50KVxuICAgICAgICBnZW5lcmF0ZWRGaWxlcy5wdXNoKHtjbGFzc05hbWUsIGZpbGVOYW1lfSlcblxuICAgICAgICBjb25zb2xlLmxvZyhgY3JlYXRlIHNyYy9mcm9udGVuZC1tb2RlbHMvJHtmaWxlTmFtZX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2Zyb250ZW5kTW9kZWxzRGlyLCBnZW5lcmF0ZWRGaWxlc10gb2YgZ2VuZXJhdGVkRmlsZXNCeURpcmVjdG9yeSkge1xuICAgICAgLy8gVGhlIGluZGV4LmpzIGJhcnJlbCBpcyBubyBsb25nZXIgZ2VuZXJhdGVkIOKAlCBub3RoaW5nIGltcG9ydHMgaXQgKG1vZGVscyBhcmVcbiAgICAgIC8vIGltcG9ydGVkIGJ5IGZpbGUgcGF0aCwgYW5kIHNldHVwLmpzIHBlcmZvcm1zIHRoZSByZWdpc3RyYXRpb24gc2lkZS1lZmZlY3RzKS5cbiAgICAgIC8vIFJlbW92ZSBhbnkgc3RhbGUgb25lIGxlZnQgZnJvbSBhbiBvbGRlciBnZW5lcmF0b3IuXG4gICAgICBhd2FpdCBmcy5ybShgJHtmcm9udGVuZE1vZGVsc0Rpcn0vaW5kZXguanNgLCB7Zm9yY2U6IHRydWV9KVxuXG4gICAgICBjb25zdCBzZXR1cENvbnRlbnQgPSB0aGlzLmJ1aWxkU2V0dXBGaWxlQ29udGVudChnZW5lcmF0ZWRGaWxlcylcblxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGAke2Zyb250ZW5kTW9kZWxzRGlyfS9zZXR1cC5qc2AsIHNldHVwQ29udGVudClcblxuICAgICAgY29uc29sZS5sb2coXCJjcmVhdGUgc3JjL2Zyb250ZW5kLW1vZGVscy9zZXR1cC5qc1wiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHZhbGlkYXRlIG1vZGVsIGNvbmZpZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IGFyZ3MuYXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMgLSBBdmFpbGFibGUgZnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZXMgaW4gYmFja2VuZCBwcm9qZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MubW9kZWxDb25maWcgLSBNb2RlbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gW2FyZ3MucmVzb3VyY2VDbGFzc10gLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdmFsaWRhdGVNb2RlbENvbmZpZyh7YXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMsIGNsYXNzTmFtZSwgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gbW9kZWxDb25maWcuYWJpbGl0aWVzXG5cbiAgICBpZiAoIWFiaWxpdGllcyB8fCB0eXBlb2YgYWJpbGl0aWVzICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICcke2NsYXNzTmFtZX0nIGlzIG1pc3NpbmcgcmVxdWlyZWQgJ2FiaWxpdGllcycgY29uZmlnYClcbiAgICB9XG5cbiAgICBjb25zdCByZWFkQWN0aW9ucyA9IFtcbiAgICAgIHthY3Rpb246IFwiaW5kZXhcIiwgYWJpbGl0eUFjdGlvbjogYWJpbGl0aWVzLmluZGV4fSxcbiAgICAgIHthY3Rpb246IFwiZmluZFwiLCBhYmlsaXR5QWN0aW9uOiBhYmlsaXRpZXMuZmluZH1cbiAgICBdXG5cbiAgICBmb3IgKGNvbnN0IHthY3Rpb24sIGFiaWxpdHlBY3Rpb259IG9mIHJlYWRBY3Rpb25zKSB7XG4gICAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eUFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJyR7Y2xhc3NOYW1lfScgaXMgbWlzc2luZyByZXF1aXJlZCBhYmlsaXRpZXMuJHthY3Rpb259IGNvbmZpZ2ApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IG1vZGVsQ29uZmlnLnJlbGF0aW9uc2hpcHNcblxuICAgIGlmIChyZWxhdGlvbnNoaXBzID09PSB1bmRlZmluZWQpIHJldHVyblxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFJlbGF0aW9uc2hpcHMgPSB0aGlzLnJlbGF0aW9uc2hpcHNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiBub3JtYWxpemVkUmVsYXRpb25zaGlwcykge1xuICAgICAgaWYgKCFhdmFpbGFibGVGcm9udGVuZE1vZGVsQ2xhc3NOYW1lcy5oYXMocmVsYXRpb25zaGlwLnRhcmdldENsYXNzTmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAnJHtjbGFzc05hbWV9JyByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9JyByZWZlcmVuY2VzICcke3JlbGF0aW9uc2hpcC50YXJnZXRDbGFzc05hbWV9JywgYnV0IG5vIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGV4aXN0cyBmb3IgdGhhdCB0YXJnZXQgaW4gdGhpcyBiYWNrZW5kIHByb2plY3RgKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlcyBmb3IgYmFja2VuZCBwcm9qZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBiYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBjb25maWcuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb24+fSAtIFJlc291cmNlIGRlZmluaXRpb25zIGtleWVkIGJ5IG1vZGVsIGNsYXNzIG5hbWUuXG4gICAqL1xuICByZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdCkge1xuICAgIHJldHVybiBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdmFpbGFibGUgZnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uPn0gcmVzb3VyY2VzIC0gUmVzb3VyY2UgY29uZmlndXJhdGlvbiBrZXllZCBieSBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gQXZhaWxhYmxlIGZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWVzLlxuICAgKi9cbiAgYXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMocmVzb3VyY2VzKSB7XG4gICAgLyoqXG4gICAgICogQ2xhc3MgbmFtZXMuXG4gICAgICogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGNsYXNzTmFtZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgcmVzb3VyY2VNb2RlbE5hbWUgaW4gcmVzb3VyY2VzKSB7XG4gICAgICBjbGFzc05hbWVzLmFkZChpbmZsZWN0aW9uLmNhbWVsaXplKHJlc291cmNlTW9kZWxOYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNsYXNzTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVscyBkaXJlY3RvcnkgZm9yIGJhY2tlbmQgcHJvamVjdC5cbiAgICogQHBhcmFtIHt7ZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoPzogc3RyaW5nfX0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFic29sdXRlIGZyb250ZW5kIG1vZGVscyBvdXRwdXQgZGlyZWN0b3J5LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbHNEaXJlY3RvcnlGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdCkge1xuICAgIGNvbnN0IG91dHB1dFBhdGggPSBiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVsc091dHB1dFBhdGggfHwgdGhpcy5kaXJlY3RvcnkoKVxuXG4gICAgcmV0dXJuIGAke291dHB1dFBhdGh9L3NyYy9mcm9udGVuZC1tb2RlbHNgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgcGF0aCBmb3IgZnJvbnRlbmQgbW9kZWxzIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZyb250ZW5kTW9kZWxzRGlyIC0gRnJvbnRlbmQgbW9kZWxzIG91dHB1dCBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQmFzZSBjbGFzcyBpbXBvcnQgcGF0aC5cbiAgICovXG4gIGltcG9ydFBhdGhGb3JGcm9udGVuZE1vZGVsc0RpcmVjdG9yeShmcm9udGVuZE1vZGVsc0Rpcikge1xuICAgIGNvbnN0IGRldk1vZGUgPSBmcm9udGVuZE1vZGVsc0Rpci5pbmNsdWRlcyhcIi9zcGVjL2R1bW15L3NyYy9mcm9udGVuZC1tb2RlbHNcIilcblxuICAgIGlmIChkZXZNb2RlKSB7XG4gICAgICByZXR1cm4gXCIuLi8uLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIlxuICAgIH1cblxuICAgIHJldHVybiBcInZlbG9jaW91cy9idWlsZC9zcmMvZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgbW9kZWwgZmlsZSBjb250ZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1ldGhvZCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mcm9udGVuZE1vZGVsRmlsZVBhdGggLSBHZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbXBvcnRQYXRoIC0gQmFzZSBjbGFzcyBpbXBvcnQgcGF0aC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5tb2RlbENvbmZpZyAtIE1vZGVsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSBbYXJncy5yZXNvdXJjZUNsYXNzXSAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEdlbmVyYXRlZCBmaWxlIGNvbnRlbnQuXG4gICAqL1xuICBhc3luYyBidWlsZE1vZGVsRmlsZUNvbnRlbnQoe2NsYXNzTmFtZSwgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLCBpbXBvcnRQYXRoLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5hdHRyaWJ1dGVEZWZpbml0aW9uc0Zvck1vZGVsKHtjbGFzc05hbWUsIG1vZGVsQ2xhc3MsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gdGhpcy5yZWxhdGlvbnNoaXBzRm9yTW9kZWwoe2NsYXNzTmFtZSwgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gbW9kZWxDb25maWcuYXR0YWNobWVudHMgJiYgdHlwZW9mIG1vZGVsQ29uZmlnLmF0dGFjaG1lbnRzID09PSBcIm9iamVjdFwiXG4gICAgICA/IG1vZGVsQ29uZmlnLmF0dGFjaG1lbnRzXG4gICAgICA6IHt9XG4gICAgY29uc3QgYXR0cmlidXRlc1R5cGVOYW1lID0gYCR7Y2xhc3NOYW1lfUF0dHJpYnV0ZXNgXG4gICAgY29uc3QgY3JlYXRlQXR0cmlidXRlc1R5cGVOYW1lID0gYCR7Y2xhc3NOYW1lfUNyZWF0ZUF0dHJpYnV0ZXNgXG4gICAgY29uc3QgdXBkYXRlQXR0cmlidXRlc1R5cGVOYW1lID0gYCR7Y2xhc3NOYW1lfVVwZGF0ZUF0dHJpYnV0ZXNgXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBhdHRyaWJ1dGVzLm1hcCgoYXR0cmlidXRlKSA9PiBhdHRyaWJ1dGUubmFtZSlcbiAgICBjb25zdCBwZXJtaXR0ZWRDcmVhdGVQYXJhbXMgPSB0aGlzLnBlcm1pdHRlZFBhcmFtc0ZvckdlbmVyYXRvcihyZXNvdXJjZUNsYXNzIHx8IG51bGwsIFwiY3JlYXRlXCIpXG4gICAgY29uc3QgcGVybWl0dGVkVXBkYXRlUGFyYW1zID0gdGhpcy5wZXJtaXR0ZWRQYXJhbXNGb3JHZW5lcmF0b3IocmVzb3VyY2VDbGFzcyB8fCBudWxsLCBcInVwZGF0ZVwiKVxuICAgIGNvbnN0IG5lc3RlZFdyaXRlVHlwZXMgPSB0aGlzLm5lc3RlZFdyaXRlVHlwZXNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBwZXJtaXR0ZWRQYXJhbXM6IHBlcm1pdHRlZENyZWF0ZVBhcmFtcy5jb25jYXQocGVybWl0dGVkVXBkYXRlUGFyYW1zKSwgcmVsYXRpb25zaGlwc30pXG4gICAgY29uc3QgdXNlc1RyYW5zcG9ydFZhbHVlID0gYXR0cmlidXRlcy5zb21lKChhdHRyaWJ1dGUpID0+IGF0dHJpYnV0ZS5qc0RvY1R5cGUuaW5jbHVkZXMoXCJGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcIikpXG4gICAgICB8fCBuZXN0ZWRXcml0ZVR5cGVzLnNvbWUoKG5lc3RlZFdyaXRlVHlwZSkgPT4gbmVzdGVkV3JpdGVUeXBlLmF0dHJpYnV0ZXMuc29tZSgoYXR0cmlidXRlKSA9PiBhdHRyaWJ1dGUudHlwZS5pbmNsdWRlcyhcIkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVwiKSkpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHtcbiAgICAgIGNyZWF0ZTogbW9kZWxDb25maWcuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5jcmVhdGUgfHwgXCJjcmVhdGVcIixcbiAgICAgIGluZGV4OiBtb2RlbENvbmZpZy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmluZGV4IHx8IFwiaW5kZXhcIlxuICAgIH1cbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSB7XG4gICAgICBhdHRhY2g6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy5hdHRhY2ggfHwgXCJhdHRhY2hcIixcbiAgICAgIGRlc3Ryb3k6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy5kZXN0cm95IHx8IFwiZGVzdHJveVwiLFxuICAgICAgZG93bmxvYWQ6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy5kb3dubG9hZCB8fCBcImRvd25sb2FkXCIsXG4gICAgICBmaW5kOiBtb2RlbENvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMuZmluZCB8fCBcImZpbmRcIixcbiAgICAgIHVwZGF0ZTogbW9kZWxDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzLnVwZGF0ZSB8fCBcInVwZGF0ZVwiLFxuICAgICAgdXJsOiBtb2RlbENvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMudXJsIHx8IFwidXJsXCJcbiAgICB9XG4gICAgY29uc3QgY29sbGVjdGlvbkNvbW1hbmRzID0gbW9kZWxDb25maWcuY29sbGVjdGlvbkNvbW1hbmRzXG4gICAgY29uc3QgbWVtYmVyQ29tbWFuZHMgPSBtb2RlbENvbmZpZy5tZW1iZXJDb21tYW5kc1xuICAgIGNvbnN0IGRlY2xhcmVkQ29tbWFuZE1ldGFkYXRhID0gbW9kZWxDb25maWcuY29tbWFuZE1ldGFkYXRhIHx8IHt9XG4gICAgY29uc3QgY29tbWFuZE1ldGFkYXRhID0gYXdhaXQgdGhpcy5jb21tYW5kTWV0YWRhdGFXaXRoUmVzb3VyY2VKc0RvYyh7XG4gICAgICBjb21tYW5kTWV0YWRhdGE6IGRlY2xhcmVkQ29tbWFuZE1ldGFkYXRhLFxuICAgICAgY29tbWFuZE5hbWVzOiBbLi4uT2JqZWN0LmtleXMoY29sbGVjdGlvbkNvbW1hbmRzKSwgLi4uT2JqZWN0LmtleXMobWVtYmVyQ29tbWFuZHMpXSxcbiAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgIHJlc291cmNlQ2xhc3NcbiAgICB9KVxuICAgIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNBcmVEZWZhdWx0ID0gYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5jcmVhdGUgPT09IFwiY3JlYXRlXCIgJiYgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5pbmRleCA9PT0gXCJpbmRleFwiXG4gICAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzQXJlRGVmYXVsdCA9IGJ1aWx0SW5NZW1iZXJDb21tYW5kcy5hdHRhY2ggPT09IFwiYXR0YWNoXCJcbiAgICAgICYmIGJ1aWx0SW5NZW1iZXJDb21tYW5kcy5kZXN0cm95ID09PSBcImRlc3Ryb3lcIlxuICAgICAgJiYgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmRvd25sb2FkID09PSBcImRvd25sb2FkXCJcbiAgICAgICYmIGJ1aWx0SW5NZW1iZXJDb21tYW5kcy5maW5kID09PSBcImZpbmRcIlxuICAgICAgJiYgYnVpbHRJbk1lbWJlckNvbW1hbmRzLnVwZGF0ZSA9PT0gXCJ1cGRhdGVcIlxuICAgICAgJiYgYnVpbHRJbk1lbWJlckNvbW1hbmRzLnVybCA9PT0gXCJ1cmxcIlxuXG4gICAgbGV0IGZpbGVDb250ZW50ID0gZ2VuZXJhdGVkRmlsZUJhbm5lcihGUk9OVEVORF9NT0RFTFNfUkVHRU5FUkFURV9DT01NQU5EKVxuXG4gICAgZmlsZUNvbnRlbnQgKz0gYGltcG9ydCBGcm9udGVuZE1vZGVsQmFzZSBmcm9tIFwiJHtpbXBvcnRQYXRofVwiXFxuYFxuXG4gICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiLyoqXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICogRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlnLlxcbmBcbiAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge2ltcG9ydChcIiR7aW1wb3J0UGF0aH1cIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWdcXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgKi9cXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiLyoqXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAqIEZhbGxiYWNrIGF0dHJpYnV0ZSB2YWx1ZSB0eXBlIGZvciBnZW5lcmF0ZWQgZmllbGRzIHdpdGhvdXQgbmFycm93ZXIgbWV0YWRhdGEuXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge2ltcG9ydChcIiR7aW1wb3J0UGF0aH1cIikuRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlfSBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgKi9cXG5cIlxuICAgIGlmICh1c2VzVHJhbnNwb3J0VmFsdWUpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiLyoqXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICogVmFsdWUgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uIGFuZCBkZXNlcmlhbGl6YXRpb24uXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAdHlwZWRlZiB7aW1wb3J0KFwiJHtpbXBvcnRQYXRofVwiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICB9XG4gICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiLyoqXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICogJHthdHRyaWJ1dGVzVHlwZU5hbWV9IHR5cGUuXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IGAgKiBAdHlwZWRlZiB7b2JqZWN0fSAke2F0dHJpYnV0ZXNUeXBlTmFtZX1cXG5gXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgYXR0cmlidXRlcykge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAqIEBwcm9wZXJ0eSB7JHthdHRyaWJ1dGUuanNEb2NUeXBlfX0gJHthdHRyaWJ1dGUubmFtZX0gLSBBdHRyaWJ1dGUgdmFsdWUuXFxuYFxuICAgIH1cbiAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblwiXG4gICAgZm9yIChjb25zdCBuZXN0ZWRXcml0ZVR5cGUgb2YgbmVzdGVkV3JpdGVUeXBlcykge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIvKipcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAqIEF0dHJpYnV0ZXMgYWNjZXB0ZWQgZm9yIG5lc3RlZCAke25lc3RlZFdyaXRlVHlwZS5yZWxhdGlvbnNoaXBOYW1lfSB3cml0ZXMuXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAqIEB0eXBlZGVmIHtvYmplY3R9ICR7bmVzdGVkV3JpdGVUeXBlLnR5cGVOYW1lfVxcbmBcbiAgICAgIGZvciAoY29uc3QgbmVzdGVkQXR0cmlidXRlIG9mIG5lc3RlZFdyaXRlVHlwZS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAcHJvcGVydHkgeyR7bmVzdGVkQXR0cmlidXRlLnR5cGV9fSBbJHtuZXN0ZWRBdHRyaWJ1dGUubmFtZX1dIC0gTmVzdGVkICR7bmVzdGVkQXR0cmlidXRlLm5hbWV9IHZhbHVlLlxcbmBcbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICB9XG4gICAgZmlsZUNvbnRlbnQgKz0gYXdhaXQgdGhpcy53cml0ZUF0dHJpYnV0ZXNUeXBlZGVmKHthdHRyaWJ1dGVzLCBhdHRyaWJ1dGVzVHlwZU5hbWUsIG1vZGVsQ2xhc3MsIG5lc3RlZFdyaXRlVHlwZXMsIHBlcm1pdHRlZFBhcmFtczogcGVybWl0dGVkQ3JlYXRlUGFyYW1zLCByZXNvdXJjZUNsYXNzLCB0eXBlTmFtZTogY3JlYXRlQXR0cmlidXRlc1R5cGVOYW1lfSlcbiAgICBmaWxlQ29udGVudCArPSBhd2FpdCB0aGlzLndyaXRlQXR0cmlidXRlc1R5cGVkZWYoe2F0dHJpYnV0ZXMsIGF0dHJpYnV0ZXNUeXBlTmFtZSwgbW9kZWxDbGFzcywgbmVzdGVkV3JpdGVUeXBlcywgcGVybWl0dGVkUGFyYW1zOiBwZXJtaXR0ZWRVcGRhdGVQYXJhbXMsIHJlc291cmNlQ2xhc3MsIHR5cGVOYW1lOiB1cGRhdGVBdHRyaWJ1dGVzVHlwZU5hbWV9KVxuICAgIGZpbGVDb250ZW50ICs9IFwiLyoqXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICogRnJvbnRlbmQgbW9kZWwgZm9yICR7Y2xhc3NOYW1lfS5cXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEBhdWdtZW50cyB7RnJvbnRlbmRNb2RlbEJhc2U8JHthdHRyaWJ1dGVzVHlwZU5hbWV9LCAke2NyZWF0ZUF0dHJpYnV0ZXNUeXBlTmFtZX0sICR7dXBkYXRlQXR0cmlidXRlc1R5cGVOYW1lfT59XFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgY2xhc3MgJHtjbGFzc05hbWV9IGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2Uge1xcbmBcbiAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlnLiAqL1xcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICAgIHJldHVybiB7XFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgICAgICAgbW9kZWxOYW1lOiAke0pTT04uc3RyaW5naWZ5KGNsYXNzTmFtZSl9LFxcbmBcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgYXR0YWNobWVudHM6IHtcXG5cIlxuICAgICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIGF0dGFjaG1lbnRDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgICBjb25zdCBhdHRhY2htZW50VHlwZSA9IGF0dGFjaG1lbnRDb25maWcgJiYgdHlwZW9mIGF0dGFjaG1lbnRDb25maWcgPT09IFwib2JqZWN0XCIgJiYgYXR0YWNobWVudENvbmZpZy50eXBlID09PSBcImhhc01hbnlcIlxuICAgICAgICAgID8gXCJoYXNNYW55XCJcbiAgICAgICAgICA6IFwiaGFzT25lXCJcblxuICAgICAgICBpZiAoYXR0YWNobWVudENvbmZpZy5zeW5jKSB7XG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgJHthdHRhY2htZW50TmFtZX06IHtcXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgICAgICAgc3luYzoge1xcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgICAgIGZldGNoOiAke0pTT04uc3RyaW5naWZ5KGF0dGFjaG1lbnRDb25maWcuc3luYy5mZXRjaCl9LFxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgICAgICAgICAgb2ZmbGluZVJlcXVpcmVtZW50OiAke0pTT04uc3RyaW5naWZ5KGF0dGFjaG1lbnRDb25maWcuc3luYy5vZmZsaW5lUmVxdWlyZW1lbnQpfSxcXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgICAgIHJldGVudGlvbjogJHtKU09OLnN0cmluZ2lmeShhdHRhY2htZW50Q29uZmlnLnN5bmMucmV0ZW50aW9uKX0sXFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgICAgIH0sXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgICAgICAgIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoYXR0YWNobWVudFR5cGUpfVxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICAgICAgfSxcXG5cIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICAgICR7YXR0YWNobWVudE5hbWV9OiB7dHlwZTogJHtKU09OLnN0cmluZ2lmeShhdHRhY2htZW50VHlwZSl9fSxcXG5gXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgfSxcXG5cIlxuICAgIH1cbiAgICBmaWxlQ29udGVudCArPSB0aGlzLmZvcm1hdHRlZEFycmF5UHJvcGVydHkoe1xuICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgcHJvcGVydHlOYW1lOiBcImF0dHJpYnV0ZXNcIixcbiAgICAgIHZhbHVlczogYXR0cmlidXRlTmFtZXNcbiAgICB9KVxuICAgIGlmICghYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc0FyZURlZmF1bHQpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IHRoaXMuZm9ybWF0dGVkT2JqZWN0UHJvcGVydHkoe1xuICAgICAgICBmaWx0ZXJEZWZhdWx0VmFsdWVzOiB7Y3JlYXRlOiBcImNyZWF0ZVwiLCBpbmRleDogXCJpbmRleFwifSxcbiAgICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgICBwcm9wZXJ0eU5hbWU6IFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiLFxuICAgICAgICB2YWx1ZXM6IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmICghYnVpbHRJbk1lbWJlckNvbW1hbmRzQXJlRGVmYXVsdCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRPYmplY3RQcm9wZXJ0eSh7XG4gICAgICAgIGZpbHRlckRlZmF1bHRWYWx1ZXM6IHtcbiAgICAgICAgICBhdHRhY2g6IFwiYXR0YWNoXCIsXG4gICAgICAgICAgZGVzdHJveTogXCJkZXN0cm95XCIsXG4gICAgICAgICAgZG93bmxvYWQ6IFwiZG93bmxvYWRcIixcbiAgICAgICAgICBmaW5kOiBcImZpbmRcIixcbiAgICAgICAgICB1cGRhdGU6IFwidXBkYXRlXCIsXG4gICAgICAgICAgdXJsOiBcInVybFwiXG4gICAgICAgIH0sXG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiLFxuICAgICAgICB2YWx1ZXM6IGJ1aWx0SW5NZW1iZXJDb21tYW5kc1xuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKGNvbGxlY3Rpb25Db21tYW5kcykubGVuZ3RoID4gMCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRDb21tYW5kc1Byb3BlcnR5KHtcbiAgICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgICBwcm9wZXJ0eU5hbWU6IFwiY29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gICAgICAgIHZhbHVlczogY29sbGVjdGlvbkNvbW1hbmRzXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXMobWVtYmVyQ29tbWFuZHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IHRoaXMuZm9ybWF0dGVkQ29tbWFuZHNQcm9wZXJ0eSh7XG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcIm1lbWJlckNvbW1hbmRzXCIsXG4gICAgICAgIHZhbHVlczogbWVtYmVyQ29tbWFuZHNcbiAgICAgIH0pXG4gICAgfVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5Rm9yUmVzb3VyY2Uoe2F0dHJpYnV0ZU5hbWVzLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZ30pXG5cbiAgICBpZiAocHJpbWFyeUtleSAhPT0gXCJpZFwiKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBgICAgICAgcHJpbWFyeUtleTogJHtKU09OLnN0cmluZ2lmeShwcmltYXJ5S2V5KX0sXFxuYFxuICAgIH1cbiAgICBjb25zdCBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lcyA9IHRoaXMubmVzdGVkUmVsYXRpb25zaGlwTmFtZXNGb3JHZW5lcmF0b3IocmVzb3VyY2VDbGFzcyB8fCBudWxsKVxuICAgIGlmIChuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICAgIG5lc3RlZEF0dHJpYnV0ZXM6IHtcXG5cIlxuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIG5lc3RlZFJlbGF0aW9uc2hpcE5hbWVzKSB7XG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICAgICR7cmVsYXRpb25zaGlwTmFtZX06IHt9LFxcbmBcbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgfSxcXG5cIlxuICAgIH1cbiAgICBpZiAobW9kZWxDb25maWcuc3luYz8uZW5hYmxlZCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRKc29uUHJvcGVydHkoe1xuICAgICAgICBpbmRlbnQ6IFwiICAgICAgXCIsXG4gICAgICAgIHByb3BlcnR5TmFtZTogXCJzeW5jXCIsXG4gICAgICAgIHZhbHVlOiBtb2RlbENvbmZpZy5zeW5jXG4gICAgICB9KVxuICAgIH1cbiAgICBmaWxlQ29udGVudCArPSBcIiAgICB9XFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAgfVxcblwiXG5cbiAgICBpZiAocmVsYXRpb25zaGlwcy5sZW5ndGggPiAwKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogXFxcImJlbG9uZ3NUb1xcXCIgfCBcXFwiaGFzT25lXFxcIiB8IFxcXCJoYXNNYW55XFxcIiwgYXV0b2xvYWQ/OiBib29sZWFufT59IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb25zLiAqL1xcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgc3RhdGljIHJlbGF0aW9uc2hpcERlZmluaXRpb25zKCkge1xcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICByZXR1cm4ge1xcblwiXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiByZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIGNvbnN0IHBhcnRzID0gW2B0eXBlOiAke0pTT04uc3RyaW5naWZ5KHJlbGF0aW9uc2hpcC50eXBlKX1gXVxuXG4gICAgICAgIGlmIChyZWxhdGlvbnNoaXAuYXV0b2xvYWQgPT09IGZhbHNlKSBwYXJ0cy5wdXNoKFwiYXV0b2xvYWQ6IGZhbHNlXCIpXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9OiB7JHtwYXJ0cy5qb2luKFwiLCBcIil9fSxcXG5gXG4gICAgICB9XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICB9XFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcblxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBSZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MgbmFtZXMuICovXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzKCkge1xcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICByZXR1cm4ge1xcblwiXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiByZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfTogJHtKU09OLnN0cmluZ2lmeShyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lKX0sXFxuYFxuICAgICAgfVxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgfVxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgfVxcblwiXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgYXR0cmlidXRlcykge1xuICAgICAgY29uc3QgY2FtZWxpemVkQXR0cmlidXRlID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGUubmFtZSwgdHJ1ZSlcbiAgICAgIGNvbnN0IGNhbWVsaXplZEF0dHJpYnV0ZVVwcGVyID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGUubmFtZSlcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZVR5cGUgPSBgJHthdHRyaWJ1dGVzVHlwZU5hbWV9WyR7SlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlLm5hbWUpfV1gXG4gICAgICBjb25zdCBzZXR0ZXJBdHRyaWJ1dGVUeXBlID0gYXdhaXQgdGhpcy5mcm9udGVuZFdyaXRlQXR0cmlidXRlVHlwZSh7XG4gICAgICAgIGF0dHJpYnV0ZSxcbiAgICAgICAgYXR0cmlidXRlTmFtZTogYXR0cmlidXRlLm5hbWUsXG4gICAgICAgIGF0dHJpYnV0ZXNUeXBlTmFtZSxcbiAgICAgICAgcmVzb3VyY2VDbGFzc1xuICAgICAgfSlcblxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgLyoqIEByZXR1cm5zIHske2F0dHJpYnV0ZVR5cGV9fSAtIEF0dHJpYnV0ZSB2YWx1ZS4gKi9cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAke2NhbWVsaXplZEF0dHJpYnV0ZX0oKSB7IHJldHVybiAvKiogQHR5cGUgeyR7YXR0cmlidXRlVHlwZX19ICovICh0aGlzLnJlYWRBdHRyaWJ1dGUoJHtKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGUubmFtZSl9KSkgfVxcbmBcblxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0geyR7c2V0dGVyQXR0cmlidXRlVHlwZX19IG5ld1ZhbHVlIC0gTmV3IGF0dHJpYnV0ZSB2YWx1ZS5cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7JHtzZXR0ZXJBdHRyaWJ1dGVUeXBlfX0gLSBBc3NpZ25lZCB2YWx1ZS5cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgIHNldCR7Y2FtZWxpemVkQXR0cmlidXRlVXBwZXJ9KG5ld1ZhbHVlKSB7IHJldHVybiAvKiogQHR5cGUgeyR7c2V0dGVyQXR0cmlidXRlVHlwZX19ICovICh0aGlzLnNldEF0dHJpYnV0ZSgke0pTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZS5uYW1lKX0sIG5ld1ZhbHVlKSkgfVxcbmBcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG1ldGhvZE5hbWUgb2YgT2JqZWN0LmtleXMoY29sbGVjdGlvbkNvbW1hbmRzKSkge1xuICAgICAgY29uc3Qgc2lnbmF0dXJlID0gdGhpcy5jdXN0b21Db21tYW5kTWV0aG9kU2lnbmF0dXJlKHtjb21tYW5kTWV0YWRhdGEsIG1ldGhvZE5hbWV9KVxuXG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIFJ1bnMgJHttZXRob2ROYW1lfS5cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBzaWduYXR1cmUucGFyYW1Eb2NzXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwke3NpZ25hdHVyZS5yZXR1cm5UeXBlfT59IC0gQ29tbWFuZCByZXNwb25zZS5cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgIHN0YXRpYyBhc3luYyAke21ldGhvZE5hbWV9KCR7c2lnbmF0dXJlLnBhcmFtZXRlcnN9KSB7XFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICByZXR1cm4gLyoqIEB0eXBlIHske3NpZ25hdHVyZS5yZXR1cm5UeXBlfX0gKi8gKGF3YWl0IHRoaXMuZXhlY3V0ZUN1c3RvbUNvbW1hbmQoe1xcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBjb21tYW5kTmFtZTogJHtKU09OLnN0cmluZ2lmeShjb2xsZWN0aW9uQ29tbWFuZHNbbWV0aG9kTmFtZV0pfSxcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgICAgY29tbWFuZFR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoY29sbGVjdGlvbkNvbW1hbmRzW21ldGhvZE5hbWVdKX0sXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIHBheWxvYWQ6ICR7Y2xhc3NOYW1lfS5ub3JtYWxpemVDdXN0b21Db21tYW5kUGF5bG9hZEFyZ3VtZW50cygke3NpZ25hdHVyZS5wYXlsb2FkQXJndW1lbnRzfSksXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgICByZXNvdXJjZVBhdGg6IHRoaXMucmVzb3VyY2VQYXRoKClcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgfSkpXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG1ldGhvZE5hbWUgb2YgT2JqZWN0LmtleXMobWVtYmVyQ29tbWFuZHMpKSB7XG4gICAgICBjb25zdCBzaWduYXR1cmUgPSB0aGlzLmN1c3RvbUNvbW1hbmRNZXRob2RTaWduYXR1cmUoe2NvbW1hbmRNZXRhZGF0YSwgbWV0aG9kTmFtZX0pXG5cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUnVucyAke21ldGhvZE5hbWV9LlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IHNpZ25hdHVyZS5wYXJhbURvY3NcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtQcm9taXNlPCR7c2lnbmF0dXJlLnJldHVyblR5cGV9Pn0gLSBDb21tYW5kIHJlc3BvbnNlLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgJHttZXRob2ROYW1lfSgke3NpZ25hdHVyZS5wYXJhbWV0ZXJzfSkge1xcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgcmV0dXJuIC8qKiBAdHlwZSB7JHtzaWduYXR1cmUucmV0dXJuVHlwZX19ICovIChhd2FpdCAke2NsYXNzTmFtZX0uZXhlY3V0ZUN1c3RvbUNvbW1hbmQoe1xcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBjb21tYW5kTmFtZTogJHtKU09OLnN0cmluZ2lmeShtZW1iZXJDb21tYW5kc1ttZXRob2ROYW1lXSl9LFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBjb21tYW5kVHlwZTogJHtKU09OLnN0cmluZ2lmeShtZW1iZXJDb21tYW5kc1ttZXRob2ROYW1lXSl9LFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgbWVtYmVySWQ6IHRoaXMucHJpbWFyeUtleVZhbHVlKCksXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBwYXlsb2FkOiAke2NsYXNzTmFtZX0ubm9ybWFsaXplQ3VzdG9tQ29tbWFuZFBheWxvYWRBcmd1bWVudHMoJHtzaWduYXR1cmUucGF5bG9hZEFyZ3VtZW50c30pLFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICByZXNvdXJjZVBhdGg6ICR7Y2xhc3NOYW1lfS5yZXNvdXJjZVBhdGgoKVxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgIH0pKVxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgfVxcblwiXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgcmVsYXRpb25zaGlwcykge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZCA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRJbXBvcnRQYXRoID0gYC4vJHtyZWxhdGlvbnNoaXAudGFyZ2V0RmlsZU5hbWV9LmpzYFxuICAgICAgY29uc3QgdGFyZ2V0SW5zdGFuY2VUeXBlID0gYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHRhcmdldEltcG9ydFBhdGgpfSkuJHtyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lfWBcbiAgICAgIGNvbnN0IHRhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlID0gYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHRhcmdldEltcG9ydFBhdGgpfSkuJHtyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lfUNyZWF0ZUF0dHJpYnV0ZXNgXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAudHlwZSA9PSBcImhhc01hbnlcIikge1xuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9IHJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDwke2NsYXNzTmFtZX0sICR7dGFyZ2V0SW5zdGFuY2VUeXBlfSwgJHt0YXJnZXRDcmVhdGVBdHRyaWJ1dGVzVHlwZX0+fSAtIFJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKSB7IHJldHVybiAvKiogQHR5cGUge2ltcG9ydCgke0pTT04uc3RyaW5naWZ5KGltcG9ydFBhdGgpfSkuRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8JHtjbGFzc05hbWV9LCAke3RhcmdldEluc3RhbmNlVHlwZX0sICR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9Pn0gKi8gKHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKCR7SlNPTi5zdHJpbmdpZnkocmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWUpfSkpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUmV0dXJucyAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfS5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPCR7Y2xhc3NOYW1lfSwgJHt0YXJnZXRJbnN0YW5jZVR5cGV9LCAke3RhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlfT59IC0gUmVsYXRpb25zaGlwIGhlbHBlci5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfSgpIHsgcmV0dXJuIHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKSB9XFxuYFxuXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIFJldHVybnMgbG9hZGVkICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge0FycmF5PCR7dGFyZ2V0SW5zdGFuY2VUeXBlfT59IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWxzLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9TG9hZGVkKCkgeyByZXR1cm4gdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLmxvYWRlZCgpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogTG9hZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTwke3RhcmdldEluc3RhbmNlVHlwZX0+Pn0gLSBMb2FkZWQgcmVsYXRlZCBtb2RlbHMuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgbG9hZCR7cmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZH0oKSB7IHJldHVybiBhd2FpdCB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkubG9hZCgpIH1cXG5gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9IHJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8JHtjbGFzc05hbWV9LCAke3RhcmdldEluc3RhbmNlVHlwZX0sICR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9Pn0gLSBSZWxhdGlvbnNoaXAgaGVscGVyLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDwke2NsYXNzTmFtZX0sICR7dGFyZ2V0SW5zdGFuY2VUeXBlfSwgJHt0YXJnZXRDcmVhdGVBdHRyaWJ1dGVzVHlwZX0+fSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoJHtKU09OLnN0cmluZ2lmeShyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZSl9KSkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMgeyR7dGFyZ2V0SW5zdGFuY2VUeXBlfSB8IG51bGx9IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0oKSB7IHJldHVybiB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkubG9hZGVkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBCdWlsZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0geyR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9fSBbYXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzIGZvciB0aGUgbmV3IHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7JHt0YXJnZXRJbnN0YW5jZVR5cGV9fSAtIEJ1aWx0IHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYnVpbGQke3JlbGF0aW9uc2hpcE5hbWVDYW1lbGl6ZWR9KGF0dHJpYnV0ZXMgPSB7fSkgeyByZXR1cm4gdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLmJ1aWxkKGF0dHJpYnV0ZXMpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogTG9hZHMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwke3RhcmdldEluc3RhbmNlVHlwZX0gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRlZCBtb2RlbC5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICBhc3luYyBsb2FkJHtyZWxhdGlvbnNoaXBOYW1lQ2FtZWxpemVkfSgpIHsgcmV0dXJuIGF3YWl0IHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKS5sb2FkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zIG9yIGxvYWRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge1Byb21pc2U8JHt0YXJnZXRJbnN0YW5jZVR5cGV9IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1PckxvYWQoKSB7IHJldHVybiBhd2FpdCB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkub3JMb2FkKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBTZXRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHske3RhcmdldEluc3RhbmNlVHlwZX0gfCBudWxsfSBtb2RlbCAtIFJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICogQHJldHVybnMge3ZvaWR9XFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgIHNldCR7cmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZH0obW9kZWwpIHsgdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLnNldExvYWRlZChtb2RlbCkgfVxcbmBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmaWxlQ29udGVudCArPSBcIn1cXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgRnJvbnRlbmRNb2RlbEJhc2UucmVnaXN0ZXJNb2RlbCgke2NsYXNzTmFtZX0pXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgZXhwb3J0IHske2NsYXNzTmFtZX19XFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBgZXhwb3J0IGRlZmF1bHQgJHtjbGFzc05hbWV9XFxuYFxuXG4gICAgcmV0dXJuIGZpbGVDb250ZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBzZXR1cCBmaWxlIGNvbnRlbnQuXG4gICAqIEBwYXJhbSB7QXJyYXk8e2NsYXNzTmFtZTogc3RyaW5nLCBmaWxlTmFtZTogc3RyaW5nfT59IGdlbmVyYXRlZEZpbGVzIC0gR2VuZXJhdGVkIG1vZGVsIGZpbGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNldHVwIGZpbGUgY29udGVudCB3aXRoIHNpZGUtZWZmZWN0IGltcG9ydHMgZm9yIG1vZGVsIHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGJ1aWxkU2V0dXBGaWxlQ29udGVudChnZW5lcmF0ZWRGaWxlcykge1xuICAgIGxldCBjb250ZW50ID0gZ2VuZXJhdGVkRmlsZUJhbm5lcihGUk9OVEVORF9NT0RFTFNfUkVHRU5FUkFURV9DT01NQU5EKVxuXG4gICAgZm9yIChjb25zdCB7ZmlsZU5hbWV9IG9mIGdlbmVyYXRlZEZpbGVzKSB7XG4gICAgICBjb250ZW50ICs9IGBpbXBvcnQgXCIuLyR7ZmlsZU5hbWV9XCJcXG5gXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbnRlbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdyaXRlIGF0dHJpYnV0ZXMgdHlwZWRlZi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7QXJyYXk8e2pzRG9jVHlwZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcsIHdyaXRlSnNEb2NUeXBlOiBzdHJpbmd9Pn0gYXJncy5hdHRyaWJ1dGVzIC0gR2VuZXJhdGVkIHJlYWQgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlc1R5cGVOYW1lIC0gR2VuZXJhdGVkIHJlYWQgYXR0cmlidXRlcyB0eXBlZGVmIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge0FycmF5PHthdHRyaWJ1dGVzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB0eXBlTmFtZTogc3RyaW5nfT59IGFyZ3MubmVzdGVkV3JpdGVUeXBlcyAtIE5lc3RlZCB3cml0ZSB0eXBlZGVmcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsR2VuZXJhdG9yUGVybWl0U3BlY30gYXJncy5wZXJtaXR0ZWRQYXJhbXMgLSBSZXNvdXJjZSBwZXJtaXR0ZWQgcGFyYW1zIHNwZWMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZU5hbWUgLSBUeXBlZGVmIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gR2VuZXJhdGVkIHR5cGVkZWYgc291cmNlLlxuICAgKi9cbiAgYXN5bmMgd3JpdGVBdHRyaWJ1dGVzVHlwZWRlZih7YXR0cmlidXRlcywgYXR0cmlidXRlc1R5cGVOYW1lLCBtb2RlbENsYXNzLCBuZXN0ZWRXcml0ZVR5cGVzLCBwZXJtaXR0ZWRQYXJhbXMsIHJlc291cmNlQ2xhc3MsIHR5cGVOYW1lfSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZUxpbmVzID0gW11cblxuICAgIGxldCBvdXRwdXQgPSBcIi8qKlxcblwiXG5cbiAgICBjb25zdCBhdHRyaWJ1dGVzQnlOYW1lID0gbmV3IE1hcChhdHRyaWJ1dGVzLm1hcCgoYXR0cmlidXRlKSA9PiBbYXR0cmlidXRlLm5hbWUsIGF0dHJpYnV0ZV0pKVxuICAgIGNvbnN0IG5lc3RlZFdyaXRlVHlwZXNCeUtleSA9IG5ldyBNYXAobmVzdGVkV3JpdGVUeXBlcy5tYXAoKG5lc3RlZFdyaXRlVHlwZSkgPT4gW2Ake25lc3RlZFdyaXRlVHlwZS5yZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXNgLCBuZXN0ZWRXcml0ZVR5cGVdKSlcbiAgICBjb25zdCBlbWl0dGVkQXR0cmlidXRlTmFtZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcGVybWl0dGVkUGFyYW1zKSB7XG4gICAgICBpZiAodHlwZW9mIGVudHJ5ID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IHRoaXMuZnJvbnRlbmRXcml0ZUF0dHJpYnV0ZU5hbWUoe2F0dHJpYnV0ZU5hbWU6IGVudHJ5LCBhdHRyaWJ1dGVzQnlOYW1lLCBtb2RlbENsYXNzfSlcblxuICAgICAgICBpZiAoZW1pdHRlZEF0dHJpYnV0ZU5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkgY29udGludWVcblxuICAgICAgICBlbWl0dGVkQXR0cmlidXRlTmFtZXMuYWRkKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgICAgY29uc3QgdHlwZSA9IGF3YWl0IHRoaXMuZnJvbnRlbmRXcml0ZUF0dHJpYnV0ZVR5cGUoe1xuICAgICAgICAgIGF0dHJpYnV0ZTogYXR0cmlidXRlc0J5TmFtZS5nZXQoYXR0cmlidXRlTmFtZSksXG4gICAgICAgICAgYXR0cmlidXRlTmFtZSxcbiAgICAgICAgICBhdHRyaWJ1dGVzVHlwZU5hbWUsXG4gICAgICAgICAgcmVzb3VyY2VDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF0dHJpYnV0ZUxpbmVzLnB1c2goYCAqIEBwcm9wZXJ0eSB7JHt0eXBlfX0gWyR7YXR0cmlidXRlTmFtZX1dIC0gUGVybWl0dGVkICR7YXR0cmlidXRlTmFtZX0gdmFsdWUuXFxuYClcbiAgICAgIH0gZWxzZSBpZiAoZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoZW50cnkpKSB7XG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGVudHJ5KSkge1xuICAgICAgICAgIGNvbnN0IG5lc3RlZFdyaXRlVHlwZSA9IG5lc3RlZFdyaXRlVHlwZXNCeUtleS5nZXQoa2V5KVxuICAgICAgICAgIGNvbnN0IHR5cGUgPSBuZXN0ZWRXcml0ZVR5cGUgPyBgQXJyYXk8JHtuZXN0ZWRXcml0ZVR5cGUudHlwZU5hbWV9PmAgOiBcIkFycmF5PG9iamVjdD5cIlxuXG4gICAgICAgICAgYXR0cmlidXRlTGluZXMucHVzaChgICogQHByb3BlcnR5IHske3R5cGV9fSBbJHtrZXl9XSAtIFBlcm1pdHRlZCBuZXN0ZWQgJHtrZXl9IHZhbHVlcy5cXG5gKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgb3V0cHV0ICs9IGAgKiBBdHRyaWJ1dGVzIGFjY2VwdGVkIGJ5ICR7dHlwZU5hbWV9LlxcbmBcbiAgICBpZiAoYXR0cmlidXRlTGluZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBvdXRwdXQgKz0gYCAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBuZXZlcj59ICR7dHlwZU5hbWV9XFxuYFxuICAgIH0gZWxzZSB7XG4gICAgICBvdXRwdXQgKz0gYCAqIEB0eXBlZGVmIHtvYmplY3R9ICR7dHlwZU5hbWV9XFxuYFxuICAgICAgb3V0cHV0ICs9IGF0dHJpYnV0ZUxpbmVzLmpvaW4oXCJcIilcbiAgICB9XG4gICAgb3V0cHV0ICs9IFwiICovXFxuXCJcblxuICAgIHJldHVybiBvdXRwdXRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHdyaXRlIGF0dHJpYnV0ZSB0eXBlLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGU6IHtqc0RvY1R5cGU6IHN0cmluZywgbmFtZTogc3RyaW5nLCB3cml0ZUpzRG9jVHlwZTogc3RyaW5nfSB8IHVuZGVmaW5lZCwgYXR0cmlidXRlTmFtZTogc3RyaW5nLCBhdHRyaWJ1dGVzVHlwZU5hbWU6IHN0cmluZywgcmVzb3VyY2VDbGFzczogaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKU0RvYyB0eXBlIGZvciB0aGUgcGVybWl0dGVkIHdyaXRlIGZpZWxkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRXcml0ZUF0dHJpYnV0ZVR5cGUoe2F0dHJpYnV0ZSwgYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlc1R5cGVOYW1lLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGNvbnN0IHNldHRlclBhcmFtZXRlclR5cGUgPSBhd2FpdCB0aGlzLmZyb250ZW5kV3JpdGVBdHRyaWJ1dGVTZXR0ZXJQYXJhbWV0ZXJUeXBlKHthdHRyaWJ1dGVOYW1lLCByZXNvdXJjZUNsYXNzfSlcblxuICAgIGlmIChzZXR0ZXJQYXJhbWV0ZXJUeXBlKSByZXR1cm4gYCR7c2V0dGVyUGFyYW1ldGVyVHlwZX0gfCBudWxsYFxuXG4gICAgaWYgKCFhdHRyaWJ1dGUpIHJldHVybiBcIkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVwiXG5cbiAgICBpZiAoYXR0cmlidXRlLmpzRG9jVHlwZS50cmltKCkgPT09IFwibnVsbFwiKSByZXR1cm4gXCJGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcIlxuXG4gICAgaWYgKGF0dHJpYnV0ZS53cml0ZUpzRG9jVHlwZSAhPT0gYXR0cmlidXRlLmpzRG9jVHlwZSkgcmV0dXJuIGF0dHJpYnV0ZS53cml0ZUpzRG9jVHlwZVxuXG4gICAgcmV0dXJuIGAke2F0dHJpYnV0ZXNUeXBlTmFtZX1bJHtKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGUubmFtZSl9XSB8IG51bGxgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCB3cml0ZSBhdHRyaWJ1dGUgc2V0dGVyIHBhcmFtZXRlciB0eXBlLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH19IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFNldHRlciB2YWx1ZSBwYXJhbWV0ZXIgdHlwZSB3aGVuIGl0IGlzIHVzZWZ1bCBmb3IgZ2VuZXJhdGlvbi5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kV3JpdGVBdHRyaWJ1dGVTZXR0ZXJQYXJhbWV0ZXJUeXBlKHthdHRyaWJ1dGVOYW1lLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGlmICghcmVzb3VyY2VDbGFzcz8ubmFtZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZU5hbWUpfUF0dHJpYnV0ZWBcbiAgICBjb25zdCBwYXJhbWV0ZXJUeXBlID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGUoe1xuICAgICAgbWV0aG9kTmFtZSxcbiAgICAgIHBhcmFtZXRlckluZGV4OiAxLFxuICAgICAgc291cmNlQ2xhc3NOYW1lOiByZXNvdXJjZUNsYXNzLm5hbWVcbiAgICB9KVxuXG4gICAgaWYgKCFwYXJhbWV0ZXJUeXBlKSByZXR1cm4gbnVsbFxuICAgIGlmICh0aGlzLmlzQnJvYWRHZW5lcmF0ZWRUeXBlKHBhcmFtZXRlclR5cGUpKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHBhcmFtZXRlclR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGJyb2FkIGdlbmVyYXRlZCB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ganNEb2NUeXBlIC0gSlNEb2MgdHlwZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgdHlwZSBpcyB0b28gYnJvYWQgdG8gaW1wcm92ZSBnZW5lcmF0ZWQgd3JpdGUgdHlwaW5nLlxuICAgKi9cbiAgaXNCcm9hZEdlbmVyYXRlZFR5cGUoanNEb2NUeXBlKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSBqc0RvY1R5cGUudHJpbSgpXG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFR5cGUgPT09IFwiP1wiXG4gICAgICB8fCBub3JtYWxpemVkVHlwZSA9PT0gXCJhbnlcIlxuICAgICAgfHwgbm9ybWFsaXplZFR5cGUgPT09IFwib2JqZWN0XCJcbiAgICAgIHx8IG5vcm1hbGl6ZWRUeXBlID09PSBcInVua25vd25cIlxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgcGVybWl0dGVkIHdyaXRlIGF0dHJpYnV0ZSB0byB0aGUgZ2VuZXJhdGVkIGZyb250ZW5kIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXNCeU5hbWU6IE1hcDxzdHJpbmcsIHtqc0RvY1R5cGU6IHN0cmluZywgbmFtZTogc3RyaW5nfT4sIG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH19IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnJvbnRlbmQgYXR0cmlidXRlIG5hbWUgdXNlZCBieSBnZW5lcmF0ZWQgYWNjZXNzb3JzLlxuICAgKi9cbiAgZnJvbnRlbmRXcml0ZUF0dHJpYnV0ZU5hbWUoe2F0dHJpYnV0ZU5hbWUsIGF0dHJpYnV0ZXNCeU5hbWUsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKGF0dHJpYnV0ZXNCeU5hbWUuaGFzKGF0dHJpYnV0ZU5hbWUpKSByZXR1cm4gYXR0cmlidXRlTmFtZVxuXG4gICAgaWYgKG1vZGVsQ2xhc3MpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKHJlc29sdmVkQXR0cmlidXRlTmFtZSAmJiBhdHRyaWJ1dGVzQnlOYW1lLmhhcyhyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpKSByZXR1cm4gcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lXG4gICAgfVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZU5hbWUsIHRydWUpLnRvTG93ZXJDYXNlKClcbiAgICBjb25zdCBtYXRjaGluZ0F0dHJpYnV0ZU5hbWUgPSBBcnJheS5mcm9tKGF0dHJpYnV0ZXNCeU5hbWUua2V5cygpKS5maW5kKChjYW5kaWRhdGVOYW1lKSA9PiBjYW5kaWRhdGVOYW1lLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKG1hdGNoaW5nQXR0cmlidXRlTmFtZSkgcmV0dXJuIG1hdGNoaW5nQXR0cmlidXRlTmFtZVxuXG4gICAgLy8gV3JpdGUtb25seSB2aXJ0dWFsIHBhcmFtcyBhcmUgdmFsaWQgcGVybWl0dGVkIHBhcmFtcyBldmVuIHdoZW4gdGhleSBoYXZlIG5vIHJlYWQgYXR0cmlidXRlLlxuICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXN0ZWQgd3JpdGUgdHlwZXMgZm9yIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsR2VuZXJhdG9yUGVybWl0U3BlY30gYXJncy5wZXJtaXR0ZWRQYXJhbXMgLSBDb21iaW5lZCBwZXJtaXR0ZWQgcGFyYW1zIHNwZWNzLlxuICAgKiBAcGFyYW0ge0FycmF5PHthdXRvbG9hZDogYm9vbGVhbiwgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB0YXJnZXRDbGFzc05hbWU6IHN0cmluZywgdGFyZ2V0RmlsZU5hbWU6IHN0cmluZywgdHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn0+fSBhcmdzLnJlbGF0aW9uc2hpcHMgLSBHZW5lcmF0ZWQgcmVsYXRpb25zaGlwcy5cbiAgICogQHJldHVybnMge0FycmF5PHthdHRyaWJ1dGVzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB0eXBlTmFtZTogc3RyaW5nfT59IC0gTmVzdGVkIHdyaXRlIHR5cGVkZWZzLlxuICAgKi9cbiAgbmVzdGVkV3JpdGVUeXBlc0Zvck1vZGVsKHtjbGFzc05hbWUsIHBlcm1pdHRlZFBhcmFtcywgcmVsYXRpb25zaGlwc30pIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzQnlOYW1lID0gbmV3IE1hcChyZWxhdGlvbnNoaXBzLm1hcCgocmVsYXRpb25zaGlwKSA9PiBbcmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcF0pKVxuICAgIGNvbnN0IG5lc3RlZFdyaXRlVHlwZXNCeU5hbWUgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcGVybWl0dGVkUGFyYW1zKSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZW50cnkpKSBjb250aW51ZVxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhlbnRyeSkpIHtcbiAgICAgICAgaWYgKCFrZXkuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSBjb250aW51ZVxuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0ga2V5LnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG4gICAgICAgIGNvbnN0IG5lc3RlZFNwZWMgPSBlbnRyeVtrZXldXG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcHNCeU5hbWUuZ2V0KHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIGxldCB0YXJnZXRNb2RlbENsYXNzXG5cbiAgICAgICAgaWYgKHJlbGF0aW9uc2hpcCkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0TW9kZWxDbGFzcyhyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lKVxuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzcyA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChuZXN0ZWRXcml0ZVR5cGVzQnlOYW1lLmhhcyhyZWxhdGlvbnNoaXBOYW1lKSkgY29udGludWVcblxuICAgICAgICBuZXN0ZWRXcml0ZVR5cGVzQnlOYW1lLnNldChyZWxhdGlvbnNoaXBOYW1lLCB7XG4gICAgICAgICAgYXR0cmlidXRlczogdGhpcy5uZXN0ZWRXcml0ZUF0dHJpYnV0ZXNGb3JTcGVjKHtuZXN0ZWRTcGVjLCB0YXJnZXRNb2RlbENsYXNzfSksXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0eXBlTmFtZTogYCR7Y2xhc3NOYW1lfSR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1OZXN0ZWRBdHRyaWJ1dGVzYFxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5mcm9tKG5lc3RlZFdyaXRlVHlwZXNCeU5hbWUudmFsdWVzKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXN0ZWQgd3JpdGUgYXR0cmlidXRlcyBmb3Igc3BlYy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgb2JqZWN0Pj4gfCBvYmplY3QgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLm5lc3RlZFNwZWMgLSBOZXN0ZWQgcGVybWl0IHNwZWMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgYmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge0FycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+fSAtIE5lc3RlZCB3cml0ZSBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgbmVzdGVkV3JpdGVBdHRyaWJ1dGVzRm9yU3BlYyh7bmVzdGVkU3BlYywgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkobmVzdGVkU3BlYykpIHJldHVybiBbXVxuXG4gICAgcmV0dXJuIG5lc3RlZFNwZWMuZmlsdGVyKChlbnRyeSkgPT4gdHlwZW9mIGVudHJ5ID09IFwic3RyaW5nXCIpLm1hcCgoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gdGFyZ2V0TW9kZWxDbGFzcz8ucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkgfHwgYXR0cmlidXRlTmFtZVxuICAgICAgY29uc3QgYXR0cmlidXRlQ29uZmlnID0gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0Zvck1vZGVsQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lOiByZXNvbHZlZEF0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3N9KVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBuYW1lOiByZXNvbHZlZEF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIHR5cGU6IGF0dHJpYnV0ZUNvbmZpZyA/IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnfSkgOiBcIkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVwiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcm1pdHRlZCBwYXJhbXMgZm9yIGdlbmVyYXRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IHJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIn0gYWN0aW9uIC0gV3JpdGUgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEdlbmVyYXRvclBlcm1pdFNwZWN9IC0gUGVybWl0dGVkIHBhcmFtcyBzcGVjLlxuICAgKi9cbiAgcGVybWl0dGVkUGFyYW1zRm9yR2VuZXJhdG9yKHJlc291cmNlQ2xhc3MsIGFjdGlvbikge1xuICAgIGlmICghcmVzb3VyY2VDbGFzcykgcmV0dXJuIFtdXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG5cbiAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IHJlc291cmNlQ2xhc3Moe1xuICAgICAgICBhYmlsaXR5OiB1bmRlZmluZWQsXG4gICAgICAgIGNvbnRleHQ6IHt9LFxuICAgICAgICBsb2NhbHM6IHt9LFxuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBtb2RlbE5hbWU6IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIHBhcmFtczoge30sXG4gICAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259ICovICh7YXR0cmlidXRlczogW119KVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHNwZWMgPSBpbnN0YW5jZS5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbiwgYWJpbGl0eTogdW5kZWZpbmVkLCBsb2NhbHM6IHt9LCBwYXJhbXM6IHt9fSlcblxuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoc3BlYykgPyBzcGVjIDogW11cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gaW52b2tlICR7cmVzb3VyY2VDbGFzcy5uYW1lfS5wZXJtaXR0ZWRQYXJhbXMoKSB3aGlsZSBnZW5lcmF0aW5nIGZyb250ZW5kIG1vZGVsIHdyaXRlIHR5cGVzOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW52b2tlcyBhIGJhY2tlbmQgcmVzb3VyY2UncyBgcGVybWl0dGVkUGFyYW1zKClgIGluc3RhbmNlIG1ldGhvZCBhdFxuICAgKiBnZW5lcmF0aW9uIHRpbWUgYW5kIGV4dHJhY3RzIHRoZSByZWxhdGlvbnNoaXAgbmFtZXMgdGhhdCBhY2NlcHRcbiAgICogbmVzdGVkIHdyaXRlcyAoYHtmb29BdHRyaWJ1dGVzOiBbLi4uXX1gIGVudHJpZXMpLiBUaGUgZ2VuZXJhdG9yXG4gICAqIGVtaXRzIHRob3NlIG5hbWVzIGludG8gdGhlIGZyb250ZW5kIG1vZGVsJ3MgYHJlc291cmNlQ29uZmlnKClgIHNvXG4gICAqIHRoZSBjbGllbnQgYHNhdmUoKWAgd2Fsa2VyIGtub3dzIHdoaWNoIHJlbGF0aW9uc2hpcHMgdG8gc2hpcC5cbiAgICpcbiAgICogQ29uc3RydWN0ZWQgd2l0aCBubyBjb250cm9sbGVyL2FiaWxpdHkgc28gcmVzb3VyY2Ugb3ZlcnJpZGVzIG11c3RcbiAgICogc3VwcG9ydCBiZWluZyBjYWxsZWQgd2l0aG91dCBhIHJlcXVlc3QgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IHJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFJlbGF0aW9uc2hpcCBuYW1lcyB0aGF0IGFjY2VwdCBuZXN0ZWQgd3JpdGVzIChlbXB0eSB3aGVuIG5vbmUpLlxuICAgKi9cbiAgbmVzdGVkUmVsYXRpb25zaGlwTmFtZXNGb3JHZW5lcmF0b3IocmVzb3VyY2VDbGFzcykge1xuICAgIGlmICghcmVzb3VyY2VDbGFzcykgcmV0dXJuIFtdXG5cbiAgICBsZXQgc3BlY1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuXG4gICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyByZXNvdXJjZUNsYXNzKHtcbiAgICAgICAgYWJpbGl0eTogdW5kZWZpbmVkLFxuICAgICAgICBjb250ZXh0OiB7fSxcbiAgICAgICAgbG9jYWxzOiB7fSxcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgbW9kZWxOYW1lOiBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICBwYXJhbXM6IHt9LFxuICAgICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqLyAoe2F0dHJpYnV0ZXM6IFtdfSlcbiAgICAgIH0pXG4gICAgICBzcGVjID0gaW5zdGFuY2UucGVybWl0dGVkUGFyYW1zKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gaW52b2tlICR7cmVzb3VyY2VDbGFzcy5uYW1lfS5wZXJtaXR0ZWRQYXJhbXMoKSB3aGlsZSBnZW5lcmF0aW5nIGZyb250ZW5kIG1vZGVsczogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNwZWMpKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIFJlbGF0aW9uc2hpcCBuYW1lcy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzcGVjKSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5KSkgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZW50cnkpKSB7XG4gICAgICAgIGlmICgha2V5LmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkgY29udGludWVcbiAgICAgICAgY29uc3QgbmFtZSA9IGtleS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuICAgICAgICBpZiAobmFtZSkgcmVsYXRpb25zaGlwTmFtZXMucHVzaChuYW1lKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBOYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIGFycmF5IHByb3BlcnR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZvcm1hdHRpbmcgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW5kZW50IC0gQmFzZSBpbmRlbnRhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvcGVydHlOYW1lIC0gT2JqZWN0IHByb3BlcnR5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MudmFsdWVzIC0gU3RyaW5nIHZhbHVlcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgbXVsdGlsaW5lIGFycmF5IHByb3BlcnR5LlxuICAgKi9cbiAgZm9ybWF0dGVkQXJyYXlQcm9wZXJ0eSh7aW5kZW50LCBwcm9wZXJ0eU5hbWUsIHZhbHVlc30pIHtcbiAgICBsZXQgb3V0cHV0ID0gYCR7aW5kZW50fSR7cHJvcGVydHlOYW1lfTogW1xcbmBcblxuICAgIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB7XG4gICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fSAgJHtKU09OLnN0cmluZ2lmeSh2YWx1ZSl9LFxcbmBcbiAgICB9XG5cbiAgICBvdXRwdXQgKz0gYCR7aW5kZW50fV0sXFxuYFxuXG4gICAgcmV0dXJuIG91dHB1dFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIGNvbW1hbmRzIHByb3BlcnR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZvcm1hdHRpbmcgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW5kZW50IC0gQmFzZSBpbmRlbnRhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvcGVydHlOYW1lIC0gT2JqZWN0IHByb3BlcnR5IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gYXJncy52YWx1ZXMgLSBDb21tYW5kIGtleS12YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRm9ybWF0dGVkIG11bHRpbGluZSBhcnJheSBwcm9wZXJ0eS4gQWx3YXlzIGVtaXRzXG4gICAqICAgdGhlIGNhbWVsQ2FzZSBtZXRob2QtbmFtZSBhcnJheSBmb3JtIChgbWVtYmVyQ29tbWFuZHM6IFtcInVwZGF0ZUFjY2Vzc1wiXWApXG4gICAqICAgc28gdGhlIGdlbmVyYXRlZCBjb25maWcgbWF0Y2hlcyB0aGUgY2Fub25pY2FsXG4gICAqICAgYEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZy57Y29sbGVjdGlvbixtZW1iZXJ9Q29tbWFuZHM6IHN0cmluZ1tdYFxuICAgKiAgIHNoYXBlLiBUaGUgcnVudGltZSBkZXJpdmVzIHRoZSBjb21tYW5kIHNsdWcgZnJvbSB0aGUgY2FtZWxDYXNlXG4gICAqICAgbWV0aG9kIG5hbWU7IGNvbnN1bWVycyBuZXZlciBuZWVkIHRvIHdyaXRlIG91dFxuICAgKiAgIGB7dXBkYXRlQWNjZXNzOiBcInVwZGF0ZS1hY2Nlc3NcIn1gIGJ5IGhhbmQuXG4gICAqL1xuICBmb3JtYXR0ZWRDb21tYW5kc1Byb3BlcnR5KHtpbmRlbnQsIHByb3BlcnR5TmFtZSwgdmFsdWVzfSkge1xuICAgIHJldHVybiB0aGlzLmZvcm1hdHRlZEFycmF5UHJvcGVydHkoe2luZGVudCwgcHJvcGVydHlOYW1lLCB2YWx1ZXM6IE9iamVjdC5rZXlzKHZhbHVlcyl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIG9iamVjdCBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGb3JtYXR0aW5nIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmluZGVudCAtIEJhc2UgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb3BlcnR5TmFtZSAtIE9iamVjdCBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IGFyZ3MudmFsdWVzIC0gT2JqZWN0IGtleS12YWx1ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gW2FyZ3MuZmlsdGVyRGVmYXVsdFZhbHVlc10gLSBEZWZhdWx0IHZhbHVlcyB0byBvbWl0IGZyb20gb3V0cHV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBtdWx0aWxpbmUgb2JqZWN0IHByb3BlcnR5LlxuICAgKi9cbiAgZm9ybWF0dGVkT2JqZWN0UHJvcGVydHkoe2ZpbHRlckRlZmF1bHRWYWx1ZXMsIGluZGVudCwgcHJvcGVydHlOYW1lLCB2YWx1ZXN9KSB7XG4gICAgbGV0IG91dHB1dCA9IGAke2luZGVudH0ke3Byb3BlcnR5TmFtZX06IHtcXG5gXG5cbiAgICBmb3IgKGNvbnN0IG9iamVjdEtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZXMpKSB7XG4gICAgICBpZiAoZmlsdGVyRGVmYXVsdFZhbHVlcyAmJiBmaWx0ZXJEZWZhdWx0VmFsdWVzW29iamVjdEtleV0gPT09IHZhbHVlc1tvYmplY3RLZXldKSBjb250aW51ZVxuXG4gICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fSAgJHtvYmplY3RLZXl9OiAke0pTT04uc3RyaW5naWZ5KHZhbHVlc1tvYmplY3RLZXldKX0sXFxuYFxuICAgIH1cblxuICAgIG91dHB1dCArPSBgJHtpbmRlbnR9fSxcXG5gXG5cbiAgICByZXR1cm4gb3V0cHV0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JtYXR0ZWQgSlNPTiBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGb3JtYXR0aW5nIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmluZGVudCAtIEJhc2UgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb3BlcnR5TmFtZSAtIE9iamVjdCBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGFyZ3MudmFsdWUgLSBKU09OLWNvbXBhdGlibGUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRm9ybWF0dGVkIHByb3BlcnR5LlxuICAgKi9cbiAgZm9ybWF0dGVkSnNvblByb3BlcnR5KHtpbmRlbnQsIHByb3BlcnR5TmFtZSwgdmFsdWV9KSB7XG4gICAgcmV0dXJuIGAke2luZGVudH0ke3Byb3BlcnR5TmFtZX06ICR7dGhpcy5mb3JtYXR0ZWRKc29uVmFsdWUoe2luZGVudCwgdmFsdWV9KX0sXFxuYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIEpTT04gdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRm9ybWF0dGluZyBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbmRlbnQgLSBJbmRlbnRhdGlvbiBiZWZvcmUgdGhpcyB2YWx1ZS5cbiAgICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnZhbHVlIC0gSlNPTi1jb21wYXRpYmxlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCB2YWx1ZS5cbiAgICovXG4gIGZvcm1hdHRlZEpzb25WYWx1ZSh7aW5kZW50LCB2YWx1ZX0pIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGxldCBvdXRwdXQgPSBcIltcXG5cIlxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHZhbHVlKSB7XG4gICAgICAgIG91dHB1dCArPSBgJHtpbmRlbnR9ICAke3RoaXMuZm9ybWF0dGVkSnNvblZhbHVlKHtpbmRlbnQ6IGAke2luZGVudH0gIGAsIHZhbHVlOiBlbnRyeX0pfSxcXG5gXG4gICAgICB9XG5cbiAgICAgIG91dHB1dCArPSBgJHtpbmRlbnR9XWBcblxuICAgICAgcmV0dXJuIG91dHB1dFxuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGxldCBvdXRwdXQgPSBcIntcXG5cIlxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZSkpIHtcbiAgICAgICAgb3V0cHV0ICs9IGAke2luZGVudH0gICR7dGhpcy5mb3JtYXR0ZWRPYmplY3RLZXkoa2V5KX06ICR7dGhpcy5mb3JtYXR0ZWRKc29uVmFsdWUoe2luZGVudDogYCR7aW5kZW50fSAgYCwgdmFsdWU6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh2YWx1ZSlba2V5XX0pfSxcXG5gXG4gICAgICB9XG5cbiAgICAgIG91dHB1dCArPSBgJHtpbmRlbnR9fWBcblxuICAgICAgcmV0dXJuIG91dHB1dFxuICAgIH1cblxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBvYmplY3Qga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gT2JqZWN0IGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBKYXZhU2NyaXB0IG9iamVjdCBrZXkuXG4gICAqL1xuICBmb3JtYXR0ZWRPYmplY3RLZXkoa2V5KSB7XG4gICAgcmV0dXJuIC9eW0EtWmEtel8kXVtcXHckXSokLy50ZXN0KGtleSkgPyBrZXkgOiBKU09OLnN0cmluZ2lmeShrZXkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRyaWJ1dGUgZGVmaW5pdGlvbnMgZm9yIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5tb2RlbENvbmZpZyAtIE1vZGVsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSBbYXJncy5yZXNvdXJjZUNsYXNzXSAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7anNEb2NUeXBlOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgd3JpdGVKc0RvY1R5cGU6IHN0cmluZ30+Pn0gLSBBdHRyaWJ1dGUgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBhc3luYyBhdHRyaWJ1dGVEZWZpbml0aW9uc0Zvck1vZGVsKHtjbGFzc05hbWUsIG1vZGVsQ2xhc3MsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGxldCBhdHRyaWJ1dGVzID0gbW9kZWxDb25maWcuYXR0cmlidXRlc1xuXG4gICAgLy8gQXV0by1kZXJpdmUgYXR0cmlidXRlcyBmcm9tIG1vZGVsIGNvbHVtbnMgd2hlbiBub3QgZXhwbGljaXRseSBkZWZpbmVkXG4gICAgaWYgKCghYXR0cmlidXRlcyB8fCAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSAmJiBhdHRyaWJ1dGVzLmxlbmd0aCA9PT0gMCkpICYmIG1vZGVsQ2xhc3MpIHtcbiAgICAgIGNvbnN0IGNvbHVtbnMgPSBtb2RlbENsYXNzLmdldENvbHVtbnMoKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShjb2x1bW5zKSkge1xuICAgICAgICBhdHRyaWJ1dGVzID0gY29sdW1ucy5tYXAoKGNvbHVtbikgPT4gaW5mbGVjdGlvbi5jYW1lbGl6ZShjb2x1bW4uZ2V0TmFtZSgpLCB0cnVlKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgYXR0cmlidXRlRGVmaW5pdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZURlZmluaXRpb24gb2YgYXR0cmlidXRlcykge1xuICAgICAgICAvKiogQHR5cGUge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbH0gKi9cbiAgICAgICAgbGV0IGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcgPSBudWxsXG4gICAgICAgIGxldCBhdHRyaWJ1dGVOYW1lXG5cbiAgICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVEZWZpbml0aW9uID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lID0gYXR0cmlidXRlRGVmaW5pdGlvblxuICAgICAgICB9IGVsc2UgaWYgKGF0dHJpYnV0ZURlZmluaXRpb24gJiYgdHlwZW9mIGF0dHJpYnV0ZURlZmluaXRpb24gPT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVEZWZpbml0aW9uKSkge1xuICAgICAgICAgIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcgPSAvKiogQHR5cGUge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnfSAqLyAoYXR0cmlidXRlRGVmaW5pdGlvbilcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lID0gY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZy5uYW1lXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZU5hbWUgIT0gXCJzdHJpbmdcIiB8fCBhdHRyaWJ1dGVOYW1lLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBhcnJheSBlbnRyaWVzIHRvIGJlIHN0cmluZ3Mgb3Igb2JqZWN0cyB3aXRoIGEgbmFtZSwgZ290OiAke0pTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZURlZmluaXRpb24pfWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdHRyaWJ1dGVDb25maWcgPSBhd2FpdCB0aGlzLnJlc29sdmVkRnJvbnRlbmRBdHRyaWJ1dGVDb25maWcoe1xuICAgICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcsXG4gICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICByZXNvdXJjZUNsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29uc3QgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgPSB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yR2VuZXJhdGVkQXR0cmlidXRlKHtcbiAgICAgICAgICBhdHRyaWJ1dGVDb25maWcsXG4gICAgICAgICAgYXR0cmlidXRlTmFtZSxcbiAgICAgICAgICBtb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXR0cmlidXRlRGVmaW5pdGlvbnMucHVzaCh7XG4gICAgICAgICAganNEb2NUeXBlOiB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWc6IGZyb250ZW5kQXR0cmlidXRlQ29uZmlnfSksXG4gICAgICAgICAgbmFtZTogYXR0cmlidXRlTmFtZSxcbiAgICAgICAgICB3cml0ZUpzRG9jVHlwZTogdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZFdyaXRlQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWc6IGZyb250ZW5kQXR0cmlidXRlQ29uZmlnfSlcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZURlZmluaXRpb25zXG4gICAgfVxuXG4gICAgaWYgKCFhdHRyaWJ1dGVzIHx8IHR5cGVvZiBhdHRyaWJ1dGVzICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICdhdHRyaWJ1dGVzJyBhcyBhcnJheSBvciBvYmplY3QgYnV0IGdvdDogJHthdHRyaWJ1dGVzfWApXG4gICAgfVxuXG4gICAgY29uc3QgYXR0cmlidXRlRGVmaW5pdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVDb25maWcgPSBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgICBjb25zdCBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnID0gYXR0cmlidXRlQ29uZmlnICYmIHR5cGVvZiBhdHRyaWJ1dGVDb25maWcgPT09IFwib2JqZWN0XCJcbiAgICAgICAgPyAvKiogQHR5cGUge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnfSAqLyAoYXR0cmlidXRlQ29uZmlnKVxuICAgICAgICA6IG51bGxcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVDb25maWcgPSBhd2FpdCB0aGlzLnJlc29sdmVkRnJvbnRlbmRBdHRyaWJ1dGVDb25maWcoe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcsXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIHJlc291cmNlQ2xhc3NcbiAgICAgIH0pXG4gICAgICBjb25zdCBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyA9IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JHZW5lcmF0ZWRBdHRyaWJ1dGUoe1xuICAgICAgICBhdHRyaWJ1dGVDb25maWc6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVDb25maWcsXG4gICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIG1vZGVsQ2xhc3NcbiAgICAgIH0pXG5cbiAgICAgIGF0dHJpYnV0ZURlZmluaXRpb25zLnB1c2goe1xuICAgICAgICBqc0RvY1R5cGU6IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZzogZnJvbnRlbmRBdHRyaWJ1dGVDb25maWd9KSxcbiAgICAgICAgbmFtZTogYXR0cmlidXRlTmFtZSxcbiAgICAgICAgd3JpdGVKc0RvY1R5cGU6IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnOiBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30pXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVEZWZpbml0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgZ2VuZXJhdGVkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlQ29uZmlnOiBGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZywgYXR0cmlidXRlTmFtZTogc3RyaW5nLCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWd9IC0gQXR0cmlidXRlIGNvbmZpZyB1c2VkIGZvciBnZW5lcmF0ZWQgSlNEb2MuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckdlbmVyYXRlZEF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnLCBhdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGlmICghdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUlzTW9kZWxQcmltYXJ5S2V5KHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkpIHJldHVybiBhdHRyaWJ1dGVDb25maWdcbiAgICBpZiAodGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0hhc051bGxhYmlsaXR5KGF0dHJpYnV0ZUNvbmZpZykpIHJldHVybiBhdHRyaWJ1dGVDb25maWdcblxuICAgIHJldHVybiB7Li4uYXR0cmlidXRlQ29uZmlnLCBudWxsOiBmYWxzZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBpcyBtb2RlbCBwcmltYXJ5IGtleS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZTogc3RyaW5nLCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgaXMgdGhlIG1vZGVsIHByaW1hcnkga2V5LlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVJc01vZGVsUHJpbWFyeUtleSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICBpZiAodHlwZW9mIHByaW1hcnlLZXkgIT0gXCJzdHJpbmdcIiB8fCBwcmltYXJ5S2V5Lmxlbmd0aCA8IDEpIHJldHVybiBmYWxzZVxuICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBwcmltYXJ5S2V5KSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUocHJpbWFyeUtleSkgPT09IGF0dHJpYnV0ZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgcHJpbWFyeSBrZXkgZnJvbSBleHBsaWNpdCByZXNvdXJjZSBjb25maWcgb3IgdGhlIGJhY2tlbmQgbW9kZWwuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWVzOiBBcnJheTxzdHJpbmc+LCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIG1vZGVsQ29uZmlnOiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufX0gYXJncyAtIFByaW1hcnkga2V5IHJlc29sdXRpb24gYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IEFycmF5PHN0cmluZz59IC0gRnJvbnRlbmQtbW9kZWwgcHJpbWFyeSBrZXkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUHJpbWFyeUtleUZvclJlc291cmNlKHthdHRyaWJ1dGVOYW1lcywgbW9kZWxDbGFzcywgbW9kZWxDb25maWd9KSB7XG4gICAgaWYgKG1vZGVsQ29uZmlnLnByaW1hcnlLZXkpIHtcbiAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlZENvbmZpZ3VyZWRQcmltYXJ5S2V5KHthdHRyaWJ1dGVOYW1lcywgcHJpbWFyeUtleTogbW9kZWxDb25maWcucHJpbWFyeUtleX0pXG4gICAgfVxuXG4gICAgaWYgKCFtb2RlbENsYXNzKSByZXR1cm4gXCJpZFwiXG5cbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleUZvck1vZGVsQ2xhc3Moe2F0dHJpYnV0ZU5hbWVzLCBtb2RlbENsYXNzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYW4gZXhwbGljaXRseSBjb25maWd1cmVkIGZyb250ZW5kLW1vZGVsIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lczogQXJyYXk8c3RyaW5nPiwgcHJpbWFyeUtleTogc3RyaW5nfX0gYXJncyAtIENvbmZpZ3VyZWQgcHJpbWFyeSBrZXkgYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb25maWd1cmVkIHByaW1hcnkga2V5LlxuICAgKi9cbiAgdmFsaWRhdGVkQ29uZmlndXJlZFByaW1hcnlLZXkoe2F0dHJpYnV0ZU5hbWVzLCBwcmltYXJ5S2V5fSkge1xuICAgIGlmIChhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhwcmltYXJ5S2V5KSkgcmV0dXJuIHByaW1hcnlLZXlcblxuICAgIHRocm93IG5ldyBFcnJvcihgQ29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBwcmltYXJ5IGtleSBcIiR7cHJpbWFyeUtleX1cIiBpcyBub3QgYSBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlLmApXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGJhY2tlbmQgcHJpbWFyeSBrZXkgdG8gZ2VuZXJhdGVkIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZXM6IEFycmF5PHN0cmluZz4sIG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19IGFyZ3MgLSBQcmltYXJ5IGtleSByZXNvbHV0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBBcnJheTxzdHJpbmc+fSAtIEZyb250ZW5kLW1vZGVsIHByaW1hcnkga2V5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlGb3JNb2RlbENsYXNzKHthdHRyaWJ1dGVOYW1lcywgbW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gbW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIGlmIChwcmltYXJ5S2V5ID09PSBcImlkXCIpIHJldHVybiBcImlkXCJcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSB7XG4gICAgICByZXR1cm4gcHJpbWFyeUtleS5tYXAoKGNvbHVtbk5hbWUpID0+IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlBdHRyaWJ1dGVOYW1lKHthdHRyaWJ1dGVOYW1lcywgY29sdW1uTmFtZSwgbW9kZWxDbGFzc30pKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5QXR0cmlidXRlTmFtZSh7YXR0cmlidXRlTmFtZXMsIGNvbHVtbk5hbWU6IHByaW1hcnlLZXksIG1vZGVsQ2xhc3N9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uZSBiYWNrZW5kIHByaW1hcnkga2V5IGNvbHVtbiB0byBhIGdlbmVyYXRlZCBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZXM6IEFycmF5PHN0cmluZz4sIGNvbHVtbk5hbWU6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIFByaW1hcnkga2V5IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnJvbnRlbmQtbW9kZWwgcHJpbWFyeSBrZXkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUHJpbWFyeUtleUF0dHJpYnV0ZU5hbWUoe2F0dHJpYnV0ZU5hbWVzLCBjb2x1bW5OYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGlmIChhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhjb2x1bW5OYW1lKSkgcmV0dXJuIGNvbHVtbk5hbWVcblxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZSAmJiBhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxDbGFzcy5uYW1lfS5wcmltYXJ5S2V5KCkgY29sdW1uIFwiJHtjb2x1bW5OYW1lfVwiIGRvZXMgbm90IHJlc29sdmUgdG8gYSBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlLmApXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmcm9tIGV4cGxpY2l0IG1ldGFkYXRhLCByZXNvdXJjZSBtZXRob2RzLCBtb2RlbCBjb2x1bW5zLCB0cmFuc2xhdGVkIGNvbHVtbnMsIG9yIG1vZGVsIGFjY2Vzc29yIEpTRG9jLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbH0gYXJncy5jb25maWd1cmVkQXR0cmlidXRlQ29uZmlnIC0gUmVzb3VyY2UtcHJvdmlkZWQgYXR0cmlidXRlIGNvbmZpZy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRBdHRyaWJ1dGVDb25maWc+fSAtIFJlc29sdmVkIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcuXG4gICAqL1xuICBhc3luYyByZXNvbHZlZEZyb250ZW5kQXR0cmlidXRlQ29uZmlnKHthdHRyaWJ1dGVOYW1lLCBjbGFzc05hbWUsIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcsIG1vZGVsQ2xhc3MsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgY29uc3QgaW5mZXJyZWRSZXNvdXJjZUNvbmZpZyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JSZXNvdXJjZUF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZSwgcmVzb3VyY2VDbGFzc30pXG4gICAgY29uc3QgaW5mZXJyZWRDb2x1bW5Db25maWcgPSBpbmZlcnJlZFJlc291cmNlQ29uZmlnXG4gICAgICA/IG51bGxcbiAgICAgIDogdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0Zvck1vZGVsQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSlcbiAgICBjb25zdCBpbmZlcnJlZFRyYW5zbGF0ZWRDb25maWcgPSBpbmZlcnJlZFJlc291cmNlQ29uZmlnIHx8IGluZmVycmVkQ29sdW1uQ29uZmlnXG4gICAgICA/IG51bGxcbiAgICAgIDogdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvclRyYW5zbGF0ZWRBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIHJlc291cmNlQ2xhc3N9KVxuICAgIGNvbnN0IGluZmVycmVkTW9kZWxBY2Nlc3NvckNvbmZpZyA9IGluZmVycmVkUmVzb3VyY2VDb25maWcgfHwgaW5mZXJyZWRDb2x1bW5Db25maWcgfHwgaW5mZXJyZWRUcmFuc2xhdGVkQ29uZmlnXG4gICAgICA/IG51bGxcbiAgICAgIDogYXdhaXQgdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0Zvck1vZGVsQWNjZXNzb3Ioe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KVxuICAgIGNvbnN0IGluZmVycmVkQ29uZmlnID0gaW5mZXJyZWRSZXNvdXJjZUNvbmZpZyB8fCBpbmZlcnJlZENvbHVtbkNvbmZpZyB8fCBpbmZlcnJlZFRyYW5zbGF0ZWRDb25maWcgfHwgaW5mZXJyZWRNb2RlbEFjY2Vzc29yQ29uZmlnXG5cbiAgICBpZiAoY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZyAmJiB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnSGFzVHlwZShjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnKSkge1xuICAgICAgcmV0dXJuIGluZmVycmVkQ29uZmlnXG4gICAgICAgID8gey4uLmluZmVycmVkQ29uZmlnLCAuLi5jb25maWd1cmVkQXR0cmlidXRlQ29uZmlnfVxuICAgICAgICA6IGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWdcbiAgICB9XG5cbiAgICBpZiAoaW5mZXJyZWRDb25maWcpIHtcbiAgICAgIHJldHVybiBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnXG4gICAgICAgID8gey4uLmluZmVycmVkQ29uZmlnLCAuLi5jb25maWd1cmVkQXR0cmlidXRlQ29uZmlnfVxuICAgICAgICA6IGluZmVycmVkQ29uZmlnXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgaW5mZXIgSlNEb2MgdHlwZSBmb3IgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlICcke2NsYXNzTmFtZX0jJHthdHRyaWJ1dGVOYW1lfScuIEFkZCBhIGJhY2tlbmQgbW9kZWwgY29sdW1uLCB0cmFuc2xhdGlvbiB0YWJsZSBjb2x1bW4sIGV4cGxpY2l0IHJlc291cmNlIG1ldGFkYXRhLCBvciBhIEByZXR1cm5zIEpTRG9jIHR5cGUgb24gJHtyZXNvdXJjZUNsYXNzPy5uYW1lIHx8IFwidGhlIHJlc291cmNlXCJ9LiR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGUoKS5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBoYXMgdHlwZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbmZpZyBkZWNsYXJlcyBhIHR5cGUgc291cmNlLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdIYXNUeXBlKGF0dHJpYnV0ZUNvbmZpZykge1xuICAgIHJldHVybiB0eXBlb2YgdGhpcy5mcm9udGVuZEF0dHJpYnV0ZVR5cGVWYWx1ZShhdHRyaWJ1dGVDb25maWcpID09IFwic3RyaW5nXCJcbiAgICAgIHx8IHR5cGVvZiBhdHRyaWJ1dGVDb25maWc/LmpzRG9jVHlwZSA9PSBcInN0cmluZ1wiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGhhcyBudWxsYWJpbGl0eS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbmZpZyBkZWNsYXJlcyBudWxsYWJpbGl0eS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnSGFzTnVsbGFiaWxpdHkoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChhdHRyaWJ1dGVDb25maWcsIFwibnVsbFwiKSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0eXBlb2YgYXR0cmlidXRlQ29uZmlnLmdldE51bGwgPT0gXCJmdW5jdGlvblwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgdHlwZSBmb3IgZnJvbnRlbmQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSlNEb2MgdHlwZS5cbiAgICovXG4gIGpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWd9KSB7XG4gICAgaWYgKGF0dHJpYnV0ZUNvbmZpZyAmJiB0eXBlb2YgYXR0cmlidXRlQ29uZmlnLmpzRG9jVHlwZSA9PSBcInN0cmluZ1wiICYmIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGUubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGVcbiAgICB9XG5cbiAgICBjb25zdCBqc0RvY1R5cGUgPSB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKVxuXG4gICAgaWYgKCF0aGlzLmZyb250ZW5kQXR0cmlidXRlQ2FuQmVOdWxsKGF0dHJpYnV0ZUNvbmZpZykpIHtcbiAgICAgIHJldHVybiBqc0RvY1R5cGVcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7anNEb2NUeXBlfSB8IG51bGxgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgdHlwZSBmb3IgZnJvbnRlbmQgd3JpdGUgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSlNEb2MgdHlwZSBhY2NlcHRlZCBieSBjcmVhdGUvdXBkYXRlIHBheWxvYWRzLlxuICAgKi9cbiAganNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnfSkge1xuICAgIGlmIChhdHRyaWJ1dGVDb25maWcgJiYgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGUgPT0gXCJzdHJpbmdcIiAmJiBhdHRyaWJ1dGVDb25maWcuanNEb2NUeXBlLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVDb25maWcuanNEb2NUeXBlXG4gICAgfVxuXG4gICAgY29uc3QganNEb2NUeXBlID0gdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZFdyaXRlQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKVxuXG4gICAgaWYgKCF0aGlzLmZyb250ZW5kQXR0cmlidXRlQ2FuQmVOdWxsKGF0dHJpYnV0ZUNvbmZpZykpIHtcbiAgICAgIHJldHVybiBqc0RvY1R5cGVcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7anNEb2NUeXBlfSB8IG51bGxgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgdHlwZSBmb3IgZnJvbnRlbmQgd3JpdGUgYXR0cmlidXRlIGJhc2UgdHlwZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vbi1udWxsYWJsZSBKU0RvYyB0eXBlIGFjY2VwdGVkIGJ5IGNyZWF0ZS91cGRhdGUgcGF5bG9hZHMuXG4gICAqL1xuICBqc0RvY1R5cGVGb3JGcm9udGVuZFdyaXRlQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgY29uc3QgcmVhZFR5cGUgPSB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKVxuXG4gICAgaWYgKCF0aGlzLmZyb250ZW5kQXR0cmlidXRlVHlwZUlzVGVtcG9yYWwoYXR0cmlidXRlQ29uZmlnKSkgcmV0dXJuIHJlYWRUeXBlXG5cbiAgICByZXR1cm4gYCR7cmVhZFR5cGV9IHwgc3RyaW5nYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHR5cGUgZm9yIGZyb250ZW5kIGF0dHJpYnV0ZSBiYXNlIHR5cGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBOb24tbnVsbGFibGUgSlNEb2MgdHlwZS5cbiAgICovXG4gIGpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCJcbiAgICB9XG5cbiAgICBjb25zdCB0eXBlID0gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZVR5cGVWYWx1ZShhdHRyaWJ1dGVDb25maWcpXG5cbiAgICBpZiAodHlwZSA9PSBcImJvb2xlYW5cIikge1xuICAgICAgcmV0dXJuIFwiYm9vbGVhblwiXG4gICAgfSBlbHNlIGlmICh0eXBlID09IFwianNvblwiIHx8IHR5cGUgPT0gXCJqc29uYlwiKSB7XG4gICAgICByZXR1cm4gXCJGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcIlxuICAgIH0gZWxzZSBpZiAodHlwZSAmJiBbXCJibG9iXCIsIFwiY2hhclwiLCBcIm52YXJjaGFyXCIsIFwidmFyY2hhclwiLCBcInRleHRcIiwgXCJsb25ndGV4dFwiLCBcIm1lZGl1bXRleHRcIiwgXCJ0aW55dGV4dFwiLCBcInV1aWRcIiwgXCJjaGFyYWN0ZXIgdmFyeWluZ1wiXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgcmV0dXJuIFwic3RyaW5nXCJcbiAgICB9IGVsc2UgaWYgKHR5cGUgJiYgW1wiYml0XCIsIFwiYmlnaW50XCIsIFwiZGVjaW1hbFwiLCBcImRvdWJsZVwiLCBcImRvdWJsZSBwcmVjaXNpb25cIiwgXCJmbG9hdFwiLCBcImludFwiLCBcImludGVnZXJcIiwgXCJudW1lcmljXCIsIFwicmVhbFwiLCBcInNtYWxsaW50XCIsIFwidGlueWludFwiXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgcmV0dXJuIFwibnVtYmVyXCJcbiAgICB9IGVsc2UgaWYgKHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVUeXBlSXNUZW1wb3JhbChhdHRyaWJ1dGVDb25maWcpKSB7XG4gICAgICByZXR1cm4gXCJEYXRlXCJcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgdHlwZSBpcyB0ZW1wb3JhbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgcmVwcmVzZW50cyBhIGRhdGUvdGltZSB2YWx1ZS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlVHlwZUlzVGVtcG9yYWwoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCB0eXBlID0gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZVR5cGVWYWx1ZShhdHRyaWJ1dGVDb25maWcpXG5cbiAgICByZXR1cm4gdHlwZSA/IFtcImRhdGVcIiwgXCJkYXRldGltZVwiLCBcInRpbWVzdGFtcFwiLCBcInRpbWVzdGFtcCB3aXRob3V0IHRpbWUgem9uZVwiLCBcInRpbWVzdGFtcHR6XCJdLmluY2x1ZGVzKHR5cGUpIDogZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjYW4gYmUgbnVsbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgYWxsb3dzIG51bGwgdmFsdWVzLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDYW5CZU51bGwoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVDb25maWcuZ2V0TnVsbCA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVDb25maWcuZ2V0TnVsbCgpID09PSB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZUNvbmZpZy5udWxsID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgdHlwZSB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBOb3JtYWxpemVkIGNvbHVtbiB0eXBlLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVUeXBlVmFsdWUoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5nZXRUeXBlID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIFN0cmluZyhhdHRyaWJ1dGVDb25maWcuZ2V0VHlwZSgpKVxuICAgIH1cblxuICAgIGNvbnN0IHR5cGVWYWx1ZSA9IGF0dHJpYnV0ZUNvbmZpZy50eXBlIHx8IGF0dHJpYnV0ZUNvbmZpZy5jb2x1bW5UeXBlIHx8IGF0dHJpYnV0ZUNvbmZpZy5zcWxUeXBlIHx8IGF0dHJpYnV0ZUNvbmZpZy5kYXRhVHlwZVxuXG4gICAgaWYgKHR5cGVvZiB0eXBlVmFsdWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIHR5cGVWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgcmVzb3VyY2UgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5yZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbD59IC0gQXR0cmlidXRlIGNvbmZpZyBpbmZlcnJlZCBmcm9tIHJlc291cmNlIG1ldGhvZCBKU0RvYy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yUmVzb3VyY2VBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgbWV0aG9kTmFtZSA9IGAke2F0dHJpYnV0ZU5hbWV9QXR0cmlidXRlYFxuICAgIGNvbnN0IG93bmVyQ2xhc3NOYW1lID0gdGhpcy5tZXRob2RPd25lckNsYXNzTmFtZSh7bWV0aG9kTmFtZSwgdGFyZ2V0Q2xhc3M6IHJlc291cmNlQ2xhc3N9KVxuXG4gICAgaWYgKCFvd25lckNsYXNzTmFtZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGpzRG9jVHlwZSA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlKHtcbiAgICAgIG1ldGhvZE5hbWUsXG4gICAgICBzb3VyY2VDbGFzc05hbWU6IG93bmVyQ2xhc3NOYW1lXG4gICAgfSlcblxuICAgIHJldHVybiBqc0RvY1R5cGUgPyB7anNEb2NUeXBlOiB0aGlzLnVud3JhcHBlZFByb21pc2VKc0RvY1R5cGUoe2pzRG9jVHlwZX0pfSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIHRyYW5zbGF0ZWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MucmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsfSAtIEF0dHJpYnV0ZSBjb25maWcgaW5mZXJyZWQgZnJvbSB0cmFuc2xhdGVkIGF0dHJpYnV0ZSBjb2x1bW5zLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JUcmFuc2xhdGVkQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGlmICghbW9kZWxDbGFzcykgcmV0dXJuIG51bGxcbiAgICBpZiAoIXRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVJc1RyYW5zbGF0ZWQoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIHJlc291cmNlQ2xhc3N9KSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSBtb2RlbENsYXNzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoYXR0cmlidXRlTmFtZSlcblxuICAgIGxldCBjb2x1bW5cblxuICAgIHRyeSB7XG4gICAgICBjb2x1bW4gPSBUcmFuc2xhdGlvbkNsYXNzLmdldENvbHVtbnNIYXNoKClbY29sdW1uTmFtZV1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgKGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJoYXNuJ3QgYmVlbiBpbml0aWFsaXplZCB5ZXRcIikgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhcInVzZWQgYmVmb3JlIGluaXRpYWxpemF0aW9uXCIpKSkgcmV0dXJuIG51bGxcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gY29sdW1uID8gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckNvbHVtbih7Y29sdW1ufSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgaXMgdHJhbnNsYXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZnJvbnRlbmQgYXR0cmlidXRlIGlzIHRyYW5zbGF0ZWQuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUlzVHJhbnNsYXRlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBpZiAocmVzb3VyY2VDbGFzcykge1xuICAgICAgY29uc3QgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSByZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodHJhbnNsYXRlZEF0dHJpYnV0ZXMpICYmIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zbGF0aW9ucyA9IG1vZGVsQ2xhc3MuX3RyYW5zbGF0aW9uc1xuXG4gICAgcmV0dXJuIEJvb2xlYW4odHJhbnNsYXRpb25zICYmIHR5cGVvZiB0cmFuc2xhdGlvbnMgPT0gXCJvYmplY3RcIiAmJiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodHJhbnNsYXRpb25zLCBhdHRyaWJ1dGVOYW1lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIG1vZGVsIGFjY2Vzc29yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsPn0gLSBBdHRyaWJ1dGUgY29uZmlnIGluZmVycmVkIGZyb20gbW9kZWwgYWNjZXNzb3IgSlNEb2MuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0Zvck1vZGVsQWNjZXNzb3Ioe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFtb2RlbENsYXNzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgb3duZXJDbGFzc05hbWUgPSB0aGlzLm1ldGhvZE93bmVyQ2xhc3NOYW1lKHttZXRob2ROYW1lOiBhdHRyaWJ1dGVOYW1lLCB0YXJnZXRDbGFzczogbW9kZWxDbGFzc30pXG5cbiAgICBpZiAoIW93bmVyQ2xhc3NOYW1lKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QganNEb2NUeXBlID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFJldHVyblR5cGUoe1xuICAgICAgbWV0aG9kTmFtZTogYXR0cmlidXRlTmFtZSxcbiAgICAgIHNvdXJjZUNsYXNzTmFtZTogb3duZXJDbGFzc05hbWVcbiAgICB9KVxuXG4gICAgLy8gRnJvbnRlbmQgYXR0cmlidXRlcyBob2xkIHRoZSBzZXJpYWxpemVkIChyZXNvbHZlZCkgdmFsdWUsIHNvIGFuIGFzeW5jXG4gICAgLy8gYmFja2VuZCBhY2Nlc3NvciB0eXBlZCBgUHJvbWlzZTxudW1iZXI+YCBtdXN0IHN1cmZhY2UgYXMgYG51bWJlcmAg4oCUIHRoZVxuICAgIC8vIHNhbWUgdW53cmFwcGluZyB0aGUgcmVzb3VyY2UtbWV0aG9kIGluZmVyZW5jZSBwYXRoIGFwcGxpZXMuXG4gICAgcmV0dXJuIGpzRG9jVHlwZVxuICAgICAgPyB7anNEb2NUeXBlOiB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZUF0dHJpYnV0ZUpzRG9jVHlwZSh0aGlzLnVud3JhcHBlZFByb21pc2VKc0RvY1R5cGUoe2pzRG9jVHlwZX0pKX1cbiAgICAgIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEEgYmFja2VuZCBhY2Nlc3NvcidzIGBAcmV0dXJuc2AgY2FuIHJlZmVyZW5jZSB0eXBlcyB0aGF0IGV4aXN0IG9ubHkgb24gdGhlXG4gICAqIGJhY2tlbmQgKGUuZy4gYSBtb2RlbC1sb2NhbCBgQHR5cGVkZWYgQWdlbnRSdW5QbGFubmluZ0FydGlmYWN0YCkuIFRoZSBmcm9udGVuZFxuICAgKiBtb2RlbCBjYW4ndCByZXNvbHZlIHRob3NlLCBzbyBmYWxsIGJhY2sgdG8gYGFueWAgcmF0aGVyIHRoYW4gZW1pdHRpbmcgYW5cbiAgICogdW5kZWZpbmVkIHR5cGUgbmFtZS4gVHlwZXMgYnVpbHQgb25seSBmcm9tIHByaW1pdGl2ZXMgYW5kIGtub3duIGdlbmVyaWNcbiAgICogYnVpbHRpbnMgcGFzcyB0aHJvdWdoIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVHlwZSAtIFJlc29sdmVkIChQcm9taXNlLXVud3JhcHBlZCkgYXR0cmlidXRlIHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQSBmcm9udGVuZC1yZXNvbHZhYmxlIGF0dHJpYnV0ZSB0eXBlLlxuICAgKi9cbiAgZnJvbnRlbmRSZXNvbHZhYmxlQXR0cmlidXRlSnNEb2NUeXBlKGpzRG9jVHlwZSkge1xuICAgIGNvbnN0IHNhZmVUeXBlSWRlbnRpZmllcnMgPSB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZVR5cGVJZGVudGlmaWVycygpXG4gICAgY29uc3QgcmVmZXJlbmNlZElkZW50aWZpZXJzID0ganNEb2NUeXBlLm1hdGNoKC9bQS1aXVtBLVphLXowLTlfJF0qL2cpIHx8IFtdXG5cbiAgICBpZiAocmVmZXJlbmNlZElkZW50aWZpZXJzLnNvbWUoKGlkZW50aWZpZXIpID0+ICFzYWZlVHlwZUlkZW50aWZpZXJzLmhhcyhpZGVudGlmaWVyKSkpIHtcbiAgICAgIHJldHVybiBcImFueVwiXG4gICAgfVxuXG4gICAgcmV0dXJuIGpzRG9jVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIENhcGl0YWxpemVkIGlkZW50aWZpZXJzIGEgZ2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGNhbiByZXNvbHZlIG9uIGl0cyBvd25cbiAgICogKHByaW1pdGl2ZXMgYXJlIGxvd2VyLWNhc2UgYW5kIG1hdGNoZWQgc2VwYXJhdGVseSksIHNvIG9ubHkgZnJhbWV3b3JrLW93bmVkXG4gICAqIGFuZCBidWlsdGluIGdlbmVyaWMgdHlwZXMgYXJlIGxpc3RlZC5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIEZyb250ZW5kLXJlc29sdmFibGUgdHlwZSBpZGVudGlmaWVycy5cbiAgICovXG4gIGZyb250ZW5kUmVzb2x2YWJsZVR5cGVJZGVudGlmaWVycygpIHtcbiAgICByZXR1cm4gbmV3IFNldChbXG4gICAgICBcIkFycmF5XCIsIFwiRGF0ZVwiLCBcIkV4Y2x1ZGVcIiwgXCJFeHRyYWN0XCIsIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCIsIFwiRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXCIsXG4gICAgICBcIk1hcFwiLCBcIk5vbk51bGxhYmxlXCIsIFwiT21pdFwiLCBcIlBhcnRpYWxcIiwgXCJQaWNrXCIsIFwiUHJvbWlzZVwiLCBcIlJlYWRvbmx5XCIsIFwiUmVhZG9ubHlBcnJheVwiLCBcIlJlY29yZFwiLFxuICAgICAgXCJSZXF1aXJlZFwiLCBcIlJldHVyblR5cGVcIiwgXCJTZXRcIlxuICAgIF0pXG4gIH1cblxuICAvKipcbiAgICogUmV3cml0ZXMgYSBjdXN0b20tY29tbWFuZCBwYXJhbS9yZXR1cm4gSlNEb2MgdHlwZSBzbyBpdCByZXNvbHZlcyBpbiB0aGUgZ2VuZXJhdGVkXG4gICAqIGZyb250ZW5kIG1vZGVsOiBiYWNrZW5kIG1vZGVsIGltcG9ydHMgYXJlIG1hcHBlZCB0byBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWxcbiAgICogaW1wb3J0cywgYW5kIG90aGVyd2lzZSBub24tZnJvbnRlbmQtcmVzb2x2YWJsZSBpZGVudGlmaWVycyBiZWNvbWUgYGFueWAgaW4gcGxhY2VcbiAgICogc28gc2libGluZyBzY2FsYXIgZmllbGRzIGtlZXAgdGhlaXIgcmVhbCB0eXBlcy4gVGhlIHdvcmQgYm91bmRhcnkgYXZvaWRzIG1hdGNoaW5nXG4gICAqIHRoZSBjYXBpdGFsaXplZCBtaWRkbGUgb2YgYSBjYW1lbENhc2UgcHJvcGVydHkgbmFtZSAoZS5nLiBgYWRqdXN0ZWRUb3RhbENlbnRzYCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3MuZnJvbnRlbmRNb2RlbEZpbGVQYXRoIC0gR2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtNYXA8c3RyaW5nLCBSZXNvdXJjZUpzRG9jSW1wb3J0QWxpYXM+fSBhcmdzLmltcG9ydEFsaWFzZXMgLSBJbXBvcnQgYWxpYXNlcyB2aXNpYmxlIHRvIHRoZSBzb3VyY2UgbWV0aG9kLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qc0RvY1R5cGUgLSBSZXNvbHZlZCAoUHJvbWlzZS11bndyYXBwZWQpIEpTRG9jIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5zb3VyY2VGaWxlIC0gU291cmNlIGZpbGUgdGhhdCBkZWNsYXJlZCB0aGUgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEEgZnJvbnRlbmQtcmVzb2x2YWJsZSBKU0RvYyB0eXBlLlxuICAgKi9cbiAgZnJvbnRlbmRSZXNvbHZhYmxlQ29tbWFuZEpzRG9jVHlwZSh7ZnJvbnRlbmRNb2RlbEZpbGVQYXRoLCBpbXBvcnRBbGlhc2VzLCBqc0RvY1R5cGUsIHNvdXJjZUZpbGV9KSB7XG4gICAgY29uc3Qgc2FmZVR5cGVJZGVudGlmaWVycyA9IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlVHlwZUlkZW50aWZpZXJzKClcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHByZXNlcnZlZEltcG9ydHMgPSBbXVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyBhbiBpbXBvcnQgZXhwcmVzc2lvbiBiZWhpbmQgYSBsb3dlcmNhc2UgcGxhY2Vob2xkZXIgd2hpbGUgZ2VuZXJpY1xuICAgICAqIGlkZW50aWZpZXIgY2xlYW51cCBydW5zLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBpbXBvcnRFeHByZXNzaW9uIC0gSW1wb3J0IGV4cHJlc3Npb24gdG8gcHJlc2VydmUuXG4gICAgICogQHJldHVybnMge3N0cmluZ30gUGxhY2Vob2xkZXIgaW5zZXJ0ZWQgaW50byB0aGUgdHlwZSBzdHJpbmcuXG4gICAgICovXG4gICAgY29uc3QgcHJlc2VydmVJbXBvcnRFeHByZXNzaW9uID0gKGltcG9ydEV4cHJlc3Npb24pID0+IHtcbiAgICAgIGNvbnN0IHBsYWNlaG9sZGVyID0gYF9fdmVsb2Npb3VzX2ltcG9ydF9wbGFjZWhvbGRlcl8ke3ByZXNlcnZlZEltcG9ydHMubGVuZ3RofV9fYFxuXG4gICAgICBwcmVzZXJ2ZWRJbXBvcnRzLnB1c2goaW1wb3J0RXhwcmVzc2lvbilcblxuICAgICAgcmV0dXJuIHBsYWNlaG9sZGVyXG4gICAgfVxuXG4gICAgdGhpcy5hc3NlcnROb0JhY2tlbmRMb2NhbENvbW1hbmRUeXBlRXhwcmVzc2lvbnMoanNEb2NUeXBlKVxuXG4gICAgY29uc3Qgd2l0aFJld3JpdHRlbklubGluZUltcG9ydHMgPSBqc0RvY1R5cGVcbiAgICAgIC8vIEEgdHlwZSB0aGF0IHJlYWNoZXMgaW50byBhIGJhY2tlbmQgc291cmNlIGZpbGUgdmlhIGBpbXBvcnQoXCIuLi5cIilgXG4gICAgICAvLyAob3B0aW9uYWxseSBgLk1lbWJlcmAgYW5kIGBbXWApIGlzIGZyb250ZW5kLXJlc29sdmFibGUgb25seSB3aGVuIGl0XG4gICAgICAvLyBwb2ludHMgYXQgYSBnZW5lcmF0ZWQgbW9kZWwgZmlsZTsgb3RoZXIgYmFja2VuZC1sb2NhbCBpbXBvcnRzIGNvbGxhcHNlXG4gICAgICAvLyB0byBgYW55YCBzbyBoZWxwZXIvc2VydmljZSBpbXBsZW1lbnRhdGlvbiBkZXRhaWxzIGRvIG5vdCBsZWFrLlxuICAgICAgLnJlcGxhY2UoL2ltcG9ydFxcKFxccypbXCInXShbXlwiJ10qKVtcIiddXFxzKlxcKSgoPzpcXHMqXFwuXFxzKltBLVphLXpfJF1bXFx3JF0qKSopKCg/OlxccypcXFtcXHMqXFxdKSopL2csIChfbWF0Y2gsIHNwZWNpZmllciwgbWVtYmVyQ2hhaW4sIGFycmF5U3VmZml4KSA9PiB7XG4gICAgICAgIGNvbnN0IHJld3JpdHRlblNwZWNpZmllciA9IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlSnNEb2NJbXBvcnRTcGVjaWZpZXIoe1xuICAgICAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgICAgICBzb3VyY2VGaWxlLFxuICAgICAgICAgIHNwZWNpZmllclxuICAgICAgICB9KVxuXG4gICAgICAgIGlmICghcmV3cml0dGVuU3BlY2lmaWVyKSByZXR1cm4gXCJhbnlcIlxuXG4gICAgICAgIHJldHVybiBwcmVzZXJ2ZUltcG9ydEV4cHJlc3Npb24oYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHJld3JpdHRlblNwZWNpZmllcil9KSR7bWVtYmVyQ2hhaW4ucmVwbGFjZSgvXFxzKy9nLCBcIlwiKX0ke2FycmF5U3VmZml4LnJlcGxhY2UoL1xccysvZywgXCJcIil9YClcbiAgICAgIH0pXG5cbiAgICBsZXQgd2l0aFJld3JpdHRlbkFsaWFzZXMgPSB3aXRoUmV3cml0dGVuSW5saW5lSW1wb3J0c1xuXG4gICAgZm9yIChjb25zdCBbYWxpYXNOYW1lLCBpbXBvcnRBbGlhc10gb2YgaW1wb3J0QWxpYXNlcykge1xuICAgICAgY29uc3QgcmV3cml0dGVuU3BlY2lmaWVyID0gdGhpcy5mcm9udGVuZFJlc29sdmFibGVKc0RvY0ltcG9ydFNwZWNpZmllcih7XG4gICAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgICAgc291cmNlRmlsZSxcbiAgICAgICAgc3BlY2lmaWVyOiBpbXBvcnRBbGlhcy5zcGVjaWZpZXJcbiAgICAgIH0pXG5cbiAgICAgIGlmICghcmV3cml0dGVuU3BlY2lmaWVyKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBhbGlhc1JlZ2V4ID0gbmV3IFJlZ0V4cChgXFxcXGIke3RoaXMuZXNjYXBlUmVnRXhwKGFsaWFzTmFtZSl9XFxcXGJgLCBcImdcIilcblxuICAgICAgd2l0aFJld3JpdHRlbkFsaWFzZXMgPSB3aXRoUmV3cml0dGVuQWxpYXNlcy5yZXBsYWNlKGFsaWFzUmVnZXgsIHByZXNlcnZlSW1wb3J0RXhwcmVzc2lvbihgaW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkocmV3cml0dGVuU3BlY2lmaWVyKX0pLiR7aW1wb3J0QWxpYXMuaW1wb3J0ZWROYW1lfWApKVxuICAgIH1cblxuICAgIGNvbnN0IHNhbml0aXplZCA9IHdpdGhSZXdyaXR0ZW5BbGlhc2VzXG4gICAgICAvLyBSZW1haW5pbmcgY2FwaXRhbGl6ZWQgaWRlbnRpZmllcnMgYXJlIG1vZGVsIGNsYXNzZXMgb3Igb3RoZXJ3aXNlIG5vbi1yZXNvbHZhYmxlXG4gICAgICAvLyB0eXBlczsgZG93bmdyYWRlIGVhY2ggaW4gcGxhY2Ugc28gc2libGluZyBzY2FsYXIgZmllbGRzIGtlZXAgdGhlaXIgcmVhbCB0eXBlcy5cbiAgICAgIC5yZXBsYWNlKC9cXGJbQS1aXVtBLVphLXowLTlfJF0qL2csIChpZGVudGlmaWVyKSA9PiBzYWZlVHlwZUlkZW50aWZpZXJzLmhhcyhpZGVudGlmaWVyKSA/IGlkZW50aWZpZXIgOiBcImFueVwiKVxuXG4gICAgcmV0dXJuIHByZXNlcnZlZEltcG9ydHMucmVkdWNlKFxuICAgICAgKHR5cGUsIGltcG9ydEV4cHJlc3Npb24sIGluZGV4KSA9PiB0eXBlLnJlcGxhY2VBbGwoYF9fdmVsb2Npb3VzX2ltcG9ydF9wbGFjZWhvbGRlcl8ke2luZGV4fV9fYCwgaW1wb3J0RXhwcmVzc2lvbiksXG4gICAgICBzYW5pdGl6ZWRcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmFpc2VzIHdoZW4gYSBjb21tYW5kIEpTRG9jIHR5cGUgcmVmZXJlbmNlcyBhIGJhY2tlbmQtbG9jYWwgaGVscGVyIGV4cHJlc3Npb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqc0RvY1R5cGUgLSBDb21tYW5kIEpTRG9jIHR5cGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3NlcnROb0JhY2tlbmRMb2NhbENvbW1hbmRUeXBlRXhwcmVzc2lvbnMoanNEb2NUeXBlKSB7XG4gICAgY29uc3QgbG9jYWxSZXR1cm5UeXBlTWF0Y2ggPSBqc0RvY1R5cGUubWF0Y2goL1xcYig/OkF3YWl0ZWRcXHMqPFxccyopP1JldHVyblR5cGVcXHMqPFxccyp0eXBlb2ZcXHMrW0EtWmEtel8kXVtcXHckXSpcXHMqPlxccyo+Py8pXG5cbiAgICBpZiAoIWxvY2FsUmV0dXJuVHlwZU1hdGNoKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBFcnJvcihgQ3VzdG9tIGNvbW1hbmQgSlNEb2MgdHlwZSBjYW5ub3QgdXNlIGJhY2tlbmQtbG9jYWwgUmV0dXJuVHlwZSBleHByZXNzaW9ucyBpbiBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWxzOiAke2xvY2FsUmV0dXJuVHlwZU1hdGNoWzBdfS4gTW92ZSB0aGUgcGF5bG9hZCBzaGFwZSB0byBhIHNoYXJlZCB0eXBlZGVmIGFuZCByZXR1cm4gdGhhdCB0eXBlIGZyb20gdGhlIGNvbW1hbmQgbWV0aG9kLmApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCByZXNvbHZhYmxlIGpzIGRvYyBpbXBvcnQgc3BlY2lmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmZyb250ZW5kTW9kZWxGaWxlUGF0aCAtIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5zb3VyY2VGaWxlIC0gU291cmNlIGZpbGUgdGhhdCBkZWNsYXJlZCB0aGUgSlNEb2MgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3BlY2lmaWVyIC0gU291cmNlLWZpbGUgaW1wb3J0IHNwZWNpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmV3cml0dGVuIGZyb250ZW5kLW1vZGVsIGltcG9ydCBzcGVjaWZpZXIsIG9yIG51bGwgd2hlbiBiYWNrZW5kLWxvY2FsLlxuICAgKi9cbiAgZnJvbnRlbmRSZXNvbHZhYmxlSnNEb2NJbXBvcnRTcGVjaWZpZXIoe2Zyb250ZW5kTW9kZWxGaWxlUGF0aCwgc291cmNlRmlsZSwgc3BlY2lmaWVyfSkge1xuICAgIGlmICghc291cmNlRmlsZSB8fCAhZnJvbnRlbmRNb2RlbEZpbGVQYXRoKSByZXR1cm4gbnVsbFxuICAgIGlmICghc3BlY2lmaWVyLnN0YXJ0c1dpdGgoXCIuXCIpICYmICFzcGVjaWZpZXIuc3RhcnRzV2l0aChcIi9cIikpIHJldHVybiBzcGVjaWZpZXJcblxuICAgIGNvbnN0IGltcG9ydGVkUGF0aCA9IHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUoc291cmNlRmlsZSksIHNwZWNpZmllcilcbiAgICBjb25zdCBtb2RlbEltcG9ydFNwZWNpZmllciA9IHRoaXMuZnJvbnRlbmRNb2RlbEltcG9ydFNwZWNpZmllckZvckJhY2tlbmRNb2RlbFBhdGgoe1xuICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgaW1wb3J0ZWRQYXRoXG4gICAgfSlcblxuICAgIGlmIChtb2RlbEltcG9ydFNwZWNpZmllcikgcmV0dXJuIG1vZGVsSW1wb3J0U3BlY2lmaWVyXG5cbiAgICBpZiAodGhpcy5maWxlUGF0aElzV2l0aGluQW55RGlyZWN0b3J5KHtkaXJlY3RvcmllczogdGhpcy5mcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VEaXJlY3RvcmllcygpLCBmaWxlUGF0aDogaW1wb3J0ZWRQYXRofSkpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVsYXRpdmVJbXBvcnRTcGVjaWZpZXIoe2Zyb21GaWxlOiBmcm9udGVuZE1vZGVsRmlsZVBhdGgsIHRvRmlsZTogaW1wb3J0ZWRQYXRofSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGltcG9ydCBzcGVjaWZpZXIgZm9yIGJhY2tlbmQgbW9kZWwgcGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZyb250ZW5kTW9kZWxGaWxlUGF0aCAtIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmltcG9ydGVkUGF0aCAtIFNvdXJjZS1maWxlIGltcG9ydCBwYXRoIHJlc29sdmVkIGZyb20gSlNEb2MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEdlbmVyYXRlZCBmcm9udGVuZC1tb2RlbCBpbXBvcnQgc3BlY2lmaWVyLCBvciBudWxsIHdoZW4gdGhlIHBhdGggaXMgbm90IGEgcmVnaXN0ZXJlZCBtb2RlbCBmaWxlLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEltcG9ydFNwZWNpZmllckZvckJhY2tlbmRNb2RlbFBhdGgoe2Zyb250ZW5kTW9kZWxGaWxlUGF0aCwgaW1wb3J0ZWRQYXRofSkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxzRGlyZWN0b3J5ID0gcGF0aC5kaXJuYW1lKGZyb250ZW5kTW9kZWxGaWxlUGF0aClcbiAgICBjb25zdCBpbXBvcnRlZE1vZGVsUGF0aCA9IGltcG9ydGVkUGF0aC5lbmRzV2l0aChcIi5qc1wiKSA/IGltcG9ydGVkUGF0aCA6IGAke2ltcG9ydGVkUGF0aH0uanNgXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsRmlsZU5hbWUgb2YgdGhpcy5nZW5lcmF0ZWRGcm9udGVuZE1vZGVsRmlsZU5hbWVzKCkpIHtcbiAgICAgIGZvciAoY29uc3Qgc291cmNlRGlyZWN0b3J5IG9mIHRoaXMuZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRGlyZWN0b3JpZXMoKSkge1xuICAgICAgICBjb25zdCBtb2RlbHNEaXJlY3RvcnkgPSBwYXRoLmpvaW4oc291cmNlRGlyZWN0b3J5LCBcIm1vZGVsc1wiKVxuICAgICAgICBjb25zdCBjYW5kaWRhdGVNb2RlbFBhdGggPSBwYXRoLmpvaW4obW9kZWxzRGlyZWN0b3J5LCBtb2RlbEZpbGVOYW1lKVxuXG4gICAgICAgIGlmIChwYXRoLnJlc29sdmUoY2FuZGlkYXRlTW9kZWxQYXRoKSAhPT0gcGF0aC5yZXNvbHZlKGltcG9ydGVkTW9kZWxQYXRoKSkgY29udGludWVcblxuICAgICAgICByZXR1cm4gdGhpcy5yZWxhdGl2ZUltcG9ydFNwZWNpZmllcih7XG4gICAgICAgICAgZnJvbUZpbGU6IGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgICAgICB0b0ZpbGU6IHBhdGguam9pbihmcm9udGVuZE1vZGVsc0RpcmVjdG9yeSwgbW9kZWxGaWxlTmFtZSlcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGZpbGUgbmFtZXMuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBGcm9udGVuZCBtb2RlbCBmaWxlbmFtZXMgdGhhdCB0aGlzIGdlbmVyYXRpb24gcnVuIGNhbiBlbWl0LlxuICAgKi9cbiAgZ2VuZXJhdGVkRnJvbnRlbmRNb2RlbEZpbGVOYW1lcygpIHtcbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGZpbGVOYW1lcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gdGhpcy5yZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgICAgZm9yIChjb25zdCByZXNvdXJjZU1vZGVsTmFtZSBvZiBPYmplY3Qua2V5cyhyZXNvdXJjZXMpKSB7XG4gICAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVzb3VyY2VNb2RlbE5hbWUucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpKVxuXG4gICAgICAgIGZpbGVOYW1lcy5hZGQoYCR7aW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKGNsYXNzTmFtZSkpfS5qc2ApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVOYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpdmUgaW1wb3J0IHNwZWNpZmllci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZyb21GaWxlIC0gU291cmNlIGZpbGUgdGhhdCB3aWxsIGNvbnRhaW4gdGhlIGltcG9ydCBleHByZXNzaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50b0ZpbGUgLSBGaWxlIGJlaW5nIGltcG9ydGVkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlbGF0aXZlIGltcG9ydCBzcGVjaWZpZXIuXG4gICAqL1xuICByZWxhdGl2ZUltcG9ydFNwZWNpZmllcih7ZnJvbUZpbGUsIHRvRmlsZX0pIHtcbiAgICBsZXQgcmVsYXRpdmVTcGVjaWZpZXIgPSBwYXRoLnJlbGF0aXZlKHBhdGguZGlybmFtZShmcm9tRmlsZSksIHRvRmlsZSkuc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpXG5cbiAgICBpZiAoIXJlbGF0aXZlU3BlY2lmaWVyLnN0YXJ0c1dpdGgoXCIuXCIpKSB7XG4gICAgICByZWxhdGl2ZVNwZWNpZmllciA9IGAuLyR7cmVsYXRpdmVTcGVjaWZpZXJ9YFxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGl2ZVNwZWNpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlsZSBwYXRoIGlzIHdpdGhpbiBhbnkgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kaXJlY3RvcmllcyAtIENhbmRpZGF0ZSBwYXJlbnQgZGlyZWN0b3JpZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVQYXRoIC0gRmlsZSBwYXRoIHRvIHRlc3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGZpbGUgcGF0aCBpcyB1bmRlciBvbmUgY2FuZGlkYXRlIGRpcmVjdG9yeS5cbiAgICovXG4gIGZpbGVQYXRoSXNXaXRoaW5BbnlEaXJlY3Rvcnkoe2RpcmVjdG9yaWVzLCBmaWxlUGF0aH0pIHtcbiAgICByZXR1cm4gZGlyZWN0b3JpZXMuc29tZSgoZGlyZWN0b3J5KSA9PiB7XG4gICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHBhdGgucmVzb2x2ZShkaXJlY3RvcnkpLCBwYXRoLnJlc29sdmUoZmlsZVBhdGgpKVxuXG4gICAgICByZXR1cm4gcmVsYXRpdmVQYXRoID09PSBcIlwiIHx8ICghcmVsYXRpdmVQYXRoLnN0YXJ0c1dpdGgoXCIuLlwiKSAmJiAhcGF0aC5pc0Fic29sdXRlKHJlbGF0aXZlUGF0aCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFc2NhcGVzIHRleHQgZm9yIHVzZSBpbnNpZGUgYSBSZWdFeHAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIGVzY2FwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSZWdFeHAtc2FmZSB2YWx1ZS5cbiAgICovXG4gIGVzY2FwZVJlZ0V4cCh2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIEpTRG9jIHBhcmFtIGJsb2NrLCBwYXJhbWV0ZXIgbGlzdCwgcGF5bG9hZC1hcmd1bWVudCBleHByZXNzaW9uLCBhbmRcbiAgICogcmV0dXJuIHR5cGUgZm9yIGEgY3VzdG9tIGNvbW1hbmQgbWV0aG9kLiBXaXRoIGRlY2xhcmVkIGBhcmdzYCBlYWNoIGJlY29tZXMgYVxuICAgKiBuYW1lZCwgdHlwZWQgcGFyYW1ldGVyIG1hcHBlZCBwb3NpdGlvbmFsbHkgaW50byB0aGUgY29tbWFuZCBwYXlsb2FkOyB3aXRob3V0XG4gICAqIHRoZW0gdGhlIG1ldGhvZCBzdGF5cyB2YXJpYWRpYy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT59IGFyZ3MuY29tbWFuZE1ldGFkYXRhIC0gUGVyLWNvbW1hbmQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZE5hbWUgLSBDb21tYW5kIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e3BhcmFtRG9jczogc3RyaW5nLCBwYXJhbWV0ZXJzOiBzdHJpbmcsIHBheWxvYWRBcmd1bWVudHM6IHN0cmluZywgcmV0dXJuVHlwZTogc3RyaW5nfX0gLSBHZW5lcmF0aW9uIHBpZWNlcy5cbiAgICovXG4gIGN1c3RvbUNvbW1hbmRNZXRob2RTaWduYXR1cmUoe2NvbW1hbmRNZXRhZGF0YSwgbWV0aG9kTmFtZX0pIHtcbiAgICBjb25zdCBtZXRhZGF0YSA9IGNvbW1hbmRNZXRhZGF0YVttZXRob2ROYW1lXSB8fCB7YXJnczogW10sIHJldHVyblR5cGU6IG51bGx9XG4gICAgY29uc3QgcmV0dXJuVHlwZSA9IG1ldGFkYXRhLnJldHVyblR5cGUgfHwgXCJSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+XCJcblxuICAgIGlmIChtZXRhZGF0YS5hcmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHBhcmFtZXRlck5hbWVzID0gbWV0YWRhdGEuYXJncy5tYXAoKGFyZykgPT4gYXJnLm5hbWUpXG4gICAgICAvLyBBIHNpbmdsZSBhcmdzIG9iamVjdCB3aG9zZSBldmVyeSBmaWVsZCBpcyBvcHRpb25hbCBhY2NlcHRzIGB7fWAsIHNvIGRlZmF1bHRcbiAgICAgIC8vIHRoZSBwYXJhbWV0ZXIgYW5kIG1hcmsgaXQgb3B0aW9uYWwg4oCUIGNhbGxlcnMgY2FuIHRoZW4gb21pdCBpdCBlbnRpcmVseVxuICAgICAgLy8gKGByZWNvcmQuY29tbWFuZCgpYCBpbnN0ZWFkIG9mIGByZWNvcmQuY29tbWFuZCh7fSlgKS4gUmVxdWlyZWQtZmllbGQgYXJncyBrZWVwXG4gICAgICAvLyB0aGUgbWFuZGF0b3J5IHBhcmFtZXRlciAoYSBge31gIGRlZmF1bHQgd291bGRuJ3Qgc2F0aXNmeSB0aGVpciB0eXBlKS5cbiAgICAgIGNvbnN0IGRlZmF1bHRzVG9FbXB0eU9iamVjdCA9IG1ldGFkYXRhLmFyZ3MubGVuZ3RoID09PSAxICYmIHRoaXMuYXJnVHlwZUFjY2VwdHNFbXB0eU9iamVjdChtZXRhZGF0YS5hcmdzWzBdLnR5cGUpXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHBhcmFtRG9jczogbWV0YWRhdGEuYXJncy5tYXAoKGFyZykgPT4gYCAgICogQHBhcmFtIHske2FyZy50eXBlfX0gJHtkZWZhdWx0c1RvRW1wdHlPYmplY3QgPyBgWyR7YXJnLm5hbWV9XWAgOiBhcmcubmFtZX0gLSBDb21tYW5kIGFyZ3VtZW50LlxcbmApLmpvaW4oXCJcIiksXG4gICAgICAgIHBhcmFtZXRlcnM6IGRlZmF1bHRzVG9FbXB0eU9iamVjdCA/IGAke3BhcmFtZXRlck5hbWVzWzBdfSA9IHt9YCA6IHBhcmFtZXRlck5hbWVzLmpvaW4oXCIsIFwiKSxcbiAgICAgICAgcGF5bG9hZEFyZ3VtZW50czogYFske3BhcmFtZXRlck5hbWVzLmpvaW4oXCIsIFwiKX1dYCxcbiAgICAgICAgcmV0dXJuVHlwZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBwYXJhbURvY3M6IFwiICAgKiBAcGFyYW0gey4uLkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZX0gY29tbWFuZEFyZ3VtZW50cyAtIEN1c3RvbSBjb21tYW5kIGFyZ3VtZW50cy5cXG5cIixcbiAgICAgIHBhcmFtZXRlcnM6IFwiLi4uY29tbWFuZEFyZ3VtZW50c1wiLFxuICAgICAgcGF5bG9hZEFyZ3VtZW50czogXCJjb21tYW5kQXJndW1lbnRzXCIsXG4gICAgICByZXR1cm5UeXBlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBzaW5nbGUgY29tbWFuZC1hcmdzIEpTRG9jIHR5cGUgaXMga25vd24gdG8gYWNjZXB0IGFuIGVtcHR5IG9iamVjdCBge31gOlxuICAgKiBhIHNpbmdsZSBiYWxhbmNlZCBvYmplY3QgbGl0ZXJhbCB3aG9zZSB0b3AtbGV2ZWwgbWVtYmVycyBhcmUgYWxsIG9wdGlvbmFsIChgbmFtZT86YClcbiAgICogb3IgaW5kZXggc2lnbmF0dXJlcyAoYFtrOiAuLi5dOmApLiBBbnl0aGluZyBlbHNlIHJldHVybnMgZmFsc2Ugc28gdGhlIHBhcmFtZXRlciBzdGF5c1xuICAgKiByZXF1aXJlZCDigJQgaW5jbHVkaW5nIGEgcmVxdWlyZWQgbWVtYmVyLCBhIG5vbi1vYmplY3QtbGl0ZXJhbCAoYSBwb3NpdGlvbmFsIGBudW1iZXJgLFxuICAgKiBhIGBSZWNvcmQ8Li4uPmAgLyBgUGFydGlhbDwuLi4+YCB3aG9zZSBrZXkvd3JhcHBlciBtYXkgc3RpbGwgcmVxdWlyZSBkYXRhKSwgYW5kIGFueVxuICAgKiBpbnRlcnNlY3Rpb24vdW5pb24gKGUuZy4gYHthPzogeH0gJiB7Yjogc3RyaW5nfWApLCB3aGVyZSBge31gIGlzIG5vdCBhc3NpZ25hYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIFRoZSBhcmcncyBKU0RvYyB0eXBlIHN0cmluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZ2VuZXJhdGVkIHBhcmFtZXRlciBjYW4gZGVmYXVsdCB0byBge31gLlxuICAgKi9cbiAgYXJnVHlwZUFjY2VwdHNFbXB0eU9iamVjdCh0eXBlKSB7XG4gICAgY29uc3QgdHJpbW1lZFR5cGUgPSB0eXBlLnRyaW0oKVxuXG4gICAgLy8gTXVzdCBiZSBhIHNpbmdsZSBiYWxhbmNlZCBvYmplY3QgbGl0ZXJhbDogc3RhcnRzIHdpdGggYHtgLCBlbmRzIHdpdGggYH1gLCBhbmQgdGhlXG4gICAgLy8gb3BlbmluZyBicmFjZSBjbG9zZXMgb25seSBhdCB0aGUgZmluYWwgY2hhcmFjdGVyLiBUaGlzIHJlamVjdHMgaW50ZXJzZWN0aW9ucy91bmlvbnNcbiAgICAvLyBsaWtlIGB7YT86IHh9ICYge2I6IHN0cmluZ31gIHRoYXQgbWVyZWx5IGhhcHBlbiB0byBzdGFydCBge2AgYW5kIGVuZCBgfWAuXG4gICAgaWYgKCEodHJpbW1lZFR5cGUuc3RhcnRzV2l0aChcIntcIikgJiYgdHJpbW1lZFR5cGUuZW5kc1dpdGgoXCJ9XCIpKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKCF0aGlzLmlzU2luZ2xlQmFsYW5jZWRPYmplY3RMaXRlcmFsKHRyaW1tZWRUeXBlKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBpbm5lciA9IHRyaW1tZWRUeXBlLnNsaWNlKDEsIC0xKVxuXG4gICAgZm9yIChjb25zdCBtZW1iZXIgb2YgdGhpcy5zcGxpdFRvcExldmVsVHlwZU1lbWJlcnMoaW5uZXIpKSB7XG4gICAgICBjb25zdCBjb2xvbkluZGV4ID0gdGhpcy50b3BMZXZlbENvbG9uSW5kZXgobWVtYmVyKVxuXG4gICAgICAvLyBObyB0b3AtbGV2ZWwgY29sb246IGEgY2FsbC9jb25zdHJ1Y3QvbWFwcGVkIHNpZ25hdHVyZSBvciBtYWxmb3JtZWQgbWVtYmVyIOKAlFxuICAgICAgLy8gY2FuJ3QgY29uZmlybSBpdCdzIG9wdGlvbmFsLCBzbyB0cmVhdCB0aGUgdHlwZSBhcyBub3QgZW1wdHktZGVmYXVsdGFibGUuXG4gICAgICBpZiAoY29sb25JbmRleCA8IDApIHJldHVybiBmYWxzZVxuXG4gICAgICBjb25zdCBrZXkgPSBtZW1iZXIuc2xpY2UoMCwgY29sb25JbmRleCkudHJpbSgpXG5cbiAgICAgIC8vIEluZGV4IHNpZ25hdHVyZXMgKGBbazogc3RyaW5nXWApIGRvbid0IHJlcXVpcmUgYSB2YWx1ZTsgb3B0aW9uYWwgcHJvcHMgZW5kIGluIGA/YC5cbiAgICAgIC8vIEFueXRoaW5nIGVsc2UgaXMgYSByZXF1aXJlZCBwcm9wZXJ0eSwgc28gYHt9YCB3b3VsZCBub3Qgc2F0aXNmeSB0aGUgdHlwZS5cbiAgICAgIGlmICgha2V5LnN0YXJ0c1dpdGgoXCJbXCIpICYmICFrZXkuZW5kc1dpdGgoXCI/XCIpKSByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyB0aGUgaW5uZXIgYm9keSBvZiBhbiBvYmplY3QtbGl0ZXJhbCB0eXBlIGludG8gaXRzIHRvcC1sZXZlbCBtZW1iZXJzLFxuICAgKiByZXNwZWN0aW5nIG5lc3RlZCBge31gIC8gYFtdYCAvIGA8PmAgLyBgKClgIHNvIGZpZWxkIHR5cGVzIGxpa2UgYHN0cmluZ1tdIHwgbnVsbGBcbiAgICogb3IgYHthOiBifWAgYXJlbid0IHNwbGl0IG1pZC10eXBlLiBNZW1iZXJzIGFyZSBzZXBhcmF0ZWQgYnkgYCxgIG9yIGA7YC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlubmVyIC0gT2JqZWN0LWxpdGVyYWwgYm9keSAod2l0aG91dCB0aGUgb3V0ZXIgYnJhY2VzKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRyaW1tZWQgbm9uLWVtcHR5IHRvcC1sZXZlbCBtZW1iZXJzLlxuICAgKi9cbiAgc3BsaXRUb3BMZXZlbFR5cGVNZW1iZXJzKGlubmVyKSB7XG4gICAgY29uc3QgbWVtYmVycyA9IFtdXG4gICAgbGV0IGRlcHRoID0gMFxuICAgIGxldCBzdGFydCA9IDBcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBpbm5lci5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IGNoYXJhY3RlciA9IGlubmVyW2luZGV4XVxuXG4gICAgICBpZiAoY2hhcmFjdGVyID09PSBcIntcIiB8fCBjaGFyYWN0ZXIgPT09IFwiW1wiIHx8IGNoYXJhY3RlciA9PT0gXCI8XCIgfHwgY2hhcmFjdGVyID09PSBcIihcIikge1xuICAgICAgICBkZXB0aCArPSAxXG4gICAgICB9IGVsc2UgaWYgKGNoYXJhY3RlciA9PT0gXCJ9XCIgfHwgY2hhcmFjdGVyID09PSBcIl1cIiB8fCBjaGFyYWN0ZXIgPT09IFwiPlwiIHx8IGNoYXJhY3RlciA9PT0gXCIpXCIpIHtcbiAgICAgICAgZGVwdGggLT0gMVxuICAgICAgfSBlbHNlIGlmICgoY2hhcmFjdGVyID09PSBcIixcIiB8fCBjaGFyYWN0ZXIgPT09IFwiO1wiKSAmJiBkZXB0aCA9PT0gMCkge1xuICAgICAgICBtZW1iZXJzLnB1c2goaW5uZXIuc2xpY2Uoc3RhcnQsIGluZGV4KSlcbiAgICAgICAgc3RhcnQgPSBpbmRleCArIDFcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZW1iZXJzLnB1c2goaW5uZXIuc2xpY2Uoc3RhcnQpKVxuXG4gICAgcmV0dXJuIG1lbWJlcnMubWFwKChtZW1iZXIpID0+IG1lbWJlci50cmltKCkpLmZpbHRlcigobWVtYmVyKSA9PiBtZW1iZXIubGVuZ3RoID4gMClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbmRleCBvZiB0aGUgZmlyc3QgdG9wLWxldmVsIGA6YCBpbiBhbiBvYmplY3QtbGl0ZXJhbCBtZW1iZXIsIGlnbm9yaW5nIGNvbG9uc1xuICAgKiBuZXN0ZWQgaW5zaWRlIGB7fWAgLyBgW11gIC8gYDw+YCAvIGAoKWAgKGUuZy4gYW4gaW5kZXggc2lnbmF0dXJlIGBbazogc3RyaW5nXWApLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVtYmVyIC0gQSBzaW5nbGUgb2JqZWN0LWxpdGVyYWwgbWVtYmVyLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBjb2xvbiBpbmRleCwgb3IgLTEgd2hlbiBub25lIGlzIGZvdW5kIGF0IHRoZSB0b3AgbGV2ZWwuXG4gICAqL1xuICB0b3BMZXZlbENvbG9uSW5kZXgobWVtYmVyKSB7XG4gICAgbGV0IGRlcHRoID0gMFxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1lbWJlci5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IGNoYXJhY3RlciA9IG1lbWJlcltpbmRleF1cblxuICAgICAgaWYgKGNoYXJhY3RlciA9PT0gXCJ7XCIgfHwgY2hhcmFjdGVyID09PSBcIltcIiB8fCBjaGFyYWN0ZXIgPT09IFwiPFwiIHx8IGNoYXJhY3RlciA9PT0gXCIoXCIpIHtcbiAgICAgICAgZGVwdGggKz0gMVxuICAgICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT09IFwifVwiIHx8IGNoYXJhY3RlciA9PT0gXCJdXCIgfHwgY2hhcmFjdGVyID09PSBcIj5cIiB8fCBjaGFyYWN0ZXIgPT09IFwiKVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDFcbiAgICAgIH0gZWxzZSBpZiAoY2hhcmFjdGVyID09PSBcIjpcIiAmJiBkZXB0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gaW5kZXhcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gLTFcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB0eXBlIGlzIGEgc2luZ2xlIGJhbGFuY2VkIG9iamVjdCBsaXRlcmFsIOKAlCBpdHMgbGVhZGluZyBge2AgY2xvc2VzIG9ubHlcbiAgICogYXQgdGhlIGZpbmFsIGNoYXJhY3Rlci4gUmVqZWN0cyB0b3AtbGV2ZWwgaW50ZXJzZWN0aW9ucy91bmlvbnMgbGlrZSBge2E/OiB4fSAmIHtiOiB5fWBcbiAgICogb3IgYHthPzogeH0gfCBzdHJpbmdgIHdob3NlIGJyYWNlIGRlcHRoIHJldHVybnMgdG8gMCBiZWZvcmUgdGhlIGVuZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBBIHRyaW1tZWQgdHlwZSBzdHJpbmcgdGhhdCBzdGFydHMgd2l0aCBge2AgYW5kIGVuZHMgd2l0aCBgfWAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGJyYWNlcyB3cmFwIHRoZSB3aG9sZSB0eXBlLlxuICAgKi9cbiAgaXNTaW5nbGVCYWxhbmNlZE9iamVjdExpdGVyYWwodHlwZSkge1xuICAgIGxldCBkZXB0aCA9IDBcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCB0eXBlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgY2hhcmFjdGVyID0gdHlwZVtpbmRleF1cblxuICAgICAgaWYgKGNoYXJhY3RlciA9PT0gXCJ7XCIgfHwgY2hhcmFjdGVyID09PSBcIltcIiB8fCBjaGFyYWN0ZXIgPT09IFwiPFwiIHx8IGNoYXJhY3RlciA9PT0gXCIoXCIpIHtcbiAgICAgICAgZGVwdGggKz0gMVxuICAgICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT09IFwifVwiIHx8IGNoYXJhY3RlciA9PT0gXCJdXCIgfHwgY2hhcmFjdGVyID09PSBcIj5cIiB8fCBjaGFyYWN0ZXIgPT09IFwiKVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDFcblxuICAgICAgICAvLyBUaGUgb3BlbmluZyBicmFjZSBiYWxhbmNlZCBiZWZvcmUgdGhlIGVuZCwgc28gc29tZXRoaW5nIGZvbGxvd3MgdGhlIGxpdGVyYWwuXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCAmJiBpbmRleCA8IHR5cGUubGVuZ3RoIC0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRlcHRoID09PSAwXG4gIH1cblxuICAvKipcbiAgICogRW5yaWNoZXMgY3VzdG9tLWNvbW1hbmQgbWV0YWRhdGEgYnkgZGVyaXZpbmcgYSBjb21tYW5kJ3MgdHlwZWQgYXJncyBhbmQgcmV0dXJuXG4gICAqIHR5cGUgZnJvbSB0aGUgYmFja2VuZCByZXNvdXJjZSBtZXRob2QncyBgQHBhcmFtYC9gQHJldHVybnNgIEpTRG9jIHdoZW4gdGhleSBhcmVcbiAgICogbm90IGFscmVhZHkgZGVjbGFyZWQgaW4gYHJlc291cmNlQ29uZmlnYC4gUHJlY2VkZW5jZTogZXhwbGljaXQgYHJlc291cmNlQ29uZmlnYFxuICAgKiBge2FyZ3MsIHJldHVyblR5cGV9YCB3aW5zLCB0aGVuIHRoZSBkZXJpdmVkIGJhY2tlbmQtbWV0aG9kIEpTRG9jLCB0aGVuIHRoZSBnZW5lcmljXG4gICAqIGRlZmF1bHQuIE1vZGVsLWNsYXNzIGlkZW50aWZpZXJzIGluIHRoZSBkZXJpdmVkIHR5cGVzIGFyZSBkb3duZ3JhZGVkIHRvIGBhbnlgXG4gICAqIGJlY2F1c2UgdGhlIGZyb250ZW5kIHJlY2VpdmVzIGEgc2VyaWFsaXplZCByZWNvcmQsIG5vdCBhIG1vZGVsIGluc3RhbmNlLCB3aGljaCB0aGVcbiAgICogY29uc3VtZXIgaHlkcmF0ZXMgd2l0aCBgTW9kZWwuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UoLi4uKWAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fSBhcmdzLmNvbW1hbmRNZXRhZGF0YSAtIERlY2xhcmVkIHBlci1jb21tYW5kIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmNvbW1hbmROYW1lcyAtIENvbW1hbmQgbWV0aG9kIG5hbWVzIHRvIHJlc29sdmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZyb250ZW5kTW9kZWxGaWxlUGF0aCAtIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT4+fSAtIEVucmljaGVkIG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgY29tbWFuZE1ldGFkYXRhV2l0aFJlc291cmNlSnNEb2Moe2NvbW1hbmRNZXRhZGF0YSwgY29tbWFuZE5hbWVzLCBmcm9udGVuZE1vZGVsRmlsZVBhdGgsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzKSByZXR1cm4gY29tbWFuZE1ldGFkYXRhXG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fSAqL1xuICAgIGNvbnN0IGVucmljaGVkID0gey4uLmNvbW1hbmRNZXRhZGF0YX1cblxuICAgIGZvciAoY29uc3QgY29tbWFuZE5hbWUgb2YgY29tbWFuZE5hbWVzKSB7XG4gICAgICBjb25zdCBkZWNsYXJlZCA9IGNvbW1hbmRNZXRhZGF0YVtjb21tYW5kTmFtZV0gfHwge2FyZ3M6IFtdLCByZXR1cm5UeXBlOiBudWxsfVxuICAgICAgY29uc3Qgc291cmNlQ2xhc3NOYW1lID0gdGhpcy5tZXRob2RPd25lckNsYXNzTmFtZSh7bWV0aG9kTmFtZTogY29tbWFuZE5hbWUsIHRhcmdldENsYXNzOiByZXNvdXJjZUNsYXNzfSlcblxuICAgICAgaWYgKCFzb3VyY2VDbGFzc05hbWUpIHtcbiAgICAgICAgZW5yaWNoZWRbY29tbWFuZE5hbWVdID0gZGVjbGFyZWRcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBsZXQgcmV0dXJuVHlwZSA9IGRlY2xhcmVkLnJldHVyblR5cGVcblxuICAgICAgaWYgKCFyZXR1cm5UeXBlKSB7XG4gICAgICAgIGNvbnN0IGpzRG9jUmV0dXJuVHlwZSA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlRGVmaW5pdGlvbih7bWV0aG9kTmFtZTogY29tbWFuZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pXG5cbiAgICAgICAgaWYgKGpzRG9jUmV0dXJuVHlwZSkge1xuICAgICAgICAgIHJldHVyblR5cGUgPSB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZUNvbW1hbmRKc0RvY1R5cGUoe1xuICAgICAgICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgICAgICAgaW1wb3J0QWxpYXNlczoganNEb2NSZXR1cm5UeXBlLmltcG9ydEFsaWFzZXMsXG4gICAgICAgICAgICBqc0RvY1R5cGU6IHRoaXMudW53cmFwcGVkUHJvbWlzZUpzRG9jVHlwZSh7anNEb2NUeXBlOiBqc0RvY1JldHVyblR5cGUudHlwZX0pLFxuICAgICAgICAgICAgc291cmNlRmlsZToganNEb2NSZXR1cm5UeXBlLnNvdXJjZUZpbGVcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGxldCBhcmdzID0gZGVjbGFyZWQuYXJnc1xuXG4gICAgICBpZiAoIWFyZ3MgfHwgYXJncy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgY29uc3QganNEb2NQYXJhbWV0ZXJzID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFBhcmFtZXRlcnMoe21ldGhvZE5hbWU6IGNvbW1hbmROYW1lLCBzb3VyY2VDbGFzc05hbWV9KVxuICAgICAgICAvLyBTa2lwIG9iamVjdC1wcm9wZXJ0eSB0YWdzIChgQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWVzc2FnZWApOyBvbmx5IHRoZVxuICAgICAgICAvLyB0b3AtbGV2ZWwgcGFyYW1ldGVycyBtYXAgdG8gbWV0aG9kIGFyZ3VtZW50cywgb3RoZXJ3aXNlIHRoZSBzaGFyZWRcbiAgICAgICAgLy8gYEBwYXJhbSB7b2JqZWN0fSBhcmdzYCArIHByb3BlcnR5IHN0eWxlIHdvdWxkIGVtaXQgYG5hbWUoYXJncywgYXJncylgLlxuICAgICAgICBjb25zdCB0b3BMZXZlbFBhcmFtZXRlcnMgPSAoanNEb2NQYXJhbWV0ZXJzIHx8IFtdKS5maWx0ZXIoKHBhcmFtZXRlcikgPT4gdHlwZW9mIHBhcmFtZXRlci5uYW1lID09PSBcInN0cmluZ1wiICYmICFwYXJhbWV0ZXIubmFtZS5pbmNsdWRlcyhcIi5cIikpXG5cbiAgICAgICAgaWYgKHRvcExldmVsUGFyYW1ldGVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgYXJncyA9IHRvcExldmVsUGFyYW1ldGVycy5tYXAoKHBhcmFtZXRlcikgPT4gKHtcbiAgICAgICAgICAgIG5hbWU6IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAocGFyYW1ldGVyLm5hbWUpLFxuICAgICAgICAgICAgdHlwZTogdGhpcy5mcm9udGVuZFJlc29sdmFibGVDb21tYW5kSnNEb2NUeXBlKHtcbiAgICAgICAgICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgICAgICAgICBpbXBvcnRBbGlhc2VzOiBwYXJhbWV0ZXIuaW1wb3J0QWxpYXNlcyxcbiAgICAgICAgICAgICAganNEb2NUeXBlOiBwYXJhbWV0ZXIudHlwZSxcbiAgICAgICAgICAgICAgc291cmNlRmlsZTogcGFyYW1ldGVyLnNvdXJjZUZpbGVcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZW5yaWNoZWRbY29tbWFuZE5hbWVdID0ge2FyZ3M6IGFyZ3MgfHwgW10sIHJldHVyblR5cGU6IHJldHVyblR5cGUgfHwgbnVsbH1cbiAgICB9XG5cbiAgICByZXR1cm4gZW5yaWNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVud3JhcHBlZCBwcm9taXNlIGpzIGRvYyB0eXBlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuanNEb2NUeXBlIC0gSlNEb2MgdHlwZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHJlc29sdmVkIHZhbHVlIHR5cGUgZm9yIHNlcmlhbGl6ZWQgZnJvbnRlbmQgYXR0cmlidXRlcy5cbiAgICovXG4gIHVud3JhcHBlZFByb21pc2VKc0RvY1R5cGUoe2pzRG9jVHlwZX0pIHtcbiAgICBjb25zdCBwcm9taXNlUHJlZml4ID0gXCJQcm9taXNlPFwiXG5cbiAgICBpZiAoIWpzRG9jVHlwZS5zdGFydHNXaXRoKHByb21pc2VQcmVmaXgpKSByZXR1cm4ganNEb2NUeXBlXG5cbiAgICBpZiAoIWpzRG9jVHlwZS5lbmRzV2l0aChcIj5cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgUHJvbWlzZSBKU0RvYyB0eXBlIHRvIGVuZCB3aXRoICc+JzogJHtqc0RvY1R5cGV9YClcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZFR5cGUgPSBqc0RvY1R5cGUuc2xpY2UocHJvbWlzZVByZWZpeC5sZW5ndGgsIC0xKS50cmltKClcblxuICAgIGlmIChyZXNvbHZlZFR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBQcm9taXNlIEpTRG9jIHR5cGUgdG8gY29udGFpbiBhIHJlc29sdmVkIHR5cGU6ICR7anNEb2NUeXBlfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc29sdmVkVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWV0aG9kIG93bmVyIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IGFyZ3MudGFyZ2V0Q2xhc3MgLSBUYXJnZXQgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENsYXNzIG5hbWUgdGhhdCBkZWNsYXJlcyB0aGUgbWV0aG9kLlxuICAgKi9cbiAgbWV0aG9kT3duZXJDbGFzc05hbWUoe21ldGhvZE5hbWUsIHRhcmdldENsYXNzfSkge1xuICAgIGxldCBwcm90b3R5cGUgPSB0YXJnZXRDbGFzcy5wcm90b3R5cGVcblxuICAgIHdoaWxlIChwcm90b3R5cGUgJiYgcHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHByb3RvdHlwZSwgbWV0aG9kTmFtZSkpIHtcbiAgICAgICAgY29uc3QgZGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IocHJvdG90eXBlLCBtZXRob2ROYW1lKVxuXG4gICAgICAgIGlmICh0eXBlb2YgZGVzY3JpcHRvcj8udmFsdWUgIT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdG9yTmFtZSA9IHByb3RvdHlwZS5jb25zdHJ1Y3Rvcj8ubmFtZVxuXG4gICAgICAgIGlmICh0eXBlb2YgY29uc3RydWN0b3JOYW1lID09IFwic3RyaW5nXCIgJiYgY29uc3RydWN0b3JOYW1lLmxlbmd0aCA+IDApIHJldHVybiBjb25zdHJ1Y3Rvck5hbWVcblxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG90eXBlKVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNvdXJjZUNsYXNzTmFtZSAtIFNvdXJjZSBjbGFzcyBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBKU0RvYyByZXR1cm4gdHlwZSB3aGVuIGRvY3VtZW50ZWQuXG4gICAqL1xuICBhc3luYyByZXNvdXJjZU1ldGhvZFJldHVyblR5cGUoe21ldGhvZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pIHtcbiAgICBjb25zdCByZXR1cm5UeXBlID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFJldHVyblR5cGVEZWZpbml0aW9uKHttZXRob2ROYW1lLCBzb3VyY2VDbGFzc05hbWV9KVxuXG4gICAgcmV0dXJuIHJldHVyblR5cGUgPyByZXR1cm5UeXBlLnR5cGUgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGUgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc291cmNlQ2xhc3NOYW1lIC0gU291cmNlIGNsYXNzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZSB8IG51bGw+fSAtIEpTRG9jIHJldHVybiB0eXBlIGRlZmluaXRpb24gd2hlbiBkb2N1bWVudGVkLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlRGVmaW5pdGlvbih7bWV0aG9kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSkge1xuICAgIGNvbnN0IHJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMoKVxuICAgIGNvbnN0IHJldHVyblR5cGVLZXkgPSBgJHtzb3VyY2VDbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gXG5cbiAgICBpZiAoIXJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMuaGFzKHJldHVyblR5cGVLZXkpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmV0dXJuVHlwZSA9IHJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMuZ2V0KHJldHVyblR5cGVLZXkpXG5cbiAgICBpZiAoIXJldHVyblR5cGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgSlNEb2MgcmV0dXJuIHR5cGUgZm9yICR7cmV0dXJuVHlwZUtleX1gKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcmV0dXJuVHlwZS50eXBlICE9IFwic3RyaW5nXCIgfHwgcmV0dXJuVHlwZS50eXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbm9uLWVtcHR5IEpTRG9jIHJldHVybiB0eXBlIGZvciAke3JldHVyblR5cGVLZXl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmV0dXJuVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgbWV0aG9kIHBhcmFtZXRlciB0eXBlLlxuICAgKiBAcGFyYW0ge3ttZXRob2ROYW1lOiBzdHJpbmcsIHBhcmFtZXRlckluZGV4OiBudW1iZXIsIHNvdXJjZUNsYXNzTmFtZTogc3RyaW5nfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gSlNEb2MgcGFyYW1ldGVyIHR5cGUgd2hlbiBkb2N1bWVudGVkLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlKHttZXRob2ROYW1lLCBwYXJhbWV0ZXJJbmRleCwgc291cmNlQ2xhc3NOYW1lfSkge1xuICAgIGNvbnN0IHBhcmFtZXRlcnMgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUGFyYW1ldGVycyh7bWV0aG9kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSlcblxuICAgIGlmICghcGFyYW1ldGVycykgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHBhcmFtZXRlciA9IHBhcmFtZXRlcnNbcGFyYW1ldGVySW5kZXhdXG5cbiAgICBpZiAocGFyYW1ldGVyID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsXG5cbiAgICBpZiAocGFyYW1ldGVyLnR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBub24tZW1wdHkgSlNEb2MgcGFyYW1ldGVyIHR5cGUgZm9yICR7c291cmNlQ2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9IHBhcmFtZXRlciAke3BhcmFtZXRlckluZGV4fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcmFtZXRlci50eXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcGFyYW1ldGVycy5cbiAgICogQHBhcmFtIHt7bWV0aG9kTmFtZTogc3RyaW5nLCBzb3VyY2VDbGFzc05hbWU6IHN0cmluZ319IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZVtdIHwgbnVsbD59IC0gSlNEb2MgcGFyYW1ldGVycyAobmFtZSArIHR5cGUpIHdoZW4gZG9jdW1lbnRlZC5cbiAgICovXG4gIGFzeW5jIHJlc291cmNlTWV0aG9kUGFyYW1ldGVycyh7bWV0aG9kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSkge1xuICAgIGNvbnN0IHJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMoKVxuICAgIGNvbnN0IHBhcmFtZXRlclR5cGVzS2V5ID0gYCR7c291cmNlQ2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YFxuXG4gICAgaWYgKCFyZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzLmhhcyhwYXJhbWV0ZXJUeXBlc0tleSkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwYXJhbWV0ZXJzID0gcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcy5nZXQocGFyYW1ldGVyVHlwZXNLZXkpXG5cbiAgICBpZiAoIXBhcmFtZXRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgSlNEb2MgcGFyYW1ldGVycyBmb3IgJHtwYXJhbWV0ZXJUeXBlc0tleX1gKVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbWV0ZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBSZXNvdXJjZU1ldGhvZFJldHVyblR5cGU+Pn0gLSBSZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGVzIGtleWVkIGJ5IENsYXNzTmFtZS5tZXRob2ROYW1lLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcygpIHtcbiAgICBpZiAodGhpcy5fcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcykgcmV0dXJuIHRoaXMuX3Jlc291cmNlTWV0aG9kUmV0dXJuVHlwZXNcblxuICAgIGNvbnN0IHNvdXJjZUZpbGVzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VGaWxlcygpXG4gICAgY29uc3QgcmV0dXJuVHlwZXMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBzb3VyY2VGaWxlcykge1xuICAgICAgY29uc3Qgc291cmNlVGV4dCA9IGF3YWl0IGZzLnJlYWRGaWxlKHNvdXJjZUZpbGUsIFwidXRmOFwiKVxuXG4gICAgICB0aGlzLmFkZFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXNGcm9tU291cmNlKHtyZXR1cm5UeXBlcywgc291cmNlRmlsZSwgc291cmNlVGV4dH0pXG4gICAgfVxuXG4gICAgdGhpcy5fcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcyA9IHJldHVyblR5cGVzXG5cbiAgICByZXR1cm4gcmV0dXJuVHlwZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIG1ldGhvZCBwYXJhbWV0ZXIgdHlwZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZVtdPj59IC0gUmVzb3VyY2UgbWV0aG9kIHBhcmFtZXRlcnMga2V5ZWQgYnkgQ2xhc3NOYW1lLm1ldGhvZE5hbWUuXG4gICAqL1xuICBhc3luYyByZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzKCkge1xuICAgIGlmICh0aGlzLl9yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzKSByZXR1cm4gdGhpcy5fcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlc1xuXG4gICAgY29uc3Qgc291cmNlRmlsZXMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxKc0RvY1NvdXJjZUZpbGVzKClcbiAgICBjb25zdCBwYXJhbWV0ZXJUeXBlcyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIHNvdXJjZUZpbGVzKSB7XG4gICAgICBjb25zdCBzb3VyY2VUZXh0ID0gYXdhaXQgZnMucmVhZEZpbGUoc291cmNlRmlsZSwgXCJ1dGY4XCIpXG5cbiAgICAgIHRoaXMuYWRkUmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlc0Zyb21Tb3VyY2Uoe3BhcmFtZXRlclR5cGVzLCBzb3VyY2VGaWxlLCBzb3VyY2VUZXh0fSlcbiAgICB9XG5cbiAgICB0aGlzLl9yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzID0gcGFyYW1ldGVyVHlwZXNcblxuICAgIHJldHVybiBwYXJhbWV0ZXJUeXBlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgSlNEb2Mgc291cmNlIGZpbGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gSmF2YVNjcmlwdCBzb3VyY2UgZmlsZXMgdGhhdCBjYW4gZGVmaW5lIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcyBhbmQgbW9kZWwgYWNjZXNzb3JzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRmlsZXMoKSB7XG4gICAgY29uc3Qgc291cmNlRmlsZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzb3VyY2VEaXJlY3Rvcnkgb2YgdGhpcy5mcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VEaXJlY3RvcmllcygpKSB7XG4gICAgICBzb3VyY2VGaWxlcy5wdXNoKC4uLmF3YWl0IHRoaXMuamF2YXNjcmlwdEZpbGVzSW5EaXJlY3Rvcnkoc291cmNlRGlyZWN0b3J5KSlcbiAgICB9XG5cbiAgICByZXR1cm4gc291cmNlRmlsZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIEpTRG9jIHNvdXJjZSBkaXJlY3Rvcmllcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNvdXJjZSBkaXJlY3RvcmllcyB0byBzY2FuIGZvciBnZW5lcmF0ZWQgZnJvbnRlbmQtbW9kZWwgSlNEb2MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VEaXJlY3RvcmllcygpIHtcbiAgICBjb25zdCBzb3VyY2VEaXJlY3RvcmllcyA9IG5ldyBTZXQoW3BhdGguam9pbih0aGlzLmRpcmVjdG9yeSgpLCBcInNyY1wiKV0pXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgICBpZiAodHlwZW9mIGJhY2tlbmRQcm9qZWN0LnBhdGggPT0gXCJzdHJpbmdcIiAmJiBiYWNrZW5kUHJvamVjdC5wYXRoLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc291cmNlRGlyZWN0b3JpZXMuYWRkKHBhdGguam9pbihiYWNrZW5kUHJvamVjdC5wYXRoLCBcInNyY1wiKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShzb3VyY2VEaXJlY3RvcmllcylcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIHJlc291cmNlIG1ldGhvZCByZXR1cm4gdHlwZXMgZnJvbSBzb3VyY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge01hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZT59IGFyZ3MucmV0dXJuVHlwZXMgLSBNdXRhYmxlIHJldHVybiB0eXBlcyBtYXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3Muc291cmNlRmlsZV0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zb3VyY2VUZXh0IC0gU291cmNlIHRleHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkUmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlc0Zyb21Tb3VyY2Uoe3JldHVyblR5cGVzLCBzb3VyY2VGaWxlID0gbnVsbCwgc291cmNlVGV4dH0pIHtcbiAgICBjb25zdCBjbGFzc1JlZ2V4ID0gL2NsYXNzXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXHMrKD86ZXh0ZW5kc1xccytbXntdKyk/XFx7L2dcbiAgICBjb25zdCBpbXBvcnRBbGlhc2VzID0gdGhpcy5qc0RvY0ltcG9ydEFsaWFzZXNGcm9tU291cmNlKHNvdXJjZVRleHQpXG4gICAgbGV0IGNsYXNzTWF0Y2hcblxuICAgIHdoaWxlICgoY2xhc3NNYXRjaCA9IGNsYXNzUmVnZXguZXhlYyhzb3VyY2VUZXh0KSkpIHtcbiAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IGNsYXNzTWF0Y2hbMV1cbiAgICAgIGNvbnN0IGNsYXNzQm9keVN0YXJ0ID0gY2xhc3NSZWdleC5sYXN0SW5kZXhcbiAgICAgIGNvbnN0IGNsYXNzQm9keUVuZCA9IHRoaXMubWF0Y2hpbmdCcmFjZUluZGV4KHtvcGVuSW5kZXg6IGNsYXNzQm9keVN0YXJ0IC0gMSwgc291cmNlVGV4dH0pXG5cbiAgICAgIGlmIChjbGFzc0JvZHlFbmQgPT0gbnVsbCkge1xuICAgICAgICAvLyBUaGUgYnJhY2UgbWF0Y2hlciBjYW4ndCB0b2tlbml6ZSBldmVyeSBjb25zdHJ1Y3QgKGUuZy4gYSByZWdleCBsaXRlcmFsXG4gICAgICAgIC8vIHdob3NlIHF1b3RlcyBsb29rIGxpa2Ugc3RyaW5nIGRlbGltaXRlcnMpLCBzbyBpdCBjYW4gZmFpbCB0byBsb2NhdGUgYVxuICAgICAgICAvLyBjbGFzcyBib2R5LiBTa2lwIG1ldGFkYXRhIGV4dHJhY3Rpb24gZm9yIHRoYXQgY2xhc3MgcmF0aGVyIHRoYW5cbiAgICAgICAgLy8gYWJvcnRpbmcgdGhlIHdob2xlIGZyb250ZW5kLW1vZGVsIGdlbmVyYXRpb247IHJlc291cmNlcyB0aGF0IHBhcnNlXG4gICAgICAgIC8vIGNsZWFubHkgc3RpbGwgZ2V0IHRoZWlyIEpTRG9jLWRlcml2ZWQgcmV0dXJuL3BhcmFtIHR5cGVzLlxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjbGFzc0JvZHkgPSBzb3VyY2VUZXh0LnNsaWNlKGNsYXNzQm9keVN0YXJ0LCBjbGFzc0JvZHlFbmQpXG4gICAgICBjb25zdCBqc0RvY1JlZ2V4ID0gL1xcL1xcKlxcKihbXFxzXFxTXSo/KVxcKlxcLy9nXG4gICAgICBsZXQganNEb2NNYXRjaFxuXG4gICAgICB3aGlsZSAoKGpzRG9jTWF0Y2ggPSBqc0RvY1JlZ2V4LmV4ZWMoY2xhc3NCb2R5KSkpIHtcbiAgICAgICAgY29uc3Qgc291cmNlQWZ0ZXJKc0RvYyA9IGNsYXNzQm9keS5zbGljZShqc0RvY1JlZ2V4Lmxhc3RJbmRleClcbiAgICAgICAgY29uc3QgbWV0aG9kTWF0Y2ggPSBzb3VyY2VBZnRlckpzRG9jLm1hdGNoKC9eXFxzKig/OmFzeW5jXFxzKyk/KFtBLVphLXpfJF1bXFx3JF0qKVxccypcXCgvKVxuXG4gICAgICAgIGlmICghbWV0aG9kTWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgbWV0aG9kTmFtZSA9IG1ldGhvZE1hdGNoWzFdXG5cbiAgICAgICAgY29uc3QgcmV0dXJuVHlwZSA9IHRoaXMuanNEb2NSZXR1cm5UeXBlKGpzRG9jTWF0Y2hbMV0pXG5cbiAgICAgICAgaWYgKHJldHVyblR5cGUpIHtcbiAgICAgICAgICByZXR1cm5UeXBlcy5zZXQoYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YCwge2ltcG9ydEFsaWFzZXMsIHNvdXJjZUZpbGUsIHR5cGU6IHJldHVyblR5cGV9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNsYXNzUmVnZXgubGFzdEluZGV4ID0gY2xhc3NCb2R5RW5kICsgMVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIHJlc291cmNlIG1ldGhvZCBwYXJhbWV0ZXIgdHlwZXMgZnJvbSBzb3VyY2UuXG4gICAqIEBwYXJhbSB7e3BhcmFtZXRlclR5cGVzOiBNYXA8c3RyaW5nLCBSZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVbXT4sIHNvdXJjZUZpbGU/OiBzdHJpbmcgfCBudWxsLCBzb3VyY2VUZXh0OiBzdHJpbmd9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXNGcm9tU291cmNlKHtwYXJhbWV0ZXJUeXBlcywgc291cmNlRmlsZSA9IG51bGwsIHNvdXJjZVRleHR9KSB7XG4gICAgY29uc3QgY2xhc3NSZWdleCA9IC9jbGFzc1xccysoW0EtWmEtel8kXVtcXHckXSopXFxzKyg/OmV4dGVuZHNcXHMrW157XSspP1xcey9nXG4gICAgY29uc3QgaW1wb3J0QWxpYXNlcyA9IHRoaXMuanNEb2NJbXBvcnRBbGlhc2VzRnJvbVNvdXJjZShzb3VyY2VUZXh0KVxuICAgIGxldCBjbGFzc01hdGNoXG5cbiAgICB3aGlsZSAoKGNsYXNzTWF0Y2ggPSBjbGFzc1JlZ2V4LmV4ZWMoc291cmNlVGV4dCkpKSB7XG4gICAgICBjb25zdCBjbGFzc05hbWUgPSBjbGFzc01hdGNoWzFdXG4gICAgICBjb25zdCBjbGFzc0JvZHlTdGFydCA9IGNsYXNzUmVnZXgubGFzdEluZGV4XG4gICAgICBjb25zdCBjbGFzc0JvZHlFbmQgPSB0aGlzLm1hdGNoaW5nQnJhY2VJbmRleCh7b3BlbkluZGV4OiBjbGFzc0JvZHlTdGFydCAtIDEsIHNvdXJjZVRleHR9KVxuXG4gICAgICBpZiAoY2xhc3NCb2R5RW5kID09IG51bGwpIHtcbiAgICAgICAgLy8gVGhlIGJyYWNlIG1hdGNoZXIgY2FuJ3QgdG9rZW5pemUgZXZlcnkgY29uc3RydWN0IChlLmcuIGEgcmVnZXggbGl0ZXJhbFxuICAgICAgICAvLyB3aG9zZSBxdW90ZXMgbG9vayBsaWtlIHN0cmluZyBkZWxpbWl0ZXJzKSwgc28gaXQgY2FuIGZhaWwgdG8gbG9jYXRlIGFcbiAgICAgICAgLy8gY2xhc3MgYm9keS4gU2tpcCBtZXRhZGF0YSBleHRyYWN0aW9uIGZvciB0aGF0IGNsYXNzIHJhdGhlciB0aGFuXG4gICAgICAgIC8vIGFib3J0aW5nIHRoZSB3aG9sZSBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uOyByZXNvdXJjZXMgdGhhdCBwYXJzZVxuICAgICAgICAvLyBjbGVhbmx5IHN0aWxsIGdldCB0aGVpciBKU0RvYy1kZXJpdmVkIHJldHVybi9wYXJhbSB0eXBlcy5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgY2xhc3NCb2R5ID0gc291cmNlVGV4dC5zbGljZShjbGFzc0JvZHlTdGFydCwgY2xhc3NCb2R5RW5kKVxuICAgICAgY29uc3QganNEb2NSZWdleCA9IC9cXC9cXCpcXCooW1xcc1xcU10qPylcXCpcXC8vZ1xuICAgICAgbGV0IGpzRG9jTWF0Y2hcblxuICAgICAgd2hpbGUgKChqc0RvY01hdGNoID0ganNEb2NSZWdleC5leGVjKGNsYXNzQm9keSkpKSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZUFmdGVySnNEb2MgPSBjbGFzc0JvZHkuc2xpY2UoanNEb2NSZWdleC5sYXN0SW5kZXgpXG4gICAgICAgIGNvbnN0IG1ldGhvZE1hdGNoID0gc291cmNlQWZ0ZXJKc0RvYy5tYXRjaCgvXlxccyooPzphc3luY1xccyspPyhbQS1aYS16XyRdW1xcdyRdKilcXHMqXFwoLylcblxuICAgICAgICBpZiAoIW1ldGhvZE1hdGNoKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBtZXRob2RNYXRjaFsxXVxuICAgICAgICBjb25zdCBqc0RvY1BhcmFtZXRlcnMgPSB0aGlzLmpzRG9jUGFyYW1ldGVycyhqc0RvY01hdGNoWzFdKVxuXG4gICAgICAgIGlmIChqc0RvY1BhcmFtZXRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHBhcmFtZXRlclR5cGVzLnNldChgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gLCBqc0RvY1BhcmFtZXRlcnMubWFwKChwYXJhbWV0ZXIpID0+ICh7Li4ucGFyYW1ldGVyLCBpbXBvcnRBbGlhc2VzLCBzb3VyY2VGaWxlfSkpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNsYXNzUmVnZXgubGFzdEluZGV4ID0gY2xhc3NCb2R5RW5kICsgMVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIEpTRG9jIGltcG9ydCBhbGlhc2VzIGZyb20gc291cmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc291cmNlVGV4dCAtIFNvdXJjZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7TWFwPHN0cmluZywgUmVzb3VyY2VKc0RvY0ltcG9ydEFsaWFzPn0gLSBJbXBvcnQgYWxpYXNlcyBrZXllZCBieSBsb2NhbCBuYW1lLlxuICAgKi9cbiAganNEb2NJbXBvcnRBbGlhc2VzRnJvbVNvdXJjZShzb3VyY2VUZXh0KSB7XG4gICAgY29uc3QgaW1wb3J0QWxpYXNlcyA9IG5ldyBNYXAoKVxuICAgIGNvbnN0IGltcG9ydFJlZ2V4ID0gL0BpbXBvcnRcXHMqXFx7XFxzKihbXn1dKz8pXFxzKlxcfVxccypmcm9tXFxzKltcIiddKFteXCInXSspW1wiJ10vZ1xuICAgIGxldCBpbXBvcnRNYXRjaFxuXG4gICAgd2hpbGUgKChpbXBvcnRNYXRjaCA9IGltcG9ydFJlZ2V4LmV4ZWMoc291cmNlVGV4dCkpKSB7XG4gICAgICBjb25zdCBpbXBvcnRMaXN0ID0gaW1wb3J0TWF0Y2hbMV1cbiAgICAgIGNvbnN0IHNwZWNpZmllciA9IGltcG9ydE1hdGNoWzJdXG5cbiAgICAgIGZvciAoY29uc3QgcmF3SW1wb3J0RW50cnkgb2YgaW1wb3J0TGlzdC5zcGxpdChcIixcIikpIHtcbiAgICAgICAgY29uc3QgaW1wb3J0RW50cnkgPSByYXdJbXBvcnRFbnRyeS50cmltKClcblxuICAgICAgICBpZiAoaW1wb3J0RW50cnkubGVuZ3RoIDwgMSkgY29udGludWVcblxuICAgICAgICBjb25zdCBlbnRyeU1hdGNoID0gaW1wb3J0RW50cnkubWF0Y2goL14oZGVmYXVsdHxbQS1aYS16XyRdW1xcdyRdKikoPzpcXHMrYXNcXHMrKFtBLVphLXpfJF1bXFx3JF0qKSk/JC8pXG5cbiAgICAgICAgaWYgKCFlbnRyeU1hdGNoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgcGFyc2UgSlNEb2MgQGltcG9ydCBlbnRyeTogJHtpbXBvcnRFbnRyeX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW1wb3J0ZWROYW1lID0gZW50cnlNYXRjaFsxXVxuICAgICAgICBjb25zdCBhbGlhc05hbWUgPSBlbnRyeU1hdGNoWzJdIHx8IGltcG9ydGVkTmFtZVxuXG4gICAgICAgIGltcG9ydEFsaWFzZXMuc2V0KGFsaWFzTmFtZSwge2ltcG9ydGVkTmFtZSwgc3BlY2lmaWVyfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaW1wb3J0QWxpYXNlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHJldHVybiB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ganNEb2NUZXh0IC0gSlNEb2MgdGV4dCBpbnNpZGUgY29tbWVudCBtYXJrZXJzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBKU0RvYyByZXR1cm4gdHlwZSB3aGVuIHByZXNlbnQuXG4gICAqL1xuICBqc0RvY1JldHVyblR5cGUoanNEb2NUZXh0KSB7XG4gICAgY29uc3QgcmV0dXJuc01hdGNoID0ganNEb2NUZXh0Lm1hdGNoKC9AcmV0dXJucz9cXHMqXFx7LylcblxuICAgIGlmICghcmV0dXJuc01hdGNoIHx8IHJldHVybnNNYXRjaC5pbmRleCA9PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdHlwZU9wZW5JbmRleCA9IHJldHVybnNNYXRjaC5pbmRleCArIHJldHVybnNNYXRjaFswXS5sZW5ndGggLSAxXG4gICAgY29uc3QgdHlwZUNsb3NlSW5kZXggPSB0aGlzLm1hdGNoaW5nQnJhY2VJbmRleCh7b3BlbkluZGV4OiB0eXBlT3BlbkluZGV4LCBzb3VyY2VUZXh0OiBqc0RvY1RleHR9KVxuXG4gICAgaWYgKHR5cGVDbG9zZUluZGV4ID09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IHBhcnNlIEpTRG9jIHJldHVybiB0eXBlIGZyb206ICR7anNEb2NUZXh0fWApXG4gICAgfVxuXG4gICAgY29uc3QgcmV0dXJuVHlwZSA9IHRoaXMubm9ybWFsaXplSnNEb2NUeXBlKGpzRG9jVGV4dC5zbGljZSh0eXBlT3BlbkluZGV4ICsgMSwgdHlwZUNsb3NlSW5kZXgpKVxuXG4gICAgaWYgKHJldHVyblR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBub24tZW1wdHkgSlNEb2MgcmV0dXJuIHR5cGUgaW46ICR7anNEb2NUZXh0fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJldHVyblR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsYXBzZXMgYSBKU0RvYyB0eXBlIHNwYW5uaW5nIG11bHRpcGxlIGNvbW1lbnQgbGluZXMgaW50byBhIHNpbmdsZSBsaW5lIHNvIGl0IGNhblxuICAgKiBiZSBlbWl0dGVkIGludG8gYW4gaW5saW5lIHR5cGUtYXNzZXJ0aW9uIGNhc3QuIEEgbXVsdGlsaW5lIGJhY2tlbmQgcmV0dXJuIHR5cGUga2VlcHNcbiAgICogaXRzIGxlYWRpbmcgY29udGludWF0aW9uIGFzdGVyaXNrcyBpbiB0aGUgY2FwdHVyZWQgc3Vic3RyaW5nLCB3aGljaCBhcmUgaW52YWxpZCBpbnNpZGVcbiAgICogYW4gaW5saW5lIGNhc3QgYW5kIG1ha2UgVHlwZVNjcmlwdCByZWFkIHRoZSBhc3NlcnRlZCB0eXBlIGFzIGB1bmRlZmluZWRgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ganNEb2NUeXBlIC0gUmF3IGNhcHR1cmVkIEpTRG9jIHR5cGUsIHBvc3NpYmx5IG11bHRpbGluZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTaW5nbGUtbGluZSBKU0RvYyB0eXBlLlxuICAgKi9cbiAgbm9ybWFsaXplSnNEb2NUeXBlKGpzRG9jVHlwZSkge1xuICAgIHJldHVybiBqc0RvY1R5cGUucmVwbGFjZSgvXFxzKlxcblxccypcXCo/WyBcXHRdKi9nLCBcIiBcIikudHJpbSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgcGFyYW1ldGVycy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVGV4dCAtIEpTRG9jIHRleHQgaW5zaWRlIGNvbW1lbnQgbWFya2Vycy5cbiAgICogQHJldHVybnMge0FycmF5PHtuYW1lOiBzdHJpbmcgfCBudWxsLCB0eXBlOiBzdHJpbmd9Pn0gLSBKU0RvYyBwYXJhbWV0ZXJzIChuYW1lICsgdHlwZSkgaW4gZGVjbGFyYXRpb24gb3JkZXIuXG4gICAqL1xuICBqc0RvY1BhcmFtZXRlcnMoanNEb2NUZXh0KSB7XG4gICAgY29uc3QgcGFyYW1ldGVycyA9IFtdXG4gICAgY29uc3QgcGFyYW1SZWdleCA9IC9AcGFyYW1cXHMqXFx7L2dcbiAgICBsZXQgX3BhcmFtTWF0Y2hcblxuICAgIHdoaWxlICgoX3BhcmFtTWF0Y2ggPSBwYXJhbVJlZ2V4LmV4ZWMoanNEb2NUZXh0KSkpIHtcbiAgICAgIGNvbnN0IHR5cGVPcGVuSW5kZXggPSBwYXJhbVJlZ2V4Lmxhc3RJbmRleCAtIDFcbiAgICAgIGNvbnN0IHR5cGVDbG9zZUluZGV4ID0gdGhpcy5tYXRjaGluZ0JyYWNlSW5kZXgoe29wZW5JbmRleDogdHlwZU9wZW5JbmRleCwgc291cmNlVGV4dDoganNEb2NUZXh0fSlcblxuICAgICAgaWYgKHR5cGVDbG9zZUluZGV4ID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgcGFyc2UgSlNEb2MgcGFyYW1ldGVyIHR5cGUgZnJvbTogJHtqc0RvY1RleHR9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdHlwZSA9IHRoaXMubm9ybWFsaXplSnNEb2NUeXBlKGpzRG9jVGV4dC5zbGljZSh0eXBlT3BlbkluZGV4ICsgMSwgdHlwZUNsb3NlSW5kZXgpKVxuXG4gICAgICBpZiAodHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbm9uLWVtcHR5IEpTRG9jIHBhcmFtZXRlciB0eXBlIGluOiAke2pzRG9jVGV4dH1gKVxuICAgICAgfVxuXG4gICAgICAvLyBBZnRlciB0aGUgY2xvc2luZyBicmFjZSB0aGUgcGFyYW1ldGVyIG5hbWUgZm9sbG93cyAob3B0aW9uYWxseSBicmFja2V0ZWRcbiAgICAgIC8vIGZvciBgQHBhcmFtIHt0eXBlfSBbbmFtZV1gKS4gQ2FwdHVyZSB0aGUgbGVhZGluZyBuYW1lIHRva2VuIOKAlCBpbmNsdWRpbmcgYW55XG4gICAgICAvLyBkb3R0ZWQgcGF0aCBzbyBvYmplY3QtcHJvcGVydHkgdGFncyBsaWtlIGBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXNzYWdlYCBzdGF5XG4gICAgICAvLyBkaXN0aW5ndWlzaGFibGUgZnJvbSB0aGUgdG9wLWxldmVsIGBAcGFyYW0ge29iamVjdH0gYXJnc2AgcGFyYW1ldGVyLlxuICAgICAgY29uc3QgbmFtZU1hdGNoID0ganNEb2NUZXh0LnNsaWNlKHR5cGVDbG9zZUluZGV4ICsgMSkubWF0Y2goL15cXHMqXFxbP1xccyooW0EtWmEtel8kXVtcXHckLl0qKS8pXG5cbiAgICAgIHBhcmFtZXRlcnMucHVzaCh7bmFtZTogbmFtZU1hdGNoID8gbmFtZU1hdGNoWzFdIDogbnVsbCwgdHlwZX0pXG4gICAgICBwYXJhbVJlZ2V4Lmxhc3RJbmRleCA9IHR5cGVDbG9zZUluZGV4ICsgMVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbWV0ZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqYXZhc2NyaXB0IGZpbGVzIGluIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpcmVjdG9yeSAtIERpcmVjdG9yeSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gSmF2YVNjcmlwdCBzb3VyY2UgZmlsZSBwYXRocy5cbiAgICovXG4gIGFzeW5jIGphdmFzY3JpcHRGaWxlc0luRGlyZWN0b3J5KGRpcmVjdG9yeSkge1xuICAgIGxldCBlbnRyaWVzXG5cbiAgICB0cnkge1xuICAgICAgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIoZGlyZWN0b3J5LCB7d2l0aEZpbGVUeXBlczogdHJ1ZX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciAmJiB0eXBlb2YgZXJyb3IgPT0gXCJvYmplY3RcIiAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiBlcnJvci5jb2RlID09PSBcIkVOT0VOVFwiKSByZXR1cm4gW11cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlUGF0aHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICBjb25zdCBlbnRyeVBhdGggPSBwYXRoLmpvaW4oZGlyZWN0b3J5LCBlbnRyeS5uYW1lKVxuXG4gICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICBmaWxlUGF0aHMucHVzaCguLi5hd2FpdCB0aGlzLmphdmFzY3JpcHRGaWxlc0luRGlyZWN0b3J5KGVudHJ5UGF0aCkpXG4gICAgICB9IGVsc2UgaWYgKGVudHJ5LmlzRmlsZSgpICYmIC9cXC4obWpzfGpzfGpzeHx0cykkLy50ZXN0KGVudHJ5Lm5hbWUpKSB7XG4gICAgICAgIGZpbGVQYXRocy5wdXNoKGVudHJ5UGF0aClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZVBhdGhzXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSBtYXRjaGluZyBjbG9zaW5nIGJyYWNlIHdoaWxlIHJlc3BlY3RpbmcgSmF2YVNjcmlwdCBzdHJpbmdzIGFuZCBjb21tZW50cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm9wZW5JbmRleCAtIE9wZW5pbmcgYnJhY2UgaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNvdXJjZVRleHQgLSBTb3VyY2UgdGV4dC5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gQ2xvc2luZyBicmFjZSBpbmRleCB3aGVuIGZvdW5kLlxuICAgKi9cbiAgbWF0Y2hpbmdCcmFjZUluZGV4KHtvcGVuSW5kZXgsIHNvdXJjZVRleHR9KSB7XG4gICAgaWYgKHNvdXJjZVRleHRbb3BlbkluZGV4XSAhPT0gXCJ7XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb3BlbmluZyBicmFjZSBhdCBpbmRleCAke29wZW5JbmRleH1gKVxuICAgIH1cblxuICAgIGxldCBkZXB0aCA9IDBcbiAgICBsZXQgaW5CbG9ja0NvbW1lbnQgPSBmYWxzZVxuICAgIGxldCBpbkxpbmVDb21tZW50ID0gZmFsc2VcbiAgICBsZXQgaW5TdHJpbmcgPSBcIlwiXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IG9wZW5JbmRleDsgaW5kZXggPCBzb3VyY2VUZXh0Lmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgY29uc3QgY2hhciA9IHNvdXJjZVRleHRbaW5kZXhdXG4gICAgICBjb25zdCBuZXh0Q2hhciA9IHNvdXJjZVRleHRbaW5kZXggKyAxXVxuICAgICAgY29uc3QgcHJldmlvdXNDaGFyID0gc291cmNlVGV4dFtpbmRleCAtIDFdXG5cbiAgICAgIGlmIChpbkxpbmVDb21tZW50KSB7XG4gICAgICAgIGlmIChjaGFyID09PSBcIlxcblwiKSBpbkxpbmVDb21tZW50ID0gZmFsc2VcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5CbG9ja0NvbW1lbnQpIHtcbiAgICAgICAgaWYgKGNoYXIgPT09IFwiKlwiICYmIG5leHRDaGFyID09PSBcIi9cIikge1xuICAgICAgICAgIGluQmxvY2tDb21tZW50ID0gZmFsc2VcbiAgICAgICAgICBpbmRleCsrXG4gICAgICAgIH1cblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5TdHJpbmcpIHtcbiAgICAgICAgaWYgKGNoYXIgPT09IGluU3RyaW5nICYmIHByZXZpb3VzQ2hhciAhPT0gXCJcXFxcXCIpIGluU3RyaW5nID0gXCJcIlxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIi9cIiAmJiBuZXh0Q2hhciA9PT0gXCIvXCIpIHtcbiAgICAgICAgaW5MaW5lQ29tbWVudCA9IHRydWVcbiAgICAgICAgaW5kZXgrK1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCIvXCIgJiYgbmV4dENoYXIgPT09IFwiKlwiKSB7XG4gICAgICAgIGluQmxvY2tDb21tZW50ID0gdHJ1ZVxuICAgICAgICBpbmRleCsrXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIlxcXCJcIiB8fCBjaGFyID09PSBcIidcIiB8fCBjaGFyID09PSBcImBcIikge1xuICAgICAgICBpblN0cmluZyA9IGNoYXJcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICAgIGRlcHRoKytcbiAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgICAgZGVwdGgtLVxuXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCkgcmV0dXJuIGluZGV4XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIG1vZGVsIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGx9IC0gQXR0cmlidXRlIGNvbmZpZyBpbmZlcnJlZCBmcm9tIHRoZSBiYWNrZW5kIG1vZGVsIHdoZW4gYXZhaWxhYmxlLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JNb2RlbEF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKCFyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiBudWxsXG5cbiAgICBsZXQgY29sdW1uTmFtZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJ1c2VkIGJlZm9yZSBpbml0aWFsaXphdGlvblwiKSkgcmV0dXJuIG51bGxcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgbGV0IGNvbHVtblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbHVtbiA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKFwidXNlZCBiZWZvcmUgaW5pdGlhbGl6YXRpb25cIikpIHJldHVybiBudWxsXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbHVtbiA/IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JDb2x1bW4oe2NvbHVtbn0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgY29sdW1uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29sdW1uIC0gRGF0YWJhc2UgY29sdW1uLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWd9IC0gQXR0cmlidXRlIGNvbmZpZyBpbmZlcnJlZCBmcm9tIHRoZSBkYXRhYmFzZSBjb2x1bW4uXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckNvbHVtbih7Y29sdW1ufSkge1xuICAgIGNvbnN0IHR5cGUgPSBjb2x1bW4uZ2V0VHlwZSgpXG5cbiAgICBpZiAodHlwZW9mIHR5cGUgIT0gXCJzdHJpbmdcIiB8fCB0eXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbm9uLWVtcHR5IGNvbHVtbiB0eXBlIGZvciBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgaW5mZXJlbmNlLCBnb3Q6ICR7dHlwZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBudWxsOiBjb2x1bW4uZ2V0TnVsbCgpLFxuICAgICAgdHlwZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcHMgZm9yIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLm1vZGVsQ29uZmlnIC0gTW9kZWwgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IFthcmdzLnJlc291cmNlQ2xhc3NdIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7YXV0b2xvYWQ6IGJvb2xlYW4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdGFyZ2V0Q2xhc3NOYW1lOiBzdHJpbmcsIHRhcmdldEZpbGVOYW1lOiBzdHJpbmcsIHR5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9Pn0gLSBSZWxhdGlvbnNoaXBzLlxuICAgKi9cbiAgcmVsYXRpb25zaGlwc0Zvck1vZGVsKHtjbGFzc05hbWUsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBtb2RlbENvbmZpZy5yZWxhdGlvbnNoaXBzXG5cbiAgICBpZiAocmVsYXRpb25zaGlwcyA9PT0gdW5kZWZpbmVkIHx8IHJlbGF0aW9uc2hpcHMgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBbXVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAnJHtjbGFzc05hbWV9JyBoYXMgaW52YWxpZCByZWxhdGlvbnNoaXBzIGNvbmZpZyDigJQgbXVzdCBiZSBhbiBhcnJheSBvZiByZWxhdGlvbnNoaXAgbmFtZXMsIGdvdCAke3R5cGVvZiByZWxhdGlvbnNoaXBzfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcHMubWFwKChyZWxhdGlvbnNoaXBOYW1lKSA9PiB0aGlzLmluZmVycmVkUmVsYXRpb25zaGlwRGVmaW5pdGlvbih7Y2xhc3NOYW1lLCByZWxhdGlvbnNoaXBOYW1lLCByZXNvdXJjZUNsYXNzfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmZlcnJlZCByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IFthcmdzLnJlc291cmNlQ2xhc3NdIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt7YXV0b2xvYWQ6IGJvb2xlYW4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdGFyZ2V0Q2xhc3NOYW1lOiBzdHJpbmcsIHRhcmdldEZpbGVOYW1lOiBzdHJpbmcsIHR5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9fSBJbmZlcnJlZCByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICovXG4gIGluZmVycmVkUmVsYXRpb25zaGlwRGVmaW5pdGlvbih7Y2xhc3NOYW1lLCByZWxhdGlvbnNoaXBOYW1lLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzID8gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKCkgOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRNb2RlbENsYXNzKGNsYXNzTmFtZSlcblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwVHlwZSA9IHJlbGF0aW9uc2hpcC5nZXRUeXBlKClcblxuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlICE9PSBcImJlbG9uZ3NUb1wiICYmIHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiaGFzT25lXCIgJiYgcmVsYXRpb25zaGlwVHlwZSAhPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJyR7Y2xhc3NOYW1lfScgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9JyBoYXMgdW5zdXBwb3J0ZWQgdHlwZSAnJHtyZWxhdGlvbnNoaXBUeXBlfSdgKVxuICAgIH1cblxuICAgIGxldCB0YXJnZXRDbGFzc05hbWVcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICB0YXJnZXRDbGFzc05hbWUgPSB0YXJnZXRNb2RlbENsYXNzPy5nZXRNb2RlbE5hbWUoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTW9kZWwgY2xhc3Mgbm90IHJlZ2lzdGVyZWQgeWV0IOKAlCBmYWxsIGJhY2sgdG8gY2xhc3NOYW1lIGZyb20gcmVsYXRpb25zaGlwIGRlZmluaXRpb25cbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldENsYXNzTmFtZSkge1xuICAgICAgdGFyZ2V0Q2xhc3NOYW1lID0gcmVsYXRpb25zaGlwLmNsYXNzTmFtZVxuXG4gICAgICBpZiAoIXRhcmdldENsYXNzTmFtZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICcke2NsYXNzTmFtZX0nIHJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXBOYW1lfScgaGFzIG5vIHRhcmdldCBtb2RlbCBjbGFzc2ApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGF1dG9sb2FkOiByZWxhdGlvbnNoaXAuZ2V0QXV0b2xvYWQoKSxcbiAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICB0YXJnZXRDbGFzc05hbWUsXG4gICAgICB0YXJnZXRGaWxlTmFtZTogaW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKHRhcmdldENsYXNzTmFtZSkpLFxuICAgICAgdHlwZTogcmVsYXRpb25zaGlwVHlwZVxuICAgIH1cbiAgfVxufVxuIl19
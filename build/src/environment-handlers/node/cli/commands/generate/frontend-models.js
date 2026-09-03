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
                fileContent += `        ${attachmentName}: {type: ${JSON.stringify(attachmentType)}},\n`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL2dlbmVyYXRlL2Zyb250ZW5kLW1vZGVscy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSxvQ0FBb0MsQ0FBQTtBQUM1RCxPQUFPLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDNUIsT0FBTyxtQkFBbUIsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1RCxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLDhCQUE4QixFQUFFLG1EQUFtRCxFQUFDLE1BQU0sc0RBQXNELENBQUE7QUFDeEosT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGdEQUFnRCxFQUFDLE1BQU0sdURBQXVELENBQUE7QUFFaEs7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNIOzs7R0FHRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUNILE1BQU0sa0NBQWtDLEdBQUcsb0NBQW9DLENBQUE7QUFFL0UsbUdBQW1HO0FBQ25HLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0JBQXlCLFNBQVEsV0FBVztJQUMvRCwyREFBMkQ7SUFDM0QsMEJBQTBCLEdBQUcsSUFBSSxDQUFBO0lBRWpDLGdFQUFnRTtJQUNoRSw2QkFBNkIsR0FBRyxJQUFJLENBQUE7SUFFcEM7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUM3QyxNQUFNLGVBQWUsR0FBRyxhQUFhLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtRQUUxRCxNQUFNLGFBQWEsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRXRDLE1BQU0sa0JBQWtC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RUFBRSxZQUFZLENBQUMsV0FBVyxFQUFFO1lBQ3BDLGdCQUFnQjtZQUNoQixlQUFlO1lBQ2YsY0FBYyxFQUFFLFVBQVUsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUM1RSxJQUFJLEVBQUUsZ0JBQWdCO1NBQ3ZCLENBQUE7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgZ2VuZXJhdGVkRmlsZUJhbm5lciBmcm9tIFwiLi9nZW5lcmF0ZWQtZmlsZS1iYW5uZXIuanNcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlSXNCdWlsdEluLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9mcm9udGVuZC1tb2RlbHMvYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9ufSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vZnJvbnRlbmQtbW9kZWxzL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuXG4vKipcbiAqIEF0dHJpYnV0ZSBtZXRhZGF0YSB1c2VkIGZvciBnZW5lcmF0ZWQgZnJvbnRlbmQtbW9kZWwgSlNEb2MuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ1xuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0eXBlXSAtIENvbHVtbiB0eXBlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb2x1bW5UeXBlXSAtIENvbHVtbiB0eXBlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtzcWxUeXBlXSAtIFNRTCB0eXBlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkYXRhVHlwZV0gLSBEYXRhIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2pzRG9jVHlwZV0gLSBFeGFjdCBKU0RvYyB0eXBlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtuYW1lXSAtIEF0dHJpYnV0ZSBuYW1lIHdoZW4gY29uZmlndXJlZCBhcyBhbiBhcnJheSBlbnRyeS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW251bGxdIC0gV2hldGhlciBudWxsIGlzIGFsbG93ZWQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzZWxlY3RlZEJ5RGVmYXVsdF0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgaXMgc2VsZWN0ZWQgYnkgZGVmYXVsdC5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gc3RyaW5nfSBbZ2V0VHlwZV0gLSBSZXR1cm5zIGNvbHVtbiB0eXBlLlxuICogQHByb3BlcnR5IHsoKSA9PiBib29sZWFufSBbZ2V0TnVsbF0gLSBSZXR1cm5zIHdoZXRoZXIgbnVsbCBpcyBhbGxvd2VkLlxuICovXG4vKipcbiAqIFBlcm1pdCBzcGVjIHJldHVybmVkIGJ5IGZyb250ZW5kLW1vZGVsIHJlc291cmNlcyBkdXJpbmcgZ2VuZXJhdGlvbi5cbiAqIEB0eXBlZGVmIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsR2VuZXJhdG9yUGVybWl0U3BlYz4+fSBGcm9udGVuZE1vZGVsR2VuZXJhdG9yUGVybWl0U3BlY1xuICovXG4vKipcbiAqIEpTRG9jIGltcG9ydCBhbGlhcyBleHRyYWN0ZWQgZnJvbSBhIGJhY2tlbmQgcmVzb3VyY2Ugc291cmNlIGZpbGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZXNvdXJjZUpzRG9jSW1wb3J0QWxpYXNcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpbXBvcnRlZE5hbWUgLSBFeHBvcnRlZCB0eXBlIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc3BlY2lmaWVyIC0gSW1wb3J0IHNwZWNpZmllciBmcm9tIHRoZSBzb3VyY2UgZmlsZS5cbiAqL1xuLyoqXG4gKiBKU0RvYyByZXR1cm4gdHlwZSBleHRyYWN0ZWQgZnJvbSBhIGJhY2tlbmQgcmVzb3VyY2UgbWV0aG9kLlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlXG4gKiBAcHJvcGVydHkge01hcDxzdHJpbmcsIFJlc291cmNlSnNEb2NJbXBvcnRBbGlhcz59IGltcG9ydEFsaWFzZXMgLSBJbXBvcnQgYWxpYXNlcyB2aXNpYmxlIGluIHRoZSBzb3VyY2UgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gc291cmNlRmlsZSAtIFNvdXJjZSBmaWxlIHRoYXQgZGVjbGFyZWQgdGhlIG1ldGhvZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0eXBlIC0gSlNEb2MgcmV0dXJuIHR5cGUuXG4gKi9cbi8qKlxuICogSlNEb2MgcGFyYW1ldGVyIHR5cGUgZXh0cmFjdGVkIGZyb20gYSBiYWNrZW5kIHJlc291cmNlIG1ldGhvZC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZVxuICogQHByb3BlcnR5IHtNYXA8c3RyaW5nLCBSZXNvdXJjZUpzRG9jSW1wb3J0QWxpYXM+fSBpbXBvcnRBbGlhc2VzIC0gSW1wb3J0IGFsaWFzZXMgdmlzaWJsZSBpbiB0aGUgc291cmNlIGZpbGUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IG5hbWUgLSBQYXJhbWV0ZXIgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gc291cmNlRmlsZSAtIFNvdXJjZSBmaWxlIHRoYXQgZGVjbGFyZWQgdGhlIG1ldGhvZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0eXBlIC0gSlNEb2MgcGFyYW1ldGVyIHR5cGUuXG4gKi9cbmNvbnN0IEZST05URU5EX01PREVMU19SRUdFTkVSQVRFX0NPTU1BTkQgPSBcInZlbG9jaW91cyBnZW5lcmF0ZTpmcm9udGVuZC1tb2RlbHNcIlxuXG4vKiogTm9kZSBDTEkgY29tbWFuZCB0aGF0IGdlbmVyYXRlcyBmcm9udGVuZCBtb2RlbCBjbGFzc2VzIGZyb20gYmFja2VuZCBwcm9qZWN0IHJlc291cmNlIGNvbmZpZy4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIERiR2VuZXJhdGVGcm9udGVuZE1vZGVscyBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBSZXNvdXJjZU1ldGhvZFJldHVyblR5cGU+IHwgbnVsbH0gKi9cbiAgX3Jlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMgPSBudWxsXG5cbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBSZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVbXT4gfCBudWxsfSAqL1xuICBfcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcyA9IG51bGxcblxuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGZpbGVzIGFyZSBnZW5lcmF0ZWQuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGJhY2tlbmRQcm9qZWN0cyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKClcblxuICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZU1vZGVscygpXG5cbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAodHlwZW9mIGVudmlyb25tZW50SGFuZGxlci5hdXRvRGlzY292ZXJSZXNvdXJjZXMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLmF1dG9EaXNjb3ZlclJlc291cmNlcyhjb25maWd1cmF0aW9uKVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShiYWNrZW5kUHJvamVjdHMpIHx8IGJhY2tlbmRQcm9qZWN0cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGJhY2tlbmQgcHJvamVjdHMgY29uZmlndXJlZC4gQ29uZmlndXJlICdiYWNrZW5kUHJvamVjdHMnIGluIHlvdXIgY29uZmlndXJhdGlvbiBmaXJzdFwiKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEVuc3VyZWQgZGlyZWN0b3JpZXMuXG4gICAgICogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGVuc3VyZWREaXJlY3RvcmllcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlZCBtb2RlbCBuYW1lcyBieSBkaXJlY3RvcnkuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIFNldDxzdHJpbmc+Pn0gKi9cbiAgICBjb25zdCBnZW5lcmF0ZWRNb2RlbE5hbWVzQnlEaXJlY3RvcnkgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBHZW5lcmF0ZWQgZmlsZXMgYnkgZGlyZWN0b3J5LlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBBcnJheTx7Y2xhc3NOYW1lOiBzdHJpbmcsIGZpbGVOYW1lOiBzdHJpbmd9Pj59ICovXG4gICAgY29uc3QgZ2VuZXJhdGVkRmlsZXNCeURpcmVjdG9yeSA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIC8vIENhbm9uaWNhbGl6ZSB0aGUgb3V0cHV0IGRpcmVjdG9yeSBzbyBlcXVpdmFsZW50IHNwZWxsaW5ncyAoYSB0cmFpbGluZ1xuICAgICAgLy8gc2xhc2gsIGAuYC9gLi5gIHNlZ21lbnRzLCBkdXBsaWNhdGUgc2VwYXJhdG9ycywgcmVsYXRpdmUgdnMgYWJzb2x1dGUpXG4gICAgICAvLyByZXNvbHZlIHRvIGEgc2luZ2xlIGtleS4gT3RoZXJ3aXNlIHRoZSBwZXItZGlyZWN0b3J5IG1hcHMgYmVsb3cgdHJlYXRcbiAgICAgIC8vIHRoZW0gYXMgZGlmZmVyZW50IGRpcmVjdG9yaWVzLCBkdXBsaWNhdGUgY2xhc3MgbmFtZXMgc2xpcCBwYXN0IGRldGVjdGlvbixcbiAgICAgIC8vIGFuZCB0aGUgc3BsaXQgYnVja2V0cyB3cml0ZSBpbmNvbXBsZXRlIGluZGV4LmpzL3NldHVwLmpzIGZvciBmaWxlcyB0aGF0XG4gICAgICAvLyBhY3R1YWxseSBsYW5kIGluIHRoZSBzYW1lIGRpcmVjdG9yeSBvbiBkaXNrLlxuICAgICAgY29uc3QgZnJvbnRlbmRNb2RlbHNEaXIgPSBwYXRoLnJlc29sdmUodGhpcy5mcm9udGVuZE1vZGVsc0RpcmVjdG9yeUZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KSlcbiAgICAgIGNvbnN0IGltcG9ydFBhdGggPSB0aGlzLmltcG9ydFBhdGhGb3JGcm9udGVuZE1vZGVsc0RpcmVjdG9yeShmcm9udGVuZE1vZGVsc0RpcilcblxuICAgICAgaWYgKCFlbnN1cmVkRGlyZWN0b3JpZXMuaGFzKGZyb250ZW5kTW9kZWxzRGlyKSkge1xuICAgICAgICBhd2FpdCBmcy5ta2Rpcihmcm9udGVuZE1vZGVsc0Rpciwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgICAgIGVuc3VyZWREaXJlY3Rvcmllcy5hZGQoZnJvbnRlbmRNb2RlbHNEaXIpXG4gICAgICB9XG5cbiAgICAgIGlmICghZ2VuZXJhdGVkRmlsZXNCeURpcmVjdG9yeS5oYXMoZnJvbnRlbmRNb2RlbHNEaXIpKSB7XG4gICAgICAgIGdlbmVyYXRlZEZpbGVzQnlEaXJlY3Rvcnkuc2V0KGZyb250ZW5kTW9kZWxzRGlyLCBbXSlcbiAgICAgIH1cblxuICAgICAgaWYgKCFnZW5lcmF0ZWRNb2RlbE5hbWVzQnlEaXJlY3RvcnkuaGFzKGZyb250ZW5kTW9kZWxzRGlyKSkge1xuICAgICAgICBnZW5lcmF0ZWRNb2RlbE5hbWVzQnlEaXJlY3Rvcnkuc2V0KGZyb250ZW5kTW9kZWxzRGlyLCBuZXcgU2V0KCkpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGdlbmVyYXRlZEZpbGVzID0gZ2VuZXJhdGVkRmlsZXNCeURpcmVjdG9yeS5nZXQoZnJvbnRlbmRNb2RlbHNEaXIpXG4gICAgICBjb25zdCBnZW5lcmF0ZWRNb2RlbE5hbWVzID0gZ2VuZXJhdGVkTW9kZWxOYW1lc0J5RGlyZWN0b3J5LmdldChmcm9udGVuZE1vZGVsc0RpcilcblxuICAgICAgaWYgKCFnZW5lcmF0ZWRGaWxlcykgdGhyb3cgbmV3IEVycm9yKGBHZW5lcmF0ZWQgZmlsZXMgbGlzdCBtaXNzaW5nIGZvciAke2Zyb250ZW5kTW9kZWxzRGlyfWApXG4gICAgICBpZiAoIWdlbmVyYXRlZE1vZGVsTmFtZXMpIHRocm93IG5ldyBFcnJvcihgR2VuZXJhdGVkIG1vZGVsIG5hbWVzIHNldCBtaXNzaW5nIGZvciAke2Zyb250ZW5kTW9kZWxzRGlyfWApXG4gICAgICBjb25zdCByZXNvdXJjZXMgPSB0aGlzLnJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuICAgICAgY29uc3QgYXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMgPSB0aGlzLmF2YWlsYWJsZUZyb250ZW5kTW9kZWxDbGFzc05hbWVzKHJlc291cmNlcylcblxuICAgICAgZm9yIChjb25zdCBtb2RlbENsYXNzTmFtZSBpbiByZXNvdXJjZXMpIHtcbiAgICAgICAgY29uc3QgbW9kZWxDb25maWcgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VzW21vZGVsQ2xhc3NOYW1lXSlcbiAgICAgICAgY29uc3QgY2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtb2RlbENsYXNzTmFtZS5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIikpXG4gICAgICAgIGNvbnN0IGZpbGVOYW1lID0gYCR7aW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKGNsYXNzTmFtZSkpfS5qc2BcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSBgJHtmcm9udGVuZE1vZGVsc0Rpcn0vJHtmaWxlTmFtZX1gXG5cbiAgICAgICAgaWYgKCFtb2RlbENvbmZpZykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBkZWZpbml0aW9uIGZvciAnJHtjbGFzc05hbWV9J2ApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNvbHZlZFJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlc1ttb2RlbENsYXNzTmFtZV0pXG4gICAgICAgIC8vIEFuIGFic3RyYWN0IGJhc2UgcmVzb3VyY2UgKG5vIHN0YXRpYyBNb2RlbENsYXNzIOKAlCBlLmcuIGFuIGFwcCdzIHNoYXJlZFxuICAgICAgICAvLyBgQmFzZVJlc291cmNlYCB0aGF0IG90aGVyIHJlc291cmNlcyBleHRlbmQpIGNhbid0IGJhY2sgYSBnZW5lcmF0ZWRcbiAgICAgICAgLy8gZnJvbnRlbmQgbW9kZWwuIFRyZWF0IGl0IGFzIHJlc291cmNlLWxlc3Mgc28gdGhlIGdlbmVyYXRvciBmYWxscyBiYWNrXG4gICAgICAgIC8vIHRvIGJ5LW5hbWUgbW9kZWwgbG9va3VwICsgZW1wdHkgd3JpdGUgcGFyYW1zIGluc3RlYWQgb2YgdGhyb3dpbmcgd2hlblxuICAgICAgICAvLyBpdCBlYWdlcmx5IGNhbGxzIGBtb2RlbENsYXNzKClgIC8gYHBlcm1pdHRlZFBhcmFtcygpYCBvbiBpdC5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IHJlc29sdmVkUmVzb3VyY2VDbGFzcyAmJiByZXNvbHZlZFJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcyA/IHJlc29sdmVkUmVzb3VyY2VDbGFzcyA6IG51bGxcblxuICAgICAgICB0aGlzLnZhbGlkYXRlTW9kZWxDb25maWcoe2F2YWlsYWJsZUZyb250ZW5kTW9kZWxDbGFzc05hbWVzLCBjbGFzc05hbWUsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSlcblxuICAgICAgICBpZiAoZ2VuZXJhdGVkTW9kZWxOYW1lcy5oYXMoY2xhc3NOYW1lKSkge1xuICAgICAgICAgIGlmIChmcm9udGVuZE1vZGVsUmVzb3VyY2VJc0J1aWx0SW4oe21vZGVsTmFtZTogbW9kZWxDbGFzc05hbWUsIHJlc291cmNlRGVmaW5pdGlvbjogcmVzb3VyY2VzW21vZGVsQ2xhc3NOYW1lXX0pKSB7XG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRHVwbGljYXRlIGZyb250ZW5kIG1vZGVsIGRlZmluaXRpb24gZm9yICcke2NsYXNzTmFtZX0nYClcbiAgICAgICAgfVxuXG4gICAgICAgIGdlbmVyYXRlZE1vZGVsTmFtZXMuYWRkKGNsYXNzTmFtZSlcblxuICAgICAgICBjb25zdCBmaWxlQ29udGVudCA9IGF3YWl0IHRoaXMuYnVpbGRNb2RlbEZpbGVDb250ZW50KHtcbiAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoOiBmaWxlUGF0aCxcbiAgICAgICAgICBpbXBvcnRQYXRoLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHJlc291cmNlQ2xhc3MgPyByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKSA6IGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClbY2xhc3NOYW1lXSxcbiAgICAgICAgICBtb2RlbENvbmZpZyxcbiAgICAgICAgICByZXNvdXJjZUNsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGZpbGVQYXRoLCBmaWxlQ29udGVudClcbiAgICAgICAgZ2VuZXJhdGVkRmlsZXMucHVzaCh7Y2xhc3NOYW1lLCBmaWxlTmFtZX0pXG5cbiAgICAgICAgY29uc29sZS5sb2coYGNyZWF0ZSBzcmMvZnJvbnRlbmQtbW9kZWxzLyR7ZmlsZU5hbWV9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtmcm9udGVuZE1vZGVsc0RpciwgZ2VuZXJhdGVkRmlsZXNdIG9mIGdlbmVyYXRlZEZpbGVzQnlEaXJlY3RvcnkpIHtcbiAgICAgIC8vIFRoZSBpbmRleC5qcyBiYXJyZWwgaXMgbm8gbG9uZ2VyIGdlbmVyYXRlZCDigJQgbm90aGluZyBpbXBvcnRzIGl0IChtb2RlbHMgYXJlXG4gICAgICAvLyBpbXBvcnRlZCBieSBmaWxlIHBhdGgsIGFuZCBzZXR1cC5qcyBwZXJmb3JtcyB0aGUgcmVnaXN0cmF0aW9uIHNpZGUtZWZmZWN0cykuXG4gICAgICAvLyBSZW1vdmUgYW55IHN0YWxlIG9uZSBsZWZ0IGZyb20gYW4gb2xkZXIgZ2VuZXJhdG9yLlxuICAgICAgYXdhaXQgZnMucm0oYCR7ZnJvbnRlbmRNb2RlbHNEaXJ9L2luZGV4LmpzYCwge2ZvcmNlOiB0cnVlfSlcblxuICAgICAgY29uc3Qgc2V0dXBDb250ZW50ID0gdGhpcy5idWlsZFNldHVwRmlsZUNvbnRlbnQoZ2VuZXJhdGVkRmlsZXMpXG5cbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShgJHtmcm9udGVuZE1vZGVsc0Rpcn0vc2V0dXAuanNgLCBzZXR1cENvbnRlbnQpXG5cbiAgICAgIGNvbnNvbGUubG9nKFwiY3JlYXRlIHNyYy9mcm9udGVuZC1tb2RlbHMvc2V0dXAuanNcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB2YWxpZGF0ZSBtb2RlbCBjb25maWcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBhcmdzLmF2YWlsYWJsZUZyb250ZW5kTW9kZWxDbGFzc05hbWVzIC0gQXZhaWxhYmxlIGZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWVzIGluIGJhY2tlbmQgcHJvamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLm1vZGVsQ29uZmlnIC0gTW9kZWwgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IFthcmdzLnJlc291cmNlQ2xhc3NdIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHZhbGlkYXRlTW9kZWxDb25maWcoe2F2YWlsYWJsZUZyb250ZW5kTW9kZWxDbGFzc05hbWVzLCBjbGFzc05hbWUsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGNvbnN0IGFiaWxpdGllcyA9IG1vZGVsQ29uZmlnLmFiaWxpdGllc1xuXG4gICAgaWYgKCFhYmlsaXRpZXMgfHwgdHlwZW9mIGFiaWxpdGllcyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAnJHtjbGFzc05hbWV9JyBpcyBtaXNzaW5nIHJlcXVpcmVkICdhYmlsaXRpZXMnIGNvbmZpZ2ApXG4gICAgfVxuXG4gICAgY29uc3QgcmVhZEFjdGlvbnMgPSBbXG4gICAgICB7YWN0aW9uOiBcImluZGV4XCIsIGFiaWxpdHlBY3Rpb246IGFiaWxpdGllcy5pbmRleH0sXG4gICAgICB7YWN0aW9uOiBcImZpbmRcIiwgYWJpbGl0eUFjdGlvbjogYWJpbGl0aWVzLmZpbmR9XG4gICAgXVxuXG4gICAgZm9yIChjb25zdCB7YWN0aW9uLCBhYmlsaXR5QWN0aW9ufSBvZiByZWFkQWN0aW9ucykge1xuICAgICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFiaWxpdHlBY3Rpb24ubGVuZ3RoIDwgMSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICcke2NsYXNzTmFtZX0nIGlzIG1pc3NpbmcgcmVxdWlyZWQgYWJpbGl0aWVzLiR7YWN0aW9ufSBjb25maWdgKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBtb2RlbENvbmZpZy5yZWxhdGlvbnNoaXBzXG5cbiAgICBpZiAocmVsYXRpb25zaGlwcyA9PT0gdW5kZWZpbmVkKSByZXR1cm5cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRSZWxhdGlvbnNoaXBzID0gdGhpcy5yZWxhdGlvbnNoaXBzRm9yTW9kZWwoe2NsYXNzTmFtZSwgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2Ygbm9ybWFsaXplZFJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGlmICghYXZhaWxhYmxlRnJvbnRlbmRNb2RlbENsYXNzTmFtZXMuaGFzKHJlbGF0aW9uc2hpcC50YXJnZXRDbGFzc05hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJyR7Y2xhc3NOYW1lfScgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfScgcmVmZXJlbmNlcyAnJHtyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lfScsIGJ1dCBubyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBleGlzdHMgZm9yIHRoYXQgdGFyZ2V0IGluIHRoaXMgYmFja2VuZCBwcm9qZWN0YClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZXMgZm9yIGJhY2tlbmQgcHJvamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uPn0gLSBSZXNvdXJjZSBkZWZpbml0aW9ucyBrZXllZCBieSBtb2RlbCBjbGFzcyBuYW1lLlxuICAgKi9cbiAgcmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpIHtcbiAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXZhaWxhYmxlIGZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbj59IHJlc291cmNlcyAtIFJlc291cmNlIGNvbmZpZ3VyYXRpb24ga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIEF2YWlsYWJsZSBmcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lcy5cbiAgICovXG4gIGF2YWlsYWJsZUZyb250ZW5kTW9kZWxDbGFzc05hbWVzKHJlc291cmNlcykge1xuICAgIC8qKlxuICAgICAqIENsYXNzIG5hbWVzLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBjbGFzc05hbWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHJlc291cmNlTW9kZWxOYW1lIGluIHJlc291cmNlcykge1xuICAgICAgY2xhc3NOYW1lcy5hZGQoaW5mbGVjdGlvbi5jYW1lbGl6ZShyZXNvdXJjZU1vZGVsTmFtZS5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIikpKVxuICAgIH1cblxuICAgIHJldHVybiBjbGFzc05hbWVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbHMgZGlyZWN0b3J5IGZvciBiYWNrZW5kIHByb2plY3QuXG4gICAqIEBwYXJhbSB7e2Zyb250ZW5kTW9kZWxzT3V0cHV0UGF0aD86IHN0cmluZ319IGJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBYnNvbHV0ZSBmcm9udGVuZCBtb2RlbHMgb3V0cHV0IGRpcmVjdG9yeS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxzRGlyZWN0b3J5Rm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpIHtcbiAgICBjb25zdCBvdXRwdXRQYXRoID0gYmFja2VuZFByb2plY3QuZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoIHx8IHRoaXMuZGlyZWN0b3J5KClcblxuICAgIHJldHVybiBgJHtvdXRwdXRQYXRofS9zcmMvZnJvbnRlbmQtbW9kZWxzYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IHBhdGggZm9yIGZyb250ZW5kIG1vZGVscyBkaXJlY3RvcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmcm9udGVuZE1vZGVsc0RpciAtIEZyb250ZW5kIG1vZGVscyBvdXRwdXQgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJhc2UgY2xhc3MgaW1wb3J0IHBhdGguXG4gICAqL1xuICBpbXBvcnRQYXRoRm9yRnJvbnRlbmRNb2RlbHNEaXJlY3RvcnkoZnJvbnRlbmRNb2RlbHNEaXIpIHtcbiAgICBjb25zdCBkZXZNb2RlID0gZnJvbnRlbmRNb2RlbHNEaXIuaW5jbHVkZXMoXCIvc3BlYy9kdW1teS9zcmMvZnJvbnRlbmQtbW9kZWxzXCIpXG5cbiAgICBpZiAoZGV2TW9kZSkge1xuICAgICAgcmV0dXJuIFwiLi4vLi4vLi4vLi4vc3JjL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCJcbiAgICB9XG5cbiAgICByZXR1cm4gXCJ2ZWxvY2lvdXMvYnVpbGQvc3JjL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIG1vZGVsIGZpbGUgY29udGVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNZXRob2QgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZnJvbnRlbmRNb2RlbEZpbGVQYXRoIC0gR2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW1wb3J0UGF0aCAtIEJhc2UgY2xhc3MgaW1wb3J0IHBhdGguXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MubW9kZWxDb25maWcgLSBNb2RlbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gW2FyZ3MucmVzb3VyY2VDbGFzc10gLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBHZW5lcmF0ZWQgZmlsZSBjb250ZW50LlxuICAgKi9cbiAgYXN5bmMgYnVpbGRNb2RlbEZpbGVDb250ZW50KHtjbGFzc05hbWUsIGZyb250ZW5kTW9kZWxGaWxlUGF0aCwgaW1wb3J0UGF0aCwgbW9kZWxDbGFzcywgbW9kZWxDb25maWcsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuYXR0cmlidXRlRGVmaW5pdGlvbnNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pXG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IHRoaXMucmVsYXRpb25zaGlwc0Zvck1vZGVsKHtjbGFzc05hbWUsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSlcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IG1vZGVsQ29uZmlnLmF0dGFjaG1lbnRzICYmIHR5cGVvZiBtb2RlbENvbmZpZy5hdHRhY2htZW50cyA9PT0gXCJvYmplY3RcIlxuICAgICAgPyBtb2RlbENvbmZpZy5hdHRhY2htZW50c1xuICAgICAgOiB7fVxuICAgIGNvbnN0IGF0dHJpYnV0ZXNUeXBlTmFtZSA9IGAke2NsYXNzTmFtZX1BdHRyaWJ1dGVzYFxuICAgIGNvbnN0IGNyZWF0ZUF0dHJpYnV0ZXNUeXBlTmFtZSA9IGAke2NsYXNzTmFtZX1DcmVhdGVBdHRyaWJ1dGVzYFxuICAgIGNvbnN0IHVwZGF0ZUF0dHJpYnV0ZXNUeXBlTmFtZSA9IGAke2NsYXNzTmFtZX1VcGRhdGVBdHRyaWJ1dGVzYFxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gYXR0cmlidXRlcy5tYXAoKGF0dHJpYnV0ZSkgPT4gYXR0cmlidXRlLm5hbWUpXG4gICAgY29uc3QgcGVybWl0dGVkQ3JlYXRlUGFyYW1zID0gdGhpcy5wZXJtaXR0ZWRQYXJhbXNGb3JHZW5lcmF0b3IocmVzb3VyY2VDbGFzcyB8fCBudWxsLCBcImNyZWF0ZVwiKVxuICAgIGNvbnN0IHBlcm1pdHRlZFVwZGF0ZVBhcmFtcyA9IHRoaXMucGVybWl0dGVkUGFyYW1zRm9yR2VuZXJhdG9yKHJlc291cmNlQ2xhc3MgfHwgbnVsbCwgXCJ1cGRhdGVcIilcbiAgICBjb25zdCBuZXN0ZWRXcml0ZVR5cGVzID0gdGhpcy5uZXN0ZWRXcml0ZVR5cGVzRm9yTW9kZWwoe2NsYXNzTmFtZSwgcGVybWl0dGVkUGFyYW1zOiBwZXJtaXR0ZWRDcmVhdGVQYXJhbXMuY29uY2F0KHBlcm1pdHRlZFVwZGF0ZVBhcmFtcyksIHJlbGF0aW9uc2hpcHN9KVxuICAgIGNvbnN0IHVzZXNUcmFuc3BvcnRWYWx1ZSA9IGF0dHJpYnV0ZXMuc29tZSgoYXR0cmlidXRlKSA9PiBhdHRyaWJ1dGUuanNEb2NUeXBlLmluY2x1ZGVzKFwiRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXCIpKVxuICAgICAgfHwgbmVzdGVkV3JpdGVUeXBlcy5zb21lKChuZXN0ZWRXcml0ZVR5cGUpID0+IG5lc3RlZFdyaXRlVHlwZS5hdHRyaWJ1dGVzLnNvbWUoKGF0dHJpYnV0ZSkgPT4gYXR0cmlidXRlLnR5cGUuaW5jbHVkZXMoXCJGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcIikpKVxuICAgIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSB7XG4gICAgICBjcmVhdGU6IG1vZGVsQ29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMuY3JlYXRlIHx8IFwiY3JlYXRlXCIsXG4gICAgICBpbmRleDogbW9kZWxDb25maWcuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5pbmRleCB8fCBcImluZGV4XCJcbiAgICB9XG4gICAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0ge1xuICAgICAgYXR0YWNoOiBtb2RlbENvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMuYXR0YWNoIHx8IFwiYXR0YWNoXCIsXG4gICAgICBkZXN0cm95OiBtb2RlbENvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMuZGVzdHJveSB8fCBcImRlc3Ryb3lcIixcbiAgICAgIGRvd25sb2FkOiBtb2RlbENvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMuZG93bmxvYWQgfHwgXCJkb3dubG9hZFwiLFxuICAgICAgZmluZDogbW9kZWxDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzLmZpbmQgfHwgXCJmaW5kXCIsXG4gICAgICB1cGRhdGU6IG1vZGVsQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcy51cGRhdGUgfHwgXCJ1cGRhdGVcIixcbiAgICAgIHVybDogbW9kZWxDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzLnVybCB8fCBcInVybFwiXG4gICAgfVxuICAgIGNvbnN0IGNvbGxlY3Rpb25Db21tYW5kcyA9IG1vZGVsQ29uZmlnLmNvbGxlY3Rpb25Db21tYW5kc1xuICAgIGNvbnN0IG1lbWJlckNvbW1hbmRzID0gbW9kZWxDb25maWcubWVtYmVyQ29tbWFuZHNcbiAgICBjb25zdCBkZWNsYXJlZENvbW1hbmRNZXRhZGF0YSA9IG1vZGVsQ29uZmlnLmNvbW1hbmRNZXRhZGF0YSB8fCB7fVxuICAgIGNvbnN0IGNvbW1hbmRNZXRhZGF0YSA9IGF3YWl0IHRoaXMuY29tbWFuZE1ldGFkYXRhV2l0aFJlc291cmNlSnNEb2Moe1xuICAgICAgY29tbWFuZE1ldGFkYXRhOiBkZWNsYXJlZENvbW1hbmRNZXRhZGF0YSxcbiAgICAgIGNvbW1hbmROYW1lczogWy4uLk9iamVjdC5rZXlzKGNvbGxlY3Rpb25Db21tYW5kcyksIC4uLk9iamVjdC5rZXlzKG1lbWJlckNvbW1hbmRzKV0sXG4gICAgICBmcm9udGVuZE1vZGVsRmlsZVBhdGgsXG4gICAgICByZXNvdXJjZUNsYXNzXG4gICAgfSlcbiAgICBjb25zdCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzQXJlRGVmYXVsdCA9IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMuY3JlYXRlID09PSBcImNyZWF0ZVwiICYmIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMuaW5kZXggPT09IFwiaW5kZXhcIlxuICAgIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kc0FyZURlZmF1bHQgPSBidWlsdEluTWVtYmVyQ29tbWFuZHMuYXR0YWNoID09PSBcImF0dGFjaFwiXG4gICAgICAmJiBidWlsdEluTWVtYmVyQ29tbWFuZHMuZGVzdHJveSA9PT0gXCJkZXN0cm95XCJcbiAgICAgICYmIGJ1aWx0SW5NZW1iZXJDb21tYW5kcy5kb3dubG9hZCA9PT0gXCJkb3dubG9hZFwiXG4gICAgICAmJiBidWlsdEluTWVtYmVyQ29tbWFuZHMuZmluZCA9PT0gXCJmaW5kXCJcbiAgICAgICYmIGJ1aWx0SW5NZW1iZXJDb21tYW5kcy51cGRhdGUgPT09IFwidXBkYXRlXCJcbiAgICAgICYmIGJ1aWx0SW5NZW1iZXJDb21tYW5kcy51cmwgPT09IFwidXJsXCJcblxuICAgIGxldCBmaWxlQ29udGVudCA9IGdlbmVyYXRlZEZpbGVCYW5uZXIoRlJPTlRFTkRfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORClcblxuICAgIGZpbGVDb250ZW50ICs9IGBpbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2UgZnJvbSBcIiR7aW1wb3J0UGF0aH1cIlxcbmBcblxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZy5cXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEB0eXBlZGVmIHtpbXBvcnQoXCIke2ltcG9ydFBhdGh9XCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgKiBGYWxsYmFjayBhdHRyaWJ1dGUgdmFsdWUgdHlwZSBmb3IgZ2VuZXJhdGVkIGZpZWxkcyB3aXRob3V0IG5hcnJvd2VyIG1ldGFkYXRhLlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEB0eXBlZGVmIHtpbXBvcnQoXCIke2ltcG9ydFBhdGh9XCIpLkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZX0gRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IFwiICovXFxuXCJcbiAgICBpZiAodXNlc1RyYW5zcG9ydFZhbHVlKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqIFZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBhbmQgZGVzZXJpYWxpemF0aW9uLlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge2ltcG9ydChcIiR7aW1wb3J0UGF0aH1cIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblwiXG4gICAgfVxuICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqICR7YXR0cmlidXRlc1R5cGVOYW1lfSB0eXBlLlxcbmBcbiAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge29iamVjdH0gJHthdHRyaWJ1dGVzVHlwZU5hbWV9XFxuYFxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAcHJvcGVydHkgeyR7YXR0cmlidXRlLmpzRG9jVHlwZX19ICR7YXR0cmlidXRlLm5hbWV9IC0gQXR0cmlidXRlIHZhbHVlLlxcbmBcbiAgICB9XG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgKi9cXG5cIlxuICAgIGZvciAoY29uc3QgbmVzdGVkV3JpdGVUeXBlIG9mIG5lc3RlZFdyaXRlVHlwZXMpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiLyoqXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBBdHRyaWJ1dGVzIGFjY2VwdGVkIGZvciBuZXN0ZWQgJHtuZXN0ZWRXcml0ZVR5cGUucmVsYXRpb25zaGlwTmFtZX0gd3JpdGVzLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAdHlwZWRlZiB7b2JqZWN0fSAke25lc3RlZFdyaXRlVHlwZS50eXBlTmFtZX1cXG5gXG4gICAgICBmb3IgKGNvbnN0IG5lc3RlZEF0dHJpYnV0ZSBvZiBuZXN0ZWRXcml0ZVR5cGUuYXR0cmlidXRlcykge1xuICAgICAgICBmaWxlQ29udGVudCArPSBgICogQHByb3BlcnR5IHske25lc3RlZEF0dHJpYnV0ZS50eXBlfX0gWyR7bmVzdGVkQXR0cmlidXRlLm5hbWV9XSAtIE5lc3RlZCAke25lc3RlZEF0dHJpYnV0ZS5uYW1lfSB2YWx1ZS5cXG5gXG4gICAgICB9XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblwiXG4gICAgfVxuICAgIGZpbGVDb250ZW50ICs9IGF3YWl0IHRoaXMud3JpdGVBdHRyaWJ1dGVzVHlwZWRlZih7YXR0cmlidXRlcywgYXR0cmlidXRlc1R5cGVOYW1lLCBtb2RlbENsYXNzLCBuZXN0ZWRXcml0ZVR5cGVzLCBwZXJtaXR0ZWRQYXJhbXM6IHBlcm1pdHRlZENyZWF0ZVBhcmFtcywgcmVzb3VyY2VDbGFzcywgdHlwZU5hbWU6IGNyZWF0ZUF0dHJpYnV0ZXNUeXBlTmFtZX0pXG4gICAgZmlsZUNvbnRlbnQgKz0gYXdhaXQgdGhpcy53cml0ZUF0dHJpYnV0ZXNUeXBlZGVmKHthdHRyaWJ1dGVzLCBhdHRyaWJ1dGVzVHlwZU5hbWUsIG1vZGVsQ2xhc3MsIG5lc3RlZFdyaXRlVHlwZXMsIHBlcm1pdHRlZFBhcmFtczogcGVybWl0dGVkVXBkYXRlUGFyYW1zLCByZXNvdXJjZUNsYXNzLCB0eXBlTmFtZTogdXBkYXRlQXR0cmlidXRlc1R5cGVOYW1lfSlcbiAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAqIEZyb250ZW5kIG1vZGVsIGZvciAke2NsYXNzTmFtZX0uXFxuYFxuICAgIGZpbGVDb250ZW50ICs9IGAgKiBAYXVnbWVudHMge0Zyb250ZW5kTW9kZWxCYXNlPCR7YXR0cmlidXRlc1R5cGVOYW1lfSwgJHtjcmVhdGVBdHRyaWJ1dGVzVHlwZU5hbWV9LCAke3VwZGF0ZUF0dHJpYnV0ZXNUeXBlTmFtZX0+fVxcbmBcbiAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYGNsYXNzICR7Y2xhc3NOYW1lfSBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlIHtcXG5gXG4gICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIFJlc291cmNlIGNvbmZpZy4gKi9cXG5cIlxuICAgIGZpbGVDb250ZW50ICs9IFwiICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAgICByZXR1cm4ge1xcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIG1vZGVsTmFtZTogJHtKU09OLnN0cmluZ2lmeShjbGFzc05hbWUpfSxcXG5gXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICAgIGF0dGFjaG1lbnRzOiB7XFxuXCJcbiAgICAgIGZvciAoY29uc3QgW2F0dGFjaG1lbnROYW1lLCBhdHRhY2htZW50Q29uZmlnXSBvZiBPYmplY3QuZW50cmllcyhhdHRhY2htZW50cykpIHtcbiAgICAgICAgY29uc3QgYXR0YWNobWVudFR5cGUgPSBhdHRhY2htZW50Q29uZmlnICYmIHR5cGVvZiBhdHRhY2htZW50Q29uZmlnID09PSBcIm9iamVjdFwiICYmIGF0dGFjaG1lbnRDb25maWcudHlwZSA9PT0gXCJoYXNNYW55XCJcbiAgICAgICAgICA/IFwiaGFzTWFueVwiXG4gICAgICAgICAgOiBcImhhc09uZVwiXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICAgJHthdHRhY2htZW50TmFtZX06IHt0eXBlOiAke0pTT04uc3RyaW5naWZ5KGF0dGFjaG1lbnRUeXBlKX19LFxcbmBcbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgfSxcXG5cIlxuICAgIH1cbiAgICBmaWxlQ29udGVudCArPSB0aGlzLmZvcm1hdHRlZEFycmF5UHJvcGVydHkoe1xuICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgcHJvcGVydHlOYW1lOiBcImF0dHJpYnV0ZXNcIixcbiAgICAgIHZhbHVlczogYXR0cmlidXRlTmFtZXNcbiAgICB9KVxuICAgIGlmICghYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc0FyZURlZmF1bHQpIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IHRoaXMuZm9ybWF0dGVkT2JqZWN0UHJvcGVydHkoe1xuICAgICAgICBmaWx0ZXJEZWZhdWx0VmFsdWVzOiB7Y3JlYXRlOiBcImNyZWF0ZVwiLCBpbmRleDogXCJpbmRleFwifSxcbiAgICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgICBwcm9wZXJ0eU5hbWU6IFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiLFxuICAgICAgICB2YWx1ZXM6IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmICghYnVpbHRJbk1lbWJlckNvbW1hbmRzQXJlRGVmYXVsdCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRPYmplY3RQcm9wZXJ0eSh7XG4gICAgICAgIGZpbHRlckRlZmF1bHRWYWx1ZXM6IHtcbiAgICAgICAgICBhdHRhY2g6IFwiYXR0YWNoXCIsXG4gICAgICAgICAgZGVzdHJveTogXCJkZXN0cm95XCIsXG4gICAgICAgICAgZG93bmxvYWQ6IFwiZG93bmxvYWRcIixcbiAgICAgICAgICBmaW5kOiBcImZpbmRcIixcbiAgICAgICAgICB1cGRhdGU6IFwidXBkYXRlXCIsXG4gICAgICAgICAgdXJsOiBcInVybFwiXG4gICAgICAgIH0sXG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiLFxuICAgICAgICB2YWx1ZXM6IGJ1aWx0SW5NZW1iZXJDb21tYW5kc1xuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKGNvbGxlY3Rpb25Db21tYW5kcykubGVuZ3RoID4gMCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRDb21tYW5kc1Byb3BlcnR5KHtcbiAgICAgICAgaW5kZW50OiBcIiAgICAgIFwiLFxuICAgICAgICBwcm9wZXJ0eU5hbWU6IFwiY29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gICAgICAgIHZhbHVlczogY29sbGVjdGlvbkNvbW1hbmRzXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXMobWVtYmVyQ29tbWFuZHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbGVDb250ZW50ICs9IHRoaXMuZm9ybWF0dGVkQ29tbWFuZHNQcm9wZXJ0eSh7XG4gICAgICAgIGluZGVudDogXCIgICAgICBcIixcbiAgICAgICAgcHJvcGVydHlOYW1lOiBcIm1lbWJlckNvbW1hbmRzXCIsXG4gICAgICAgIHZhbHVlczogbWVtYmVyQ29tbWFuZHNcbiAgICAgIH0pXG4gICAgfVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5Rm9yUmVzb3VyY2Uoe2F0dHJpYnV0ZU5hbWVzLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZ30pXG5cbiAgICBpZiAocHJpbWFyeUtleSAhPT0gXCJpZFwiKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBgICAgICAgcHJpbWFyeUtleTogJHtKU09OLnN0cmluZ2lmeShwcmltYXJ5S2V5KX0sXFxuYFxuICAgIH1cbiAgICBjb25zdCBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lcyA9IHRoaXMubmVzdGVkUmVsYXRpb25zaGlwTmFtZXNGb3JHZW5lcmF0b3IocmVzb3VyY2VDbGFzcyB8fCBudWxsKVxuICAgIGlmIChuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICAgIG5lc3RlZEF0dHJpYnV0ZXM6IHtcXG5cIlxuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIG5lc3RlZFJlbGF0aW9uc2hpcE5hbWVzKSB7XG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICAgICR7cmVsYXRpb25zaGlwTmFtZX06IHt9LFxcbmBcbiAgICAgIH1cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgICAgfSxcXG5cIlxuICAgIH1cbiAgICBpZiAobW9kZWxDb25maWcuc3luYz8uZW5hYmxlZCkge1xuICAgICAgZmlsZUNvbnRlbnQgKz0gdGhpcy5mb3JtYXR0ZWRKc29uUHJvcGVydHkoe1xuICAgICAgICBpbmRlbnQ6IFwiICAgICAgXCIsXG4gICAgICAgIHByb3BlcnR5TmFtZTogXCJzeW5jXCIsXG4gICAgICAgIHZhbHVlOiBtb2RlbENvbmZpZy5zeW5jXG4gICAgICB9KVxuICAgIH1cbiAgICBmaWxlQ29udGVudCArPSBcIiAgICB9XFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIiAgfVxcblwiXG5cbiAgICBpZiAocmVsYXRpb25zaGlwcy5sZW5ndGggPiAwKSB7XG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogXFxcImJlbG9uZ3NUb1xcXCIgfCBcXFwiaGFzT25lXFxcIiB8IFxcXCJoYXNNYW55XFxcIiwgYXV0b2xvYWQ/OiBib29sZWFufT59IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb25zLiAqL1xcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgc3RhdGljIHJlbGF0aW9uc2hpcERlZmluaXRpb25zKCkge1xcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICByZXR1cm4ge1xcblwiXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiByZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIGNvbnN0IHBhcnRzID0gW2B0eXBlOiAke0pTT04uc3RyaW5naWZ5KHJlbGF0aW9uc2hpcC50eXBlKX1gXVxuXG4gICAgICAgIGlmIChyZWxhdGlvbnNoaXAuYXV0b2xvYWQgPT09IGZhbHNlKSBwYXJ0cy5wdXNoKFwiYXV0b2xvYWQ6IGZhbHNlXCIpXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9OiB7JHtwYXJ0cy5qb2luKFwiLCBcIil9fSxcXG5gXG4gICAgICB9XG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICB9XFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcblxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBSZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MgbmFtZXMuICovXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzKCkge1xcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICByZXR1cm4ge1xcblwiXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiByZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfTogJHtKU09OLnN0cmluZ2lmeShyZWxhdGlvbnNoaXAudGFyZ2V0Q2xhc3NOYW1lKX0sXFxuYFxuICAgICAgfVxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgfVxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgfVxcblwiXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgYXR0cmlidXRlcykge1xuICAgICAgY29uc3QgY2FtZWxpemVkQXR0cmlidXRlID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGUubmFtZSwgdHJ1ZSlcbiAgICAgIGNvbnN0IGNhbWVsaXplZEF0dHJpYnV0ZVVwcGVyID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGUubmFtZSlcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZVR5cGUgPSBgJHthdHRyaWJ1dGVzVHlwZU5hbWV9WyR7SlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlLm5hbWUpfV1gXG4gICAgICBjb25zdCBzZXR0ZXJBdHRyaWJ1dGVUeXBlID0gYXdhaXQgdGhpcy5mcm9udGVuZFdyaXRlQXR0cmlidXRlVHlwZSh7XG4gICAgICAgIGF0dHJpYnV0ZSxcbiAgICAgICAgYXR0cmlidXRlTmFtZTogYXR0cmlidXRlLm5hbWUsXG4gICAgICAgIGF0dHJpYnV0ZXNUeXBlTmFtZSxcbiAgICAgICAgcmVzb3VyY2VDbGFzc1xuICAgICAgfSlcblxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgLyoqIEByZXR1cm5zIHske2F0dHJpYnV0ZVR5cGV9fSAtIEF0dHJpYnV0ZSB2YWx1ZS4gKi9cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAke2NhbWVsaXplZEF0dHJpYnV0ZX0oKSB7IHJldHVybiAvKiogQHR5cGUgeyR7YXR0cmlidXRlVHlwZX19ICovICh0aGlzLnJlYWRBdHRyaWJ1dGUoJHtKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGUubmFtZSl9KSkgfVxcbmBcblxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0geyR7c2V0dGVyQXR0cmlidXRlVHlwZX19IG5ld1ZhbHVlIC0gTmV3IGF0dHJpYnV0ZSB2YWx1ZS5cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7JHtzZXR0ZXJBdHRyaWJ1dGVUeXBlfX0gLSBBc3NpZ25lZCB2YWx1ZS5cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgIHNldCR7Y2FtZWxpemVkQXR0cmlidXRlVXBwZXJ9KG5ld1ZhbHVlKSB7IHJldHVybiAvKiogQHR5cGUgeyR7c2V0dGVyQXR0cmlidXRlVHlwZX19ICovICh0aGlzLnNldEF0dHJpYnV0ZSgke0pTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZS5uYW1lKX0sIG5ld1ZhbHVlKSkgfVxcbmBcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG1ldGhvZE5hbWUgb2YgT2JqZWN0LmtleXMoY29sbGVjdGlvbkNvbW1hbmRzKSkge1xuICAgICAgY29uc3Qgc2lnbmF0dXJlID0gdGhpcy5jdXN0b21Db21tYW5kTWV0aG9kU2lnbmF0dXJlKHtjb21tYW5kTWV0YWRhdGEsIG1ldGhvZE5hbWV9KVxuXG4gICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIFJ1bnMgJHttZXRob2ROYW1lfS5cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBzaWduYXR1cmUucGFyYW1Eb2NzXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwke3NpZ25hdHVyZS5yZXR1cm5UeXBlfT59IC0gQ29tbWFuZCByZXNwb25zZS5cXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgIHN0YXRpYyBhc3luYyAke21ldGhvZE5hbWV9KCR7c2lnbmF0dXJlLnBhcmFtZXRlcnN9KSB7XFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICByZXR1cm4gLyoqIEB0eXBlIHske3NpZ25hdHVyZS5yZXR1cm5UeXBlfX0gKi8gKGF3YWl0IHRoaXMuZXhlY3V0ZUN1c3RvbUNvbW1hbmQoe1xcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBjb21tYW5kTmFtZTogJHtKU09OLnN0cmluZ2lmeShjb2xsZWN0aW9uQ29tbWFuZHNbbWV0aG9kTmFtZV0pfSxcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgICAgY29tbWFuZFR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoY29sbGVjdGlvbkNvbW1hbmRzW21ldGhvZE5hbWVdKX0sXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICAgIHBheWxvYWQ6ICR7Y2xhc3NOYW1lfS5ub3JtYWxpemVDdXN0b21Db21tYW5kUGF5bG9hZEFyZ3VtZW50cygke3NpZ25hdHVyZS5wYXlsb2FkQXJndW1lbnRzfSksXFxuYFxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgICByZXNvdXJjZVBhdGg6IHRoaXMucmVzb3VyY2VQYXRoKClcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAgfSkpXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICB9XFxuXCJcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG1ldGhvZE5hbWUgb2YgT2JqZWN0LmtleXMobWVtYmVyQ29tbWFuZHMpKSB7XG4gICAgICBjb25zdCBzaWduYXR1cmUgPSB0aGlzLmN1c3RvbUNvbW1hbmRNZXRob2RTaWduYXR1cmUoe2NvbW1hbmRNZXRhZGF0YSwgbWV0aG9kTmFtZX0pXG5cbiAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUnVucyAke21ldGhvZE5hbWV9LlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IHNpZ25hdHVyZS5wYXJhbURvY3NcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtQcm9taXNlPCR7c2lnbmF0dXJlLnJldHVyblR5cGV9Pn0gLSBDb21tYW5kIHJlc3BvbnNlLlxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgJHttZXRob2ROYW1lfSgke3NpZ25hdHVyZS5wYXJhbWV0ZXJzfSkge1xcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgcmV0dXJuIC8qKiBAdHlwZSB7JHtzaWduYXR1cmUucmV0dXJuVHlwZX19ICovIChhd2FpdCAke2NsYXNzTmFtZX0uZXhlY3V0ZUN1c3RvbUNvbW1hbmQoe1xcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBjb21tYW5kTmFtZTogJHtKU09OLnN0cmluZ2lmeShtZW1iZXJDb21tYW5kc1ttZXRob2ROYW1lXSl9LFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBjb21tYW5kVHlwZTogJHtKU09OLnN0cmluZ2lmeShtZW1iZXJDb21tYW5kc1ttZXRob2ROYW1lXSl9LFxcbmBcbiAgICAgIGZpbGVDb250ZW50ICs9IGAgICAgICBtZW1iZXJJZDogdGhpcy5zY2FsYXJQcmltYXJ5S2V5VmFsdWUoJHtKU09OLnN0cmluZ2lmeShgQ3VzdG9tIG1lbWJlciBjb21tYW5kICR7Y2xhc3NOYW1lfSMke21ldGhvZE5hbWV9YCl9KSxcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgICAgcGF5bG9hZDogJHtjbGFzc05hbWV9Lm5vcm1hbGl6ZUN1c3RvbUNvbW1hbmRQYXlsb2FkQXJndW1lbnRzKCR7c2lnbmF0dXJlLnBheWxvYWRBcmd1bWVudHN9KSxcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBgICAgICAgcmVzb3VyY2VQYXRoOiAke2NsYXNzTmFtZX0ucmVzb3VyY2VQYXRoKClcXG5gXG4gICAgICBmaWxlQ29udGVudCArPSBcIiAgICB9KSlcXG5cIlxuICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIH1cXG5cIlxuICAgIH1cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWVDYW1lbGl6ZWQgPSBpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0SW1wb3J0UGF0aCA9IGAuLyR7cmVsYXRpb25zaGlwLnRhcmdldEZpbGVOYW1lfS5qc2BcbiAgICAgIGNvbnN0IHRhcmdldEluc3RhbmNlVHlwZSA9IGBpbXBvcnQoJHtKU09OLnN0cmluZ2lmeSh0YXJnZXRJbXBvcnRQYXRoKX0pLiR7cmVsYXRpb25zaGlwLnRhcmdldENsYXNzTmFtZX1gXG4gICAgICBjb25zdCB0YXJnZXRDcmVhdGVBdHRyaWJ1dGVzVHlwZSA9IGBpbXBvcnQoJHtKU09OLnN0cmluZ2lmeSh0YXJnZXRJbXBvcnRQYXRoKX0pLiR7cmVsYXRpb25zaGlwLnRhcmdldENsYXNzTmFtZX1DcmVhdGVBdHRyaWJ1dGVzYFxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwLnR5cGUgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUmV0dXJucyAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfSByZWxhdGlvbnNoaXAgaGVscGVyLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge2ltcG9ydCgke0pTT04uc3RyaW5naWZ5KGltcG9ydFBhdGgpfSkuRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8JHtjbGFzc05hbWV9LCAke3RhcmdldEluc3RhbmNlVHlwZX0sICR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9Pn0gLSBSZWxhdGlvbnNoaXAgaGVscGVyLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoJHtKU09OLnN0cmluZ2lmeShpbXBvcnRQYXRoKX0pLkZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPCR7Y2xhc3NOYW1lfSwgJHt0YXJnZXRJbnN0YW5jZVR5cGV9LCAke3RhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlfT59ICovICh0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZSgke0pTT04uc3RyaW5naWZ5KHJlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lKX0pKSB9XFxuYFxuXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIFJldHVybnMgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0uXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDwke2NsYXNzTmFtZX0sICR7dGFyZ2V0SW5zdGFuY2VUeXBlfSwgJHt0YXJnZXRDcmVhdGVBdHRyaWJ1dGVzVHlwZX0+fSAtIFJlbGF0aW9uc2hpcCBoZWxwZXIuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX0oKSB7IHJldHVybiB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkgfVxcbmBcblxuICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBSZXR1cm5zIGxvYWRlZCAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfS5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtBcnJheTwke3RhcmdldEluc3RhbmNlVHlwZX0+fSAtIExvYWRlZCByZWxhdGVkIG1vZGVscy5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfUxvYWRlZCgpIHsgcmV0dXJuIHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKS5sb2FkZWQoKSB9XFxuYFxuXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIExvYWRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8JHt0YXJnZXRJbnN0YW5jZVR5cGV9Pj59IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWxzLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgIGFzeW5jIGxvYWQke3JlbGF0aW9uc2hpcE5hbWVDYW1lbGl6ZWR9KCkgeyByZXR1cm4gYXdhaXQgdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLmxvYWQoKSB9XFxuYFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUmV0dXJucyAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfSByZWxhdGlvbnNoaXAgaGVscGVyLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge2ltcG9ydCgke0pTT04uc3RyaW5naWZ5KGltcG9ydFBhdGgpfSkuRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPCR7Y2xhc3NOYW1lfSwgJHt0YXJnZXRJbnN0YW5jZVR5cGV9LCAke3RhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlfT59IC0gUmVsYXRpb25zaGlwIGhlbHBlci5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpIHsgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkoaW1wb3J0UGF0aCl9KS5Gcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8JHtjbGFzc05hbWV9LCAke3RhcmdldEluc3RhbmNlVHlwZX0sICR7dGFyZ2V0Q3JlYXRlQXR0cmlidXRlc1R5cGV9Pn0gKi8gKHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKCR7SlNPTi5zdHJpbmdpZnkocmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWUpfSkpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUmV0dXJucyAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfS5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHske3RhcmdldEluc3RhbmNlVHlwZX0gfCBudWxsfSAtIExvYWRlZCByZWxhdGVkIG1vZGVsLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9KCkgeyByZXR1cm4gdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLmxvYWRlZCgpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQnVpbGRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHske3RhcmdldENyZWF0ZUF0dHJpYnV0ZXNUeXBlfX0gW2F0dHJpYnV0ZXNdIC0gQXR0cmlidXRlcyBmb3IgdGhlIG5ldyByZWxhdGVkIG1vZGVsLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMgeyR7dGFyZ2V0SW5zdGFuY2VUeXBlfX0gLSBCdWlsdCByZWxhdGVkIG1vZGVsLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgIGJ1aWxkJHtyZWxhdGlvbnNoaXBOYW1lQ2FtZWxpemVkfShhdHRyaWJ1dGVzID0ge30pIHsgcmV0dXJuIHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKS5idWlsZChhdHRyaWJ1dGVzKSB9XFxuYFxuXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIExvYWRzICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9LlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge1Byb21pc2U8JHt0YXJnZXRJbnN0YW5jZVR5cGV9IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0ZWQgbW9kZWwuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgYXN5bmMgbG9hZCR7cmVsYXRpb25zaGlwTmFtZUNhbWVsaXplZH0oKSB7IHJldHVybiBhd2FpdCB0aGlzLiR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9UmVsYXRpb25zaGlwKCkubG9hZCgpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogUmV0dXJucyBvciBsb2FkcyAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfS5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtQcm9taXNlPCR7dGFyZ2V0SW5zdGFuY2VUeXBlfSB8IG51bGw+fSAtIExvYWRlZCByZWxhdGVkIG1vZGVsLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgIGFzeW5jICR7cmVsYXRpb25zaGlwLnJlbGF0aW9uc2hpcE5hbWV9T3JMb2FkKCkgeyByZXR1cm4gYXdhaXQgdGhpcy4ke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfVJlbGF0aW9uc2hpcCgpLm9yTG9hZCgpIH1cXG5gXG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogU2V0cyAke3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lfS5cXG5gXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEBwYXJhbSB7JHt0YXJnZXRJbnN0YW5jZVR5cGV9IHwgbnVsbH0gbW9kZWwgLSBSZWxhdGVkIG1vZGVsLlxcbmBcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqIEByZXR1cm5zIHt2b2lkfVxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICBmaWxlQ29udGVudCArPSBgICBzZXQke3JlbGF0aW9uc2hpcE5hbWVDYW1lbGl6ZWR9KG1vZGVsKSB7IHRoaXMuJHtyZWxhdGlvbnNoaXAucmVsYXRpb25zaGlwTmFtZX1SZWxhdGlvbnNoaXAoKS5zZXRMb2FkZWQobW9kZWwpIH1cXG5gXG4gICAgICB9XG4gICAgfVxuXG4gICAgZmlsZUNvbnRlbnQgKz0gXCJ9XFxuXCJcbiAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYEZyb250ZW5kTW9kZWxCYXNlLnJlZ2lzdGVyTW9kZWwoJHtjbGFzc05hbWV9KVxcbmBcbiAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYGV4cG9ydCB7JHtjbGFzc05hbWV9fVxcbmBcbiAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgZmlsZUNvbnRlbnQgKz0gYGV4cG9ydCBkZWZhdWx0ICR7Y2xhc3NOYW1lfVxcbmBcblxuICAgIHJldHVybiBmaWxlQ29udGVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgc2V0dXAgZmlsZSBjb250ZW50LlxuICAgKiBAcGFyYW0ge0FycmF5PHtjbGFzc05hbWU6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZ30+fSBnZW5lcmF0ZWRGaWxlcyAtIEdlbmVyYXRlZCBtb2RlbCBmaWxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTZXR1cCBmaWxlIGNvbnRlbnQgd2l0aCBzaWRlLWVmZmVjdCBpbXBvcnRzIGZvciBtb2RlbCByZWdpc3RyYXRpb24uXG4gICAqL1xuICBidWlsZFNldHVwRmlsZUNvbnRlbnQoZ2VuZXJhdGVkRmlsZXMpIHtcbiAgICBsZXQgY29udGVudCA9IGdlbmVyYXRlZEZpbGVCYW5uZXIoRlJPTlRFTkRfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORClcblxuICAgIGZvciAoY29uc3Qge2ZpbGVOYW1lfSBvZiBnZW5lcmF0ZWRGaWxlcykge1xuICAgICAgY29udGVudCArPSBgaW1wb3J0IFwiLi8ke2ZpbGVOYW1lfVwiXFxuYFxuICAgIH1cblxuICAgIHJldHVybiBjb250ZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3cml0ZSBhdHRyaWJ1dGVzIHR5cGVkZWYuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge0FycmF5PHtqc0RvY1R5cGU6IHN0cmluZywgbmFtZTogc3RyaW5nLCB3cml0ZUpzRG9jVHlwZTogc3RyaW5nfT59IGFyZ3MuYXR0cmlidXRlcyAtIEdlbmVyYXRlZCByZWFkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZXNUeXBlTmFtZSAtIEdlbmVyYXRlZCByZWFkIGF0dHJpYnV0ZXMgdHlwZWRlZiBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtBcnJheTx7YXR0cmlidXRlczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdHlwZU5hbWU6IHN0cmluZ30+fSBhcmdzLm5lc3RlZFdyaXRlVHlwZXMgLSBOZXN0ZWQgd3JpdGUgdHlwZWRlZnMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEdlbmVyYXRvclBlcm1pdFNwZWN9IGFyZ3MucGVybWl0dGVkUGFyYW1zIC0gUmVzb3VyY2UgcGVybWl0dGVkIHBhcmFtcyBzcGVjLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5yZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGVOYW1lIC0gVHlwZWRlZiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEdlbmVyYXRlZCB0eXBlZGVmIHNvdXJjZS5cbiAgICovXG4gIGFzeW5jIHdyaXRlQXR0cmlidXRlc1R5cGVkZWYoe2F0dHJpYnV0ZXMsIGF0dHJpYnV0ZXNUeXBlTmFtZSwgbW9kZWxDbGFzcywgbmVzdGVkV3JpdGVUeXBlcywgcGVybWl0dGVkUGFyYW1zLCByZXNvdXJjZUNsYXNzLCB0eXBlTmFtZX0pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVMaW5lcyA9IFtdXG5cbiAgICBsZXQgb3V0cHV0ID0gXCIvKipcXG5cIlxuXG4gICAgY29uc3QgYXR0cmlidXRlc0J5TmFtZSA9IG5ldyBNYXAoYXR0cmlidXRlcy5tYXAoKGF0dHJpYnV0ZSkgPT4gW2F0dHJpYnV0ZS5uYW1lLCBhdHRyaWJ1dGVdKSlcbiAgICBjb25zdCBuZXN0ZWRXcml0ZVR5cGVzQnlLZXkgPSBuZXcgTWFwKG5lc3RlZFdyaXRlVHlwZXMubWFwKChuZXN0ZWRXcml0ZVR5cGUpID0+IFtgJHtuZXN0ZWRXcml0ZVR5cGUucmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzYCwgbmVzdGVkV3JpdGVUeXBlXSkpXG4gICAgY29uc3QgZW1pdHRlZEF0dHJpYnV0ZU5hbWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBlcm1pdHRlZFBhcmFtcykge1xuICAgICAgaWYgKHR5cGVvZiBlbnRyeSA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmZyb250ZW5kV3JpdGVBdHRyaWJ1dGVOYW1lKHthdHRyaWJ1dGVOYW1lOiBlbnRyeSwgYXR0cmlidXRlc0J5TmFtZSwgbW9kZWxDbGFzc30pXG5cbiAgICAgICAgaWYgKGVtaXR0ZWRBdHRyaWJ1dGVOYW1lcy5oYXMoYXR0cmlidXRlTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgZW1pdHRlZEF0dHJpYnV0ZU5hbWVzLmFkZChhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICAgIGNvbnN0IHR5cGUgPSBhd2FpdCB0aGlzLmZyb250ZW5kV3JpdGVBdHRyaWJ1dGVUeXBlKHtcbiAgICAgICAgICBhdHRyaWJ1dGU6IGF0dHJpYnV0ZXNCeU5hbWUuZ2V0KGF0dHJpYnV0ZU5hbWUpLFxuICAgICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgYXR0cmlidXRlc1R5cGVOYW1lLFxuICAgICAgICAgIHJlc291cmNlQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhdHRyaWJ1dGVMaW5lcy5wdXNoKGAgKiBAcHJvcGVydHkgeyR7dHlwZX19IFske2F0dHJpYnV0ZU5hbWV9XSAtIFBlcm1pdHRlZCAke2F0dHJpYnV0ZU5hbWV9IHZhbHVlLlxcbmApXG4gICAgICB9IGVsc2UgaWYgKGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGVudHJ5KSkge1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhlbnRyeSkpIHtcbiAgICAgICAgICBjb25zdCBuZXN0ZWRXcml0ZVR5cGUgPSBuZXN0ZWRXcml0ZVR5cGVzQnlLZXkuZ2V0KGtleSlcbiAgICAgICAgICBjb25zdCB0eXBlID0gbmVzdGVkV3JpdGVUeXBlID8gYEFycmF5PCR7bmVzdGVkV3JpdGVUeXBlLnR5cGVOYW1lfT5gIDogXCJBcnJheTxvYmplY3Q+XCJcblxuICAgICAgICAgIGF0dHJpYnV0ZUxpbmVzLnB1c2goYCAqIEBwcm9wZXJ0eSB7JHt0eXBlfX0gWyR7a2V5fV0gLSBQZXJtaXR0ZWQgbmVzdGVkICR7a2V5fSB2YWx1ZXMuXFxuYClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIG91dHB1dCArPSBgICogQXR0cmlidXRlcyBhY2NlcHRlZCBieSAke3R5cGVOYW1lfS5cXG5gXG4gICAgaWYgKGF0dHJpYnV0ZUxpbmVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgb3V0cHV0ICs9IGAgKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgbmV2ZXI+fSAke3R5cGVOYW1lfVxcbmBcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0cHV0ICs9IGAgKiBAdHlwZWRlZiB7b2JqZWN0fSAke3R5cGVOYW1lfVxcbmBcbiAgICAgIG91dHB1dCArPSBhdHRyaWJ1dGVMaW5lcy5qb2luKFwiXCIpXG4gICAgfVxuICAgIG91dHB1dCArPSBcIiAqL1xcblwiXG5cbiAgICByZXR1cm4gb3V0cHV0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCB3cml0ZSBhdHRyaWJ1dGUgdHlwZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlOiB7anNEb2NUeXBlOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgd3JpdGVKc0RvY1R5cGU6IHN0cmluZ30gfCB1bmRlZmluZWQsIGF0dHJpYnV0ZU5hbWU6IHN0cmluZywgYXR0cmlidXRlc1R5cGVOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH19IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSlNEb2MgdHlwZSBmb3IgdGhlIHBlcm1pdHRlZCB3cml0ZSBmaWVsZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kV3JpdGVBdHRyaWJ1dGVUeXBlKHthdHRyaWJ1dGUsIGF0dHJpYnV0ZU5hbWUsIGF0dHJpYnV0ZXNUeXBlTmFtZSwgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBjb25zdCBzZXR0ZXJQYXJhbWV0ZXJUeXBlID0gYXdhaXQgdGhpcy5mcm9udGVuZFdyaXRlQXR0cmlidXRlU2V0dGVyUGFyYW1ldGVyVHlwZSh7YXR0cmlidXRlTmFtZSwgcmVzb3VyY2VDbGFzc30pXG5cbiAgICBpZiAoc2V0dGVyUGFyYW1ldGVyVHlwZSkgcmV0dXJuIGAke3NldHRlclBhcmFtZXRlclR5cGV9IHwgbnVsbGBcblxuICAgIGlmICghYXR0cmlidXRlKSByZXR1cm4gXCJGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcIlxuXG4gICAgaWYgKGF0dHJpYnV0ZS5qc0RvY1R5cGUudHJpbSgpID09PSBcIm51bGxcIikgcmV0dXJuIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCJcblxuICAgIGlmIChhdHRyaWJ1dGUud3JpdGVKc0RvY1R5cGUgIT09IGF0dHJpYnV0ZS5qc0RvY1R5cGUpIHJldHVybiBhdHRyaWJ1dGUud3JpdGVKc0RvY1R5cGVcblxuICAgIHJldHVybiBgJHthdHRyaWJ1dGVzVHlwZU5hbWV9WyR7SlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlLm5hbWUpfV0gfCBudWxsYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgd3JpdGUgYXR0cmlidXRlIHNldHRlciBwYXJhbWV0ZXIgdHlwZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBTZXR0ZXIgdmFsdWUgcGFyYW1ldGVyIHR5cGUgd2hlbiBpdCBpcyB1c2VmdWwgZm9yIGdlbmVyYXRpb24uXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFdyaXRlQXR0cmlidXRlU2V0dGVyUGFyYW1ldGVyVHlwZSh7YXR0cmlidXRlTmFtZSwgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBpZiAoIXJlc291cmNlQ2xhc3M/Lm5hbWUpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBtZXRob2ROYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lKX1BdHRyaWJ1dGVgXG4gICAgY29uc3QgcGFyYW1ldGVyVHlwZSA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlKHtcbiAgICAgIG1ldGhvZE5hbWUsXG4gICAgICBwYXJhbWV0ZXJJbmRleDogMSxcbiAgICAgIHNvdXJjZUNsYXNzTmFtZTogcmVzb3VyY2VDbGFzcy5uYW1lXG4gICAgfSlcblxuICAgIGlmICghcGFyYW1ldGVyVHlwZSkgcmV0dXJuIG51bGxcbiAgICBpZiAodGhpcy5pc0Jyb2FkR2VuZXJhdGVkVHlwZShwYXJhbWV0ZXJUeXBlKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBwYXJhbWV0ZXJUeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBicm9hZCBnZW5lcmF0ZWQgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVHlwZSAtIEpTRG9jIHR5cGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHR5cGUgaXMgdG9vIGJyb2FkIHRvIGltcHJvdmUgZ2VuZXJhdGVkIHdyaXRlIHR5cGluZy5cbiAgICovXG4gIGlzQnJvYWRHZW5lcmF0ZWRUeXBlKGpzRG9jVHlwZSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0ganNEb2NUeXBlLnRyaW0oKVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRUeXBlID09PSBcIj9cIlxuICAgICAgfHwgbm9ybWFsaXplZFR5cGUgPT09IFwiYW55XCJcbiAgICAgIHx8IG5vcm1hbGl6ZWRUeXBlID09PSBcIm9iamVjdFwiXG4gICAgICB8fCBub3JtYWxpemVkVHlwZSA9PT0gXCJ1bmtub3duXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHBlcm1pdHRlZCB3cml0ZSBhdHRyaWJ1dGUgdG8gdGhlIGdlbmVyYXRlZCBmcm9udGVuZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZTogc3RyaW5nLCBhdHRyaWJ1dGVzQnlOYW1lOiBNYXA8c3RyaW5nLCB7anNEb2NUeXBlOiBzdHJpbmcsIG5hbWU6IHN0cmluZ30+LCBtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZyb250ZW5kIGF0dHJpYnV0ZSBuYW1lIHVzZWQgYnkgZ2VuZXJhdGVkIGFjY2Vzc29ycy5cbiAgICovXG4gIGZyb250ZW5kV3JpdGVBdHRyaWJ1dGVOYW1lKHthdHRyaWJ1dGVOYW1lLCBhdHRyaWJ1dGVzQnlOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGlmIChhdHRyaWJ1dGVzQnlOYW1lLmhhcyhhdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIGF0dHJpYnV0ZU5hbWVcblxuICAgIGlmIChtb2RlbENsYXNzKSB7XG4gICAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUgJiYgYXR0cmlidXRlc0J5TmFtZS5oYXMocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIHJlc29sdmVkQXR0cmlidXRlTmFtZVxuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lLCB0cnVlKS50b0xvd2VyQ2FzZSgpXG4gICAgY29uc3QgbWF0Y2hpbmdBdHRyaWJ1dGVOYW1lID0gQXJyYXkuZnJvbShhdHRyaWJ1dGVzQnlOYW1lLmtleXMoKSkuZmluZCgoY2FuZGlkYXRlTmFtZSkgPT4gY2FuZGlkYXRlTmFtZS50b0xvd2VyQ2FzZSgpID09PSBub3JtYWxpemVkQXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChtYXRjaGluZ0F0dHJpYnV0ZU5hbWUpIHJldHVybiBtYXRjaGluZ0F0dHJpYnV0ZU5hbWVcblxuICAgIC8vIFdyaXRlLW9ubHkgdmlydHVhbCBwYXJhbXMgYXJlIHZhbGlkIHBlcm1pdHRlZCBwYXJhbXMgZXZlbiB3aGVuIHRoZXkgaGF2ZSBubyByZWFkIGF0dHJpYnV0ZS5cbiAgICByZXR1cm4gYXR0cmlidXRlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmVzdGVkIHdyaXRlIHR5cGVzIGZvciBtb2RlbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEdlbmVyYXRvclBlcm1pdFNwZWN9IGFyZ3MucGVybWl0dGVkUGFyYW1zIC0gQ29tYmluZWQgcGVybWl0dGVkIHBhcmFtcyBzcGVjcy5cbiAgICogQHBhcmFtIHtBcnJheTx7YXV0b2xvYWQ6IGJvb2xlYW4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdGFyZ2V0Q2xhc3NOYW1lOiBzdHJpbmcsIHRhcmdldEZpbGVOYW1lOiBzdHJpbmcsIHR5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9Pn0gYXJncy5yZWxhdGlvbnNoaXBzIC0gR2VuZXJhdGVkIHJlbGF0aW9uc2hpcHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7YXR0cmlidXRlczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdHlwZU5hbWU6IHN0cmluZ30+fSAtIE5lc3RlZCB3cml0ZSB0eXBlZGVmcy5cbiAgICovXG4gIG5lc3RlZFdyaXRlVHlwZXNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBwZXJtaXR0ZWRQYXJhbXMsIHJlbGF0aW9uc2hpcHN9KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwc0J5TmFtZSA9IG5ldyBNYXAocmVsYXRpb25zaGlwcy5tYXAoKHJlbGF0aW9uc2hpcCkgPT4gW3JlbGF0aW9uc2hpcC5yZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBdKSlcbiAgICBjb25zdCBuZXN0ZWRXcml0ZVR5cGVzQnlOYW1lID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBlcm1pdHRlZFBhcmFtcykge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5KSkgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZW50cnkpKSB7XG4gICAgICAgIGlmICgha2V5LmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkgY29udGludWVcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGtleS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuICAgICAgICBjb25zdCBuZXN0ZWRTcGVjID0gZW50cnlba2V5XVxuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSByZWxhdGlvbnNoaXBzQnlOYW1lLmdldChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgICBsZXQgdGFyZ2V0TW9kZWxDbGFzc1xuXG4gICAgICAgIGlmIChyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwLnRhcmdldENsYXNzTmFtZSlcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3MgPSB1bmRlZmluZWRcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmVzdGVkV3JpdGVUeXBlc0J5TmFtZS5oYXMocmVsYXRpb25zaGlwTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgbmVzdGVkV3JpdGVUeXBlc0J5TmFtZS5zZXQocmVsYXRpb25zaGlwTmFtZSwge1xuICAgICAgICAgIGF0dHJpYnV0ZXM6IHRoaXMubmVzdGVkV3JpdGVBdHRyaWJ1dGVzRm9yU3BlYyh7bmVzdGVkU3BlYywgdGFyZ2V0TW9kZWxDbGFzc30pLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdHlwZU5hbWU6IGAke2NsYXNzTmFtZX0ke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9TmVzdGVkQXR0cmlidXRlc2BcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShuZXN0ZWRXcml0ZVR5cGVzQnlOYW1lLnZhbHVlcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmVzdGVkIHdyaXRlIGF0dHJpYnV0ZXMgZm9yIHNwZWMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIG9iamVjdD4+IHwgb2JqZWN0IHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5uZXN0ZWRTcGVjIC0gTmVzdGVkIHBlcm1pdCBzcGVjLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IGJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9Pn0gLSBOZXN0ZWQgd3JpdGUgYXR0cmlidXRlcy5cbiAgICovXG4gIG5lc3RlZFdyaXRlQXR0cmlidXRlc0ZvclNwZWMoe25lc3RlZFNwZWMsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG5lc3RlZFNwZWMpKSByZXR1cm4gW11cblxuICAgIHJldHVybiBuZXN0ZWRTcGVjLmZpbHRlcigoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PSBcInN0cmluZ1wiKS5tYXAoKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRhcmdldE1vZGVsQ2xhc3M/LnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpIHx8IGF0dHJpYnV0ZU5hbWVcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZUNvbmZpZyA9IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JNb2RlbEF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZTogcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzfSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICB0eXBlOiBhdHRyaWJ1dGVDb25maWcgPyB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kV3JpdGVBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZ30pIDogXCJGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJtaXR0ZWQgcGFyYW1zIGZvciBnZW5lcmF0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSByZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCJ9IGFjdGlvbiAtIFdyaXRlIGFjdGlvbi5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxHZW5lcmF0b3JQZXJtaXRTcGVjfSAtIFBlcm1pdHRlZCBwYXJhbXMgc3BlYy5cbiAgICovXG4gIHBlcm1pdHRlZFBhcmFtc0ZvckdlbmVyYXRvcihyZXNvdXJjZUNsYXNzLCBhY3Rpb24pIHtcbiAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHJldHVybiBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuXG4gICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyByZXNvdXJjZUNsYXNzKHtcbiAgICAgICAgYWJpbGl0eTogdW5kZWZpbmVkLFxuICAgICAgICBjb250ZXh0OiB7fSxcbiAgICAgICAgbG9jYWxzOiB7fSxcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgbW9kZWxOYW1lOiBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICBwYXJhbXM6IHt9LFxuICAgICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqLyAoe2F0dHJpYnV0ZXM6IFtdfSlcbiAgICAgIH0pXG4gICAgICBjb25zdCBzcGVjID0gaW5zdGFuY2UucGVybWl0dGVkUGFyYW1zKHthY3Rpb24sIGFiaWxpdHk6IHVuZGVmaW5lZCwgbG9jYWxzOiB7fSwgcGFyYW1zOiB7fX0pXG5cbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHNwZWMpID8gc3BlYyA6IFtdXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGludm9rZSAke3Jlc291cmNlQ2xhc3MubmFtZX0ucGVybWl0dGVkUGFyYW1zKCkgd2hpbGUgZ2VuZXJhdGluZyBmcm9udGVuZCBtb2RlbCB3cml0ZSB0eXBlczogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEludm9rZXMgYSBiYWNrZW5kIHJlc291cmNlJ3MgYHBlcm1pdHRlZFBhcmFtcygpYCBpbnN0YW5jZSBtZXRob2QgYXRcbiAgICogZ2VuZXJhdGlvbiB0aW1lIGFuZCBleHRyYWN0cyB0aGUgcmVsYXRpb25zaGlwIG5hbWVzIHRoYXQgYWNjZXB0XG4gICAqIG5lc3RlZCB3cml0ZXMgKGB7Zm9vQXR0cmlidXRlczogWy4uLl19YCBlbnRyaWVzKS4gVGhlIGdlbmVyYXRvclxuICAgKiBlbWl0cyB0aG9zZSBuYW1lcyBpbnRvIHRoZSBmcm9udGVuZCBtb2RlbCdzIGByZXNvdXJjZUNvbmZpZygpYCBzb1xuICAgKiB0aGUgY2xpZW50IGBzYXZlKClgIHdhbGtlciBrbm93cyB3aGljaCByZWxhdGlvbnNoaXBzIHRvIHNoaXAuXG4gICAqXG4gICAqIENvbnN0cnVjdGVkIHdpdGggbm8gY29udHJvbGxlci9hYmlsaXR5IHNvIHJlc291cmNlIG92ZXJyaWRlcyBtdXN0XG4gICAqIHN1cHBvcnQgYmVpbmcgY2FsbGVkIHdpdGhvdXQgYSByZXF1ZXN0IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsfSByZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBSZWxhdGlvbnNoaXAgbmFtZXMgdGhhdCBhY2NlcHQgbmVzdGVkIHdyaXRlcyAoZW1wdHkgd2hlbiBub25lKS5cbiAgICovXG4gIG5lc3RlZFJlbGF0aW9uc2hpcE5hbWVzRm9yR2VuZXJhdG9yKHJlc291cmNlQ2xhc3MpIHtcbiAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHJldHVybiBbXVxuXG4gICAgbGV0IHNwZWNcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBtb2RlbENsYXNzID0gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcblxuICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgcmVzb3VyY2VDbGFzcyh7XG4gICAgICAgIGFiaWxpdHk6IHVuZGVmaW5lZCxcbiAgICAgICAgY29udGV4dDoge30sXG4gICAgICAgIGxvY2Fsczoge30sXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIG1vZGVsTmFtZTogbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgcGFyYW1zOiB7fSxcbiAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHthdHRyaWJ1dGVzOiBbXX0pXG4gICAgICB9KVxuICAgICAgc3BlYyA9IGluc3RhbmNlLnBlcm1pdHRlZFBhcmFtcygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGludm9rZSAke3Jlc291cmNlQ2xhc3MubmFtZX0ucGVybWl0dGVkUGFyYW1zKCkgd2hpbGUgZ2VuZXJhdGluZyBmcm9udGVuZCBtb2RlbHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzcGVjKSkgcmV0dXJuIFtdXG5cbiAgICAvKipcbiAgICAgKiBSZWxhdGlvbnNoaXAgbmFtZXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWVzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3BlYykge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGVudHJ5KSkge1xuICAgICAgICBpZiAoIWtleS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIGNvbnRpbnVlXG4gICAgICAgIGNvbnN0IG5hbWUgPSBrZXkuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcbiAgICAgICAgaWYgKG5hbWUpIHJlbGF0aW9uc2hpcE5hbWVzLnB1c2gobmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBhcnJheSBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGb3JtYXR0aW5nIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmluZGVudCAtIEJhc2UgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb3BlcnR5TmFtZSAtIE9iamVjdCBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLnZhbHVlcyAtIFN0cmluZyB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRm9ybWF0dGVkIG11bHRpbGluZSBhcnJheSBwcm9wZXJ0eS5cbiAgICovXG4gIGZvcm1hdHRlZEFycmF5UHJvcGVydHkoe2luZGVudCwgcHJvcGVydHlOYW1lLCB2YWx1ZXN9KSB7XG4gICAgbGV0IG91dHB1dCA9IGAke2luZGVudH0ke3Byb3BlcnR5TmFtZX06IFtcXG5gXG5cbiAgICBmb3IgKGNvbnN0IHZhbHVlIG9mIHZhbHVlcykge1xuICAgICAgb3V0cHV0ICs9IGAke2luZGVudH0gICR7SlNPTi5zdHJpbmdpZnkodmFsdWUpfSxcXG5gXG4gICAgfVxuXG4gICAgb3V0cHV0ICs9IGAke2luZGVudH1dLFxcbmBcblxuICAgIHJldHVybiBvdXRwdXRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBjb21tYW5kcyBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGb3JtYXR0aW5nIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmluZGVudCAtIEJhc2UgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb3BlcnR5TmFtZSAtIE9iamVjdCBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IGFyZ3MudmFsdWVzIC0gQ29tbWFuZCBrZXktdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBtdWx0aWxpbmUgYXJyYXkgcHJvcGVydHkuIEFsd2F5cyBlbWl0c1xuICAgKiAgIHRoZSBjYW1lbENhc2UgbWV0aG9kLW5hbWUgYXJyYXkgZm9ybSAoYG1lbWJlckNvbW1hbmRzOiBbXCJ1cGRhdGVBY2Nlc3NcIl1gKVxuICAgKiAgIHNvIHRoZSBnZW5lcmF0ZWQgY29uZmlnIG1hdGNoZXMgdGhlIGNhbm9uaWNhbFxuICAgKiAgIGBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWcue2NvbGxlY3Rpb24sbWVtYmVyfUNvbW1hbmRzOiBzdHJpbmdbXWBcbiAgICogICBzaGFwZS4gVGhlIHJ1bnRpbWUgZGVyaXZlcyB0aGUgY29tbWFuZCBzbHVnIGZyb20gdGhlIGNhbWVsQ2FzZVxuICAgKiAgIG1ldGhvZCBuYW1lOyBjb25zdW1lcnMgbmV2ZXIgbmVlZCB0byB3cml0ZSBvdXRcbiAgICogICBge3VwZGF0ZUFjY2VzczogXCJ1cGRhdGUtYWNjZXNzXCJ9YCBieSBoYW5kLlxuICAgKi9cbiAgZm9ybWF0dGVkQ29tbWFuZHNQcm9wZXJ0eSh7aW5kZW50LCBwcm9wZXJ0eU5hbWUsIHZhbHVlc30pIHtcbiAgICByZXR1cm4gdGhpcy5mb3JtYXR0ZWRBcnJheVByb3BlcnR5KHtpbmRlbnQsIHByb3BlcnR5TmFtZSwgdmFsdWVzOiBPYmplY3Qua2V5cyh2YWx1ZXMpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBvYmplY3QgcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRm9ybWF0dGluZyBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbmRlbnQgLSBCYXNlIGluZGVudGF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcm9wZXJ0eU5hbWUgLSBPYmplY3QgcHJvcGVydHkgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBhcmdzLnZhbHVlcyAtIE9iamVjdCBrZXktdmFsdWVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IFthcmdzLmZpbHRlckRlZmF1bHRWYWx1ZXNdIC0gRGVmYXVsdCB2YWx1ZXMgdG8gb21pdCBmcm9tIG91dHB1dC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgbXVsdGlsaW5lIG9iamVjdCBwcm9wZXJ0eS5cbiAgICovXG4gIGZvcm1hdHRlZE9iamVjdFByb3BlcnR5KHtmaWx0ZXJEZWZhdWx0VmFsdWVzLCBpbmRlbnQsIHByb3BlcnR5TmFtZSwgdmFsdWVzfSkge1xuICAgIGxldCBvdXRwdXQgPSBgJHtpbmRlbnR9JHtwcm9wZXJ0eU5hbWV9OiB7XFxuYFxuXG4gICAgZm9yIChjb25zdCBvYmplY3RLZXkgb2YgT2JqZWN0LmtleXModmFsdWVzKSkge1xuICAgICAgaWYgKGZpbHRlckRlZmF1bHRWYWx1ZXMgJiYgZmlsdGVyRGVmYXVsdFZhbHVlc1tvYmplY3RLZXldID09PSB2YWx1ZXNbb2JqZWN0S2V5XSkgY29udGludWVcblxuICAgICAgb3V0cHV0ICs9IGAke2luZGVudH0gICR7b2JqZWN0S2V5fTogJHtKU09OLnN0cmluZ2lmeSh2YWx1ZXNbb2JqZWN0S2V5XSl9LFxcbmBcbiAgICB9XG5cbiAgICBvdXRwdXQgKz0gYCR7aW5kZW50fX0sXFxuYFxuXG4gICAgcmV0dXJuIG91dHB1dFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0dGVkIEpTT04gcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRm9ybWF0dGluZyBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbmRlbnQgLSBCYXNlIGluZGVudGF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcm9wZXJ0eU5hbWUgLSBPYmplY3QgcHJvcGVydHkgbmFtZS5cbiAgICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnZhbHVlIC0gSlNPTi1jb21wYXRpYmxlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBwcm9wZXJ0eS5cbiAgICovXG4gIGZvcm1hdHRlZEpzb25Qcm9wZXJ0eSh7aW5kZW50LCBwcm9wZXJ0eU5hbWUsIHZhbHVlfSkge1xuICAgIHJldHVybiBgJHtpbmRlbnR9JHtwcm9wZXJ0eU5hbWV9OiAke3RoaXMuZm9ybWF0dGVkSnNvblZhbHVlKHtpbmRlbnQsIHZhbHVlfSl9LFxcbmBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdHRlZCBKU09OIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZvcm1hdHRpbmcgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW5kZW50IC0gSW5kZW50YXRpb24gYmVmb3JlIHRoaXMgdmFsdWUuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy52YWx1ZSAtIEpTT04tY29tcGF0aWJsZSB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgdmFsdWUuXG4gICAqL1xuICBmb3JtYXR0ZWRKc29uVmFsdWUoe2luZGVudCwgdmFsdWV9KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBsZXQgb3V0cHV0ID0gXCJbXFxuXCJcblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiB2YWx1ZSkge1xuICAgICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fSAgJHt0aGlzLmZvcm1hdHRlZEpzb25WYWx1ZSh7aW5kZW50OiBgJHtpbmRlbnR9ICBgLCB2YWx1ZTogZW50cnl9KX0sXFxuYFxuICAgICAgfVxuXG4gICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fV1gXG5cbiAgICAgIHJldHVybiBvdXRwdXRcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBsZXQgb3V0cHV0ID0gXCJ7XFxuXCJcblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModmFsdWUpKSB7XG4gICAgICAgIG91dHB1dCArPSBgJHtpbmRlbnR9ICAke3RoaXMuZm9ybWF0dGVkT2JqZWN0S2V5KGtleSl9OiAke3RoaXMuZm9ybWF0dGVkSnNvblZhbHVlKHtpbmRlbnQ6IGAke2luZGVudH0gIGAsIHZhbHVlOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAodmFsdWUpW2tleV19KX0sXFxuYFxuICAgICAgfVxuXG4gICAgICBvdXRwdXQgKz0gYCR7aW5kZW50fX1gXG5cbiAgICAgIHJldHVybiBvdXRwdXRcbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JtYXR0ZWQgb2JqZWN0IGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE9iamVjdCBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSmF2YVNjcmlwdCBvYmplY3Qga2V5LlxuICAgKi9cbiAgZm9ybWF0dGVkT2JqZWN0S2V5KGtleSkge1xuICAgIHJldHVybiAvXltBLVphLXpfJF1bXFx3JF0qJC8udGVzdChrZXkpID8ga2V5IDogSlNPTi5zdHJpbmdpZnkoa2V5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0cmlidXRlIGRlZmluaXRpb25zIGZvciBtb2RlbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsQ2xhc3MgLSBCYWNrZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MubW9kZWxDb25maWcgLSBNb2RlbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gW2FyZ3MucmVzb3VyY2VDbGFzc10gLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2pzRG9jVHlwZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcsIHdyaXRlSnNEb2NUeXBlOiBzdHJpbmd9Pj59IC0gQXR0cmlidXRlIGRlZmluaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgYXR0cmlidXRlRGVmaW5pdGlvbnNGb3JNb2RlbCh7Y2xhc3NOYW1lLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBsZXQgYXR0cmlidXRlcyA9IG1vZGVsQ29uZmlnLmF0dHJpYnV0ZXNcblxuICAgIC8vIEF1dG8tZGVyaXZlIGF0dHJpYnV0ZXMgZnJvbSBtb2RlbCBjb2x1bW5zIHdoZW4gbm90IGV4cGxpY2l0bHkgZGVmaW5lZFxuICAgIGlmICgoIWF0dHJpYnV0ZXMgfHwgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykgJiYgYXR0cmlidXRlcy5sZW5ndGggPT09IDApKSAmJiBtb2RlbENsYXNzKSB7XG4gICAgICBjb25zdCBjb2x1bW5zID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5zKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY29sdW1ucykpIHtcbiAgICAgICAgYXR0cmlidXRlcyA9IGNvbHVtbnMubWFwKChjb2x1bW4pID0+IGluZmxlY3Rpb24uY2FtZWxpemUoY29sdW1uLmdldE5hbWUoKSwgdHJ1ZSkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZURlZmluaXRpb25zID0gW11cblxuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVEZWZpbml0aW9uIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgLyoqIEB0eXBlIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGx9ICovXG4gICAgICAgIGxldCBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnID0gbnVsbFxuICAgICAgICBsZXQgYXR0cmlidXRlTmFtZVxuXG4gICAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlRGVmaW5pdGlvbiA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgYXR0cmlidXRlTmFtZSA9IGF0dHJpYnV0ZURlZmluaXRpb25cbiAgICAgICAgfSBlbHNlIGlmIChhdHRyaWJ1dGVEZWZpbml0aW9uICYmIHR5cGVvZiBhdHRyaWJ1dGVEZWZpbml0aW9uID09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoYXR0cmlidXRlRGVmaW5pdGlvbikpIHtcbiAgICAgICAgICBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnID0gLyoqIEB0eXBlIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30gKi8gKGF0dHJpYnV0ZURlZmluaXRpb24pXG4gICAgICAgICAgYXR0cmlidXRlTmFtZSA9IGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcubmFtZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVOYW1lICE9IFwic3RyaW5nXCIgfHwgYXR0cmlidXRlTmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgYXJyYXkgZW50cmllcyB0byBiZSBzdHJpbmdzIG9yIG9iamVjdHMgd2l0aCBhIG5hbWUsIGdvdDogJHtKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGVEZWZpbml0aW9uKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXR0cmlidXRlQ29uZmlnID0gYXdhaXQgdGhpcy5yZXNvbHZlZEZyb250ZW5kQXR0cmlidXRlQ29uZmlnKHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnLFxuICAgICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgICAgcmVzb3VyY2VDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnN0IGZyb250ZW5kQXR0cmlidXRlQ29uZmlnID0gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckdlbmVyYXRlZEF0dHJpYnV0ZSh7XG4gICAgICAgICAgYXR0cmlidXRlQ29uZmlnLFxuICAgICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgbW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF0dHJpYnV0ZURlZmluaXRpb25zLnB1c2goe1xuICAgICAgICAgIGpzRG9jVHlwZTogdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZEF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnOiBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30pLFxuICAgICAgICAgIG5hbWU6IGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgd3JpdGVKc0RvY1R5cGU6IHRoaXMuanNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnOiBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30pXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVEZWZpbml0aW9uc1xuICAgIH1cblxuICAgIGlmICghYXR0cmlidXRlcyB8fCB0eXBlb2YgYXR0cmlidXRlcyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAnYXR0cmlidXRlcycgYXMgYXJyYXkgb3Igb2JqZWN0IGJ1dCBnb3Q6ICR7YXR0cmlidXRlc31gKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dHJpYnV0ZURlZmluaXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgYXR0cmlidXRlQ29uZmlnID0gYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgICAgY29uc3QgY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZyA9IGF0dHJpYnV0ZUNvbmZpZyAmJiB0eXBlb2YgYXR0cmlidXRlQ29uZmlnID09PSBcIm9iamVjdFwiXG4gICAgICAgID8gLyoqIEB0eXBlIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ30gKi8gKGF0dHJpYnV0ZUNvbmZpZylcbiAgICAgICAgOiBudWxsXG4gICAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlQ29uZmlnID0gYXdhaXQgdGhpcy5yZXNvbHZlZEZyb250ZW5kQXR0cmlidXRlQ29uZmlnKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZSxcbiAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnLFxuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICByZXNvdXJjZUNsYXNzXG4gICAgICB9KVxuICAgICAgY29uc3QgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgPSB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yR2VuZXJhdGVkQXR0cmlidXRlKHtcbiAgICAgICAgYXR0cmlidXRlQ29uZmlnOiBub3JtYWxpemVkQXR0cmlidXRlQ29uZmlnLFxuICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICBtb2RlbENsYXNzXG4gICAgICB9KVxuXG4gICAgICBhdHRyaWJ1dGVEZWZpbml0aW9ucy5wdXNoKHtcbiAgICAgICAganNEb2NUeXBlOiB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWc6IGZyb250ZW5kQXR0cmlidXRlQ29uZmlnfSksXG4gICAgICAgIG5hbWU6IGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIHdyaXRlSnNEb2NUeXBlOiB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kV3JpdGVBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZzogZnJvbnRlbmRBdHRyaWJ1dGVDb25maWd9KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlRGVmaW5pdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIGdlbmVyYXRlZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZUNvbmZpZzogRnJvbnRlbmRBdHRyaWJ1dGVDb25maWcsIGF0dHJpYnV0ZU5hbWU6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnfSAtIEF0dHJpYnV0ZSBjb25maWcgdXNlZCBmb3IgZ2VuZXJhdGVkIEpTRG9jLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JHZW5lcmF0ZWRBdHRyaWJ1dGUoe2F0dHJpYnV0ZUNvbmZpZywgYXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIXRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVJc01vZGVsUHJpbWFyeUtleSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pKSByZXR1cm4gYXR0cmlidXRlQ29uZmlnXG4gICAgaWYgKHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdIYXNOdWxsYWJpbGl0eShhdHRyaWJ1dGVDb25maWcpKSByZXR1cm4gYXR0cmlidXRlQ29uZmlnXG5cbiAgICByZXR1cm4gey4uLmF0dHJpYnV0ZUNvbmZpZywgbnVsbDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgaXMgbW9kZWwgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGlzIHRoZSBtb2RlbCBwcmltYXJ5IGtleS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlSXNNb2RlbFByaW1hcnlLZXkoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFtb2RlbENsYXNzKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXldKSB7XG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gY29sdW1uTmFtZSkgcmV0dXJuIHRydWVcbiAgICAgIGlmIChtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGNvbHVtbk5hbWUpID09PSBhdHRyaWJ1dGVOYW1lKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBwcmltYXJ5IGtleSBmcm9tIGV4cGxpY2l0IHJlc291cmNlIGNvbmZpZyBvciB0aGUgYmFja2VuZCBtb2RlbC5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZXM6IEFycmF5PHN0cmluZz4sIG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgbW9kZWxDb25maWc6IGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259fSBhcmdzIC0gUHJpbWFyeSBrZXkgcmVzb2x1dGlvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nPn0gLSBGcm9udGVuZC1tb2RlbCBwcmltYXJ5IGtleSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5Rm9yUmVzb3VyY2Uoe2F0dHJpYnV0ZU5hbWVzLCBtb2RlbENsYXNzLCBtb2RlbENvbmZpZ30pIHtcbiAgICBpZiAobW9kZWxDb25maWcucHJpbWFyeUtleSkge1xuICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdGVkQ29uZmlndXJlZFByaW1hcnlLZXkoe2F0dHJpYnV0ZU5hbWVzLCBwcmltYXJ5S2V5OiBtb2RlbENvbmZpZy5wcmltYXJ5S2V5fSlcbiAgICB9XG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHJldHVybiBcImlkXCJcblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5Rm9yTW9kZWxDbGFzcyh7YXR0cmlidXRlTmFtZXMsIG1vZGVsQ2xhc3N9KVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhbiBleHBsaWNpdGx5IGNvbmZpZ3VyZWQgZnJvbnRlbmQtbW9kZWwgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWVzOiBBcnJheTxzdHJpbmc+LCBwcmltYXJ5S2V5OiBzdHJpbmcgfCBzdHJpbmdbXX19IGFyZ3MgLSBDb25maWd1cmVkIHByaW1hcnkga2V5IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBzdHJpbmdbXX0gLSBDb25maWd1cmVkIHByaW1hcnkga2V5LlxuICAgKi9cbiAgdmFsaWRhdGVkQ29uZmlndXJlZFByaW1hcnlLZXkoe2F0dHJpYnV0ZU5hbWVzLCBwcmltYXJ5S2V5fSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXlBdHRyaWJ1dGVzID0gQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSA/IHByaW1hcnlLZXkgOiBbcHJpbWFyeUtleV1cblxuICAgIGlmIChwcmltYXJ5S2V5QXR0cmlidXRlcy5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIGNvbXBvc2l0ZSBwcmltYXJ5IGtleSBtdXN0IGNvbnRhaW4gYXQgbGVhc3Qgb25lIGF0dHJpYnV0ZS5cIilcbiAgICB9XG5cbiAgICBpZiAobmV3IFNldChwcmltYXJ5S2V5QXR0cmlidXRlcykuc2l6ZSAhPT0gcHJpbWFyeUtleUF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIGNvbXBvc2l0ZSBwcmltYXJ5IGtleSBhdHRyaWJ1dGVzIG11c3QgYmUgdW5pcXVlLlwiKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBwcmltYXJ5S2V5QXR0cmlidXRlcykge1xuICAgICAgaWYgKCFhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgcHJpbWFyeSBrZXkgXCIke2F0dHJpYnV0ZU5hbWV9XCIgaXMgbm90IGEgZ2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZS5gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwcmltYXJ5S2V5XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGJhY2tlbmQgcHJpbWFyeSBrZXkgdG8gZ2VuZXJhdGVkIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZXM6IEFycmF5PHN0cmluZz4sIG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19IGFyZ3MgLSBQcmltYXJ5IGtleSByZXNvbHV0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBBcnJheTxzdHJpbmc+fSAtIEZyb250ZW5kLW1vZGVsIHByaW1hcnkga2V5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlGb3JNb2RlbENsYXNzKHthdHRyaWJ1dGVOYW1lcywgbW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gbW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIGlmIChwcmltYXJ5S2V5ID09PSBcImlkXCIpIHJldHVybiBcImlkXCJcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSB7XG4gICAgICByZXR1cm4gcHJpbWFyeUtleS5tYXAoKGNvbHVtbk5hbWUpID0+IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlBdHRyaWJ1dGVOYW1lKHthdHRyaWJ1dGVOYW1lcywgY29sdW1uTmFtZSwgbW9kZWxDbGFzc30pKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5QXR0cmlidXRlTmFtZSh7YXR0cmlidXRlTmFtZXMsIGNvbHVtbk5hbWU6IHByaW1hcnlLZXksIG1vZGVsQ2xhc3N9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uZSBiYWNrZW5kIHByaW1hcnkga2V5IGNvbHVtbiB0byBhIGdlbmVyYXRlZCBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlTmFtZXM6IEFycmF5PHN0cmluZz4sIGNvbHVtbk5hbWU6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIFByaW1hcnkga2V5IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnJvbnRlbmQtbW9kZWwgcHJpbWFyeSBrZXkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUHJpbWFyeUtleUF0dHJpYnV0ZU5hbWUoe2F0dHJpYnV0ZU5hbWVzLCBjb2x1bW5OYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGlmIChhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhjb2x1bW5OYW1lKSkgcmV0dXJuIGNvbHVtbk5hbWVcblxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZSAmJiBhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxDbGFzcy5uYW1lfS5wcmltYXJ5S2V5KCkgY29sdW1uIFwiJHtjb2x1bW5OYW1lfVwiIGRvZXMgbm90IHJlc29sdmUgdG8gYSBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlLmApXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmcm9tIGV4cGxpY2l0IG1ldGFkYXRhLCByZXNvdXJjZSBtZXRob2RzLCBtb2RlbCBjb2x1bW5zLCB0cmFuc2xhdGVkIGNvbHVtbnMsIG9yIG1vZGVsIGFjY2Vzc29yIEpTRG9jLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jbGFzc05hbWUgLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbH0gYXJncy5jb25maWd1cmVkQXR0cmlidXRlQ29uZmlnIC0gUmVzb3VyY2UtcHJvdmlkZWQgYXR0cmlidXRlIGNvbmZpZy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRBdHRyaWJ1dGVDb25maWc+fSAtIFJlc29sdmVkIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcuXG4gICAqL1xuICBhc3luYyByZXNvbHZlZEZyb250ZW5kQXR0cmlidXRlQ29uZmlnKHthdHRyaWJ1dGVOYW1lLCBjbGFzc05hbWUsIGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWcsIG1vZGVsQ2xhc3MsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgY29uc3QgaW5mZXJyZWRSZXNvdXJjZUNvbmZpZyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JSZXNvdXJjZUF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZSwgcmVzb3VyY2VDbGFzc30pXG4gICAgY29uc3QgaW5mZXJyZWRDb2x1bW5Db25maWcgPSBpbmZlcnJlZFJlc291cmNlQ29uZmlnXG4gICAgICA/IG51bGxcbiAgICAgIDogdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0Zvck1vZGVsQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSlcbiAgICBjb25zdCBpbmZlcnJlZFRyYW5zbGF0ZWRDb25maWcgPSBpbmZlcnJlZFJlc291cmNlQ29uZmlnIHx8IGluZmVycmVkQ29sdW1uQ29uZmlnXG4gICAgICA/IG51bGxcbiAgICAgIDogdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvclRyYW5zbGF0ZWRBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIHJlc291cmNlQ2xhc3N9KVxuICAgIGNvbnN0IGluZmVycmVkTW9kZWxBY2Nlc3NvckNvbmZpZyA9IGluZmVycmVkUmVzb3VyY2VDb25maWcgfHwgaW5mZXJyZWRDb2x1bW5Db25maWcgfHwgaW5mZXJyZWRUcmFuc2xhdGVkQ29uZmlnXG4gICAgICA/IG51bGxcbiAgICAgIDogYXdhaXQgdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0Zvck1vZGVsQWNjZXNzb3Ioe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KVxuICAgIGNvbnN0IGluZmVycmVkQ29uZmlnID0gaW5mZXJyZWRSZXNvdXJjZUNvbmZpZyB8fCBpbmZlcnJlZENvbHVtbkNvbmZpZyB8fCBpbmZlcnJlZFRyYW5zbGF0ZWRDb25maWcgfHwgaW5mZXJyZWRNb2RlbEFjY2Vzc29yQ29uZmlnXG5cbiAgICBpZiAoY29uZmlndXJlZEF0dHJpYnV0ZUNvbmZpZyAmJiB0aGlzLmZyb250ZW5kQXR0cmlidXRlQ29uZmlnSGFzVHlwZShjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnKSkge1xuICAgICAgcmV0dXJuIGluZmVycmVkQ29uZmlnXG4gICAgICAgID8gey4uLmluZmVycmVkQ29uZmlnLCAuLi5jb25maWd1cmVkQXR0cmlidXRlQ29uZmlnfVxuICAgICAgICA6IGNvbmZpZ3VyZWRBdHRyaWJ1dGVDb25maWdcbiAgICB9XG5cbiAgICBpZiAoaW5mZXJyZWRDb25maWcpIHtcbiAgICAgIHJldHVybiBjb25maWd1cmVkQXR0cmlidXRlQ29uZmlnXG4gICAgICAgID8gey4uLmluZmVycmVkQ29uZmlnLCAuLi5jb25maWd1cmVkQXR0cmlidXRlQ29uZmlnfVxuICAgICAgICA6IGluZmVycmVkQ29uZmlnXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgaW5mZXIgSlNEb2MgdHlwZSBmb3IgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlICcke2NsYXNzTmFtZX0jJHthdHRyaWJ1dGVOYW1lfScuIEFkZCBhIGJhY2tlbmQgbW9kZWwgY29sdW1uLCB0cmFuc2xhdGlvbiB0YWJsZSBjb2x1bW4sIGV4cGxpY2l0IHJlc291cmNlIG1ldGFkYXRhLCBvciBhIEByZXR1cm5zIEpTRG9jIHR5cGUgb24gJHtyZXNvdXJjZUNsYXNzPy5uYW1lIHx8IFwidGhlIHJlc291cmNlXCJ9LiR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGUoKS5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBoYXMgdHlwZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbmZpZyBkZWNsYXJlcyBhIHR5cGUgc291cmNlLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdIYXNUeXBlKGF0dHJpYnV0ZUNvbmZpZykge1xuICAgIHJldHVybiB0eXBlb2YgdGhpcy5mcm9udGVuZEF0dHJpYnV0ZVR5cGVWYWx1ZShhdHRyaWJ1dGVDb25maWcpID09IFwic3RyaW5nXCJcbiAgICAgIHx8IHR5cGVvZiBhdHRyaWJ1dGVDb25maWc/LmpzRG9jVHlwZSA9PSBcInN0cmluZ1wiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgY29uZmlnIGhhcyBudWxsYWJpbGl0eS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbmZpZyBkZWNsYXJlcyBudWxsYWJpbGl0eS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnSGFzTnVsbGFiaWxpdHkoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChhdHRyaWJ1dGVDb25maWcsIFwibnVsbFwiKSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0eXBlb2YgYXR0cmlidXRlQ29uZmlnLmdldE51bGwgPT0gXCJmdW5jdGlvblwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgdHlwZSBmb3IgZnJvbnRlbmQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSlNEb2MgdHlwZS5cbiAgICovXG4gIGpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlKHthdHRyaWJ1dGVDb25maWd9KSB7XG4gICAgaWYgKGF0dHJpYnV0ZUNvbmZpZyAmJiB0eXBlb2YgYXR0cmlidXRlQ29uZmlnLmpzRG9jVHlwZSA9PSBcInN0cmluZ1wiICYmIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGUubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGVcbiAgICB9XG5cbiAgICBjb25zdCBqc0RvY1R5cGUgPSB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKVxuXG4gICAgaWYgKCF0aGlzLmZyb250ZW5kQXR0cmlidXRlQ2FuQmVOdWxsKGF0dHJpYnV0ZUNvbmZpZykpIHtcbiAgICAgIHJldHVybiBqc0RvY1R5cGVcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7anNEb2NUeXBlfSB8IG51bGxgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgdHlwZSBmb3IgZnJvbnRlbmQgd3JpdGUgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuYXR0cmlidXRlQ29uZmlnIC0gQXR0cmlidXRlIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSlNEb2MgdHlwZSBhY2NlcHRlZCBieSBjcmVhdGUvdXBkYXRlIHBheWxvYWRzLlxuICAgKi9cbiAganNEb2NUeXBlRm9yRnJvbnRlbmRXcml0ZUF0dHJpYnV0ZSh7YXR0cmlidXRlQ29uZmlnfSkge1xuICAgIGlmIChhdHRyaWJ1dGVDb25maWcgJiYgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5qc0RvY1R5cGUgPT0gXCJzdHJpbmdcIiAmJiBhdHRyaWJ1dGVDb25maWcuanNEb2NUeXBlLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVDb25maWcuanNEb2NUeXBlXG4gICAgfVxuXG4gICAgY29uc3QganNEb2NUeXBlID0gdGhpcy5qc0RvY1R5cGVGb3JGcm9udGVuZFdyaXRlQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKVxuXG4gICAgaWYgKCF0aGlzLmZyb250ZW5kQXR0cmlidXRlQ2FuQmVOdWxsKGF0dHJpYnV0ZUNvbmZpZykpIHtcbiAgICAgIHJldHVybiBqc0RvY1R5cGVcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7anNEb2NUeXBlfSB8IG51bGxgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgdHlwZSBmb3IgZnJvbnRlbmQgd3JpdGUgYXR0cmlidXRlIGJhc2UgdHlwZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vbi1udWxsYWJsZSBKU0RvYyB0eXBlIGFjY2VwdGVkIGJ5IGNyZWF0ZS91cGRhdGUgcGF5bG9hZHMuXG4gICAqL1xuICBqc0RvY1R5cGVGb3JGcm9udGVuZFdyaXRlQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgY29uc3QgcmVhZFR5cGUgPSB0aGlzLmpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKVxuXG4gICAgaWYgKCF0aGlzLmZyb250ZW5kQXR0cmlidXRlVHlwZUlzVGVtcG9yYWwoYXR0cmlidXRlQ29uZmlnKSkgcmV0dXJuIHJlYWRUeXBlXG5cbiAgICByZXR1cm4gYCR7cmVhZFR5cGV9IHwgc3RyaW5nYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHR5cGUgZm9yIGZyb250ZW5kIGF0dHJpYnV0ZSBiYXNlIHR5cGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsIHwgdW5kZWZpbmVkfSBhdHRyaWJ1dGVDb25maWcgLSBBdHRyaWJ1dGUgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBOb24tbnVsbGFibGUgSlNEb2MgdHlwZS5cbiAgICovXG4gIGpzRG9jVHlwZUZvckZyb250ZW5kQXR0cmlidXRlQmFzZVR5cGUoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCJcbiAgICB9XG5cbiAgICBjb25zdCB0eXBlID0gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZVR5cGVWYWx1ZShhdHRyaWJ1dGVDb25maWcpXG5cbiAgICBpZiAodHlwZSA9PSBcImJvb2xlYW5cIikge1xuICAgICAgcmV0dXJuIFwiYm9vbGVhblwiXG4gICAgfSBlbHNlIGlmICh0eXBlID09IFwianNvblwiIHx8IHR5cGUgPT0gXCJqc29uYlwiKSB7XG4gICAgICByZXR1cm4gXCJGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcIlxuICAgIH0gZWxzZSBpZiAodHlwZSAmJiBbXCJibG9iXCIsIFwiY2hhclwiLCBcIm52YXJjaGFyXCIsIFwidmFyY2hhclwiLCBcInRleHRcIiwgXCJsb25ndGV4dFwiLCBcIm1lZGl1bXRleHRcIiwgXCJ0aW55dGV4dFwiLCBcInV1aWRcIiwgXCJjaGFyYWN0ZXIgdmFyeWluZ1wiXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgcmV0dXJuIFwic3RyaW5nXCJcbiAgICB9IGVsc2UgaWYgKHR5cGUgJiYgW1wiYml0XCIsIFwiYmlnaW50XCIsIFwiZGVjaW1hbFwiLCBcImRvdWJsZVwiLCBcImRvdWJsZSBwcmVjaXNpb25cIiwgXCJmbG9hdFwiLCBcImludFwiLCBcImludGVnZXJcIiwgXCJudW1lcmljXCIsIFwicmVhbFwiLCBcInNtYWxsaW50XCIsIFwidGlueWludFwiXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgcmV0dXJuIFwibnVtYmVyXCJcbiAgICB9IGVsc2UgaWYgKHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVUeXBlSXNUZW1wb3JhbChhdHRyaWJ1dGVDb25maWcpKSB7XG4gICAgICByZXR1cm4gXCJEYXRlXCJcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgdHlwZSBpcyB0ZW1wb3JhbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgcmVwcmVzZW50cyBhIGRhdGUvdGltZSB2YWx1ZS5cbiAgICovXG4gIGZyb250ZW5kQXR0cmlidXRlVHlwZUlzVGVtcG9yYWwoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCB0eXBlID0gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZVR5cGVWYWx1ZShhdHRyaWJ1dGVDb25maWcpXG5cbiAgICByZXR1cm4gdHlwZSA/IFtcImRhdGVcIiwgXCJkYXRldGltZVwiLCBcInRpbWVzdGFtcFwiLCBcInRpbWVzdGFtcCB3aXRob3V0IHRpbWUgem9uZVwiLCBcInRpbWVzdGFtcHR6XCJdLmluY2x1ZGVzKHR5cGUpIDogZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjYW4gYmUgbnVsbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgYWxsb3dzIG51bGwgdmFsdWVzLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDYW5CZU51bGwoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVDb25maWcuZ2V0TnVsbCA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVDb25maWcuZ2V0TnVsbCgpID09PSB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZUNvbmZpZy5udWxsID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgdHlwZSB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGwgfCB1bmRlZmluZWR9IGF0dHJpYnV0ZUNvbmZpZyAtIEF0dHJpYnV0ZSBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBOb3JtYWxpemVkIGNvbHVtbiB0eXBlLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVUeXBlVmFsdWUoYXR0cmlidXRlQ29uZmlnKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVDb25maWcgfHwgdHlwZW9mIGF0dHJpYnV0ZUNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5nZXRUeXBlID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIFN0cmluZyhhdHRyaWJ1dGVDb25maWcuZ2V0VHlwZSgpKVxuICAgIH1cblxuICAgIGNvbnN0IHR5cGVWYWx1ZSA9IGF0dHJpYnV0ZUNvbmZpZy50eXBlIHx8IGF0dHJpYnV0ZUNvbmZpZy5jb2x1bW5UeXBlIHx8IGF0dHJpYnV0ZUNvbmZpZy5zcWxUeXBlIHx8IGF0dHJpYnV0ZUNvbmZpZy5kYXRhVHlwZVxuXG4gICAgaWYgKHR5cGVvZiB0eXBlVmFsdWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIHR5cGVWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgcmVzb3VyY2UgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5yZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kQXR0cmlidXRlQ29uZmlnIHwgbnVsbD59IC0gQXR0cmlidXRlIGNvbmZpZyBpbmZlcnJlZCBmcm9tIHJlc291cmNlIG1ldGhvZCBKU0RvYy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQXR0cmlidXRlQ29uZmlnRm9yUmVzb3VyY2VBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgbWV0aG9kTmFtZSA9IGAke2F0dHJpYnV0ZU5hbWV9QXR0cmlidXRlYFxuICAgIGNvbnN0IG93bmVyQ2xhc3NOYW1lID0gdGhpcy5tZXRob2RPd25lckNsYXNzTmFtZSh7bWV0aG9kTmFtZSwgdGFyZ2V0Q2xhc3M6IHJlc291cmNlQ2xhc3N9KVxuXG4gICAgaWYgKCFvd25lckNsYXNzTmFtZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGpzRG9jVHlwZSA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlKHtcbiAgICAgIG1ldGhvZE5hbWUsXG4gICAgICBzb3VyY2VDbGFzc05hbWU6IG93bmVyQ2xhc3NOYW1lXG4gICAgfSlcblxuICAgIHJldHVybiBqc0RvY1R5cGUgPyB7anNEb2NUeXBlOiB0aGlzLnVud3JhcHBlZFByb21pc2VKc0RvY1R5cGUoe2pzRG9jVHlwZX0pfSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIHRyYW5zbGF0ZWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MucmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsfSAtIEF0dHJpYnV0ZSBjb25maWcgaW5mZXJyZWQgZnJvbSB0cmFuc2xhdGVkIGF0dHJpYnV0ZSBjb2x1bW5zLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JUcmFuc2xhdGVkQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGlmICghbW9kZWxDbGFzcykgcmV0dXJuIG51bGxcbiAgICBpZiAoIXRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVJc1RyYW5zbGF0ZWQoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIHJlc291cmNlQ2xhc3N9KSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSBtb2RlbENsYXNzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoYXR0cmlidXRlTmFtZSlcblxuICAgIGxldCBjb2x1bW5cblxuICAgIHRyeSB7XG4gICAgICBjb2x1bW4gPSBUcmFuc2xhdGlvbkNsYXNzLmdldENvbHVtbnNIYXNoKClbY29sdW1uTmFtZV1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgKGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJoYXNuJ3QgYmVlbiBpbml0aWFsaXplZCB5ZXRcIikgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhcInVzZWQgYmVmb3JlIGluaXRpYWxpemF0aW9uXCIpKSkgcmV0dXJuIG51bGxcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gY29sdW1uID8gdGhpcy5mcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckNvbHVtbih7Y29sdW1ufSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRyaWJ1dGUgaXMgdHJhbnNsYXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZnJvbnRlbmQgYXR0cmlidXRlIGlzIHRyYW5zbGF0ZWQuXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUlzVHJhbnNsYXRlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgcmVzb3VyY2VDbGFzc30pIHtcbiAgICBpZiAocmVzb3VyY2VDbGFzcykge1xuICAgICAgY29uc3QgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSByZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodHJhbnNsYXRlZEF0dHJpYnV0ZXMpICYmIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zbGF0aW9ucyA9IG1vZGVsQ2xhc3MuX3RyYW5zbGF0aW9uc1xuXG4gICAgcmV0dXJuIEJvb2xlYW4odHJhbnNsYXRpb25zICYmIHR5cGVvZiB0cmFuc2xhdGlvbnMgPT0gXCJvYmplY3RcIiAmJiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodHJhbnNsYXRpb25zLCBhdHRyaWJ1dGVOYW1lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIG1vZGVsIGFjY2Vzc29yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRBdHRyaWJ1dGVDb25maWcgfCBudWxsPn0gLSBBdHRyaWJ1dGUgY29uZmlnIGluZmVycmVkIGZyb20gbW9kZWwgYWNjZXNzb3IgSlNEb2MuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0Zvck1vZGVsQWNjZXNzb3Ioe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFtb2RlbENsYXNzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgb3duZXJDbGFzc05hbWUgPSB0aGlzLm1ldGhvZE93bmVyQ2xhc3NOYW1lKHttZXRob2ROYW1lOiBhdHRyaWJ1dGVOYW1lLCB0YXJnZXRDbGFzczogbW9kZWxDbGFzc30pXG5cbiAgICBpZiAoIW93bmVyQ2xhc3NOYW1lKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QganNEb2NUeXBlID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFJldHVyblR5cGUoe1xuICAgICAgbWV0aG9kTmFtZTogYXR0cmlidXRlTmFtZSxcbiAgICAgIHNvdXJjZUNsYXNzTmFtZTogb3duZXJDbGFzc05hbWVcbiAgICB9KVxuXG4gICAgLy8gRnJvbnRlbmQgYXR0cmlidXRlcyBob2xkIHRoZSBzZXJpYWxpemVkIChyZXNvbHZlZCkgdmFsdWUsIHNvIGFuIGFzeW5jXG4gICAgLy8gYmFja2VuZCBhY2Nlc3NvciB0eXBlZCBgUHJvbWlzZTxudW1iZXI+YCBtdXN0IHN1cmZhY2UgYXMgYG51bWJlcmAg4oCUIHRoZVxuICAgIC8vIHNhbWUgdW53cmFwcGluZyB0aGUgcmVzb3VyY2UtbWV0aG9kIGluZmVyZW5jZSBwYXRoIGFwcGxpZXMuXG4gICAgcmV0dXJuIGpzRG9jVHlwZVxuICAgICAgPyB7anNEb2NUeXBlOiB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZUF0dHJpYnV0ZUpzRG9jVHlwZSh0aGlzLnVud3JhcHBlZFByb21pc2VKc0RvY1R5cGUoe2pzRG9jVHlwZX0pKX1cbiAgICAgIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEEgYmFja2VuZCBhY2Nlc3NvcidzIGBAcmV0dXJuc2AgY2FuIHJlZmVyZW5jZSB0eXBlcyB0aGF0IGV4aXN0IG9ubHkgb24gdGhlXG4gICAqIGJhY2tlbmQgKGUuZy4gYSBtb2RlbC1sb2NhbCBgQHR5cGVkZWYgQWdlbnRSdW5QbGFubmluZ0FydGlmYWN0YCkuIFRoZSBmcm9udGVuZFxuICAgKiBtb2RlbCBjYW4ndCByZXNvbHZlIHRob3NlLCBzbyBmYWxsIGJhY2sgdG8gYGFueWAgcmF0aGVyIHRoYW4gZW1pdHRpbmcgYW5cbiAgICogdW5kZWZpbmVkIHR5cGUgbmFtZS4gVHlwZXMgYnVpbHQgb25seSBmcm9tIHByaW1pdGl2ZXMgYW5kIGtub3duIGdlbmVyaWNcbiAgICogYnVpbHRpbnMgcGFzcyB0aHJvdWdoIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVHlwZSAtIFJlc29sdmVkIChQcm9taXNlLXVud3JhcHBlZCkgYXR0cmlidXRlIHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQSBmcm9udGVuZC1yZXNvbHZhYmxlIGF0dHJpYnV0ZSB0eXBlLlxuICAgKi9cbiAgZnJvbnRlbmRSZXNvbHZhYmxlQXR0cmlidXRlSnNEb2NUeXBlKGpzRG9jVHlwZSkge1xuICAgIGNvbnN0IHNhZmVUeXBlSWRlbnRpZmllcnMgPSB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZVR5cGVJZGVudGlmaWVycygpXG4gICAgY29uc3QgcmVmZXJlbmNlZElkZW50aWZpZXJzID0ganNEb2NUeXBlLm1hdGNoKC9bQS1aXVtBLVphLXowLTlfJF0qL2cpIHx8IFtdXG5cbiAgICBpZiAocmVmZXJlbmNlZElkZW50aWZpZXJzLnNvbWUoKGlkZW50aWZpZXIpID0+ICFzYWZlVHlwZUlkZW50aWZpZXJzLmhhcyhpZGVudGlmaWVyKSkpIHtcbiAgICAgIHJldHVybiBcImFueVwiXG4gICAgfVxuXG4gICAgcmV0dXJuIGpzRG9jVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIENhcGl0YWxpemVkIGlkZW50aWZpZXJzIGEgZ2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGNhbiByZXNvbHZlIG9uIGl0cyBvd25cbiAgICogKHByaW1pdGl2ZXMgYXJlIGxvd2VyLWNhc2UgYW5kIG1hdGNoZWQgc2VwYXJhdGVseSksIHNvIG9ubHkgZnJhbWV3b3JrLW93bmVkXG4gICAqIGFuZCBidWlsdGluIGdlbmVyaWMgdHlwZXMgYXJlIGxpc3RlZC5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIEZyb250ZW5kLXJlc29sdmFibGUgdHlwZSBpZGVudGlmaWVycy5cbiAgICovXG4gIGZyb250ZW5kUmVzb2x2YWJsZVR5cGVJZGVudGlmaWVycygpIHtcbiAgICByZXR1cm4gbmV3IFNldChbXG4gICAgICBcIkFycmF5XCIsIFwiRGF0ZVwiLCBcIkV4Y2x1ZGVcIiwgXCJFeHRyYWN0XCIsIFwiRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXCIsIFwiRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXCIsXG4gICAgICBcIk1hcFwiLCBcIk5vbk51bGxhYmxlXCIsIFwiT21pdFwiLCBcIlBhcnRpYWxcIiwgXCJQaWNrXCIsIFwiUHJvbWlzZVwiLCBcIlJlYWRvbmx5XCIsIFwiUmVhZG9ubHlBcnJheVwiLCBcIlJlY29yZFwiLFxuICAgICAgXCJSZXF1aXJlZFwiLCBcIlJldHVyblR5cGVcIiwgXCJTZXRcIlxuICAgIF0pXG4gIH1cblxuICAvKipcbiAgICogUmV3cml0ZXMgYSBjdXN0b20tY29tbWFuZCBwYXJhbS9yZXR1cm4gSlNEb2MgdHlwZSBzbyBpdCByZXNvbHZlcyBpbiB0aGUgZ2VuZXJhdGVkXG4gICAqIGZyb250ZW5kIG1vZGVsOiBiYWNrZW5kIG1vZGVsIGltcG9ydHMgYXJlIG1hcHBlZCB0byBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWxcbiAgICogaW1wb3J0cywgYW5kIG90aGVyd2lzZSBub24tZnJvbnRlbmQtcmVzb2x2YWJsZSBpZGVudGlmaWVycyBiZWNvbWUgYGFueWAgaW4gcGxhY2VcbiAgICogc28gc2libGluZyBzY2FsYXIgZmllbGRzIGtlZXAgdGhlaXIgcmVhbCB0eXBlcy4gVGhlIHdvcmQgYm91bmRhcnkgYXZvaWRzIG1hdGNoaW5nXG4gICAqIHRoZSBjYXBpdGFsaXplZCBtaWRkbGUgb2YgYSBjYW1lbENhc2UgcHJvcGVydHkgbmFtZSAoZS5nLiBgYWRqdXN0ZWRUb3RhbENlbnRzYCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3MuZnJvbnRlbmRNb2RlbEZpbGVQYXRoIC0gR2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtNYXA8c3RyaW5nLCBSZXNvdXJjZUpzRG9jSW1wb3J0QWxpYXM+fSBhcmdzLmltcG9ydEFsaWFzZXMgLSBJbXBvcnQgYWxpYXNlcyB2aXNpYmxlIHRvIHRoZSBzb3VyY2UgbWV0aG9kLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qc0RvY1R5cGUgLSBSZXNvbHZlZCAoUHJvbWlzZS11bndyYXBwZWQpIEpTRG9jIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5zb3VyY2VGaWxlIC0gU291cmNlIGZpbGUgdGhhdCBkZWNsYXJlZCB0aGUgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEEgZnJvbnRlbmQtcmVzb2x2YWJsZSBKU0RvYyB0eXBlLlxuICAgKi9cbiAgZnJvbnRlbmRSZXNvbHZhYmxlQ29tbWFuZEpzRG9jVHlwZSh7ZnJvbnRlbmRNb2RlbEZpbGVQYXRoLCBpbXBvcnRBbGlhc2VzLCBqc0RvY1R5cGUsIHNvdXJjZUZpbGV9KSB7XG4gICAgY29uc3Qgc2FmZVR5cGVJZGVudGlmaWVycyA9IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlVHlwZUlkZW50aWZpZXJzKClcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHByZXNlcnZlZEltcG9ydHMgPSBbXVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyBhbiBpbXBvcnQgZXhwcmVzc2lvbiBiZWhpbmQgYSBsb3dlcmNhc2UgcGxhY2Vob2xkZXIgd2hpbGUgZ2VuZXJpY1xuICAgICAqIGlkZW50aWZpZXIgY2xlYW51cCBydW5zLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBpbXBvcnRFeHByZXNzaW9uIC0gSW1wb3J0IGV4cHJlc3Npb24gdG8gcHJlc2VydmUuXG4gICAgICogQHJldHVybnMge3N0cmluZ30gUGxhY2Vob2xkZXIgaW5zZXJ0ZWQgaW50byB0aGUgdHlwZSBzdHJpbmcuXG4gICAgICovXG4gICAgY29uc3QgcHJlc2VydmVJbXBvcnRFeHByZXNzaW9uID0gKGltcG9ydEV4cHJlc3Npb24pID0+IHtcbiAgICAgIGNvbnN0IHBsYWNlaG9sZGVyID0gYF9fdmVsb2Npb3VzX2ltcG9ydF9wbGFjZWhvbGRlcl8ke3ByZXNlcnZlZEltcG9ydHMubGVuZ3RofV9fYFxuXG4gICAgICBwcmVzZXJ2ZWRJbXBvcnRzLnB1c2goaW1wb3J0RXhwcmVzc2lvbilcblxuICAgICAgcmV0dXJuIHBsYWNlaG9sZGVyXG4gICAgfVxuXG4gICAgdGhpcy5hc3NlcnROb0JhY2tlbmRMb2NhbENvbW1hbmRUeXBlRXhwcmVzc2lvbnMoanNEb2NUeXBlKVxuXG4gICAgY29uc3Qgd2l0aFJld3JpdHRlbklubGluZUltcG9ydHMgPSBqc0RvY1R5cGVcbiAgICAgIC8vIEEgdHlwZSB0aGF0IHJlYWNoZXMgaW50byBhIGJhY2tlbmQgc291cmNlIGZpbGUgdmlhIGBpbXBvcnQoXCIuLi5cIilgXG4gICAgICAvLyAob3B0aW9uYWxseSBgLk1lbWJlcmAgYW5kIGBbXWApIGlzIGZyb250ZW5kLXJlc29sdmFibGUgb25seSB3aGVuIGl0XG4gICAgICAvLyBwb2ludHMgYXQgYSBnZW5lcmF0ZWQgbW9kZWwgZmlsZTsgb3RoZXIgYmFja2VuZC1sb2NhbCBpbXBvcnRzIGNvbGxhcHNlXG4gICAgICAvLyB0byBgYW55YCBzbyBoZWxwZXIvc2VydmljZSBpbXBsZW1lbnRhdGlvbiBkZXRhaWxzIGRvIG5vdCBsZWFrLlxuICAgICAgLnJlcGxhY2UoL2ltcG9ydFxcKFxccypbXCInXShbXlwiJ10qKVtcIiddXFxzKlxcKSgoPzpcXHMqXFwuXFxzKltBLVphLXpfJF1bXFx3JF0qKSopKCg/OlxccypcXFtcXHMqXFxdKSopL2csIChfbWF0Y2gsIHNwZWNpZmllciwgbWVtYmVyQ2hhaW4sIGFycmF5U3VmZml4KSA9PiB7XG4gICAgICAgIGNvbnN0IHJld3JpdHRlblNwZWNpZmllciA9IHRoaXMuZnJvbnRlbmRSZXNvbHZhYmxlSnNEb2NJbXBvcnRTcGVjaWZpZXIoe1xuICAgICAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgICAgICBzb3VyY2VGaWxlLFxuICAgICAgICAgIHNwZWNpZmllclxuICAgICAgICB9KVxuXG4gICAgICAgIGlmICghcmV3cml0dGVuU3BlY2lmaWVyKSByZXR1cm4gXCJhbnlcIlxuXG4gICAgICAgIHJldHVybiBwcmVzZXJ2ZUltcG9ydEV4cHJlc3Npb24oYGltcG9ydCgke0pTT04uc3RyaW5naWZ5KHJld3JpdHRlblNwZWNpZmllcil9KSR7bWVtYmVyQ2hhaW4ucmVwbGFjZSgvXFxzKy9nLCBcIlwiKX0ke2FycmF5U3VmZml4LnJlcGxhY2UoL1xccysvZywgXCJcIil9YClcbiAgICAgIH0pXG5cbiAgICBsZXQgd2l0aFJld3JpdHRlbkFsaWFzZXMgPSB3aXRoUmV3cml0dGVuSW5saW5lSW1wb3J0c1xuXG4gICAgZm9yIChjb25zdCBbYWxpYXNOYW1lLCBpbXBvcnRBbGlhc10gb2YgaW1wb3J0QWxpYXNlcykge1xuICAgICAgY29uc3QgcmV3cml0dGVuU3BlY2lmaWVyID0gdGhpcy5mcm9udGVuZFJlc29sdmFibGVKc0RvY0ltcG9ydFNwZWNpZmllcih7XG4gICAgICAgIGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgICAgc291cmNlRmlsZSxcbiAgICAgICAgc3BlY2lmaWVyOiBpbXBvcnRBbGlhcy5zcGVjaWZpZXJcbiAgICAgIH0pXG5cbiAgICAgIGlmICghcmV3cml0dGVuU3BlY2lmaWVyKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBhbGlhc1JlZ2V4ID0gbmV3IFJlZ0V4cChgXFxcXGIke3RoaXMuZXNjYXBlUmVnRXhwKGFsaWFzTmFtZSl9XFxcXGJgLCBcImdcIilcblxuICAgICAgd2l0aFJld3JpdHRlbkFsaWFzZXMgPSB3aXRoUmV3cml0dGVuQWxpYXNlcy5yZXBsYWNlKGFsaWFzUmVnZXgsIHByZXNlcnZlSW1wb3J0RXhwcmVzc2lvbihgaW1wb3J0KCR7SlNPTi5zdHJpbmdpZnkocmV3cml0dGVuU3BlY2lmaWVyKX0pLiR7aW1wb3J0QWxpYXMuaW1wb3J0ZWROYW1lfWApKVxuICAgIH1cblxuICAgIGNvbnN0IHNhbml0aXplZCA9IHdpdGhSZXdyaXR0ZW5BbGlhc2VzXG4gICAgICAvLyBSZW1haW5pbmcgY2FwaXRhbGl6ZWQgaWRlbnRpZmllcnMgYXJlIG1vZGVsIGNsYXNzZXMgb3Igb3RoZXJ3aXNlIG5vbi1yZXNvbHZhYmxlXG4gICAgICAvLyB0eXBlczsgZG93bmdyYWRlIGVhY2ggaW4gcGxhY2Ugc28gc2libGluZyBzY2FsYXIgZmllbGRzIGtlZXAgdGhlaXIgcmVhbCB0eXBlcy5cbiAgICAgIC5yZXBsYWNlKC9cXGJbQS1aXVtBLVphLXowLTlfJF0qL2csIChpZGVudGlmaWVyKSA9PiBzYWZlVHlwZUlkZW50aWZpZXJzLmhhcyhpZGVudGlmaWVyKSA/IGlkZW50aWZpZXIgOiBcImFueVwiKVxuXG4gICAgcmV0dXJuIHByZXNlcnZlZEltcG9ydHMucmVkdWNlKFxuICAgICAgKHR5cGUsIGltcG9ydEV4cHJlc3Npb24sIGluZGV4KSA9PiB0eXBlLnJlcGxhY2VBbGwoYF9fdmVsb2Npb3VzX2ltcG9ydF9wbGFjZWhvbGRlcl8ke2luZGV4fV9fYCwgaW1wb3J0RXhwcmVzc2lvbiksXG4gICAgICBzYW5pdGl6ZWRcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmFpc2VzIHdoZW4gYSBjb21tYW5kIEpTRG9jIHR5cGUgcmVmZXJlbmNlcyBhIGJhY2tlbmQtbG9jYWwgaGVscGVyIGV4cHJlc3Npb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqc0RvY1R5cGUgLSBDb21tYW5kIEpTRG9jIHR5cGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3NlcnROb0JhY2tlbmRMb2NhbENvbW1hbmRUeXBlRXhwcmVzc2lvbnMoanNEb2NUeXBlKSB7XG4gICAgY29uc3QgbG9jYWxSZXR1cm5UeXBlTWF0Y2ggPSBqc0RvY1R5cGUubWF0Y2goL1xcYig/OkF3YWl0ZWRcXHMqPFxccyopP1JldHVyblR5cGVcXHMqPFxccyp0eXBlb2ZcXHMrW0EtWmEtel8kXVtcXHckXSpcXHMqPlxccyo+Py8pXG5cbiAgICBpZiAoIWxvY2FsUmV0dXJuVHlwZU1hdGNoKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBFcnJvcihgQ3VzdG9tIGNvbW1hbmQgSlNEb2MgdHlwZSBjYW5ub3QgdXNlIGJhY2tlbmQtbG9jYWwgUmV0dXJuVHlwZSBleHByZXNzaW9ucyBpbiBnZW5lcmF0ZWQgZnJvbnRlbmQgbW9kZWxzOiAke2xvY2FsUmV0dXJuVHlwZU1hdGNoWzBdfS4gTW92ZSB0aGUgcGF5bG9hZCBzaGFwZSB0byBhIHNoYXJlZCB0eXBlZGVmIGFuZCByZXR1cm4gdGhhdCB0eXBlIGZyb20gdGhlIGNvbW1hbmQgbWV0aG9kLmApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCByZXNvbHZhYmxlIGpzIGRvYyBpbXBvcnQgc3BlY2lmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmZyb250ZW5kTW9kZWxGaWxlUGF0aCAtIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5zb3VyY2VGaWxlIC0gU291cmNlIGZpbGUgdGhhdCBkZWNsYXJlZCB0aGUgSlNEb2MgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3BlY2lmaWVyIC0gU291cmNlLWZpbGUgaW1wb3J0IHNwZWNpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmV3cml0dGVuIGZyb250ZW5kLW1vZGVsIGltcG9ydCBzcGVjaWZpZXIsIG9yIG51bGwgd2hlbiBiYWNrZW5kLWxvY2FsLlxuICAgKi9cbiAgZnJvbnRlbmRSZXNvbHZhYmxlSnNEb2NJbXBvcnRTcGVjaWZpZXIoe2Zyb250ZW5kTW9kZWxGaWxlUGF0aCwgc291cmNlRmlsZSwgc3BlY2lmaWVyfSkge1xuICAgIGlmICghc291cmNlRmlsZSB8fCAhZnJvbnRlbmRNb2RlbEZpbGVQYXRoKSByZXR1cm4gbnVsbFxuICAgIGlmICghc3BlY2lmaWVyLnN0YXJ0c1dpdGgoXCIuXCIpICYmICFzcGVjaWZpZXIuc3RhcnRzV2l0aChcIi9cIikpIHJldHVybiBzcGVjaWZpZXJcblxuICAgIGNvbnN0IGltcG9ydGVkUGF0aCA9IHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUoc291cmNlRmlsZSksIHNwZWNpZmllcilcbiAgICBjb25zdCBtb2RlbEltcG9ydFNwZWNpZmllciA9IHRoaXMuZnJvbnRlbmRNb2RlbEltcG9ydFNwZWNpZmllckZvckJhY2tlbmRNb2RlbFBhdGgoe1xuICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgaW1wb3J0ZWRQYXRoXG4gICAgfSlcblxuICAgIGlmIChtb2RlbEltcG9ydFNwZWNpZmllcikgcmV0dXJuIG1vZGVsSW1wb3J0U3BlY2lmaWVyXG5cbiAgICBpZiAodGhpcy5maWxlUGF0aElzV2l0aGluQW55RGlyZWN0b3J5KHtkaXJlY3RvcmllczogdGhpcy5mcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VEaXJlY3RvcmllcygpLCBmaWxlUGF0aDogaW1wb3J0ZWRQYXRofSkpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVsYXRpdmVJbXBvcnRTcGVjaWZpZXIoe2Zyb21GaWxlOiBmcm9udGVuZE1vZGVsRmlsZVBhdGgsIHRvRmlsZTogaW1wb3J0ZWRQYXRofSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGltcG9ydCBzcGVjaWZpZXIgZm9yIGJhY2tlbmQgbW9kZWwgcGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZyb250ZW5kTW9kZWxGaWxlUGF0aCAtIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmltcG9ydGVkUGF0aCAtIFNvdXJjZS1maWxlIGltcG9ydCBwYXRoIHJlc29sdmVkIGZyb20gSlNEb2MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEdlbmVyYXRlZCBmcm9udGVuZC1tb2RlbCBpbXBvcnQgc3BlY2lmaWVyLCBvciBudWxsIHdoZW4gdGhlIHBhdGggaXMgbm90IGEgcmVnaXN0ZXJlZCBtb2RlbCBmaWxlLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEltcG9ydFNwZWNpZmllckZvckJhY2tlbmRNb2RlbFBhdGgoe2Zyb250ZW5kTW9kZWxGaWxlUGF0aCwgaW1wb3J0ZWRQYXRofSkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxzRGlyZWN0b3J5ID0gcGF0aC5kaXJuYW1lKGZyb250ZW5kTW9kZWxGaWxlUGF0aClcbiAgICBjb25zdCBpbXBvcnRlZE1vZGVsUGF0aCA9IGltcG9ydGVkUGF0aC5lbmRzV2l0aChcIi5qc1wiKSA/IGltcG9ydGVkUGF0aCA6IGAke2ltcG9ydGVkUGF0aH0uanNgXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsRmlsZU5hbWUgb2YgdGhpcy5nZW5lcmF0ZWRGcm9udGVuZE1vZGVsRmlsZU5hbWVzKCkpIHtcbiAgICAgIGZvciAoY29uc3Qgc291cmNlRGlyZWN0b3J5IG9mIHRoaXMuZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRGlyZWN0b3JpZXMoKSkge1xuICAgICAgICBjb25zdCBtb2RlbHNEaXJlY3RvcnkgPSBwYXRoLmpvaW4oc291cmNlRGlyZWN0b3J5LCBcIm1vZGVsc1wiKVxuICAgICAgICBjb25zdCBjYW5kaWRhdGVNb2RlbFBhdGggPSBwYXRoLmpvaW4obW9kZWxzRGlyZWN0b3J5LCBtb2RlbEZpbGVOYW1lKVxuXG4gICAgICAgIGlmIChwYXRoLnJlc29sdmUoY2FuZGlkYXRlTW9kZWxQYXRoKSAhPT0gcGF0aC5yZXNvbHZlKGltcG9ydGVkTW9kZWxQYXRoKSkgY29udGludWVcblxuICAgICAgICByZXR1cm4gdGhpcy5yZWxhdGl2ZUltcG9ydFNwZWNpZmllcih7XG4gICAgICAgICAgZnJvbUZpbGU6IGZyb250ZW5kTW9kZWxGaWxlUGF0aCxcbiAgICAgICAgICB0b0ZpbGU6IHBhdGguam9pbihmcm9udGVuZE1vZGVsc0RpcmVjdG9yeSwgbW9kZWxGaWxlTmFtZSlcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2VuZXJhdGVkIGZyb250ZW5kIG1vZGVsIGZpbGUgbmFtZXMuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBGcm9udGVuZCBtb2RlbCBmaWxlbmFtZXMgdGhhdCB0aGlzIGdlbmVyYXRpb24gcnVuIGNhbiBlbWl0LlxuICAgKi9cbiAgZ2VuZXJhdGVkRnJvbnRlbmRNb2RlbEZpbGVOYW1lcygpIHtcbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGZpbGVOYW1lcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gdGhpcy5yZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgICAgZm9yIChjb25zdCByZXNvdXJjZU1vZGVsTmFtZSBvZiBPYmplY3Qua2V5cyhyZXNvdXJjZXMpKSB7XG4gICAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVzb3VyY2VNb2RlbE5hbWUucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpKVxuXG4gICAgICAgIGZpbGVOYW1lcy5hZGQoYCR7aW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKGNsYXNzTmFtZSkpfS5qc2ApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVOYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpdmUgaW1wb3J0IHNwZWNpZmllci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZyb21GaWxlIC0gU291cmNlIGZpbGUgdGhhdCB3aWxsIGNvbnRhaW4gdGhlIGltcG9ydCBleHByZXNzaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50b0ZpbGUgLSBGaWxlIGJlaW5nIGltcG9ydGVkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlbGF0aXZlIGltcG9ydCBzcGVjaWZpZXIuXG4gICAqL1xuICByZWxhdGl2ZUltcG9ydFNwZWNpZmllcih7ZnJvbUZpbGUsIHRvRmlsZX0pIHtcbiAgICBsZXQgcmVsYXRpdmVTcGVjaWZpZXIgPSBwYXRoLnJlbGF0aXZlKHBhdGguZGlybmFtZShmcm9tRmlsZSksIHRvRmlsZSkuc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpXG5cbiAgICBpZiAoIXJlbGF0aXZlU3BlY2lmaWVyLnN0YXJ0c1dpdGgoXCIuXCIpKSB7XG4gICAgICByZWxhdGl2ZVNwZWNpZmllciA9IGAuLyR7cmVsYXRpdmVTcGVjaWZpZXJ9YFxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGl2ZVNwZWNpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlsZSBwYXRoIGlzIHdpdGhpbiBhbnkgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kaXJlY3RvcmllcyAtIENhbmRpZGF0ZSBwYXJlbnQgZGlyZWN0b3JpZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVQYXRoIC0gRmlsZSBwYXRoIHRvIHRlc3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGZpbGUgcGF0aCBpcyB1bmRlciBvbmUgY2FuZGlkYXRlIGRpcmVjdG9yeS5cbiAgICovXG4gIGZpbGVQYXRoSXNXaXRoaW5BbnlEaXJlY3Rvcnkoe2RpcmVjdG9yaWVzLCBmaWxlUGF0aH0pIHtcbiAgICByZXR1cm4gZGlyZWN0b3JpZXMuc29tZSgoZGlyZWN0b3J5KSA9PiB7XG4gICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHBhdGgucmVzb2x2ZShkaXJlY3RvcnkpLCBwYXRoLnJlc29sdmUoZmlsZVBhdGgpKVxuXG4gICAgICByZXR1cm4gcmVsYXRpdmVQYXRoID09PSBcIlwiIHx8ICghcmVsYXRpdmVQYXRoLnN0YXJ0c1dpdGgoXCIuLlwiKSAmJiAhcGF0aC5pc0Fic29sdXRlKHJlbGF0aXZlUGF0aCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFc2NhcGVzIHRleHQgZm9yIHVzZSBpbnNpZGUgYSBSZWdFeHAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIGVzY2FwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSZWdFeHAtc2FmZSB2YWx1ZS5cbiAgICovXG4gIGVzY2FwZVJlZ0V4cCh2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIEpTRG9jIHBhcmFtIGJsb2NrLCBwYXJhbWV0ZXIgbGlzdCwgcGF5bG9hZC1hcmd1bWVudCBleHByZXNzaW9uLCBhbmRcbiAgICogcmV0dXJuIHR5cGUgZm9yIGEgY3VzdG9tIGNvbW1hbmQgbWV0aG9kLiBXaXRoIGRlY2xhcmVkIGBhcmdzYCBlYWNoIGJlY29tZXMgYVxuICAgKiBuYW1lZCwgdHlwZWQgcGFyYW1ldGVyIG1hcHBlZCBwb3NpdGlvbmFsbHkgaW50byB0aGUgY29tbWFuZCBwYXlsb2FkOyB3aXRob3V0XG4gICAqIHRoZW0gdGhlIG1ldGhvZCBzdGF5cyB2YXJpYWRpYy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT59IGFyZ3MuY29tbWFuZE1ldGFkYXRhIC0gUGVyLWNvbW1hbmQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZE5hbWUgLSBDb21tYW5kIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e3BhcmFtRG9jczogc3RyaW5nLCBwYXJhbWV0ZXJzOiBzdHJpbmcsIHBheWxvYWRBcmd1bWVudHM6IHN0cmluZywgcmV0dXJuVHlwZTogc3RyaW5nfX0gLSBHZW5lcmF0aW9uIHBpZWNlcy5cbiAgICovXG4gIGN1c3RvbUNvbW1hbmRNZXRob2RTaWduYXR1cmUoe2NvbW1hbmRNZXRhZGF0YSwgbWV0aG9kTmFtZX0pIHtcbiAgICBjb25zdCBtZXRhZGF0YSA9IGNvbW1hbmRNZXRhZGF0YVttZXRob2ROYW1lXSB8fCB7YXJnczogW10sIHJldHVyblR5cGU6IG51bGx9XG4gICAgY29uc3QgcmV0dXJuVHlwZSA9IG1ldGFkYXRhLnJldHVyblR5cGUgfHwgXCJSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+XCJcblxuICAgIGlmIChtZXRhZGF0YS5hcmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHBhcmFtZXRlck5hbWVzID0gbWV0YWRhdGEuYXJncy5tYXAoKGFyZykgPT4gYXJnLm5hbWUpXG4gICAgICAvLyBBIHNpbmdsZSBhcmdzIG9iamVjdCB3aG9zZSBldmVyeSBmaWVsZCBpcyBvcHRpb25hbCBhY2NlcHRzIGB7fWAsIHNvIGRlZmF1bHRcbiAgICAgIC8vIHRoZSBwYXJhbWV0ZXIgYW5kIG1hcmsgaXQgb3B0aW9uYWwg4oCUIGNhbGxlcnMgY2FuIHRoZW4gb21pdCBpdCBlbnRpcmVseVxuICAgICAgLy8gKGByZWNvcmQuY29tbWFuZCgpYCBpbnN0ZWFkIG9mIGByZWNvcmQuY29tbWFuZCh7fSlgKS4gUmVxdWlyZWQtZmllbGQgYXJncyBrZWVwXG4gICAgICAvLyB0aGUgbWFuZGF0b3J5IHBhcmFtZXRlciAoYSBge31gIGRlZmF1bHQgd291bGRuJ3Qgc2F0aXNmeSB0aGVpciB0eXBlKS5cbiAgICAgIGNvbnN0IGRlZmF1bHRzVG9FbXB0eU9iamVjdCA9IG1ldGFkYXRhLmFyZ3MubGVuZ3RoID09PSAxICYmIHRoaXMuYXJnVHlwZUFjY2VwdHNFbXB0eU9iamVjdChtZXRhZGF0YS5hcmdzWzBdLnR5cGUpXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHBhcmFtRG9jczogbWV0YWRhdGEuYXJncy5tYXAoKGFyZykgPT4gYCAgICogQHBhcmFtIHske2FyZy50eXBlfX0gJHtkZWZhdWx0c1RvRW1wdHlPYmplY3QgPyBgWyR7YXJnLm5hbWV9XWAgOiBhcmcubmFtZX0gLSBDb21tYW5kIGFyZ3VtZW50LlxcbmApLmpvaW4oXCJcIiksXG4gICAgICAgIHBhcmFtZXRlcnM6IGRlZmF1bHRzVG9FbXB0eU9iamVjdCA/IGAke3BhcmFtZXRlck5hbWVzWzBdfSA9IHt9YCA6IHBhcmFtZXRlck5hbWVzLmpvaW4oXCIsIFwiKSxcbiAgICAgICAgcGF5bG9hZEFyZ3VtZW50czogYFske3BhcmFtZXRlck5hbWVzLmpvaW4oXCIsIFwiKX1dYCxcbiAgICAgICAgcmV0dXJuVHlwZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBwYXJhbURvY3M6IFwiICAgKiBAcGFyYW0gey4uLkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZX0gY29tbWFuZEFyZ3VtZW50cyAtIEN1c3RvbSBjb21tYW5kIGFyZ3VtZW50cy5cXG5cIixcbiAgICAgIHBhcmFtZXRlcnM6IFwiLi4uY29tbWFuZEFyZ3VtZW50c1wiLFxuICAgICAgcGF5bG9hZEFyZ3VtZW50czogXCJjb21tYW5kQXJndW1lbnRzXCIsXG4gICAgICByZXR1cm5UeXBlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBzaW5nbGUgY29tbWFuZC1hcmdzIEpTRG9jIHR5cGUgaXMga25vd24gdG8gYWNjZXB0IGFuIGVtcHR5IG9iamVjdCBge31gOlxuICAgKiBhIHNpbmdsZSBiYWxhbmNlZCBvYmplY3QgbGl0ZXJhbCB3aG9zZSB0b3AtbGV2ZWwgbWVtYmVycyBhcmUgYWxsIG9wdGlvbmFsIChgbmFtZT86YClcbiAgICogb3IgaW5kZXggc2lnbmF0dXJlcyAoYFtrOiAuLi5dOmApLiBBbnl0aGluZyBlbHNlIHJldHVybnMgZmFsc2Ugc28gdGhlIHBhcmFtZXRlciBzdGF5c1xuICAgKiByZXF1aXJlZCDigJQgaW5jbHVkaW5nIGEgcmVxdWlyZWQgbWVtYmVyLCBhIG5vbi1vYmplY3QtbGl0ZXJhbCAoYSBwb3NpdGlvbmFsIGBudW1iZXJgLFxuICAgKiBhIGBSZWNvcmQ8Li4uPmAgLyBgUGFydGlhbDwuLi4+YCB3aG9zZSBrZXkvd3JhcHBlciBtYXkgc3RpbGwgcmVxdWlyZSBkYXRhKSwgYW5kIGFueVxuICAgKiBpbnRlcnNlY3Rpb24vdW5pb24gKGUuZy4gYHthPzogeH0gJiB7Yjogc3RyaW5nfWApLCB3aGVyZSBge31gIGlzIG5vdCBhc3NpZ25hYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIFRoZSBhcmcncyBKU0RvYyB0eXBlIHN0cmluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZ2VuZXJhdGVkIHBhcmFtZXRlciBjYW4gZGVmYXVsdCB0byBge31gLlxuICAgKi9cbiAgYXJnVHlwZUFjY2VwdHNFbXB0eU9iamVjdCh0eXBlKSB7XG4gICAgY29uc3QgdHJpbW1lZFR5cGUgPSB0eXBlLnRyaW0oKVxuXG4gICAgLy8gTXVzdCBiZSBhIHNpbmdsZSBiYWxhbmNlZCBvYmplY3QgbGl0ZXJhbDogc3RhcnRzIHdpdGggYHtgLCBlbmRzIHdpdGggYH1gLCBhbmQgdGhlXG4gICAgLy8gb3BlbmluZyBicmFjZSBjbG9zZXMgb25seSBhdCB0aGUgZmluYWwgY2hhcmFjdGVyLiBUaGlzIHJlamVjdHMgaW50ZXJzZWN0aW9ucy91bmlvbnNcbiAgICAvLyBsaWtlIGB7YT86IHh9ICYge2I6IHN0cmluZ31gIHRoYXQgbWVyZWx5IGhhcHBlbiB0byBzdGFydCBge2AgYW5kIGVuZCBgfWAuXG4gICAgaWYgKCEodHJpbW1lZFR5cGUuc3RhcnRzV2l0aChcIntcIikgJiYgdHJpbW1lZFR5cGUuZW5kc1dpdGgoXCJ9XCIpKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKCF0aGlzLmlzU2luZ2xlQmFsYW5jZWRPYmplY3RMaXRlcmFsKHRyaW1tZWRUeXBlKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBpbm5lciA9IHRyaW1tZWRUeXBlLnNsaWNlKDEsIC0xKVxuXG4gICAgZm9yIChjb25zdCBtZW1iZXIgb2YgdGhpcy5zcGxpdFRvcExldmVsVHlwZU1lbWJlcnMoaW5uZXIpKSB7XG4gICAgICBjb25zdCBjb2xvbkluZGV4ID0gdGhpcy50b3BMZXZlbENvbG9uSW5kZXgobWVtYmVyKVxuXG4gICAgICAvLyBObyB0b3AtbGV2ZWwgY29sb246IGEgY2FsbC9jb25zdHJ1Y3QvbWFwcGVkIHNpZ25hdHVyZSBvciBtYWxmb3JtZWQgbWVtYmVyIOKAlFxuICAgICAgLy8gY2FuJ3QgY29uZmlybSBpdCdzIG9wdGlvbmFsLCBzbyB0cmVhdCB0aGUgdHlwZSBhcyBub3QgZW1wdHktZGVmYXVsdGFibGUuXG4gICAgICBpZiAoY29sb25JbmRleCA8IDApIHJldHVybiBmYWxzZVxuXG4gICAgICBjb25zdCBrZXkgPSBtZW1iZXIuc2xpY2UoMCwgY29sb25JbmRleCkudHJpbSgpXG5cbiAgICAgIC8vIEluZGV4IHNpZ25hdHVyZXMgKGBbazogc3RyaW5nXWApIGRvbid0IHJlcXVpcmUgYSB2YWx1ZTsgb3B0aW9uYWwgcHJvcHMgZW5kIGluIGA/YC5cbiAgICAgIC8vIEFueXRoaW5nIGVsc2UgaXMgYSByZXF1aXJlZCBwcm9wZXJ0eSwgc28gYHt9YCB3b3VsZCBub3Qgc2F0aXNmeSB0aGUgdHlwZS5cbiAgICAgIGlmICgha2V5LnN0YXJ0c1dpdGgoXCJbXCIpICYmICFrZXkuZW5kc1dpdGgoXCI/XCIpKSByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyB0aGUgaW5uZXIgYm9keSBvZiBhbiBvYmplY3QtbGl0ZXJhbCB0eXBlIGludG8gaXRzIHRvcC1sZXZlbCBtZW1iZXJzLFxuICAgKiByZXNwZWN0aW5nIG5lc3RlZCBge31gIC8gYFtdYCAvIGA8PmAgLyBgKClgIHNvIGZpZWxkIHR5cGVzIGxpa2UgYHN0cmluZ1tdIHwgbnVsbGBcbiAgICogb3IgYHthOiBifWAgYXJlbid0IHNwbGl0IG1pZC10eXBlLiBNZW1iZXJzIGFyZSBzZXBhcmF0ZWQgYnkgYCxgIG9yIGA7YC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlubmVyIC0gT2JqZWN0LWxpdGVyYWwgYm9keSAod2l0aG91dCB0aGUgb3V0ZXIgYnJhY2VzKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRyaW1tZWQgbm9uLWVtcHR5IHRvcC1sZXZlbCBtZW1iZXJzLlxuICAgKi9cbiAgc3BsaXRUb3BMZXZlbFR5cGVNZW1iZXJzKGlubmVyKSB7XG4gICAgY29uc3QgbWVtYmVycyA9IFtdXG4gICAgbGV0IGRlcHRoID0gMFxuICAgIGxldCBzdGFydCA9IDBcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBpbm5lci5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IGNoYXJhY3RlciA9IGlubmVyW2luZGV4XVxuXG4gICAgICBpZiAoY2hhcmFjdGVyID09PSBcIntcIiB8fCBjaGFyYWN0ZXIgPT09IFwiW1wiIHx8IGNoYXJhY3RlciA9PT0gXCI8XCIgfHwgY2hhcmFjdGVyID09PSBcIihcIikge1xuICAgICAgICBkZXB0aCArPSAxXG4gICAgICB9IGVsc2UgaWYgKGNoYXJhY3RlciA9PT0gXCJ9XCIgfHwgY2hhcmFjdGVyID09PSBcIl1cIiB8fCBjaGFyYWN0ZXIgPT09IFwiPlwiIHx8IGNoYXJhY3RlciA9PT0gXCIpXCIpIHtcbiAgICAgICAgZGVwdGggLT0gMVxuICAgICAgfSBlbHNlIGlmICgoY2hhcmFjdGVyID09PSBcIixcIiB8fCBjaGFyYWN0ZXIgPT09IFwiO1wiKSAmJiBkZXB0aCA9PT0gMCkge1xuICAgICAgICBtZW1iZXJzLnB1c2goaW5uZXIuc2xpY2Uoc3RhcnQsIGluZGV4KSlcbiAgICAgICAgc3RhcnQgPSBpbmRleCArIDFcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZW1iZXJzLnB1c2goaW5uZXIuc2xpY2Uoc3RhcnQpKVxuXG4gICAgcmV0dXJuIG1lbWJlcnMubWFwKChtZW1iZXIpID0+IG1lbWJlci50cmltKCkpLmZpbHRlcigobWVtYmVyKSA9PiBtZW1iZXIubGVuZ3RoID4gMClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbmRleCBvZiB0aGUgZmlyc3QgdG9wLWxldmVsIGA6YCBpbiBhbiBvYmplY3QtbGl0ZXJhbCBtZW1iZXIsIGlnbm9yaW5nIGNvbG9uc1xuICAgKiBuZXN0ZWQgaW5zaWRlIGB7fWAgLyBgW11gIC8gYDw+YCAvIGAoKWAgKGUuZy4gYW4gaW5kZXggc2lnbmF0dXJlIGBbazogc3RyaW5nXWApLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVtYmVyIC0gQSBzaW5nbGUgb2JqZWN0LWxpdGVyYWwgbWVtYmVyLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBjb2xvbiBpbmRleCwgb3IgLTEgd2hlbiBub25lIGlzIGZvdW5kIGF0IHRoZSB0b3AgbGV2ZWwuXG4gICAqL1xuICB0b3BMZXZlbENvbG9uSW5kZXgobWVtYmVyKSB7XG4gICAgbGV0IGRlcHRoID0gMFxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1lbWJlci5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IGNoYXJhY3RlciA9IG1lbWJlcltpbmRleF1cblxuICAgICAgaWYgKGNoYXJhY3RlciA9PT0gXCJ7XCIgfHwgY2hhcmFjdGVyID09PSBcIltcIiB8fCBjaGFyYWN0ZXIgPT09IFwiPFwiIHx8IGNoYXJhY3RlciA9PT0gXCIoXCIpIHtcbiAgICAgICAgZGVwdGggKz0gMVxuICAgICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT09IFwifVwiIHx8IGNoYXJhY3RlciA9PT0gXCJdXCIgfHwgY2hhcmFjdGVyID09PSBcIj5cIiB8fCBjaGFyYWN0ZXIgPT09IFwiKVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDFcbiAgICAgIH0gZWxzZSBpZiAoY2hhcmFjdGVyID09PSBcIjpcIiAmJiBkZXB0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gaW5kZXhcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gLTFcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB0eXBlIGlzIGEgc2luZ2xlIGJhbGFuY2VkIG9iamVjdCBsaXRlcmFsIOKAlCBpdHMgbGVhZGluZyBge2AgY2xvc2VzIG9ubHlcbiAgICogYXQgdGhlIGZpbmFsIGNoYXJhY3Rlci4gUmVqZWN0cyB0b3AtbGV2ZWwgaW50ZXJzZWN0aW9ucy91bmlvbnMgbGlrZSBge2E/OiB4fSAmIHtiOiB5fWBcbiAgICogb3IgYHthPzogeH0gfCBzdHJpbmdgIHdob3NlIGJyYWNlIGRlcHRoIHJldHVybnMgdG8gMCBiZWZvcmUgdGhlIGVuZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBBIHRyaW1tZWQgdHlwZSBzdHJpbmcgdGhhdCBzdGFydHMgd2l0aCBge2AgYW5kIGVuZHMgd2l0aCBgfWAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGJyYWNlcyB3cmFwIHRoZSB3aG9sZSB0eXBlLlxuICAgKi9cbiAgaXNTaW5nbGVCYWxhbmNlZE9iamVjdExpdGVyYWwodHlwZSkge1xuICAgIGxldCBkZXB0aCA9IDBcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCB0eXBlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgY2hhcmFjdGVyID0gdHlwZVtpbmRleF1cblxuICAgICAgaWYgKGNoYXJhY3RlciA9PT0gXCJ7XCIgfHwgY2hhcmFjdGVyID09PSBcIltcIiB8fCBjaGFyYWN0ZXIgPT09IFwiPFwiIHx8IGNoYXJhY3RlciA9PT0gXCIoXCIpIHtcbiAgICAgICAgZGVwdGggKz0gMVxuICAgICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT09IFwifVwiIHx8IGNoYXJhY3RlciA9PT0gXCJdXCIgfHwgY2hhcmFjdGVyID09PSBcIj5cIiB8fCBjaGFyYWN0ZXIgPT09IFwiKVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDFcblxuICAgICAgICAvLyBUaGUgb3BlbmluZyBicmFjZSBiYWxhbmNlZCBiZWZvcmUgdGhlIGVuZCwgc28gc29tZXRoaW5nIGZvbGxvd3MgdGhlIGxpdGVyYWwuXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCAmJiBpbmRleCA8IHR5cGUubGVuZ3RoIC0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRlcHRoID09PSAwXG4gIH1cblxuICAvKipcbiAgICogRW5yaWNoZXMgY3VzdG9tLWNvbW1hbmQgbWV0YWRhdGEgYnkgZGVyaXZpbmcgYSBjb21tYW5kJ3MgdHlwZWQgYXJncyBhbmQgcmV0dXJuXG4gICAqIHR5cGUgZnJvbSB0aGUgYmFja2VuZCByZXNvdXJjZSBtZXRob2QncyBgQHBhcmFtYC9gQHJldHVybnNgIEpTRG9jIHdoZW4gdGhleSBhcmVcbiAgICogbm90IGFscmVhZHkgZGVjbGFyZWQgaW4gYHJlc291cmNlQ29uZmlnYC4gUHJlY2VkZW5jZTogZXhwbGljaXQgYHJlc291cmNlQ29uZmlnYFxuICAgKiBge2FyZ3MsIHJldHVyblR5cGV9YCB3aW5zLCB0aGVuIHRoZSBkZXJpdmVkIGJhY2tlbmQtbWV0aG9kIEpTRG9jLCB0aGVuIHRoZSBnZW5lcmljXG4gICAqIGRlZmF1bHQuIE1vZGVsLWNsYXNzIGlkZW50aWZpZXJzIGluIHRoZSBkZXJpdmVkIHR5cGVzIGFyZSBkb3duZ3JhZGVkIHRvIGBhbnlgXG4gICAqIGJlY2F1c2UgdGhlIGZyb250ZW5kIHJlY2VpdmVzIGEgc2VyaWFsaXplZCByZWNvcmQsIG5vdCBhIG1vZGVsIGluc3RhbmNlLCB3aGljaCB0aGVcbiAgICogY29uc3VtZXIgaHlkcmF0ZXMgd2l0aCBgTW9kZWwuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UoLi4uKWAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fSBhcmdzLmNvbW1hbmRNZXRhZGF0YSAtIERlY2xhcmVkIHBlci1jb21tYW5kIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmNvbW1hbmROYW1lcyAtIENvbW1hbmQgbWV0aG9kIG5hbWVzIHRvIHJlc29sdmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZyb250ZW5kTW9kZWxGaWxlUGF0aCAtIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT4+fSAtIEVucmljaGVkIG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgY29tbWFuZE1ldGFkYXRhV2l0aFJlc291cmNlSnNEb2Moe2NvbW1hbmRNZXRhZGF0YSwgY29tbWFuZE5hbWVzLCBmcm9udGVuZE1vZGVsRmlsZVBhdGgsIHJlc291cmNlQ2xhc3N9KSB7XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzKSByZXR1cm4gY29tbWFuZE1ldGFkYXRhXG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fSAqL1xuICAgIGNvbnN0IGVucmljaGVkID0gey4uLmNvbW1hbmRNZXRhZGF0YX1cblxuICAgIGZvciAoY29uc3QgY29tbWFuZE5hbWUgb2YgY29tbWFuZE5hbWVzKSB7XG4gICAgICBjb25zdCBkZWNsYXJlZCA9IGNvbW1hbmRNZXRhZGF0YVtjb21tYW5kTmFtZV0gfHwge2FyZ3M6IFtdLCByZXR1cm5UeXBlOiBudWxsfVxuICAgICAgY29uc3Qgc291cmNlQ2xhc3NOYW1lID0gdGhpcy5tZXRob2RPd25lckNsYXNzTmFtZSh7bWV0aG9kTmFtZTogY29tbWFuZE5hbWUsIHRhcmdldENsYXNzOiByZXNvdXJjZUNsYXNzfSlcblxuICAgICAgaWYgKCFzb3VyY2VDbGFzc05hbWUpIHtcbiAgICAgICAgZW5yaWNoZWRbY29tbWFuZE5hbWVdID0gZGVjbGFyZWRcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBsZXQgcmV0dXJuVHlwZSA9IGRlY2xhcmVkLnJldHVyblR5cGVcblxuICAgICAgaWYgKCFyZXR1cm5UeXBlKSB7XG4gICAgICAgIGNvbnN0IGpzRG9jUmV0dXJuVHlwZSA9IGF3YWl0IHRoaXMucmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlRGVmaW5pdGlvbih7bWV0aG9kTmFtZTogY29tbWFuZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pXG5cbiAgICAgICAgaWYgKGpzRG9jUmV0dXJuVHlwZSkge1xuICAgICAgICAgIHJldHVyblR5cGUgPSB0aGlzLmZyb250ZW5kUmVzb2x2YWJsZUNvbW1hbmRKc0RvY1R5cGUoe1xuICAgICAgICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgICAgICAgaW1wb3J0QWxpYXNlczoganNEb2NSZXR1cm5UeXBlLmltcG9ydEFsaWFzZXMsXG4gICAgICAgICAgICBqc0RvY1R5cGU6IHRoaXMudW53cmFwcGVkUHJvbWlzZUpzRG9jVHlwZSh7anNEb2NUeXBlOiBqc0RvY1JldHVyblR5cGUudHlwZX0pLFxuICAgICAgICAgICAgc291cmNlRmlsZToganNEb2NSZXR1cm5UeXBlLnNvdXJjZUZpbGVcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGxldCBhcmdzID0gZGVjbGFyZWQuYXJnc1xuXG4gICAgICBpZiAoIWFyZ3MgfHwgYXJncy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgY29uc3QganNEb2NQYXJhbWV0ZXJzID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFBhcmFtZXRlcnMoe21ldGhvZE5hbWU6IGNvbW1hbmROYW1lLCBzb3VyY2VDbGFzc05hbWV9KVxuICAgICAgICAvLyBTa2lwIG9iamVjdC1wcm9wZXJ0eSB0YWdzIChgQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWVzc2FnZWApOyBvbmx5IHRoZVxuICAgICAgICAvLyB0b3AtbGV2ZWwgcGFyYW1ldGVycyBtYXAgdG8gbWV0aG9kIGFyZ3VtZW50cywgb3RoZXJ3aXNlIHRoZSBzaGFyZWRcbiAgICAgICAgLy8gYEBwYXJhbSB7b2JqZWN0fSBhcmdzYCArIHByb3BlcnR5IHN0eWxlIHdvdWxkIGVtaXQgYG5hbWUoYXJncywgYXJncylgLlxuICAgICAgICBjb25zdCB0b3BMZXZlbFBhcmFtZXRlcnMgPSAoanNEb2NQYXJhbWV0ZXJzIHx8IFtdKS5maWx0ZXIoKHBhcmFtZXRlcikgPT4gdHlwZW9mIHBhcmFtZXRlci5uYW1lID09PSBcInN0cmluZ1wiICYmICFwYXJhbWV0ZXIubmFtZS5pbmNsdWRlcyhcIi5cIikpXG5cbiAgICAgICAgaWYgKHRvcExldmVsUGFyYW1ldGVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgYXJncyA9IHRvcExldmVsUGFyYW1ldGVycy5tYXAoKHBhcmFtZXRlcikgPT4gKHtcbiAgICAgICAgICAgIG5hbWU6IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAocGFyYW1ldGVyLm5hbWUpLFxuICAgICAgICAgICAgdHlwZTogdGhpcy5mcm9udGVuZFJlc29sdmFibGVDb21tYW5kSnNEb2NUeXBlKHtcbiAgICAgICAgICAgICAgZnJvbnRlbmRNb2RlbEZpbGVQYXRoLFxuICAgICAgICAgICAgICBpbXBvcnRBbGlhc2VzOiBwYXJhbWV0ZXIuaW1wb3J0QWxpYXNlcyxcbiAgICAgICAgICAgICAganNEb2NUeXBlOiBwYXJhbWV0ZXIudHlwZSxcbiAgICAgICAgICAgICAgc291cmNlRmlsZTogcGFyYW1ldGVyLnNvdXJjZUZpbGVcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZW5yaWNoZWRbY29tbWFuZE5hbWVdID0ge2FyZ3M6IGFyZ3MgfHwgW10sIHJldHVyblR5cGU6IHJldHVyblR5cGUgfHwgbnVsbH1cbiAgICB9XG5cbiAgICByZXR1cm4gZW5yaWNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVud3JhcHBlZCBwcm9taXNlIGpzIGRvYyB0eXBlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuanNEb2NUeXBlIC0gSlNEb2MgdHlwZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHJlc29sdmVkIHZhbHVlIHR5cGUgZm9yIHNlcmlhbGl6ZWQgZnJvbnRlbmQgYXR0cmlidXRlcy5cbiAgICovXG4gIHVud3JhcHBlZFByb21pc2VKc0RvY1R5cGUoe2pzRG9jVHlwZX0pIHtcbiAgICBjb25zdCBwcm9taXNlUHJlZml4ID0gXCJQcm9taXNlPFwiXG5cbiAgICBpZiAoIWpzRG9jVHlwZS5zdGFydHNXaXRoKHByb21pc2VQcmVmaXgpKSByZXR1cm4ganNEb2NUeXBlXG5cbiAgICBpZiAoIWpzRG9jVHlwZS5lbmRzV2l0aChcIj5cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgUHJvbWlzZSBKU0RvYyB0eXBlIHRvIGVuZCB3aXRoICc+JzogJHtqc0RvY1R5cGV9YClcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZFR5cGUgPSBqc0RvY1R5cGUuc2xpY2UocHJvbWlzZVByZWZpeC5sZW5ndGgsIC0xKS50cmltKClcblxuICAgIGlmIChyZXNvbHZlZFR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBQcm9taXNlIEpTRG9jIHR5cGUgdG8gY29udGFpbiBhIHJlc29sdmVkIHR5cGU6ICR7anNEb2NUeXBlfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc29sdmVkVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWV0aG9kIG93bmVyIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IGFyZ3MudGFyZ2V0Q2xhc3MgLSBUYXJnZXQgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENsYXNzIG5hbWUgdGhhdCBkZWNsYXJlcyB0aGUgbWV0aG9kLlxuICAgKi9cbiAgbWV0aG9kT3duZXJDbGFzc05hbWUoe21ldGhvZE5hbWUsIHRhcmdldENsYXNzfSkge1xuICAgIGxldCBwcm90b3R5cGUgPSB0YXJnZXRDbGFzcy5wcm90b3R5cGVcblxuICAgIHdoaWxlIChwcm90b3R5cGUgJiYgcHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHByb3RvdHlwZSwgbWV0aG9kTmFtZSkpIHtcbiAgICAgICAgY29uc3QgZGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IocHJvdG90eXBlLCBtZXRob2ROYW1lKVxuXG4gICAgICAgIGlmICh0eXBlb2YgZGVzY3JpcHRvcj8udmFsdWUgIT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdG9yTmFtZSA9IHByb3RvdHlwZS5jb25zdHJ1Y3Rvcj8ubmFtZVxuXG4gICAgICAgIGlmICh0eXBlb2YgY29uc3RydWN0b3JOYW1lID09IFwic3RyaW5nXCIgJiYgY29uc3RydWN0b3JOYW1lLmxlbmd0aCA+IDApIHJldHVybiBjb25zdHJ1Y3Rvck5hbWVcblxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG90eXBlKVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNvdXJjZUNsYXNzTmFtZSAtIFNvdXJjZSBjbGFzcyBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBKU0RvYyByZXR1cm4gdHlwZSB3aGVuIGRvY3VtZW50ZWQuXG4gICAqL1xuICBhc3luYyByZXNvdXJjZU1ldGhvZFJldHVyblR5cGUoe21ldGhvZE5hbWUsIHNvdXJjZUNsYXNzTmFtZX0pIHtcbiAgICBjb25zdCByZXR1cm5UeXBlID0gYXdhaXQgdGhpcy5yZXNvdXJjZU1ldGhvZFJldHVyblR5cGVEZWZpbml0aW9uKHttZXRob2ROYW1lLCBzb3VyY2VDbGFzc05hbWV9KVxuXG4gICAgcmV0dXJuIHJldHVyblR5cGUgPyByZXR1cm5UeXBlLnR5cGUgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGUgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc291cmNlQ2xhc3NOYW1lIC0gU291cmNlIGNsYXNzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZSB8IG51bGw+fSAtIEpTRG9jIHJldHVybiB0eXBlIGRlZmluaXRpb24gd2hlbiBkb2N1bWVudGVkLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlRGVmaW5pdGlvbih7bWV0aG9kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSkge1xuICAgIGNvbnN0IHJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMoKVxuICAgIGNvbnN0IHJldHVyblR5cGVLZXkgPSBgJHtzb3VyY2VDbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gXG5cbiAgICBpZiAoIXJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMuaGFzKHJldHVyblR5cGVLZXkpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmV0dXJuVHlwZSA9IHJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXMuZ2V0KHJldHVyblR5cGVLZXkpXG5cbiAgICBpZiAoIXJldHVyblR5cGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgSlNEb2MgcmV0dXJuIHR5cGUgZm9yICR7cmV0dXJuVHlwZUtleX1gKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcmV0dXJuVHlwZS50eXBlICE9IFwic3RyaW5nXCIgfHwgcmV0dXJuVHlwZS50eXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbm9uLWVtcHR5IEpTRG9jIHJldHVybiB0eXBlIGZvciAke3JldHVyblR5cGVLZXl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmV0dXJuVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgbWV0aG9kIHBhcmFtZXRlciB0eXBlLlxuICAgKiBAcGFyYW0ge3ttZXRob2ROYW1lOiBzdHJpbmcsIHBhcmFtZXRlckluZGV4OiBudW1iZXIsIHNvdXJjZUNsYXNzTmFtZTogc3RyaW5nfX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gSlNEb2MgcGFyYW1ldGVyIHR5cGUgd2hlbiBkb2N1bWVudGVkLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlKHttZXRob2ROYW1lLCBwYXJhbWV0ZXJJbmRleCwgc291cmNlQ2xhc3NOYW1lfSkge1xuICAgIGNvbnN0IHBhcmFtZXRlcnMgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUGFyYW1ldGVycyh7bWV0aG9kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSlcblxuICAgIGlmICghcGFyYW1ldGVycykgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHBhcmFtZXRlciA9IHBhcmFtZXRlcnNbcGFyYW1ldGVySW5kZXhdXG5cbiAgICBpZiAocGFyYW1ldGVyID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsXG5cbiAgICBpZiAocGFyYW1ldGVyLnR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBub24tZW1wdHkgSlNEb2MgcGFyYW1ldGVyIHR5cGUgZm9yICR7c291cmNlQ2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9IHBhcmFtZXRlciAke3BhcmFtZXRlckluZGV4fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcmFtZXRlci50eXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcGFyYW1ldGVycy5cbiAgICogQHBhcmFtIHt7bWV0aG9kTmFtZTogc3RyaW5nLCBzb3VyY2VDbGFzc05hbWU6IHN0cmluZ319IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZVtdIHwgbnVsbD59IC0gSlNEb2MgcGFyYW1ldGVycyAobmFtZSArIHR5cGUpIHdoZW4gZG9jdW1lbnRlZC5cbiAgICovXG4gIGFzeW5jIHJlc291cmNlTWV0aG9kUGFyYW1ldGVycyh7bWV0aG9kTmFtZSwgc291cmNlQ2xhc3NOYW1lfSkge1xuICAgIGNvbnN0IHJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMgPSBhd2FpdCB0aGlzLnJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXMoKVxuICAgIGNvbnN0IHBhcmFtZXRlclR5cGVzS2V5ID0gYCR7c291cmNlQ2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YFxuXG4gICAgaWYgKCFyZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzLmhhcyhwYXJhbWV0ZXJUeXBlc0tleSkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwYXJhbWV0ZXJzID0gcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlcy5nZXQocGFyYW1ldGVyVHlwZXNLZXkpXG5cbiAgICBpZiAoIXBhcmFtZXRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgSlNEb2MgcGFyYW1ldGVycyBmb3IgJHtwYXJhbWV0ZXJUeXBlc0tleX1gKVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbWV0ZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBSZXNvdXJjZU1ldGhvZFJldHVyblR5cGU+Pn0gLSBSZXNvdXJjZSBtZXRob2QgcmV0dXJuIHR5cGVzIGtleWVkIGJ5IENsYXNzTmFtZS5tZXRob2ROYW1lLlxuICAgKi9cbiAgYXN5bmMgcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcygpIHtcbiAgICBpZiAodGhpcy5fcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcykgcmV0dXJuIHRoaXMuX3Jlc291cmNlTWV0aG9kUmV0dXJuVHlwZXNcblxuICAgIGNvbnN0IHNvdXJjZUZpbGVzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VGaWxlcygpXG4gICAgY29uc3QgcmV0dXJuVHlwZXMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBzb3VyY2VGaWxlcykge1xuICAgICAgY29uc3Qgc291cmNlVGV4dCA9IGF3YWl0IGZzLnJlYWRGaWxlKHNvdXJjZUZpbGUsIFwidXRmOFwiKVxuXG4gICAgICB0aGlzLmFkZFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZXNGcm9tU291cmNlKHtyZXR1cm5UeXBlcywgc291cmNlRmlsZSwgc291cmNlVGV4dH0pXG4gICAgfVxuXG4gICAgdGhpcy5fcmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlcyA9IHJldHVyblR5cGVzXG5cbiAgICByZXR1cm4gcmV0dXJuVHlwZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIG1ldGhvZCBwYXJhbWV0ZXIgdHlwZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZVtdPj59IC0gUmVzb3VyY2UgbWV0aG9kIHBhcmFtZXRlcnMga2V5ZWQgYnkgQ2xhc3NOYW1lLm1ldGhvZE5hbWUuXG4gICAqL1xuICBhc3luYyByZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzKCkge1xuICAgIGlmICh0aGlzLl9yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzKSByZXR1cm4gdGhpcy5fcmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlc1xuXG4gICAgY29uc3Qgc291cmNlRmlsZXMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxKc0RvY1NvdXJjZUZpbGVzKClcbiAgICBjb25zdCBwYXJhbWV0ZXJUeXBlcyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIHNvdXJjZUZpbGVzKSB7XG4gICAgICBjb25zdCBzb3VyY2VUZXh0ID0gYXdhaXQgZnMucmVhZEZpbGUoc291cmNlRmlsZSwgXCJ1dGY4XCIpXG5cbiAgICAgIHRoaXMuYWRkUmVzb3VyY2VNZXRob2RQYXJhbWV0ZXJUeXBlc0Zyb21Tb3VyY2Uoe3BhcmFtZXRlclR5cGVzLCBzb3VyY2VGaWxlLCBzb3VyY2VUZXh0fSlcbiAgICB9XG5cbiAgICB0aGlzLl9yZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVzID0gcGFyYW1ldGVyVHlwZXNcblxuICAgIHJldHVybiBwYXJhbWV0ZXJUeXBlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgSlNEb2Mgc291cmNlIGZpbGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gSmF2YVNjcmlwdCBzb3VyY2UgZmlsZXMgdGhhdCBjYW4gZGVmaW5lIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcyBhbmQgbW9kZWwgYWNjZXNzb3JzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEpzRG9jU291cmNlRmlsZXMoKSB7XG4gICAgY29uc3Qgc291cmNlRmlsZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzb3VyY2VEaXJlY3Rvcnkgb2YgdGhpcy5mcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VEaXJlY3RvcmllcygpKSB7XG4gICAgICBzb3VyY2VGaWxlcy5wdXNoKC4uLmF3YWl0IHRoaXMuamF2YXNjcmlwdEZpbGVzSW5EaXJlY3Rvcnkoc291cmNlRGlyZWN0b3J5KSlcbiAgICB9XG5cbiAgICByZXR1cm4gc291cmNlRmlsZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIEpTRG9jIHNvdXJjZSBkaXJlY3Rvcmllcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNvdXJjZSBkaXJlY3RvcmllcyB0byBzY2FuIGZvciBnZW5lcmF0ZWQgZnJvbnRlbmQtbW9kZWwgSlNEb2MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsSnNEb2NTb3VyY2VEaXJlY3RvcmllcygpIHtcbiAgICBjb25zdCBzb3VyY2VEaXJlY3RvcmllcyA9IG5ldyBTZXQoW3BhdGguam9pbih0aGlzLmRpcmVjdG9yeSgpLCBcInNyY1wiKV0pXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgICBpZiAodHlwZW9mIGJhY2tlbmRQcm9qZWN0LnBhdGggPT0gXCJzdHJpbmdcIiAmJiBiYWNrZW5kUHJvamVjdC5wYXRoLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc291cmNlRGlyZWN0b3JpZXMuYWRkKHBhdGguam9pbihiYWNrZW5kUHJvamVjdC5wYXRoLCBcInNyY1wiKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShzb3VyY2VEaXJlY3RvcmllcylcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIHJlc291cmNlIG1ldGhvZCByZXR1cm4gdHlwZXMgZnJvbSBzb3VyY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge01hcDxzdHJpbmcsIFJlc291cmNlTWV0aG9kUmV0dXJuVHlwZT59IGFyZ3MucmV0dXJuVHlwZXMgLSBNdXRhYmxlIHJldHVybiB0eXBlcyBtYXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3Muc291cmNlRmlsZV0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zb3VyY2VUZXh0IC0gU291cmNlIHRleHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkUmVzb3VyY2VNZXRob2RSZXR1cm5UeXBlc0Zyb21Tb3VyY2Uoe3JldHVyblR5cGVzLCBzb3VyY2VGaWxlID0gbnVsbCwgc291cmNlVGV4dH0pIHtcbiAgICBjb25zdCBjbGFzc1JlZ2V4ID0gL2NsYXNzXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXHMrKD86ZXh0ZW5kc1xccytbXntdKyk/XFx7L2dcbiAgICBjb25zdCBpbXBvcnRBbGlhc2VzID0gdGhpcy5qc0RvY0ltcG9ydEFsaWFzZXNGcm9tU291cmNlKHNvdXJjZVRleHQpXG4gICAgbGV0IGNsYXNzTWF0Y2hcblxuICAgIHdoaWxlICgoY2xhc3NNYXRjaCA9IGNsYXNzUmVnZXguZXhlYyhzb3VyY2VUZXh0KSkpIHtcbiAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IGNsYXNzTWF0Y2hbMV1cbiAgICAgIGNvbnN0IGNsYXNzQm9keVN0YXJ0ID0gY2xhc3NSZWdleC5sYXN0SW5kZXhcbiAgICAgIGNvbnN0IGNsYXNzQm9keUVuZCA9IHRoaXMubWF0Y2hpbmdCcmFjZUluZGV4KHtvcGVuSW5kZXg6IGNsYXNzQm9keVN0YXJ0IC0gMSwgc291cmNlVGV4dH0pXG5cbiAgICAgIGlmIChjbGFzc0JvZHlFbmQgPT0gbnVsbCkge1xuICAgICAgICAvLyBUaGUgYnJhY2UgbWF0Y2hlciBjYW4ndCB0b2tlbml6ZSBldmVyeSBjb25zdHJ1Y3QgKGUuZy4gYSByZWdleCBsaXRlcmFsXG4gICAgICAgIC8vIHdob3NlIHF1b3RlcyBsb29rIGxpa2Ugc3RyaW5nIGRlbGltaXRlcnMpLCBzbyBpdCBjYW4gZmFpbCB0byBsb2NhdGUgYVxuICAgICAgICAvLyBjbGFzcyBib2R5LiBTa2lwIG1ldGFkYXRhIGV4dHJhY3Rpb24gZm9yIHRoYXQgY2xhc3MgcmF0aGVyIHRoYW5cbiAgICAgICAgLy8gYWJvcnRpbmcgdGhlIHdob2xlIGZyb250ZW5kLW1vZGVsIGdlbmVyYXRpb247IHJlc291cmNlcyB0aGF0IHBhcnNlXG4gICAgICAgIC8vIGNsZWFubHkgc3RpbGwgZ2V0IHRoZWlyIEpTRG9jLWRlcml2ZWQgcmV0dXJuL3BhcmFtIHR5cGVzLlxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjbGFzc0JvZHkgPSBzb3VyY2VUZXh0LnNsaWNlKGNsYXNzQm9keVN0YXJ0LCBjbGFzc0JvZHlFbmQpXG4gICAgICBjb25zdCBqc0RvY1JlZ2V4ID0gL1xcL1xcKlxcKihbXFxzXFxTXSo/KVxcKlxcLy9nXG4gICAgICBsZXQganNEb2NNYXRjaFxuXG4gICAgICB3aGlsZSAoKGpzRG9jTWF0Y2ggPSBqc0RvY1JlZ2V4LmV4ZWMoY2xhc3NCb2R5KSkpIHtcbiAgICAgICAgY29uc3Qgc291cmNlQWZ0ZXJKc0RvYyA9IGNsYXNzQm9keS5zbGljZShqc0RvY1JlZ2V4Lmxhc3RJbmRleClcbiAgICAgICAgY29uc3QgbWV0aG9kTWF0Y2ggPSBzb3VyY2VBZnRlckpzRG9jLm1hdGNoKC9eXFxzKig/OmFzeW5jXFxzKyk/KFtBLVphLXpfJF1bXFx3JF0qKVxccypcXCgvKVxuXG4gICAgICAgIGlmICghbWV0aG9kTWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgbWV0aG9kTmFtZSA9IG1ldGhvZE1hdGNoWzFdXG5cbiAgICAgICAgY29uc3QgcmV0dXJuVHlwZSA9IHRoaXMuanNEb2NSZXR1cm5UeXBlKGpzRG9jTWF0Y2hbMV0pXG5cbiAgICAgICAgaWYgKHJldHVyblR5cGUpIHtcbiAgICAgICAgICByZXR1cm5UeXBlcy5zZXQoYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YCwge2ltcG9ydEFsaWFzZXMsIHNvdXJjZUZpbGUsIHR5cGU6IHJldHVyblR5cGV9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNsYXNzUmVnZXgubGFzdEluZGV4ID0gY2xhc3NCb2R5RW5kICsgMVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIHJlc291cmNlIG1ldGhvZCBwYXJhbWV0ZXIgdHlwZXMgZnJvbSBzb3VyY2UuXG4gICAqIEBwYXJhbSB7e3BhcmFtZXRlclR5cGVzOiBNYXA8c3RyaW5nLCBSZXNvdXJjZU1ldGhvZFBhcmFtZXRlclR5cGVbXT4sIHNvdXJjZUZpbGU/OiBzdHJpbmcgfCBudWxsLCBzb3VyY2VUZXh0OiBzdHJpbmd9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFJlc291cmNlTWV0aG9kUGFyYW1ldGVyVHlwZXNGcm9tU291cmNlKHtwYXJhbWV0ZXJUeXBlcywgc291cmNlRmlsZSA9IG51bGwsIHNvdXJjZVRleHR9KSB7XG4gICAgY29uc3QgY2xhc3NSZWdleCA9IC9jbGFzc1xccysoW0EtWmEtel8kXVtcXHckXSopXFxzKyg/OmV4dGVuZHNcXHMrW157XSspP1xcey9nXG4gICAgY29uc3QgaW1wb3J0QWxpYXNlcyA9IHRoaXMuanNEb2NJbXBvcnRBbGlhc2VzRnJvbVNvdXJjZShzb3VyY2VUZXh0KVxuICAgIGxldCBjbGFzc01hdGNoXG5cbiAgICB3aGlsZSAoKGNsYXNzTWF0Y2ggPSBjbGFzc1JlZ2V4LmV4ZWMoc291cmNlVGV4dCkpKSB7XG4gICAgICBjb25zdCBjbGFzc05hbWUgPSBjbGFzc01hdGNoWzFdXG4gICAgICBjb25zdCBjbGFzc0JvZHlTdGFydCA9IGNsYXNzUmVnZXgubGFzdEluZGV4XG4gICAgICBjb25zdCBjbGFzc0JvZHlFbmQgPSB0aGlzLm1hdGNoaW5nQnJhY2VJbmRleCh7b3BlbkluZGV4OiBjbGFzc0JvZHlTdGFydCAtIDEsIHNvdXJjZVRleHR9KVxuXG4gICAgICBpZiAoY2xhc3NCb2R5RW5kID09IG51bGwpIHtcbiAgICAgICAgLy8gVGhlIGJyYWNlIG1hdGNoZXIgY2FuJ3QgdG9rZW5pemUgZXZlcnkgY29uc3RydWN0IChlLmcuIGEgcmVnZXggbGl0ZXJhbFxuICAgICAgICAvLyB3aG9zZSBxdW90ZXMgbG9vayBsaWtlIHN0cmluZyBkZWxpbWl0ZXJzKSwgc28gaXQgY2FuIGZhaWwgdG8gbG9jYXRlIGFcbiAgICAgICAgLy8gY2xhc3MgYm9keS4gU2tpcCBtZXRhZGF0YSBleHRyYWN0aW9uIGZvciB0aGF0IGNsYXNzIHJhdGhlciB0aGFuXG4gICAgICAgIC8vIGFib3J0aW5nIHRoZSB3aG9sZSBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uOyByZXNvdXJjZXMgdGhhdCBwYXJzZVxuICAgICAgICAvLyBjbGVhbmx5IHN0aWxsIGdldCB0aGVpciBKU0RvYy1kZXJpdmVkIHJldHVybi9wYXJhbSB0eXBlcy5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgY2xhc3NCb2R5ID0gc291cmNlVGV4dC5zbGljZShjbGFzc0JvZHlTdGFydCwgY2xhc3NCb2R5RW5kKVxuICAgICAgY29uc3QganNEb2NSZWdleCA9IC9cXC9cXCpcXCooW1xcc1xcU10qPylcXCpcXC8vZ1xuICAgICAgbGV0IGpzRG9jTWF0Y2hcblxuICAgICAgd2hpbGUgKChqc0RvY01hdGNoID0ganNEb2NSZWdleC5leGVjKGNsYXNzQm9keSkpKSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZUFmdGVySnNEb2MgPSBjbGFzc0JvZHkuc2xpY2UoanNEb2NSZWdleC5sYXN0SW5kZXgpXG4gICAgICAgIGNvbnN0IG1ldGhvZE1hdGNoID0gc291cmNlQWZ0ZXJKc0RvYy5tYXRjaCgvXlxccyooPzphc3luY1xccyspPyhbQS1aYS16XyRdW1xcdyRdKilcXHMqXFwoLylcblxuICAgICAgICBpZiAoIW1ldGhvZE1hdGNoKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBtZXRob2RNYXRjaFsxXVxuICAgICAgICBjb25zdCBqc0RvY1BhcmFtZXRlcnMgPSB0aGlzLmpzRG9jUGFyYW1ldGVycyhqc0RvY01hdGNoWzFdKVxuXG4gICAgICAgIGlmIChqc0RvY1BhcmFtZXRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHBhcmFtZXRlclR5cGVzLnNldChgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gLCBqc0RvY1BhcmFtZXRlcnMubWFwKChwYXJhbWV0ZXIpID0+ICh7Li4ucGFyYW1ldGVyLCBpbXBvcnRBbGlhc2VzLCBzb3VyY2VGaWxlfSkpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNsYXNzUmVnZXgubGFzdEluZGV4ID0gY2xhc3NCb2R5RW5kICsgMVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIEpTRG9jIGltcG9ydCBhbGlhc2VzIGZyb20gc291cmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc291cmNlVGV4dCAtIFNvdXJjZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7TWFwPHN0cmluZywgUmVzb3VyY2VKc0RvY0ltcG9ydEFsaWFzPn0gLSBJbXBvcnQgYWxpYXNlcyBrZXllZCBieSBsb2NhbCBuYW1lLlxuICAgKi9cbiAganNEb2NJbXBvcnRBbGlhc2VzRnJvbVNvdXJjZShzb3VyY2VUZXh0KSB7XG4gICAgY29uc3QgaW1wb3J0QWxpYXNlcyA9IG5ldyBNYXAoKVxuICAgIGNvbnN0IGltcG9ydFJlZ2V4ID0gL0BpbXBvcnRcXHMqXFx7XFxzKihbXn1dKz8pXFxzKlxcfVxccypmcm9tXFxzKltcIiddKFteXCInXSspW1wiJ10vZ1xuICAgIGxldCBpbXBvcnRNYXRjaFxuXG4gICAgd2hpbGUgKChpbXBvcnRNYXRjaCA9IGltcG9ydFJlZ2V4LmV4ZWMoc291cmNlVGV4dCkpKSB7XG4gICAgICBjb25zdCBpbXBvcnRMaXN0ID0gaW1wb3J0TWF0Y2hbMV1cbiAgICAgIGNvbnN0IHNwZWNpZmllciA9IGltcG9ydE1hdGNoWzJdXG5cbiAgICAgIGZvciAoY29uc3QgcmF3SW1wb3J0RW50cnkgb2YgaW1wb3J0TGlzdC5zcGxpdChcIixcIikpIHtcbiAgICAgICAgY29uc3QgaW1wb3J0RW50cnkgPSByYXdJbXBvcnRFbnRyeS50cmltKClcblxuICAgICAgICBpZiAoaW1wb3J0RW50cnkubGVuZ3RoIDwgMSkgY29udGludWVcblxuICAgICAgICBjb25zdCBlbnRyeU1hdGNoID0gaW1wb3J0RW50cnkubWF0Y2goL14oZGVmYXVsdHxbQS1aYS16XyRdW1xcdyRdKikoPzpcXHMrYXNcXHMrKFtBLVphLXpfJF1bXFx3JF0qKSk/JC8pXG5cbiAgICAgICAgaWYgKCFlbnRyeU1hdGNoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgcGFyc2UgSlNEb2MgQGltcG9ydCBlbnRyeTogJHtpbXBvcnRFbnRyeX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW1wb3J0ZWROYW1lID0gZW50cnlNYXRjaFsxXVxuICAgICAgICBjb25zdCBhbGlhc05hbWUgPSBlbnRyeU1hdGNoWzJdIHx8IGltcG9ydGVkTmFtZVxuXG4gICAgICAgIGltcG9ydEFsaWFzZXMuc2V0KGFsaWFzTmFtZSwge2ltcG9ydGVkTmFtZSwgc3BlY2lmaWVyfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaW1wb3J0QWxpYXNlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHJldHVybiB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ganNEb2NUZXh0IC0gSlNEb2MgdGV4dCBpbnNpZGUgY29tbWVudCBtYXJrZXJzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBKU0RvYyByZXR1cm4gdHlwZSB3aGVuIHByZXNlbnQuXG4gICAqL1xuICBqc0RvY1JldHVyblR5cGUoanNEb2NUZXh0KSB7XG4gICAgY29uc3QgcmV0dXJuc01hdGNoID0ganNEb2NUZXh0Lm1hdGNoKC9AcmV0dXJucz9cXHMqXFx7LylcblxuICAgIGlmICghcmV0dXJuc01hdGNoIHx8IHJldHVybnNNYXRjaC5pbmRleCA9PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdHlwZU9wZW5JbmRleCA9IHJldHVybnNNYXRjaC5pbmRleCArIHJldHVybnNNYXRjaFswXS5sZW5ndGggLSAxXG4gICAgY29uc3QgdHlwZUNsb3NlSW5kZXggPSB0aGlzLm1hdGNoaW5nQnJhY2VJbmRleCh7b3BlbkluZGV4OiB0eXBlT3BlbkluZGV4LCBzb3VyY2VUZXh0OiBqc0RvY1RleHR9KVxuXG4gICAgaWYgKHR5cGVDbG9zZUluZGV4ID09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IHBhcnNlIEpTRG9jIHJldHVybiB0eXBlIGZyb206ICR7anNEb2NUZXh0fWApXG4gICAgfVxuXG4gICAgY29uc3QgcmV0dXJuVHlwZSA9IHRoaXMubm9ybWFsaXplSnNEb2NUeXBlKGpzRG9jVGV4dC5zbGljZSh0eXBlT3BlbkluZGV4ICsgMSwgdHlwZUNsb3NlSW5kZXgpKVxuXG4gICAgaWYgKHJldHVyblR5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBub24tZW1wdHkgSlNEb2MgcmV0dXJuIHR5cGUgaW46ICR7anNEb2NUZXh0fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJldHVyblR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsYXBzZXMgYSBKU0RvYyB0eXBlIHNwYW5uaW5nIG11bHRpcGxlIGNvbW1lbnQgbGluZXMgaW50byBhIHNpbmdsZSBsaW5lIHNvIGl0IGNhblxuICAgKiBiZSBlbWl0dGVkIGludG8gYW4gaW5saW5lIHR5cGUtYXNzZXJ0aW9uIGNhc3QuIEEgbXVsdGlsaW5lIGJhY2tlbmQgcmV0dXJuIHR5cGUga2VlcHNcbiAgICogaXRzIGxlYWRpbmcgY29udGludWF0aW9uIGFzdGVyaXNrcyBpbiB0aGUgY2FwdHVyZWQgc3Vic3RyaW5nLCB3aGljaCBhcmUgaW52YWxpZCBpbnNpZGVcbiAgICogYW4gaW5saW5lIGNhc3QgYW5kIG1ha2UgVHlwZVNjcmlwdCByZWFkIHRoZSBhc3NlcnRlZCB0eXBlIGFzIGB1bmRlZmluZWRgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ganNEb2NUeXBlIC0gUmF3IGNhcHR1cmVkIEpTRG9jIHR5cGUsIHBvc3NpYmx5IG11bHRpbGluZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTaW5nbGUtbGluZSBKU0RvYyB0eXBlLlxuICAgKi9cbiAgbm9ybWFsaXplSnNEb2NUeXBlKGpzRG9jVHlwZSkge1xuICAgIHJldHVybiBqc0RvY1R5cGUucmVwbGFjZSgvXFxzKlxcblxccypcXCo/WyBcXHRdKi9nLCBcIiBcIikudHJpbSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqcyBkb2MgcGFyYW1ldGVycy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpzRG9jVGV4dCAtIEpTRG9jIHRleHQgaW5zaWRlIGNvbW1lbnQgbWFya2Vycy5cbiAgICogQHJldHVybnMge0FycmF5PHtuYW1lOiBzdHJpbmcgfCBudWxsLCB0eXBlOiBzdHJpbmd9Pn0gLSBKU0RvYyBwYXJhbWV0ZXJzIChuYW1lICsgdHlwZSkgaW4gZGVjbGFyYXRpb24gb3JkZXIuXG4gICAqL1xuICBqc0RvY1BhcmFtZXRlcnMoanNEb2NUZXh0KSB7XG4gICAgY29uc3QgcGFyYW1ldGVycyA9IFtdXG4gICAgY29uc3QgcGFyYW1SZWdleCA9IC9AcGFyYW1cXHMqXFx7L2dcbiAgICBsZXQgX3BhcmFtTWF0Y2hcblxuICAgIHdoaWxlICgoX3BhcmFtTWF0Y2ggPSBwYXJhbVJlZ2V4LmV4ZWMoanNEb2NUZXh0KSkpIHtcbiAgICAgIGNvbnN0IHR5cGVPcGVuSW5kZXggPSBwYXJhbVJlZ2V4Lmxhc3RJbmRleCAtIDFcbiAgICAgIGNvbnN0IHR5cGVDbG9zZUluZGV4ID0gdGhpcy5tYXRjaGluZ0JyYWNlSW5kZXgoe29wZW5JbmRleDogdHlwZU9wZW5JbmRleCwgc291cmNlVGV4dDoganNEb2NUZXh0fSlcblxuICAgICAgaWYgKHR5cGVDbG9zZUluZGV4ID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgcGFyc2UgSlNEb2MgcGFyYW1ldGVyIHR5cGUgZnJvbTogJHtqc0RvY1RleHR9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdHlwZSA9IHRoaXMubm9ybWFsaXplSnNEb2NUeXBlKGpzRG9jVGV4dC5zbGljZSh0eXBlT3BlbkluZGV4ICsgMSwgdHlwZUNsb3NlSW5kZXgpKVxuXG4gICAgICBpZiAodHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbm9uLWVtcHR5IEpTRG9jIHBhcmFtZXRlciB0eXBlIGluOiAke2pzRG9jVGV4dH1gKVxuICAgICAgfVxuXG4gICAgICAvLyBBZnRlciB0aGUgY2xvc2luZyBicmFjZSB0aGUgcGFyYW1ldGVyIG5hbWUgZm9sbG93cyAob3B0aW9uYWxseSBicmFja2V0ZWRcbiAgICAgIC8vIGZvciBgQHBhcmFtIHt0eXBlfSBbbmFtZV1gKS4gQ2FwdHVyZSB0aGUgbGVhZGluZyBuYW1lIHRva2VuIOKAlCBpbmNsdWRpbmcgYW55XG4gICAgICAvLyBkb3R0ZWQgcGF0aCBzbyBvYmplY3QtcHJvcGVydHkgdGFncyBsaWtlIGBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXNzYWdlYCBzdGF5XG4gICAgICAvLyBkaXN0aW5ndWlzaGFibGUgZnJvbSB0aGUgdG9wLWxldmVsIGBAcGFyYW0ge29iamVjdH0gYXJnc2AgcGFyYW1ldGVyLlxuICAgICAgY29uc3QgbmFtZU1hdGNoID0ganNEb2NUZXh0LnNsaWNlKHR5cGVDbG9zZUluZGV4ICsgMSkubWF0Y2goL15cXHMqXFxbP1xccyooW0EtWmEtel8kXVtcXHckLl0qKS8pXG5cbiAgICAgIHBhcmFtZXRlcnMucHVzaCh7bmFtZTogbmFtZU1hdGNoID8gbmFtZU1hdGNoWzFdIDogbnVsbCwgdHlwZX0pXG4gICAgICBwYXJhbVJlZ2V4Lmxhc3RJbmRleCA9IHR5cGVDbG9zZUluZGV4ICsgMVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbWV0ZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqYXZhc2NyaXB0IGZpbGVzIGluIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpcmVjdG9yeSAtIERpcmVjdG9yeSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gSmF2YVNjcmlwdCBzb3VyY2UgZmlsZSBwYXRocy5cbiAgICovXG4gIGFzeW5jIGphdmFzY3JpcHRGaWxlc0luRGlyZWN0b3J5KGRpcmVjdG9yeSkge1xuICAgIGxldCBlbnRyaWVzXG5cbiAgICB0cnkge1xuICAgICAgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIoZGlyZWN0b3J5LCB7d2l0aEZpbGVUeXBlczogdHJ1ZX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciAmJiB0eXBlb2YgZXJyb3IgPT0gXCJvYmplY3RcIiAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiBlcnJvci5jb2RlID09PSBcIkVOT0VOVFwiKSByZXR1cm4gW11cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlUGF0aHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICBjb25zdCBlbnRyeVBhdGggPSBwYXRoLmpvaW4oZGlyZWN0b3J5LCBlbnRyeS5uYW1lKVxuXG4gICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICBmaWxlUGF0aHMucHVzaCguLi5hd2FpdCB0aGlzLmphdmFzY3JpcHRGaWxlc0luRGlyZWN0b3J5KGVudHJ5UGF0aCkpXG4gICAgICB9IGVsc2UgaWYgKGVudHJ5LmlzRmlsZSgpICYmIC9cXC4obWpzfGpzfGpzeHx0cykkLy50ZXN0KGVudHJ5Lm5hbWUpKSB7XG4gICAgICAgIGZpbGVQYXRocy5wdXNoKGVudHJ5UGF0aClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZVBhdGhzXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSBtYXRjaGluZyBjbG9zaW5nIGJyYWNlIHdoaWxlIHJlc3BlY3RpbmcgSmF2YVNjcmlwdCBzdHJpbmdzIGFuZCBjb21tZW50cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm9wZW5JbmRleCAtIE9wZW5pbmcgYnJhY2UgaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNvdXJjZVRleHQgLSBTb3VyY2UgdGV4dC5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gQ2xvc2luZyBicmFjZSBpbmRleCB3aGVuIGZvdW5kLlxuICAgKi9cbiAgbWF0Y2hpbmdCcmFjZUluZGV4KHtvcGVuSW5kZXgsIHNvdXJjZVRleHR9KSB7XG4gICAgaWYgKHNvdXJjZVRleHRbb3BlbkluZGV4XSAhPT0gXCJ7XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb3BlbmluZyBicmFjZSBhdCBpbmRleCAke29wZW5JbmRleH1gKVxuICAgIH1cblxuICAgIGxldCBkZXB0aCA9IDBcbiAgICBsZXQgaW5CbG9ja0NvbW1lbnQgPSBmYWxzZVxuICAgIGxldCBpbkxpbmVDb21tZW50ID0gZmFsc2VcbiAgICBsZXQgaW5TdHJpbmcgPSBcIlwiXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IG9wZW5JbmRleDsgaW5kZXggPCBzb3VyY2VUZXh0Lmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgY29uc3QgY2hhciA9IHNvdXJjZVRleHRbaW5kZXhdXG4gICAgICBjb25zdCBuZXh0Q2hhciA9IHNvdXJjZVRleHRbaW5kZXggKyAxXVxuICAgICAgY29uc3QgcHJldmlvdXNDaGFyID0gc291cmNlVGV4dFtpbmRleCAtIDFdXG5cbiAgICAgIGlmIChpbkxpbmVDb21tZW50KSB7XG4gICAgICAgIGlmIChjaGFyID09PSBcIlxcblwiKSBpbkxpbmVDb21tZW50ID0gZmFsc2VcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5CbG9ja0NvbW1lbnQpIHtcbiAgICAgICAgaWYgKGNoYXIgPT09IFwiKlwiICYmIG5leHRDaGFyID09PSBcIi9cIikge1xuICAgICAgICAgIGluQmxvY2tDb21tZW50ID0gZmFsc2VcbiAgICAgICAgICBpbmRleCsrXG4gICAgICAgIH1cblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5TdHJpbmcpIHtcbiAgICAgICAgaWYgKGNoYXIgPT09IGluU3RyaW5nICYmIHByZXZpb3VzQ2hhciAhPT0gXCJcXFxcXCIpIGluU3RyaW5nID0gXCJcIlxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIi9cIiAmJiBuZXh0Q2hhciA9PT0gXCIvXCIpIHtcbiAgICAgICAgaW5MaW5lQ29tbWVudCA9IHRydWVcbiAgICAgICAgaW5kZXgrK1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCIvXCIgJiYgbmV4dENoYXIgPT09IFwiKlwiKSB7XG4gICAgICAgIGluQmxvY2tDb21tZW50ID0gdHJ1ZVxuICAgICAgICBpbmRleCsrXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIlxcXCJcIiB8fCBjaGFyID09PSBcIidcIiB8fCBjaGFyID09PSBcImBcIikge1xuICAgICAgICBpblN0cmluZyA9IGNoYXJcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICAgIGRlcHRoKytcbiAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgICAgZGVwdGgtLVxuXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCkgcmV0dXJuIGluZGV4XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dHJpYnV0ZSBjb25maWcgZm9yIG1vZGVsIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWxDbGFzcyAtIEJhY2tlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZEF0dHJpYnV0ZUNvbmZpZyB8IG51bGx9IC0gQXR0cmlidXRlIGNvbmZpZyBpbmZlcnJlZCBmcm9tIHRoZSBiYWNrZW5kIG1vZGVsIHdoZW4gYXZhaWxhYmxlLlxuICAgKi9cbiAgZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JNb2RlbEF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKCFyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiBudWxsXG5cbiAgICBsZXQgY29sdW1uTmFtZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJ1c2VkIGJlZm9yZSBpbml0aWFsaXphdGlvblwiKSkgcmV0dXJuIG51bGxcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgbGV0IGNvbHVtblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbHVtbiA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKFwidXNlZCBiZWZvcmUgaW5pdGlhbGl6YXRpb25cIikpIHJldHVybiBudWxsXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbHVtbiA/IHRoaXMuZnJvbnRlbmRBdHRyaWJ1dGVDb25maWdGb3JDb2x1bW4oe2NvbHVtbn0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0cmlidXRlIGNvbmZpZyBmb3IgY29sdW1uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29sdW1uIC0gRGF0YWJhc2UgY29sdW1uLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRBdHRyaWJ1dGVDb25maWd9IC0gQXR0cmlidXRlIGNvbmZpZyBpbmZlcnJlZCBmcm9tIHRoZSBkYXRhYmFzZSBjb2x1bW4uXG4gICAqL1xuICBmcm9udGVuZEF0dHJpYnV0ZUNvbmZpZ0ZvckNvbHVtbih7Y29sdW1ufSkge1xuICAgIGNvbnN0IHR5cGUgPSBjb2x1bW4uZ2V0VHlwZSgpXG5cbiAgICBpZiAodHlwZW9mIHR5cGUgIT0gXCJzdHJpbmdcIiB8fCB0eXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbm9uLWVtcHR5IGNvbHVtbiB0eXBlIGZvciBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgaW5mZXJlbmNlLCBnb3Q6ICR7dHlwZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBudWxsOiBjb2x1bW4uZ2V0TnVsbCgpLFxuICAgICAgdHlwZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcHMgZm9yIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2xhc3NOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLm1vZGVsQ29uZmlnIC0gTW9kZWwgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IFthcmdzLnJlc291cmNlQ2xhc3NdIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7YXV0b2xvYWQ6IGJvb2xlYW4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdGFyZ2V0Q2xhc3NOYW1lOiBzdHJpbmcsIHRhcmdldEZpbGVOYW1lOiBzdHJpbmcsIHR5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9Pn0gLSBSZWxhdGlvbnNoaXBzLlxuICAgKi9cbiAgcmVsYXRpb25zaGlwc0Zvck1vZGVsKHtjbGFzc05hbWUsIG1vZGVsQ29uZmlnLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBtb2RlbENvbmZpZy5yZWxhdGlvbnNoaXBzXG5cbiAgICBpZiAocmVsYXRpb25zaGlwcyA9PT0gdW5kZWZpbmVkIHx8IHJlbGF0aW9uc2hpcHMgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBbXVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAnJHtjbGFzc05hbWV9JyBoYXMgaW52YWxpZCByZWxhdGlvbnNoaXBzIGNvbmZpZyDigJQgbXVzdCBiZSBhbiBhcnJheSBvZiByZWxhdGlvbnNoaXAgbmFtZXMsIGdvdCAke3R5cGVvZiByZWxhdGlvbnNoaXBzfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcHMubWFwKChyZWxhdGlvbnNoaXBOYW1lKSA9PiB0aGlzLmluZmVycmVkUmVsYXRpb25zaGlwRGVmaW5pdGlvbih7Y2xhc3NOYW1lLCByZWxhdGlvbnNoaXBOYW1lLCByZXNvdXJjZUNsYXNzfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmZlcnJlZCByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNsYXNzTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IFthcmdzLnJlc291cmNlQ2xhc3NdIC0gUmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt7YXV0b2xvYWQ6IGJvb2xlYW4sIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgdGFyZ2V0Q2xhc3NOYW1lOiBzdHJpbmcsIHRhcmdldEZpbGVOYW1lOiBzdHJpbmcsIHR5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9fSBJbmZlcnJlZCByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICovXG4gIGluZmVycmVkUmVsYXRpb25zaGlwRGVmaW5pdGlvbih7Y2xhc3NOYW1lLCByZWxhdGlvbnNoaXBOYW1lLCByZXNvdXJjZUNsYXNzfSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzID8gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKCkgOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRNb2RlbENsYXNzKGNsYXNzTmFtZSlcblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwVHlwZSA9IHJlbGF0aW9uc2hpcC5nZXRUeXBlKClcblxuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlICE9PSBcImJlbG9uZ3NUb1wiICYmIHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiaGFzT25lXCIgJiYgcmVsYXRpb25zaGlwVHlwZSAhPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJyR7Y2xhc3NOYW1lfScgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9JyBoYXMgdW5zdXBwb3J0ZWQgdHlwZSAnJHtyZWxhdGlvbnNoaXBUeXBlfSdgKVxuICAgIH1cblxuICAgIGxldCB0YXJnZXRDbGFzc05hbWVcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICB0YXJnZXRDbGFzc05hbWUgPSB0YXJnZXRNb2RlbENsYXNzPy5nZXRNb2RlbE5hbWUoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTW9kZWwgY2xhc3Mgbm90IHJlZ2lzdGVyZWQgeWV0IOKAlCBmYWxsIGJhY2sgdG8gY2xhc3NOYW1lIGZyb20gcmVsYXRpb25zaGlwIGRlZmluaXRpb25cbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldENsYXNzTmFtZSkge1xuICAgICAgdGFyZ2V0Q2xhc3NOYW1lID0gcmVsYXRpb25zaGlwLmNsYXNzTmFtZVxuXG4gICAgICBpZiAoIXRhcmdldENsYXNzTmFtZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICcke2NsYXNzTmFtZX0nIHJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXBOYW1lfScgaGFzIG5vIHRhcmdldCBtb2RlbCBjbGFzc2ApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGF1dG9sb2FkOiByZWxhdGlvbnNoaXAuZ2V0QXV0b2xvYWQoKSxcbiAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICB0YXJnZXRDbGFzc05hbWUsXG4gICAgICB0YXJnZXRGaWxlTmFtZTogaW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKHRhcmdldENsYXNzTmFtZSkpLFxuICAgICAgdHlwZTogcmVsYXRpb25zaGlwVHlwZVxuICAgIH1cbiAgfVxufVxuIl19
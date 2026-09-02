// @ts-check
import BaseCommand from "../../../../../cli/base-command.js";
import commandArguments from "../../../../../cli/command-arguments.js";
import DatabaseGenerationContext from "../../../../../database/generation-context.js";
import deburrColumnName from "../../../../../utils/deburr-column-name.js";
import fileExists from "../../../../../utils/file-exists.js";
import fs from "fs/promises";
import generatedFileBanner from "./generated-file-banner.js";
import * as inflection from "inflection";
const BASE_MODELS_REGENERATE_COMMAND = "velocious generate:base-models";
/**
 * Maps an effective column type to the JSDoc type used in generated base models.
 * @type {Record<string, string>}
 */
const jsDocTypeByColumnType = {
    bigint: "number",
    bit: "number",
    blob: "string",
    boolean: "boolean",
    char: "string",
    "character varying": "string",
    date: "Date",
    datetime: "Date",
    decimal: "number",
    float: "number",
    int: "number",
    integer: "number",
    json: "Record<string, unknown>",
    longtext: "string",
    mediumtext: "string",
    numeric: "number",
    nvarchar: "string",
    smallint: "number",
    text: "string",
    "timestamp without time zone": "Date",
    tinyint: "number",
    tinytext: "string",
    uuid: "string",
    varchar: "string"
};
/** Effective column types whose generated setter additionally accepts a string. */
const setterStringInputColumnTypes = new Set(["date", "datetime", "timestamp without time zone"]);
/**
 * Generates a base-model relationship method.
 * @param {{abstract?: boolean, body: string, name: string, param?: {name: string, type: string}, returns: string}} args - Method parts.
 * @returns {string} - Generated method source.
 */
function generatedRelationshipMethod({ abstract = false, body, name, param, returns }) {
    let fileContent = "  /**\n";
    if (abstract)
        fileContent += "   * @abstract\n";
    if (param)
        fileContent += `   * @param {${param.type}} ${param.name}\n`;
    fileContent += `   * @returns {${returns}}\n`;
    fileContent += "   */\n";
    fileContent += `  ${name}(${param ? param.name : ""}) { ${body} }\n`;
    return fileContent;
}
export default class DbGenerateModel extends BaseCommand {
    async execute() {
        const parsedArguments = commandArguments({
            definition: {
                booleanOptions: ["--allow-missing-tables"],
                valueOptions: ["--tenant"]
            },
            processArgs: this.processArgs || []
        });
        const allowMissingTables = parsedArguments["allow-missing-tables"] === true;
        const tenantDatabaseIdentifier = parsedArguments.tenant;
        if (typeof tenantDatabaseIdentifier === "string") {
            const context = await DatabaseGenerationContext.resolve({
                configuration: this.getConfiguration(),
                databaseIdentifier: tenantDatabaseIdentifier
            });
            const selectedModelClasses = Object.values(this.getConfiguration().getModelClasses()).filter((modelClass) => {
                const databaseIdentifier = modelClass.getDatabaseIdentifier({
                    enforceTenantDatabaseScope: false,
                    tenant: context.tenant()
                });
                if (databaseIdentifier !== context.databaseIdentifier())
                    return false;
                return modelClass.getDatabaseIdentifier({ tenant: context.tenant() }) === context.databaseIdentifier();
            });
            try {
                return await context.run({ name: "Generate selected tenant base models", callback: async (connection) => {
                        await this.generateBaseModels({ allowMissingTables, connections: { [context.databaseIdentifier()]: connection }, context });
                    } });
            }
            finally {
                for (const modelClass of selectedModelClasses)
                    modelClass.resetRecordMetadata();
            }
        }
        await this.getConfiguration().initializeModels();
        return await this.getConfiguration().ensureConnections({ name: "Generate base models" }, async (connections) => {
            await this.generateBaseModels({ allowMissingTables, connections });
        });
    }
    /**
     * Generates model bases from explicit connections.
     * @param {object} args - Generation arguments.
     * @param {boolean} args.allowMissingTables - Whether absent tables are skipped.
     * @param {Record<string, import("../../../../../database/drivers/base.js").default>} args.connections - Connections keyed by logical identifier.
     * @param {DatabaseGenerationContext} [args.context] - Selected tenant database context.
     * @returns {Promise<void>} - Resolves after writing generated bases.
     */
    async generateBaseModels({ allowMissingTables, connections, context }) {
        const rootDirectory = this.directory();
        const modelsDir = `${rootDirectory}/src/models`;
        const baseModelsDir = `${rootDirectory}/src/model-bases`;
        const modelClasses = this.getConfiguration().getModelClasses();
        const regenerateCommand = context
            ? `${BASE_MODELS_REGENERATE_COMMAND} --tenant ${context.databaseIdentifier()}`
            : BASE_MODELS_REGENERATE_COMMAND;
        let devMode = false;
        if (baseModelsDir.includes("/spec/dummy/src/model-bases")) {
            devMode = true;
        }
        if (!await fileExists(baseModelsDir)) {
            await fs.mkdir(baseModelsDir, { recursive: true });
        }
        for (const modelClassName in modelClasses) {
            const modelClass = modelClasses[modelClassName];
            let databaseIdentifier;
            if (context) {
                databaseIdentifier = modelClass.getDatabaseIdentifier({
                    enforceTenantDatabaseScope: false,
                    tenant: context.tenant()
                });
                if (databaseIdentifier !== context.databaseIdentifier())
                    continue;
                databaseIdentifier = modelClass.getDatabaseIdentifier({ tenant: context.tenant() });
            }
            else {
                databaseIdentifier = modelClass.getConfiguredDatabaseIdentifier();
            }
            if (context && databaseIdentifier !== context.databaseIdentifier())
                continue;
            const connection = connections[databaseIdentifier];
            // Default generation continues to ignore inactive tenant-only identifiers.
            if (!connection)
                continue;
            if (context)
                modelClass.resetRecordMetadata();
            const table = await connection.getTableByName(modelClass.tableName(), { throwError: !allowMissingTables });
            if (!table) {
                console.warn(`Skipping base model for '${modelClass.name}': table '${modelClass.tableName()}' was not found (--allow-missing-tables). Keeping any existing base model.`);
                continue;
            }
            await modelClass.ensureInitialized({ configuration: this.getConfiguration(), connection });
            const modelName = inflection.dasherize(modelClassName);
            const modelNameCamelized = inflection.camelize(modelName.replaceAll("-", "_"));
            const modelBaseFileName = `${inflection.dasherize(inflection.underscore(modelName))}.js`;
            const modelPath = `${baseModelsDir}/${modelBaseFileName}`;
            console.log(`create src/model-bases/${modelBaseFileName}`);
            const sourceModelFullFilePath = `${modelsDir}/${modelBaseFileName}`;
            let sourceModelFilePath;
            if (await fileExists(sourceModelFullFilePath)) {
                sourceModelFilePath = `../models/${modelBaseFileName}`;
            }
            else {
                sourceModelFilePath = "velocious/build/src/database/record/index.js";
            }
            let fileContent = generatedFileBanner(regenerateCommand);
            let velociousPath;
            if (devMode) {
                velociousPath = "../../../../src";
            }
            else {
                velociousPath = "velocious/build/src";
            }
            const columns = await table.getColumns();
            const writeAttributeTypeName = `${modelNameCamelized}WriteAttributes`;
            const belongsToWriteAttributes = await this.belongsToWriteAttributesForModel({ modelClass, modelsDir });
            const nestedWriteAttributes = this.nestedWriteAttributesForModel({ modelClass });
            fileContent += `import DatabaseRecord from "${velociousPath}/database/record/index.js"\n\n`;
            fileContent += "/**\n";
            fileContent += ` * Attributes accepted when creating or updating ${modelNameCamelized} records.\n`;
            fileContent += ` * @typedef {object} ${writeAttributeTypeName}\n`;
            for (const column of columns) {
                const deburredColumnName = deburrColumnName(column.getName());
                const camelizedColumnName = inflection.camelize(deburredColumnName, true);
                const setterJsdocType = this.jsDocSetterTypeFromColumn(column, modelClass);
                if (setterJsdocType) {
                    fileContent += ` * @property {${setterJsdocType}${column.getNull() ? " | null" : ""}} [${camelizedColumnName}] - Value for the ${camelizedColumnName} attribute.\n`;
                }
            }
            for (const belongsToWriteAttribute of belongsToWriteAttributes) {
                fileContent += ` * @property {${belongsToWriteAttribute.propertyType}} [${belongsToWriteAttribute.propertyName}] - Related ${belongsToWriteAttribute.relationshipName} record.\n`;
            }
            for (const nestedWriteAttribute of nestedWriteAttributes) {
                fileContent += ` * @property {${nestedWriteAttribute.propertyType}} [${nestedWriteAttribute.propertyName}] - Nested ${nestedWriteAttribute.relationshipName} attributes.\n`;
            }
            fileContent += " */\n\n";
            const hasManyRelationFilePath = `${velociousPath}/database/record/instance-relationships/has-many.js`;
            fileContent += `/** @augments {DatabaseRecord<${writeAttributeTypeName}>} */\n`;
            fileContent += `export default class ${modelNameCamelized}Base extends DatabaseRecord {\n`;
            // --- getModelClass() override (fixes polymorphic typing in JS/JSDoc) ---
            if (await fileExists(sourceModelFullFilePath)) {
                // Model file exists (e.g. src/models/ticket.js) → return typeof Ticket
                fileContent += `  /** @returns {typeof import("${sourceModelFilePath}").default} */\n`;
                fileContent += "  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases\n";
                fileContent += `  getModelClass() { return /** @type {typeof import("${sourceModelFilePath}").default} */ (this.constructor) }\n\n`;
            }
            else {
                // No model file yet → fall back to typeof TicketBase
                fileContent += `  /** @returns {typeof ${modelNameCamelized}Base} */\n`;
                fileContent += "  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases\n";
                fileContent += `  getModelClass() { return /** @type {typeof ${modelNameCamelized}Base} */ (this.constructor) }\n\n`;
            }
            let methodsCount = 0;
            for (const column of columns) {
                const deburredColumnName = deburrColumnName(column.getName());
                const camelizedColumnName = inflection.camelize(deburredColumnName, true);
                const camelizedColumnNameBigFirst = inflection.camelize(deburredColumnName);
                const jsdocType = this.jsDocTypeFromColumn(column, modelClass);
                if (methodsCount > 0) {
                    fileContent += "\n";
                }
                if (jsdocType) {
                    fileContent += `  /** @returns {${jsdocType}${column.getNull() ? " | null" : ""}} */\n`;
                }
                fileContent += `  ${camelizedColumnName}() { return this.readAttribute("${camelizedColumnName}") }\n\n`;
                const setterJsdocType = this.jsDocSetterTypeFromColumn(column, modelClass);
                if (setterJsdocType) {
                    fileContent += "  /**\n";
                    fileContent += `   * @param {${setterJsdocType}${column.getNull() ? " | null" : ""}} newValue\n`;
                    fileContent += "   * @returns {void}\n";
                    fileContent += "   */\n";
                }
                fileContent += `  set${camelizedColumnNameBigFirst}(newValue) { return this._setColumnAttribute("${camelizedColumnName}", newValue) }\n\n`;
                fileContent += "  /** @returns {boolean} */\n";
                fileContent += `  has${camelizedColumnNameBigFirst}() { return this._hasAttribute(this.${camelizedColumnName}()) }\n`;
                methodsCount++;
            }
            if (Object.prototype.hasOwnProperty.call(modelClass, "_translations") && modelClass._translations && Object.keys(modelClass._translations).length > 0) {
                const TranslationClass = modelClass.getTranslationClass();
                const translationColumns = TranslationClass.getColumns();
                for (const name in modelClass._translations) {
                    const nameUnderscore = inflection.underscore(name);
                    const column = translationColumns.find((translationColumn) => translationColumn.getName() === nameUnderscore);
                    let translationJsdocType;
                    if (column) {
                        translationJsdocType = this.jsDocTypeFromColumn(column, TranslationClass);
                    }
                    if (translationJsdocType && column) {
                        fileContent += `\n`;
                        fileContent += "  /**\n";
                        fileContent += `   * @returns {${translationJsdocType}${column.getNull() ? " | null" : ""}}\n`;
                        fileContent += "   */\n";
                    }
                    fileContent += `  ${name}() { return this._getTranslatedAttributeWithFallback("${name}", this._getConfiguration().getLocale()) ?? null }\n`;
                    methodsCount++;
                    const hasName = `has${inflection.camelize(name)}`;
                    const setterName = `set${inflection.camelize(name)}`;
                    const setterParamType = translationJsdocType || "?";
                    fileContent += `\n`;
                    fileContent += "  /**\n";
                    fileContent += `   * @abstract\n`;
                    fileContent += `   * @returns {boolean}\n`;
                    fileContent += "   */\n";
                    fileContent += `  ${hasName}() { throw new Error("${hasName} not implemented") }\n`;
                    methodsCount++;
                    fileContent += `\n`;
                    fileContent += "  /**\n";
                    fileContent += `   * @param {${setterParamType}} newValue\n`;
                    fileContent += `   * @returns {void}\n`;
                    fileContent += "   */\n";
                    fileContent += `  ${setterName}(newValue) { return this._setTranslatedAttribute("${name}", this._getConfiguration().getLocale(), newValue) }\n`;
                    methodsCount++;
                    for (const locale of this.getConfiguration().getLocales()) {
                        const localeMethodName = `${name}${inflection.camelize(locale)}`;
                        if (translationJsdocType && column) {
                            fileContent += `\n`;
                            fileContent += "  /**\n";
                            fileContent += `   * @returns {${translationJsdocType}${column.getNull() ? " | null" : ""}}\n`;
                            fileContent += "   */\n";
                        }
                        fileContent += `  ${localeMethodName}() { return this._getTranslatedAttributeWithFallback("${name}", "${locale}") ?? null }\n`;
                        methodsCount++;
                        const localeSetterName = `${setterName}${inflection.camelize(locale)}`;
                        fileContent += `\n`;
                        fileContent += "  /**\n";
                        fileContent += `   * @param {${setterParamType}} newValue\n`;
                        fileContent += `   * @returns {void}\n`;
                        fileContent += "   */\n";
                        fileContent += `  ${localeSetterName}(newValue) { return this._setTranslatedAttribute("${name}", "${locale}", newValue) }\n`;
                        methodsCount++;
                        const localeHasName = `has${inflection.camelize(localeMethodName)}`;
                        fileContent += `\n`;
                        fileContent += "  /**\n";
                        fileContent += `   * @abstract\n`;
                        fileContent += `   * @returns {boolean}\n`;
                        fileContent += "   */\n";
                        fileContent += `  ${localeHasName}() { throw new Error("${localeHasName} not implemented") }\n`;
                        methodsCount++;
                    }
                }
            }
            for (const relationship of modelClass.getRelationships()) {
                let baseFilePath, baseFullFilePath, fileName, fullFilePath;
                const targetModelClass = relationship.getTargetModelClass();
                if (targetModelClass) {
                    fileName = inflection.dasherize(inflection.underscore(targetModelClass.getModelName()));
                    fullFilePath = `src/models/${fileName}.js`;
                    baseFilePath = `../model-bases/${fileName}.js`;
                    baseFullFilePath = `src/model-bases/${fileName}.js`;
                }
                else if (relationship.getPolymorphic()) {
                    fileName = "velocious/build/src/database/record/index.js";
                }
                else {
                    throw new Error(`Relationship '${relationship.getRelationshipName()}' on '${modelClass.getModelName()}' has no target model class`);
                }
                if (methodsCount > 0) {
                    fileContent += "\n";
                }
                if (relationship.getType() == "belongsTo" || relationship.getType() == "hasOne") {
                    let modelFilePath;
                    if (fullFilePath && await fileExists(fullFilePath)) {
                        modelFilePath = `../models/${fileName}.js`;
                    }
                    else if (baseFullFilePath && await fileExists(baseFullFilePath)) {
                        modelFilePath = baseFilePath;
                    }
                    else {
                        modelFilePath = "velocious/build/src/database/record/index.js";
                    }
                    fileContent += "  /**\n";
                    fileContent += `   * @returns {import("${modelFilePath}").default}\n`;
                    fileContent += "   */\n";
                    fileContent += `  ${relationship.getRelationshipName()}() { return /** @type {import("${modelFilePath}").default} */ (this.getRelationshipByName("${relationship.getRelationshipName()}").loaded()) }\n`;
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += "   * @abstract\n";
                    fileContent += `   * @param {ConstructorParameters<typeof import("${modelFilePath}").default>[0]} [attributes]\n`;
                    fileContent += `   * @returns {import("${modelFilePath}").default}\n`;
                    fileContent += "   */\n";
                    fileContent += `  build${inflection.camelize(relationship.getRelationshipName())}(attributes) { void attributes; throw new Error("Not implemented") }\n`;
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += "   * @abstract\n";
                    fileContent += `   * @returns {Promise<import("${modelFilePath}").default | undefined>}\n`;
                    fileContent += "   */\n";
                    fileContent += `  load${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`;
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += `   * @returns {Promise<import("${modelFilePath}").default | undefined>}\n`;
                    fileContent += "   */\n";
                    fileContent += `  ${relationship.getRelationshipName()}OrLoad() { return /** @type {Promise<import("${modelFilePath}").default | undefined>} */ (this.relationshipOrLoad("${relationship.getRelationshipName()}")) }\n`;
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += "   * @abstract\n";
                    fileContent += `   * @param {import("${modelFilePath}").default} newModel\n`;
                    fileContent += `   * @returns {void}\n`;
                    fileContent += "   */\n";
                    fileContent += `  set${inflection.camelize(relationship.getRelationshipName())}(newModel) { void newModel; throw new Error("Not implemented") }\n`;
                }
                else if (relationship.getType() == "hasMany") {
                    let recordImport;
                    if (fullFilePath && await fileExists(fullFilePath)) {
                        recordImport = `../models/${fileName}.js`;
                    }
                    else if (baseFullFilePath && await fileExists(baseFullFilePath)) {
                        recordImport = `../model-bases/${fileName}.js`;
                    }
                    else {
                        recordImport = `${velociousPath}/database/record/index.js`;
                    }
                    fileContent += "  /**\n";
                    fileContent += `   * @returns {import("${hasManyRelationFilePath}").default<typeof import("${sourceModelFilePath}").default, typeof import("${recordImport}").default>}\n`;
                    fileContent += "   */\n";
                    fileContent += `  ${relationship.getRelationshipName()}() { return /** @type {import("${hasManyRelationFilePath}").default<typeof import("${sourceModelFilePath}").default, typeof import("${recordImport}").default>} */ (this.getRelationshipByName("${relationship.getRelationshipName()}")) }\n`;
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += `   * @returns {Array<import("${recordImport}").default>}\n`;
                    fileContent += "   */\n";
                    fileContent += `  ${relationship.getRelationshipName()}Loaded() { return /** @type {Array<import("${recordImport}").default>} */ (this.getRelationshipByName("${relationship.getRelationshipName()}").loaded()) }\n`;
                    fileContent += "\n";
                    fileContent += generatedRelationshipMethod({
                        abstract: true,
                        body: "throw new Error(\"Not implemented\")",
                        name: `load${inflection.camelize(relationship.getRelationshipName())}`,
                        returns: `Promise<Array<import("${recordImport}").default>>`
                    });
                    fileContent += "\n";
                    fileContent += generatedRelationshipMethod({
                        body: `return /** @type {Promise<Array<import("${recordImport}").default>>} */ (this.relationshipOrLoad("${relationship.getRelationshipName()}"))`,
                        name: `${relationship.getRelationshipName()}OrLoad`,
                        returns: `Promise<Array<import("${recordImport}").default>>`
                    });
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += "   * @abstract\n";
                    fileContent += `   * @param {Array<import("${recordImport}").default>} newModels\n`;
                    fileContent += "   * @returns {void}\n";
                    fileContent += "   */\n";
                    fileContent += `  set${inflection.camelize(relationship.getRelationshipName())}(newModels) { void newModels; throw new Error("Not implemented") }\n`;
                }
                else {
                    throw new Error(`Unknown relationship type: ${relationship.getType()}`);
                }
                methodsCount++;
            }
            // State-machine event methods. `Model.stateMachine(...)` registers these on the model's
            // own prototype at runtime; those override the stubs below (declared on the base class),
            // so these throwing stubs never execute. They exist only so call sites typecheck without
            // the consumer hand-writing boilerplate. Guarded on the own `_stateMachineDefinition`
            // property so a subclass without its own machine doesn't re-emit the parent's events.
            const stateMachineDefinition = Object.prototype.hasOwnProperty.call(modelClass, "_stateMachineDefinition")
                ? modelClass.getStateMachineDefinition()
                : null;
            if (stateMachineDefinition) {
                for (const eventName of Object.keys(stateMachineDefinition.events)) {
                    // `stateMachine()` installs event methods with `proto[eventName]`, so it accepts
                    // event keys that aren't valid JavaScript identifiers (e.g. "retry-build"). Those
                    // can't be written as class methods without producing an unparseable file, so skip
                    // them here — they still work at runtime via bracket access, just untyped.
                    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(eventName)) {
                        console.warn(`Skipping generated state-machine methods for event '${eventName}' on '${modelClass.name}': the event name is not a valid JavaScript identifier.`);
                        continue;
                    }
                    const capitalizedEvent = eventName.charAt(0).toUpperCase() + eventName.slice(1);
                    if (methodsCount > 0) {
                        fileContent += "\n";
                    }
                    fileContent += "  /**\n";
                    fileContent += "   * @abstract\n";
                    fileContent += "   * @returns {void}\n";
                    fileContent += "   */\n";
                    fileContent += `  ${eventName}() { throw new Error("Not implemented") }\n`;
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += "   * @abstract\n";
                    fileContent += "   * @returns {Promise<void>}\n";
                    fileContent += "   */\n";
                    fileContent += `  ${eventName}AndSave() { throw new Error("Not implemented") }\n`;
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += "   * @abstract\n";
                    fileContent += "   * @returns {boolean}\n";
                    fileContent += "   */\n";
                    fileContent += `  can${capitalizedEvent}() { throw new Error("Not implemented") }\n`;
                    fileContent += "\n";
                    fileContent += "  /**\n";
                    fileContent += "   * @abstract\n";
                    fileContent += "   * @returns {Promise<boolean>}\n";
                    fileContent += "   */\n";
                    fileContent += `  can${capitalizedEvent}Async() { throw new Error("Not implemented") }\n`;
                    methodsCount++;
                }
            }
            fileContent += "}\n";
            await fs.writeFile(modelPath, fileContent);
        }
    }
    /**
     * Runs js doc type from column.
     * @param {import("../../../../../database/drivers/base-column.js").default} column - Column.
     * @param {typeof import("../../../../../database/record/index.js").default} modelClass - Model class owning the column (for declared attribute casts).
     * @returns {string | undefined} - The js doc type from column.
     */
    jsDocTypeFromColumn(column, modelClass) {
        const type = modelClass.getColumnTypeByName(column.getName());
        const jsDocType = type ? jsDocTypeByColumnType[type] : undefined;
        if (!jsDocType) {
            console.error(`Unknown column type: ${type}`);
            return undefined;
        }
        return jsDocType;
    }
    /**
     * Runs js doc setter type from column.
     * @param {import("../../../../../database/drivers/base-column.js").default} column - Column.
     * @param {typeof import("../../../../../database/record/index.js").default} modelClass - Model class owning the column (for declared attribute casts).
     * @returns {string | undefined} - The js doc setter type from column.
     */
    jsDocSetterTypeFromColumn(column, modelClass) {
        const type = modelClass.getColumnTypeByName(column.getName());
        if (type && setterStringInputColumnTypes.has(type)) {
            return "Date | string";
        }
        return this.jsDocTypeFromColumn(column, modelClass);
    }
    /**
     * Runs belongs to write attributes for model.
     * @param {object} args - Arguments.
     * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Model class.
     * @param {string} args.modelsDir - Source models directory.
     * @returns {Promise<Array<{propertyName: string, propertyType: string, relationshipName: string}>>} - Belongs-to write attributes.
     */
    async belongsToWriteAttributesForModel({ modelClass, modelsDir }) {
        const writeAttributes = [];
        for (const relationship of modelClass.getRelationships()) {
            if (relationship.getType() !== "belongsTo")
                continue;
            if (relationship.getPolymorphic())
                continue;
            const targetModelClass = relationship.getTargetModelClass();
            if (!targetModelClass)
                throw new Error(`Relationship '${relationship.getRelationshipName()}' on '${modelClass.getModelName()}' has no target model class`);
            const targetModelFileName = inflection.dasherize(inflection.underscore(targetModelClass.getModelName()));
            const targetModelPath = `${modelsDir}/${targetModelFileName}.js`;
            const targetImportPath = await fileExists(targetModelPath) ? `../models/${targetModelFileName}.js` : `./${targetModelFileName}.js`;
            writeAttributes.push({
                propertyName: relationship.getRelationshipName(),
                propertyType: `import("${targetImportPath}").default`,
                relationshipName: relationship.getRelationshipName()
            });
        }
        return writeAttributes;
    }
    /**
     * Runs nested write attributes for model.
     * @param {object} args - Arguments.
     * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Model class.
     * @returns {Array<{propertyName: string, propertyType: string, relationshipName: string}>} - Nested write attributes.
     */
    nestedWriteAttributesForModel({ modelClass }) {
        const acceptedNestedAttributes = modelClass._acceptedNestedAttributes || {};
        const nestedWriteAttributes = [];
        for (const relationshipName of Object.keys(acceptedNestedAttributes)) {
            const relationship = modelClass.getRelationshipByName(relationshipName);
            const relationshipType = relationship.getType();
            const targetModelClass = relationship.getTargetModelClass();
            if (!targetModelClass)
                throw new Error(`Relationship '${relationshipName}' on '${modelClass.getModelName()}' has no target model class`);
            const targetModelFileName = inflection.dasherize(inflection.underscore(targetModelClass.getModelName()));
            const targetWriteTypeName = `${inflection.camelize(targetModelClass.getModelName().replaceAll("-", "_"))}WriteAttributes`;
            const nestedType = `import("./${targetModelFileName}.js").${targetWriteTypeName}${acceptedNestedAttributes[relationshipName]?.allowDestroy ? " & {_destroy?: boolean}" : ""}`;
            nestedWriteAttributes.push({
                propertyName: `${relationshipName}Attributes`,
                propertyType: relationshipType == "hasMany" ? `Array<${nestedType}>` : nestedType,
                relationshipName
            });
        }
        return nestedWriteAttributes;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1tb2RlbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9zcmMvZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS9jbGkvY29tbWFuZHMvZ2VuZXJhdGUvYmFzZS1tb2RlbHMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sV0FBVyxNQUFNLG9DQUFvQyxDQUFBO0FBQzVELE9BQU8sZ0JBQWdCLE1BQU0seUNBQXlDLENBQUE7QUFDdEUsT0FBTyx5QkFBeUIsTUFBTSwrQ0FBK0MsQ0FBQTtBQUNyRixPQUFPLGdCQUFnQixNQUFNLDRDQUE0QyxDQUFBO0FBQ3pFLE9BQU8sVUFBVSxNQUFNLHFDQUFxQyxDQUFBO0FBQzVELE9BQU8sRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUM1QixPQUFPLG1CQUFtQixNQUFNLDRCQUE0QixDQUFBO0FBQzVELE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBRXhDLE1BQU0sOEJBQThCLEdBQUcsZ0NBQWdDLENBQUE7QUFFdkU7OztHQUdHO0FBQ0gsTUFBTSxxQkFBcUIsR0FBRztJQUM1QixNQUFNLEVBQUUsUUFBUTtJQUNoQixHQUFHLEVBQUUsUUFBUTtJQUNiLElBQUksRUFBRSxRQUFRO0lBQ2QsT0FBTyxFQUFFLFNBQVM7SUFDbEIsSUFBSSxFQUFFLFFBQVE7SUFDZCxtQkFBbUIsRUFBRSxRQUFRO0lBQzdCLElBQUksRUFBRSxNQUFNO0lBQ1osUUFBUSxFQUFFLE1BQU07SUFDaEIsT0FBTyxFQUFFLFFBQVE7SUFDakIsS0FBSyxFQUFFLFFBQVE7SUFDZixHQUFHLEVBQUUsUUFBUTtJQUNiLE9BQU8sRUFBRSxRQUFRO0lBQ2pCLElBQUksRUFBRSx5QkFBeUI7SUFDL0IsUUFBUSxFQUFFLFFBQVE7SUFDbEIsVUFBVSxFQUFFLFFBQVE7SUFDcEIsT0FBTyxFQUFFLFFBQVE7SUFDakIsUUFBUSxFQUFFLFFBQVE7SUFDbEIsUUFBUSxFQUFF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QVUsR0FBRyxDQUFDLENBQUMsQ0FBQyxVQUFVO2dCQUNqRixnQkFBZ0I7YUFDakIsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELE9BQU8scUJBQXFCLENBQUE7SUFDOUIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgY29tbWFuZEFyZ3VtZW50cyBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY2xpL2NvbW1hbmQtYXJndW1lbnRzLmpzXCJcbmltcG9ydCBEYXRhYmFzZUdlbmVyYXRpb25Db250ZXh0IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9nZW5lcmF0aW9uLWNvbnRleHQuanNcIlxuaW1wb3J0IGRlYnVyckNvbHVtbk5hbWUgZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3V0aWxzL2RlYnVyci1jb2x1bW4tbmFtZS5qc1wiXG5pbXBvcnQgZmlsZUV4aXN0cyBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vdXRpbHMvZmlsZS1leGlzdHMuanNcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgZ2VuZXJhdGVkRmlsZUJhbm5lciBmcm9tIFwiLi9nZW5lcmF0ZWQtZmlsZS1iYW5uZXIuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5cbmNvbnN0IEJBU0VfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORCA9IFwidmVsb2Npb3VzIGdlbmVyYXRlOmJhc2UtbW9kZWxzXCJcblxuLyoqXG4gKiBNYXBzIGFuIGVmZmVjdGl2ZSBjb2x1bW4gdHlwZSB0byB0aGUgSlNEb2MgdHlwZSB1c2VkIGluIGdlbmVyYXRlZCBiYXNlIG1vZGVscy5cbiAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fVxuICovXG5jb25zdCBqc0RvY1R5cGVCeUNvbHVtblR5cGUgPSB7XG4gIGJpZ2ludDogXCJudW1iZXJcIixcbiAgYml0OiBcIm51bWJlclwiLFxuICBibG9iOiBcInN0cmluZ1wiLFxuICBib29sZWFuOiBcImJvb2xlYW5cIixcbiAgY2hhcjogXCJzdHJpbmdcIixcbiAgXCJjaGFyYWN0ZXIgdmFyeWluZ1wiOiBcInN0cmluZ1wiLFxuICBkYXRlOiBcIkRhdGVcIixcbiAgZGF0ZXRpbWU6IFwiRGF0ZVwiLFxuICBkZWNpbWFsOiBcIm51bWJlclwiLFxuICBmbG9hdDogXCJudW1iZXJcIixcbiAgaW50OiBcIm51bWJlclwiLFxuICBpbnRlZ2VyOiBcIm51bWJlclwiLFxuICBqc29uOiBcIlJlY29yZDxzdHJpbmcsIHVua25vd24+XCIsXG4gIGxvbmd0ZXh0OiBcInN0cmluZ1wiLFxuICBtZWRpdW10ZXh0OiBcInN0cmluZ1wiLFxuICBudW1lcmljOiBcIm51bWJlclwiLFxuICBudmFyY2hhcjogXCJzdHJpbmdcIixcbiAgc21hbGxpbnQ6IFwibnVtYmVyXCIsXG4gIHRleHQ6IFwic3RyaW5nXCIsXG4gIFwidGltZXN0YW1wIHdpdGhvdXQgdGltZSB6b25lXCI6IFwiRGF0ZVwiLFxuICB0aW55aW50OiBcIm51bWJlclwiLFxuICB0aW55dGV4dDogXCJzdHJpbmdcIixcbiAgdXVpZDogXCJzdHJpbmdcIixcbiAgdmFyY2hhcjogXCJzdHJpbmdcIlxufVxuXG4vKiogRWZmZWN0aXZlIGNvbHVtbiB0eXBlcyB3aG9zZSBnZW5lcmF0ZWQgc2V0dGVyIGFkZGl0aW9uYWxseSBhY2NlcHRzIGEgc3RyaW5nLiAqL1xuY29uc3Qgc2V0dGVyU3RyaW5nSW5wdXRDb2x1bW5UeXBlcyA9IG5ldyBTZXQoW1wiZGF0ZVwiLCBcImRhdGV0aW1lXCIsIFwidGltZXN0YW1wIHdpdGhvdXQgdGltZSB6b25lXCJdKVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhIGJhc2UtbW9kZWwgcmVsYXRpb25zaGlwIG1ldGhvZC5cbiAqIEBwYXJhbSB7e2Fic3RyYWN0PzogYm9vbGVhbiwgYm9keTogc3RyaW5nLCBuYW1lOiBzdHJpbmcsIHBhcmFtPzoge25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfSwgcmV0dXJuczogc3RyaW5nfX0gYXJncyAtIE1ldGhvZCBwYXJ0cy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gR2VuZXJhdGVkIG1ldGhvZCBzb3VyY2UuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlZFJlbGF0aW9uc2hpcE1ldGhvZCh7YWJzdHJhY3QgPSBmYWxzZSwgYm9keSwgbmFtZSwgcGFyYW0sIHJldHVybnN9KSB7XG4gIGxldCBmaWxlQ29udGVudCA9IFwiICAvKipcXG5cIlxuXG4gIGlmIChhYnN0cmFjdCkgZmlsZUNvbnRlbnQgKz0gXCIgICAqIEBhYnN0cmFjdFxcblwiXG4gIGlmIChwYXJhbSkgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHske3BhcmFtLnR5cGV9fSAke3BhcmFtLm5hbWV9XFxuYFxuICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7JHtyZXR1cm5zfX1cXG5gXG4gIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICBmaWxlQ29udGVudCArPSBgICAke25hbWV9KCR7cGFyYW0gPyBwYXJhbS5uYW1lIDogXCJcIn0pIHsgJHtib2R5fSB9XFxuYFxuXG4gIHJldHVybiBmaWxlQ29udGVudFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBEYkdlbmVyYXRlTW9kZWwgZXh0ZW5kcyBCYXNlQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgcGFyc2VkQXJndW1lbnRzID0gY29tbWFuZEFyZ3VtZW50cyh7XG4gICAgICBkZWZpbml0aW9uOiB7XG4gICAgICAgIGJvb2xlYW5PcHRpb25zOiBbXCItLWFsbG93LW1pc3NpbmctdGFibGVzXCJdLFxuICAgICAgICB2YWx1ZU9wdGlvbnM6IFtcIi0tdGVuYW50XCJdXG4gICAgICB9LFxuICAgICAgcHJvY2Vzc0FyZ3M6IHRoaXMucHJvY2Vzc0FyZ3MgfHwgW11cbiAgICB9KVxuICAgIGNvbnN0IGFsbG93TWlzc2luZ1RhYmxlcyA9IHBhcnNlZEFyZ3VtZW50c1tcImFsbG93LW1pc3NpbmctdGFibGVzXCJdID09PSB0cnVlXG4gICAgY29uc3QgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyID0gcGFyc2VkQXJndW1lbnRzLnRlbmFudFxuXG4gICAgaWYgKHR5cGVvZiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCBEYXRhYmFzZUdlbmVyYXRpb25Db250ZXh0LnJlc29sdmUoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJcbiAgICAgIH0pXG4gICAgICBjb25zdCBzZWxlY3RlZE1vZGVsQ2xhc3NlcyA9IE9iamVjdC52YWx1ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0TW9kZWxDbGFzc2VzKCkpLmZpbHRlcigobW9kZWxDbGFzcykgPT4ge1xuICAgICAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7XG4gICAgICAgICAgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGU6IGZhbHNlLFxuICAgICAgICAgIHRlbmFudDogY29udGV4dC50ZW5hbnQoKVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChkYXRhYmFzZUlkZW50aWZpZXIgIT09IGNvbnRleHQuZGF0YWJhc2VJZGVudGlmaWVyKCkpIHJldHVybiBmYWxzZVxuXG4gICAgICAgIHJldHVybiBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiBjb250ZXh0LnRlbmFudCgpfSkgPT09IGNvbnRleHQuZGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjb250ZXh0LnJ1bih7bmFtZTogXCJHZW5lcmF0ZSBzZWxlY3RlZCB0ZW5hbnQgYmFzZSBtb2RlbHNcIiwgY2FsbGJhY2s6IGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5nZW5lcmF0ZUJhc2VNb2RlbHMoe2FsbG93TWlzc2luZ1RhYmxlcywgY29ubmVjdGlvbnM6IHtbY29udGV4dC5kYXRhYmFzZUlkZW50aWZpZXIoKV06IGNvbm5lY3Rpb259LCBjb250ZXh0fSlcbiAgICAgICAgfX0pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2Ygc2VsZWN0ZWRNb2RlbENsYXNzZXMpIG1vZGVsQ2xhc3MucmVzZXRSZWNvcmRNZXRhZGF0YSgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuaW5pdGlhbGl6ZU1vZGVscygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiR2VuZXJhdGUgYmFzZSBtb2RlbHNcIn0sIGFzeW5jIChjb25uZWN0aW9ucykgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5nZW5lcmF0ZUJhc2VNb2RlbHMoe2FsbG93TWlzc2luZ1RhYmxlcywgY29ubmVjdGlvbnN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogR2VuZXJhdGVzIG1vZGVsIGJhc2VzIGZyb20gZXhwbGljaXQgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gR2VuZXJhdGlvbiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5hbGxvd01pc3NpbmdUYWJsZXMgLSBXaGV0aGVyIGFic2VudCB0YWJsZXMgYXJlIHNraXBwZWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBhcmdzLmNvbm5lY3Rpb25zIC0gQ29ubmVjdGlvbnMga2V5ZWQgYnkgbG9naWNhbCBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge0RhdGFiYXNlR2VuZXJhdGlvbkNvbnRleHR9IFthcmdzLmNvbnRleHRdIC0gU2VsZWN0ZWQgdGVuYW50IGRhdGFiYXNlIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHdyaXRpbmcgZ2VuZXJhdGVkIGJhc2VzLlxuICAgKi9cbiAgYXN5bmMgZ2VuZXJhdGVCYXNlTW9kZWxzKHthbGxvd01pc3NpbmdUYWJsZXMsIGNvbm5lY3Rpb25zLCBjb250ZXh0fSkge1xuICAgIGNvbnN0IHJvb3REaXJlY3RvcnkgPSB0aGlzLmRpcmVjdG9yeSgpXG4gICAgY29uc3QgbW9kZWxzRGlyID0gYCR7cm9vdERpcmVjdG9yeX0vc3JjL21vZGVsc2BcbiAgICBjb25zdCBiYXNlTW9kZWxzRGlyID0gYCR7cm9vdERpcmVjdG9yeX0vc3JjL21vZGVsLWJhc2VzYFxuICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgcmVnZW5lcmF0ZUNvbW1hbmQgPSBjb250ZXh0XG4gICAgICA/IGAke0JBU0VfTU9ERUxTX1JFR0VORVJBVEVfQ09NTUFORH0gLS10ZW5hbnQgJHtjb250ZXh0LmRhdGFiYXNlSWRlbnRpZmllcigpfWBcbiAgICAgIDogQkFTRV9NT0RFTFNfUkVHRU5FUkFURV9DT01NQU5EXG4gICAgbGV0IGRldk1vZGUgPSBmYWxzZVxuXG4gICAgaWYgKGJhc2VNb2RlbHNEaXIuaW5jbHVkZXMoXCIvc3BlYy9kdW1teS9zcmMvbW9kZWwtYmFzZXNcIikpIHtcbiAgICAgIGRldk1vZGUgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFhd2FpdCBmaWxlRXhpc3RzKGJhc2VNb2RlbHNEaXIpKSB7XG4gICAgICBhd2FpdCBmcy5ta2RpcihiYXNlTW9kZWxzRGlyLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3NOYW1lIGluIG1vZGVsQ2xhc3Nlcykge1xuICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gbW9kZWxDbGFzc2VzW21vZGVsQ2xhc3NOYW1lXVxuICAgICAgICBsZXQgZGF0YWJhc2VJZGVudGlmaWVyXG5cbiAgICAgICAgaWYgKGNvbnRleHQpIHtcbiAgICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7XG4gICAgICAgICAgICBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZTogZmFsc2UsXG4gICAgICAgICAgICB0ZW5hbnQ6IGNvbnRleHQudGVuYW50KClcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllciAhPT0gY29udGV4dC5kYXRhYmFzZUlkZW50aWZpZXIoKSkgY29udGludWVcblxuICAgICAgICAgIGRhdGFiYXNlSWRlbnRpZmllciA9IG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHt0ZW5hbnQ6IGNvbnRleHQudGVuYW50KCl9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRhdGFiYXNlSWRlbnRpZmllciA9IG1vZGVsQ2xhc3MuZ2V0Q29uZmlndXJlZERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29udGV4dCAmJiBkYXRhYmFzZUlkZW50aWZpZXIgIT09IGNvbnRleHQuZGF0YWJhc2VJZGVudGlmaWVyKCkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGNvbm5lY3Rpb25zW2RhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgICAgICAvLyBEZWZhdWx0IGdlbmVyYXRpb24gY29udGludWVzIHRvIGlnbm9yZSBpbmFjdGl2ZSB0ZW5hbnQtb25seSBpZGVudGlmaWVycy5cbiAgICAgICAgaWYgKCFjb25uZWN0aW9uKSBjb250aW51ZVxuXG4gICAgICAgIGlmIChjb250ZXh0KSBtb2RlbENsYXNzLnJlc2V0UmVjb3JkTWV0YWRhdGEoKVxuXG4gICAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgY29ubmVjdGlvbi5nZXRUYWJsZUJ5TmFtZShtb2RlbENsYXNzLnRhYmxlTmFtZSgpLCB7dGhyb3dFcnJvcjogIWFsbG93TWlzc2luZ1RhYmxlc30pXG5cbiAgICAgICAgaWYgKCF0YWJsZSkge1xuICAgICAgICAgIGNvbnNvbGUud2FybihgU2tpcHBpbmcgYmFzZSBtb2RlbCBmb3IgJyR7bW9kZWxDbGFzcy5uYW1lfSc6IHRhYmxlICcke21vZGVsQ2xhc3MudGFibGVOYW1lKCl9JyB3YXMgbm90IGZvdW5kICgtLWFsbG93LW1pc3NpbmctdGFibGVzKS4gS2VlcGluZyBhbnkgZXhpc3RpbmcgYmFzZSBtb2RlbC5gKVxuXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IG1vZGVsQ2xhc3MuZW5zdXJlSW5pdGlhbGl6ZWQoe2NvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLCBjb25uZWN0aW9ufSlcblxuICAgICAgICBjb25zdCBtb2RlbE5hbWUgPSBpbmZsZWN0aW9uLmRhc2hlcml6ZShtb2RlbENsYXNzTmFtZSlcbiAgICAgICAgY29uc3QgbW9kZWxOYW1lQ2FtZWxpemVkID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtb2RlbE5hbWUucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpKVxuICAgICAgICBjb25zdCBtb2RlbEJhc2VGaWxlTmFtZSA9IGAke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShtb2RlbE5hbWUpKX0uanNgXG4gICAgICAgIGNvbnN0IG1vZGVsUGF0aCA9IGAke2Jhc2VNb2RlbHNEaXJ9LyR7bW9kZWxCYXNlRmlsZU5hbWV9YFxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBjcmVhdGUgc3JjL21vZGVsLWJhc2VzLyR7bW9kZWxCYXNlRmlsZU5hbWV9YClcblxuICAgICAgICBjb25zdCBzb3VyY2VNb2RlbEZ1bGxGaWxlUGF0aCA9IGAke21vZGVsc0Rpcn0vJHttb2RlbEJhc2VGaWxlTmFtZX1gXG4gICAgICAgIGxldCBzb3VyY2VNb2RlbEZpbGVQYXRoXG5cbiAgICAgICAgaWYgKGF3YWl0IGZpbGVFeGlzdHMoc291cmNlTW9kZWxGdWxsRmlsZVBhdGgpKSB7XG4gICAgICAgICAgc291cmNlTW9kZWxGaWxlUGF0aCA9IGAuLi9tb2RlbHMvJHttb2RlbEJhc2VGaWxlTmFtZX1gXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc291cmNlTW9kZWxGaWxlUGF0aCA9IFwidmVsb2Npb3VzL2J1aWxkL3NyYy9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIlxuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGZpbGVDb250ZW50ID0gZ2VuZXJhdGVkRmlsZUJhbm5lcihyZWdlbmVyYXRlQ29tbWFuZClcbiAgICAgICAgbGV0IHZlbG9jaW91c1BhdGhcblxuICAgICAgICBpZiAoZGV2TW9kZSkge1xuICAgICAgICAgIHZlbG9jaW91c1BhdGggPSBcIi4uLy4uLy4uLy4uL3NyY1wiXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmVsb2Npb3VzUGF0aCA9IFwidmVsb2Npb3VzL2J1aWxkL3NyY1wiXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb2x1bW5zID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1ucygpXG4gICAgICAgIGNvbnN0IHdyaXRlQXR0cmlidXRlVHlwZU5hbWUgPSBgJHttb2RlbE5hbWVDYW1lbGl6ZWR9V3JpdGVBdHRyaWJ1dGVzYFxuICAgICAgICBjb25zdCBiZWxvbmdzVG9Xcml0ZUF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLmJlbG9uZ3NUb1dyaXRlQXR0cmlidXRlc0Zvck1vZGVsKHttb2RlbENsYXNzLCBtb2RlbHNEaXJ9KVxuICAgICAgICBjb25zdCBuZXN0ZWRXcml0ZUF0dHJpYnV0ZXMgPSB0aGlzLm5lc3RlZFdyaXRlQXR0cmlidXRlc0Zvck1vZGVsKHttb2RlbENsYXNzfSlcblxuICAgICAgICBmaWxlQ29udGVudCArPSBgaW1wb3J0IERhdGFiYXNlUmVjb3JkIGZyb20gXCIke3ZlbG9jaW91c1BhdGh9L2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiXFxuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIi8qKlxcblwiXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBBdHRyaWJ1dGVzIGFjY2VwdGVkIHdoZW4gY3JlYXRpbmcgb3IgdXBkYXRpbmcgJHttb2RlbE5hbWVDYW1lbGl6ZWR9IHJlY29yZHMuXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICogQHR5cGVkZWYge29iamVjdH0gJHt3cml0ZUF0dHJpYnV0ZVR5cGVOYW1lfVxcbmBcbiAgICAgICAgZm9yIChjb25zdCBjb2x1bW4gb2YgY29sdW1ucykge1xuICAgICAgICAgIGNvbnN0IGRlYnVycmVkQ29sdW1uTmFtZSA9IGRlYnVyckNvbHVtbk5hbWUoY29sdW1uLmdldE5hbWUoKSlcbiAgICAgICAgICBjb25zdCBjYW1lbGl6ZWRDb2x1bW5OYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShkZWJ1cnJlZENvbHVtbk5hbWUsIHRydWUpXG4gICAgICAgICAgY29uc3Qgc2V0dGVySnNkb2NUeXBlID0gdGhpcy5qc0RvY1NldHRlclR5cGVGcm9tQ29sdW1uKGNvbHVtbiwgbW9kZWxDbGFzcylcblxuICAgICAgICAgIGlmIChzZXR0ZXJKc2RvY1R5cGUpIHtcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAcHJvcGVydHkgeyR7c2V0dGVySnNkb2NUeXBlfSR7Y29sdW1uLmdldE51bGwoKSA/IFwiIHwgbnVsbFwiIDogXCJcIn19IFske2NhbWVsaXplZENvbHVtbk5hbWV9XSAtIFZhbHVlIGZvciB0aGUgJHtjYW1lbGl6ZWRDb2x1bW5OYW1lfSBhdHRyaWJ1dGUuXFxuYFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGJlbG9uZ3NUb1dyaXRlQXR0cmlidXRlIG9mIGJlbG9uZ3NUb1dyaXRlQXR0cmlidXRlcykge1xuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAcHJvcGVydHkgeyR7YmVsb25nc1RvV3JpdGVBdHRyaWJ1dGUucHJvcGVydHlUeXBlfX0gWyR7YmVsb25nc1RvV3JpdGVBdHRyaWJ1dGUucHJvcGVydHlOYW1lfV0gLSBSZWxhdGVkICR7YmVsb25nc1RvV3JpdGVBdHRyaWJ1dGUucmVsYXRpb25zaGlwTmFtZX0gcmVjb3JkLlxcbmBcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IG5lc3RlZFdyaXRlQXR0cmlidXRlIG9mIG5lc3RlZFdyaXRlQXR0cmlidXRlcykge1xuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgKiBAcHJvcGVydHkgeyR7bmVzdGVkV3JpdGVBdHRyaWJ1dGUucHJvcGVydHlUeXBlfX0gWyR7bmVzdGVkV3JpdGVBdHRyaWJ1dGUucHJvcGVydHlOYW1lfV0gLSBOZXN0ZWQgJHtuZXN0ZWRXcml0ZUF0dHJpYnV0ZS5yZWxhdGlvbnNoaXBOYW1lfSBhdHRyaWJ1dGVzLlxcbmBcbiAgICAgICAgfVxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAqL1xcblxcblwiXG5cbiAgICAgICAgY29uc3QgaGFzTWFueVJlbGF0aW9uRmlsZVBhdGggPSBgJHt2ZWxvY2lvdXNQYXRofS9kYXRhYmFzZS9yZWNvcmQvaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9oYXMtbWFueS5qc2BcblxuICAgICAgICBmaWxlQ29udGVudCArPSBgLyoqIEBhdWdtZW50cyB7RGF0YWJhc2VSZWNvcmQ8JHt3cml0ZUF0dHJpYnV0ZVR5cGVOYW1lfT59ICovXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBgZXhwb3J0IGRlZmF1bHQgY2xhc3MgJHttb2RlbE5hbWVDYW1lbGl6ZWR9QmFzZSBleHRlbmRzIERhdGFiYXNlUmVjb3JkIHtcXG5gXG5cbiAgICAgIC8vIC0tLSBnZXRNb2RlbENsYXNzKCkgb3ZlcnJpZGUgKGZpeGVzIHBvbHltb3JwaGljIHR5cGluZyBpbiBKUy9KU0RvYykgLS0tXG4gICAgICBpZiAoYXdhaXQgZmlsZUV4aXN0cyhzb3VyY2VNb2RlbEZ1bGxGaWxlUGF0aCkpIHtcbiAgICAgICAgLy8gTW9kZWwgZmlsZSBleGlzdHMgKGUuZy4gc3JjL21vZGVscy90aWNrZXQuanMpIOKGkiByZXR1cm4gdHlwZW9mIFRpY2tldFxuICAgICAgICBmaWxlQ29udGVudCArPSBgICAvKiogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIke3NvdXJjZU1vZGVsRmlsZVBhdGh9XCIpLmRlZmF1bHR9ICovXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLy8gQHRzLWlnbm9yZSAtIG92ZXJyaWRlIG5hcnJvd3MgcmV0dXJuIHR5cGUgZm9yIGJldHRlciBJbnRlbGxpU2Vuc2UgaW4gZ2VuZXJhdGVkIG1vZGVsIGJhc2VzXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgZ2V0TW9kZWxDbGFzcygpIHsgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIiR7c291cmNlTW9kZWxGaWxlUGF0aH1cIikuZGVmYXVsdH0gKi8gKHRoaXMuY29uc3RydWN0b3IpIH1cXG5cXG5gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBObyBtb2RlbCBmaWxlIHlldCDihpIgZmFsbCBiYWNrIHRvIHR5cGVvZiBUaWNrZXRCYXNlXG4gICAgICAgIGZpbGVDb250ZW50ICs9IGAgIC8qKiBAcmV0dXJucyB7dHlwZW9mICR7bW9kZWxOYW1lQ2FtZWxpemVkfUJhc2V9ICovXFxuYFxuICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLy8gQHRzLWlnbm9yZSAtIG92ZXJyaWRlIG5hcnJvd3MgcmV0dXJuIHR5cGUgZm9yIGJldHRlciBJbnRlbGxpU2Vuc2UgaW4gZ2VuZXJhdGVkIG1vZGVsIGJhc2VzXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgZ2V0TW9kZWxDbGFzcygpIHsgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mICR7bW9kZWxOYW1lQ2FtZWxpemVkfUJhc2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKSB9XFxuXFxuYFxuICAgICAgfVxuXG4gICAgICBsZXQgbWV0aG9kc0NvdW50ID0gMFxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiBjb2x1bW5zKSB7XG4gICAgICAgIGNvbnN0IGRlYnVycmVkQ29sdW1uTmFtZSA9IGRlYnVyckNvbHVtbk5hbWUoY29sdW1uLmdldE5hbWUoKSlcbiAgICAgICAgY29uc3QgY2FtZWxpemVkQ29sdW1uTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyZWRDb2x1bW5OYW1lLCB0cnVlKVxuICAgICAgICBjb25zdCBjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3QgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGRlYnVycmVkQ29sdW1uTmFtZSlcbiAgICAgICAgY29uc3QganNkb2NUeXBlID0gdGhpcy5qc0RvY1R5cGVGcm9tQ29sdW1uKGNvbHVtbiwgbW9kZWxDbGFzcylcblxuICAgICAgICBpZiAobWV0aG9kc0NvdW50ID4gMCkge1xuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChqc2RvY1R5cGUpIHtcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAvKiogQHJldHVybnMgeyR7anNkb2NUeXBlfSR7Y29sdW1uLmdldE51bGwoKSA/IFwiIHwgbnVsbFwiIDogXCJcIn19ICovXFxuYFxuICAgICAgICB9XG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtjYW1lbGl6ZWRDb2x1bW5OYW1lfSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcIiR7Y2FtZWxpemVkQ29sdW1uTmFtZX1cIikgfVxcblxcbmBcblxuICAgICAgICBjb25zdCBzZXR0ZXJKc2RvY1R5cGUgPSB0aGlzLmpzRG9jU2V0dGVyVHlwZUZyb21Db2x1bW4oY29sdW1uLCBtb2RlbENsYXNzKVxuXG4gICAgICAgIGlmIChzZXR0ZXJKc2RvY1R5cGUpIHtcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0geyR7c2V0dGVySnNkb2NUeXBlfSR7Y29sdW1uLmdldE51bGwoKSA/IFwiIHwgbnVsbFwiIDogXCJcIn19IG5ld1ZhbHVlXFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAcmV0dXJucyB7dm9pZH1cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICB9XG5cbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgc2V0JHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9KG5ld1ZhbHVlKSB7IHJldHVybiB0aGlzLl9zZXRDb2x1bW5BdHRyaWJ1dGUoXCIke2NhbWVsaXplZENvbHVtbk5hbWV9XCIsIG5ld1ZhbHVlKSB9XFxuXFxuYFxuXG4gICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKiogQHJldHVybnMge2Jvb2xlYW59ICovXFxuXCJcbiAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgaGFzJHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9KCkgeyByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHRoaXMuJHtjYW1lbGl6ZWRDb2x1bW5OYW1lfSgpKSB9XFxuYFxuXG4gICAgICAgIG1ldGhvZHNDb3VudCsrXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobW9kZWxDbGFzcywgXCJfdHJhbnNsYXRpb25zXCIpICYmIG1vZGVsQ2xhc3MuX3RyYW5zbGF0aW9ucyAmJiBPYmplY3Qua2V5cyhtb2RlbENsYXNzLl90cmFuc2xhdGlvbnMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgVHJhbnNsYXRpb25DbGFzcyA9IG1vZGVsQ2xhc3MuZ2V0VHJhbnNsYXRpb25DbGFzcygpXG4gICAgICAgIGNvbnN0IHRyYW5zbGF0aW9uQ29sdW1ucyA9IFRyYW5zbGF0aW9uQ2xhc3MuZ2V0Q29sdW1ucygpXG5cbiAgICAgICAgZm9yIChjb25zdCBuYW1lIGluIG1vZGVsQ2xhc3MuX3RyYW5zbGF0aW9ucykge1xuICAgICAgICAgIGNvbnN0IG5hbWVVbmRlcnNjb3JlID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKG5hbWUpXG4gICAgICAgICAgY29uc3QgY29sdW1uID0gdHJhbnNsYXRpb25Db2x1bW5zLmZpbmQoKHRyYW5zbGF0aW9uQ29sdW1uKSA9PiB0cmFuc2xhdGlvbkNvbHVtbi5nZXROYW1lKCkgPT09IG5hbWVVbmRlcnNjb3JlKVxuICAgICAgICAgIGxldCB0cmFuc2xhdGlvbkpzZG9jVHlwZVxuXG4gICAgICAgICAgaWYgKGNvbHVtbikge1xuICAgICAgICAgICAgdHJhbnNsYXRpb25Kc2RvY1R5cGUgPSB0aGlzLmpzRG9jVHlwZUZyb21Db2x1bW4oY29sdW1uLCBUcmFuc2xhdGlvbkNsYXNzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0cmFuc2xhdGlvbkpzZG9jVHlwZSAmJiBjb2x1bW4pIHtcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGBcXG5gXG4gICAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHske3RyYW5zbGF0aW9uSnNkb2NUeXBlfSR7Y29sdW1uLmdldE51bGwoKSA/IFwiIHwgbnVsbFwiIDogXCJcIn19XFxuYFxuICAgICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtuYW1lfSgpIHsgcmV0dXJuIHRoaXMuX2dldFRyYW5zbGF0ZWRBdHRyaWJ1dGVXaXRoRmFsbGJhY2soXCIke25hbWV9XCIsIHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRMb2NhbGUoKSkgPz8gbnVsbCB9XFxuYFxuICAgICAgICAgIG1ldGhvZHNDb3VudCsrXG5cbiAgICAgICAgICBjb25zdCBoYXNOYW1lID0gYGhhcyR7aW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKX1gXG4gICAgICAgICAgY29uc3Qgc2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUobmFtZSl9YFxuICAgICAgICAgIGNvbnN0IHNldHRlclBhcmFtVHlwZSA9IHRyYW5zbGF0aW9uSnNkb2NUeXBlIHx8IFwiP1wiXG5cbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgXFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEBhYnN0cmFjdFxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn1cXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtoYXNOYW1lfSgpIHsgdGhyb3cgbmV3IEVycm9yKFwiJHtoYXNOYW1lfSBub3QgaW1wbGVtZW50ZWRcIikgfVxcbmBcbiAgICAgICAgICBtZXRob2RzQ291bnQrK1xuXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYFxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0geyR7c2V0dGVyUGFyYW1UeXBlfX0gbmV3VmFsdWVcXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge3ZvaWR9XFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7c2V0dGVyTmFtZX0obmV3VmFsdWUpIHsgcmV0dXJuIHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUoXCIke25hbWV9XCIsIHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRMb2NhbGUoKSwgbmV3VmFsdWUpIH1cXG5gXG4gICAgICAgICAgbWV0aG9kc0NvdW50KytcblxuICAgICAgICAgIGZvciAoY29uc3QgbG9jYWxlIG9mIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldExvY2FsZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgbG9jYWxlTWV0aG9kTmFtZSA9IGAke25hbWV9JHtpbmZsZWN0aW9uLmNhbWVsaXplKGxvY2FsZSl9YFxuXG4gICAgICAgICAgICBpZiAodHJhbnNsYXRpb25Kc2RvY1R5cGUgJiYgY29sdW1uKSB7XG4gICAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGBcXG5gXG4gICAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7JHt0cmFuc2xhdGlvbkpzZG9jVHlwZX0ke2NvbHVtbi5nZXROdWxsKCkgPyBcIiB8IG51bGxcIiA6IFwiXCJ9fVxcbmBcbiAgICAgICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7bG9jYWxlTWV0aG9kTmFtZX0oKSB7IHJldHVybiB0aGlzLl9nZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aEZhbGxiYWNrKFwiJHtuYW1lfVwiLCBcIiR7bG9jYWxlfVwiKSA/PyBudWxsIH1cXG5gXG4gICAgICAgICAgICBtZXRob2RzQ291bnQrK1xuXG4gICAgICAgICAgICBjb25zdCBsb2NhbGVTZXR0ZXJOYW1lID0gYCR7c2V0dGVyTmFtZX0ke2luZmxlY3Rpb24uY2FtZWxpemUobG9jYWxlKX1gXG5cbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGBcXG5gXG4gICAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEBwYXJhbSB7JHtzZXR0ZXJQYXJhbVR5cGV9fSBuZXdWYWx1ZVxcbmBcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHt2b2lkfVxcbmBcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtsb2NhbGVTZXR0ZXJOYW1lfShuZXdWYWx1ZSkgeyByZXR1cm4gdGhpcy5fc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShcIiR7bmFtZX1cIiwgXCIke2xvY2FsZX1cIiwgbmV3VmFsdWUpIH1cXG5gXG4gICAgICAgICAgICBtZXRob2RzQ291bnQrK1xuXG4gICAgICAgICAgICBjb25zdCBsb2NhbGVIYXNOYW1lID0gYGhhcyR7aW5mbGVjdGlvbi5jYW1lbGl6ZShsb2NhbGVNZXRob2ROYW1lKX1gXG5cbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGBcXG5gXG4gICAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEBhYnN0cmFjdFxcbmBcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtib29sZWFufVxcbmBcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtsb2NhbGVIYXNOYW1lfSgpIHsgdGhyb3cgbmV3IEVycm9yKFwiJHtsb2NhbGVIYXNOYW1lfSBub3QgaW1wbGVtZW50ZWRcIikgfVxcbmBcbiAgICAgICAgICAgIG1ldGhvZHNDb3VudCsrXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwcygpKSB7XG4gICAgICAgIGxldCBiYXNlRmlsZVBhdGgsIGJhc2VGdWxsRmlsZVBhdGgsIGZpbGVOYW1lLCBmdWxsRmlsZVBhdGhcbiAgICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICBpZiAodGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgICAgIGZpbGVOYW1lID0gaW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKHRhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpKVxuICAgICAgICAgIGZ1bGxGaWxlUGF0aCA9IGBzcmMvbW9kZWxzLyR7ZmlsZU5hbWV9LmpzYFxuICAgICAgICAgIGJhc2VGaWxlUGF0aCA9IGAuLi9tb2RlbC1iYXNlcy8ke2ZpbGVOYW1lfS5qc2BcbiAgICAgICAgICBiYXNlRnVsbEZpbGVQYXRoID0gYHNyYy9tb2RlbC1iYXNlcy8ke2ZpbGVOYW1lfS5qc2BcbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMoKSkge1xuICAgICAgICAgIGZpbGVOYW1lID0gXCJ2ZWxvY2lvdXMvYnVpbGQvc3JjL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0nIG9uICcke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9JyBoYXMgbm8gdGFyZ2V0IG1vZGVsIGNsYXNzYClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChtZXRob2RzQ291bnQgPiAwKSB7XG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJiZWxvbmdzVG9cIiB8fCByZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiaGFzT25lXCIpIHtcbiAgICAgICAgICBsZXQgbW9kZWxGaWxlUGF0aFxuXG4gICAgICAgICAgaWYgKGZ1bGxGaWxlUGF0aCAmJiBhd2FpdCBmaWxlRXhpc3RzKGZ1bGxGaWxlUGF0aCkpIHtcbiAgICAgICAgICAgIG1vZGVsRmlsZVBhdGggPSBgLi4vbW9kZWxzLyR7ZmlsZU5hbWV9LmpzYFxuICAgICAgICAgIH0gZWxzZSBpZiAoYmFzZUZ1bGxGaWxlUGF0aCAmJiBhd2FpdCBmaWxlRXhpc3RzKGJhc2VGdWxsRmlsZVBhdGgpKSB7XG4gICAgICAgICAgICBtb2RlbEZpbGVQYXRoID0gYmFzZUZpbGVQYXRoXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG1vZGVsRmlsZVBhdGggPSBcInZlbG9jaW91cy9idWlsZC9zcmMvZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCJcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiJHttb2RlbEZpbGVQYXRofVwiKS5kZWZhdWx0fVxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAke3JlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9KCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIke21vZGVsRmlsZVBhdGh9XCIpLmRlZmF1bHR9ICovICh0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcIiR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX1cIikubG9hZGVkKCkpIH1cXG5gXG5cbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqIEBhYnN0cmFjdFxcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHtDb25zdHJ1Y3RvclBhcmFtZXRlcnM8dHlwZW9mIGltcG9ydChcIiR7bW9kZWxGaWxlUGF0aH1cIikuZGVmYXVsdD5bMF19IFthdHRyaWJ1dGVzXVxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiJHttb2RlbEZpbGVQYXRofVwiKS5kZWZhdWx0fVxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICBidWlsZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKX0oYXR0cmlidXRlcykgeyB2b2lkIGF0dHJpYnV0ZXM7IHRocm93IG5ldyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZFwiKSB9XFxuYFxuXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAYWJzdHJhY3RcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIiR7bW9kZWxGaWxlUGF0aH1cIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59XFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgIGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSl9KCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWRcIikgfVxcbmBcblxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIke21vZGVsRmlsZVBhdGh9XCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fVxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAke3JlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9T3JMb2FkKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIiR7bW9kZWxGaWxlUGF0aH1cIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59ICovICh0aGlzLnJlbGF0aW9uc2hpcE9yTG9hZChcIiR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX1cIikpIH1cXG5gXG5cbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqIEBhYnN0cmFjdFxcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHBhcmFtIHtpbXBvcnQoXCIke21vZGVsRmlsZVBhdGh9XCIpLmRlZmF1bHR9IG5ld01vZGVsXFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHt2b2lkfVxcbmBcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSl9KG5ld01vZGVsKSB7IHZvaWQgbmV3TW9kZWw7IHRocm93IG5ldyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZFwiKSB9XFxuYFxuICAgICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgICAgICBsZXQgcmVjb3JkSW1wb3J0XG5cbiAgICAgICAgICBpZiAoZnVsbEZpbGVQYXRoICYmIGF3YWl0IGZpbGVFeGlzdHMoZnVsbEZpbGVQYXRoKSkge1xuICAgICAgICAgICAgcmVjb3JkSW1wb3J0ID0gYC4uL21vZGVscy8ke2ZpbGVOYW1lfS5qc2BcbiAgICAgICAgICB9IGVsc2UgaWYgKGJhc2VGdWxsRmlsZVBhdGggJiYgYXdhaXQgZmlsZUV4aXN0cyhiYXNlRnVsbEZpbGVQYXRoKSkge1xuICAgICAgICAgICAgcmVjb3JkSW1wb3J0ID0gYC4uL21vZGVsLWJhc2VzLyR7ZmlsZU5hbWV9LmpzYFxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZWNvcmRJbXBvcnQgPSBgJHt2ZWxvY2lvdXNQYXRofS9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNgXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgIC8qKlxcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgICogQHJldHVybnMge2ltcG9ydChcIiR7aGFzTWFueVJlbGF0aW9uRmlsZVBhdGh9XCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIiR7c291cmNlTW9kZWxGaWxlUGF0aH1cIikuZGVmYXVsdCwgdHlwZW9mIGltcG9ydChcIiR7cmVjb3JkSW1wb3J0fVwiKS5kZWZhdWx0Pn1cXG5gXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCIgICAqL1xcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gYCAgJHtyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfSgpIHsgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiJHtoYXNNYW55UmVsYXRpb25GaWxlUGF0aH1cIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiJHtzb3VyY2VNb2RlbEZpbGVQYXRofVwiKS5kZWZhdWx0LCB0eXBlb2YgaW1wb3J0KFwiJHtyZWNvcmRJbXBvcnR9XCIpLmRlZmF1bHQ+fSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCIke3JlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9XCIpKSB9XFxuYFxuXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICAqIEByZXR1cm5zIHtBcnJheTxpbXBvcnQoXCIke3JlY29yZEltcG9ydH1cIikuZGVmYXVsdD59XFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX1Mb2FkZWQoKSB7IHJldHVybiAvKiogQHR5cGUge0FycmF5PGltcG9ydChcIiR7cmVjb3JkSW1wb3J0fVwiKS5kZWZhdWx0Pn0gKi8gKHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwiJHtyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfVwiKS5sb2FkZWQoKSkgfVxcbmBcblxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBnZW5lcmF0ZWRSZWxhdGlvbnNoaXBNZXRob2Qoe1xuICAgICAgICAgICAgYWJzdHJhY3Q6IHRydWUsXG4gICAgICAgICAgICBib2R5OiBcInRocm93IG5ldyBFcnJvcihcXFwiTm90IGltcGxlbWVudGVkXFxcIilcIixcbiAgICAgICAgICAgIG5hbWU6IGBsb2FkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpfWAsXG4gICAgICAgICAgICByZXR1cm5zOiBgUHJvbWlzZTxBcnJheTxpbXBvcnQoXCIke3JlY29yZEltcG9ydH1cIikuZGVmYXVsdD4+YFxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIlxcblwiXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gZ2VuZXJhdGVkUmVsYXRpb25zaGlwTWV0aG9kKHtcbiAgICAgICAgICAgIGJvZHk6IGByZXR1cm4gLyoqIEB0eXBlIHtQcm9taXNlPEFycmF5PGltcG9ydChcIiR7cmVjb3JkSW1wb3J0fVwiKS5kZWZhdWx0Pj59ICovICh0aGlzLnJlbGF0aW9uc2hpcE9yTG9hZChcIiR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX1cIikpYCxcbiAgICAgICAgICAgIG5hbWU6IGAke3JlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9T3JMb2FkYCxcbiAgICAgICAgICAgIHJldHVybnM6IGBQcm9taXNlPEFycmF5PGltcG9ydChcIiR7cmVjb3JkSW1wb3J0fVwiKS5kZWZhdWx0Pj5gXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICogQGFic3RyYWN0XFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIiR7cmVjb3JkSW1wb3J0fVwiKS5kZWZhdWx0Pn0gbmV3TW9kZWxzXFxuYFxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAcmV0dXJucyB7dm9pZH1cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgIHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKX0obmV3TW9kZWxzKSB7IHZvaWQgbmV3TW9kZWxzOyB0aHJvdyBuZXcgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWRcIikgfVxcbmBcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7cmVsYXRpb25zaGlwLmdldFR5cGUoKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgbWV0aG9kc0NvdW50KytcbiAgICAgIH1cblxuICAgICAgLy8gU3RhdGUtbWFjaGluZSBldmVudCBtZXRob2RzLiBgTW9kZWwuc3RhdGVNYWNoaW5lKC4uLilgIHJlZ2lzdGVycyB0aGVzZSBvbiB0aGUgbW9kZWwnc1xuICAgICAgLy8gb3duIHByb3RvdHlwZSBhdCBydW50aW1lOyB0aG9zZSBvdmVycmlkZSB0aGUgc3R1YnMgYmVsb3cgKGRlY2xhcmVkIG9uIHRoZSBiYXNlIGNsYXNzKSxcbiAgICAgIC8vIHNvIHRoZXNlIHRocm93aW5nIHN0dWJzIG5ldmVyIGV4ZWN1dGUuIFRoZXkgZXhpc3Qgb25seSBzbyBjYWxsIHNpdGVzIHR5cGVjaGVjayB3aXRob3V0XG4gICAgICAvLyB0aGUgY29uc3VtZXIgaGFuZC13cml0aW5nIGJvaWxlcnBsYXRlLiBHdWFyZGVkIG9uIHRoZSBvd24gYF9zdGF0ZU1hY2hpbmVEZWZpbml0aW9uYFxuICAgICAgLy8gcHJvcGVydHkgc28gYSBzdWJjbGFzcyB3aXRob3V0IGl0cyBvd24gbWFjaGluZSBkb2Vzbid0IHJlLWVtaXQgdGhlIHBhcmVudCdzIGV2ZW50cy5cbiAgICAgIGNvbnN0IHN0YXRlTWFjaGluZURlZmluaXRpb24gPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobW9kZWxDbGFzcywgXCJfc3RhdGVNYWNoaW5lRGVmaW5pdGlvblwiKVxuICAgICAgICA/IG1vZGVsQ2xhc3MuZ2V0U3RhdGVNYWNoaW5lRGVmaW5pdGlvbigpXG4gICAgICAgIDogbnVsbFxuXG4gICAgICBpZiAoc3RhdGVNYWNoaW5lRGVmaW5pdGlvbikge1xuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50TmFtZSBvZiBPYmplY3Qua2V5cyhzdGF0ZU1hY2hpbmVEZWZpbml0aW9uLmV2ZW50cykpIHtcbiAgICAgICAgICAvLyBgc3RhdGVNYWNoaW5lKClgIGluc3RhbGxzIGV2ZW50IG1ldGhvZHMgd2l0aCBgcHJvdG9bZXZlbnROYW1lXWAsIHNvIGl0IGFjY2VwdHNcbiAgICAgICAgICAvLyBldmVudCBrZXlzIHRoYXQgYXJlbid0IHZhbGlkIEphdmFTY3JpcHQgaWRlbnRpZmllcnMgKGUuZy4gXCJyZXRyeS1idWlsZFwiKS4gVGhvc2VcbiAgICAgICAgICAvLyBjYW4ndCBiZSB3cml0dGVuIGFzIGNsYXNzIG1ldGhvZHMgd2l0aG91dCBwcm9kdWNpbmcgYW4gdW5wYXJzZWFibGUgZmlsZSwgc28gc2tpcFxuICAgICAgICAgIC8vIHRoZW0gaGVyZSDigJQgdGhleSBzdGlsbCB3b3JrIGF0IHJ1bnRpbWUgdmlhIGJyYWNrZXQgYWNjZXNzLCBqdXN0IHVudHlwZWQuXG4gICAgICAgICAgaWYgKCEvXltBLVphLXpfJF1bQS1aYS16MC05XyRdKiQvLnRlc3QoZXZlbnROYW1lKSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBTa2lwcGluZyBnZW5lcmF0ZWQgc3RhdGUtbWFjaGluZSBtZXRob2RzIGZvciBldmVudCAnJHtldmVudE5hbWV9JyBvbiAnJHttb2RlbENsYXNzLm5hbWV9JzogdGhlIGV2ZW50IG5hbWUgaXMgbm90IGEgdmFsaWQgSmF2YVNjcmlwdCBpZGVudGlmaWVyLmApXG5cbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgY2FwaXRhbGl6ZWRFdmVudCA9IGV2ZW50TmFtZS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIGV2ZW50TmFtZS5zbGljZSgxKVxuXG4gICAgICAgICAgaWYgKG1ldGhvZHNDb3VudCA+IDApIHtcbiAgICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiXFxuXCJcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgLyoqXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICogQGFic3RyYWN0XFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICogQHJldHVybnMge3ZvaWR9XFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBcIiAgICovXFxuXCJcbiAgICAgICAgICBmaWxlQ29udGVudCArPSBgICAke2V2ZW50TmFtZX0oKSB7IHRocm93IG5ldyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZFwiKSB9XFxuYFxuXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAYWJzdHJhY3RcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgICR7ZXZlbnROYW1lfUFuZFNhdmUoKSB7IHRocm93IG5ldyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZFwiKSB9XFxuYFxuXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAYWJzdHJhY3RcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAcmV0dXJucyB7Ym9vbGVhbn1cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgIGNhbiR7Y2FwaXRhbGl6ZWRFdmVudH0oKSB7IHRocm93IG5ldyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZFwiKSB9XFxuYFxuXG4gICAgICAgICAgZmlsZUNvbnRlbnQgKz0gXCJcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAvKipcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAYWJzdHJhY3RcXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn1cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IFwiICAgKi9cXG5cIlxuICAgICAgICAgIGZpbGVDb250ZW50ICs9IGAgIGNhbiR7Y2FwaXRhbGl6ZWRFdmVudH1Bc3luYygpIHsgdGhyb3cgbmV3IEVycm9yKFwiTm90IGltcGxlbWVudGVkXCIpIH1cXG5gXG5cbiAgICAgICAgICBtZXRob2RzQ291bnQrK1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZpbGVDb250ZW50ICs9IFwifVxcblwiXG5cbiAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKG1vZGVsUGF0aCwgZmlsZUNvbnRlbnQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMganMgZG9jIHR5cGUgZnJvbSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0fSBjb2x1bW4gLSBDb2x1bW4uXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgb3duaW5nIHRoZSBjb2x1bW4gKGZvciBkZWNsYXJlZCBhdHRyaWJ1dGUgY2FzdHMpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBqcyBkb2MgdHlwZSBmcm9tIGNvbHVtbi5cbiAgICovXG4gIGpzRG9jVHlwZUZyb21Db2x1bW4oY29sdW1uLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgdHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW4uZ2V0TmFtZSgpKVxuICAgIGNvbnN0IGpzRG9jVHlwZSA9IHR5cGUgPyBqc0RvY1R5cGVCeUNvbHVtblR5cGVbdHlwZV0gOiB1bmRlZmluZWRcblxuICAgIGlmICghanNEb2NUeXBlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGBVbmtub3duIGNvbHVtbiB0eXBlOiAke3R5cGV9YClcblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHJldHVybiBqc0RvY1R5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpzIGRvYyBzZXR0ZXIgdHlwZSBmcm9tIGNvbHVtbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHR9IGNvbHVtbiAtIENvbHVtbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBvd25pbmcgdGhlIGNvbHVtbiAoZm9yIGRlY2xhcmVkIGF0dHJpYnV0ZSBjYXN0cykuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGpzIGRvYyBzZXR0ZXIgdHlwZSBmcm9tIGNvbHVtbi5cbiAgICovXG4gIGpzRG9jU2V0dGVyVHlwZUZyb21Db2x1bW4oY29sdW1uLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgdHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW4uZ2V0TmFtZSgpKVxuXG4gICAgaWYgKHR5cGUgJiYgc2V0dGVyU3RyaW5nSW5wdXRDb2x1bW5UeXBlcy5oYXModHlwZSkpIHtcbiAgICAgIHJldHVybiBcIkRhdGUgfCBzdHJpbmdcIlxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmpzRG9jVHlwZUZyb21Db2x1bW4oY29sdW1uLCBtb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVsb25ncyB0byB3cml0ZSBhdHRyaWJ1dGVzIGZvciBtb2RlbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxzRGlyIC0gU291cmNlIG1vZGVscyBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtwcm9wZXJ0eU5hbWU6IHN0cmluZywgcHJvcGVydHlUeXBlOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZ30+Pn0gLSBCZWxvbmdzLXRvIHdyaXRlIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBhc3luYyBiZWxvbmdzVG9Xcml0ZUF0dHJpYnV0ZXNGb3JNb2RlbCh7bW9kZWxDbGFzcywgbW9kZWxzRGlyfSkge1xuICAgIGNvbnN0IHdyaXRlQXR0cmlidXRlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHMoKSkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG4gICAgICBpZiAocmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljKCkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0nIG9uICcke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9JyBoYXMgbm8gdGFyZ2V0IG1vZGVsIGNsYXNzYClcblxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxGaWxlTmFtZSA9IGluZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZSh0YXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKSlcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsUGF0aCA9IGAke21vZGVsc0Rpcn0vJHt0YXJnZXRNb2RlbEZpbGVOYW1lfS5qc2BcbiAgICAgIGNvbnN0IHRhcmdldEltcG9ydFBhdGggPSBhd2FpdCBmaWxlRXhpc3RzKHRhcmdldE1vZGVsUGF0aCkgPyBgLi4vbW9kZWxzLyR7dGFyZ2V0TW9kZWxGaWxlTmFtZX0uanNgIDogYC4vJHt0YXJnZXRNb2RlbEZpbGVOYW1lfS5qc2BcblxuICAgICAgd3JpdGVBdHRyaWJ1dGVzLnB1c2goe1xuICAgICAgICBwcm9wZXJ0eU5hbWU6IHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCksXG4gICAgICAgIHByb3BlcnR5VHlwZTogYGltcG9ydChcIiR7dGFyZ2V0SW1wb3J0UGF0aH1cIikuZGVmYXVsdGAsXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWU6IHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKClcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHdyaXRlQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmVzdGVkIHdyaXRlIGF0dHJpYnV0ZXMgZm9yIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e3Byb3BlcnR5TmFtZTogc3RyaW5nLCBwcm9wZXJ0eVR5cGU6IHN0cmluZywgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nfT59IC0gTmVzdGVkIHdyaXRlIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBuZXN0ZWRXcml0ZUF0dHJpYnV0ZXNGb3JNb2RlbCh7bW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBhY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXMgPSBtb2RlbENsYXNzLl9hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXMgfHwge31cbiAgICBjb25zdCBuZXN0ZWRXcml0ZUF0dHJpYnV0ZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKGFjY2VwdGVkTmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gcmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoYFJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXBOYW1lfScgb24gJyR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0nIGhhcyBubyB0YXJnZXQgbW9kZWwgY2xhc3NgKVxuXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbEZpbGVOYW1lID0gaW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKHRhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpKVxuICAgICAgY29uc3QgdGFyZ2V0V3JpdGVUeXBlTmFtZSA9IGAke2luZmxlY3Rpb24uY2FtZWxpemUodGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKS5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIikpfVdyaXRlQXR0cmlidXRlc2BcbiAgICAgIGNvbnN0IG5lc3RlZFR5cGUgPSBgaW1wb3J0KFwiLi8ke3RhcmdldE1vZGVsRmlsZU5hbWV9LmpzXCIpLiR7dGFyZ2V0V3JpdGVUeXBlTmFtZX0ke2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXT8uYWxsb3dEZXN0cm95ID8gXCIgJiB7X2Rlc3Ryb3k/OiBib29sZWFufVwiIDogXCJcIn1gXG5cbiAgICAgIG5lc3RlZFdyaXRlQXR0cmlidXRlcy5wdXNoKHtcbiAgICAgICAgcHJvcGVydHlOYW1lOiBgJHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXNgLFxuICAgICAgICBwcm9wZXJ0eVR5cGU6IHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNNYW55XCIgPyBgQXJyYXk8JHtuZXN0ZWRUeXBlfT5gIDogbmVzdGVkVHlwZSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmVzdGVkV3JpdGVBdHRyaWJ1dGVzXG4gIH1cbn1cbiJdfQ==
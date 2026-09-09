import BaseCommand from "../../../../../cli/base-command.js";
import DatabaseGenerationContext from "../../../../../database/generation-context.js";
export default class DbGenerateModel extends BaseCommand {
    execute(): Promise<void>;
    /**
     * Generates model bases from explicit connections.
     * @param {object} args - Generation arguments.
     * @param {boolean} args.allowMissingTables - Whether absent tables are skipped.
     * @param {Record<string, import("../../../../../database/drivers/base.js").default>} args.connections - Connections keyed by logical identifier.
     * @param {DatabaseGenerationContext} [args.context] - Selected tenant database context.
     * @returns {Promise<void>} - Resolves after writing generated bases.
     */
    generateBaseModels({ allowMissingTables, connections, context }: {
        allowMissingTables: boolean;
        connections: Record<string, import("../../../../../database/drivers/base.js").default>;
        context?: DatabaseGenerationContext;
    }): Promise<void>;
    /**
     * Runs js doc type from column.
     * @param {import("../../../../../database/drivers/base-column.js").default} column - Column.
     * @param {typeof import("../../../../../database/record/index.js").default} modelClass - Model class owning the column (for declared attribute casts).
     * @returns {string | undefined} - The js doc type from column.
     */
    jsDocTypeFromColumn(column: import("../../../../../database/drivers/base-column.js").default, modelClass: typeof import("../../../../../database/record/index.js").default): string | undefined;
    /**
     * Runs js doc setter type from column.
     * @param {import("../../../../../database/drivers/base-column.js").default} column - Column.
     * @param {typeof import("../../../../../database/record/index.js").default} modelClass - Model class owning the column (for declared attribute casts).
     * @returns {string | undefined} - The js doc setter type from column.
     */
    jsDocSetterTypeFromColumn(column: import("../../../../../database/drivers/base-column.js").default, modelClass: typeof import("../../../../../database/record/index.js").default): string | undefined;
    /**
     * Runs belongs to write attributes for model.
     * @param {object} args - Arguments.
     * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Model class.
     * @param {string} args.modelsDir - Source models directory.
     * @returns {Promise<Array<{propertyName: string, propertyType: string, relationshipName: string}>>} - Belongs-to write attributes.
     */
    belongsToWriteAttributesForModel({ modelClass, modelsDir }: {
        modelClass: typeof import("../../../../../database/record/index.js").default;
        modelsDir: string;
    }): Promise<Array<{
        propertyName: string;
        propertyType: string;
        relationshipName: string;
    }>>;
    /**
     * Runs nested write attributes for model.
     * @param {object} args - Arguments.
     * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Model class.
     * @returns {Array<{propertyName: string, propertyType: string, relationshipName: string}>} - Nested write attributes.
     */
    nestedWriteAttributesForModel({ modelClass }: {
        modelClass: typeof import("../../../../../database/record/index.js").default;
    }): Array<{
        propertyName: string;
        propertyType: string;
        relationshipName: string;
    }>;
}
//# sourceMappingURL=base-models.d.ts.map
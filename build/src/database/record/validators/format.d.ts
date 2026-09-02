import Base from "./base.js";
export default class VelociousDatabaseRecordValidatorsFormat extends Base {
    /**
     * Runs validate.
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     * @returns {Promise<void>}
     */
    validate({ model, attributeName }: {
        model: import("../index.js").default;
        attributeName: string;
    }): Promise<void>;
}
//# sourceMappingURL=format.d.ts.map
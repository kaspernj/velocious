export default class VelociousDatabaseRecordValidatorsBase {
    attributeName: string;
    args: Record<string, any>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.attributeName - Attribute name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.args - Options object.
     */
    constructor({ attributeName, args }: {
        attributeName: string;
        args: Record<string, ReturnType<typeof JSON.parse>>;
    });
    /**
     * Runs validate.
     * @abstract
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    validate({ model, attributeName }: {
        model: import("../index.js").default;
        attributeName: string;
    }): Promise<void>;
}
//# sourceMappingURL=base.d.ts.map
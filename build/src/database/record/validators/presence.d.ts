import Base from "./base.js";
export default class VelociousDatabaseRecordValidatorsPresence extends Base {
    /**
     * Runs validate.
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     */
    validate({ model, attributeName }: {
        model: import("../index.js").default;
        attributeName: string;
    }): Promise<void>;
}
//# sourceMappingURL=presence.d.ts.map
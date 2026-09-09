import Base from "./base.js";
export default class VelociousDatabaseRecordValidatorsLength extends Base {
    /**
     * Runs validate: bounds the value's string length by the `maximum` and/or
     * `minimum` options. Absent values (null/undefined/"") are skipped — they
     * are the presence validator's concern.
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    validate({ model, attributeName }: {
        model: import("../index.js").default;
        attributeName: string;
    }): Promise<void>;
    /**
     * Adds a length validation error to the model.
     * @param {import("../index.js").default} model - Model instance.
     * @param {string} attributeName - Attribute name.
     * @param {string} message - Translated message predicate.
     * @returns {void}
     */
    _addError(model: import("../index.js").default, attributeName: string, message: string): void;
}
//# sourceMappingURL=length.d.ts.map
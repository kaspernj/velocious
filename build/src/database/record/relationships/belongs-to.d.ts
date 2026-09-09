import BaseRelationship from "./base.js";
export default class VelociousDatabaseRecordBelongsToRelationship extends BaseRelationship {
    _autoGenerateInverseOfAttempted: boolean | undefined;
    /**
     * Runs get foreign key.
     * @returns {string} - The foreign key.
     */
    getForeignKey(): string;
    /**
     * Runs get inverse of.
     * @returns {string | undefined} - The inverse of.
     */
    getInverseOf(): string | undefined;
}
//# sourceMappingURL=belongs-to.d.ts.map
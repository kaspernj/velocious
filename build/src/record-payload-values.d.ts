export type RecordPayloadValuesTarget = {
    _associationCounts?: Map<string, number>;
    _computedAbilities?: Map<string, boolean>;
    _queryDataValues?: Map<string, ReturnType<typeof JSON.parse>>;
};
/**
 * @typedef {{_associationCounts?: Map<string, number>, _computedAbilities?: Map<string, boolean>, _queryDataValues?: Map<string, ReturnType<typeof JSON.parse>>}} RecordPayloadValuesTarget
 */
/**
 * Read an association count attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding association count payload values.
 * @param {string} attributeName - Association count attribute name.
 * @returns {number} Attached count value, or 0 when it was not loaded.
 */
export declare function readPayloadAssociationCount(target: RecordPayloadValuesTarget, attributeName: string): number;
/**
 * Store an association count attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding association count payload values.
 * @param {string} attributeName - Association count attribute name.
 * @param {number} value - Count value.
 * @returns {void}
 */
export declare function setPayloadAssociationCount(target: RecordPayloadValuesTarget, attributeName: string, value: number): void;
/**
 * Read a computed ability attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding ability payload values.
 * @param {string} action - Ability action name.
 * @returns {boolean} Attached ability value, or false when it was not loaded.
 */
export declare function readPayloadComputedAbility(target: RecordPayloadValuesTarget, action: string): boolean;
/**
 * Store a computed ability attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding ability payload values.
 * @param {string} action - Ability action name.
 * @param {boolean} value - Whether the current ability permits the action on this record.
 * @returns {void}
 */
export declare function setPayloadComputedAbility(target: RecordPayloadValuesTarget, action: string, value: boolean): void;
/**
 * Read a queryData value attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding queryData payload values.
 * @param {string} name - queryData alias name.
 * @returns {ReturnType<typeof JSON.parse>} Attached queryData value, or null when it was not loaded.
 */
export declare function readPayloadQueryData(target: RecordPayloadValuesTarget, name: string): ReturnType<typeof JSON.parse>;
/**
 * Store a queryData value attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding queryData payload values.
 * @param {string} name - queryData alias name.
 * @param {ReturnType<typeof JSON.parse>} value - Attached queryData value.
 * @returns {void}
 */
export declare function setPayloadQueryData(target: RecordPayloadValuesTarget, name: string, value: ReturnType<typeof JSON.parse>): void;
//# sourceMappingURL=record-payload-values.d.ts.map
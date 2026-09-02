/**
 * Declarative field-map upsert applier for sync replay mutations.
 *
 * Owns the generic mechanics every per-resource replay handler repeats:
 * present-key filtering, per-field type coercion, unknown-key rejection, the
 * find-or-create upsert, the delete branch, optional snapshot serialization,
 * and the domain after-apply tail. Apps declare only the field map and hooks.
 * @deprecated Prefer resource-routed replay (`SyncEnvelopeReplayService` with `configuration`/`resourceTypeOverrides` and resource `writableAttributes` permit lists) — value casting and validation belong to the record layer. This applier remains for released applyHandlers adopters and will be removed after their migration.
 */
export default class SyncReplayUpsertApplier {
    afterApply: ((args: {
        mappedAttributes: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        record: ReturnType<typeof JSON.parse>;
    }) => Promise<Record<string, ReturnType<typeof JSON.parse>> | void>) | undefined;
    fields: Record<string, string | {
        type: string;
        column?: string;
    } | ((value: ReturnType<typeof JSON.parse>, label: string) => ReturnType<typeof JSON.parse>)>;
    findRecord: ((args: {
        data: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
    }) => Promise<ReturnType<typeof JSON.parse>>) | undefined;
    findRecordForDelete: ((args: {
        mutation: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
    }) => Promise<ReturnType<typeof JSON.parse>>) | undefined;
    modelClass: any;
    restArgs: "error" | "ignore";
    serialize: ((args: {
        mutation: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        record: ReturnType<typeof JSON.parse>;
    }) => Promise<Record<string, ReturnType<typeof JSON.parse>>> | Record<string, ReturnType<typeof JSON.parse>>) | undefined;
    /**
     * Creates a declarative upsert applier.
     * @param {object} args - Applier configuration.
     * @param {ReturnType<typeof JSON.parse>} args.modelClass - Model class receiving the mutations.
     * @param {Record<string, string | {type: string, column?: string} | ((value: ReturnType<typeof JSON.parse>, label: string) => ReturnType<typeof JSON.parse>)>} args.fields - Data-key → field-type map: a named type, a {type, column} rename spec, "ignored" for accepted-but-dropped keys, or a custom coercer function.
     * @param {(args: {data: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}) => Promise<ReturnType<typeof JSON.parse>>} [args.findRecord] - Custom record resolver. Defaults to findBy({id: mutation.resourceId}).
     * @param {(args: {mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}) => Promise<ReturnType<typeof JSON.parse>>} [args.findRecordForDelete] - Custom delete resolver. Defaults to findRecord.
     * @param {"error" | "ignore"} [args.restArgs] - Unknown data-key handling. Defaults to "error".
     * @param {(args: {mappedAttributes: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, record: ReturnType<typeof JSON.parse>}) => Promise<Record<string, ReturnType<typeof JSON.parse>> | void>} [args.afterApply] - Domain tail; its returned object merges into the apply result.
     * @param {(args: {mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, record: ReturnType<typeof JSON.parse>}) => Promise<Record<string, ReturnType<typeof JSON.parse>>> | Record<string, ReturnType<typeof JSON.parse>>} [args.serialize] - Snapshot serializer; result lands on applyResult.serializedData.
     */
    constructor({ afterApply, fields, findRecord, findRecordForDelete, modelClass, restArgs, serialize }: {
        modelClass: ReturnType<typeof JSON.parse>;
        fields: Record<string, string | {
            type: string;
            column?: string;
        } | ((value: ReturnType<typeof JSON.parse>, label: string) => ReturnType<typeof JSON.parse>)>;
        findRecord?: (args: {
            data: Record<string, ReturnType<typeof JSON.parse>>;
            mutation: ReturnType<typeof JSON.parse>;
            context: Record<string, ReturnType<typeof JSON.parse>>;
        }) => Promise<ReturnType<typeof JSON.parse>>;
        findRecordForDelete?: (args: {
            mutation: ReturnType<typeof JSON.parse>;
            context: Record<string, ReturnType<typeof JSON.parse>>;
        }) => Promise<ReturnType<typeof JSON.parse>>;
        restArgs?: "error" | "ignore";
        afterApply?: (args: {
            mappedAttributes: Record<string, ReturnType<typeof JSON.parse>>;
            mutation: ReturnType<typeof JSON.parse>;
            context: Record<string, ReturnType<typeof JSON.parse>>;
            record: ReturnType<typeof JSON.parse>;
        }) => Promise<Record<string, ReturnType<typeof JSON.parse>> | void>;
        serialize?: (args: {
            mutation: ReturnType<typeof JSON.parse>;
            context: Record<string, ReturnType<typeof JSON.parse>>;
            record: ReturnType<typeof JSON.parse>;
        }) => Promise<Record<string, ReturnType<typeof JSON.parse>>> | Record<string, ReturnType<typeof JSON.parse>>;
    });
    /**
     * Applies one normalized replay mutation to the declared model.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: ReturnType<typeof JSON.parse>}} args - Replay apply arguments.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with the record, created/deleted flags, optional serializedData, and afterApply extras.
     */
    apply({ context, mutation }: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        existingSync: ReturnType<typeof JSON.parse>;
        mutation: ReturnType<typeof JSON.parse>;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Applies a delete mutation to the declared model.
     * @param {{context: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>}} args - Delete arguments.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with the deleted flag.
     */
    applyDelete({ context, mutation }: {
        context: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: ReturnType<typeof JSON.parse>;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Maps present data keys through the declared field types.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Normalized mutation data.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Coerced attributes keyed by column name.
     */
    mappedAttributes(data: Record<string, ReturnType<typeof JSON.parse>>): Record<string, ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=sync-replay-upsert-applier.d.ts.map
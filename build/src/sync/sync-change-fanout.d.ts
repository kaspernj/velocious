export type DeclaredBroadcast<Args = Record<string, ReturnType<typeof JSON.parse>>> = {
    /**
     * - Channel name or resolver.
     */
    channel: string | ((args: Args) => string);
    /**
     * - Channel routing params.
     */
    broadcastParams: (args: Args) => Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Broadcast body.
     */
    body: (args: Args) => ReturnType<typeof JSON.parse>;
    /**
     * - Optional gate; skipped when it returns false.
     */
    when?: (args: Args) => boolean;
};
/**
 * One declarative broadcast delivered through an injected broadcaster. The
 * replay service resolves it with replay args ({actor, applyResult, mutation,
 * ...}) and the sync publisher with publish args
 * ({@link import("./sync-publisher-types.js").SyncPublishBroadcastArgs}).
 * @template [Args=Record<string, ReturnType<typeof JSON.parse>>]
 * @typedef {object} DeclaredBroadcast
 * @property {string | ((args: Args) => string)} channel - Channel name or resolver.
 * @property {(args: Args) => Record<string, ReturnType<typeof JSON.parse>>} broadcastParams - Channel routing params.
 * @property {(args: Args) => ReturnType<typeof JSON.parse>} body - Broadcast body.
 * @property {(args: Args) => boolean} [when] - Optional gate; skipped when it returns false.
 */
/**
 * Upserts one sync/change row through the shared sync-model contract: an
 * existing row for the resource identity is reassigned and re-sequenced
 * through `advanceServerSequence()` (the change-feed sequence contract) so
 * feed cursors pick the change up again; otherwise a new row is created
 * (creates allocate their sequence through the model's own hooks). Shared by
 * the replay service's model-backed persistence and the server sync
 * publisher.
 * @param {{attributes: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, syncModel: ReturnType<typeof JSON.parse>}} args - Row attributes, existing row for the resource identity, and the sync model.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} Upserted sync row.
 */
export declare function upsertSyncRow({ attributes, existingSync, syncModel }: {
    attributes: Record<string, ReturnType<typeof JSON.parse>>;
    existingSync: ReturnType<typeof JSON.parse>;
    syncModel: ReturnType<typeof JSON.parse>;
}): Promise<ReturnType<typeof JSON.parse>>;
/**
 * Delivers declarative broadcasts through an injected broadcaster: each
 * broadcast's `when` gate is checked, then channel/params/body are resolved
 * from the caller's args. Shared by the replay service's default
 * afterReplayMutation and the server sync publisher.
 * @template Args
 * @param {{args: Args, broadcaster: (broadcast: {channel: string, params: Record<string, ReturnType<typeof JSON.parse>>, body: ReturnType<typeof JSON.parse>}) => Promise<void>, broadcasts: Array<DeclaredBroadcast<Args>>}} deliveryArgs - Broadcast resolver args, broadcaster, and declared broadcasts.
 * @returns {Promise<void>}
 */
export declare function deliverDeclaredBroadcasts<Args>({ args, broadcaster, broadcasts }: {
    args: Args;
    broadcaster: (broadcast: {
        channel: string;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        body: ReturnType<typeof JSON.parse>;
    }) => Promise<void>;
    broadcasts: Array<DeclaredBroadcast<Args>>;
}): Promise<void>;
//# sourceMappingURL=sync-change-fanout.d.ts.map
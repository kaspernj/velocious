// @ts-check

/**
 * One declarative broadcast delivered through an injected broadcaster. The
 * replay service resolves it with replay args ({actor, applyResult, mutation,
 * ...}) and the sync publisher with publish args
 * ({@link import("./sync-publisher-types.js").SyncPublishBroadcastArgs}).
 * @template [Args=Record<string, ?>]
 * @typedef {object} DeclaredBroadcast
 * @property {string | ((args: Args) => string)} channel - Channel name or resolver.
 * @property {(args: Args) => Record<string, ?>} broadcastParams - Channel routing params.
 * @property {(args: Args) => ?} body - Broadcast body.
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
 * @param {{attributes: Record<string, ?>, existingSync: ?, syncModel: ?}} args - Row attributes, existing row for the resource identity, and the sync model.
 * @returns {Promise<?>} Upserted sync row.
 */
export async function upsertSyncRow({attributes, existingSync, syncModel}) {
  if (existingSync) {
    existingSync.assign(attributes)
    await existingSync.advanceServerSequence()
    await existingSync.save()

    return existingSync
  }

  return await syncModel.create(attributes)
}

/**
 * Delivers declarative broadcasts through an injected broadcaster: each
 * broadcast's `when` gate is checked, then channel/params/body are resolved
 * from the caller's args. Shared by the replay service's default
 * afterReplayMutation and the server sync publisher.
 * @template Args
 * @param {{args: Args, broadcaster: (broadcast: {channel: string, params: Record<string, ?>, body: ?}) => Promise<void>, broadcasts: Array<DeclaredBroadcast<Args>>}} deliveryArgs - Broadcast resolver args, broadcaster, and declared broadcasts.
 * @returns {Promise<void>}
 */
export async function deliverDeclaredBroadcasts({args, broadcaster, broadcasts}) {
  for (const broadcast of broadcasts) {
    if (broadcast.when && !broadcast.when(args)) continue

    await broadcaster({
      body: broadcast.body(args),
      channel: typeof broadcast.channel === "function" ? broadcast.channel(args) : broadcast.channel,
      params: broadcast.broadcastParams(args)
    })
  }
}

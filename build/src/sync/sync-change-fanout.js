// @ts-check
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
export async function upsertSyncRow({ attributes, existingSync, syncModel }) {
    if (existingSync) {
        existingSync.assign(attributes);
        await existingSync.advanceServerSequence();
        await existingSync.save();
        return existingSync;
    }
    return await syncModel.create(attributes);
}
/**
 * Delivers declarative broadcasts through an injected broadcaster: each
 * broadcast's `when` gate is checked, then channel/params/body are resolved
 * from the caller's args. Shared by the replay service's default
 * afterReplayMutation and the server sync publisher.
 * @template Args
 * @param {{args: Args, broadcaster: (broadcast: {channel: string, params: Record<string, ReturnType<typeof JSON.parse>>, body: ReturnType<typeof JSON.parse>}) => Promise<void>, broadcasts: Array<DeclaredBroadcast<Args>>}} deliveryArgs - Broadcast resolver args, broadcaster, and declared broadcasts.
 * @returns {Promise<void>}
 */
export async function deliverDeclaredBroadcasts({ args, broadcaster, broadcasts }) {
    for (const broadcast of broadcasts) {
        if (broadcast.when && !broadcast.when(args))
            continue;
        await broadcaster({
            body: broadcast.body(args),
            channel: typeof broadcast.channel === "function" ? broadcast.channel(args) : broadcast.channel,
            params: broadcast.broadcastParams(args)
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jaGFuZ2UtZmFub3V0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1jaGFuZ2UtZmFub3V0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7Ozs7Ozs7R0FXRztBQUVIOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLGFBQWEsQ0FBQyxFQUFDLFVBQVUsRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFDO0lBQ3ZFLElBQUksWUFBWSxFQUFFLENBQUM7UUFDakIsWUFBWSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUMvQixNQUFNLFlBQVksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQzFDLE1BQU0sWUFBWSxDQUFDLElBQUksRUFBRSxDQUFBO1FBRXpCLE9BQU8sWUFBWSxDQUFBO0lBQ3JCLENBQUM7SUFFRCxPQUFPLE1BQU0sU0FBUyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtBQUMzQyxDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLHlCQUF5QixDQUFDLEVBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUM7SUFDN0UsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUNuQyxJQUFJLFNBQVMsQ0FBQyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztZQUFFLFNBQVE7UUFFckQsTUFBTSxXQUFXLENBQUM7WUFDaEIsSUFBSSxFQUFFLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1lBQzFCLE9BQU8sRUFBRSxPQUFPLFNBQVMsQ0FBQyxPQUFPLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsT0FBTztZQUM5RixNQUFNLEVBQUUsU0FBUyxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUM7U0FDeEMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBPbmUgZGVjbGFyYXRpdmUgYnJvYWRjYXN0IGRlbGl2ZXJlZCB0aHJvdWdoIGFuIGluamVjdGVkIGJyb2FkY2FzdGVyLiBUaGVcbiAqIHJlcGxheSBzZXJ2aWNlIHJlc29sdmVzIGl0IHdpdGggcmVwbGF5IGFyZ3MgKHthY3RvciwgYXBwbHlSZXN1bHQsIG11dGF0aW9uLFxuICogLi4ufSkgYW5kIHRoZSBzeW5jIHB1Ymxpc2hlciB3aXRoIHB1Ymxpc2ggYXJnc1xuICogKHtAbGluayBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoQnJvYWRjYXN0QXJnc30pLlxuICogQHRlbXBsYXRlIFtBcmdzPVJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pl1cbiAqIEB0eXBlZGVmIHtvYmplY3R9IERlY2xhcmVkQnJvYWRjYXN0XG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoYXJnczogQXJncykgPT4gc3RyaW5nKX0gY2hhbm5lbCAtIENoYW5uZWwgbmFtZSBvciByZXNvbHZlci5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IEFyZ3MpID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gQ2hhbm5lbCByb3V0aW5nIHBhcmFtcy5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IEFyZ3MpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiBBcmdzKSA9PiBib29sZWFufSBbd2hlbl0gLSBPcHRpb25hbCBnYXRlOyBza2lwcGVkIHdoZW4gaXQgcmV0dXJucyBmYWxzZS5cbiAqL1xuXG4vKipcbiAqIFVwc2VydHMgb25lIHN5bmMvY2hhbmdlIHJvdyB0aHJvdWdoIHRoZSBzaGFyZWQgc3luYy1tb2RlbCBjb250cmFjdDogYW5cbiAqIGV4aXN0aW5nIHJvdyBmb3IgdGhlIHJlc291cmNlIGlkZW50aXR5IGlzIHJlYXNzaWduZWQgYW5kIHJlLXNlcXVlbmNlZFxuICogdGhyb3VnaCBgYWR2YW5jZVNlcnZlclNlcXVlbmNlKClgICh0aGUgY2hhbmdlLWZlZWQgc2VxdWVuY2UgY29udHJhY3QpIHNvXG4gKiBmZWVkIGN1cnNvcnMgcGljayB0aGUgY2hhbmdlIHVwIGFnYWluOyBvdGhlcndpc2UgYSBuZXcgcm93IGlzIGNyZWF0ZWRcbiAqIChjcmVhdGVzIGFsbG9jYXRlIHRoZWlyIHNlcXVlbmNlIHRocm91Z2ggdGhlIG1vZGVsJ3Mgb3duIGhvb2tzKS4gU2hhcmVkIGJ5XG4gKiB0aGUgcmVwbGF5IHNlcnZpY2UncyBtb2RlbC1iYWNrZWQgcGVyc2lzdGVuY2UgYW5kIHRoZSBzZXJ2ZXIgc3luY1xuICogcHVibGlzaGVyLlxuICogQHBhcmFtIHt7YXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzeW5jTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIFJvdyBhdHRyaWJ1dGVzLCBleGlzdGluZyByb3cgZm9yIHRoZSByZXNvdXJjZSBpZGVudGl0eSwgYW5kIHRoZSBzeW5jIG1vZGVsLlxuICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBVcHNlcnRlZCBzeW5jIHJvdy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwc2VydFN5bmNSb3coe2F0dHJpYnV0ZXMsIGV4aXN0aW5nU3luYywgc3luY01vZGVsfSkge1xuICBpZiAoZXhpc3RpbmdTeW5jKSB7XG4gICAgZXhpc3RpbmdTeW5jLmFzc2lnbihhdHRyaWJ1dGVzKVxuICAgIGF3YWl0IGV4aXN0aW5nU3luYy5hZHZhbmNlU2VydmVyU2VxdWVuY2UoKVxuICAgIGF3YWl0IGV4aXN0aW5nU3luYy5zYXZlKClcblxuICAgIHJldHVybiBleGlzdGluZ1N5bmNcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBzeW5jTW9kZWwuY3JlYXRlKGF0dHJpYnV0ZXMpXG59XG5cbi8qKlxuICogRGVsaXZlcnMgZGVjbGFyYXRpdmUgYnJvYWRjYXN0cyB0aHJvdWdoIGFuIGluamVjdGVkIGJyb2FkY2FzdGVyOiBlYWNoXG4gKiBicm9hZGNhc3QncyBgd2hlbmAgZ2F0ZSBpcyBjaGVja2VkLCB0aGVuIGNoYW5uZWwvcGFyYW1zL2JvZHkgYXJlIHJlc29sdmVkXG4gKiBmcm9tIHRoZSBjYWxsZXIncyBhcmdzLiBTaGFyZWQgYnkgdGhlIHJlcGxheSBzZXJ2aWNlJ3MgZGVmYXVsdFxuICogYWZ0ZXJSZXBsYXlNdXRhdGlvbiBhbmQgdGhlIHNlcnZlciBzeW5jIHB1Ymxpc2hlci5cbiAqIEB0ZW1wbGF0ZSBBcmdzXG4gKiBAcGFyYW0ge3thcmdzOiBBcmdzLCBicm9hZGNhc3RlcjogKGJyb2FkY2FzdDoge2NoYW5uZWw6IHN0cmluZywgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGJvZHk6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgPT4gUHJvbWlzZTx2b2lkPiwgYnJvYWRjYXN0czogQXJyYXk8RGVjbGFyZWRCcm9hZGNhc3Q8QXJncz4+fX0gZGVsaXZlcnlBcmdzIC0gQnJvYWRjYXN0IHJlc29sdmVyIGFyZ3MsIGJyb2FkY2FzdGVyLCBhbmQgZGVjbGFyZWQgYnJvYWRjYXN0cy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0cyh7YXJncywgYnJvYWRjYXN0ZXIsIGJyb2FkY2FzdHN9KSB7XG4gIGZvciAoY29uc3QgYnJvYWRjYXN0IG9mIGJyb2FkY2FzdHMpIHtcbiAgICBpZiAoYnJvYWRjYXN0LndoZW4gJiYgIWJyb2FkY2FzdC53aGVuKGFyZ3MpKSBjb250aW51ZVxuXG4gICAgYXdhaXQgYnJvYWRjYXN0ZXIoe1xuICAgICAgYm9keTogYnJvYWRjYXN0LmJvZHkoYXJncyksXG4gICAgICBjaGFubmVsOiB0eXBlb2YgYnJvYWRjYXN0LmNoYW5uZWwgPT09IFwiZnVuY3Rpb25cIiA/IGJyb2FkY2FzdC5jaGFubmVsKGFyZ3MpIDogYnJvYWRjYXN0LmNoYW5uZWwsXG4gICAgICBwYXJhbXM6IGJyb2FkY2FzdC5icm9hZGNhc3RQYXJhbXMoYXJncylcbiAgICB9KVxuICB9XG59XG4iXX0=
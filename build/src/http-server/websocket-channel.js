// @ts-check
/**
 * WebsocketJsonValue type.
 * @typedef {null | boolean | number | string | object} WebsocketJsonValue
 */
/**
 * WebsocketParams type.
 * @typedef {Record<string, WebsocketJsonValue>} WebsocketParams
 */
/**
 * Server-side metadata accompanying a matched broadcast.
 * @typedef {{broadcastParams?: WebsocketParams, eventId?: string}} WebsocketBroadcastMetadata
 */
/**
 * Base class for app-defined 1:N pub/sub channels.
 *
 * Subclasses override:
 *  - `canSubscribe()` — subscribe-time auth (default `false`).
 *  - `subscribed()` / `unsubscribed()` — optional lifecycle hooks.
 *  - `matches(broadcastParams)` — broadcast routing filter.
 */
export default class VelociousWebsocketChannel {
    /**
     * Runs constructor.
     * @param {object} args - Session, channel parameters, and client subscription identifier.
     * @param {string} args.subscriptionId - Client-assigned id, unique within the session.
     * @param {WebsocketParams} args.params - Subscribe params.
     * @param {import("./client/websocket-session.js").default} args.session - Owning session.
     */
    constructor({ subscriptionId, params, session }) {
        this.subscriptionId = subscriptionId;
        this.params = params || {};
        this.session = session;
        this._closed = false;
    }
    /**
     * Subscribe-time auth. Default is `false` (deny). Channel authors
     * MUST override to allow subscriptions. Returning a Promise defers
     * the `channel-subscribed` confirmation until it resolves.
     * @returns {boolean | Promise<boolean>} - Whether the subscription is authorized.
     */
    canSubscribe() { return false; }
    /**
     * Optional — called once after `canSubscribe` resolves truthy and
     * before `channel-subscribed` is sent to the client. Use for
     * initial snapshot delivery.
     * @returns {void | Promise<void>} - Completes after subscription setup.
     */
    subscribed() { }
    /**
     * Optional — called once when the subscription ends. Fires on
     * client-initiated `channel-unsubscribe` or on session teardown.
     * @returns {void | Promise<void>} - Completes after subscription teardown.
     */
    unsubscribed() { }
    /**
     * Called when the underlying socket drops and the session is
     * moved into the paused/grace registry. Either `onResume` fires
     * on successful client reconnect, or `unsubscribed()` fires when
     * the grace window expires.
     * @returns {void | Promise<void>} - Completes after disconnect handling.
     */
    onDisconnect() { }
    /**
     * Called after a client reconnect + `session-resume` rebinds this
     * subscription to a new socket.
     * @returns {void | Promise<void>} - Completes after resume handling.
     */
    onResume() { }
    /**
     * Called when the client sends updated metadata (e.g. after
     * sign-in / locale change). Override to react to session-level
     * metadata updates.
     * @param {WebsocketParams} _metadata - Updated metadata.
     * @returns {void | Promise<void>} - Completes after metadata-change handling.
     */
    onMetadataChanged(_metadata) { }
    /**
     * Broadcast routing filter. Called by `broadcastToChannel` for
     * each live subscription — returning true delivers the body via
     * `sendMessage`. Default matches all broadcasts regardless of
     * params; override for per-subscriber filtering.
     * @param {...WebsocketJsonValue} _broadcastArgs - Params forwarded from `broadcastToChannel` (ignored by default).
     * @returns {boolean} - True to deliver the broadcast to this subscriber.
     */
    matches(..._broadcastArgs) { return true; }
    /**
     * Whether replaying a persisted broadcast would require a client resync.
     * Subclasses override this when replay storage deliberately omits metadata
     * required to deliver an event safely.
     * @param {WebsocketJsonValue} _body - Persisted broadcast payload.
     * @returns {boolean | Promise<boolean>} - Whether the session must report a replay gap.
     */
    _requiresReplayGap(_body) { return false; }
    /**
     * Returns sanitized diagnostics for debug snapshots.
     * Subclasses can override to expose non-sensitive routing details.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Debug-safe subscription details.
     */
    debugSnapshot() { return {}; }
    /**
     * Delivers a matched broadcast to this subscriber. Subclasses can
     * override when the outbound body must be tailored to subscription
     * params before sending.
     * @param {WebsocketJsonValue} body - Broadcast payload offered to this subscription.
     * @param {WebsocketBroadcastMetadata} [meta] - Optional server-side broadcast metadata.
     * @returns {void | Promise<void>} - Completes after broadcast delivery.
     */
    deliverBroadcast(body, meta) {
        this.sendMessage(body, meta);
    }
    /**
     * Sends a `channel-message` frame to THIS subscriber only.
     * When `meta.eventId` is provided, the client receives it so it
     * can track its checkpoint for `lastEventId` replay on reconnect.
     * @param {WebsocketJsonValue} body - Channel payload to send to the subscribed client.
     * @param {WebsocketBroadcastMetadata} [meta] - Optional server-side broadcast metadata.
     * @returns {void}
     */
    sendMessage(body, meta) {
        if (this._closed) {
            throw new Error(`Cannot sendMessage on closed subscription ${this.subscriptionId}`);
        }
        this.session.sendJson({
            type: "channel-message",
            subscriptionId: this.subscriptionId,
            body,
            ...(meta?.eventId ? { eventId: meta.eventId } : {})
        });
    }
    /**
     * Runs is closed.
     * @returns {boolean} - Whether the channel is closed.
     */
    isClosed() { return this._closed; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7R0FHRztBQUNIOzs7R0FHRztBQUNIOzs7R0FHRztBQUVIOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHlCQUF5QjtJQUM1Qzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsY0FBYyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUM7UUFDM0MsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUE7UUFDcEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksRUFBRSxDQUFBO1FBQzFCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFlBQVksS0FBSyxPQUFPLEtBQUssQ0FBQSxDQUFDLENBQUM7SUFFL0I7Ozs7O09BS0c7SUFDSCxVQUFVLEtBQUksQ0FBQztJQUVmOzs7O09BSUc7SUFDSCxZQUFZLEtBQUksQ0FBQztJQUVqQjs7Ozs7O09BTUc7SUFDSCxZQUFZLEtBQUksQ0FBQztJQUVqQjs7OztPQUlHO0lBQ0gsUUFBUSxLQUFJLENBQUM7SUFFYjs7Ozs7O09BTUc7SUFDSCxpQkFBaUIsQ0FBQyxTQUFTLElBQUcsQ0FBQztJQUUvQjs7Ozs7OztPQU9HO0lBQ0gsT0FBTyxDQUFDLEdBQUcsY0FBYyxJQUFJLE9BQU8sSUFBSSxDQUFBLENBQUMsQ0FBQztJQUUxQzs7Ozs7O09BTUc7SUFDSCxrQkFBa0IsQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRTFDOzs7O09BSUc7SUFDSCxhQUFhLEtBQUssT0FBTyxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRTdCOzs7Ozs7O09BT0c7SUFDSCxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsSUFBSTtRQUN6QixJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILFdBQVcsQ0FBQyxJQUFJLEVBQUUsSUFBSTtRQUNwQixJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNqQixNQUFNLElBQUksS0FBSyxDQUFDLDZDQUE2QyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQTtRQUNyRixDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUM7WUFDcEIsSUFBSSxFQUFFLGlCQUFpQjtZQUN2QixjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWM7WUFDbkMsSUFBSTtZQUNKLEdBQUcsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztTQUNsRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsUUFBUSxLQUFLLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQSxDQUFDLENBQUM7Q0FDbkMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBXZWJzb2NrZXRKc29uVmFsdWUgdHlwZS5cbiAqIEB0eXBlZGVmIHtudWxsIHwgYm9vbGVhbiB8IG51bWJlciB8IHN0cmluZyB8IG9iamVjdH0gV2Vic29ja2V0SnNvblZhbHVlXG4gKi9cbi8qKlxuICogV2Vic29ja2V0UGFyYW1zIHR5cGUuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgV2Vic29ja2V0SnNvblZhbHVlPn0gV2Vic29ja2V0UGFyYW1zXG4gKi9cbi8qKlxuICogU2VydmVyLXNpZGUgbWV0YWRhdGEgYWNjb21wYW55aW5nIGEgbWF0Y2hlZCBicm9hZGNhc3QuXG4gKiBAdHlwZWRlZiB7e2Jyb2FkY2FzdFBhcmFtcz86IFdlYnNvY2tldFBhcmFtcywgZXZlbnRJZD86IHN0cmluZ319IFdlYnNvY2tldEJyb2FkY2FzdE1ldGFkYXRhXG4gKi9cblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBhcHAtZGVmaW5lZCAxOk4gcHViL3N1YiBjaGFubmVscy5cbiAqXG4gKiBTdWJjbGFzc2VzIG92ZXJyaWRlOlxuICogIC0gYGNhblN1YnNjcmliZSgpYCDigJQgc3Vic2NyaWJlLXRpbWUgYXV0aCAoZGVmYXVsdCBgZmFsc2VgKS5cbiAqICAtIGBzdWJzY3JpYmVkKClgIC8gYHVuc3Vic2NyaWJlZCgpYCDigJQgb3B0aW9uYWwgbGlmZWN5Y2xlIGhvb2tzLlxuICogIC0gYG1hdGNoZXMoYnJvYWRjYXN0UGFyYW1zKWAg4oCUIGJyb2FkY2FzdCByb3V0aW5nIGZpbHRlci5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNlc3Npb24sIGNoYW5uZWwgcGFyYW1ldGVycywgYW5kIGNsaWVudCBzdWJzY3JpcHRpb24gaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3Vic2NyaXB0aW9uSWQgLSBDbGllbnQtYXNzaWduZWQgaWQsIHVuaXF1ZSB3aXRoaW4gdGhlIHNlc3Npb24uXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0UGFyYW1zfSBhcmdzLnBhcmFtcyAtIFN1YnNjcmliZSBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdH0gYXJncy5zZXNzaW9uIC0gT3duaW5nIHNlc3Npb24uXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7c3Vic2NyaXB0aW9uSWQsIHBhcmFtcywgc2Vzc2lvbn0pIHtcbiAgICB0aGlzLnN1YnNjcmlwdGlvbklkID0gc3Vic2NyaXB0aW9uSWRcbiAgICB0aGlzLnBhcmFtcyA9IHBhcmFtcyB8fCB7fVxuICAgIHRoaXMuc2Vzc2lvbiA9IHNlc3Npb25cbiAgICB0aGlzLl9jbG9zZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZS10aW1lIGF1dGguIERlZmF1bHQgaXMgYGZhbHNlYCAoZGVueSkuIENoYW5uZWwgYXV0aG9yc1xuICAgKiBNVVNUIG92ZXJyaWRlIHRvIGFsbG93IHN1YnNjcmlwdGlvbnMuIFJldHVybmluZyBhIFByb21pc2UgZGVmZXJzXG4gICAqIHRoZSBgY2hhbm5lbC1zdWJzY3JpYmVkYCBjb25maXJtYXRpb24gdW50aWwgaXQgcmVzb2x2ZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzdWJzY3JpcHRpb24gaXMgYXV0aG9yaXplZC5cbiAgICovXG4gIGNhblN1YnNjcmliZSgpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogT3B0aW9uYWwg4oCUIGNhbGxlZCBvbmNlIGFmdGVyIGBjYW5TdWJzY3JpYmVgIHJlc29sdmVzIHRydXRoeSBhbmRcbiAgICogYmVmb3JlIGBjaGFubmVsLXN1YnNjcmliZWRgIGlzIHNlbnQgdG8gdGhlIGNsaWVudC4gVXNlIGZvclxuICAgKiBpbml0aWFsIHNuYXBzaG90IGRlbGl2ZXJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIHN1YnNjcmlwdGlvbiBzZXR1cC5cbiAgICovXG4gIHN1YnNjcmliZWQoKSB7fVxuXG4gIC8qKlxuICAgKiBPcHRpb25hbCDigJQgY2FsbGVkIG9uY2Ugd2hlbiB0aGUgc3Vic2NyaXB0aW9uIGVuZHMuIEZpcmVzIG9uXG4gICAqIGNsaWVudC1pbml0aWF0ZWQgYGNoYW5uZWwtdW5zdWJzY3JpYmVgIG9yIG9uIHNlc3Npb24gdGVhcmRvd24uXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBDb21wbGV0ZXMgYWZ0ZXIgc3Vic2NyaXB0aW9uIHRlYXJkb3duLlxuICAgKi9cbiAgdW5zdWJzY3JpYmVkKCkge31cblxuICAvKipcbiAgICogQ2FsbGVkIHdoZW4gdGhlIHVuZGVybHlpbmcgc29ja2V0IGRyb3BzIGFuZCB0aGUgc2Vzc2lvbiBpc1xuICAgKiBtb3ZlZCBpbnRvIHRoZSBwYXVzZWQvZ3JhY2UgcmVnaXN0cnkuIEVpdGhlciBgb25SZXN1bWVgIGZpcmVzXG4gICAqIG9uIHN1Y2Nlc3NmdWwgY2xpZW50IHJlY29ubmVjdCwgb3IgYHVuc3Vic2NyaWJlZCgpYCBmaXJlcyB3aGVuXG4gICAqIHRoZSBncmFjZSB3aW5kb3cgZXhwaXJlcy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIENvbXBsZXRlcyBhZnRlciBkaXNjb25uZWN0IGhhbmRsaW5nLlxuICAgKi9cbiAgb25EaXNjb25uZWN0KCkge31cblxuICAvKipcbiAgICogQ2FsbGVkIGFmdGVyIGEgY2xpZW50IHJlY29ubmVjdCArIGBzZXNzaW9uLXJlc3VtZWAgcmViaW5kcyB0aGlzXG4gICAqIHN1YnNjcmlwdGlvbiB0byBhIG5ldyBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBDb21wbGV0ZXMgYWZ0ZXIgcmVzdW1lIGhhbmRsaW5nLlxuICAgKi9cbiAgb25SZXN1bWUoKSB7fVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgd2hlbiB0aGUgY2xpZW50IHNlbmRzIHVwZGF0ZWQgbWV0YWRhdGEgKGUuZy4gYWZ0ZXJcbiAgICogc2lnbi1pbiAvIGxvY2FsZSBjaGFuZ2UpLiBPdmVycmlkZSB0byByZWFjdCB0byBzZXNzaW9uLWxldmVsXG4gICAqIG1ldGFkYXRhIHVwZGF0ZXMuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0UGFyYW1zfSBfbWV0YWRhdGEgLSBVcGRhdGVkIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIG1ldGFkYXRhLWNoYW5nZSBoYW5kbGluZy5cbiAgICovXG4gIG9uTWV0YWRhdGFDaGFuZ2VkKF9tZXRhZGF0YSkge31cblxuICAvKipcbiAgICogQnJvYWRjYXN0IHJvdXRpbmcgZmlsdGVyLiBDYWxsZWQgYnkgYGJyb2FkY2FzdFRvQ2hhbm5lbGAgZm9yXG4gICAqIGVhY2ggbGl2ZSBzdWJzY3JpcHRpb24g4oCUIHJldHVybmluZyB0cnVlIGRlbGl2ZXJzIHRoZSBib2R5IHZpYVxuICAgKiBgc2VuZE1lc3NhZ2VgLiBEZWZhdWx0IG1hdGNoZXMgYWxsIGJyb2FkY2FzdHMgcmVnYXJkbGVzcyBvZlxuICAgKiBwYXJhbXM7IG92ZXJyaWRlIGZvciBwZXItc3Vic2NyaWJlciBmaWx0ZXJpbmcuXG4gICAqIEBwYXJhbSB7Li4uV2Vic29ja2V0SnNvblZhbHVlfSBfYnJvYWRjYXN0QXJncyAtIFBhcmFtcyBmb3J3YXJkZWQgZnJvbSBgYnJvYWRjYXN0VG9DaGFubmVsYCAoaWdub3JlZCBieSBkZWZhdWx0KS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gVHJ1ZSB0byBkZWxpdmVyIHRoZSBicm9hZGNhc3QgdG8gdGhpcyBzdWJzY3JpYmVyLlxuICAgKi9cbiAgbWF0Y2hlcyguLi5fYnJvYWRjYXN0QXJncykgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgcmVwbGF5aW5nIGEgcGVyc2lzdGVkIGJyb2FkY2FzdCB3b3VsZCByZXF1aXJlIGEgY2xpZW50IHJlc3luYy5cbiAgICogU3ViY2xhc3NlcyBvdmVycmlkZSB0aGlzIHdoZW4gcmVwbGF5IHN0b3JhZ2UgZGVsaWJlcmF0ZWx5IG9taXRzIG1ldGFkYXRhXG4gICAqIHJlcXVpcmVkIHRvIGRlbGl2ZXIgYW4gZXZlbnQgc2FmZWx5LlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldEpzb25WYWx1ZX0gX2JvZHkgLSBQZXJzaXN0ZWQgYnJvYWRjYXN0IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzZXNzaW9uIG11c3QgcmVwb3J0IGEgcmVwbGF5IGdhcC5cbiAgICovXG4gIF9yZXF1aXJlc1JlcGxheUdhcChfYm9keSkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhbml0aXplZCBkaWFnbm9zdGljcyBmb3IgZGVidWcgc25hcHNob3RzLlxuICAgKiBTdWJjbGFzc2VzIGNhbiBvdmVycmlkZSB0byBleHBvc2Ugbm9uLXNlbnNpdGl2ZSByb3V0aW5nIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IERlYnVnLXNhZmUgc3Vic2NyaXB0aW9uIGRldGFpbHMuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkgeyByZXR1cm4ge30gfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBhIG1hdGNoZWQgYnJvYWRjYXN0IHRvIHRoaXMgc3Vic2NyaWJlci4gU3ViY2xhc3NlcyBjYW5cbiAgICogb3ZlcnJpZGUgd2hlbiB0aGUgb3V0Ym91bmQgYm9keSBtdXN0IGJlIHRhaWxvcmVkIHRvIHN1YnNjcmlwdGlvblxuICAgKiBwYXJhbXMgYmVmb3JlIHNlbmRpbmcuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IHBheWxvYWQgb2ZmZXJlZCB0byB0aGlzIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgc2VydmVyLXNpZGUgYnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIGJyb2FkY2FzdCBkZWxpdmVyeS5cbiAgICovXG4gIGRlbGl2ZXJCcm9hZGNhc3QoYm9keSwgbWV0YSkge1xuICAgIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIGBjaGFubmVsLW1lc3NhZ2VgIGZyYW1lIHRvIFRISVMgc3Vic2NyaWJlciBvbmx5LlxuICAgKiBXaGVuIGBtZXRhLmV2ZW50SWRgIGlzIHByb3ZpZGVkLCB0aGUgY2xpZW50IHJlY2VpdmVzIGl0IHNvIGl0XG4gICAqIGNhbiB0cmFjayBpdHMgY2hlY2twb2ludCBmb3IgYGxhc3RFdmVudElkYCByZXBsYXkgb24gcmVjb25uZWN0LlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldEpzb25WYWx1ZX0gYm9keSAtIENoYW5uZWwgcGF5bG9hZCB0byBzZW5kIHRvIHRoZSBzdWJzY3JpYmVkIGNsaWVudC5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgc2VydmVyLXNpZGUgYnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNlbmRNZXNzYWdlKGJvZHksIG1ldGEpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzZW5kTWVzc2FnZSBvbiBjbG9zZWQgc3Vic2NyaXB0aW9uICR7dGhpcy5zdWJzY3JpcHRpb25JZH1gKVxuICAgIH1cblxuICAgIHRoaXMuc2Vzc2lvbi5zZW5kSnNvbih7XG4gICAgICB0eXBlOiBcImNoYW5uZWwtbWVzc2FnZVwiLFxuICAgICAgc3Vic2NyaXB0aW9uSWQ6IHRoaXMuc3Vic2NyaXB0aW9uSWQsXG4gICAgICBib2R5LFxuICAgICAgLi4uKG1ldGE/LmV2ZW50SWQgPyB7ZXZlbnRJZDogbWV0YS5ldmVudElkfSA6IHt9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNoYW5uZWwgaXMgY2xvc2VkLlxuICAgKi9cbiAgaXNDbG9zZWQoKSB7IHJldHVybiB0aGlzLl9jbG9zZWQgfVxufVxuIl19
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
     * Returns the broadcast params that may be persisted for replay.
     * Persisted params are re-applied through `matches(broadcastParams)`
     * when replaying missed events, so they must be JSON-serializable and
     * safe to store. Override when `broadcastParams` carries server-only
     * values that must never reach the event log (e.g. authorization
     * snapshots).
     * @param {WebsocketParams | null | undefined} broadcastParams - Params passed to `broadcastToChannel`.
     * @returns {WebsocketParams | null} - Params to persist, or null to store none.
     */
    static replayableBroadcastParams(broadcastParams) {
        return broadcastParams ?? null;
    }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7R0FHRztBQUNIOzs7R0FHRztBQUNIOzs7R0FHRztBQUVIOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHlCQUF5QjtJQUM1Qzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsY0FBYyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUM7UUFDM0MsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUE7UUFDcEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksRUFBRSxDQUFBO1FBQzFCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFlBQVksS0FBSyxPQUFPLEtBQUssQ0FBQSxDQUFDLENBQUM7SUFFL0I7Ozs7O09BS0c7SUFDSCxVQUFVLEtBQUksQ0FBQztJQUVmOzs7O09BSUc7SUFDSCxZQUFZLEtBQUksQ0FBQztJQUVqQjs7Ozs7O09BTUc7SUFDSCxZQUFZLEtBQUksQ0FBQztJQUVqQjs7OztPQUlHO0lBQ0gsUUFBUSxLQUFJLENBQUM7SUFFYjs7Ozs7O09BTUc7SUFDSCxpQkFBaUIsQ0FBQyxTQUFTLElBQUcsQ0FBQztJQUUvQjs7Ozs7OztPQU9HO0lBQ0gsT0FBTyxDQUFDLEdBQUcsY0FBYyxJQUFJLE9BQU8sSUFBSSxDQUFBLENBQUMsQ0FBQztJQUUxQzs7Ozs7Ozs7O09BU0c7SUFDSCxNQUFNLENBQUMseUJBQXlCLENBQUMsZUFBZTtRQUM5QyxPQUFPLGVBQWUsSUFBSSxJQUFJLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGtCQUFrQixDQUFDLEtBQUssSUFBSSxPQUFPLEtBQUssQ0FBQSxDQUFDLENBQUM7SUFFMUM7Ozs7T0FJRztJQUNILGFBQWEsS0FBSyxPQUFPLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFFN0I7Ozs7Ozs7T0FPRztJQUNILGdCQUFnQixDQUFDLElBQUksRUFBRSxJQUFJO1FBQ3pCLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFBO0lBQzlCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsV0FBVyxDQUFDLElBQUksRUFBRSxJQUFJO1FBQ3BCLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2pCLE1BQU0sSUFBSSxLQUFLLENBQUMsNkNBQTZDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFBO1FBQ3JGLENBQUM7UUFFRCxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQztZQUNwQixJQUFJLEVBQUUsaUJBQWlCO1lBQ3ZCLGNBQWMsRUFBRSxJQUFJLENBQUMsY0FBYztZQUNuQyxJQUFJO1lBQ0osR0FBRyxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1NBQ2xELENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFBLENBQUMsQ0FBQztDQUNuQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFdlYnNvY2tldEpzb25WYWx1ZSB0eXBlLlxuICogQHR5cGVkZWYge251bGwgfCBib29sZWFuIHwgbnVtYmVyIHwgc3RyaW5nIHwgb2JqZWN0fSBXZWJzb2NrZXRKc29uVmFsdWVcbiAqL1xuLyoqXG4gKiBXZWJzb2NrZXRQYXJhbXMgdHlwZS5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBXZWJzb2NrZXRKc29uVmFsdWU+fSBXZWJzb2NrZXRQYXJhbXNcbiAqL1xuLyoqXG4gKiBTZXJ2ZXItc2lkZSBtZXRhZGF0YSBhY2NvbXBhbnlpbmcgYSBtYXRjaGVkIGJyb2FkY2FzdC5cbiAqIEB0eXBlZGVmIHt7YnJvYWRjYXN0UGFyYW1zPzogV2Vic29ja2V0UGFyYW1zLCBldmVudElkPzogc3RyaW5nfX0gV2Vic29ja2V0QnJvYWRjYXN0TWV0YWRhdGFcbiAqL1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGFwcC1kZWZpbmVkIDE6TiBwdWIvc3ViIGNoYW5uZWxzLlxuICpcbiAqIFN1YmNsYXNzZXMgb3ZlcnJpZGU6XG4gKiAgLSBgY2FuU3Vic2NyaWJlKClgIOKAlCBzdWJzY3JpYmUtdGltZSBhdXRoIChkZWZhdWx0IGBmYWxzZWApLlxuICogIC0gYHN1YnNjcmliZWQoKWAgLyBgdW5zdWJzY3JpYmVkKClgIOKAlCBvcHRpb25hbCBsaWZlY3ljbGUgaG9va3MuXG4gKiAgLSBgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpYCDigJQgYnJvYWRjYXN0IHJvdXRpbmcgZmlsdGVyLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2Vzc2lvbiwgY2hhbm5lbCBwYXJhbWV0ZXJzLCBhbmQgY2xpZW50IHN1YnNjcmlwdGlvbiBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdWJzY3JpcHRpb25JZCAtIENsaWVudC1hc3NpZ25lZCBpZCwgdW5pcXVlIHdpdGhpbiB0aGUgc2Vzc2lvbi5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRQYXJhbXN9IGFyZ3MucGFyYW1zIC0gU3Vic2NyaWJlIHBhcmFtcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLnNlc3Npb24gLSBPd25pbmcgc2Vzc2lvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtzdWJzY3JpcHRpb25JZCwgcGFyYW1zLCBzZXNzaW9ufSkge1xuICAgIHRoaXMuc3Vic2NyaXB0aW9uSWQgPSBzdWJzY3JpcHRpb25JZFxuICAgIHRoaXMucGFyYW1zID0gcGFyYW1zIHx8IHt9XG4gICAgdGhpcy5zZXNzaW9uID0gc2Vzc2lvblxuICAgIHRoaXMuX2Nsb3NlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlLXRpbWUgYXV0aC4gRGVmYXVsdCBpcyBgZmFsc2VgIChkZW55KS4gQ2hhbm5lbCBhdXRob3JzXG4gICAqIE1VU1Qgb3ZlcnJpZGUgdG8gYWxsb3cgc3Vic2NyaXB0aW9ucy4gUmV0dXJuaW5nIGEgUHJvbWlzZSBkZWZlcnNcbiAgICogdGhlIGBjaGFubmVsLXN1YnNjcmliZWRgIGNvbmZpcm1hdGlvbiB1bnRpbCBpdCByZXNvbHZlcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIHN1YnNjcmlwdGlvbiBpcyBhdXRob3JpemVkLlxuICAgKi9cbiAgY2FuU3Vic2NyaWJlKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBPcHRpb25hbCDigJQgY2FsbGVkIG9uY2UgYWZ0ZXIgYGNhblN1YnNjcmliZWAgcmVzb2x2ZXMgdHJ1dGh5IGFuZFxuICAgKiBiZWZvcmUgYGNoYW5uZWwtc3Vic2NyaWJlZGAgaXMgc2VudCB0byB0aGUgY2xpZW50LiBVc2UgZm9yXG4gICAqIGluaXRpYWwgc25hcHNob3QgZGVsaXZlcnkuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBDb21wbGV0ZXMgYWZ0ZXIgc3Vic2NyaXB0aW9uIHNldHVwLlxuICAgKi9cbiAgc3Vic2NyaWJlZCgpIHt9XG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIOKAlCBjYWxsZWQgb25jZSB3aGVuIHRoZSBzdWJzY3JpcHRpb24gZW5kcy4gRmlyZXMgb25cbiAgICogY2xpZW50LWluaXRpYXRlZCBgY2hhbm5lbC11bnN1YnNjcmliZWAgb3Igb24gc2Vzc2lvbiB0ZWFyZG93bi5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIENvbXBsZXRlcyBhZnRlciBzdWJzY3JpcHRpb24gdGVhcmRvd24uXG4gICAqL1xuICB1bnN1YnNjcmliZWQoKSB7fVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgd2hlbiB0aGUgdW5kZXJseWluZyBzb2NrZXQgZHJvcHMgYW5kIHRoZSBzZXNzaW9uIGlzXG4gICAqIG1vdmVkIGludG8gdGhlIHBhdXNlZC9ncmFjZSByZWdpc3RyeS4gRWl0aGVyIGBvblJlc3VtZWAgZmlyZXNcbiAgICogb24gc3VjY2Vzc2Z1bCBjbGllbnQgcmVjb25uZWN0LCBvciBgdW5zdWJzY3JpYmVkKClgIGZpcmVzIHdoZW5cbiAgICogdGhlIGdyYWNlIHdpbmRvdyBleHBpcmVzLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIGRpc2Nvbm5lY3QgaGFuZGxpbmcuXG4gICAqL1xuICBvbkRpc2Nvbm5lY3QoKSB7fVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYWZ0ZXIgYSBjbGllbnQgcmVjb25uZWN0ICsgYHNlc3Npb24tcmVzdW1lYCByZWJpbmRzIHRoaXNcbiAgICogc3Vic2NyaXB0aW9uIHRvIGEgbmV3IHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIENvbXBsZXRlcyBhZnRlciByZXN1bWUgaGFuZGxpbmcuXG4gICAqL1xuICBvblJlc3VtZSgpIHt9XG5cbiAgLyoqXG4gICAqIENhbGxlZCB3aGVuIHRoZSBjbGllbnQgc2VuZHMgdXBkYXRlZCBtZXRhZGF0YSAoZS5nLiBhZnRlclxuICAgKiBzaWduLWluIC8gbG9jYWxlIGNoYW5nZSkuIE92ZXJyaWRlIHRvIHJlYWN0IHRvIHNlc3Npb24tbGV2ZWxcbiAgICogbWV0YWRhdGEgdXBkYXRlcy5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRQYXJhbXN9IF9tZXRhZGF0YSAtIFVwZGF0ZWQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBDb21wbGV0ZXMgYWZ0ZXIgbWV0YWRhdGEtY2hhbmdlIGhhbmRsaW5nLlxuICAgKi9cbiAgb25NZXRhZGF0YUNoYW5nZWQoX21ldGFkYXRhKSB7fVxuXG4gIC8qKlxuICAgKiBCcm9hZGNhc3Qgcm91dGluZyBmaWx0ZXIuIENhbGxlZCBieSBgYnJvYWRjYXN0VG9DaGFubmVsYCBmb3JcbiAgICogZWFjaCBsaXZlIHN1YnNjcmlwdGlvbiDigJQgcmV0dXJuaW5nIHRydWUgZGVsaXZlcnMgdGhlIGJvZHkgdmlhXG4gICAqIGBzZW5kTWVzc2FnZWAuIERlZmF1bHQgbWF0Y2hlcyBhbGwgYnJvYWRjYXN0cyByZWdhcmRsZXNzIG9mXG4gICAqIHBhcmFtczsgb3ZlcnJpZGUgZm9yIHBlci1zdWJzY3JpYmVyIGZpbHRlcmluZy5cbiAgICogQHBhcmFtIHsuLi5XZWJzb2NrZXRKc29uVmFsdWV9IF9icm9hZGNhc3RBcmdzIC0gUGFyYW1zIGZvcndhcmRlZCBmcm9tIGBicm9hZGNhc3RUb0NoYW5uZWxgIChpZ25vcmVkIGJ5IGRlZmF1bHQpLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIHRvIGRlbGl2ZXIgdGhlIGJyb2FkY2FzdCB0byB0aGlzIHN1YnNjcmliZXIuXG4gICAqL1xuICBtYXRjaGVzKC4uLl9icm9hZGNhc3RBcmdzKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYnJvYWRjYXN0IHBhcmFtcyB0aGF0IG1heSBiZSBwZXJzaXN0ZWQgZm9yIHJlcGxheS5cbiAgICogUGVyc2lzdGVkIHBhcmFtcyBhcmUgcmUtYXBwbGllZCB0aHJvdWdoIGBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcylgXG4gICAqIHdoZW4gcmVwbGF5aW5nIG1pc3NlZCBldmVudHMsIHNvIHRoZXkgbXVzdCBiZSBKU09OLXNlcmlhbGl6YWJsZSBhbmRcbiAgICogc2FmZSB0byBzdG9yZS4gT3ZlcnJpZGUgd2hlbiBgYnJvYWRjYXN0UGFyYW1zYCBjYXJyaWVzIHNlcnZlci1vbmx5XG4gICAqIHZhbHVlcyB0aGF0IG11c3QgbmV2ZXIgcmVhY2ggdGhlIGV2ZW50IGxvZyAoZS5nLiBhdXRob3JpemF0aW9uXG4gICAqIHNuYXBzaG90cykuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0UGFyYW1zIHwgbnVsbCB8IHVuZGVmaW5lZH0gYnJvYWRjYXN0UGFyYW1zIC0gUGFyYW1zIHBhc3NlZCB0byBgYnJvYWRjYXN0VG9DaGFubmVsYC5cbiAgICogQHJldHVybnMge1dlYnNvY2tldFBhcmFtcyB8IG51bGx9IC0gUGFyYW1zIHRvIHBlcnNpc3QsIG9yIG51bGwgdG8gc3RvcmUgbm9uZS5cbiAgICovXG4gIHN0YXRpYyByZXBsYXlhYmxlQnJvYWRjYXN0UGFyYW1zKGJyb2FkY2FzdFBhcmFtcykge1xuICAgIHJldHVybiBicm9hZGNhc3RQYXJhbXMgPz8gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgcmVwbGF5aW5nIGEgcGVyc2lzdGVkIGJyb2FkY2FzdCB3b3VsZCByZXF1aXJlIGEgY2xpZW50IHJlc3luYy5cbiAgICogU3ViY2xhc3NlcyBvdmVycmlkZSB0aGlzIHdoZW4gcmVwbGF5IHN0b3JhZ2UgZGVsaWJlcmF0ZWx5IG9taXRzIG1ldGFkYXRhXG4gICAqIHJlcXVpcmVkIHRvIGRlbGl2ZXIgYW4gZXZlbnQgc2FmZWx5LlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldEpzb25WYWx1ZX0gX2JvZHkgLSBQZXJzaXN0ZWQgYnJvYWRjYXN0IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzZXNzaW9uIG11c3QgcmVwb3J0IGEgcmVwbGF5IGdhcC5cbiAgICovXG4gIF9yZXF1aXJlc1JlcGxheUdhcChfYm9keSkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhbml0aXplZCBkaWFnbm9zdGljcyBmb3IgZGVidWcgc25hcHNob3RzLlxuICAgKiBTdWJjbGFzc2VzIGNhbiBvdmVycmlkZSB0byBleHBvc2Ugbm9uLXNlbnNpdGl2ZSByb3V0aW5nIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IERlYnVnLXNhZmUgc3Vic2NyaXB0aW9uIGRldGFpbHMuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkgeyByZXR1cm4ge30gfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBhIG1hdGNoZWQgYnJvYWRjYXN0IHRvIHRoaXMgc3Vic2NyaWJlci4gU3ViY2xhc3NlcyBjYW5cbiAgICogb3ZlcnJpZGUgd2hlbiB0aGUgb3V0Ym91bmQgYm9keSBtdXN0IGJlIHRhaWxvcmVkIHRvIHN1YnNjcmlwdGlvblxuICAgKiBwYXJhbXMgYmVmb3JlIHNlbmRpbmcuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IHBheWxvYWQgb2ZmZXJlZCB0byB0aGlzIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgc2VydmVyLXNpZGUgYnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIGJyb2FkY2FzdCBkZWxpdmVyeS5cbiAgICovXG4gIGRlbGl2ZXJCcm9hZGNhc3QoYm9keSwgbWV0YSkge1xuICAgIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIGBjaGFubmVsLW1lc3NhZ2VgIGZyYW1lIHRvIFRISVMgc3Vic2NyaWJlciBvbmx5LlxuICAgKiBXaGVuIGBtZXRhLmV2ZW50SWRgIGlzIHByb3ZpZGVkLCB0aGUgY2xpZW50IHJlY2VpdmVzIGl0IHNvIGl0XG4gICAqIGNhbiB0cmFjayBpdHMgY2hlY2twb2ludCBmb3IgYGxhc3RFdmVudElkYCByZXBsYXkgb24gcmVjb25uZWN0LlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldEpzb25WYWx1ZX0gYm9keSAtIENoYW5uZWwgcGF5bG9hZCB0byBzZW5kIHRvIHRoZSBzdWJzY3JpYmVkIGNsaWVudC5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgc2VydmVyLXNpZGUgYnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNlbmRNZXNzYWdlKGJvZHksIG1ldGEpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzZW5kTWVzc2FnZSBvbiBjbG9zZWQgc3Vic2NyaXB0aW9uICR7dGhpcy5zdWJzY3JpcHRpb25JZH1gKVxuICAgIH1cblxuICAgIHRoaXMuc2Vzc2lvbi5zZW5kSnNvbih7XG4gICAgICB0eXBlOiBcImNoYW5uZWwtbWVzc2FnZVwiLFxuICAgICAgc3Vic2NyaXB0aW9uSWQ6IHRoaXMuc3Vic2NyaXB0aW9uSWQsXG4gICAgICBib2R5LFxuICAgICAgLi4uKG1ldGE/LmV2ZW50SWQgPyB7ZXZlbnRJZDogbWV0YS5ldmVudElkfSA6IHt9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNoYW5uZWwgaXMgY2xvc2VkLlxuICAgKi9cbiAgaXNDbG9zZWQoKSB7IHJldHVybiB0aGlzLl9jbG9zZWQgfVxufVxuIl19
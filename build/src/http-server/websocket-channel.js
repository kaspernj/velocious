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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7R0FHRztBQUNIOzs7R0FHRztBQUNIOzs7R0FHRztBQUVIOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHlCQUF5QjtJQUM1Qzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsY0FBYyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUM7UUFDM0MsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUE7UUFDcEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksRUFBRSxDQUFBO1FBQzFCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFlBQVksS0FBSyxPQUFPLEtBQUssQ0FBQSxDQUFDLENBQUM7SUFFL0I7Ozs7O09BS0c7SUFDSCxVQUFVLEtBQUksQ0FBQztJQUVmOzs7O09BSUc7SUFDSCxZQUFZLEtBQUksQ0FBQztJQUVqQjs7Ozs7O09BTUc7SUFDSCxZQUFZLEtBQUksQ0FBQztJQUVqQjs7OztPQUlHO0lBQ0gsUUFBUSxLQUFJLENBQUM7SUFFYjs7Ozs7O09BTUc7SUFDSCxpQkFBaUIsQ0FBQyxTQUFTLElBQUcsQ0FBQztJQUUvQjs7Ozs7OztPQU9HO0lBQ0gsT0FBTyxDQUFDLEdBQUcsY0FBYyxJQUFJLE9BQU8sSUFBSSxDQUFBLENBQUMsQ0FBQztJQUUxQzs7OztPQUlHO0lBQ0gsYUFBYSxLQUFLLE9BQU8sRUFBRSxDQUFBLENBQUMsQ0FBQztJQUU3Qjs7Ozs7OztPQU9HO0lBQ0gsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLElBQUk7UUFDekIsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxXQUFXLENBQUMsSUFBSSxFQUFFLElBQUk7UUFDcEIsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDakIsTUFBTSxJQUFJLEtBQUssQ0FBQyw2Q0FBNkMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUE7UUFDckYsQ0FBQztRQUVELElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDO1lBQ3BCLElBQUksRUFBRSxpQkFBaUI7WUFDdkIsY0FBYyxFQUFFLElBQUksQ0FBQyxjQUFjO1lBQ25DLElBQUk7WUFDSixHQUFHLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7U0FDbEQsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUEsQ0FBQyxDQUFDO0NBQ25DIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogV2Vic29ja2V0SnNvblZhbHVlIHR5cGUuXG4gKiBAdHlwZWRlZiB7bnVsbCB8IGJvb2xlYW4gfCBudW1iZXIgfCBzdHJpbmcgfCBvYmplY3R9IFdlYnNvY2tldEpzb25WYWx1ZVxuICovXG4vKipcbiAqIFdlYnNvY2tldFBhcmFtcyB0eXBlLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFdlYnNvY2tldEpzb25WYWx1ZT59IFdlYnNvY2tldFBhcmFtc1xuICovXG4vKipcbiAqIFNlcnZlci1zaWRlIG1ldGFkYXRhIGFjY29tcGFueWluZyBhIG1hdGNoZWQgYnJvYWRjYXN0LlxuICogQHR5cGVkZWYge3ticm9hZGNhc3RQYXJhbXM/OiBXZWJzb2NrZXRQYXJhbXMsIGV2ZW50SWQ/OiBzdHJpbmd9fSBXZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YVxuICovXG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgYXBwLWRlZmluZWQgMTpOIHB1Yi9zdWIgY2hhbm5lbHMuXG4gKlxuICogU3ViY2xhc3NlcyBvdmVycmlkZTpcbiAqICAtIGBjYW5TdWJzY3JpYmUoKWAg4oCUIHN1YnNjcmliZS10aW1lIGF1dGggKGRlZmF1bHQgYGZhbHNlYCkuXG4gKiAgLSBgc3Vic2NyaWJlZCgpYCAvIGB1bnN1YnNjcmliZWQoKWAg4oCUIG9wdGlvbmFsIGxpZmVjeWNsZSBob29rcy5cbiAqICAtIGBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcylgIOKAlCBicm9hZGNhc3Qgcm91dGluZyBmaWx0ZXIuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWwge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZXNzaW9uLCBjaGFubmVsIHBhcmFtZXRlcnMsIGFuZCBjbGllbnQgc3Vic2NyaXB0aW9uIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN1YnNjcmlwdGlvbklkIC0gQ2xpZW50LWFzc2lnbmVkIGlkLCB1bmlxdWUgd2l0aGluIHRoZSBzZXNzaW9uLlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldFBhcmFtc30gYXJncy5wYXJhbXMgLSBTdWJzY3JpYmUgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3Muc2Vzc2lvbiAtIE93bmluZyBzZXNzaW9uLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe3N1YnNjcmlwdGlvbklkLCBwYXJhbXMsIHNlc3Npb259KSB7XG4gICAgdGhpcy5zdWJzY3JpcHRpb25JZCA9IHN1YnNjcmlwdGlvbklkXG4gICAgdGhpcy5wYXJhbXMgPSBwYXJhbXMgfHwge31cbiAgICB0aGlzLnNlc3Npb24gPSBzZXNzaW9uXG4gICAgdGhpcy5fY2xvc2VkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmUtdGltZSBhdXRoLiBEZWZhdWx0IGlzIGBmYWxzZWAgKGRlbnkpLiBDaGFubmVsIGF1dGhvcnNcbiAgICogTVVTVCBvdmVycmlkZSB0byBhbGxvdyBzdWJzY3JpcHRpb25zLiBSZXR1cm5pbmcgYSBQcm9taXNlIGRlZmVyc1xuICAgKiB0aGUgYGNoYW5uZWwtc3Vic2NyaWJlZGAgY29uZmlybWF0aW9uIHVudGlsIGl0IHJlc29sdmVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IFByb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgc3Vic2NyaXB0aW9uIGlzIGF1dGhvcml6ZWQuXG4gICAqL1xuICBjYW5TdWJzY3JpYmUoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIOKAlCBjYWxsZWQgb25jZSBhZnRlciBgY2FuU3Vic2NyaWJlYCByZXNvbHZlcyB0cnV0aHkgYW5kXG4gICAqIGJlZm9yZSBgY2hhbm5lbC1zdWJzY3JpYmVkYCBpcyBzZW50IHRvIHRoZSBjbGllbnQuIFVzZSBmb3JcbiAgICogaW5pdGlhbCBzbmFwc2hvdCBkZWxpdmVyeS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIENvbXBsZXRlcyBhZnRlciBzdWJzY3JpcHRpb24gc2V0dXAuXG4gICAqL1xuICBzdWJzY3JpYmVkKCkge31cblxuICAvKipcbiAgICogT3B0aW9uYWwg4oCUIGNhbGxlZCBvbmNlIHdoZW4gdGhlIHN1YnNjcmlwdGlvbiBlbmRzLiBGaXJlcyBvblxuICAgKiBjbGllbnQtaW5pdGlhdGVkIGBjaGFubmVsLXVuc3Vic2NyaWJlYCBvciBvbiBzZXNzaW9uIHRlYXJkb3duLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIHN1YnNjcmlwdGlvbiB0ZWFyZG93bi5cbiAgICovXG4gIHVuc3Vic2NyaWJlZCgpIHt9XG5cbiAgLyoqXG4gICAqIENhbGxlZCB3aGVuIHRoZSB1bmRlcmx5aW5nIHNvY2tldCBkcm9wcyBhbmQgdGhlIHNlc3Npb24gaXNcbiAgICogbW92ZWQgaW50byB0aGUgcGF1c2VkL2dyYWNlIHJlZ2lzdHJ5LiBFaXRoZXIgYG9uUmVzdW1lYCBmaXJlc1xuICAgKiBvbiBzdWNjZXNzZnVsIGNsaWVudCByZWNvbm5lY3QsIG9yIGB1bnN1YnNjcmliZWQoKWAgZmlyZXMgd2hlblxuICAgKiB0aGUgZ3JhY2Ugd2luZG93IGV4cGlyZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBDb21wbGV0ZXMgYWZ0ZXIgZGlzY29ubmVjdCBoYW5kbGluZy5cbiAgICovXG4gIG9uRGlzY29ubmVjdCgpIHt9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBhZnRlciBhIGNsaWVudCByZWNvbm5lY3QgKyBgc2Vzc2lvbi1yZXN1bWVgIHJlYmluZHMgdGhpc1xuICAgKiBzdWJzY3JpcHRpb24gdG8gYSBuZXcgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIHJlc3VtZSBoYW5kbGluZy5cbiAgICovXG4gIG9uUmVzdW1lKCkge31cblxuICAvKipcbiAgICogQ2FsbGVkIHdoZW4gdGhlIGNsaWVudCBzZW5kcyB1cGRhdGVkIG1ldGFkYXRhIChlLmcuIGFmdGVyXG4gICAqIHNpZ24taW4gLyBsb2NhbGUgY2hhbmdlKS4gT3ZlcnJpZGUgdG8gcmVhY3QgdG8gc2Vzc2lvbi1sZXZlbFxuICAgKiBtZXRhZGF0YSB1cGRhdGVzLlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldFBhcmFtc30gX21ldGFkYXRhIC0gVXBkYXRlZCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIENvbXBsZXRlcyBhZnRlciBtZXRhZGF0YS1jaGFuZ2UgaGFuZGxpbmcuXG4gICAqL1xuICBvbk1ldGFkYXRhQ2hhbmdlZChfbWV0YWRhdGEpIHt9XG5cbiAgLyoqXG4gICAqIEJyb2FkY2FzdCByb3V0aW5nIGZpbHRlci4gQ2FsbGVkIGJ5IGBicm9hZGNhc3RUb0NoYW5uZWxgIGZvclxuICAgKiBlYWNoIGxpdmUgc3Vic2NyaXB0aW9uIOKAlCByZXR1cm5pbmcgdHJ1ZSBkZWxpdmVycyB0aGUgYm9keSB2aWFcbiAgICogYHNlbmRNZXNzYWdlYC4gRGVmYXVsdCBtYXRjaGVzIGFsbCBicm9hZGNhc3RzIHJlZ2FyZGxlc3Mgb2ZcbiAgICogcGFyYW1zOyBvdmVycmlkZSBmb3IgcGVyLXN1YnNjcmliZXIgZmlsdGVyaW5nLlxuICAgKiBAcGFyYW0gey4uLldlYnNvY2tldEpzb25WYWx1ZX0gX2Jyb2FkY2FzdEFyZ3MgLSBQYXJhbXMgZm9yd2FyZGVkIGZyb20gYGJyb2FkY2FzdFRvQ2hhbm5lbGAgKGlnbm9yZWQgYnkgZGVmYXVsdCkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFRydWUgdG8gZGVsaXZlciB0aGUgYnJvYWRjYXN0IHRvIHRoaXMgc3Vic2NyaWJlci5cbiAgICovXG4gIG1hdGNoZXMoLi4uX2Jyb2FkY2FzdEFyZ3MpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhbml0aXplZCBkaWFnbm9zdGljcyBmb3IgZGVidWcgc25hcHNob3RzLlxuICAgKiBTdWJjbGFzc2VzIGNhbiBvdmVycmlkZSB0byBleHBvc2Ugbm9uLXNlbnNpdGl2ZSByb3V0aW5nIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IERlYnVnLXNhZmUgc3Vic2NyaXB0aW9uIGRldGFpbHMuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkgeyByZXR1cm4ge30gfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBhIG1hdGNoZWQgYnJvYWRjYXN0IHRvIHRoaXMgc3Vic2NyaWJlci4gU3ViY2xhc3NlcyBjYW5cbiAgICogb3ZlcnJpZGUgd2hlbiB0aGUgb3V0Ym91bmQgYm9keSBtdXN0IGJlIHRhaWxvcmVkIHRvIHN1YnNjcmlwdGlvblxuICAgKiBwYXJhbXMgYmVmb3JlIHNlbmRpbmcuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IHBheWxvYWQgb2ZmZXJlZCB0byB0aGlzIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgc2VydmVyLXNpZGUgYnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIGJyb2FkY2FzdCBkZWxpdmVyeS5cbiAgICovXG4gIGRlbGl2ZXJCcm9hZGNhc3QoYm9keSwgbWV0YSkge1xuICAgIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIGBjaGFubmVsLW1lc3NhZ2VgIGZyYW1lIHRvIFRISVMgc3Vic2NyaWJlciBvbmx5LlxuICAgKiBXaGVuIGBtZXRhLmV2ZW50SWRgIGlzIHByb3ZpZGVkLCB0aGUgY2xpZW50IHJlY2VpdmVzIGl0IHNvIGl0XG4gICAqIGNhbiB0cmFjayBpdHMgY2hlY2twb2ludCBmb3IgYGxhc3RFdmVudElkYCByZXBsYXkgb24gcmVjb25uZWN0LlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldEpzb25WYWx1ZX0gYm9keSAtIENoYW5uZWwgcGF5bG9hZCB0byBzZW5kIHRvIHRoZSBzdWJzY3JpYmVkIGNsaWVudC5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgc2VydmVyLXNpZGUgYnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNlbmRNZXNzYWdlKGJvZHksIG1ldGEpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzZW5kTWVzc2FnZSBvbiBjbG9zZWQgc3Vic2NyaXB0aW9uICR7dGhpcy5zdWJzY3JpcHRpb25JZH1gKVxuICAgIH1cblxuICAgIHRoaXMuc2Vzc2lvbi5zZW5kSnNvbih7XG4gICAgICB0eXBlOiBcImNoYW5uZWwtbWVzc2FnZVwiLFxuICAgICAgc3Vic2NyaXB0aW9uSWQ6IHRoaXMuc3Vic2NyaXB0aW9uSWQsXG4gICAgICBib2R5LFxuICAgICAgLi4uKG1ldGE/LmV2ZW50SWQgPyB7ZXZlbnRJZDogbWV0YS5ldmVudElkfSA6IHt9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNoYW5uZWwgaXMgY2xvc2VkLlxuICAgKi9cbiAgaXNDbG9zZWQoKSB7IHJldHVybiB0aGlzLl9jbG9zZWQgfVxufVxuIl19
// @ts-check
import WebSocket from "ws";
import { decodeBrokerValue, encodeBrokerValue } from "./shared-transaction-codec.js";
export default class SharedTransactionBrokerClient {
    /**
     * Creates a broker client.
     * @param {{address: string, capability: string, databaseIdentifier: string, reuseKey?: string}} args - Broker coordinates.
     */
    constructor({ address, capability, databaseIdentifier, reuseKey }) {
        this.capability = capability;
        this.databaseIdentifier = databaseIdentifier;
        this.reuseKey = reuseKey;
        this.nextRequestId = 1;
        /** @type {Map<number, {reject: (error: Error) => void, resolve: (value: ReturnType<typeof decodeBrokerValue>) => void}>} */
        this.pending = new Map();
        this.socket = new WebSocket(address);
        this.connectionPromise = new Promise((resolve, reject) => {
            this.socket.once("open", resolve);
            this.socket.once("error", reject);
        });
        this.socket.on("message", (data) => this.handleMessage(`${data}`));
        this.socket.once("close", () => this.rejectPending(new Error("Shared transaction broker connection closed")));
        this.socket.on("error", (error) => this.rejectPending(error));
    }
    /**
     * Waits for the websocket to open.
     * @returns {Promise<void>} - Resolves after the websocket opens.
     */
    async connected() { await this.connectionPromise; }
    /**
     * Calls one physical connection operation.
     * @param {string} method - Broker operation.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Operation arguments.
     * @returns {Promise<ReturnType<typeof decodeBrokerValue>>} - Remote result.
     */
    async call(method, args) {
        await this.connected();
        if (this.socket.readyState !== WebSocket.OPEN)
            throw new Error("Shared transaction broker connection is closed");
        const requestId = this.nextRequestId++;
        const response = new Promise((resolve, reject) => this.pending.set(requestId, { resolve, reject }));
        this.socket.send(JSON.stringify({
            requestId,
            capability: this.capability,
            databaseIdentifier: this.databaseIdentifier,
            reuseKey: this.reuseKey,
            method,
            args: encodeBrokerValue(args)
        }), (error) => {
            if (!error)
                return;
            const pending = this.pending.get(requestId);
            this.pending.delete(requestId);
            pending?.reject(error);
        });
        return await response;
    }
    /**
     * Handles a correlated broker response.
     * @param {string} serialized - Serialized response.
     * @returns {void} - No return value.
     */
    handleMessage(serialized) {
        const response = /** @type {{requestId: number, result?: import("./shared-transaction-codec.js").EncodedBrokerValue, error?: import("./shared-transaction-codec.js").EncodedBrokerValue}} */ (JSON.parse(serialized));
        const pending = this.pending.get(response.requestId);
        if (!pending)
            return;
        this.pending.delete(response.requestId);
        if (response.error) {
            const error = decodeBrokerValue(response.error);
            pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
        else if (response.result) {
            pending.resolve(decodeBrokerValue(response.result));
        }
        else {
            pending.reject(new Error("Invalid shared transaction broker response"));
        }
    }
    /**
     * Rejects every pending call after disconnect.
     * @param {Error} error - Disconnect error.
     * @returns {void} - No return value.
     */
    rejectPending(error) {
        for (const { reject } of this.pending.values())
            reject(error);
        this.pending.clear();
    }
    /**
     * Closes the client without touching the parent connection.
     * @returns {Promise<void>} - Resolves after the websocket closes.
     */
    async close() {
        if (this.socket.readyState === WebSocket.CLOSED)
            return;
        if (this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.terminate();
            return;
        }
        await new Promise((resolve) => {
            this.socket.once("close", resolve);
            this.socket.close();
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkLXRyYW5zYWN0aW9uLWJyb2tlci1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tYnJva2VyLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0sSUFBSSxDQUFBO0FBQzFCLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxpQkFBaUIsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBRXBGLE1BQU0sQ0FBQyxPQUFPLE9BQU8sNkJBQTZCO0lBQ2hEOzs7T0FHRztJQUNILFlBQVksRUFBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLGtCQUFrQixFQUFFLFFBQVEsRUFBQztRQUM3RCxJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtRQUM1QixJQUFJLENBQUMsa0JBQWtCLEdBQUcsa0JBQWtCLENBQUE7UUFDNUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUE7UUFDeEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxDQUFDLENBQUE7UUFDdEIsNEhBQTRIO1FBQzVILElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ3BDLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUN2RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUE7WUFDakMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQ25DLENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsSUFB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RUFBRSxDQUFDO1lBQzNCLE9BQU8sQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7UUFDckQsQ0FBQzthQUFNLENBQUM7WUFDTixPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLDRDQUE0QyxDQUFDLENBQUMsQ0FBQTtRQUN6RSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsS0FBSztRQUNqQixLQUFLLE1BQU0sRUFBQyxNQUFNLEVBQUMsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRTtZQUFFLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUMzRCxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSztRQUNULElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEtBQUssU0FBUyxDQUFDLE1BQU07WUFBRSxPQUFNO1FBQ3ZELElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEtBQUssU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ3BELElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUE7WUFDdkIsT0FBTTtRQUNSLENBQUM7UUFDRCxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDNUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1lBQ2xDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDckIsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFdlYlNvY2tldCBmcm9tIFwid3NcIlxuaW1wb3J0IHsgZGVjb2RlQnJva2VyVmFsdWUsIGVuY29kZUJyb2tlclZhbHVlIH0gZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLWNvZGVjLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDbGllbnQge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIGJyb2tlciBjbGllbnQuXG4gICAqIEBwYXJhbSB7e2FkZHJlc3M6IHN0cmluZywgY2FwYWJpbGl0eTogc3RyaW5nLCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgcmV1c2VLZXk/OiBzdHJpbmd9fSBhcmdzIC0gQnJva2VyIGNvb3JkaW5hdGVzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FkZHJlc3MsIGNhcGFiaWxpdHksIGRhdGFiYXNlSWRlbnRpZmllciwgcmV1c2VLZXl9KSB7XG4gICAgdGhpcy5jYXBhYmlsaXR5ID0gY2FwYWJpbGl0eVxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5yZXVzZUtleSA9IHJldXNlS2V5XG4gICAgdGhpcy5uZXh0UmVxdWVzdElkID0gMVxuICAgIC8qKiBAdHlwZSB7TWFwPG51bWJlciwge3JlamVjdDogKGVycm9yOiBFcnJvcikgPT4gdm9pZCwgcmVzb2x2ZTogKHZhbHVlOiBSZXR1cm5UeXBlPHR5cGVvZiBkZWNvZGVCcm9rZXJWYWx1ZT4pID0+IHZvaWR9Pn0gKi9cbiAgICB0aGlzLnBlbmRpbmcgPSBuZXcgTWFwKClcbiAgICB0aGlzLnNvY2tldCA9IG5ldyBXZWJTb2NrZXQoYWRkcmVzcylcbiAgICB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5zb2NrZXQub25jZShcIm9wZW5cIiwgcmVzb2x2ZSlcbiAgICAgIHRoaXMuc29ja2V0Lm9uY2UoXCJlcnJvclwiLCByZWplY3QpXG4gICAgfSlcbiAgICB0aGlzLnNvY2tldC5vbihcIm1lc3NhZ2VcIiwgKGRhdGEpID0+IHRoaXMuaGFuZGxlTWVzc2FnZShgJHtkYXRhfWApKVxuICAgIHRoaXMuc29ja2V0Lm9uY2UoXCJjbG9zZVwiLCAoKSA9PiB0aGlzLnJlamVjdFBlbmRpbmcobmV3IEVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjb25uZWN0aW9uIGNsb3NlZFwiKSkpXG4gICAgdGhpcy5zb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHRoaXMucmVqZWN0UGVuZGluZyhlcnJvcikpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIHRoZSB3ZWJzb2NrZXQgdG8gb3Blbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHdlYnNvY2tldCBvcGVucy5cbiAgICovXG4gIGFzeW5jIGNvbm5lY3RlZCgpIHsgYXdhaXQgdGhpcy5jb25uZWN0aW9uUHJvbWlzZSB9XG5cbiAgLyoqXG4gICAqIENhbGxzIG9uZSBwaHlzaWNhbCBjb25uZWN0aW9uIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZCAtIEJyb2tlciBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gT3BlcmF0aW9uIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgZGVjb2RlQnJva2VyVmFsdWU+Pn0gLSBSZW1vdGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2FsbChtZXRob2QsIGFyZ3MpIHtcbiAgICBhd2FpdCB0aGlzLmNvbm5lY3RlZCgpXG4gICAgaWYgKHRoaXMuc29ja2V0LnJlYWR5U3RhdGUgIT09IFdlYlNvY2tldC5PUEVOKSB0aHJvdyBuZXcgRXJyb3IoXCJTaGFyZWQgdHJhbnNhY3Rpb24gYnJva2VyIGNvbm5lY3Rpb24gaXMgY2xvc2VkXCIpXG4gICAgY29uc3QgcmVxdWVzdElkID0gdGhpcy5uZXh0UmVxdWVzdElkKytcbiAgICBjb25zdCByZXNwb25zZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHRoaXMucGVuZGluZy5zZXQocmVxdWVzdElkLCB7cmVzb2x2ZSwgcmVqZWN0fSkpXG5cbiAgICB0aGlzLnNvY2tldC5zZW5kKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIHJlcXVlc3RJZCxcbiAgICAgIGNhcGFiaWxpdHk6IHRoaXMuY2FwYWJpbGl0eSxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICByZXVzZUtleTogdGhpcy5yZXVzZUtleSxcbiAgICAgIG1ldGhvZCxcbiAgICAgIGFyZ3M6IGVuY29kZUJyb2tlclZhbHVlKGFyZ3MpXG4gICAgfSksIChlcnJvcikgPT4ge1xuICAgICAgaWYgKCFlcnJvcikgcmV0dXJuXG4gICAgICBjb25zdCBwZW5kaW5nID0gdGhpcy5wZW5kaW5nLmdldChyZXF1ZXN0SWQpXG4gICAgICB0aGlzLnBlbmRpbmcuZGVsZXRlKHJlcXVlc3RJZClcbiAgICAgIHBlbmRpbmc/LnJlamVjdChlcnJvcilcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIGNvcnJlbGF0ZWQgYnJva2VyIHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2VyaWFsaXplZCAtIFNlcmlhbGl6ZWQgcmVzcG9uc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGhhbmRsZU1lc3NhZ2Uoc2VyaWFsaXplZCkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gLyoqIEB0eXBlIHt7cmVxdWVzdElkOiBudW1iZXIsIHJlc3VsdD86IGltcG9ydChcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLWNvZGVjLmpzXCIpLkVuY29kZWRCcm9rZXJWYWx1ZSwgZXJyb3I/OiBpbXBvcnQoXCIuL3NoYXJlZC10cmFuc2FjdGlvbi1jb2RlYy5qc1wiKS5FbmNvZGVkQnJva2VyVmFsdWV9fSAqLyAoSlNPTi5wYXJzZShzZXJpYWxpemVkKSlcbiAgICBjb25zdCBwZW5kaW5nID0gdGhpcy5wZW5kaW5nLmdldChyZXNwb25zZS5yZXF1ZXN0SWQpXG4gICAgaWYgKCFwZW5kaW5nKSByZXR1cm5cbiAgICB0aGlzLnBlbmRpbmcuZGVsZXRlKHJlc3BvbnNlLnJlcXVlc3RJZClcblxuICAgIGlmIChyZXNwb25zZS5lcnJvcikge1xuICAgICAgY29uc3QgZXJyb3IgPSBkZWNvZGVCcm9rZXJWYWx1ZShyZXNwb25zZS5lcnJvcilcbiAgICAgIHBlbmRpbmcucmVqZWN0KGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICB9IGVsc2UgaWYgKHJlc3BvbnNlLnJlc3VsdCkge1xuICAgICAgcGVuZGluZy5yZXNvbHZlKGRlY29kZUJyb2tlclZhbHVlKHJlc3BvbnNlLnJlc3VsdCkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHBlbmRpbmcucmVqZWN0KG5ldyBFcnJvcihcIkludmFsaWQgc2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciByZXNwb25zZVwiKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBldmVyeSBwZW5kaW5nIGNhbGwgYWZ0ZXIgZGlzY29ubmVjdC5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBEaXNjb25uZWN0IGVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZWplY3RQZW5kaW5nKGVycm9yKSB7XG4gICAgZm9yIChjb25zdCB7cmVqZWN0fSBvZiB0aGlzLnBlbmRpbmcudmFsdWVzKCkpIHJlamVjdChlcnJvcilcbiAgICB0aGlzLnBlbmRpbmcuY2xlYXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyB0aGUgY2xpZW50IHdpdGhvdXQgdG91Y2hpbmcgdGhlIHBhcmVudCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgd2Vic29ja2V0IGNsb3Nlcy5cbiAgICovXG4gIGFzeW5jIGNsb3NlKCkge1xuICAgIGlmICh0aGlzLnNvY2tldC5yZWFkeVN0YXRlID09PSBXZWJTb2NrZXQuQ0xPU0VEKSByZXR1cm5cbiAgICBpZiAodGhpcy5zb2NrZXQucmVhZHlTdGF0ZSA9PT0gV2ViU29ja2V0LkNPTk5FQ1RJTkcpIHtcbiAgICAgIHRoaXMuc29ja2V0LnRlcm1pbmF0ZSgpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMuc29ja2V0Lm9uY2UoXCJjbG9zZVwiLCByZXNvbHZlKVxuICAgICAgdGhpcy5zb2NrZXQuY2xvc2UoKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==
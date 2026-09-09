// @ts-check
import EventEmitter from "../utils/event-emitter.js";
import { createReadStream } from "node:fs";
import Logger from "../logger.js";
/**
 * Runs summarize socket chunk.
 * @param {Buffer} chunk - Incoming socket data.
 * @returns {object} - Chunk debug metadata.
 */
function summarizeSocketChunk(chunk) {
    const preview = chunk.toString("latin1", 0, Math.min(chunk.length, 160)).replaceAll("\r", "\\r").replaceAll("\n", "\\n");
    return {
        length: chunk.length,
        preview
    };
}
export default class ServerClient {
    events = new EventEmitter();
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("net").Socket} args.socket - Socket instance.
     * @param {number} args.clientCount - Client count.
     */
    constructor({ configuration, socket, clientCount }) {
        if (!configuration)
            throw new Error("No configuration given");
        this.configuration = configuration;
        this.logger = new Logger(this);
        this.socket = socket;
        this.clientCount = clientCount;
        this.remoteAddress = socket.remoteAddress;
        this.closeEmitted = false;
        socket.on("end", this.onSocketEnd);
        socket.on("error", this.onSocketError);
        socket.on("close", this.onSocketClose);
        socket.on("timeout", this.onSocketTimeout);
        socket.on("drain", this.onSocketDrain);
        socket.on("finish", this.onSocketFinish);
    }
    /**
     * Runs listen.
     * @returns {void} - No return value.
     */
    listen() {
        this.logger.debug(() => ["Socket listen", {
                clientCount: this.clientCount,
                remoteAddress: this.socket.remoteAddress,
                remoteFamily: this.socket.remoteFamily,
                remotePort: this.socket.remotePort
            }]);
        this.socket.on("data", this.onSocketData);
    }
    /**
     * Runs end.
     * @returns {Promise<void>} - Resolves when complete.
     */
    end() {
        return new Promise((resolve) => {
            if (this.socket.destroyed || this.socket.writableEnded || this.socket.writable === false) {
                resolve(undefined);
                return;
            }
            this.socket.once("close", () => resolve(undefined));
            this.socket.end();
        });
    }
    /**
     * Immediately destroys the socket and all transport-owned write buffers.
     * @param {Error} error - Destruction reason.
     * @returns {void}
     */
    destroy(error) {
        if (!this.socket.destroyed)
            this.socket.destroy(error);
    }
    /**
     * On socket data.
     * @param {Buffer} chunk - Chunk.
     * @returns {void} - No return value.
     */
    onSocketData = (chunk) => {
        this.logger.debugLowLevel(() => `Socket ${this.clientCount}: ${chunk}`);
        this.logger.debug(() => ["Socket data received", { clientCount: this.clientCount, ...summarizeSocketChunk(chunk) }]);
        if (!this.worker)
            throw new Error("No worker");
        this.worker.postMessage({
            command: "clientWrite",
            chunk,
            clientCount: this.clientCount
        });
    };
    /**
     * On socket end.
     * @returns {void} - No return value.
     */
    onSocketEnd = () => {
        this.logger.debugLowLevel(() => `Socket ${this.clientCount} end`);
        this.emitClose();
    };
    /**
     * On socket close.
     * @returns {void} - No return value.
     */
    onSocketClose = () => {
        this.logger.debugLowLevel(() => `Socket ${this.clientCount} close`);
        this.emitClose();
    };
    /**
     * On socket timeout.
     * @returns {void} - No return value.
     */
    onSocketTimeout = () => {
        this.logger.debug(() => ["Socket timeout", { clientCount: this.clientCount }]);
    };
    /**
     * On socket drain.
     * @returns {void} - No return value.
     */
    onSocketDrain = () => {
        this.logger.debug(() => ["Socket drain", { clientCount: this.clientCount }]);
    };
    /**
     * On socket finish.
     * @returns {void} - No return value.
     */
    onSocketFinish = () => {
        this.logger.debug(() => ["Socket finish", { clientCount: this.clientCount }]);
    };
    /**
     * On socket error.
     * @param {Error} error - Socket error.
     * @returns {void} - No return value.
     */
    onSocketError = (error) => {
        const errorCode = /** @type {{code?: string}} */ (error).code;
        this.logger.error(() => [`Socket ${this.clientCount} error`, errorCode || error.message]);
        this.emitClose();
        if (!this.socket.destroyed) {
            this.socket.destroy(error);
        }
    };
    /**
     * Runs emit close.
     * @returns {void} - No return value.
     */
    emitClose() {
        if (this.closeEmitted)
            return;
        this.closeEmitted = true;
        this.events.emit("close", this);
    }
    /**
     * Runs send.
     * @param {string | Uint8Array} data - Data payload.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async send(data) {
        return new Promise((resolve) => {
            this.logger.debugLowLevel(() => `Send ${data}`);
            if (this.socket.destroyed || this.socket.writableEnded || this.socket.writable === false) {
                this.logger.debugLowLevel(() => "Skipping send because socket is closed");
                resolve();
                return;
            }
            let done = false;
            const finish = () => {
                if (done)
                    return;
                done = true;
                this.socket.off("error", onWriteError);
                resolve();
            };
            const onWriteError = (/** @type {Error} */ error) => {
                const errorCode = /** @type {{code?: string}} */ (error).code;
                this.logger.error(() => [`Socket ${this.clientCount} write error`, errorCode || error.message]);
                finish();
            };
            this.socket.once("error", onWriteError);
            this.socket.write(data, (error) => {
                if (error) {
                    onWriteError(error);
                    return;
                }
                finish();
            });
        });
    }
    /**
     * Streams a file to the socket while respecting socket write backpressure.
     * @param {string} filePath - File path.
     * @param {boolean} [sendBody] - Whether to read and send the file body.
     * @returns {Promise<"completed" | "aborted">} - Transfer result.
     */
    async sendFile(filePath, sendBody = true) {
        if (this.socket.destroyed || this.socket.writableEnded || this.socket.writable === false)
            return "aborted";
        if (!sendBody)
            return "completed";
        const readStream = createReadStream(filePath);
        let aborted = false;
        const abort = () => {
            aborted = true;
            readStream.destroy();
        };
        this.socket.once("close", abort);
        this.socket.once("error", abort);
        try {
            for await (const chunk of readStream) {
                if (aborted || !await this.writeFileChunk(chunk))
                    return "aborted";
            }
            return aborted ? "aborted" : "completed";
        }
        catch (error) {
            this.logger.error(() => [`Socket ${this.clientCount} file response failed`, filePath, error]);
            if (!this.socket.destroyed)
                this.socket.destroy();
            return "aborted";
        }
        finally {
            this.socket.off("close", abort);
            this.socket.off("error", abort);
            readStream.destroy();
        }
    }
    /**
     * Writes one file chunk and waits for both write acceptance and drain when required.
     * @param {Buffer | Uint8Array} chunk - File chunk.
     * @returns {Promise<boolean>} - Whether the chunk was accepted before the socket aborted.
     */
    writeFileChunk(chunk) {
        return new Promise((resolve) => {
            let callbackCompleted = false;
            let drained = false;
            let settled = false;
            const cleanup = () => {
                this.socket.off("close", onAbort);
                this.socket.off("error", onAbort);
                this.socket.off("drain", onDrain);
            };
            const finish = (/** @type {boolean} */ result) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                resolve(result);
            };
            const finishIfReady = () => {
                if (callbackCompleted && drained)
                    finish(true);
            };
            const onAbort = () => finish(false);
            const onDrain = () => {
                drained = true;
                finishIfReady();
            };
            this.socket.once("close", onAbort);
            this.socket.once("error", onAbort);
            this.socket.once("drain", onDrain);
            try {
                const accepted = this.socket.write(chunk, (error) => {
                    if (error) {
                        finish(false);
                        return;
                    }
                    callbackCompleted = true;
                    finishIfReady();
                });
                drained = accepted;
                if (accepted)
                    this.socket.off("drain", onDrain);
                finishIfReady();
            }
            catch (error) {
                this.logger.error(() => [`Socket ${this.clientCount} file write failed`, error]);
                finish(false);
            }
        });
    }
    /**
     * Runs set worker.
     * @param {import("worker_threads").Worker} newWorker - New worker.
     * @returns {void} - No return value.
     */
    setWorker(newWorker) {
        this.worker = newWorker;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci9zZXJ2ZXItY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSwyQkFBMkIsQ0FBQTtBQUNwRCxPQUFPLEVBQUMsZ0JBQWdCLEVBQUMsTUFBTSxTQUFTLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBRWpDOzs7O0dBSUc7QUFDSCxTQUFTLG9CQUFvQixDQUFDLEtBQUs7SUFDakMsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQTtJQUV4SCxPQUFPO1FBQ0wsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNO1FBQ3BCLE9BQU87S0FDUixDQUFBO0FBQ0gsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sWUFBWTtJQUMvQixNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtJQUUzQjs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUM7UUFDOUMsSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUE7UUFFN0QsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsV0FBVyxHQUFHLFdB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LENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsU0FBUyxDQUFDLFNBQVM7UUFDakIsSUFBSSxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUE7SUFDekIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IHtjcmVhdGVSZWFkU3RyZWFtfSBmcm9tIFwibm9kZTpmc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuXG4vKipcbiAqIFJ1bnMgc3VtbWFyaXplIHNvY2tldCBjaHVuay5cbiAqIEBwYXJhbSB7QnVmZmVyfSBjaHVuayAtIEluY29taW5nIHNvY2tldCBkYXRhLlxuICogQHJldHVybnMge29iamVjdH0gLSBDaHVuayBkZWJ1ZyBtZXRhZGF0YS5cbiAqL1xuZnVuY3Rpb24gc3VtbWFyaXplU29ja2V0Q2h1bmsoY2h1bmspIHtcbiAgY29uc3QgcHJldmlldyA9IGNodW5rLnRvU3RyaW5nKFwibGF0aW4xXCIsIDAsIE1hdGgubWluKGNodW5rLmxlbmd0aCwgMTYwKSkucmVwbGFjZUFsbChcIlxcclwiLCBcIlxcXFxyXCIpLnJlcGxhY2VBbGwoXCJcXG5cIiwgXCJcXFxcblwiKVxuXG4gIHJldHVybiB7XG4gICAgbGVuZ3RoOiBjaHVuay5sZW5ndGgsXG4gICAgcHJldmlld1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNlcnZlckNsaWVudCB7XG4gIGV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJuZXRcIikuU29ja2V0fSBhcmdzLnNvY2tldCAtIFNvY2tldCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY2xpZW50Q291bnQgLSBDbGllbnQgY291bnQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgc29ja2V0LCBjbGllbnRDb3VudH0pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW5cIilcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLnNvY2tldCA9IHNvY2tldFxuICAgIHRoaXMuY2xpZW50Q291bnQgPSBjbGllbnRDb3VudFxuICAgIHRoaXMucmVtb3RlQWRkcmVzcyA9IHNvY2tldC5yZW1vdGVBZGRyZXNzXG4gICAgdGhpcy5jbG9zZUVtaXR0ZWQgPSBmYWxzZVxuXG4gICAgc29ja2V0Lm9uKFwiZW5kXCIsIHRoaXMub25Tb2NrZXRFbmQpXG4gICAgc29ja2V0Lm9uKFwiZXJyb3JcIiwgdGhpcy5vblNvY2tldEVycm9yKVxuICAgIHNvY2tldC5vbihcImNsb3NlXCIsIHRoaXMub25Tb2NrZXRDbG9zZSlcbiAgICBzb2NrZXQub24oXCJ0aW1lb3V0XCIsIHRoaXMub25Tb2NrZXRUaW1lb3V0KVxuICAgIHNvY2tldC5vbihcImRyYWluXCIsIHRoaXMub25Tb2NrZXREcmFpbilcbiAgICBzb2NrZXQub24oXCJmaW5pc2hcIiwgdGhpcy5vblNvY2tldEZpbmlzaClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpc3Rlbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbGlzdGVuKCkge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlNvY2tldCBsaXN0ZW5cIiwge1xuICAgICAgY2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsXG4gICAgICByZW1vdGVBZGRyZXNzOiB0aGlzLnNvY2tldC5yZW1vdGVBZGRyZXNzLFxuICAgICAgcmVtb3RlRmFtaWx5OiB0aGlzLnNvY2tldC5yZW1vdGVGYW1pbHksXG4gICAgICByZW1vdGVQb3J0OiB0aGlzLnNvY2tldC5yZW1vdGVQb3J0XG4gICAgfV0pXG4gICAgdGhpcy5zb2NrZXQub24oXCJkYXRhXCIsIHRoaXMub25Tb2NrZXREYXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgZW5kKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgaWYgKHRoaXMuc29ja2V0LmRlc3Ryb3llZCB8fCB0aGlzLnNvY2tldC53cml0YWJsZUVuZGVkIHx8IHRoaXMuc29ja2V0LndyaXRhYmxlID09PSBmYWxzZSkge1xuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRoaXMuc29ja2V0Lm9uY2UoXCJjbG9zZVwiLCAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpXG4gICAgICB0aGlzLnNvY2tldC5lbmQoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSW1tZWRpYXRlbHkgZGVzdHJveXMgdGhlIHNvY2tldCBhbmQgYWxsIHRyYW5zcG9ydC1vd25lZCB3cml0ZSBidWZmZXJzLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIERlc3RydWN0aW9uIHJlYXNvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBkZXN0cm95KGVycm9yKSB7XG4gICAgaWYgKCF0aGlzLnNvY2tldC5kZXN0cm95ZWQpIHRoaXMuc29ja2V0LmRlc3Ryb3koZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogT24gc29ja2V0IGRhdGEuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBjaHVuayAtIENodW5rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBvblNvY2tldERhdGEgPSAoY2h1bmspID0+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBTb2NrZXQgJHt0aGlzLmNsaWVudENvdW50fTogJHtjaHVua31gKVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlNvY2tldCBkYXRhIHJlY2VpdmVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgLi4uc3VtbWFyaXplU29ja2V0Q2h1bmsoY2h1bmspfV0pXG5cbiAgICBpZiAoIXRoaXMud29ya2VyKSB0aHJvdyBuZXcgRXJyb3IoXCJObyB3b3JrZXJcIilcblxuICAgIHRoaXMud29ya2VyLnBvc3RNZXNzYWdlKHtcbiAgICAgIGNvbW1hbmQ6IFwiY2xpZW50V3JpdGVcIixcbiAgICAgIGNodW5rLFxuICAgICAgY2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIHNvY2tldCBlbmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uU29ja2V0RW5kID0gKCkgPT4ge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gYFNvY2tldCAke3RoaXMuY2xpZW50Q291bnR9IGVuZGApXG4gICAgdGhpcy5lbWl0Q2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIHNvY2tldCBjbG9zZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgb25Tb2NrZXRDbG9zZSA9ICgpID0+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBTb2NrZXQgJHt0aGlzLmNsaWVudENvdW50fSBjbG9zZWApXG4gICAgdGhpcy5lbWl0Q2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIHNvY2tldCB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBvblNvY2tldFRpbWVvdXQgPSAoKSA9PiB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wiU29ja2V0IHRpbWVvdXRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50fV0pXG4gIH1cblxuICAvKipcbiAgICogT24gc29ja2V0IGRyYWluLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBvblNvY2tldERyYWluID0gKCkgPT4ge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlNvY2tldCBkcmFpblwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnR9XSlcbiAgfVxuXG4gIC8qKlxuICAgKiBPbiBzb2NrZXQgZmluaXNoLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBvblNvY2tldEZpbmlzaCA9ICgpID0+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJTb2NrZXQgZmluaXNoXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudH1dKVxuICB9XG5cblxuICAvKipcbiAgICogT24gc29ja2V0IGVycm9yLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIFNvY2tldCBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgb25Tb2NrZXRFcnJvciA9IChlcnJvcikgPT4ge1xuICAgIGNvbnN0IGVycm9yQ29kZSA9IC8qKiBAdHlwZSB7e2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpLmNvZGVcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgU29ja2V0ICR7dGhpcy5jbGllbnRDb3VudH0gZXJyb3JgLCBlcnJvckNvZGUgfHwgZXJyb3IubWVzc2FnZV0pXG4gICAgdGhpcy5lbWl0Q2xvc2UoKVxuXG4gICAgaWYgKCF0aGlzLnNvY2tldC5kZXN0cm95ZWQpIHtcbiAgICAgIHRoaXMuc29ja2V0LmRlc3Ryb3koZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW1pdCBjbG9zZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZW1pdENsb3NlKCkge1xuICAgIGlmICh0aGlzLmNsb3NlRW1pdHRlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmNsb3NlRW1pdHRlZCA9IHRydWVcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIiwgdGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgVWludDhBcnJheX0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNlbmQoZGF0YSkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBgU2VuZCAke2RhdGF9YClcbiAgICAgIGlmICh0aGlzLnNvY2tldC5kZXN0cm95ZWQgfHwgdGhpcy5zb2NrZXQud3JpdGFibGVFbmRlZCB8fCB0aGlzLnNvY2tldC53cml0YWJsZSA9PT0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBcIlNraXBwaW5nIHNlbmQgYmVjYXVzZSBzb2NrZXQgaXMgY2xvc2VkXCIpXG4gICAgICAgIHJlc29sdmUoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgbGV0IGRvbmUgPSBmYWxzZVxuXG4gICAgICBjb25zdCBmaW5pc2ggPSAoKSA9PiB7XG4gICAgICAgIGlmIChkb25lKSByZXR1cm5cblxuICAgICAgICBkb25lID0gdHJ1ZVxuICAgICAgICB0aGlzLnNvY2tldC5vZmYoXCJlcnJvclwiLCBvbldyaXRlRXJyb3IpXG4gICAgICAgIHJlc29sdmUoKVxuICAgICAgfVxuICAgICAgY29uc3Qgb25Xcml0ZUVycm9yID0gKC8qKiBAdHlwZSB7RXJyb3J9ICovIGVycm9yKSA9PiB7XG4gICAgICAgIGNvbnN0IGVycm9yQ29kZSA9IC8qKiBAdHlwZSB7e2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpLmNvZGVcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYFNvY2tldCAke3RoaXMuY2xpZW50Q291bnR9IHdyaXRlIGVycm9yYCwgZXJyb3JDb2RlIHx8IGVycm9yLm1lc3NhZ2VdKVxuICAgICAgICBmaW5pc2goKVxuICAgICAgfVxuXG4gICAgICB0aGlzLnNvY2tldC5vbmNlKFwiZXJyb3JcIiwgb25Xcml0ZUVycm9yKVxuICAgICAgdGhpcy5zb2NrZXQud3JpdGUoZGF0YSwgKGVycm9yKSA9PiB7XG4gICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgIG9uV3JpdGVFcnJvcihlcnJvcilcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGZpbmlzaCgpXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3RyZWFtcyBhIGZpbGUgdG8gdGhlIHNvY2tldCB3aGlsZSByZXNwZWN0aW5nIHNvY2tldCB3cml0ZSBiYWNrcHJlc3N1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbc2VuZEJvZHldIC0gV2hldGhlciB0byByZWFkIGFuZCBzZW5kIHRoZSBmaWxlIGJvZHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIj59IC0gVHJhbnNmZXIgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc2VuZEZpbGUoZmlsZVBhdGgsIHNlbmRCb2R5ID0gdHJ1ZSkge1xuICAgIGlmICh0aGlzLnNvY2tldC5kZXN0cm95ZWQgfHwgdGhpcy5zb2NrZXQud3JpdGFibGVFbmRlZCB8fCB0aGlzLnNvY2tldC53cml0YWJsZSA9PT0gZmFsc2UpIHJldHVybiBcImFib3J0ZWRcIlxuICAgIGlmICghc2VuZEJvZHkpIHJldHVybiBcImNvbXBsZXRlZFwiXG5cbiAgICBjb25zdCByZWFkU3RyZWFtID0gY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aClcbiAgICBsZXQgYWJvcnRlZCA9IGZhbHNlXG4gICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICBhYm9ydGVkID0gdHJ1ZVxuICAgICAgcmVhZFN0cmVhbS5kZXN0cm95KClcbiAgICB9XG5cbiAgICB0aGlzLnNvY2tldC5vbmNlKFwiY2xvc2VcIiwgYWJvcnQpXG4gICAgdGhpcy5zb2NrZXQub25jZShcImVycm9yXCIsIGFib3J0KVxuXG4gICAgdHJ5IHtcbiAgICAgIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2YgcmVhZFN0cmVhbSkge1xuICAgICAgICBpZiAoYWJvcnRlZCB8fCAhYXdhaXQgdGhpcy53cml0ZUZpbGVDaHVuayhjaHVuaykpIHJldHVybiBcImFib3J0ZWRcIlxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYWJvcnRlZCA/IFwiYWJvcnRlZFwiIDogXCJjb21wbGV0ZWRcIlxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYFNvY2tldCAke3RoaXMuY2xpZW50Q291bnR9IGZpbGUgcmVzcG9uc2UgZmFpbGVkYCwgZmlsZVBhdGgsIGVycm9yXSlcbiAgICAgIGlmICghdGhpcy5zb2NrZXQuZGVzdHJveWVkKSB0aGlzLnNvY2tldC5kZXN0cm95KClcblxuICAgICAgcmV0dXJuIFwiYWJvcnRlZFwiXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuc29ja2V0Lm9mZihcImNsb3NlXCIsIGFib3J0KVxuICAgICAgdGhpcy5zb2NrZXQub2ZmKFwiZXJyb3JcIiwgYWJvcnQpXG4gICAgICByZWFkU3RyZWFtLmRlc3Ryb3koKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgb25lIGZpbGUgY2h1bmsgYW5kIHdhaXRzIGZvciBib3RoIHdyaXRlIGFjY2VwdGFuY2UgYW5kIGRyYWluIHdoZW4gcmVxdWlyZWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyIHwgVWludDhBcnJheX0gY2h1bmsgLSBGaWxlIGNodW5rLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBjaHVuayB3YXMgYWNjZXB0ZWQgYmVmb3JlIHRoZSBzb2NrZXQgYWJvcnRlZC5cbiAgICovXG4gIHdyaXRlRmlsZUNodW5rKGNodW5rKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBsZXQgY2FsbGJhY2tDb21wbGV0ZWQgPSBmYWxzZVxuICAgICAgbGV0IGRyYWluZWQgPSBmYWxzZVxuICAgICAgbGV0IHNldHRsZWQgPSBmYWxzZVxuXG4gICAgICBjb25zdCBjbGVhbnVwID0gKCkgPT4ge1xuICAgICAgICB0aGlzLnNvY2tldC5vZmYoXCJjbG9zZVwiLCBvbkFib3J0KVxuICAgICAgICB0aGlzLnNvY2tldC5vZmYoXCJlcnJvclwiLCBvbkFib3J0KVxuICAgICAgICB0aGlzLnNvY2tldC5vZmYoXCJkcmFpblwiLCBvbkRyYWluKVxuICAgICAgfVxuICAgICAgY29uc3QgZmluaXNoID0gKC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi8gcmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cblxuICAgICAgICBzZXR0bGVkID0gdHJ1ZVxuICAgICAgICBjbGVhbnVwKClcbiAgICAgICAgcmVzb2x2ZShyZXN1bHQpXG4gICAgICB9XG4gICAgICBjb25zdCBmaW5pc2hJZlJlYWR5ID0gKCkgPT4ge1xuICAgICAgICBpZiAoY2FsbGJhY2tDb21wbGV0ZWQgJiYgZHJhaW5lZCkgZmluaXNoKHRydWUpXG4gICAgICB9XG4gICAgICBjb25zdCBvbkFib3J0ID0gKCkgPT4gZmluaXNoKGZhbHNlKVxuICAgICAgY29uc3Qgb25EcmFpbiA9ICgpID0+IHtcbiAgICAgICAgZHJhaW5lZCA9IHRydWVcbiAgICAgICAgZmluaXNoSWZSZWFkeSgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuc29ja2V0Lm9uY2UoXCJjbG9zZVwiLCBvbkFib3J0KVxuICAgICAgdGhpcy5zb2NrZXQub25jZShcImVycm9yXCIsIG9uQWJvcnQpXG4gICAgICB0aGlzLnNvY2tldC5vbmNlKFwiZHJhaW5cIiwgb25EcmFpbilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYWNjZXB0ZWQgPSB0aGlzLnNvY2tldC53cml0ZShjaHVuaywgKGVycm9yKSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICBmaW5pc2goZmFsc2UpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjYWxsYmFja0NvbXBsZXRlZCA9IHRydWVcbiAgICAgICAgICBmaW5pc2hJZlJlYWR5KClcbiAgICAgICAgfSlcblxuICAgICAgICBkcmFpbmVkID0gYWNjZXB0ZWRcbiAgICAgICAgaWYgKGFjY2VwdGVkKSB0aGlzLnNvY2tldC5vZmYoXCJkcmFpblwiLCBvbkRyYWluKVxuICAgICAgICBmaW5pc2hJZlJlYWR5KClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgU29ja2V0ICR7dGhpcy5jbGllbnRDb3VudH0gZmlsZSB3cml0ZSBmYWlsZWRgLCBlcnJvcl0pXG4gICAgICAgIGZpbmlzaChmYWxzZSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdvcmtlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJ3b3JrZXJfdGhyZWFkc1wiKS5Xb3JrZXJ9IG5ld1dvcmtlciAtIE5ldyB3b3JrZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdvcmtlcihuZXdXb3JrZXIpIHtcbiAgICB0aGlzLndvcmtlciA9IG5ld1dvcmtlclxuICB9XG59XG4iXX0=
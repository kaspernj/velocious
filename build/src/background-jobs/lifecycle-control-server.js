// @ts-check
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import JsonSocket from "./json-socket.js";
import { validateGenerationId } from "./generation-identity.js";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Package-owned acknowledged lifecycle control server. */
export default class BackgroundJobsLifecycleControlServer {
    /**
     * Creates a lifecycle control server.
     * @param {object} args - Server options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} args.generationId - Exact generation identity.
     * @param {import("./main.js").default} args.main - Owned jobs main.
     * @param {string} args.socketPath - Release-local Unix socket path.
     */
    constructor({ configuration, generationId, main, socketPath }) {
        this.configuration = configuration;
        this.generationId = validateGenerationId(generationId);
        this.main = main;
        this.socketPath = socketPath;
        /** @type {net.Server | undefined} */
        this.server = undefined;
        /** @type {{dev: number, ino: number} | undefined} */
        this.ownedSocketIdentity = undefined;
        /** @type {Set<net.Socket>} */
        this.connections = new Set();
    }
    /**
     * Starts the secure local listener.
     * @returns {Promise<void>} - Resolves after secure listen.
     */
    async start() {
        await this._validateParentDirectory();
        await this._removeStaleOwnedSocket();
        const server = net.createServer((socket) => this._handleConnection(socket));
        this.server = server;
        try {
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(this.socketPath, () => resolve(undefined));
            });
            await fs.chmod(this.socketPath, 0o600);
            const stat = await fs.lstat(this.socketPath);
            this.ownedSocketIdentity = { dev: stat.dev, ino: stat.ino };
        }
        catch (error) {
            await this.close();
            throw error;
        }
    }
    /**
     * Closes the owned listener.
     * @returns {Promise<void>} - Closes connections, listener, and only its owned path.
     */
    async close() {
        for (const socket of this.connections)
            socket.destroy();
        this.connections.clear();
        const server = this.server;
        this.server = undefined;
        const protectedReplacement = await this._protectReplacementDuringServerClose();
        try {
            if (server?.listening)
                await new Promise((resolve) => server.close(() => resolve(undefined)));
        }
        finally {
            await this._restoreProtectedReplacement(protectedReplacement);
        }
        await this._unlinkOwnedSocket();
    }
    /**
     * Moves a replacement inode aside because Node unlinks its original Unix
     * socket pathname during `server.close()` without checking the inode.
     * @returns {Promise<string | undefined>} - Protected sibling path.
     */
    async _protectReplacementDuringServerClose() {
        const identity = this.ownedSocketIdentity;
        if (!identity)
            return undefined;
        let stat;
        try {
            stat = await fs.lstat(this.socketPath);
        }
        catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
                return undefined;
            throw error;
        }
        if (stat.dev === identity.dev && stat.ino === identity.ino)
            return undefined;
        const protectedPath = `${this.socketPath}.velocious-protected-${randomUUID()}`;
        await fs.rename(this.socketPath, protectedPath);
        return protectedPath;
    }
    /**
     * Restores an inode protected across Node's automatic Unix-socket unlink.
     * @param {string | undefined} protectedPath - Protected sibling path.
     * @returns {Promise<void>} - Resolves after restoration.
     */
    async _restoreProtectedReplacement(protectedPath) {
        if (!protectedPath)
            return;
        try {
            await fs.lstat(this.socketPath);
        }
        catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                await fs.rename(protectedPath, this.socketPath);
                return;
            }
            throw error;
        }
        throw new Error(`Lifecycle socket replacement preserved at ${protectedPath} because its original path was occupied during close`);
    }
    /** Validates that the parent is a process-owned real directory inside the release. */
    async _validateParentDirectory() {
        if (!path.isAbsolute(this.socketPath))
            throw new TypeError("Background jobs lifecycle socket path must be absolute");
        const parentPath = path.dirname(this.socketPath);
        const parentStat = await fs.lstat(parentPath);
        if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
            throw new Error("Background jobs lifecycle socket parent must be a real directory");
        }
        if (typeof process.getuid === "function" && parentStat.uid !== process.getuid()) {
            throw new Error("Background jobs lifecycle socket parent must be owned by the process user");
        }
        const [releasePath, realParentPath] = await Promise.all([
            fs.realpath(this.configuration.getDirectory()),
            fs.realpath(parentPath)
        ]);
        const relative = path.relative(releasePath, realParentPath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error("Background jobs lifecycle socket parent must be inside the release directory");
        }
    }
    /** Removes only a same-owner, unchanged, stale socket inode. */
    async _removeStaleOwnedSocket() {
        let stat;
        try {
            stat = await fs.lstat(this.socketPath);
        }
        catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
                return;
            throw error;
        }
        if (stat.isSymbolicLink())
            throw new Error("Refusing lifecycle socket symlink collision");
        if (!stat.isSocket())
            throw new Error("Refusing lifecycle socket non-socket collision");
        if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
            throw new Error("Refusing lifecycle socket owned by another user");
        }
        if (await this._socketAcceptsConnections())
            throw new Error("Background jobs lifecycle socket is already active");
        const current = await fs.lstat(this.socketPath);
        if (!current.isSocket() || current.dev !== stat.dev || current.ino !== stat.ino) {
            throw new Error("Lifecycle socket collision changed during stale cleanup");
        }
        await fs.unlink(this.socketPath);
    }
    /**
     * Probes a socket collision.
     * @returns {Promise<boolean>} - Whether the existing socket accepts a connection.
     */
    async _socketAcceptsConnections() {
        return await new Promise((resolve, reject) => {
            const socket = net.createConnection(this.socketPath);
            socket.once("connect", () => {
                socket.end();
                resolve(true);
            });
            socket.once("error", (error) => {
                if ("code" in error && (error.code === "ECONNREFUSED" || error.code === "ENOENT")) {
                    resolve(false);
                }
                else {
                    reject(error);
                }
            });
        });
    }
    /** Unlinks the path only while it is still the inode created by this server. */
    async _unlinkOwnedSocket() {
        const identity = this.ownedSocketIdentity;
        this.ownedSocketIdentity = undefined;
        if (!identity)
            return;
        let stat;
        try {
            stat = await fs.lstat(this.socketPath);
        }
        catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
                return;
            throw error;
        }
        if (!stat.isSocket() || stat.dev !== identity.dev || stat.ino !== identity.ino)
            return;
        await fs.unlink(this.socketPath);
    }
    /**
     * Handles a local connection.
     * @param {net.Socket} socket - Accepted local connection.
     */
    _handleConnection(socket) {
        this.connections.add(socket);
        socket.once("close", () => this.connections.delete(socket));
        const jsonSocket = new JsonSocket(socket);
        let handled = false;
        jsonSocket.on("message", (message) => {
            if (handled) {
                socket.destroy();
                return;
            }
            handled = true;
            void this._handleRequest({ message, socket });
        });
        jsonSocket.on("error", (error) => {
            this._emitLifecycleFailure({ action: "invalid", error, requestId: "invalid" });
            socket.destroy();
        });
    }
    /**
     * Handles exactly one request and holds retirement open through response flush.
     * @param {object} args - Request context.
     * @param {ReturnType<typeof JSON.parse>} args.message - Parsed message.
     * @param {net.Socket} args.socket - Control socket.
     * @returns {Promise<void>} - Resolves after the response is queued.
     */
    async _handleRequest({ message, socket }) {
        const action = message?.action;
        const requestId = message?.requestId;
        this.main.acquireLifecycleRequestLease();
        try {
            this._validateRequest(message);
            if (action === "activate")
                await this.main.activate();
            else
                await this.main.retire();
            this._writeResponse(socket, {
                type: "background-jobs-lifecycle-ack",
                action,
                generationId: this.generationId,
                lifecycleState: this.main.getLifecycleState(),
                requestId
            });
        }
        catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this._emitLifecycleFailure({ action: typeof action === "string" ? action : "invalid", error: normalizedError, requestId: typeof requestId === "string" ? requestId : "invalid" });
            this._writeResponse(socket, {
                type: "background-jobs-lifecycle-error",
                action,
                generationId: typeof message?.generationId === "string" ? message.generationId : "invalid",
                requestId,
                error: { name: normalizedError.name, message: normalizedError.message, stack: normalizedError.stack }
            });
        }
    }
    /**
     * Validates one lifecycle request.
     * @param {ReturnType<typeof JSON.parse>} message - Request.
     */
    _validateRequest(message) {
        if (message?.type !== "background-jobs-lifecycle")
            throw new Error("Invalid background jobs lifecycle request type");
        if (message.action !== "activate" && message.action !== "retire")
            throw new Error("Invalid background jobs lifecycle action");
        if (message.generationId !== this.generationId)
            throw new Error("Background jobs lifecycle generation mismatch");
        if (typeof message.requestId !== "string" || !REQUEST_ID_PATTERN.test(message.requestId)) {
            throw new Error("Invalid background jobs lifecycle requestId");
        }
    }
    /**
     * Writes one lifecycle response.
     * @param {net.Socket} socket - Response socket.
     * @param {ReturnType<typeof JSON.parse>} response - Response.
     */
    _writeResponse(socket, response) {
        socket.write(`${JSON.stringify(response)}\n`, () => {
            this.main.releaseLifecycleRequestLease();
            socket.end();
        });
    }
    /**
     * Emits a lifecycle failure where ignored hook stdio cannot hide it.
     * @param {object} args - Failure context.
     * @param {string} args.action - Requested action.
     * @param {Error} args.error - Original error.
     * @param {string} args.requestId - Request id.
     */
    _emitLifecycleFailure({ action, error, requestId }) {
        const payload = {
            context: { action, generationId: this.generationId, requestId, stage: "background-jobs-lifecycle-control" },
            error
        };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGlmZWN5Y2xlLWNvbnRyb2wtc2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9saWZlY3ljbGUtY29udHJvbC1zZXJ2ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ2pDLE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDeEMsT0FBTyxHQUFHLE1BQU0sVUFBVSxDQUFBO0FBQzFCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQTtBQUUvRCxNQUFNLGtCQUFrQixHQUFHLDRFQUE0RSxDQUFBO0FBRXZHLDJEQUEyRDtBQUMzRCxNQUFNLENBQUMsT0FBTyxPQUFPLG9DQUFvQztJQUN2RDs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxZQUFZLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBQztRQUN6RCxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsWUFBWSxHQUFHLG9CQUFvQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQ3RELElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLHFDQUFxQztRQUNyQyxJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQTtRQUN2QixxREFBcUQ7UUFDckQsSUFBSSxDQUFDLG1CQUFtQixHQUFHLFNBQVMsQ0FBQTtRQUNwQyw4QkFBOEI7UUFDOUIsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSztR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LFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtZQUNqRCxJQUFJLENBQUMsSUFBSSxDQUFDLDRCQUE0QixFQUFFLENBQUE7WUFDeEMsTUFBTSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQ2QsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gscUJBQXFCLENBQUMsRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBQztRQUM5QyxNQUFNLE9BQU8sR0FBRztZQUNkLE9BQU8sRUFBRSxFQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLG1DQUFtQyxFQUFDO1lBQ3pHLEtBQUs7U0FDTixDQUFBO1FBQ0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUN2RCxXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtJQUMzRSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0IG5ldCBmcm9tIFwibm9kZTpuZXRcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgSnNvblNvY2tldCBmcm9tIFwiLi9qc29uLXNvY2tldC5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZUdlbmVyYXRpb25JZCB9IGZyb20gXCIuL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuXG5jb25zdCBSRVFVRVNUX0lEX1BBVFRFUk4gPSAvXlswLTlhLWZdezh9LVswLTlhLWZdezR9LVsxLThdWzAtOWEtZl17M30tWzg5YWJdWzAtOWEtZl17M30tWzAtOWEtZl17MTJ9JC9pXG5cbi8qKiBQYWNrYWdlLW93bmVkIGFja25vd2xlZGdlZCBsaWZlY3ljbGUgY29udHJvbCBzZXJ2ZXIuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic0xpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIGxpZmVjeWNsZSBjb250cm9sIHNlcnZlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZXJ2ZXIgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmdlbmVyYXRpb25JZCAtIEV4YWN0IGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tYWluLmpzXCIpLmRlZmF1bHR9IGFyZ3MubWFpbiAtIE93bmVkIGpvYnMgbWFpbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc29ja2V0UGF0aCAtIFJlbGVhc2UtbG9jYWwgVW5peCBzb2NrZXQgcGF0aC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBnZW5lcmF0aW9uSWQsIG1haW4sIHNvY2tldFBhdGh9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdmFsaWRhdGVHZW5lcmF0aW9uSWQoZ2VuZXJhdGlvbklkKVxuICAgIHRoaXMubWFpbiA9IG1haW5cbiAgICB0aGlzLnNvY2tldFBhdGggPSBzb2NrZXRQYXRoXG4gICAgLyoqIEB0eXBlIHtuZXQuU2VydmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2VydmVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHt7ZGV2OiBudW1iZXIsIGlubzogbnVtYmVyfSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLm93bmVkU29ja2V0SWRlbnRpdHkgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1NldDxuZXQuU29ja2V0Pn0gKi9cbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gbmV3IFNldCgpXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHRoZSBzZWN1cmUgbG9jYWwgbGlzdGVuZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNlY3VyZSBsaXN0ZW4uXG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZVBhcmVudERpcmVjdG9yeSgpXG4gICAgYXdhaXQgdGhpcy5fcmVtb3ZlU3RhbGVPd25lZFNvY2tldCgpXG4gICAgY29uc3Qgc2VydmVyID0gbmV0LmNyZWF0ZVNlcnZlcigoc29ja2V0KSA9PiB0aGlzLl9oYW5kbGVDb25uZWN0aW9uKHNvY2tldCkpXG4gICAgdGhpcy5zZXJ2ZXIgPSBzZXJ2ZXJcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHNlcnZlci5vbmNlKFwiZXJyb3JcIiwgcmVqZWN0KVxuICAgICAgICBzZXJ2ZXIubGlzdGVuKHRoaXMuc29ja2V0UGF0aCwgKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICAgICAgfSlcbiAgICAgIGF3YWl0IGZzLmNobW9kKHRoaXMuc29ja2V0UGF0aCwgMG82MDApXG4gICAgICBjb25zdCBzdGF0ID0gYXdhaXQgZnMubHN0YXQodGhpcy5zb2NrZXRQYXRoKVxuICAgICAgdGhpcy5vd25lZFNvY2tldElkZW50aXR5ID0ge2Rldjogc3RhdC5kZXYsIGlubzogc3RhdC5pbm99XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2UoKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoZSBvd25lZCBsaXN0ZW5lci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQ2xvc2VzIGNvbm5lY3Rpb25zLCBsaXN0ZW5lciwgYW5kIG9ubHkgaXRzIG93bmVkIHBhdGguXG4gICAqL1xuICBhc3luYyBjbG9zZSgpIHtcbiAgICBmb3IgKGNvbnN0IHNvY2tldCBvZiB0aGlzLmNvbm5lY3Rpb25zKSBzb2NrZXQuZGVzdHJveSgpXG4gICAgdGhpcy5jb25uZWN0aW9ucy5jbGVhcigpXG5cbiAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlclxuICAgIHRoaXMuc2VydmVyID0gdW5kZWZpbmVkXG4gICAgY29uc3QgcHJvdGVjdGVkUmVwbGFjZW1lbnQgPSBhd2FpdCB0aGlzLl9wcm90ZWN0UmVwbGFjZW1lbnREdXJpbmdTZXJ2ZXJDbG9zZSgpXG4gICAgdHJ5IHtcbiAgICAgIGlmIChzZXJ2ZXI/Lmxpc3RlbmluZykgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNlcnZlci5jbG9zZSgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXN0b3JlUHJvdGVjdGVkUmVwbGFjZW1lbnQocHJvdGVjdGVkUmVwbGFjZW1lbnQpXG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX3VubGlua093bmVkU29ja2V0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBNb3ZlcyBhIHJlcGxhY2VtZW50IGlub2RlIGFzaWRlIGJlY2F1c2UgTm9kZSB1bmxpbmtzIGl0cyBvcmlnaW5hbCBVbml4XG4gICAqIHNvY2tldCBwYXRobmFtZSBkdXJpbmcgYHNlcnZlci5jbG9zZSgpYCB3aXRob3V0IGNoZWNraW5nIHRoZSBpbm9kZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPn0gLSBQcm90ZWN0ZWQgc2libGluZyBwYXRoLlxuICAgKi9cbiAgYXN5bmMgX3Byb3RlY3RSZXBsYWNlbWVudER1cmluZ1NlcnZlckNsb3NlKCkge1xuICAgIGNvbnN0IGlkZW50aXR5ID0gdGhpcy5vd25lZFNvY2tldElkZW50aXR5XG4gICAgaWYgKCFpZGVudGl0eSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgbGV0IHN0YXRcbiAgICB0cnkge1xuICAgICAgc3RhdCA9IGF3YWl0IGZzLmxzdGF0KHRoaXMuc29ja2V0UGF0aClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgXCJjb2RlXCIgaW4gZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gXCJFTk9FTlRcIikgcmV0dXJuIHVuZGVmaW5lZFxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gICAgaWYgKHN0YXQuZGV2ID09PSBpZGVudGl0eS5kZXYgJiYgc3RhdC5pbm8gPT09IGlkZW50aXR5LmlubykgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgcHJvdGVjdGVkUGF0aCA9IGAke3RoaXMuc29ja2V0UGF0aH0udmVsb2Npb3VzLXByb3RlY3RlZC0ke3JhbmRvbVVVSUQoKX1gXG4gICAgYXdhaXQgZnMucmVuYW1lKHRoaXMuc29ja2V0UGF0aCwgcHJvdGVjdGVkUGF0aClcblxuICAgIHJldHVybiBwcm90ZWN0ZWRQYXRoXG4gIH1cblxuICAvKipcbiAgICogUmVzdG9yZXMgYW4gaW5vZGUgcHJvdGVjdGVkIGFjcm9zcyBOb2RlJ3MgYXV0b21hdGljIFVuaXgtc29ja2V0IHVubGluay5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHByb3RlY3RlZFBhdGggLSBQcm90ZWN0ZWQgc2libGluZyBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXN0b3JhdGlvbi5cbiAgICovXG4gIGFzeW5jIF9yZXN0b3JlUHJvdGVjdGVkUmVwbGFjZW1lbnQocHJvdGVjdGVkUGF0aCkge1xuICAgIGlmICghcHJvdGVjdGVkUGF0aCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZnMubHN0YXQodGhpcy5zb2NrZXRQYXRoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiBlcnJvci5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgICAgIGF3YWl0IGZzLnJlbmFtZShwcm90ZWN0ZWRQYXRoLCB0aGlzLnNvY2tldFBhdGgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYExpZmVjeWNsZSBzb2NrZXQgcmVwbGFjZW1lbnQgcHJlc2VydmVkIGF0ICR7cHJvdGVjdGVkUGF0aH0gYmVjYXVzZSBpdHMgb3JpZ2luYWwgcGF0aCB3YXMgb2NjdXBpZWQgZHVyaW5nIGNsb3NlYClcbiAgfVxuXG4gIC8qKiBWYWxpZGF0ZXMgdGhhdCB0aGUgcGFyZW50IGlzIGEgcHJvY2Vzcy1vd25lZCByZWFsIGRpcmVjdG9yeSBpbnNpZGUgdGhlIHJlbGVhc2UuICovXG4gIGFzeW5jIF92YWxpZGF0ZVBhcmVudERpcmVjdG9yeSgpIHtcbiAgICBpZiAoIXBhdGguaXNBYnNvbHV0ZSh0aGlzLnNvY2tldFBhdGgpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGxpZmVjeWNsZSBzb2NrZXQgcGF0aCBtdXN0IGJlIGFic29sdXRlXCIpXG5cbiAgICBjb25zdCBwYXJlbnRQYXRoID0gcGF0aC5kaXJuYW1lKHRoaXMuc29ja2V0UGF0aClcbiAgICBjb25zdCBwYXJlbnRTdGF0ID0gYXdhaXQgZnMubHN0YXQocGFyZW50UGF0aClcbiAgICBpZiAoIXBhcmVudFN0YXQuaXNEaXJlY3RvcnkoKSB8fCBwYXJlbnRTdGF0LmlzU3ltYm9saWNMaW5rKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgc29ja2V0IHBhcmVudCBtdXN0IGJlIGEgcmVhbCBkaXJlY3RvcnlcIilcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBwcm9jZXNzLmdldHVpZCA9PT0gXCJmdW5jdGlvblwiICYmIHBhcmVudFN0YXQudWlkICE9PSBwcm9jZXNzLmdldHVpZCgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHNvY2tldCBwYXJlbnQgbXVzdCBiZSBvd25lZCBieSB0aGUgcHJvY2VzcyB1c2VyXCIpXG4gICAgfVxuXG4gICAgY29uc3QgW3JlbGVhc2VQYXRoLCByZWFsUGFyZW50UGF0aF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBmcy5yZWFscGF0aCh0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCkpLFxuICAgICAgZnMucmVhbHBhdGgocGFyZW50UGF0aClcbiAgICBdKVxuICAgIGNvbnN0IHJlbGF0aXZlID0gcGF0aC5yZWxhdGl2ZShyZWxlYXNlUGF0aCwgcmVhbFBhcmVudFBhdGgpXG4gICAgaWYgKHJlbGF0aXZlLnN0YXJ0c1dpdGgoXCIuLlwiKSB8fCBwYXRoLmlzQWJzb2x1dGUocmVsYXRpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHNvY2tldCBwYXJlbnQgbXVzdCBiZSBpbnNpZGUgdGhlIHJlbGVhc2UgZGlyZWN0b3J5XCIpXG4gICAgfVxuICB9XG5cbiAgLyoqIFJlbW92ZXMgb25seSBhIHNhbWUtb3duZXIsIHVuY2hhbmdlZCwgc3RhbGUgc29ja2V0IGlub2RlLiAqL1xuICBhc3luYyBfcmVtb3ZlU3RhbGVPd25lZFNvY2tldCgpIHtcbiAgICBsZXQgc3RhdFxuICAgIHRyeSB7XG4gICAgICBzdGF0ID0gYXdhaXQgZnMubHN0YXQodGhpcy5zb2NrZXRQYXRoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiBlcnJvci5jb2RlID09PSBcIkVOT0VOVFwiKSByZXR1cm5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgaWYgKHN0YXQuaXNTeW1ib2xpY0xpbmsoKSkgdGhyb3cgbmV3IEVycm9yKFwiUmVmdXNpbmcgbGlmZWN5Y2xlIHNvY2tldCBzeW1saW5rIGNvbGxpc2lvblwiKVxuICAgIGlmICghc3RhdC5pc1NvY2tldCgpKSB0aHJvdyBuZXcgRXJyb3IoXCJSZWZ1c2luZyBsaWZlY3ljbGUgc29ja2V0IG5vbi1zb2NrZXQgY29sbGlzaW9uXCIpXG4gICAgaWYgKHR5cGVvZiBwcm9jZXNzLmdldHVpZCA9PT0gXCJmdW5jdGlvblwiICYmIHN0YXQudWlkICE9PSBwcm9jZXNzLmdldHVpZCgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWZ1c2luZyBsaWZlY3ljbGUgc29ja2V0IG93bmVkIGJ5IGFub3RoZXIgdXNlclwiKVxuICAgIH1cbiAgICBpZiAoYXdhaXQgdGhpcy5fc29ja2V0QWNjZXB0c0Nvbm5lY3Rpb25zKCkpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgc29ja2V0IGlzIGFscmVhZHkgYWN0aXZlXCIpXG5cbiAgICBjb25zdCBjdXJyZW50ID0gYXdhaXQgZnMubHN0YXQodGhpcy5zb2NrZXRQYXRoKVxuICAgIGlmICghY3VycmVudC5pc1NvY2tldCgpIHx8IGN1cnJlbnQuZGV2ICE9PSBzdGF0LmRldiB8fCBjdXJyZW50LmlubyAhPT0gc3RhdC5pbm8pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpZmVjeWNsZSBzb2NrZXQgY29sbGlzaW9uIGNoYW5nZWQgZHVyaW5nIHN0YWxlIGNsZWFudXBcIilcbiAgICB9XG4gICAgYXdhaXQgZnMudW5saW5rKHRoaXMuc29ja2V0UGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9iZXMgYSBzb2NrZXQgY29sbGlzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBleGlzdGluZyBzb2NrZXQgYWNjZXB0cyBhIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyBfc29ja2V0QWNjZXB0c0Nvbm5lY3Rpb25zKCkge1xuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBzb2NrZXQgPSBuZXQuY3JlYXRlQ29ubmVjdGlvbih0aGlzLnNvY2tldFBhdGgpXG4gICAgICBzb2NrZXQub25jZShcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgICBzb2NrZXQuZW5kKClcbiAgICAgICAgcmVzb2x2ZSh0cnVlKVxuICAgICAgfSlcbiAgICAgIHNvY2tldC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIGlmIChcImNvZGVcIiBpbiBlcnJvciAmJiAoZXJyb3IuY29kZSA9PT0gXCJFQ09OTlJFRlVTRURcIiB8fCBlcnJvci5jb2RlID09PSBcIkVOT0VOVFwiKSkge1xuICAgICAgICAgIHJlc29sdmUoZmFsc2UpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKiogVW5saW5rcyB0aGUgcGF0aCBvbmx5IHdoaWxlIGl0IGlzIHN0aWxsIHRoZSBpbm9kZSBjcmVhdGVkIGJ5IHRoaXMgc2VydmVyLiAqL1xuICBhc3luYyBfdW5saW5rT3duZWRTb2NrZXQoKSB7XG4gICAgY29uc3QgaWRlbnRpdHkgPSB0aGlzLm93bmVkU29ja2V0SWRlbnRpdHlcbiAgICB0aGlzLm93bmVkU29ja2V0SWRlbnRpdHkgPSB1bmRlZmluZWRcbiAgICBpZiAoIWlkZW50aXR5KSByZXR1cm5cblxuICAgIGxldCBzdGF0XG4gICAgdHJ5IHtcbiAgICAgIHN0YXQgPSBhd2FpdCBmcy5sc3RhdCh0aGlzLnNvY2tldFBhdGgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIFwiY29kZVwiIGluIGVycm9yICYmIGVycm9yLmNvZGUgPT09IFwiRU5PRU5UXCIpIHJldHVyblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gICAgaWYgKCFzdGF0LmlzU29ja2V0KCkgfHwgc3RhdC5kZXYgIT09IGlkZW50aXR5LmRldiB8fCBzdGF0LmlubyAhPT0gaWRlbnRpdHkuaW5vKSByZXR1cm5cbiAgICBhd2FpdCBmcy51bmxpbmsodGhpcy5zb2NrZXRQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBsb2NhbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge25ldC5Tb2NrZXR9IHNvY2tldCAtIEFjY2VwdGVkIGxvY2FsIGNvbm5lY3Rpb24uXG4gICAqL1xuICBfaGFuZGxlQ29ubmVjdGlvbihzb2NrZXQpIHtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmFkZChzb2NrZXQpXG4gICAgc29ja2V0Lm9uY2UoXCJjbG9zZVwiLCAoKSA9PiB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShzb2NrZXQpKVxuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG4gICAgbGV0IGhhbmRsZWQgPSBmYWxzZVxuXG4gICAganNvblNvY2tldC5vbihcIm1lc3NhZ2VcIiwgKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChoYW5kbGVkKSB7XG4gICAgICAgIHNvY2tldC5kZXN0cm95KClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgICBoYW5kbGVkID0gdHJ1ZVxuICAgICAgdm9pZCB0aGlzLl9oYW5kbGVSZXF1ZXN0KHttZXNzYWdlLCBzb2NrZXR9KVxuICAgIH0pXG4gICAganNvblNvY2tldC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5fZW1pdExpZmVjeWNsZUZhaWx1cmUoe2FjdGlvbjogXCJpbnZhbGlkXCIsIGVycm9yLCByZXF1ZXN0SWQ6IFwiaW52YWxpZFwifSlcbiAgICAgIHNvY2tldC5kZXN0cm95KClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgZXhhY3RseSBvbmUgcmVxdWVzdCBhbmQgaG9sZHMgcmV0aXJlbWVudCBvcGVuIHRocm91Z2ggcmVzcG9uc2UgZmx1c2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVxdWVzdCBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm1lc3NhZ2UgLSBQYXJzZWQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtuZXQuU29ja2V0fSBhcmdzLnNvY2tldCAtIENvbnRyb2wgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmVzcG9uc2UgaXMgcXVldWVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJlcXVlc3Qoe21lc3NhZ2UsIHNvY2tldH0pIHtcbiAgICBjb25zdCBhY3Rpb24gPSBtZXNzYWdlPy5hY3Rpb25cbiAgICBjb25zdCByZXF1ZXN0SWQgPSBtZXNzYWdlPy5yZXF1ZXN0SWRcbiAgICB0aGlzLm1haW4uYWNxdWlyZUxpZmVjeWNsZVJlcXVlc3RMZWFzZSgpXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5fdmFsaWRhdGVSZXF1ZXN0KG1lc3NhZ2UpXG4gICAgICBpZiAoYWN0aW9uID09PSBcImFjdGl2YXRlXCIpIGF3YWl0IHRoaXMubWFpbi5hY3RpdmF0ZSgpXG4gICAgICBlbHNlIGF3YWl0IHRoaXMubWFpbi5yZXRpcmUoKVxuXG4gICAgICB0aGlzLl93cml0ZVJlc3BvbnNlKHNvY2tldCwge1xuICAgICAgICB0eXBlOiBcImJhY2tncm91bmQtam9icy1saWZlY3ljbGUtYWNrXCIsXG4gICAgICAgIGFjdGlvbixcbiAgICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCxcbiAgICAgICAgbGlmZWN5Y2xlU3RhdGU6IHRoaXMubWFpbi5nZXRMaWZlY3ljbGVTdGF0ZSgpLFxuICAgICAgICByZXF1ZXN0SWRcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgdGhpcy5fZW1pdExpZmVjeWNsZUZhaWx1cmUoe2FjdGlvbjogdHlwZW9mIGFjdGlvbiA9PT0gXCJzdHJpbmdcIiA/IGFjdGlvbiA6IFwiaW52YWxpZFwiLCBlcnJvcjogbm9ybWFsaXplZEVycm9yLCByZXF1ZXN0SWQ6IHR5cGVvZiByZXF1ZXN0SWQgPT09IFwic3RyaW5nXCIgPyByZXF1ZXN0SWQgOiBcImludmFsaWRcIn0pXG4gICAgICB0aGlzLl93cml0ZVJlc3BvbnNlKHNvY2tldCwge1xuICAgICAgICB0eXBlOiBcImJhY2tncm91bmQtam9icy1saWZlY3ljbGUtZXJyb3JcIixcbiAgICAgICAgYWN0aW9uLFxuICAgICAgICBnZW5lcmF0aW9uSWQ6IHR5cGVvZiBtZXNzYWdlPy5nZW5lcmF0aW9uSWQgPT09IFwic3RyaW5nXCIgPyBtZXNzYWdlLmdlbmVyYXRpb25JZCA6IFwiaW52YWxpZFwiLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIGVycm9yOiB7bmFtZTogbm9ybWFsaXplZEVycm9yLm5hbWUsIG1lc3NhZ2U6IG5vcm1hbGl6ZWRFcnJvci5tZXNzYWdlLCBzdGFjazogbm9ybWFsaXplZEVycm9yLnN0YWNrfVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIG9uZSBsaWZlY3ljbGUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIFJlcXVlc3QuXG4gICAqL1xuICBfdmFsaWRhdGVSZXF1ZXN0KG1lc3NhZ2UpIHtcbiAgICBpZiAobWVzc2FnZT8udHlwZSAhPT0gXCJiYWNrZ3JvdW5kLWpvYnMtbGlmZWN5Y2xlXCIpIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgYmFja2dyb3VuZCBqb2JzIGxpZmVjeWNsZSByZXF1ZXN0IHR5cGVcIilcbiAgICBpZiAobWVzc2FnZS5hY3Rpb24gIT09IFwiYWN0aXZhdGVcIiAmJiBtZXNzYWdlLmFjdGlvbiAhPT0gXCJyZXRpcmVcIikgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBiYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIGFjdGlvblwiKVxuICAgIGlmIChtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgZ2VuZXJhdGlvbiBtaXNtYXRjaFwiKVxuICAgIGlmICh0eXBlb2YgbWVzc2FnZS5yZXF1ZXN0SWQgIT09IFwic3RyaW5nXCIgfHwgIVJFUVVFU1RfSURfUEFUVEVSTi50ZXN0KG1lc3NhZ2UucmVxdWVzdElkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBiYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHJlcXVlc3RJZFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgb25lIGxpZmVjeWNsZSByZXNwb25zZS5cbiAgICogQHBhcmFtIHtuZXQuU29ja2V0fSBzb2NrZXQgLSBSZXNwb25zZSBzb2NrZXQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc3BvbnNlIC0gUmVzcG9uc2UuXG4gICAqL1xuICBfd3JpdGVSZXNwb25zZShzb2NrZXQsIHJlc3BvbnNlKSB7XG4gICAgc29ja2V0LndyaXRlKGAke0pTT04uc3RyaW5naWZ5KHJlc3BvbnNlKX1cXG5gLCAoKSA9PiB7XG4gICAgICB0aGlzLm1haW4ucmVsZWFzZUxpZmVjeWNsZVJlcXVlc3RMZWFzZSgpXG4gICAgICBzb2NrZXQuZW5kKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGEgbGlmZWN5Y2xlIGZhaWx1cmUgd2hlcmUgaWdub3JlZCBob29rIHN0ZGlvIGNhbm5vdCBoaWRlIGl0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgY29udGV4dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gUmVxdWVzdGVkIGFjdGlvbi5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIE9yaWdpbmFsIGVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXF1ZXN0SWQgLSBSZXF1ZXN0IGlkLlxuICAgKi9cbiAgX2VtaXRMaWZlY3ljbGVGYWlsdXJlKHthY3Rpb24sIGVycm9yLCByZXF1ZXN0SWR9KSB7XG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHthY3Rpb24sIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHJlcXVlc3RJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2JzLWxpZmVjeWNsZS1jb250cm9sXCJ9LFxuICAgICAgZXJyb3JcbiAgICB9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG59XG4iXX0=
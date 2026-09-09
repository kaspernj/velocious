// @ts-check
import { Readable } from "node:stream";
const READ_CHUNK_SIZE = 64 * 1024;
/**
 * Opened Node attachment path source.
 *
 * The opened file handle fixes the source identity at normalization time. Reads
 * are limited to the stat snapshot and fail if the file becomes shorter.
 */
export default class AttachmentPathSource {
    /**
     * Creates an opened attachment path source.
     * @param {object} args - Source args.
     * @param {number} args.byteSize - Opened-handle stat size.
     * @param {import("node:fs/promises").FileHandle} args.fileHandle - Open file handle.
     * @param {string} args.filePath - Validated path used to open the handle.
     */
    constructor({ byteSize, fileHandle, filePath }) {
        this.byteSize = byteSize;
        this.fileHandle = fileHandle;
        this.filePath = filePath;
        /** @type {Set<Readable>} */
        this.activeStreams = new Set();
        /** @type {Promise<void> | null} */
        this.closePromise = null;
        this.closed = false;
    }
    /**
     * Creates a bounded, backpressured stream over the opened file snapshot.
     * @returns {Promise<Readable>} - Snapshot read stream.
     */
    async createReadStream() {
        this.assertOpen();
        const stream = Readable.from(this.readChunks());
        this.activeStreams.add(stream);
        stream.once("close", () => {
            this.activeStreams.delete(stream);
        });
        return stream;
    }
    /**
     * Reads the opened file snapshot into memory for compatibility-only callers.
     * @returns {Promise<Buffer>} - Exact snapshot bytes.
     */
    async readBuffer() {
        this.assertOpen();
        const contentBuffer = Buffer.allocUnsafe(this.byteSize);
        let offset = 0;
        while (offset < this.byteSize) {
            this.assertOpen();
            const { bytesRead } = await this.fileHandle.read(contentBuffer, offset, Math.min(READ_CHUNK_SIZE, this.byteSize - offset), offset);
            if (bytesRead === 0)
                this.throwTruncated({ bytesRead: offset });
            offset += bytesRead;
        }
        return contentBuffer;
    }
    /**
     * Closes all active streams and the owned file handle.
     * @returns {Promise<void>} - Resolves after close.
     */
    async close() {
        if (!this.closePromise) {
            this.closed = true;
            this.closePromise = (async () => {
                const streams = Array.from(this.activeStreams);
                const streamClosePromises = streams.map(async (stream) => {
                    if (stream.closed)
                        return;
                    await new Promise((resolve) => {
                        stream.once("close", resolve);
                        stream.destroy();
                    });
                });
                await Promise.all(streamClosePromises);
                await this.fileHandle.close();
            })();
        }
        await this.closePromise;
    }
    /**
     * Produces bounded chunks from the opened file handle.
     * @yields {Buffer} - Snapshot chunks.
     */
    async *readChunks() {
        let offset = 0;
        while (offset < this.byteSize) {
            this.assertOpen();
            const chunkBuffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_SIZE, this.byteSize - offset));
            const { bytesRead } = await this.fileHandle.read(chunkBuffer, 0, chunkBuffer.length, offset);
            if (bytesRead === 0)
                this.throwTruncated({ bytesRead: offset });
            offset += bytesRead;
            yield bytesRead === chunkBuffer.length ? chunkBuffer : chunkBuffer.subarray(0, bytesRead);
        }
    }
    /**
     * Asserts that the source remains open.
     * @returns {void} - Throws if closed.
     */
    assertOpen() {
        if (this.closed) {
            throw new Error(`Attachment path source is closed: ${this.filePath}`);
        }
    }
    /**
     * Throws a truncation error.
     * @param {object} args - Args.
     * @param {number} args.bytesRead - Bytes read before EOF.
     * @returns {never} - Always throws.
     */
    throwTruncated({ bytesRead }) {
        throw new Error(`Attachment path source was truncated: expected ${this.byteSize} bytes but read ${bytesRead} from ${this.filePath}`);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXR0YWNobWVudC1wYXRoLXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2F0dGFjaG1lbnQtcGF0aC1zb3VyY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFFdEMsTUFBTSxlQUFlLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQTtBQUVqQzs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0JBQW9CO0lBQ3ZDOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxRQUFRLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBQztRQUMxQyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtRQUN4QixJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtRQUM1QixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtRQUN4Qiw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQzlCLG1DQUFtQztRQUNuQyxJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQTtRQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQTtJQUNyQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQjtRQUNwQixJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFFakIsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQTtRQUUvQyxJQUFJLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUM5QixNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUU7WUFDeEIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMs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LEtBQUssV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUMzRixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLHFDQUFxQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQTtRQUN2RSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsY0FBYyxDQUFDLEVBQUMsU0FBUyxFQUFDO1FBQ3hCLE1BQU0sSUFBSSxLQUFLLENBQ2Isa0RBQWtELElBQUksQ0FBQyxRQUFRLG1CQUFtQixTQUFTLFNBQVMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUNwSCxDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IFJlYWRhYmxlIH0gZnJvbSBcIm5vZGU6c3RyZWFtXCJcblxuY29uc3QgUkVBRF9DSFVOS19TSVpFID0gNjQgKiAxMDI0XG5cbi8qKlxuICogT3BlbmVkIE5vZGUgYXR0YWNobWVudCBwYXRoIHNvdXJjZS5cbiAqXG4gKiBUaGUgb3BlbmVkIGZpbGUgaGFuZGxlIGZpeGVzIHRoZSBzb3VyY2UgaWRlbnRpdHkgYXQgbm9ybWFsaXphdGlvbiB0aW1lLiBSZWFkc1xuICogYXJlIGxpbWl0ZWQgdG8gdGhlIHN0YXQgc25hcHNob3QgYW5kIGZhaWwgaWYgdGhlIGZpbGUgYmVjb21lcyBzaG9ydGVyLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBBdHRhY2htZW50UGF0aFNvdXJjZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIG9wZW5lZCBhdHRhY2htZW50IHBhdGggc291cmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNvdXJjZSBhcmdzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ieXRlU2l6ZSAtIE9wZW5lZC1oYW5kbGUgc3RhdCBzaXplLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6ZnMvcHJvbWlzZXNcIikuRmlsZUhhbmRsZX0gYXJncy5maWxlSGFuZGxlIC0gT3BlbiBmaWxlIGhhbmRsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZVBhdGggLSBWYWxpZGF0ZWQgcGF0aCB1c2VkIHRvIG9wZW4gdGhlIGhhbmRsZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtieXRlU2l6ZSwgZmlsZUhhbmRsZSwgZmlsZVBhdGh9KSB7XG4gICAgdGhpcy5ieXRlU2l6ZSA9IGJ5dGVTaXplXG4gICAgdGhpcy5maWxlSGFuZGxlID0gZmlsZUhhbmRsZVxuICAgIHRoaXMuZmlsZVBhdGggPSBmaWxlUGF0aFxuICAgIC8qKiBAdHlwZSB7U2V0PFJlYWRhYmxlPn0gKi9cbiAgICB0aGlzLmFjdGl2ZVN0cmVhbXMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuY2xvc2VQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuY2xvc2VkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgYm91bmRlZCwgYmFja3ByZXNzdXJlZCBzdHJlYW0gb3ZlciB0aGUgb3BlbmVkIGZpbGUgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlYWRhYmxlPn0gLSBTbmFwc2hvdCByZWFkIHN0cmVhbS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVJlYWRTdHJlYW0oKSB7XG4gICAgdGhpcy5hc3NlcnRPcGVuKClcblxuICAgIGNvbnN0IHN0cmVhbSA9IFJlYWRhYmxlLmZyb20odGhpcy5yZWFkQ2h1bmtzKCkpXG5cbiAgICB0aGlzLmFjdGl2ZVN0cmVhbXMuYWRkKHN0cmVhbSlcbiAgICBzdHJlYW0ub25jZShcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIHRoaXMuYWN0aXZlU3RyZWFtcy5kZWxldGUoc3RyZWFtKVxuICAgIH0pXG5cbiAgICByZXR1cm4gc3RyZWFtXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIG9wZW5lZCBmaWxlIHNuYXBzaG90IGludG8gbWVtb3J5IGZvciBjb21wYXRpYmlsaXR5LW9ubHkgY2FsbGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QnVmZmVyPn0gLSBFeGFjdCBzbmFwc2hvdCBieXRlcy5cbiAgICovXG4gIGFzeW5jIHJlYWRCdWZmZXIoKSB7XG4gICAgdGhpcy5hc3NlcnRPcGVuKClcblxuICAgIGNvbnN0IGNvbnRlbnRCdWZmZXIgPSBCdWZmZXIuYWxsb2NVbnNhZmUodGhpcy5ieXRlU2l6ZSlcbiAgICBsZXQgb2Zmc2V0ID0gMFxuXG4gICAgd2hpbGUgKG9mZnNldCA8IHRoaXMuYnl0ZVNpemUpIHtcbiAgICAgIHRoaXMuYXNzZXJ0T3BlbigpXG5cbiAgICAgIGNvbnN0IHtieXRlc1JlYWR9ID0gYXdhaXQgdGhpcy5maWxlSGFuZGxlLnJlYWQoXG4gICAgICAgIGNvbnRlbnRCdWZmZXIsXG4gICAgICAgIG9mZnNldCxcbiAgICAgICAgTWF0aC5taW4oUkVBRF9DSFVOS19TSVpFLCB0aGlzLmJ5dGVTaXplIC0gb2Zmc2V0KSxcbiAgICAgICAgb2Zmc2V0XG4gICAgICApXG5cbiAgICAgIGlmIChieXRlc1JlYWQgPT09IDApIHRoaXMudGhyb3dUcnVuY2F0ZWQoe2J5dGVzUmVhZDogb2Zmc2V0fSlcblxuICAgICAgb2Zmc2V0ICs9IGJ5dGVzUmVhZFxuICAgIH1cblxuICAgIHJldHVybiBjb250ZW50QnVmZmVyXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFsbCBhY3RpdmUgc3RyZWFtcyBhbmQgdGhlIG93bmVkIGZpbGUgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbG9zZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlKCkge1xuICAgIGlmICghdGhpcy5jbG9zZVByb21pc2UpIHtcbiAgICAgIHRoaXMuY2xvc2VkID0gdHJ1ZVxuICAgICAgdGhpcy5jbG9zZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBzdHJlYW1zID0gQXJyYXkuZnJvbSh0aGlzLmFjdGl2ZVN0cmVhbXMpXG4gICAgICAgIGNvbnN0IHN0cmVhbUNsb3NlUHJvbWlzZXMgPSBzdHJlYW1zLm1hcChhc3luYyAoc3RyZWFtKSA9PiB7XG4gICAgICAgICAgaWYgKHN0cmVhbS5jbG9zZWQpIHJldHVyblxuXG4gICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgIHN0cmVhbS5vbmNlKFwiY2xvc2VcIiwgcmVzb2x2ZSlcbiAgICAgICAgICAgIHN0cmVhbS5kZXN0cm95KClcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHN0cmVhbUNsb3NlUHJvbWlzZXMpXG4gICAgICAgIGF3YWl0IHRoaXMuZmlsZUhhbmRsZS5jbG9zZSgpXG4gICAgICB9KSgpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jbG9zZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9kdWNlcyBib3VuZGVkIGNodW5rcyBmcm9tIHRoZSBvcGVuZWQgZmlsZSBoYW5kbGUuXG4gICAqIEB5aWVsZHMge0J1ZmZlcn0gLSBTbmFwc2hvdCBjaHVua3MuXG4gICAqL1xuICBhc3luYyAqcmVhZENodW5rcygpIHtcbiAgICBsZXQgb2Zmc2V0ID0gMFxuXG4gICAgd2hpbGUgKG9mZnNldCA8IHRoaXMuYnl0ZVNpemUpIHtcbiAgICAgIHRoaXMuYXNzZXJ0T3BlbigpXG5cbiAgICAgIGNvbnN0IGNodW5rQnVmZmVyID0gQnVmZmVyLmFsbG9jVW5zYWZlKE1hdGgubWluKFJFQURfQ0hVTktfU0laRSwgdGhpcy5ieXRlU2l6ZSAtIG9mZnNldCkpXG4gICAgICBjb25zdCB7Ynl0ZXNSZWFkfSA9IGF3YWl0IHRoaXMuZmlsZUhhbmRsZS5yZWFkKGNodW5rQnVmZmVyLCAwLCBjaHVua0J1ZmZlci5sZW5ndGgsIG9mZnNldClcblxuICAgICAgaWYgKGJ5dGVzUmVhZCA9PT0gMCkgdGhpcy50aHJvd1RydW5jYXRlZCh7Ynl0ZXNSZWFkOiBvZmZzZXR9KVxuXG4gICAgICBvZmZzZXQgKz0gYnl0ZXNSZWFkXG4gICAgICB5aWVsZCBieXRlc1JlYWQgPT09IGNodW5rQnVmZmVyLmxlbmd0aCA/IGNodW5rQnVmZmVyIDogY2h1bmtCdWZmZXIuc3ViYXJyYXkoMCwgYnl0ZXNSZWFkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnRzIHRoYXQgdGhlIHNvdXJjZSByZW1haW5zIG9wZW4uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIFRocm93cyBpZiBjbG9zZWQuXG4gICAqL1xuICBhc3NlcnRPcGVuKCkge1xuICAgIGlmICh0aGlzLmNsb3NlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50IHBhdGggc291cmNlIGlzIGNsb3NlZDogJHt0aGlzLmZpbGVQYXRofWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRocm93cyBhIHRydW5jYXRpb24gZXJyb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYnl0ZXNSZWFkIC0gQnl0ZXMgcmVhZCBiZWZvcmUgRU9GLlxuICAgKiBAcmV0dXJucyB7bmV2ZXJ9IC0gQWx3YXlzIHRocm93cy5cbiAgICovXG4gIHRocm93VHJ1bmNhdGVkKHtieXRlc1JlYWR9KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYEF0dGFjaG1lbnQgcGF0aCBzb3VyY2Ugd2FzIHRydW5jYXRlZDogZXhwZWN0ZWQgJHt0aGlzLmJ5dGVTaXplfSBieXRlcyBidXQgcmVhZCAke2J5dGVzUmVhZH0gZnJvbSAke3RoaXMuZmlsZVBhdGh9YFxuICAgIClcbiAgfVxufVxuIl19
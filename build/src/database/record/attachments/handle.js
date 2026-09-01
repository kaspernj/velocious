// @ts-check
import RecordAttachmentDownload from "./download.js";
import { recordAttachmentsStoreForModel } from "./store.js";
/**
 * Runs download from row.
 * @param {object} args - Options.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Raw row.
 * @param {Buffer} args.content - Attachment bytes.
 * @param {string | null} args.url - Attachment URL.
 * @returns {RecordAttachmentDownload} - Download payload.
 */
function downloadFromRow({ content, row, url }) {
    const byteSize = Number(row.byte_size);
    return new RecordAttachmentDownload({
        byteSize: Number.isFinite(byteSize) ? byteSize : content.length,
        content,
        contentType: row.content_type || null,
        filename: row.filename || "attachment.bin",
        id: row.id,
        url
    });
}
/**
 * Runs is array.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is Array<ReturnType<typeof JSON.parse>>} - Whether value is an array.
 */
function isArray(value) {
    return Array.isArray(value);
}
/**
 * Attachment helper bound to one model + attachment name.
 */
export default class RecordAttachmentHandle {
    /**
     * Pending inputs.
     * @type {Array<ReturnType<typeof JSON.parse>>} */
    pendingInputs = [];
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {"hasOne" | "hasMany"} args.type - Attachment type.
     */
    constructor({ model, name, type }) {
        this.model = model;
        this.name = name;
        this.type = type;
    }
    /**
     * Runs has pending attachments.
     * @returns {boolean} - Whether there are pending attachment writes.
     */
    hasPendingAttachments() {
        return this.pendingInputs.length > 0;
    }
    /**
     * Runs queue attach.
     * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
     * @returns {void} - Queues attachment write for next save.
     */
    queueAttach(input) {
        if (this.type === "hasOne") {
            if (isArray(input)) {
                const lastInput = input[input.length - 1];
                this.pendingInputs = typeof lastInput === "undefined" ? [] : [lastInput];
            }
            else {
                this.pendingInputs = [input];
            }
            return;
        }
        if (isArray(input)) {
            for (const inputEntry of input) {
                this.pendingInputs.push(inputEntry);
            }
        }
        else {
            this.pendingInputs.push(input);
        }
    }
    /**
     * Runs attach.
     * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
     * @returns {Promise<void>} - Resolves when attached.
     */
    async attach(input) {
        this.queueAttach(input);
        await this.flushPendingAttachments();
    }
    /**
     * Runs flush pending attachments.
     * @returns {Promise<void>} - Resolves when pending attachments are flushed.
     */
    async flushPendingAttachments() {
        if (!this.model.isPersisted())
            return;
        if (this.pendingInputs.length < 1)
            return;
        const store = recordAttachmentsStoreForModel(this.model);
        const pendingInputs = this.pendingInputs;
        this.pendingInputs = [];
        for (const [index, input] of pendingInputs.entries()) {
            await store.attach({
                input,
                model: this.model,
                name: this.name,
                replace: this.type === "hasOne" && index === 0
            });
        }
    }
    /**
     * Runs download.
     * @param {string} [id] - Optional attachment id for has-many attachments.
     * @returns {Promise<RecordAttachmentDownload | null>} - Downloaded attachment.
     */
    async download(id) {
        if (!this.model.isPersisted())
            return null;
        const store = recordAttachmentsStoreForModel(this.model);
        const row = await store.findOne({ id, model: this.model, name: this.name });
        if (!row)
            return null;
        const [content, url] = await Promise.all([
            store.readAttachmentRow({ model: this.model, name: this.name, row }),
            store.attachmentRowUrl({ model: this.model, name: this.name, row })
        ]);
        return downloadFromRow({ content, row, url });
    }
    /**
     * Runs download all.
     * @returns {Promise<Array<RecordAttachmentDownload>>} - Downloaded attachments.
     */
    async downloadAll() {
        if (!this.model.isPersisted())
            return [];
        const store = recordAttachmentsStoreForModel(this.model);
        const rows = await store.findMany({ model: this.model, name: this.name });
        /**
         * Downloads.
         * @type {RecordAttachmentDownload[]} */
        const downloads = [];
        for (const row of rows) {
            const [content, url] = await Promise.all([
                store.readAttachmentRow({ model: this.model, name: this.name, row }),
                store.attachmentRowUrl({ model: this.model, name: this.name, row })
            ]);
            downloads.push(downloadFromRow({ content, row, url }));
        }
        return downloads;
    }
    /**
     * Runs list metadata. Returns metadata (no content bytes) for every attachment
     * under this (record, name), so callers can enumerate has-many attachments
     * without downloading their content.
     * @returns {Promise<Array<{byteSize: number, contentType: string | null, filename: string, id: string, url: string | null}>>} - Attachment metadata entries.
     */
    async listMetadata() {
        if (!this.model.isPersisted())
            return [];
        const store = recordAttachmentsStoreForModel(this.model);
        const rows = await store.findMany({ model: this.model, name: this.name });
        /**
         * Metadata entries.
         * @type {Array<{byteSize: number, contentType: string | null, filename: string, id: string, url: string | null}>} */
        const entries = [];
        for (const row of rows) {
            const url = await store.attachmentRowUrl({ model: this.model, name: this.name, row });
            const byteSize = Number(row.byte_size);
            entries.push({
                byteSize: Number.isFinite(byteSize) ? byteSize : 0,
                contentType: row.content_type || null,
                filename: row.filename || "attachment.bin",
                id: row.id,
                url
            });
        }
        return entries;
    }
    /**
     * Runs url.
     * @param {string} [id] - Optional attachment id for has-many attachments.
     * @returns {Promise<string | null>} - Resolvable attachment URL.
     */
    async url(id) {
        if (!this.model.isPersisted())
            return null;
        const store = recordAttachmentsStoreForModel(this.model);
        const row = await store.findOne({ id, model: this.model, name: this.name });
        if (!row)
            return null;
        return await store.attachmentRowUrl({ model: this.model, name: this.name, row });
    }
    /**
     * Purges every attachment under this (record, name): deletes the backing
     * storage for each and removes the attachment rows. A no-op for unpersisted
     * records. Only the attachments present when the purge starts are removed, so a
     * concurrent attach for the same (record, name) is left intact. Throws (without
     * deleting any rows) if a storage driver cannot delete its object, so a driver
     * configured without a `delete` operation can never leak storage. Callers use
     * this to clean up attachments before destroying the owner record.
     * @returns {Promise<number>} - Number of attachments purged.
     */
    async purgeAll() {
        if (!this.model.isPersisted())
            return 0;
        const store = recordAttachmentsStoreForModel(this.model);
        return await store.purgeAll({ model: this.model, name: this.name });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFuZGxlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3JlY29yZC9hdHRhY2htZW50cy9oYW5kbGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sd0JBQXdCLE1BQU0sZUFBZSxDQUFBO0FBQ3BELE9BQU8sRUFBQyw4QkFBOEIsRUFBQyxNQUFNLFlBQVksQ0FBQTtBQUV6RDs7Ozs7OztHQU9HO0FBQ0gsU0FBUyxlQUFlLENBQUMsRUFBQyxPQUFPLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBQztJQUMxQyxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBRXRDLE9BQU8sSUFBSSx3QkFBd0IsQ0FBQztRQUNsQyxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTTtRQUMvRCxPQUFPO1FBQ1AsV0FBVyxFQUFFLEdBQUcsQ0FBQyxZQUFZLElBQUksSUFBSTtRQUNyQyxRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVEsSUFBSSxnQkFBZ0I7UUFDMUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxFQUFFO1FBQ1YsR0FBRztLQUNKLENBQUMsQ0FBQTtBQUNKLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxPQUFPLENBQUMsS0FBSztJQUNwQixPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDN0IsQ0FBQztBQUVEOztHQUVHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7O3NEQUVrRDtJQUNsRCxhQUFhLEdBQUcsRUFBRSxDQUFBO0lBRWxCOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBQztRQUM3QixJQUFJLENBQUMsS0FBSyxH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QUFLLENBQUMsUUFBUSxDQUFDLEVBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBQ25FLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgUmVjb3JkQXR0YWNobWVudERvd25sb2FkIGZyb20gXCIuL2Rvd25sb2FkLmpzXCJcbmltcG9ydCB7cmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsfSBmcm9tIFwiLi9zdG9yZS5qc1wiXG5cbi8qKlxuICogUnVucyBkb3dubG9hZCBmcm9tIHJvdy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJvdyAtIFJhdyByb3cuXG4gKiBAcGFyYW0ge0J1ZmZlcn0gYXJncy5jb250ZW50IC0gQXR0YWNobWVudCBieXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy51cmwgLSBBdHRhY2htZW50IFVSTC5cbiAqIEByZXR1cm5zIHtSZWNvcmRBdHRhY2htZW50RG93bmxvYWR9IC0gRG93bmxvYWQgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gZG93bmxvYWRGcm9tUm93KHtjb250ZW50LCByb3csIHVybH0pIHtcbiAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIocm93LmJ5dGVfc2l6ZSlcblxuICByZXR1cm4gbmV3IFJlY29yZEF0dGFjaG1lbnREb3dubG9hZCh7XG4gICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IGNvbnRlbnQubGVuZ3RoLFxuICAgIGNvbnRlbnQsXG4gICAgY29udGVudFR5cGU6IHJvdy5jb250ZW50X3R5cGUgfHwgbnVsbCxcbiAgICBmaWxlbmFtZTogcm93LmZpbGVuYW1lIHx8IFwiYXR0YWNobWVudC5iaW5cIixcbiAgICBpZDogcm93LmlkLFxuICAgIHVybFxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgaXMgYXJyYXkuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2hldGhlciB2YWx1ZSBpcyBhbiBhcnJheS5cbiAqL1xuZnVuY3Rpb24gaXNBcnJheSh2YWx1ZSkge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh2YWx1ZSlcbn1cblxuLyoqXG4gKiBBdHRhY2htZW50IGhlbHBlciBib3VuZCB0byBvbmUgbW9kZWwgKyBhdHRhY2htZW50IG5hbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJlY29yZEF0dGFjaG1lbnRIYW5kbGUge1xuICAvKipcbiAgICogUGVuZGluZyBpbnB1dHMuXG4gICAqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIHBlbmRpbmdJbnB1dHMgPSBbXVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1wiaGFzT25lXCIgfCBcImhhc01hbnlcIn0gYXJncy50eXBlIC0gQXR0YWNobWVudCB0eXBlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe21vZGVsLCBuYW1lLCB0eXBlfSkge1xuICAgIHRoaXMubW9kZWwgPSBtb2RlbFxuICAgIHRoaXMubmFtZSA9IG5hbWVcbiAgICB0aGlzLnR5cGUgPSB0eXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgcGVuZGluZyBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGVyZSBhcmUgcGVuZGluZyBhdHRhY2htZW50IHdyaXRlcy5cbiAgICovXG4gIGhhc1BlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5wZW5kaW5nSW5wdXRzLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXVlIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBRdWV1ZXMgYXR0YWNobWVudCB3cml0ZSBmb3IgbmV4dCBzYXZlLlxuICAgKi9cbiAgcXVldWVBdHRhY2goaW5wdXQpIHtcbiAgICBpZiAodGhpcy50eXBlID09PSBcImhhc09uZVwiKSB7XG4gICAgICBpZiAoaXNBcnJheShpbnB1dCkpIHtcbiAgICAgICAgY29uc3QgbGFzdElucHV0ID0gaW5wdXRbaW5wdXQubGVuZ3RoIC0gMV1cblxuICAgICAgICB0aGlzLnBlbmRpbmdJbnB1dHMgPSB0eXBlb2YgbGFzdElucHV0ID09PSBcInVuZGVmaW5lZFwiID8gW10gOiBbbGFzdElucHV0XVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW2lucHV0XVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoaXNBcnJheShpbnB1dCkpIHtcbiAgICAgIGZvciAoY29uc3QgaW5wdXRFbnRyeSBvZiBpbnB1dCkge1xuICAgICAgICB0aGlzLnBlbmRpbmdJbnB1dHMucHVzaChpbnB1dEVudHJ5KVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnBlbmRpbmdJbnB1dHMucHVzaChpbnB1dClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2guXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhdHRhY2hlZC5cbiAgICovXG4gIGFzeW5jIGF0dGFjaChpbnB1dCkge1xuICAgIHRoaXMucXVldWVBdHRhY2goaW5wdXQpXG4gICAgYXdhaXQgdGhpcy5mbHVzaFBlbmRpbmdBdHRhY2htZW50cygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmbHVzaCBwZW5kaW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHBlbmRpbmcgYXR0YWNobWVudHMgYXJlIGZsdXNoZWQuXG4gICAqL1xuICBhc3luYyBmbHVzaFBlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICBpZiAoIXRoaXMubW9kZWwuaXNQZXJzaXN0ZWQoKSkgcmV0dXJuXG4gICAgaWYgKHRoaXMucGVuZGluZ0lucHV0cy5sZW5ndGggPCAxKSByZXR1cm5cblxuICAgIGNvbnN0IHN0b3JlID0gcmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcGVuZGluZ0lucHV0cyA9IHRoaXMucGVuZGluZ0lucHV0c1xuXG4gICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW11cblxuICAgIGZvciAoY29uc3QgW2luZGV4LCBpbnB1dF0gb2YgcGVuZGluZ0lucHV0cy5lbnRyaWVzKCkpIHtcbiAgICAgIGF3YWl0IHN0b3JlLmF0dGFjaCh7XG4gICAgICAgIGlucHV0LFxuICAgICAgICBtb2RlbDogdGhpcy5tb2RlbCxcbiAgICAgICAgbmFtZTogdGhpcy5uYW1lLFxuICAgICAgICByZXBsYWNlOiB0aGlzLnR5cGUgPT09IFwiaGFzT25lXCIgJiYgaW5kZXggPT09IDBcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbaWRdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBpZCBmb3IgaGFzLW1hbnkgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZEF0dGFjaG1lbnREb3dubG9hZCB8IG51bGw+fSAtIERvd25sb2FkZWQgYXR0YWNobWVudC5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkKGlkKSB7XG4gICAgaWYgKCF0aGlzLm1vZGVsLmlzUGVyc2lzdGVkKCkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzdG9yZSA9IHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbCh0aGlzLm1vZGVsKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IHN0b3JlLmZpbmRPbmUoe2lkLCBtb2RlbDogdGhpcy5tb2RlbCwgbmFtZTogdGhpcy5uYW1lfSlcblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgW2NvbnRlbnQsIHVybF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBzdG9yZS5yZWFkQXR0YWNobWVudFJvdyh7bW9kZWw6IHRoaXMubW9kZWwsIG5hbWU6IHRoaXMubmFtZSwgcm93fSksXG4gICAgICBzdG9yZS5hdHRhY2htZW50Um93VXJsKHttb2RlbDogdGhpcy5tb2RlbCwgbmFtZTogdGhpcy5uYW1lLCByb3d9KVxuICAgIF0pXG5cbiAgICByZXR1cm4gZG93bmxvYWRGcm9tUm93KHtjb250ZW50LCByb3csIHVybH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkb3dubG9hZCBhbGwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJlY29yZEF0dGFjaG1lbnREb3dubG9hZD4+fSAtIERvd25sb2FkZWQgYXR0YWNobWVudHMuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZEFsbCgpIHtcbiAgICBpZiAoIXRoaXMubW9kZWwuaXNQZXJzaXN0ZWQoKSkgcmV0dXJuIFtdXG5cbiAgICBjb25zdCBzdG9yZSA9IHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbCh0aGlzLm1vZGVsKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBzdG9yZS5maW5kTWFueSh7bW9kZWw6IHRoaXMubW9kZWwsIG5hbWU6IHRoaXMubmFtZX0pXG4gICAgLyoqXG4gICAgICogRG93bmxvYWRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmRBdHRhY2htZW50RG93bmxvYWRbXX0gKi9cbiAgICBjb25zdCBkb3dubG9hZHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgW2NvbnRlbnQsIHVybF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgIHN0b3JlLnJlYWRBdHRhY2htZW50Um93KHttb2RlbDogdGhpcy5tb2RlbCwgbmFtZTogdGhpcy5uYW1lLCByb3d9KSxcbiAgICAgICAgc3RvcmUuYXR0YWNobWVudFJvd1VybCh7bW9kZWw6IHRoaXMubW9kZWwsIG5hbWU6IHRoaXMubmFtZSwgcm93fSlcbiAgICAgIF0pXG5cbiAgICAgIGRvd25sb2Fkcy5wdXNoKGRvd25sb2FkRnJvbVJvdyh7Y29udGVudCwgcm93LCB1cmx9KSlcbiAgICB9XG5cbiAgICByZXR1cm4gZG93bmxvYWRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaXN0IG1ldGFkYXRhLiBSZXR1cm5zIG1ldGFkYXRhIChubyBjb250ZW50IGJ5dGVzKSBmb3IgZXZlcnkgYXR0YWNobWVudFxuICAgKiB1bmRlciB0aGlzIChyZWNvcmQsIG5hbWUpLCBzbyBjYWxsZXJzIGNhbiBlbnVtZXJhdGUgaGFzLW1hbnkgYXR0YWNobWVudHNcbiAgICogd2l0aG91dCBkb3dubG9hZGluZyB0aGVpciBjb250ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7Ynl0ZVNpemU6IG51bWJlciwgY29udGVudFR5cGU6IHN0cmluZyB8IG51bGwsIGZpbGVuYW1lOiBzdHJpbmcsIGlkOiBzdHJpbmcsIHVybDogc3RyaW5nIHwgbnVsbH0+Pn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIGVudHJpZXMuXG4gICAqL1xuICBhc3luYyBsaXN0TWV0YWRhdGEoKSB7XG4gICAgaWYgKCF0aGlzLm1vZGVsLmlzUGVyc2lzdGVkKCkpIHJldHVybiBbXVxuXG4gICAgY29uc3Qgc3RvcmUgPSByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwodGhpcy5tb2RlbClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgc3RvcmUuZmluZE1hbnkoe21vZGVsOiB0aGlzLm1vZGVsLCBuYW1lOiB0aGlzLm5hbWV9KVxuICAgIC8qKlxuICAgICAqIE1ldGFkYXRhIGVudHJpZXMuXG4gICAgICogQHR5cGUge0FycmF5PHtieXRlU2l6ZTogbnVtYmVyLCBjb250ZW50VHlwZTogc3RyaW5nIHwgbnVsbCwgZmlsZW5hbWU6IHN0cmluZywgaWQ6IHN0cmluZywgdXJsOiBzdHJpbmcgfCBudWxsfT59ICovXG4gICAgY29uc3QgZW50cmllcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCB1cmwgPSBhd2FpdCBzdG9yZS5hdHRhY2htZW50Um93VXJsKHttb2RlbDogdGhpcy5tb2RlbCwgbmFtZTogdGhpcy5uYW1lLCByb3d9KVxuICAgICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIocm93LmJ5dGVfc2l6ZSlcblxuICAgICAgZW50cmllcy5wdXNoKHtcbiAgICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiByb3cuY29udGVudF90eXBlIHx8IG51bGwsXG4gICAgICAgIGZpbGVuYW1lOiByb3cuZmlsZW5hbWUgfHwgXCJhdHRhY2htZW50LmJpblwiLFxuICAgICAgICBpZDogcm93LmlkLFxuICAgICAgICB1cmxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJpZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtpZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkIGZvciBoYXMtbWFueSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIHVybChpZCkge1xuICAgIGlmICghdGhpcy5tb2RlbC5pc1BlcnNpc3RlZCgpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc3RvcmUgPSByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwodGhpcy5tb2RlbClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBzdG9yZS5maW5kT25lKHtpZCwgbW9kZWw6IHRoaXMubW9kZWwsIG5hbWU6IHRoaXMubmFtZX0pXG5cbiAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCBzdG9yZS5hdHRhY2htZW50Um93VXJsKHttb2RlbDogdGhpcy5tb2RlbCwgbmFtZTogdGhpcy5uYW1lLCByb3d9KVxuICB9XG5cbiAgLyoqXG4gICAqIFB1cmdlcyBldmVyeSBhdHRhY2htZW50IHVuZGVyIHRoaXMgKHJlY29yZCwgbmFtZSk6IGRlbGV0ZXMgdGhlIGJhY2tpbmdcbiAgICogc3RvcmFnZSBmb3IgZWFjaCBhbmQgcmVtb3ZlcyB0aGUgYXR0YWNobWVudCByb3dzLiBBIG5vLW9wIGZvciB1bnBlcnNpc3RlZFxuICAgKiByZWNvcmRzLiBPbmx5IHRoZSBhdHRhY2htZW50cyBwcmVzZW50IHdoZW4gdGhlIHB1cmdlIHN0YXJ0cyBhcmUgcmVtb3ZlZCwgc28gYVxuICAgKiBjb25jdXJyZW50IGF0dGFjaCBmb3IgdGhlIHNhbWUgKHJlY29yZCwgbmFtZSkgaXMgbGVmdCBpbnRhY3QuIFRocm93cyAod2l0aG91dFxuICAgKiBkZWxldGluZyBhbnkgcm93cykgaWYgYSBzdG9yYWdlIGRyaXZlciBjYW5ub3QgZGVsZXRlIGl0cyBvYmplY3QsIHNvIGEgZHJpdmVyXG4gICAqIGNvbmZpZ3VyZWQgd2l0aG91dCBhIGBkZWxldGVgIG9wZXJhdGlvbiBjYW4gbmV2ZXIgbGVhayBzdG9yYWdlLiBDYWxsZXJzIHVzZVxuICAgKiB0aGlzIHRvIGNsZWFuIHVwIGF0dGFjaG1lbnRzIGJlZm9yZSBkZXN0cm95aW5nIHRoZSBvd25lciByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIGF0dGFjaG1lbnRzIHB1cmdlZC5cbiAgICovXG4gIGFzeW5jIHB1cmdlQWxsKCkge1xuICAgIGlmICghdGhpcy5tb2RlbC5pc1BlcnNpc3RlZCgpKSByZXR1cm4gMFxuXG4gICAgY29uc3Qgc3RvcmUgPSByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwodGhpcy5tb2RlbClcblxuICAgIHJldHVybiBhd2FpdCBzdG9yZS5wdXJnZUFsbCh7bW9kZWw6IHRoaXMubW9kZWwsIG5hbWU6IHRoaXMubmFtZX0pXG4gIH1cbn1cbiJdfQ==
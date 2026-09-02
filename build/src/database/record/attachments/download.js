// @ts-check
/** Downloaded attachment payload wrapper. */
export default class RecordAttachmentDownload {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {string} args.id - Attachment id.
     * @param {string} args.filename - Filename.
     * @param {string | null} args.contentType - Content type.
     * @param {number} args.byteSize - File size in bytes.
     * @param {Buffer} args.content - File content.
     * @param {string | null} [args.url] - Resolvable URL.
     */
    constructor({ byteSize, content, contentType, filename, id, url = null }) {
        this.values = { byteSize, content, contentType, filename, id, url };
    }
    /**
     * Runs byte size.
     * @returns {number} - File size in bytes.
     */
    byteSize() { return this.values.byteSize; }
    /**
     * Runs content.
     * @returns {Buffer} - File content.
     */
    content() { return this.values.content; }
    /**
     * Runs content type.
     * @returns {string | null} - Content type.
     */
    contentType() { return this.values.contentType; }
    /**
     * Runs filename.
     * @returns {string} - Filename.
     */
    filename() { return this.values.filename; }
    /**
     * Runs id.
     * @returns {string} - Attachment id.
     */
    id() { return this.values.id; }
    /**
     * Runs url.
     * @returns {string | null} - Resolvable attachment URL.
     */
    url() { return this.values.url; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG93bmxvYWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL2Rvd25sb2FkLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWiw2Q0FBNkM7QUFDN0MsTUFBTSxDQUFDLE9BQU8sT0FBTyx3QkFBd0I7SUFDM0M7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUFDLFFBQVEsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUUsR0FBRyxHQUFHLElBQUksRUFBQztRQUNwRSxJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLEVBQUUsRUFBRSxHQUFHLEVBQUMsQ0FBQTtJQUNuRSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsUUFBUSxLQUFLLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUEsQ0FBQyxDQUFDO0lBQzFDOzs7T0FHRztJQUNILE9BQU8sS0FBSyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFBLENBQUMsQ0FBQztJQUN4Qzs7O09BR0c7SUFDSCxXQUFXLEtBQUssT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQSxDQUFDLENBQUM7SUFDaEQ7OztPQUdHO0lBQ0gsUUFBUSxLQUFLLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUEsQ0FBQyxDQUFDO0lBQzFDOzs7T0FHRztJQUNILEVBQUUsS0FBSyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFBLENBQUMsQ0FBQztJQUM5Qjs7O09BR0c7SUFDSCxHQUFHLEtBQUssT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQSxDQUFDLENBQUM7Q0FDakMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqIERvd25sb2FkZWQgYXR0YWNobWVudCBwYXlsb2FkIHdyYXBwZXIuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBSZWNvcmRBdHRhY2htZW50RG93bmxvYWQge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZCAtIEF0dGFjaG1lbnQgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVuYW1lIC0gRmlsZW5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5jb250ZW50VHlwZSAtIENvbnRlbnQgdHlwZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYnl0ZVNpemUgLSBGaWxlIHNpemUgaW4gYnl0ZXMuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBhcmdzLmNvbnRlbnQgLSBGaWxlIGNvbnRlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3MudXJsXSAtIFJlc29sdmFibGUgVVJMLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2J5dGVTaXplLCBjb250ZW50LCBjb250ZW50VHlwZSwgZmlsZW5hbWUsIGlkLCB1cmwgPSBudWxsfSkge1xuICAgIHRoaXMudmFsdWVzID0ge2J5dGVTaXplLCBjb250ZW50LCBjb250ZW50VHlwZSwgZmlsZW5hbWUsIGlkLCB1cmx9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBieXRlIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRmlsZSBzaXplIGluIGJ5dGVzLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLnZhbHVlcy5ieXRlU2l6ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGNvbnRlbnQuXG4gICAqIEByZXR1cm5zIHtCdWZmZXJ9IC0gRmlsZSBjb250ZW50LlxuICAgKi9cbiAgY29udGVudCgpIHsgcmV0dXJuIHRoaXMudmFsdWVzLmNvbnRlbnQgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENvbnRlbnQgdHlwZS5cbiAgICovXG4gIGNvbnRlbnRUeXBlKCkgeyByZXR1cm4gdGhpcy52YWx1ZXMuY29udGVudFR5cGUgfVxuICAvKipcbiAgICogUnVucyBmaWxlbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGaWxlbmFtZS5cbiAgICovXG4gIGZpbGVuYW1lKCkgeyByZXR1cm4gdGhpcy52YWx1ZXMuZmlsZW5hbWUgfVxuICAvKipcbiAgICogUnVucyBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGlkLlxuICAgKi9cbiAgaWQoKSB7IHJldHVybiB0aGlzLnZhbHVlcy5pZCB9XG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIHVybCgpIHsgcmV0dXJuIHRoaXMudmFsdWVzLnVybCB9XG59XG4iXX0=
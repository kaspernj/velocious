// @ts-check
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import Logger from "../../../logger.js";
import MemoryUploadedFile from "../uploaded-file/memory-uploaded-file.js";
import TemporaryUploadedFile from "../uploaded-file/temporary-uploaded-file.js";
const MAX_IN_MEMORY_FILE_SIZE = 2 * 1024 * 1024;
export default class FormDataPart {
    logger = new Logger(this, { debug: false });
    /**
     * Headers.
     * @type {Record<string, import("./header.js").default>} */
    headers = {};
    /**
     * Body.
     * @type {number[]} */
    body = [];
    /**
     * Runs add header.
     * @param {import("./header.js").default} header - Header value.
     */
    addHeader(header) {
        const name = header.formattedName;
        this.headers[name] = header;
        if (name == "content-disposition") {
            const match = header.value.match(/^form-data;\s*name="(.+?)"(?:;\s*filename="(.+?)")?$/);
            if (match) {
                this.name = match[1];
                this.filename = match[2];
            }
            else {
                this.logger.error(() => [`Couldn't match name from content-disposition`, { headerValue: header.value }]);
            }
        }
        else if (name == "content-length") {
            this.contentLength = parseInt(header.value);
        }
        else if (name == "content-type") {
            this.contentType = header.value;
        }
    }
    finish() {
        const buffer = Buffer.from(this.body);
        this.size = buffer.length;
        if (this.isFile()) {
            this.value = this.buildUploadedFile(buffer);
        }
        else {
            this.value = buffer.toString();
        }
        this.body = [];
    }
    /**
     * Runs build uploaded file.
     * @param {Buffer} buffer - File buffer.
     * @returns {import("../uploaded-file/memory-uploaded-file.js").default | import("../uploaded-file/temporary-uploaded-file.js").default} - Uploaded file wrapper.
     */
    buildUploadedFile(buffer) {
        const filename = this._sanitizeFilename(this.filename) || "upload";
        const fieldName = this.getName();
        const commonArgs = {
            contentType: this.contentType,
            fieldName,
            filename,
            size: this.size || buffer.length
        };
        if (buffer.length <= MAX_IN_MEMORY_FILE_SIZE) {
            return new MemoryUploadedFile({ ...commonArgs, buffer });
        }
        const tempFilePath = this.createTempFile(buffer, filename);
        return new TemporaryUploadedFile({ ...commonArgs, path: tempFilePath });
    }
    /**
     * Runs create temp file.
     * @param {Buffer} buffer - Buffer.
     * @param {string} filename - Filename.
     * @returns {string} - The temp file.
     */
    createTempFile(buffer, filename) {
        const tempDirectory = fs.mkdtempSync(path.join(tmpdir(), "velocious-upload-"));
        const tempFilePath = path.join(tempDirectory, filename);
        fs.writeFileSync(tempFilePath, buffer);
        return tempFilePath;
    }
    /**
     * Prevent path traversal/absolute paths from filenames coming from headers.
     * @param {string | undefined} filename - Filename.
     * @returns {string} - The sanitize filename.
     */
    _sanitizeFilename(filename) {
        if (!filename)
            return "";
        const base = path.basename(filename);
        if (base === "." || base === ".." || base === "")
            return "upload";
        return base;
    }
    getName() {
        if (!this.name)
            throw new Error("Name hasn't been set");
        return this.name;
    }
    getValue() {
        if (typeof this.value === "undefined")
            throw new Error("Value hasn't been set");
        return this.value;
    }
    isFile() { return Boolean(this.filename); }
    /**
     * Runs remove from body.
     * @param {string} text - Text.
     */
    removeFromBody(text) {
        this.body = this.body.slice(0, this.body.length - text.length);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZm9ybS1kYXRhLXBhcnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtYnVmZmVyL2Zvcm0tZGF0YS1wYXJ0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUE7QUFDbkIsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxJQUFJLENBQUE7QUFDekIsT0FBTyxNQUFNLE1BQU0sb0JBQW9CLENBQUE7QUFDdkMsT0FBTyxrQkFBa0IsTUFBTSwwQ0FBMEMsQ0FBQTtBQUN6RSxPQUFPLHFCQUFxQixNQUFNLDZDQUE2QyxDQUFBO0FBRS9FLE1BQU0sdUJBQXVCLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUE7QUFFL0MsTUFBTSxDQUFDLE9BQU8sT0FBTyxZQUFZO0lBQy9CLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtJQUV6Qzs7K0RBRTJEO0lBQzNELE9BQU8sR0FBRyxFQUFFLENBQUE7SUFFWjs7MEJBRXNCO0lBQ3RCLElBQUksR0FBRyxFQUFFLENBQUE7SUFFVDs7O09BR0c7SUFDSCxTQUFTLENBQUMsTUFBTTtRQUNkLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxhQUFhLENBQUE7UUFFakMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxNQUFNLENBQUE7UUFFM0IsSUFBSSxJQUFJLElBQUkscUJBQXFCLEVBQUUsQ0FBQztZQUNsQyxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxzREFBc0QsQ0FBQyxDQUFBO1lBRXhGLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQ1YsSUFBSSxDQUFDLElBQUksR0FBRyxL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cEMsSUFBSSxJQUFJLEtBQUssR0FBRyxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxLQUFLLEVBQUU7WUFBRSxPQUFPLFFBQVEsQ0FBQTtRQUVqRSxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRCxPQUFPO1FBQ0wsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO1FBRXZELE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQTtJQUNsQixDQUFDO0lBRUQsUUFBUTtRQUNOLElBQUksT0FBTyxJQUFJLENBQUMsS0FBSyxLQUFLLFdBQVc7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixDQUFDLENBQUE7UUFFL0UsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ25CLENBQUM7SUFFRCxNQUFNLEtBQUssT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUxQzs7O09BR0c7SUFDSCxjQUFjLENBQUMsSUFBSTtRQUNqQixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDaEUsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBmcyBmcm9tIFwiZnNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHt0bXBkaXJ9IGZyb20gXCJvc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IE1lbW9yeVVwbG9hZGVkRmlsZSBmcm9tIFwiLi4vdXBsb2FkZWQtZmlsZS9tZW1vcnktdXBsb2FkZWQtZmlsZS5qc1wiXG5pbXBvcnQgVGVtcG9yYXJ5VXBsb2FkZWRGaWxlIGZyb20gXCIuLi91cGxvYWRlZC1maWxlL3RlbXBvcmFyeS11cGxvYWRlZC1maWxlLmpzXCJcblxuY29uc3QgTUFYX0lOX01FTU9SWV9GSUxFX1NJWkUgPSAyICogMTAyNCAqIDEwMjRcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRm9ybURhdGFQYXJ0IHtcbiAgbG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzLCB7ZGVidWc6IGZhbHNlfSlcblxuICAvKipcbiAgICogSGVhZGVycy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vaGVhZGVyLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBoZWFkZXJzID0ge31cblxuICAvKipcbiAgICogQm9keS5cbiAgICogQHR5cGUge251bWJlcltdfSAqL1xuICBib2R5ID0gW11cblxuICAvKipcbiAgICogUnVucyBhZGQgaGVhZGVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaGVhZGVyLmpzXCIpLmRlZmF1bHR9IGhlYWRlciAtIEhlYWRlciB2YWx1ZS5cbiAgICovXG4gIGFkZEhlYWRlcihoZWFkZXIpIHtcbiAgICBjb25zdCBuYW1lID0gaGVhZGVyLmZvcm1hdHRlZE5hbWVcblxuICAgIHRoaXMuaGVhZGVyc1tuYW1lXSA9IGhlYWRlclxuXG4gICAgaWYgKG5hbWUgPT0gXCJjb250ZW50LWRpc3Bvc2l0aW9uXCIpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gaGVhZGVyLnZhbHVlLm1hdGNoKC9eZm9ybS1kYXRhO1xccypuYW1lPVwiKC4rPylcIig/OjtcXHMqZmlsZW5hbWU9XCIoLis/KVwiKT8kLylcblxuICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG1hdGNoWzFdXG4gICAgICAgIHRoaXMuZmlsZW5hbWUgPSBtYXRjaFsyXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2BDb3VsZG4ndCBtYXRjaCBuYW1lIGZyb20gY29udGVudC1kaXNwb3NpdGlvbmAsIHtoZWFkZXJWYWx1ZTogaGVhZGVyLnZhbHVlfV0pXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChuYW1lID09IFwiY29udGVudC1sZW5ndGhcIikge1xuICAgICAgdGhpcy5jb250ZW50TGVuZ3RoID0gcGFyc2VJbnQoaGVhZGVyLnZhbHVlKVxuICAgIH0gZWxzZSBpZiAobmFtZSA9PSBcImNvbnRlbnQtdHlwZVwiKSB7XG4gICAgICB0aGlzLmNvbnRlbnRUeXBlID0gaGVhZGVyLnZhbHVlXG4gICAgfVxuICB9XG5cbiAgZmluaXNoKCkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IEJ1ZmZlci5mcm9tKHRoaXMuYm9keSlcblxuICAgIHRoaXMuc2l6ZSA9IGJ1ZmZlci5sZW5ndGhcblxuICAgIGlmICh0aGlzLmlzRmlsZSgpKSB7XG4gICAgICB0aGlzLnZhbHVlID0gdGhpcy5idWlsZFVwbG9hZGVkRmlsZShidWZmZXIpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudmFsdWUgPSBidWZmZXIudG9TdHJpbmcoKVxuICAgIH1cblxuICAgIHRoaXMuYm9keSA9IFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCB1cGxvYWRlZCBmaWxlLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gYnVmZmVyIC0gRmlsZSBidWZmZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91cGxvYWRlZC1maWxlL21lbW9yeS11cGxvYWRlZC1maWxlLmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi91cGxvYWRlZC1maWxlL3RlbXBvcmFyeS11cGxvYWRlZC1maWxlLmpzXCIpLmRlZmF1bHR9IC0gVXBsb2FkZWQgZmlsZSB3cmFwcGVyLlxuICAgKi9cbiAgYnVpbGRVcGxvYWRlZEZpbGUoYnVmZmVyKSB7XG4gICAgY29uc3QgZmlsZW5hbWUgPSB0aGlzLl9zYW5pdGl6ZUZpbGVuYW1lKHRoaXMuZmlsZW5hbWUpIHx8IFwidXBsb2FkXCJcbiAgICBjb25zdCBmaWVsZE5hbWUgPSB0aGlzLmdldE5hbWUoKVxuICAgIGNvbnN0IGNvbW1vbkFyZ3MgPSB7XG4gICAgICBjb250ZW50VHlwZTogdGhpcy5jb250ZW50VHlwZSxcbiAgICAgIGZpZWxkTmFtZSxcbiAgICAgIGZpbGVuYW1lLFxuICAgICAgc2l6ZTogdGhpcy5zaXplIHx8IGJ1ZmZlci5sZW5ndGhcbiAgICB9XG5cbiAgICBpZiAoYnVmZmVyLmxlbmd0aCA8PSBNQVhfSU5fTUVNT1JZX0ZJTEVfU0laRSkge1xuICAgICAgcmV0dXJuIG5ldyBNZW1vcnlVcGxvYWRlZEZpbGUoey4uLmNvbW1vbkFyZ3MsIGJ1ZmZlcn0pXG4gICAgfVxuXG4gICAgY29uc3QgdGVtcEZpbGVQYXRoID0gdGhpcy5jcmVhdGVUZW1wRmlsZShidWZmZXIsIGZpbGVuYW1lKVxuXG4gICAgcmV0dXJuIG5ldyBUZW1wb3JhcnlVcGxvYWRlZEZpbGUoey4uLmNvbW1vbkFyZ3MsIHBhdGg6IHRlbXBGaWxlUGF0aH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGVtcCBmaWxlLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gYnVmZmVyIC0gQnVmZmVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZW5hbWUgLSBGaWxlbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdGVtcCBmaWxlLlxuICAgKi9cbiAgY3JlYXRlVGVtcEZpbGUoYnVmZmVyLCBmaWxlbmFtZSkge1xuICAgIGNvbnN0IHRlbXBEaXJlY3RvcnkgPSBmcy5ta2R0ZW1wU3luYyhwYXRoLmpvaW4odG1wZGlyKCksIFwidmVsb2Npb3VzLXVwbG9hZC1cIikpXG4gICAgY29uc3QgdGVtcEZpbGVQYXRoID0gcGF0aC5qb2luKHRlbXBEaXJlY3RvcnksIGZpbGVuYW1lKVxuXG4gICAgZnMud3JpdGVGaWxlU3luYyh0ZW1wRmlsZVBhdGgsIGJ1ZmZlcilcblxuICAgIHJldHVybiB0ZW1wRmlsZVBhdGhcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmV2ZW50IHBhdGggdHJhdmVyc2FsL2Fic29sdXRlIHBhdGhzIGZyb20gZmlsZW5hbWVzIGNvbWluZyBmcm9tIGhlYWRlcnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBmaWxlbmFtZSAtIEZpbGVuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBzYW5pdGl6ZSBmaWxlbmFtZS5cbiAgICovXG4gIF9zYW5pdGl6ZUZpbGVuYW1lKGZpbGVuYW1lKSB7XG4gICAgaWYgKCFmaWxlbmFtZSkgcmV0dXJuIFwiXCJcblxuICAgIGNvbnN0IGJhc2UgPSBwYXRoLmJhc2VuYW1lKGZpbGVuYW1lKVxuXG4gICAgaWYgKGJhc2UgPT09IFwiLlwiIHx8IGJhc2UgPT09IFwiLi5cIiB8fCBiYXNlID09PSBcIlwiKSByZXR1cm4gXCJ1cGxvYWRcIlxuXG4gICAgcmV0dXJuIGJhc2VcbiAgfVxuXG4gIGdldE5hbWUoKSB7XG4gICAgaWYgKCF0aGlzLm5hbWUpIHRocm93IG5ldyBFcnJvcihcIk5hbWUgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5uYW1lXG4gIH1cblxuICBnZXRWYWx1ZSgpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMudmFsdWUgPT09IFwidW5kZWZpbmVkXCIpIHRocm93IG5ldyBFcnJvcihcIlZhbHVlIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMudmFsdWVcbiAgfVxuXG4gIGlzRmlsZSgpIHsgcmV0dXJuIEJvb2xlYW4odGhpcy5maWxlbmFtZSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBmcm9tIGJvZHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0IC0gVGV4dC5cbiAgICovXG4gIHJlbW92ZUZyb21Cb2R5KHRleHQpIHtcbiAgICB0aGlzLmJvZHkgPSB0aGlzLmJvZHkuc2xpY2UoMCwgdGhpcy5ib2R5Lmxlbmd0aCAtIHRleHQubGVuZ3RoKVxuICB9XG59XG4iXX0=
// @ts-check
import Header from "./header.js";
import { deserializeFrontendModelTransportValue } from "../frontend-models/transport-serialization.js";
export default class Response {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.method - HTTP method.
     * @param {() => void} args.onComplete - On complete.
     */
    constructor({ method = "GET", onComplete }) {
        if (!method)
            throw new Error(`Invalid method given: ${method}`);
        /**
         * Narrows the runtime value to the documented type.
         * @type {Header[]} */
        this.headers = [];
        this.method = method.toUpperCase().trim();
        this.onComplete = onComplete;
        this.state = "status-line";
        /**
         * Narrows the runtime value to the documented type.
         * @type {Buffer} */
        this.response = Buffer.alloc(0);
    }
    /**
     * Runs feed.
     * @param {Buffer} data - Response data chunk.
     */
    feed(data) {
        this.response = Buffer.concat([this.response, data]);
        this.tryToParse();
    }
    /**
     * Runs get header.
     * @param {string} name - Name.
     * @returns {Header} - The header.
     */
    getHeader(name) {
        const compareName = name.toLowerCase().trim();
        for (const header of this.headers) {
            const headerCompareName = header.getName().toLowerCase().trim();
            if (compareName == headerCompareName) {
                return header;
            }
        }
        throw new Error(`Header ${name} not found`);
    }
    json() {
        const contentTypeHeader = this.getHeader("Content-Type")?.getValue();
        if (typeof contentTypeHeader != "string")
            throw new Error(`Content-Type wasn't a string: ${contentTypeHeader}`);
        if (!contentTypeHeader.toLowerCase().trim().startsWith("application/json")) {
            throw new Error(`Content-Type is not JSON: ${contentTypeHeader}`);
        }
        const body = this.response.toString();
        const json = JSON.parse(body);
        return deserializeFrontendModelTransportValue(json);
    }
    tryToParse() {
        while (true) {
            if (this.state == "body") {
                const contentLengthNumber = this._contentLengthNumber();
                if (this.response.byteLength >= contentLengthNumber) {
                    this.completeResponse();
                    break;
                }
            }
            else {
                const response = this.response.toString();
                let lineEndIndex = response.indexOf("\r\n");
                let lineEndLength = 2;
                if (lineEndIndex === -1) {
                    lineEndIndex = response.indexOf("\n");
                    lineEndLength = 1;
                }
                if (lineEndIndex === -1) {
                    break; // We need to get fed more to continue reading
                }
                else {
                    const line = response.substring(0, lineEndIndex);
                    this.response = this.response.slice(lineEndIndex + lineEndLength);
                    if (this.state == "status-line") {
                        this.statusLine = line;
                        this.state = "headers";
                    }
                    else if (this.state == "headers") {
                        if (line == "") {
                            const contentLengthNumber = this._contentLengthNumber();
                            if (!contentLengthNumber) {
                                this.completeResponse();
                                break;
                            }
                            else {
                                this.state = "body";
                            }
                        }
                        else {
                            const headerMatch = line.match(/^(.+?):\s*(.+)$/);
                            if (!headerMatch)
                                throw new Error(`Invalid header: ${line}`);
                            const header = new Header(headerMatch[1], headerMatch[2]);
                            this.headers.push(header);
                        }
                    }
                    else {
                        throw new Error(`Unexpected state: ${this.state}`);
                    }
                }
            }
        }
    }
    completeResponse() {
        this.state = "done";
        this.onComplete();
    }
    /**
     * Runs content length number.
     * @returns {number} - The content length number.
     */
    _contentLengthNumber() {
        const header = this.headers.find((currentHeader) => currentHeader.getName().toLowerCase() == "content-length");
        if (!header)
            return 0;
        const contentLengthValue = header.getValue();
        if (typeof contentLengthValue === "number")
            return contentLengthValue;
        if (typeof contentLengthValue === "string")
            return parseInt(contentLengthValue);
        throw new Error(`Content-Length is not a number: ${contentLengthValue}`);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzcG9uc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1jbGllbnQvcmVzcG9uc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sTUFBTSxNQUFNLGFBQWEsQ0FBQTtBQUNoQyxPQUFPLEVBQUMsc0NBQXNDLEVBQUMsTUFBTSwrQ0FBK0MsQ0FBQTtBQUVwRyxNQUFNLENBQUMsT0FBTyxPQUFPLFFBQVE7SUFDM0I7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsTUFBTSxHQUFHLEtBQUssRUFBRSxVQUFVLEVBQUM7UUFDdEMsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixNQUFNLEVBQUUsQ0FBQyxDQUFBO1FBRS9EOzs4QkFFc0I7UUFDdEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxFQUFFLENBQUE7UUFFakIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUE7UUFDekMsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7UUFDNUIsSUFBSSxDQUFDLEtBQUssR0FBRyxhQUFhLENBQUE7UUFFMUI7OzRCQUVvQjtRQUNwQixJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILElBQUksQ0FBQyxJQUFJO1FBQ1AsSUFBSSxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFBO1FBQ3BELElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFNBQVMsQ0FBQyxJQUFJO1FBQ1osTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLElBQUksRUFBRSxD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QUFNLGtCQUFrQixHQUFHLE1BQU0sQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUU1QyxJQUFJLE9BQU8sa0JBQWtCLEtBQUssUUFBUTtZQUFFLE9BQU8sa0JBQWtCLENBQUE7UUFDckUsSUFBSSxPQUFPLGtCQUFrQixLQUFLLFFBQVE7WUFBRSxPQUFPLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRS9FLE1BQU0sSUFBSSxLQUFLLENBQUMsbUNBQW1DLGtCQUFrQixFQUFFLENBQUMsQ0FBQTtJQUMxRSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEhlYWRlciBmcm9tIFwiLi9oZWFkZXIuanNcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJlc3BvbnNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZCAtIEhUVFAgbWV0aG9kLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IGFyZ3Mub25Db21wbGV0ZSAtIE9uIGNvbXBsZXRlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe21ldGhvZCA9IFwiR0VUXCIsIG9uQ29tcGxldGV9KSB7XG4gICAgaWYgKCFtZXRob2QpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBtZXRob2QgZ2l2ZW46ICR7bWV0aG9kfWApXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0hlYWRlcltdfSAqL1xuICAgIHRoaXMuaGVhZGVycyA9IFtdXG5cbiAgICB0aGlzLm1ldGhvZCA9IG1ldGhvZC50b1VwcGVyQ2FzZSgpLnRyaW0oKVxuICAgIHRoaXMub25Db21wbGV0ZSA9IG9uQ29tcGxldGVcbiAgICB0aGlzLnN0YXRlID0gXCJzdGF0dXMtbGluZVwiXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0J1ZmZlcn0gKi9cbiAgICB0aGlzLnJlc3BvbnNlID0gQnVmZmVyLmFsbG9jKDApO1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmVlZC5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBSZXNwb25zZSBkYXRhIGNodW5rLlxuICAgKi9cbiAgZmVlZChkYXRhKSB7XG4gICAgdGhpcy5yZXNwb25zZSA9IEJ1ZmZlci5jb25jYXQoW3RoaXMucmVzcG9uc2UsIGRhdGFdKVxuICAgIHRoaXMudHJ5VG9QYXJzZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtIZWFkZXJ9IC0gVGhlIGhlYWRlci5cbiAgICovXG4gIGdldEhlYWRlcihuYW1lKSB7XG4gICAgY29uc3QgY29tcGFyZU5hbWUgPSBuYW1lLnRvTG93ZXJDYXNlKCkudHJpbSgpXG5cbiAgICBmb3IgKGNvbnN0IGhlYWRlciBvZiB0aGlzLmhlYWRlcnMpIHtcbiAgICAgIGNvbnN0IGhlYWRlckNvbXBhcmVOYW1lID0gaGVhZGVyLmdldE5hbWUoKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuXG4gICAgICBpZiAoY29tcGFyZU5hbWUgPT0gaGVhZGVyQ29tcGFyZU5hbWUpIHtcbiAgICAgICAgcmV0dXJuIGhlYWRlclxuICAgICAgfVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSGVhZGVyICR7bmFtZX0gbm90IGZvdW5kYClcbiAgfVxuXG4gIGpzb24oKSB7XG4gICAgY29uc3QgY29udGVudFR5cGVIZWFkZXIgPSB0aGlzLmdldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiKT8uZ2V0VmFsdWUoKVxuXG4gICAgaWYgKHR5cGVvZiBjb250ZW50VHlwZUhlYWRlciAhPSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoYENvbnRlbnQtVHlwZSB3YXNuJ3QgYSBzdHJpbmc6ICR7Y29udGVudFR5cGVIZWFkZXJ9YClcblxuICAgIGlmICghY29udGVudFR5cGVIZWFkZXIudG9Mb3dlckNhc2UoKS50cmltKCkuc3RhcnRzV2l0aChcImFwcGxpY2F0aW9uL2pzb25cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGVudC1UeXBlIGlzIG5vdCBKU09OOiAke2NvbnRlbnRUeXBlSGVhZGVyfWApXG4gICAgfVxuXG4gICAgY29uc3QgYm9keSA9IHRoaXMucmVzcG9uc2UudG9TdHJpbmcoKVxuICAgIGNvbnN0IGpzb24gPSBKU09OLnBhcnNlKGJvZHkpXG5cbiAgICByZXR1cm4gZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoanNvbilcbiAgfVxuXG4gIHRyeVRvUGFyc2UoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGlmICh0aGlzLnN0YXRlID09IFwiYm9keVwiKSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRMZW5ndGhOdW1iZXIgPSB0aGlzLl9jb250ZW50TGVuZ3RoTnVtYmVyKClcblxuICAgICAgICBpZiAodGhpcy5yZXNwb25zZS5ieXRlTGVuZ3RoID49IGNvbnRlbnRMZW5ndGhOdW1iZXIpIHtcbiAgICAgICAgICB0aGlzLmNvbXBsZXRlUmVzcG9uc2UoKVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gdGhpcy5yZXNwb25zZS50b1N0cmluZygpXG4gICAgICAgIGxldCBsaW5lRW5kSW5kZXggPSByZXNwb25zZS5pbmRleE9mKFwiXFxyXFxuXCIpXG4gICAgICAgIGxldCBsaW5lRW5kTGVuZ3RoID0gMlxuXG4gICAgICAgIGlmIChsaW5lRW5kSW5kZXggPT09IC0xKSB7XG4gICAgICAgICAgbGluZUVuZEluZGV4ID0gcmVzcG9uc2UuaW5kZXhPZihcIlxcblwiKVxuICAgICAgICAgIGxpbmVFbmRMZW5ndGggPSAxXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobGluZUVuZEluZGV4ID09PSAtMSkge1xuICAgICAgICAgIGJyZWFrIC8vIFdlIG5lZWQgdG8gZ2V0IGZlZCBtb3JlIHRvIGNvbnRpbnVlIHJlYWRpbmdcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBsaW5lID0gcmVzcG9uc2Uuc3Vic3RyaW5nKDAsIGxpbmVFbmRJbmRleClcblxuICAgICAgICAgIHRoaXMucmVzcG9uc2UgPSB0aGlzLnJlc3BvbnNlLnNsaWNlKGxpbmVFbmRJbmRleCArIGxpbmVFbmRMZW5ndGgpXG5cbiAgICAgICAgICBpZiAodGhpcy5zdGF0ZSA9PSBcInN0YXR1cy1saW5lXCIpIHtcbiAgICAgICAgICAgIHRoaXMuc3RhdHVzTGluZSA9IGxpbmVcbiAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBcImhlYWRlcnNcIlxuICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PSBcImhlYWRlcnNcIikge1xuICAgICAgICAgICAgaWYgKGxpbmUgPT0gXCJcIikge1xuICAgICAgICAgICAgICBjb25zdCBjb250ZW50TGVuZ3RoTnVtYmVyID0gdGhpcy5fY29udGVudExlbmd0aE51bWJlcigpXG5cbiAgICAgICAgICAgICAgaWYgKCFjb250ZW50TGVuZ3RoTnVtYmVyKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wbGV0ZVJlc3BvbnNlKClcbiAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBcImJvZHlcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb25zdCBoZWFkZXJNYXRjaCA9IGxpbmUubWF0Y2goL14oLis/KTpcXHMqKC4rKSQvKVxuXG4gICAgICAgICAgICAgIGlmICghaGVhZGVyTWF0Y2gpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBoZWFkZXI6ICR7bGluZX1gKVxuXG4gICAgICAgICAgICAgIGNvbnN0IGhlYWRlciA9IG5ldyBIZWFkZXIoaGVhZGVyTWF0Y2hbMV0sIGhlYWRlck1hdGNoWzJdKVxuXG4gICAgICAgICAgICAgIHRoaXMuaGVhZGVycy5wdXNoKGhlYWRlcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHN0YXRlOiAke3RoaXMuc3RhdGV9YClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb21wbGV0ZVJlc3BvbnNlKCkge1xuICAgIHRoaXMuc3RhdGUgPSBcImRvbmVcIlxuICAgIHRoaXMub25Db21wbGV0ZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb250ZW50IGxlbmd0aCBudW1iZXIuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGNvbnRlbnQgbGVuZ3RoIG51bWJlci5cbiAgICovXG4gIF9jb250ZW50TGVuZ3RoTnVtYmVyKCkge1xuICAgIGNvbnN0IGhlYWRlciA9IHRoaXMuaGVhZGVycy5maW5kKChjdXJyZW50SGVhZGVyKSA9PiBjdXJyZW50SGVhZGVyLmdldE5hbWUoKS50b0xvd2VyQ2FzZSgpID09IFwiY29udGVudC1sZW5ndGhcIilcblxuICAgIGlmICghaGVhZGVyKSByZXR1cm4gMFxuXG4gICAgY29uc3QgY29udGVudExlbmd0aFZhbHVlID0gaGVhZGVyLmdldFZhbHVlKClcblxuICAgIGlmICh0eXBlb2YgY29udGVudExlbmd0aFZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gY29udGVudExlbmd0aFZhbHVlXG4gICAgaWYgKHR5cGVvZiBjb250ZW50TGVuZ3RoVmFsdWUgPT09IFwic3RyaW5nXCIpIHJldHVybiBwYXJzZUludChjb250ZW50TGVuZ3RoVmFsdWUpXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRlbnQtTGVuZ3RoIGlzIG5vdCBhIG51bWJlcjogJHtjb250ZW50TGVuZ3RoVmFsdWV9YClcbiAgfVxufVxuIl19
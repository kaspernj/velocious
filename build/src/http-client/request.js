// @ts-check
import Header from "./header.js";
export default class Request {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} [args.body] - Request body.
     * @param {string} args.method - HTTP method.
     * @param {Header[]} args.headers - Header list.
     * @param {string} args.path - Path.
     * @param {string} args.version - Version.
     */
    constructor({ body, method = "GET", headers = [], path, version = "1.1" }) {
        this.body = body;
        this.headers = headers;
        this.method = method;
        this.path = path;
        this.version = version;
    }
    asString() {
        let requestString = "";
        this.stream((chunk) => {
            requestString += chunk;
        });
        return requestString;
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
    /**
     * Runs add header.
     * @param {string} name - Name.
     * @param {string | number} value - Value to use.
     * @returns {void} - No return value.
     */
    addHeader(name, value) {
        this.headers.push(new Header(name, value));
    }
    /**
     * Runs prepare.
     * @returns {void} - No return value.
     */
    prepare() {
        if (this.body) {
            // Buffer.byteLength computes the UTF-8 length of strings without copying and
            // returns .byteLength unchanged for Buffer/Uint8Array bodies.
            this.addHeader("Content-Length", Buffer.byteLength(this.body, "utf8"));
        }
    }
    /**
     * Runs stream.
     * @param {(arg: string) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    stream(callback) {
        this.prepare();
        const requestString = `${this.method} ${this.path} HTTP/${this.version}\r\n`;
        callback(requestString);
        for (const header of this.headers) {
            callback(`${header.toString()}\r\n`);
        }
        callback(`\r\n`);
        if (this.body) {
            callback(this.body);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9odHRwLWNsaWVudC9yZXF1ZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFFaEMsTUFBTSxDQUFDLE9BQU8sT0FBTyxPQUFPO0lBQzFCOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxFQUFDLElBQUksRUFBRSxNQUFNLEdBQUcsS0FBSyxFQUFFLE9BQU8sR0FBRyxFQUFFLEVBQUUsSUFBSSxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUM7UUFDckUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7UUFDdEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7SUFDeEIsQ0FBQztJQUVELFFBQVE7UUFDTixJQUFJLGFBQWEsR0FBRyxFQUFFLENBQUE7UUFFdEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQ3BCLGFBQWEsSUFBSSxLQUFLLENBQUE7UUFDeEIsQ0FBQyxDQUFDLENBQUE7UUFFRixPQUFPLGFBQWEsQ0FBQTtJQUN0QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFNBQVMsQ0FBQyxJQUFJO1FBQ1osTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFBO1FBRTdDLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xDLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFBO1lBRS9ELElBQUksV0FBVyxJQUFJLGlCQUFpQixFQUFFLENBQUM7Z0JBQ3JDLE9BQU8sTUFBTSxDQUFBO1lBQ2YsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLFVBQVUsSUFBSSxZQUFZLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUs7UUFDbkIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILE9BQU87UUFDTCxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNkLDZFQUE2RTtZQUM3RSw4REFBOEQ7WUFDOUQsSUFBSSxDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQTtRQUN4RSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsUUFBUTtRQUNiLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUVkLE1BQU0sYUFBYSxHQUFHLEdBQUcsSUFBSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsSUFBSSxTQUFTLElBQUksQ0FBQyxPQUFPLE1BQU0sQ0FBQTtRQUU1RSxRQUFRLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFdkIsS0FBSyxNQUFNLE1BQU0sSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDbEMsUUFBUSxDQUFDLEdBQUcsTUFBTSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUN0QyxDQUFDO1FBRUQsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRWhCLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ2QsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNyQixDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBIZWFkZXIgZnJvbSBcIi4vaGVhZGVyLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUmVxdWVzdCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYm9keV0gLSBSZXF1ZXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZCAtIEhUVFAgbWV0aG9kLlxuICAgKiBAcGFyYW0ge0hlYWRlcltdfSBhcmdzLmhlYWRlcnMgLSBIZWFkZXIgbGlzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIFBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnZlcnNpb24gLSBWZXJzaW9uLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2JvZHksIG1ldGhvZCA9IFwiR0VUXCIsIGhlYWRlcnMgPSBbXSwgcGF0aCwgdmVyc2lvbiA9IFwiMS4xXCJ9KSB7XG4gICAgdGhpcy5ib2R5ID0gYm9keVxuICAgIHRoaXMuaGVhZGVycyA9IGhlYWRlcnNcbiAgICB0aGlzLm1ldGhvZCA9IG1ldGhvZFxuICAgIHRoaXMucGF0aCA9IHBhdGhcbiAgICB0aGlzLnZlcnNpb24gPSB2ZXJzaW9uXG4gIH1cblxuICBhc1N0cmluZygpIHtcbiAgICBsZXQgcmVxdWVzdFN0cmluZyA9IFwiXCJcblxuICAgIHRoaXMuc3RyZWFtKChjaHVuaykgPT4ge1xuICAgICAgcmVxdWVzdFN0cmluZyArPSBjaHVua1xuICAgIH0pXG5cbiAgICByZXR1cm4gcmVxdWVzdFN0cmluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGhlYWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7SGVhZGVyfSAtIFRoZSBoZWFkZXIuXG4gICAqL1xuICBnZXRIZWFkZXIobmFtZSkge1xuICAgIGNvbnN0IGNvbXBhcmVOYW1lID0gbmFtZS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuXG4gICAgZm9yIChjb25zdCBoZWFkZXIgb2YgdGhpcy5oZWFkZXJzKSB7XG4gICAgICBjb25zdCBoZWFkZXJDb21wYXJlTmFtZSA9IGhlYWRlci5nZXROYW1lKCkudG9Mb3dlckNhc2UoKS50cmltKClcblxuICAgICAgaWYgKGNvbXBhcmVOYW1lID09IGhlYWRlckNvbXBhcmVOYW1lKSB7XG4gICAgICAgIHJldHVybiBoZWFkZXJcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEhlYWRlciAke25hbWV9IG5vdCBmb3VuZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWRkSGVhZGVyKG5hbWUsIHZhbHVlKSB7XG4gICAgdGhpcy5oZWFkZXJzLnB1c2gobmV3IEhlYWRlcihuYW1lLCB2YWx1ZSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwcmVwYXJlKCkge1xuICAgIGlmICh0aGlzLmJvZHkpIHtcbiAgICAgIC8vIEJ1ZmZlci5ieXRlTGVuZ3RoIGNvbXB1dGVzIHRoZSBVVEYtOCBsZW5ndGggb2Ygc3RyaW5ncyB3aXRob3V0IGNvcHlpbmcgYW5kXG4gICAgICAvLyByZXR1cm5zIC5ieXRlTGVuZ3RoIHVuY2hhbmdlZCBmb3IgQnVmZmVyL1VpbnQ4QXJyYXkgYm9kaWVzLlxuICAgICAgdGhpcy5hZGRIZWFkZXIoXCJDb250ZW50LUxlbmd0aFwiLCBCdWZmZXIuYnl0ZUxlbmd0aCh0aGlzLmJvZHksIFwidXRmOFwiKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJlYW0uXG4gICAqIEBwYXJhbSB7KGFyZzogc3RyaW5nKSA9PiB2b2lkfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdHJlYW0oY2FsbGJhY2spIHtcbiAgICB0aGlzLnByZXBhcmUoKVxuXG4gICAgY29uc3QgcmVxdWVzdFN0cmluZyA9IGAke3RoaXMubWV0aG9kfSAke3RoaXMucGF0aH0gSFRUUC8ke3RoaXMudmVyc2lvbn1cXHJcXG5gXG5cbiAgICBjYWxsYmFjayhyZXF1ZXN0U3RyaW5nKVxuXG4gICAgZm9yIChjb25zdCBoZWFkZXIgb2YgdGhpcy5oZWFkZXJzKSB7XG4gICAgICBjYWxsYmFjayhgJHtoZWFkZXIudG9TdHJpbmcoKX1cXHJcXG5gKVxuICAgIH1cblxuICAgIGNhbGxiYWNrKGBcXHJcXG5gKVxuXG4gICAgaWYgKHRoaXMuYm9keSkge1xuICAgICAgY2FsbGJhY2sodGhpcy5ib2R5KVxuICAgIH1cbiAgfVxufVxuIl19
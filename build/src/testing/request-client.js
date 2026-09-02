// @ts-check
class Response {
    /**
     * Runs constructor.
     * @param {globalThis.Response} fetchResponse - Fetch response.
     */
    constructor(fetchResponse) {
        this.fetchResponse = fetchResponse;
    }
    /**
     * Runs parse.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async parse() {
        this._body = await this.fetchResponse.text();
        if (this.statusCode() != 200)
            throw new Error(`Request failed with code ${this.statusCode()} and body: ${this.body()}`);
    }
    /**
     * Runs body.
     * @returns {string} - The body.
     */
    body() {
        if (!this._body)
            throw new Error("Response body not parsed yet. Call parse() first.");
        return this._body;
    }
    /**
     * Runs content type.
     * @returns {string | null} - The content type.
     */
    contentType() {
        return this.fetchResponse.headers.get("content-type");
    }
    /**
     * Runs status code.
     * @returns {number} - The status code.
     */
    statusCode() { return this.fetchResponse.status; }
}
export default class RequestClient {
    host = "localhost";
    port = 31006;
    /**
     * Runs get.
     * @param {string} path - Path.
     * @returns {Promise<Response>} - Resolves with the get.
     */
    async get(path) {
        const fetchResponse = await fetch(`http://${this.host}:${this.port}${path}`);
        const response = new Response(fetchResponse);
        await response.parse();
        return response;
    }
    /**
     * Runs post.
     * @param {string} path - Path.
     * @param {object} data - Data payload.
     * @returns {Promise<Response>} - Resolves with the post.
     */
    async post(path, data) {
        const fetchResponse = await fetch(`http://${this.host}:${this.port}${path}`, {
            body: JSON.stringify(data),
            headers: {
                "Content-Type": "application/json"
            },
            method: "POST",
            signal: AbortSignal.timeout(5000)
        });
        const response = new Response(fetchResponse);
        await response.parse();
        return response;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy9yZXF1ZXN0LWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosTUFBTSxRQUFRO0lBQ1o7OztPQUdHO0lBQ0gsWUFBWSxhQUFhO1FBQ3ZCLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSztRQUNULElBQUksQ0FBQyxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxDQUFBO1FBRTVDLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxJQUFJLEdBQUc7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixJQUFJLENBQUMsVUFBVSxFQUFFLGNBQWMsSUFBSSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUN6SCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsSUFBSTtRQUNGLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbURBQW1ELENBQUMsQ0FBQTtRQUVyRixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFdBQVc7UUFDVCxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUN2RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVSxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUEsQ0FBQyxDQUFDO0NBQ2xEO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDLElBQUksR0FBRyxXQUFXLENBQUE7SUFDbEIsSUFBSSxHQUFHLEtBQUssQ0FBQTtJQUVaOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsR0FBRyxDQUFDLElBQUk7UUFDWixNQUFNLGFBQWEsR0FBRyxNQUFNLEtBQUssQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBQzVFLE1BQU0sUUFBUSxHQUFHLElBQUksUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRTVDLE1BQU0sUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRXRCLE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUk7UUFDbkIsTUFBTSxhQUFhLEdBQUcsTUFBTSxLQUFLLENBQy9CLFVBQVUsSUFBSSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksRUFBRSxFQUN6QztZQUNFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQztZQUMxQixPQUFPLEVBQUU7Z0JBQ1AsY0FBYyxFQUFFLGtCQUFrQjthQUNuQztZQUNELE1BQU0sRUFBRSxNQUFNO1lBQ2QsTUFBTSxFQUFFLFdBQVcsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDO1NBQ2xDLENBQ0YsQ0FBQTtRQUVELE1BQU0sUUFBUSxHQUFHLElBQUksUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRTVDLE1BQU0sUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRXRCLE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5jbGFzcyBSZXNwb25zZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2dsb2JhbFRoaXMuUmVzcG9uc2V9IGZldGNoUmVzcG9uc2UgLSBGZXRjaCByZXNwb25zZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGZldGNoUmVzcG9uc2UpIHtcbiAgICB0aGlzLmZldGNoUmVzcG9uc2UgPSBmZXRjaFJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHBhcnNlKCkge1xuICAgIHRoaXMuX2JvZHkgPSBhd2FpdCB0aGlzLmZldGNoUmVzcG9uc2UudGV4dCgpXG5cbiAgICBpZiAodGhpcy5zdGF0dXNDb2RlKCkgIT0gMjAwKSB0aHJvdyBuZXcgRXJyb3IoYFJlcXVlc3QgZmFpbGVkIHdpdGggY29kZSAke3RoaXMuc3RhdHVzQ29kZSgpfSBhbmQgYm9keTogJHt0aGlzLmJvZHkoKX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYm9keS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgYm9keS5cbiAgICovXG4gIGJvZHkoKSB7XG4gICAgaWYgKCF0aGlzLl9ib2R5KSB0aHJvdyBuZXcgRXJyb3IoXCJSZXNwb25zZSBib2R5IG5vdCBwYXJzZWQgeWV0LiBDYWxsIHBhcnNlKCkgZmlyc3QuXCIpXG5cbiAgICByZXR1cm4gdGhpcy5fYm9keVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29udGVudCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBUaGUgY29udGVudCB0eXBlLlxuICAgKi9cbiAgY29udGVudFR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuZmV0Y2hSZXNwb25zZS5oZWFkZXJzLmdldChcImNvbnRlbnQtdHlwZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhdHVzIGNvZGUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgc3RhdHVzQ29kZSgpIHsgcmV0dXJuIHRoaXMuZmV0Y2hSZXNwb25zZS5zdGF0dXMgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBSZXF1ZXN0Q2xpZW50IHtcbiAgaG9zdCA9IFwibG9jYWxob3N0XCJcbiAgcG9ydCA9IDMxMDA2XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBnZXQuXG4gICAqL1xuICBhc3luYyBnZXQocGF0aCkge1xuICAgIGNvbnN0IGZldGNoUmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgaHR0cDovLyR7dGhpcy5ob3N0fToke3RoaXMucG9ydH0ke3BhdGh9YClcbiAgICBjb25zdCByZXNwb25zZSA9IG5ldyBSZXNwb25zZShmZXRjaFJlc3BvbnNlKVxuXG4gICAgYXdhaXQgcmVzcG9uc2UucGFyc2UoKVxuXG4gICAgcmV0dXJuIHJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwb3N0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcG9zdC5cbiAgICovXG4gIGFzeW5jIHBvc3QocGF0aCwgZGF0YSkge1xuICAgIGNvbnN0IGZldGNoUmVzcG9uc2UgPSBhd2FpdCBmZXRjaChcbiAgICAgIGBodHRwOi8vJHt0aGlzLmhvc3R9OiR7dGhpcy5wb3J0fSR7cGF0aH1gLFxuICAgICAge1xuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiXG4gICAgICAgIH0sXG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgIHNpZ25hbDogQWJvcnRTaWduYWwudGltZW91dCg1MDAwKVxuICAgICAgfVxuICAgIClcblxuICAgIGNvbnN0IHJlc3BvbnNlID0gbmV3IFJlc3BvbnNlKGZldGNoUmVzcG9uc2UpXG5cbiAgICBhd2FpdCByZXNwb25zZS5wYXJzZSgpXG5cbiAgICByZXR1cm4gcmVzcG9uc2VcbiAgfVxufVxuIl19
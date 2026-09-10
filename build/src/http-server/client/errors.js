// @ts-check
export class HttpRequestBodyTooLargeError extends Error {
    /**
     * Creates a request-body limit error.
     * @param {object} args - Size details.
     * @param {number} args.actualBytes - Declared or accumulated body size.
     * @param {number} args.maxBytes - Configured maximum body size.
     */
    constructor({ actualBytes, maxBytes }) {
        super(`HTTP request body exceeds ${maxBytes} bytes (received or declared ${actualBytes})`);
        this.name = "HttpRequestBodyTooLargeError";
    }
}
export class HttpResponseBodyTooLargeError extends Error {
    /**
     * Creates a buffered-response limit error.
     * @param {object} args - Size details.
     * @param {number} args.actualBytes - Buffered response body size.
     * @param {number} args.maxBytes - Configured maximum body size.
     */
    constructor({ actualBytes, maxBytes }) {
        super(`Buffered HTTP response body exceeds ${maxBytes} bytes (received ${actualBytes})`);
        this.name = "HttpResponseBodyTooLargeError";
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3JzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2h0dHAtc2VydmVyL2NsaWVudC9lcnJvcnMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE1BQU0sT0FBTyw0QkFBNkIsU0FBUSxLQUFLO0lBQ3JEOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUM7UUFDakMsS0FBSyxDQUFDLDZCQUE2QixRQUFRLGdDQUFnQyxXQUFXLEdBQUcsQ0FBQyxDQUFBO1FBQzFGLElBQUksQ0FBQyxJQUFJLEdBQUcsOEJBQThCLENBQUE7SUFDNUMsQ0FBQztDQUNGO0FBRUQsTUFBTSxPQUFPLDZCQUE4QixTQUFRLEtBQUs7SUFDdEQ7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsV0FBVyxFQUFFLFFBQVEsRUFBQztRQUNqQyxLQUFLLENBQUMsdUNBQXVDLFFBQVEsb0JBQW9CLFdBQVcsR0FBRyxDQUFDLENBQUE7UUFDeEYsSUFBSSxDQUFDLElBQUksR0FBRywrQkFBK0IsQ0FBQTtJQUM3QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGNsYXNzIEh0dHBSZXF1ZXN0Qm9keVRvb0xhcmdlRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcmVxdWVzdC1ib2R5IGxpbWl0IGVycm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNpemUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYWN0dWFsQnl0ZXMgLSBEZWNsYXJlZCBvciBhY2N1bXVsYXRlZCBib2R5IHNpemUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm1heEJ5dGVzIC0gQ29uZmlndXJlZCBtYXhpbXVtIGJvZHkgc2l6ZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthY3R1YWxCeXRlcywgbWF4Qnl0ZXN9KSB7XG4gICAgc3VwZXIoYEhUVFAgcmVxdWVzdCBib2R5IGV4Y2VlZHMgJHttYXhCeXRlc30gYnl0ZXMgKHJlY2VpdmVkIG9yIGRlY2xhcmVkICR7YWN0dWFsQnl0ZXN9KWApXG4gICAgdGhpcy5uYW1lID0gXCJIdHRwUmVxdWVzdEJvZHlUb29MYXJnZUVycm9yXCJcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgSHR0cFJlc3BvbnNlQm9keVRvb0xhcmdlRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgYnVmZmVyZWQtcmVzcG9uc2UgbGltaXQgZXJyb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2l6ZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5hY3R1YWxCeXRlcyAtIEJ1ZmZlcmVkIHJlc3BvbnNlIGJvZHkgc2l6ZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4Qnl0ZXMgLSBDb25maWd1cmVkIG1heGltdW0gYm9keSBzaXplLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FjdHVhbEJ5dGVzLCBtYXhCeXRlc30pIHtcbiAgICBzdXBlcihgQnVmZmVyZWQgSFRUUCByZXNwb25zZSBib2R5IGV4Y2VlZHMgJHttYXhCeXRlc30gYnl0ZXMgKHJlY2VpdmVkICR7YWN0dWFsQnl0ZXN9KWApXG4gICAgdGhpcy5uYW1lID0gXCJIdHRwUmVzcG9uc2VCb2R5VG9vTGFyZ2VFcnJvclwiXG4gIH1cbn1cbiJdfQ==
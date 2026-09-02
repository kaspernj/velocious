// @ts-check
import net from "net";
import Request from "./request.js";
import Response from "./response.js";
import Logger from "../logger.js";
export default class HttpClient {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} [args.debug] - Whether debug.
     * @param {Array<import("./header.js").default>} [args.headers] - Header list.
     * @param {string} [args.version] - Version.
     */
    constructor({ debug = false, headers, version = "1.1" }) {
        this.headers = headers || [];
        this.logger = new Logger(this, { debug });
        this.version = version;
    }
    connect() {
        return new Promise((resolve, reject) => {
            this.connectionReject = reject;
            this.connection = net.createConnection(3006, "127.0.0.1", () => {
                this.connectionReject = null;
                resolve(null);
            });
            this.connection.on("data", this.onConnectionData);
            this.connection.on("end", this.onConnectionEnd);
            this.connection.on("error", this.onConnectionError);
        });
    }
    /**
     * Runs get.
     * @param {string} path - Path.
     * @param {object} [options] - Options object.
     * @param {Array<import("./header.js").default>} [options.headers] - Header list.
     * @returns {Promise<{request: import("./request.js").default, response: import("./response.js").default}>} - Resolves with the request/response pair.
     */
    get(path, { headers } = {}) {
        if (!this.connection)
            throw new Error("Not connected yet");
        return new Promise((resolve, reject) => {
            this.currentRequestResolve = resolve;
            this.currentRequestReject = reject;
            const newHeaders = [];
            if (headers) {
                for (const header of headers) {
                    newHeaders.push(header);
                }
            }
            for (const header of this.headers) {
                const existingNewHeader = newHeaders.find((newHeader) => {
                    return newHeader.getName().toLowerCase().trim() === header.getName().toLowerCase().trim();
                });
                if (!existingNewHeader) {
                    this.logger.debugLowLevel(() => `Pushing header from connection: ${header.toString()}`);
                    newHeaders.push(header);
                }
            }
            this.currentResponse = new Response({ method: "GET", onComplete: this.onResponseComplete });
            this.currentRequest = new Request({ headers: newHeaders, method: "GET", path, version: "1.0" });
            this.currentRequest.stream((chunk) => {
                this.logger.debugLowLevel(() => `Writing: ${chunk}`);
                if (!this.connection) {
                    throw new Error("No connection to write to");
                }
                this.connection.write(chunk, "utf8", (error) => {
                    if (error) {
                        if (!this.currentRequestReject)
                            throw new Error("No current request reject function");
                        this.currentRequestReject(error);
                    }
                });
            });
        });
    }
    /**
     * On connection data.
     * @param {Buffer} data - Data payload.
     */
    onConnectionData = (data) => {
        if (!this.currentResponse)
            throw new Error("No current response to feed data to");
        this.currentResponse.feed(data);
    };
    onConnectionEnd = () => {
        this.connection = null;
    };
    /**
     * On connection error.
     * @param {Error} error - Error instance.
     */
    onConnectionError = (error) => {
        if (this.connectionReject) {
            this.connectionReject(error);
        }
        else {
            this.logger.error("HttpClient onConnectionError", error);
        }
    };
    isConnected() {
        if (this.connection) {
            return true;
        }
        return false;
    }
    onResponseComplete = () => {
        if (!this.currentRequestResolve)
            throw new Error("No current request resolve function");
        if (!this.currentRequest)
            throw new Error("No current request");
        if (!this.currentResponse)
            throw new Error("No current response");
        this.currentRequestResolve({
            request: this.currentRequest,
            response: this.currentResponse
        });
        this.currentRequestResolve = null;
        this.currentRequestReject = null;
        this.currentRequest = null;
        this.currentResponse = null;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1jbGllbnQvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxRQUFRLE1BQU0sZUFBZSxDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUVqQyxNQUFNLENBQUMsT0FBTyxPQUFPLFVBQVU7SUFDN0I7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLEtBQUssR0FBRyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUM7UUFDbkQsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLElBQUksRUFBRSxDQUFBO1FBQzVCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxFQUFFLEVBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUN2QyxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtJQUN4QixDQUFDO0lBRUQsT0FBTztRQUNMLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDckMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLE1BQU0sQ0FBQTtZQUM5QixJQUFJLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFLEdBQUcsRUFBRTtnQkFDN0QsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksQ0FBQTtnQkFDNUIsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQ2YsQ0FBQyxDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7WUFDakQsSUFBSSxDQUFDLFVBQVUsQ0FB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RUFBRSxJQUFJLENBQUMsY0FBYztZQUM1QixRQUFRLEVBQUUsSUFBSSxDQUFDLGVBQWU7U0FDL0IsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLHFCQUFxQixHQUFHLElBQUksQ0FBQTtRQUNqQyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsSUFBSSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFBO1FBQzFCLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFBO0lBQzdCLENBQUMsQ0FBQTtDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiXG5pbXBvcnQgUmVxdWVzdCBmcm9tIFwiLi9yZXF1ZXN0LmpzXCJcbmltcG9ydCBSZXNwb25zZSBmcm9tIFwiLi9yZXNwb25zZS5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBIdHRwQ2xpZW50IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZGVidWddIC0gV2hldGhlciBkZWJ1Zy5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2hlYWRlci5qc1wiKS5kZWZhdWx0Pn0gW2FyZ3MuaGVhZGVyc10gLSBIZWFkZXIgbGlzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnZlcnNpb25dIC0gVmVyc2lvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtkZWJ1ZyA9IGZhbHNlLCBoZWFkZXJzLCB2ZXJzaW9uID0gXCIxLjFcIn0pIHtcbiAgICB0aGlzLmhlYWRlcnMgPSBoZWFkZXJzIHx8IFtdXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMsIHtkZWJ1Z30pXG4gICAgdGhpcy52ZXJzaW9uID0gdmVyc2lvblxuICB9XG5cbiAgY29ubmVjdCgpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5jb25uZWN0aW9uUmVqZWN0ID0gcmVqZWN0XG4gICAgICB0aGlzLmNvbm5lY3Rpb24gPSBuZXQuY3JlYXRlQ29ubmVjdGlvbigzMDA2LCBcIjEyNy4wLjAuMVwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvblJlamVjdCA9IG51bGxcbiAgICAgICAgcmVzb2x2ZShudWxsKVxuICAgICAgfSlcblxuICAgICAgdGhpcy5jb25uZWN0aW9uLm9uKFwiZGF0YVwiLCB0aGlzLm9uQ29ubmVjdGlvbkRhdGEpXG4gICAgICB0aGlzLmNvbm5lY3Rpb24ub24oXCJlbmRcIiwgdGhpcy5vbkNvbm5lY3Rpb25FbmQpXG4gICAgICB0aGlzLmNvbm5lY3Rpb24ub24oXCJlcnJvclwiLCB0aGlzLm9uQ29ubmVjdGlvbkVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gUGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vaGVhZGVyLmpzXCIpLmRlZmF1bHQ+fSBbb3B0aW9ucy5oZWFkZXJzXSAtIEhlYWRlciBsaXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7cmVxdWVzdDogaW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHR9Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZXF1ZXN0L3Jlc3BvbnNlIHBhaXIuXG4gICAqL1xuICBnZXQocGF0aCwge2hlYWRlcnN9ID0ge30pIHtcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm90IGNvbm5lY3RlZCB5ZXRcIilcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLmN1cnJlbnRSZXF1ZXN0UmVzb2x2ZSA9IHJlc29sdmVcbiAgICAgIHRoaXMuY3VycmVudFJlcXVlc3RSZWplY3QgPSByZWplY3RcblxuICAgICAgY29uc3QgbmV3SGVhZGVycyA9IFtdXG5cbiAgICAgIGlmIChoZWFkZXJzKSB7XG4gICAgICAgIGZvciAoY29uc3QgaGVhZGVyIG9mIGhlYWRlcnMpIHtcbiAgICAgICAgICBuZXdIZWFkZXJzLnB1c2goaGVhZGVyKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgaGVhZGVyIG9mIHRoaXMuaGVhZGVycykge1xuICAgICAgICBjb25zdCBleGlzdGluZ05ld0hlYWRlciA9IG5ld0hlYWRlcnMuZmluZCgobmV3SGVhZGVyKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIG5ld0hlYWRlci5nZXROYW1lKCkudG9Mb3dlckNhc2UoKS50cmltKCkgPT09IGhlYWRlci5nZXROYW1lKCkudG9Mb3dlckNhc2UoKS50cmltKClcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoIWV4aXN0aW5nTmV3SGVhZGVyKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBQdXNoaW5nIGhlYWRlciBmcm9tIGNvbm5lY3Rpb246ICR7aGVhZGVyLnRvU3RyaW5nKCl9YClcbiAgICAgICAgICBuZXdIZWFkZXJzLnB1c2goaGVhZGVyKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMuY3VycmVudFJlc3BvbnNlID0gbmV3IFJlc3BvbnNlKHttZXRob2Q6IFwiR0VUXCIsIG9uQ29tcGxldGU6IHRoaXMub25SZXNwb25zZUNvbXBsZXRlfSlcblxuICAgICAgdGhpcy5jdXJyZW50UmVxdWVzdCA9IG5ldyBSZXF1ZXN0KHtoZWFkZXJzOiBuZXdIZWFkZXJzLCBtZXRob2Q6IFwiR0VUXCIsIHBhdGgsIHZlcnNpb246IFwiMS4wXCJ9KVxuICAgICAgdGhpcy5jdXJyZW50UmVxdWVzdC5zdHJlYW0oKGNodW5rKSA9PiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gYFdyaXRpbmc6ICR7Y2h1bmt9YClcblxuICAgICAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbm5lY3Rpb24gdG8gd3JpdGUgdG9cIilcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY29ubmVjdGlvbi53cml0ZShjaHVuaywgXCJ1dGY4XCIsIChlcnJvcikgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgaWYgKCF0aGlzLmN1cnJlbnRSZXF1ZXN0UmVqZWN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlcXVlc3QgcmVqZWN0IGZ1bmN0aW9uXCIpXG5cbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJlcXVlc3RSZWplY3QoZXJyb3IpXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIGNvbm5lY3Rpb24gZGF0YS5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqL1xuICBvbkNvbm5lY3Rpb25EYXRhID0gKGRhdGEpID0+IHtcbiAgICBpZiAoIXRoaXMuY3VycmVudFJlc3BvbnNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlc3BvbnNlIHRvIGZlZWQgZGF0YSB0b1wiKVxuXG4gICAgdGhpcy5jdXJyZW50UmVzcG9uc2UuZmVlZChkYXRhKVxuICB9XG5cbiAgb25Db25uZWN0aW9uRW5kID0gKCkgPT4ge1xuICAgIHRoaXMuY29ubmVjdGlvbiA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBPbiBjb25uZWN0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKi9cbiAgb25Db25uZWN0aW9uRXJyb3IgPSAoZXJyb3IpID0+IHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uUmVqZWN0KSB7XG4gICAgICB0aGlzLmNvbm5lY3Rpb25SZWplY3QoZXJyb3IpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiSHR0cENsaWVudCBvbkNvbm5lY3Rpb25FcnJvclwiLCBlcnJvcilcbiAgICB9XG4gIH1cblxuICBpc0Nvbm5lY3RlZCgpIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgb25SZXNwb25zZUNvbXBsZXRlID0gKCkgPT4ge1xuICAgIGlmICghdGhpcy5jdXJyZW50UmVxdWVzdFJlc29sdmUpIHRocm93IG5ldyBFcnJvcihcIk5vIGN1cnJlbnQgcmVxdWVzdCByZXNvbHZlIGZ1bmN0aW9uXCIpXG4gICAgaWYgKCF0aGlzLmN1cnJlbnRSZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlcXVlc3RcIilcbiAgICBpZiAoIXRoaXMuY3VycmVudFJlc3BvbnNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlc3BvbnNlXCIpXG5cbiAgICB0aGlzLmN1cnJlbnRSZXF1ZXN0UmVzb2x2ZSh7XG4gICAgICByZXF1ZXN0OiB0aGlzLmN1cnJlbnRSZXF1ZXN0LFxuICAgICAgcmVzcG9uc2U6IHRoaXMuY3VycmVudFJlc3BvbnNlXG4gICAgfSlcblxuICAgIHRoaXMuY3VycmVudFJlcXVlc3RSZXNvbHZlID0gbnVsbFxuICAgIHRoaXMuY3VycmVudFJlcXVlc3RSZWplY3QgPSBudWxsXG4gICAgdGhpcy5jdXJyZW50UmVxdWVzdCA9IG51bGxcbiAgICB0aGlzLmN1cnJlbnRSZXNwb25zZSA9IG51bGxcbiAgfVxufVxuIl19
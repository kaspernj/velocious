// @ts-check
/**
 * LoggingOutputPayload type.
 * @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */
/** Logger array output. */
export default class LoggerArrayOutput {
    _limit = 2000;
    /**
     * Levels.
     * @type {import("../../configuration-types.js").LogLevel[]} */
    levels = ["debug", "info", "warn", "error"];
    /**
     * Logs.
     * @type {LoggingOutputPayload[]} */
    _logs = [];
    /**
     * Runs constructor.
     * @param {object} [args] - Options object.
     * @param {number} [args.limit] - Max number of log entries to keep.
     */
    constructor({ limit = 2000 } = {}) {
        const normalizedLimit = typeof limit === "number" && Number.isFinite(limit) ? limit : 2000;
        this._limit = normalizedLimit;
    }
    /**
     * Runs write.
     * @param {LoggingOutputPayload} payload - Log payload.
     */
    async write({ level, message, subject, timestamp }) {
        if (this._limit <= 0)
            return;
        this._logs.push({ level, message, subject, timestamp });
        if (this._logs.length > this._limit) {
            this._logs.splice(0, this._logs.length - this._limit);
        }
    }
    /**
     * Runs get logs.
     * @returns {LoggingOutputPayload[]} - Stored log entries.
     */
    getLogs() {
        return this._logs.slice();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXJyYXktb3V0cHV0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2xvZ2dlci9vdXRwdXRzL2FycmF5LW91dHB1dC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7O2lHQUVpRztBQUVqRywyQkFBMkI7QUFDM0IsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQkFBaUI7SUFDcEMsTUFBTSxHQUFHLElBQUksQ0FBQTtJQUNiOzttRUFFK0Q7SUFDL0QsTUFBTSxHQUFHLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFDM0M7O3dDQUVvQztJQUNwQyxLQUFLLEdBQUcsRUFBRSxDQUFBO0lBRVY7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxLQUFLLEdBQUcsSUFBSSxFQUFDLEdBQUcsRUFBRTtRQUM3QixNQUFNLGVBQWUsR0FBRyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFDMUYsSUFBSSxDQUFDLE1BQU0sR0FBRyxlQUFlLENBQUE7SUFDL0IsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUM7UUFDOUMsSUFBSSxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUM7WUFBRSxPQUFNO1FBRTVCLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtRQUVyRCxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNwQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3ZELENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTztRQUNMLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUMzQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBMb2dnaW5nT3V0cHV0UGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ091dHB1dFBheWxvYWR9IExvZ2dpbmdPdXRwdXRQYXlsb2FkICovXG5cbi8qKiBMb2dnZXIgYXJyYXkgb3V0cHV0LiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTG9nZ2VyQXJyYXlPdXRwdXQge1xuICBfbGltaXQgPSAyMDAwXG4gIC8qKlxuICAgKiBMZXZlbHMuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ0xldmVsW119ICovXG4gIGxldmVscyA9IFtcImRlYnVnXCIsIFwiaW5mb1wiLCBcIndhcm5cIiwgXCJlcnJvclwiXVxuICAvKipcbiAgICogTG9ncy5cbiAgICogQHR5cGUge0xvZ2dpbmdPdXRwdXRQYXlsb2FkW119ICovXG4gIF9sb2dzID0gW11cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubGltaXRdIC0gTWF4IG51bWJlciBvZiBsb2cgZW50cmllcyB0byBrZWVwLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2xpbWl0ID0gMjAwMH0gPSB7fSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRMaW1pdCA9IHR5cGVvZiBsaW1pdCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUobGltaXQpID8gbGltaXQgOiAyMDAwXG4gICAgdGhpcy5fbGltaXQgPSBub3JtYWxpemVkTGltaXRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdyaXRlLlxuICAgKiBAcGFyYW0ge0xvZ2dpbmdPdXRwdXRQYXlsb2FkfSBwYXlsb2FkIC0gTG9nIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyB3cml0ZSh7bGV2ZWwsIG1lc3NhZ2UsIHN1YmplY3QsIHRpbWVzdGFtcH0pIHtcbiAgICBpZiAodGhpcy5fbGltaXQgPD0gMCkgcmV0dXJuXG5cbiAgICB0aGlzLl9sb2dzLnB1c2goe2xldmVsLCBtZXNzYWdlLCBzdWJqZWN0LCB0aW1lc3RhbXB9KVxuXG4gICAgaWYgKHRoaXMuX2xvZ3MubGVuZ3RoID4gdGhpcy5fbGltaXQpIHtcbiAgICAgIHRoaXMuX2xvZ3Muc3BsaWNlKDAsIHRoaXMuX2xvZ3MubGVuZ3RoIC0gdGhpcy5fbGltaXQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvZ3MuXG4gICAqIEByZXR1cm5zIHtMb2dnaW5nT3V0cHV0UGF5bG9hZFtdfSAtIFN0b3JlZCBsb2cgZW50cmllcy5cbiAgICovXG4gIGdldExvZ3MoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2xvZ3Muc2xpY2UoKVxuICB9XG59XG4iXX0=
// @ts-check
import BaseLogger from "./base-logger.js";
import LoggerConsoleOutput from "./outputs/console-output.js";
/** Console logger configuration wrapper. */
export default class ConsoleLogger extends BaseLogger {
    /**
     * Runs constructor.
     * @param {object} [args] - Options object.
     * @param {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [args.levels] - Levels to emit.
     */
    constructor({ levels } = {}) {
        super();
        this.levels = levels;
    }
    /**
     * Runs to output config.
     * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
     */
    toOutputConfig() {
        return {
            output: new LoggerConsoleOutput(),
            levels: this.levels
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc29sZS1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2VyL2NvbnNvbGUtbG9nZ2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLG1CQUFtQixNQUFNLDZCQUE2QixDQUFBO0FBRTdELDRDQUE0QztBQUM1QyxNQUFNLENBQUMsT0FBTyxPQUFPLGFBQWMsU0FBUSxVQUFVO0lBQ25EOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFDLEdBQUcsRUFBRTtRQUN2QixLQUFLLEVBQUUsQ0FBQTtRQUNQLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxjQUFjO1FBQ1osT0FBTztZQUNMLE1BQU0sRUFBRSxJQUFJLG1CQUFtQixFQUFFO1lBQ2pDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtTQUNwQixDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlTG9nZ2VyIGZyb20gXCIuL2Jhc2UtbG9nZ2VyLmpzXCJcbmltcG9ydCBMb2dnZXJDb25zb2xlT3V0cHV0IGZyb20gXCIuL291dHB1dHMvY29uc29sZS1vdXRwdXQuanNcIlxuXG4vKiogQ29uc29sZSBsb2dnZXIgY29uZmlndXJhdGlvbiB3cmFwcGVyLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQ29uc29sZUxvZ2dlciBleHRlbmRzIEJhc2VMb2dnZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge0FycmF5PFwiZGVidWctbG93LWxldmVsXCIgfCBcImRlYnVnXCIgfCBcImluZm9cIiB8IFwid2FyblwiIHwgXCJlcnJvclwiPn0gW2FyZ3MubGV2ZWxzXSAtIExldmVscyB0byBlbWl0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2xldmVsc30gPSB7fSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmxldmVscyA9IGxldmVsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gb3V0cHV0IGNvbmZpZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ091dHB1dENvbmZpZ30gLSBPdXRwdXQgY29uZmlnLlxuICAgKi9cbiAgdG9PdXRwdXRDb25maWcoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG91dHB1dDogbmV3IExvZ2dlckNvbnNvbGVPdXRwdXQoKSxcbiAgICAgIGxldmVsczogdGhpcy5sZXZlbHNcbiAgICB9XG4gIH1cbn1cbiJdfQ==
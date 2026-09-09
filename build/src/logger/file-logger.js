// @ts-check
import BaseLogger from "./base-logger.js";
import LoggerFileOutput from "./outputs/file-output.js";
/** File logger configuration wrapper. */
export default class FileLogger extends BaseLogger {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.path - File path to write to.
     * @param {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [args.levels] - Levels to emit.
     */
    constructor({ path, levels }) {
        super();
        this.path = path;
        this.levels = levels;
    }
    /**
     * Runs to output config.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default | undefined} [args.configuration] - Configuration instance.
     * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
     */
    toOutputConfig({ configuration } = {}) {
        return {
            output: new LoggerFileOutput({
                configuration,
                getConfiguration: () => configuration,
                filePath: this.path
            }),
            levels: this.levels
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmlsZS1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2VyL2ZpbGUtbG9nZ2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLGdCQUFnQixNQUFNLDBCQUEwQixDQUFBO0FBRXZELHlDQUF5QztBQUN6QyxNQUFNLENBQUMsT0FBTyxPQUFPLFVBQVcsU0FBUSxVQUFVO0lBQ2hEOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLElBQUksRUFBRSxNQUFNLEVBQUM7UUFDeEIsS0FBSyxFQUFFLENBQUE7UUFDUCxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUNoQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtJQUN0QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxjQUFjLENBQUMsRUFBQyxhQUFhLEVBQUMsR0FBRyxFQUFFO1FBQ2pDLE9BQU87WUFDTCxNQUFNLEVBQUUsSUFBSSxnQkFBZ0IsQ0FBQztnQkFDM0IsYUFBYTtnQkFDYixnQkFBZ0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxhQUFhO2dCQUNyQyxRQUFRLEVBQUUsSUFBSSxDQUFDLElBQUk7YUFDcEIsQ0FBQztZQUNGLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtTQUNwQixDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlTG9nZ2VyIGZyb20gXCIuL2Jhc2UtbG9nZ2VyLmpzXCJcbmltcG9ydCBMb2dnZXJGaWxlT3V0cHV0IGZyb20gXCIuL291dHB1dHMvZmlsZS1vdXRwdXQuanNcIlxuXG4vKiogRmlsZSBsb2dnZXIgY29uZmlndXJhdGlvbiB3cmFwcGVyLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRmlsZUxvZ2dlciBleHRlbmRzIEJhc2VMb2dnZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIEZpbGUgcGF0aCB0byB3cml0ZSB0by5cbiAgICogQHBhcmFtIHtBcnJheTxcImRlYnVnLWxvdy1sZXZlbFwiIHwgXCJkZWJ1Z1wiIHwgXCJpbmZvXCIgfCBcIndhcm5cIiB8IFwiZXJyb3JcIj59IFthcmdzLmxldmVsc10gLSBMZXZlbHMgdG8gZW1pdC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtwYXRoLCBsZXZlbHN9KSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMucGF0aCA9IHBhdGhcbiAgICB0aGlzLmxldmVscyA9IGxldmVsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gb3V0cHV0IGNvbmZpZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ091dHB1dENvbmZpZ30gLSBPdXRwdXQgY29uZmlnLlxuICAgKi9cbiAgdG9PdXRwdXRDb25maWcoe2NvbmZpZ3VyYXRpb259ID0ge30pIHtcbiAgICByZXR1cm4ge1xuICAgICAgb3V0cHV0OiBuZXcgTG9nZ2VyRmlsZU91dHB1dCh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGdldENvbmZpZ3VyYXRpb246ICgpID0+IGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGZpbGVQYXRoOiB0aGlzLnBhdGhcbiAgICAgIH0pLFxuICAgICAgbGV2ZWxzOiB0aGlzLmxldmVsc1xuICAgIH1cbiAgfVxufVxuIl19
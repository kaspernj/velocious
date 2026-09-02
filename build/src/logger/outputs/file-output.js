// @ts-check
/**
 * LoggingOutputPayload type.
 * @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */
/** Logger file output. */
export default class LoggerFileOutput {
    /**
     * Configuration.
     * @type {import("../../configuration.js").default | undefined} */
    _configuration = undefined;
    /**
     * File path.
     * @type {string | undefined} */
    _filePath = undefined;
    /**
     * Get configuration.
     * @type {(() => import("../../configuration.js").default | undefined) | undefined} */
    _getConfiguration = undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} [args.configuration] - Configuration instance.
     * @param {() => import("../../configuration.js").default | undefined} [args.getConfiguration] - Configuration resolver.
     * @param {string} args.filePath - File path.
     */
    constructor({ configuration, getConfiguration, filePath }) {
        this._configuration = configuration;
        this._getConfiguration = getConfiguration;
        this._filePath = filePath;
    }
    /**
     * Runs write.
     * @param {LoggingOutputPayload} payload - Log payload.
     */
    async write({ message }) {
        if (!this._filePath)
            return;
        const configuration = this._configuration || this._getConfiguration?.();
        if (!configuration || typeof configuration.getEnvironmentHandler !== "function")
            return;
        const environmentHandler = configuration.getEnvironmentHandler();
        if (!environmentHandler || typeof environmentHandler.writeLogToFile !== "function")
            return;
        await environmentHandler.writeLogToFile({
            filePath: this._filePath,
            message
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmlsZS1vdXRwdXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvbG9nZ2VyL291dHB1dHMvZmlsZS1vdXRwdXQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOztpR0FFaUc7QUFFakcsMEJBQTBCO0FBQzFCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0JBQWdCO0lBQ25DOztzRUFFa0U7SUFDbEUsY0FBYyxHQUFHLFNBQVMsQ0FBQTtJQUMxQjs7b0NBRWdDO0lBQ2hDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDckI7OzBGQUVzRjtJQUN0RixpQkFBaUIsR0FBRyxTQUFTLENBQUE7SUFFN0I7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxnQkFBZ0IsRUFBRSxRQUFRLEVBQUM7UUFDckQsSUFBSSxDQUFDLGNBQWMsR0FBRyxhQUFhLENBQUE7UUFDbkMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLGdCQUFnQixDQUFBO1FBQ3pDLElBQUksQ0FBQyxTQUFTLEdBQUcsUUFBUSxDQUFBO0lBQzNCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUMsT0FBTyxFQUFDO1FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUztZQUFFLE9BQU07UUFFM0IsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsRUFBRSxDQUFBO1FBRXZFLElBQUksQ0FBQyxhQUFhLElBQUksT0FBTyxhQUFhLENBQUMscUJBQXFCLEtBQUssVUFBVTtZQUFFLE9BQU07UUFFdkYsTUFBTSxrQkFBa0IsR0FBRyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUVoRSxJQUFJLENBQUMsa0JBQWtCLElBQUksT0FBTyxrQkFBa0IsQ0FBQyxjQUFjLEtBQUssVUFBVTtZQUFFLE9BQU07UUFFMUYsTUFBTSxrQkFBa0IsQ0FBQyxjQUFjLENBQUM7WUFDdEMsUUFBUSxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3hCLE9BQU87U0FDUixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBMb2dnaW5nT3V0cHV0UGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ091dHB1dFBheWxvYWR9IExvZ2dpbmdPdXRwdXRQYXlsb2FkICovXG5cbi8qKiBMb2dnZXIgZmlsZSBvdXRwdXQuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2dnZXJGaWxlT3V0cHV0IHtcbiAgLyoqXG4gICAqIENvbmZpZ3VyYXRpb24uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIF9jb25maWd1cmF0aW9uID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBGaWxlIHBhdGguXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9maWxlUGF0aCA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogR2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEB0eXBlIHsoKCkgPT4gaW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkKSB8IHVuZGVmaW5lZH0gKi9cbiAgX2dldENvbmZpZ3VyYXRpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHsoKSA9PiBpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthcmdzLmdldENvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiByZXNvbHZlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZ2V0Q29uZmlndXJhdGlvbiwgZmlsZVBhdGh9KSB7XG4gICAgdGhpcy5fY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLl9nZXRDb25maWd1cmF0aW9uID0gZ2V0Q29uZmlndXJhdGlvblxuICAgIHRoaXMuX2ZpbGVQYXRoID0gZmlsZVBhdGhcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdyaXRlLlxuICAgKiBAcGFyYW0ge0xvZ2dpbmdPdXRwdXRQYXlsb2FkfSBwYXlsb2FkIC0gTG9nIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyB3cml0ZSh7bWVzc2FnZX0pIHtcbiAgICBpZiAoIXRoaXMuX2ZpbGVQYXRoKSByZXR1cm5cblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9jb25maWd1cmF0aW9uIHx8IHRoaXMuX2dldENvbmZpZ3VyYXRpb24/LigpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24gfHwgdHlwZW9mIGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuXG4gICAgaWYgKCFlbnZpcm9ubWVudEhhbmRsZXIgfHwgdHlwZW9mIGVudmlyb25tZW50SGFuZGxlci53cml0ZUxvZ1RvRmlsZSAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci53cml0ZUxvZ1RvRmlsZSh7XG4gICAgICBmaWxlUGF0aDogdGhpcy5fZmlsZVBhdGgsXG4gICAgICBtZXNzYWdlXG4gICAgfSlcbiAgfVxufVxuIl19
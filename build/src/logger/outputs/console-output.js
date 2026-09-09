// @ts-check
/**
 * LoggingOutputPayload type.
 * @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */
/** Logger console output. */
export default class LoggerConsoleOutput {
    /**
     * Runs write.
     * @param {LoggingOutputPayload} payload - Log payload.
     */
    async write({ level, message }) {
        if (level === "error") {
            console.error(message);
            return;
        }
        if (level === "warn") {
            console.warn(message);
            return;
        }
        if (level === "debug" || level === "debug-low-level") {
            const debugLogger = typeof console.debug === "function" ? console.debug : console.log;
            debugLogger(message);
            return;
        }
        console.log(message);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc29sZS1vdXRwdXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvbG9nZ2VyL291dHB1dHMvY29uc29sZS1vdXRwdXQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOztpR0FFaUc7QUFFakcsNkJBQTZCO0FBQzdCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUJBQW1CO0lBQ3RDOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFDO1FBQzFCLElBQUksS0FBSyxLQUFLLE9BQU8sRUFBRSxDQUFDO1lBQ3RCLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDdEIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLEtBQUssS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUNyQixPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3JCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxLQUFLLEtBQUssT0FBTyxJQUFJLEtBQUssS0FBSyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3JELE1BQU0sV0FBVyxHQUFHLE9BQU8sT0FBTyxDQUFDLEtBQUssS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUE7WUFDckYsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3BCLE9BQU07UUFDUixDQUFDO1FBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUN0QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBMb2dnaW5nT3V0cHV0UGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ091dHB1dFBheWxvYWR9IExvZ2dpbmdPdXRwdXRQYXlsb2FkICovXG5cbi8qKiBMb2dnZXIgY29uc29sZSBvdXRwdXQuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2dnZXJDb25zb2xlT3V0cHV0IHtcbiAgLyoqXG4gICAqIFJ1bnMgd3JpdGUuXG4gICAqIEBwYXJhbSB7TG9nZ2luZ091dHB1dFBheWxvYWR9IHBheWxvYWQgLSBMb2cgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIHdyaXRlKHtsZXZlbCwgbWVzc2FnZX0pIHtcbiAgICBpZiAobGV2ZWwgPT09IFwiZXJyb3JcIikge1xuICAgICAgY29uc29sZS5lcnJvcihtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGxldmVsID09PSBcIndhcm5cIikge1xuICAgICAgY29uc29sZS53YXJuKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobGV2ZWwgPT09IFwiZGVidWdcIiB8fCBsZXZlbCA9PT0gXCJkZWJ1Zy1sb3ctbGV2ZWxcIikge1xuICAgICAgY29uc3QgZGVidWdMb2dnZXIgPSB0eXBlb2YgY29uc29sZS5kZWJ1ZyA9PT0gXCJmdW5jdGlvblwiID8gY29uc29sZS5kZWJ1ZyA6IGNvbnNvbGUubG9nXG4gICAgICBkZWJ1Z0xvZ2dlcihtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc29sZS5sb2cobWVzc2FnZSlcbiAgfVxufVxuIl19
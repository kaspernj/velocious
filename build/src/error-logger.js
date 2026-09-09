// @ts-check
/**
 * Runs error logger.
 * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>} callback - Callback function.
 * @returns {(...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>} - The error logger.
 */
export default function errorLogger(callback) {
    return async function (...args) {
        try {
            await callback(...args);
        }
        catch (error) {
            if (error instanceof Error) {
                console.error(`ErrorLogger: ${error.message}`);
                if (error.stack) {
                    console.error("Stack", error.stack);
                }
                else {
                    console.error("No stack");
                }
            }
            else {
                console.error(`ErrorLogger: ${error}`);
                console.error("No stack");
            }
            // Give console some time to write out messages before crashing
            setTimeout(() => { throw error; });
        }
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3ItbG9nZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2Vycm9yLWxvZ2dlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLFVBQVUsV0FBVyxDQUFDLFFBQVE7SUFDMUMsT0FBTyxLQUFLLFdBQVUsR0FBRyxJQUFJO1FBQzNCLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUE7UUFDekIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLEtBQUssWUFBWSxLQUFLLEVBQUUsQ0FBQztnQkFDM0IsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUE7Z0JBRTlDLElBQUksS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDO29CQUNoQixPQUFPLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUE7Z0JBQ3JDLENBQUM7cUJBQU0sQ0FBQztvQkFDTixPQUFPLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFBO2dCQUMzQixDQUFDO1lBQ0gsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE9BQU8sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEtBQUssRUFBRSxDQUFDLENBQUE7Z0JBQ3RDLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDM0IsQ0FBQztZQUVELCtEQUErRDtZQUMvRCxVQUFVLENBQUMsR0FBRyxFQUFFLEdBQUcsTUFBTSxLQUFLLENBQUEsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUNuQyxDQUFDO0lBQ0gsQ0FBQyxDQUFBO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFJ1bnMgZXJyb3IgbG9nZ2VyLlxuICogQHBhcmFtIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHJldHVybnMgeyguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8dm9pZD59IC0gVGhlIGVycm9yIGxvZ2dlci5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gZXJyb3JMb2dnZXIoY2FsbGJhY2spIHtcbiAgcmV0dXJuIGFzeW5jIGZ1bmN0aW9uKC4uLmFyZ3MpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soLi4uYXJncylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3JMb2dnZXI6ICR7ZXJyb3IubWVzc2FnZX1gKVxuXG4gICAgICAgIGlmIChlcnJvci5zdGFjaykge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJTdGFja1wiLCBlcnJvci5zdGFjaylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFwiTm8gc3RhY2tcIilcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3JMb2dnZXI6ICR7ZXJyb3J9YClcbiAgICAgICAgY29uc29sZS5lcnJvcihcIk5vIHN0YWNrXCIpXG4gICAgICB9XG5cbiAgICAgIC8vIEdpdmUgY29uc29sZSBzb21lIHRpbWUgdG8gd3JpdGUgb3V0IG1lc3NhZ2VzIGJlZm9yZSBjcmFzaGluZ1xuICAgICAgc2V0VGltZW91dCgoKSA9PiB7IHRocm93IGVycm9yIH0pXG4gICAgfVxuICB9XG59XG4iXX0=
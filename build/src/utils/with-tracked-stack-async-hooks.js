// @ts-check
import { AsyncLocalStorage } from "node:async_hooks";
/**
 * Defines asyncLocalStorage.
 * @type {import("node:async_hooks").AsyncLocalStorage<Array<string[]>> | undefined} */
let asyncLocalStorage;
/**
 * Tracked stack global.
 * @type {{withTrackedStack?: {addTrackedStackToError: (error: Error) => void, withTrackedStack: (arg1: string | (() => Promise<ReturnType<typeof JSON.parse>>), arg2?: (() => Promise<ReturnType<typeof JSON.parse>>) | Error) => Promise<ReturnType<typeof JSON.parse>>}}} */
const trackedStackGlobal = /** @type {ReturnType<typeof JSON.parse>} */ (globalThis);
if (AsyncLocalStorage) {
    asyncLocalStorage = new AsyncLocalStorage();
}
/**
 * Runs add tracked stack to error.
 * @param {Error} error - Error to annotate with a tracked stack.
 */
function addTrackedStackToError(error) {
    // Not supported
    if (!asyncLocalStorage)
        return;
    const parentStacks = asyncLocalStorage.getStore() || [];
    const additionalStackLines = [];
    for (const parentStack of parentStacks) {
        for (const parentStackLine of parentStack) {
            additionalStackLines.push(parentStackLine);
        }
    }
    // Replace the error message on the first line with this string
    error.stack += "\n" + additionalStackLines.join("\n");
}
/**
 * Runs with tracked stack.
 * @param {(() => Promise<ReturnType<typeof JSON.parse>>) | string} arg1 - Arg1.
 * @param {(() => Promise<ReturnType<typeof JSON.parse>>) | Error} [arg2] - Arg2.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the callback result.
 */
async function withTrackedStack(arg1, arg2) {
    /**
     * Defines callback.
     * @type {() => Promise<ReturnType<typeof JSON.parse>>} */
    let callback;
    /**
     * Defines stack.
     * @type {string} */
    let stack;
    if (typeof arg2 == "function" && typeof arg1 == "string") {
        callback = /** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ (arg2);
        stack = arg1;
    }
    else {
        callback = /** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ (arg1);
        stack = Error().stack || "";
    }
    // Not supported
    if (!asyncLocalStorage)
        return await callback();
    const parentStacks = asyncLocalStorage.getStore() || [];
    const additionalStackLines = [];
    const currentStackLines = stack.split("\n");
    currentStackLines[0] = "    [WITH TRACKED STACK]";
    for (let i = currentStackLines.length; i >= 0; i--) {
        const stackLine = currentStackLines[i];
        additionalStackLines.unshift(stackLine);
        if (stackLine == "    [WITH TRACKED STACK]") {
            break;
        }
    }
    const newStacks = [additionalStackLines, ...parentStacks];
    return await asyncLocalStorage.run(newStacks, async () => {
        return await callback();
    });
}
if (trackedStackGlobal.withTrackedStack) {
    console.warn("globalThis.withTrackedStack was already defined");
}
else {
    trackedStackGlobal.withTrackedStack = { addTrackedStackToError, withTrackedStack };
}
export { addTrackedStackToError, withTrackedStack };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2l0aC10cmFja2VkLXN0YWNrLWFzeW5jLWhvb2tzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay1hc3luYy1ob29rcy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLGlCQUFpQixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFFbEQ7O3VGQUV1RjtBQUN2RixJQUFJLGlCQUFpQixDQUFBO0FBRXJCOzsrUUFFK1E7QUFDL1EsTUFBTSxrQkFBa0IsR0FBRyw0Q0FBNEMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO0FBRXBGLElBQUksaUJBQWlCLEVBQUUsQ0FBQztJQUN0QixpQkFBaUIsR0FBRyxJQUFJLGlCQUFpQixFQUFFLENBQUE7QUFDN0MsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsc0JBQXNCLENBQUMsS0FBSztJQUNuQyxnQkFBZ0I7SUFDaEIsSUFBSSxDQUFDLGlCQUFpQjtRQUFFLE9BQU07SUFFOUIsTUFBTSxZQUFZLEdBQUcsaUJBQWlCLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxDQUFBO0lBQ3ZELE1BQU0sb0JBQW9CLEdBQUcsRUFBRSxDQUFBO0lBRS9CLEtBQUssTUFBTSxXQUFXLElBQUksWUFBWSxFQUFFLENBQUM7UUFDdkMsS0FBSyxNQUFNLGVBQWUsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUMxQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDNUMsQ0FBQztJQUNILENBQUM7SUFFRCwrREFBK0Q7SUFDL0QsS0FBSyxDQUFDLEtBQUssSUFBSSxJQUFJLEdBQUcsb0JBQW9CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQ3ZELENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILEtBQUssVUFBVSxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsSUFBSTtJQUN4Qzs7OERBRTBEO0lBQzFELElBQUksUUFBUSxDQUFBO0lBRVo7O3dCQUVvQjtJQUNwQixJQUFJLEtBQUssQ0FBQTtJQUVULElBQUksT0FBTyxJQUFJLElBQUksVUFBVSxJQUFJLE9BQU8sSUFBSSxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQ3pELFFBQVEsR0FBRywyREFBMkQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzdFLEtBQUssR0FBRyxJQUFJLENBQUE7SUFDZCxDQUFDO1NBQU0sQ0FBQztRQUNOLFFBQVEsR0FBRywyREFBMkQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzdFLEtBQUssR0FBRyxLQUFLLEVBQUUsQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFBO0lBQzdCLENBQUM7SUFFRCxnQkFBZ0I7SUFDaEIsSUFBSSxDQUFDLGlCQUFpQjtRQUFFLE9BQU8sTUFBTSxRQUFRLEVBQUUsQ0FBQTtJQUUvQyxNQUFNLFlBQVksR0FBRyxpQkFBaUIsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUE7SUFDdkQsTUFBTSxvQkFBb0IsR0FBRyxFQUFFLENBQUE7SUFDL0IsTUFBTSxpQkFBaUIsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBRTNDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxHQUFHLDBCQUEwQixDQUFBO0lBRWpELEtBQUssSUFBSSxDQUFDLEdBQUcsaUJBQWlCLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztRQUNuRCxNQUFNLFNBQVMsR0FBRyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUV0QyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFdkMsSUFBSSxTQUFTLElBQUksMEJBQTBCLEVBQUUsQ0FBQztZQUM1QyxNQUFLO1FBQ1AsQ0FBQztJQUNILENBQUM7SUFFRCxNQUFNLFNBQVMsR0FBRyxDQUFDLG9CQUFvQixFQUFFLEdBQUcsWUFBWSxDQUFDLENBQUE7SUFFekQsT0FBTyxNQUFNLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDdkQsT0FBTyxNQUFNLFFBQVEsRUFBRSxDQUFBO0lBQ3pCLENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQztBQUVELElBQUksa0JBQWtCLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztJQUN4QyxPQUFPLENBQUMsSUFBSSxDQUFDLGlEQUFpRCxDQUFDLENBQUE7QUFDakUsQ0FBQztLQUFNLENBQUM7SUFDTixrQkFBa0IsQ0FBQyxnQkFBZ0IsR0FBRyxFQUFDLHNCQUFzQixFQUFFLGdCQUFnQixFQUFDLENBQUE7QUFDbEYsQ0FBQztBQUVELE9BQU8sRUFBQyxzQkFBc0IsRUFBRSxnQkFBZ0IsRUFBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7QXN5bmNMb2NhbFN0b3JhZ2V9IGZyb20gXCJub2RlOmFzeW5jX2hvb2tzXCJcblxuLyoqXG4gKiBEZWZpbmVzIGFzeW5jTG9jYWxTdG9yYWdlLlxuICogQHR5cGUge2ltcG9ydChcIm5vZGU6YXN5bmNfaG9va3NcIikuQXN5bmNMb2NhbFN0b3JhZ2U8QXJyYXk8c3RyaW5nW10+PiB8IHVuZGVmaW5lZH0gKi9cbmxldCBhc3luY0xvY2FsU3RvcmFnZVxuXG4vKipcbiAqIFRyYWNrZWQgc3RhY2sgZ2xvYmFsLlxuICogQHR5cGUge3t3aXRoVHJhY2tlZFN0YWNrPzoge2FkZFRyYWNrZWRTdGFja1RvRXJyb3I6IChlcnJvcjogRXJyb3IpID0+IHZvaWQsIHdpdGhUcmFja2VkU3RhY2s6IChhcmcxOiBzdHJpbmcgfCAoKCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pLCBhcmcyPzogKCgpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IEVycm9yKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19fSAqL1xuY29uc3QgdHJhY2tlZFN0YWNrR2xvYmFsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGdsb2JhbFRoaXMpXG5cbmlmIChBc3luY0xvY2FsU3RvcmFnZSkge1xuICBhc3luY0xvY2FsU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG59XG5cbi8qKlxuICogUnVucyBhZGQgdHJhY2tlZCBzdGFjayB0byBlcnJvci5cbiAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgdG8gYW5ub3RhdGUgd2l0aCBhIHRyYWNrZWQgc3RhY2suXG4gKi9cbmZ1bmN0aW9uIGFkZFRyYWNrZWRTdGFja1RvRXJyb3IoZXJyb3IpIHtcbiAgLy8gTm90IHN1cHBvcnRlZFxuICBpZiAoIWFzeW5jTG9jYWxTdG9yYWdlKSByZXR1cm5cblxuICBjb25zdCBwYXJlbnRTdGFja3MgPSBhc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpIHx8IFtdXG4gIGNvbnN0IGFkZGl0aW9uYWxTdGFja0xpbmVzID0gW11cblxuICBmb3IgKGNvbnN0IHBhcmVudFN0YWNrIG9mIHBhcmVudFN0YWNrcykge1xuICAgIGZvciAoY29uc3QgcGFyZW50U3RhY2tMaW5lIG9mIHBhcmVudFN0YWNrKSB7XG4gICAgICBhZGRpdGlvbmFsU3RhY2tMaW5lcy5wdXNoKHBhcmVudFN0YWNrTGluZSlcbiAgICB9XG4gIH1cblxuICAvLyBSZXBsYWNlIHRoZSBlcnJvciBtZXNzYWdlIG9uIHRoZSBmaXJzdCBsaW5lIHdpdGggdGhpcyBzdHJpbmdcbiAgZXJyb3Iuc3RhY2sgKz0gXCJcXG5cIiArIGFkZGl0aW9uYWxTdGFja0xpbmVzLmpvaW4oXCJcXG5cIilcbn1cblxuLyoqXG4gKiBSdW5zIHdpdGggdHJhY2tlZCBzdGFjay5cbiAqIEBwYXJhbSB7KCgpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IHN0cmluZ30gYXJnMSAtIEFyZzEuXG4gKiBAcGFyYW0geygoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBFcnJvcn0gW2FyZzJdIC0gQXJnMi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdpdGhUcmFja2VkU3RhY2soYXJnMSwgYXJnMikge1xuICAvKipcbiAgICogRGVmaW5lcyBjYWxsYmFjay5cbiAgICogQHR5cGUgeygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgY2FsbGJhY2tcblxuICAvKipcbiAgICogRGVmaW5lcyBzdGFjay5cbiAgICogQHR5cGUge3N0cmluZ30gKi9cbiAgbGV0IHN0YWNrXG5cbiAgaWYgKHR5cGVvZiBhcmcyID09IFwiZnVuY3Rpb25cIiAmJiB0eXBlb2YgYXJnMSA9PSBcInN0cmluZ1wiKSB7XG4gICAgY2FsbGJhY2sgPSAvKiogQHR5cGUgeygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYXJnMilcbiAgICBzdGFjayA9IGFyZzFcbiAgfSBlbHNlIHtcbiAgICBjYWxsYmFjayA9IC8qKiBAdHlwZSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChhcmcxKVxuICAgIHN0YWNrID0gRXJyb3IoKS5zdGFjayB8fCBcIlwiXG4gIH1cblxuICAvLyBOb3Qgc3VwcG9ydGVkXG4gIGlmICghYXN5bmNMb2NhbFN0b3JhZ2UpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgY29uc3QgcGFyZW50U3RhY2tzID0gYXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKSB8fCBbXVxuICBjb25zdCBhZGRpdGlvbmFsU3RhY2tMaW5lcyA9IFtdXG4gIGNvbnN0IGN1cnJlbnRTdGFja0xpbmVzID0gc3RhY2suc3BsaXQoXCJcXG5cIilcblxuICBjdXJyZW50U3RhY2tMaW5lc1swXSA9IFwiICAgIFtXSVRIIFRSQUNLRUQgU1RBQ0tdXCJcblxuICBmb3IgKGxldCBpID0gY3VycmVudFN0YWNrTGluZXMubGVuZ3RoOyBpID49IDA7IGktLSkge1xuICAgIGNvbnN0IHN0YWNrTGluZSA9IGN1cnJlbnRTdGFja0xpbmVzW2ldXG5cbiAgICBhZGRpdGlvbmFsU3RhY2tMaW5lcy51bnNoaWZ0KHN0YWNrTGluZSlcblxuICAgIGlmIChzdGFja0xpbmUgPT0gXCIgICAgW1dJVEggVFJBQ0tFRCBTVEFDS11cIikge1xuICAgICAgYnJlYWtcbiAgICB9XG4gIH1cblxuICBjb25zdCBuZXdTdGFja3MgPSBbYWRkaXRpb25hbFN0YWNrTGluZXMsIC4uLnBhcmVudFN0YWNrc11cblxuICByZXR1cm4gYXdhaXQgYXN5bmNMb2NhbFN0b3JhZ2UucnVuKG5ld1N0YWNrcywgYXN5bmMgKCkgPT4ge1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gIH0pXG59XG5cbmlmICh0cmFja2VkU3RhY2tHbG9iYWwud2l0aFRyYWNrZWRTdGFjaykge1xuICBjb25zb2xlLndhcm4oXCJnbG9iYWxUaGlzLndpdGhUcmFja2VkU3RhY2sgd2FzIGFscmVhZHkgZGVmaW5lZFwiKVxufSBlbHNlIHtcbiAgdHJhY2tlZFN0YWNrR2xvYmFsLndpdGhUcmFja2VkU3RhY2sgPSB7YWRkVHJhY2tlZFN0YWNrVG9FcnJvciwgd2l0aFRyYWNrZWRTdGFja31cbn1cblxuZXhwb3J0IHthZGRUcmFja2VkU3RhY2tUb0Vycm9yLCB3aXRoVHJhY2tlZFN0YWNrfVxuIl19
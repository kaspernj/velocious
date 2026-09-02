// @ts-check
import proxyaddr from "proxy-addr";
/**
 * Trusted proxy cache.
 * @type {WeakMap<import("../configuration.js").default, {source: string | string[] | undefined, trust: ((address: string, index: number) => boolean) | undefined}>} */
const trustedProxyCache = new WeakMap();
/**
 * Runs trusted proxy checker.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {((address: string, index: number) => boolean) | undefined} - Compiled trusted proxy checker.
 */
function trustedProxyChecker(configuration) {
    const trustedProxies = configuration.getTrustedProxies();
    const cached = trustedProxyCache.get(configuration);
    if (cached && cached.source === trustedProxies)
        return cached.trust;
    if (!trustedProxies || (Array.isArray(trustedProxies) && trustedProxies.length === 0)) {
        trustedProxyCache.set(configuration, { source: trustedProxies, trust: undefined });
        return undefined;
    }
    const trust = proxyaddr.compile(trustedProxies);
    trustedProxyCache.set(configuration, { source: trustedProxies, trust });
    return trust;
}
/**
 * Runs node style headers.
 * @param {Record<string, string | string[]>} headers - Request headers.
 * @returns {Record<string, string | string[]>} - Headers with lowercase names.
 */
function nodeStyleHeaders(headers) {
    /**
     * Result.
     * @type {Record<string, string | string[]>} */
    const result = {};
    for (const [key, value] of Object.entries(headers)) {
        result[key.toLowerCase()] = value;
    }
    return result;
}
/**
 * Runs resolve remote address.
 * @param {object} args - Options object.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @param {Record<string, string | string[]>} args.headers - Request headers.
 * @param {string | undefined} args.socketRemoteAddress - Socket peer address.
 * @returns {string | undefined} - Resolved client remote address.
 */
export default function resolveRemoteAddress({ configuration, headers, socketRemoteAddress }) {
    if (!socketRemoteAddress)
        return socketRemoteAddress;
    const trust = trustedProxyChecker(configuration);
    if (!trust)
        return socketRemoteAddress;
    const proxyRequest = /** @type {Parameters<typeof proxyaddr>[0]} */ ( /** @type {ReturnType<typeof JSON.parse>} */({
        connection: { remoteAddress: socketRemoteAddress },
        headers: nodeStyleHeaders(headers),
        socket: { remoteAddress: socketRemoteAddress }
    }));
    return proxyaddr(proxyRequest, trust);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVtb3RlLWFkZHJlc3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvcmVtb3RlLWFkZHJlc3MuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLFlBQVksQ0FBQTtBQUVsQzs7dUtBRXVLO0FBQ3ZLLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUV2Qzs7OztHQUlHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FBQyxhQUFhO0lBQ3hDLE1BQU0sY0FBYyxHQUFHLGFBQWEsQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQ3hELE1BQU0sTUFBTSxHQUFHLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQTtJQUVuRCxJQUFJLE1BQU0sSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLGNBQWM7UUFBRSxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUE7SUFFbkUsSUFBSSxDQUFDLGNBQWMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLElBQUksY0FBYyxDQUFDLE1BQU0sS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ3RGLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsRUFBQyxNQUFNLEVBQUUsY0FBYyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBQ2hGLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRCxNQUFNLEtBQUssR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBRS9DLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsRUFBQyxNQUFNLEVBQUUsY0FBYyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7SUFFckUsT0FBTyxLQUFLLENBQUE7QUFDZCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZ0JBQWdCLENBQUMsT0FBTztJQUMvQjs7bURBRStDO0lBQy9DLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtJQUVqQixLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ25ELE1BQU0sQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUE7SUFDbkMsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFBO0FBQ2YsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLENBQUMsT0FBTyxVQUFVLG9CQUFvQixDQUFDLEVBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRSxtQkFBbUIsRUFBQztJQUN4RixJQUFJLENBQUMsbUJBQW1CO1FBQUUsT0FBTyxtQkFBbUIsQ0FBQTtJQUVwRCxNQUFNLEtBQUssR0FBRyxtQkFBbUIsQ0FBQyxhQUFhLENBQUMsQ0FBQTtJQUVoRCxJQUFJLENBQUMsS0FBSztRQUFFLE9BQU8sbUJBQW1CLENBQUE7SUFFdEMsTUFBTSxZQUFZLEdBQUcsOENBQThDLENBQUMsRUFBQyw0Q0FBNkMsQ0FBQztRQUNqSCxVQUFVLEVBQUUsRUFBQyxhQUFhLEVBQUUsbUJBQW1CLEVBQUM7UUFDaEQsT0FBTyxFQUFFLGdCQUFnQixDQUFDLE9BQU8sQ0FBQztRQUNsQyxNQUFNLEVBQUUsRUFBQyxhQUFhLEVBQUUsbUJBQW1CLEVBQUM7S0FDN0MsQ0FBQyxDQUFDLENBQUE7SUFFSCxPQUFPLFNBQVMsQ0FBQyxZQUFZLEVBQUUsS0FBSyxDQUFDLENBQUE7QUFDdkMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcHJveHlhZGRyIGZyb20gXCJwcm94eS1hZGRyXCJcblxuLyoqXG4gKiBUcnVzdGVkIHByb3h5IGNhY2hlLlxuICogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCB7c291cmNlOiBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZCwgdHJ1c3Q6ICgoYWRkcmVzczogc3RyaW5nLCBpbmRleDogbnVtYmVyKSA9PiBib29sZWFuKSB8IHVuZGVmaW5lZH0+fSAqL1xuY29uc3QgdHJ1c3RlZFByb3h5Q2FjaGUgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogUnVucyB0cnVzdGVkIHByb3h5IGNoZWNrZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7KChhZGRyZXNzOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpID0+IGJvb2xlYW4pIHwgdW5kZWZpbmVkfSAtIENvbXBpbGVkIHRydXN0ZWQgcHJveHkgY2hlY2tlci5cbiAqL1xuZnVuY3Rpb24gdHJ1c3RlZFByb3h5Q2hlY2tlcihjb25maWd1cmF0aW9uKSB7XG4gIGNvbnN0IHRydXN0ZWRQcm94aWVzID0gY29uZmlndXJhdGlvbi5nZXRUcnVzdGVkUHJveGllcygpXG4gIGNvbnN0IGNhY2hlZCA9IHRydXN0ZWRQcm94eUNhY2hlLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmIChjYWNoZWQgJiYgY2FjaGVkLnNvdXJjZSA9PT0gdHJ1c3RlZFByb3hpZXMpIHJldHVybiBjYWNoZWQudHJ1c3RcblxuICBpZiAoIXRydXN0ZWRQcm94aWVzIHx8IChBcnJheS5pc0FycmF5KHRydXN0ZWRQcm94aWVzKSAmJiB0cnVzdGVkUHJveGllcy5sZW5ndGggPT09IDApKSB7XG4gICAgdHJ1c3RlZFByb3h5Q2FjaGUuc2V0KGNvbmZpZ3VyYXRpb24sIHtzb3VyY2U6IHRydXN0ZWRQcm94aWVzLCB0cnVzdDogdW5kZWZpbmVkfSlcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICBjb25zdCB0cnVzdCA9IHByb3h5YWRkci5jb21waWxlKHRydXN0ZWRQcm94aWVzKVxuXG4gIHRydXN0ZWRQcm94eUNhY2hlLnNldChjb25maWd1cmF0aW9uLCB7c291cmNlOiB0cnVzdGVkUHJveGllcywgdHJ1c3R9KVxuXG4gIHJldHVybiB0cnVzdFxufVxuXG4vKipcbiAqIFJ1bnMgbm9kZSBzdHlsZSBoZWFkZXJzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXT59IGhlYWRlcnMgLSBSZXF1ZXN0IGhlYWRlcnMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAtIEhlYWRlcnMgd2l0aCBsb3dlcmNhc2UgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIG5vZGVTdHlsZUhlYWRlcnMoaGVhZGVycykge1xuICAvKipcbiAgICogUmVzdWx0LlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAqL1xuICBjb25zdCByZXN1bHQgPSB7fVxuXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpKSB7XG4gICAgcmVzdWx0W2tleS50b0xvd2VyQ2FzZSgpXSA9IHZhbHVlXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogUnVucyByZXNvbHZlIHJlbW90ZSBhZGRyZXNzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXT59IGFyZ3MuaGVhZGVycyAtIFJlcXVlc3QgaGVhZGVycy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLnNvY2tldFJlbW90ZUFkZHJlc3MgLSBTb2NrZXQgcGVlciBhZGRyZXNzLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXNvbHZlZCBjbGllbnQgcmVtb3RlIGFkZHJlc3MuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHJlc29sdmVSZW1vdGVBZGRyZXNzKHtjb25maWd1cmF0aW9uLCBoZWFkZXJzLCBzb2NrZXRSZW1vdGVBZGRyZXNzfSkge1xuICBpZiAoIXNvY2tldFJlbW90ZUFkZHJlc3MpIHJldHVybiBzb2NrZXRSZW1vdGVBZGRyZXNzXG5cbiAgY29uc3QgdHJ1c3QgPSB0cnVzdGVkUHJveHlDaGVja2VyKGNvbmZpZ3VyYXRpb24pXG5cbiAgaWYgKCF0cnVzdCkgcmV0dXJuIHNvY2tldFJlbW90ZUFkZHJlc3NcblxuICBjb25zdCBwcm94eVJlcXVlc3QgPSAvKiogQHR5cGUge1BhcmFtZXRlcnM8dHlwZW9mIHByb3h5YWRkcj5bMF19ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoe1xuICAgIGNvbm5lY3Rpb246IHtyZW1vdGVBZGRyZXNzOiBzb2NrZXRSZW1vdGVBZGRyZXNzfSxcbiAgICBoZWFkZXJzOiBub2RlU3R5bGVIZWFkZXJzKGhlYWRlcnMpLFxuICAgIHNvY2tldDoge3JlbW90ZUFkZHJlc3M6IHNvY2tldFJlbW90ZUFkZHJlc3N9XG4gIH0pKVxuXG4gIHJldHVybiBwcm94eWFkZHIocHJveHlSZXF1ZXN0LCB0cnVzdClcbn1cbiJdfQ==
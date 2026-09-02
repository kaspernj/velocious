/**
 * Runs nest callbacks.
 * @param {Array<(next: () => Promise<void>) => void | Promise<void>>} callbacksToNestInside - Callbacks to nest inside.
 * @param {() => void | Promise<void>} callback - Callback function.
 * @returns {Promise<void>} - Resolves when complete.
 */
export default async function nestCallbacks(callbacksToNestInside, callback) {
    const baseCallback = async () => { await callback(); };
    let runCallback = baseCallback;
    for (const callbackToNestInside of callbacksToNestInside) {
        const actualRunCallback = runCallback;
        const nextRunRequest = async () => {
            await callbackToNestInside(actualRunCallback);
        };
        runCallback = nextRunRequest;
    }
    await runCallback();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmVzdC1jYWxsYmFja3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvbmVzdC1jYWxsYmFja3MuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7O0dBS0c7QUFDSCxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssVUFBVSxhQUFhLENBQUMscUJBQXFCLEVBQUUsUUFBUTtJQUN6RSxNQUFNLFlBQVksR0FBRyxLQUFLLElBQUksRUFBRSxHQUFHLE1BQU0sUUFBUSxFQUFFLENBQUEsQ0FBQyxDQUFDLENBQUE7SUFDckQsSUFBSSxXQUFXLEdBQUcsWUFBWSxDQUFBO0lBRTlCLEtBQUssTUFBTSxvQkFBb0IsSUFBSSxxQkFBcUIsRUFBRSxDQUFDO1FBQ3pELE1BQU0saUJBQWlCLEdBQUcsV0FBVyxDQUFBO1FBRXJDLE1BQU0sY0FBYyxHQUFHLEtBQUssSUFBSSxFQUFFO1lBQ2hDLE1BQU0sb0JBQW9CLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtRQUMvQyxDQUFDLENBQUE7UUFFRCxXQUFXLEdBQUcsY0FBYyxDQUFBO0lBQzlCLENBQUM7SUFFRCxNQUFNLFdBQVcsRUFBRSxDQUFBO0FBQ3JCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFJ1bnMgbmVzdCBjYWxsYmFja3MuXG4gKiBAcGFyYW0ge0FycmF5PChuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPj59IGNhbGxiYWNrc1RvTmVzdEluc2lkZSAtIENhbGxiYWNrcyB0byBuZXN0IGluc2lkZS5cbiAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBuZXN0Q2FsbGJhY2tzKGNhbGxiYWNrc1RvTmVzdEluc2lkZSwgY2FsbGJhY2spIHtcbiAgY29uc3QgYmFzZUNhbGxiYWNrID0gYXN5bmMgKCkgPT4geyBhd2FpdCBjYWxsYmFjaygpIH1cbiAgbGV0IHJ1bkNhbGxiYWNrID0gYmFzZUNhbGxiYWNrXG5cbiAgZm9yIChjb25zdCBjYWxsYmFja1RvTmVzdEluc2lkZSBvZiBjYWxsYmFja3NUb05lc3RJbnNpZGUpIHtcbiAgICBjb25zdCBhY3R1YWxSdW5DYWxsYmFjayA9IHJ1bkNhbGxiYWNrXG5cbiAgICBjb25zdCBuZXh0UnVuUmVxdWVzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrVG9OZXN0SW5zaWRlKGFjdHVhbFJ1bkNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJ1bkNhbGxiYWNrID0gbmV4dFJ1blJlcXVlc3RcbiAgfVxuXG4gIGF3YWl0IHJ1bkNhbGxiYWNrKClcbn1cbiJdfQ==
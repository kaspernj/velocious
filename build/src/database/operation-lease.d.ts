/**
 * Exclusive lease installed on a shared physical connection while one
 * operation-scoped transaction owns it.
 */
export default class VelociousDatabaseOperationLease {
    owner: symbol;
    released: boolean;
    releasedPromise: Promise<any>;
    releasePromise: () => void;
    /**
     * Runs constructor.
     * @param {symbol} owner - Opaque operation owner token.
     */
    constructor(owner: symbol);
    /**
     * Waits until the lease is released unless `owner` owns it.
     * @param {symbol | undefined} owner - Candidate operation owner.
     * @returns {Promise<void>} - Resolves when access is allowed.
     */
    wait(owner: symbol | undefined): Promise<void>;
    /**
     * Releases all waiters exactly once.
     * @returns {void}
     */
    release(): void;
}
//# sourceMappingURL=operation-lease.d.ts.map
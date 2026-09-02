export type InnodbDeadlockLockNode = {
    /**
     * - Opaque index identity.
     */
    indexFingerprint: string;
    /**
     * - Allowlisted lock mode.
     */
    lockMode: string;
    /**
     * - Lock relationship to its transaction.
     */
    state: "conflicting" | "held" | "waiting";
    /**
     * - Opaque table identity.
     */
    tableFingerprint: string;
};
export type InnodbDeadlockTransactionNode = {
    /**
     * - Bounded counterparty conflict edges whose owner is unavailable.
     */
    conflictingLocks: InnodbDeadlockLockNode[];
    /**
     * - Bounded locks owned or awaited by this transaction.
     */
    locks: InnodbDeadlockLockNode[];
    /**
     * - Report-local transaction ordinal.
     */
    ordinal: number;
};
export type InnodbDeadlockParserState = {
    /**
     * - Current bounded transaction node.
     */
    currentTransaction: InnodbDeadlockTransactionNode | undefined;
    /**
     * - Current lock section state.
     */
    currentLockState: "conflicting" | "held" | "waiting" | undefined;
    /**
     * - Total emitted lock nodes.
     */
    lockRecordCount: number;
    /**
     * - Whether a lock-node bound was reached.
     */
    lockRecordsTruncated: boolean;
    /**
     * - Bounded transaction nodes.
     */
    transactionNodes: InnodbDeadlockTransactionNode[];
    /**
     * - Whether the transaction-node bound was reached.
     */
    transactionNodesTruncated: boolean;
    /**
     * - Transaction headers observed in the bounded section.
     */
    transactions: number;
    /**
     * - Victim ordinal.
     */
    victimTransaction: number | null;
};
/**
 * Parses a bounded InnoDB latest-deadlock section into safe structural context.
 * @param {string} status - SHOW ENGINE INNODB STATUS text.
 * @returns {{lockRecordsTruncated: boolean, sectionTruncated: boolean, transactionNodes: InnodbDeadlockTransactionNode[], transactionNodesTruncated: boolean, transactions: number, victimTransaction: number | null}} - Structural deadlock summary.
 */
export default function parseInnodbDeadlockSummary(status: string): {
    lockRecordsTruncated: boolean;
    sectionTruncated: boolean;
    transactionNodes: InnodbDeadlockTransactionNode[];
    transactionNodesTruncated: boolean;
    transactions: number;
    victimTransaction: number | null;
};
//# sourceMappingURL=deadlock-diagnostic-parser.d.ts.map
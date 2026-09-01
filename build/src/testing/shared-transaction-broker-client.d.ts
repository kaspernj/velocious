import WebSocket from "ws";
import { decodeBrokerValue } from "./shared-transaction-codec.js";
export default class SharedTransactionBrokerClient {
    capability: string;
    databaseIdentifier: string;
    reuseKey: string | undefined;
    nextRequestId: number;
    /** @type {Map<number, {reject: (error: Error) => void, resolve: (value: ReturnType<typeof decodeBrokerValue>) => void}>} */
    pending: Map<number, {
        reject: (error: Error) => void;
        resolve: (value: ReturnType<typeof decodeBrokerValue>) => void;
    }>;
    socket: WebSocket;
    connectionPromise: Promise<any>;
    /**
     * Creates a broker client.
     * @param {{address: string, capability: string, databaseIdentifier: string, reuseKey?: string}} args - Broker coordinates.
     */
    constructor({ address, capability, databaseIdentifier, reuseKey }: {
        address: string;
        capability: string;
        databaseIdentifier: string;
        reuseKey?: string;
    });
    /**
     * Waits for the websocket to open.
     * @returns {Promise<void>} - Resolves after the websocket opens.
     */
    connected(): Promise<void>;
    /**
     * Calls one physical connection operation.
     * @param {string} method - Broker operation.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Operation arguments.
     * @returns {Promise<ReturnType<typeof decodeBrokerValue>>} - Remote result.
     */
    call(method: string, args: Array<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof decodeBrokerValue>>;
    /**
     * Handles a correlated broker response.
     * @param {string} serialized - Serialized response.
     * @returns {void} - No return value.
     */
    handleMessage(serialized: string): void;
    /**
     * Rejects every pending call after disconnect.
     * @param {Error} error - Disconnect error.
     * @returns {void} - No return value.
     */
    rejectPending(error: Error): void;
    /**
     * Closes the client without touching the parent connection.
     * @returns {Promise<void>} - Resolves after the websocket closes.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=shared-transaction-broker-client.d.ts.map
// @ts-check
import restArgsError from "../../utils/rest-args-error.js";
/**
 * Defines this typedef.
 * @typedef {{auth?: Record<string, ReturnType<typeof JSON.parse>>, [key: string]: ReturnType<typeof JSON.parse>}} SmtpConnectionOptions */
/**
 * Runs normalize recipients.
 * @param {ReturnType<typeof JSON.parse>} value - Recipient input.
 * @returns {string[]} - Normalized recipients.
 */
function normalizeRecipients(value) {
    if (!value)
        return [];
    if (Array.isArray(value))
        return value.filter((entry) => entry);
    return [value].filter((entry) => entry);
}
/**
 * Runs header line.
 * @param {string} name - Header name.
 * @param {string | undefined} value - Header value.
 * @returns {string | null} - Header line.
 */
function headerLine(name, value) {
    if (!value)
        return null;
    return `${name}: ${value}`;
}
/**
 * Runs envelope address.
 * @param {string} address - Header or mailbox address.
 * @returns {string} - SMTP envelope mailbox.
 */
function envelopeAddress(address) {
    const match = address.match(/<([^<>]+)>/);
    return (match ? match[1] : address).trim();
}
/**
 * SMTP mailer backend using smtp-connection.
 */
export default class SmtpMailerBackend {
    /**
     * Runs constructor.
     * @param {object} args - Constructor args.
     * @param {SmtpConnectionOptions} args.connectionOptions - smtp-connection options.
     * @param {string} [args.defaultFrom] - Default from address.
     */
    constructor({ connectionOptions, defaultFrom, ...restArgs }) {
        restArgsError(restArgs);
        if (!connectionOptions) {
            throw new Error(`Missing smtp connection options. Got: ${String(connectionOptions)}`);
        }
        this.connectionOptions = connectionOptions;
        this.defaultFrom = defaultFrom;
    }
    /**
     * Runs deliver.
     * @param {object} args - Delivery args.
     * @param {import("../index.js").MailerDeliveryPayload} args.payload - Mail delivery payload.
     * @param {import("../../configuration.js").default} [args.configuration] - Active configuration.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async deliver({ payload, configuration: _configuration, ...restArgs }) {
        restArgsError(restArgs);
        const from = payload.from || this.defaultFrom;
        if (!from) {
            throw new Error(`Missing mail "from" address. Got: ${String(from)}`);
        }
        const envelopeFrom = envelopeAddress(String(from));
        const toList = normalizeRecipients(payload.to);
        const ccList = normalizeRecipients(payload.cc);
        const bccList = normalizeRecipients(payload.bcc);
        const recipients = [...toList, ...ccList, ...bccList];
        if (recipients.length === 0) {
            throw new Error(`Missing mail recipients. Got: ${JSON.stringify({ to: payload.to, cc: payload.cc, bcc: payload.bcc })}`);
        }
        const headers = [
            headerLine("From", from),
            headerLine("To", toList.length > 0 ? toList.join(", ") : undefined),
            headerLine("Cc", ccList.length > 0 ? ccList.join(", ") : undefined),
            headerLine("Subject", payload.subject),
            "MIME-Version: 1.0",
            "Content-Type: text/html; charset=UTF-8"
        ].filter((line) => line);
        if (payload.headers) {
            for (const [headerName, headerValue] of Object.entries(payload.headers)) {
                headers.push(`${headerName}: ${headerValue}`);
            }
        }
        const message = `${headers.join("\r\n")}\r\n\r\n${payload.html}`;
        const { default: SmtpConnection } = await import("smtp-connection");
        const connectionOptions = this.connectionOptions;
        const connection = new SmtpConnection(connectionOptions);
        await new Promise((resolve, reject) => {
            let settled = false;
            let shuttingDown = false;
            const cleanup = () => {
                connection.removeListener("end", onEnd);
                connection.removeListener("error", onError);
            };
            const resolveDelivery = () => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                resolve(undefined);
            };
            /**
             * Reject delivery.
             * @param {Error} error - Error that failed delivery.
             */
            const rejectDelivery = (error) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                connection.close();
                reject(error);
            };
            const onEnd = () => resolveDelivery();
            /**
             * On error.
             * @param {Error} error - Error emitted by the SMTP connection.
             */
            const onError = (error) => {
                if (shuttingDown) {
                    resolveDelivery();
                    return;
                }
                rejectDelivery(error);
            };
            const quitAfterAcceptedMessage = () => {
                shuttingDown = true;
                connection.once("end", onEnd);
                connection.quit();
            };
            const sendMessage = () => {
                connection.send({ from: envelopeFrom, to: recipients }, /** @type {ReturnType<typeof JSON.parse>} */ (message), (/** @type {Error | null | undefined} */ sendError) => {
                    if (sendError) {
                        rejectDelivery(sendError);
                        return;
                    }
                    quitAfterAcceptedMessage();
                });
            };
            const authenticateAndSend = () => {
                if (!connectionOptions.auth) {
                    sendMessage();
                    return;
                }
                connection.login(connectionOptions.auth, (loginError) => {
                    if (loginError) {
                        rejectDelivery(loginError);
                        return;
                    }
                    sendMessage();
                });
            };
            connection.on("error", onError);
            connection.connect(authenticateAndSend);
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic210cC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9tYWlsZXIvYmFja2VuZHMvc210cC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0sZ0NBQWdDLENBQUE7QUFFMUQ7OzJJQUUySTtBQUUzSTs7OztHQUlHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FBQyxLQUFLO0lBQ2hDLElBQUksQ0FBQyxLQUFLO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFDckIsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDL0QsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDekMsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxVQUFVLENBQUMsSUFBSSxFQUFFLEtBQUs7SUFDN0IsSUFBSSxDQUFDLEtBQUs7UUFBRSxPQUFPLElBQUksQ0FBQTtJQUV2QixPQUFPLEdBQUcsSUFBSSxLQUFLLEtBQUssRUFBRSxDQUFBO0FBQzVCLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxlQUFlLENBQUMsT0FBTztJQUM5QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFBO0lBRXpDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7QUFDNUMsQ0FBQztBQUVEOztHQUVHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQkFBaUI7SUFDcEM7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsaUJBQWlCLEVBQUUsV0FB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QyxDQUFDLENBQUE7WUFDSixDQUFDLENBQUE7WUFFRCxVQUFVLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQTtZQUMvQixVQUFVLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUE7UUFDekMsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2F1dGg/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIFtrZXk6IHN0cmluZ106IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gU210cENvbm5lY3Rpb25PcHRpb25zICovXG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcmVjaXBpZW50cy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUmVjaXBpZW50IGlucHV0LlxuICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vcm1hbGl6ZWQgcmVjaXBpZW50cy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUmVjaXBpZW50cyh2YWx1ZSkge1xuICBpZiAoIXZhbHVlKSByZXR1cm4gW11cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkpXG4gIHJldHVybiBbdmFsdWVdLmZpbHRlcigoZW50cnkpID0+IGVudHJ5KVxufVxuXG4vKipcbiAqIFJ1bnMgaGVhZGVyIGxpbmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEhlYWRlciBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHZhbHVlIC0gSGVhZGVyIHZhbHVlLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gSGVhZGVyIGxpbmUuXG4gKi9cbmZ1bmN0aW9uIGhlYWRlckxpbmUobmFtZSwgdmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSkgcmV0dXJuIG51bGxcblxuICByZXR1cm4gYCR7bmFtZX06ICR7dmFsdWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZW52ZWxvcGUgYWRkcmVzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhZGRyZXNzIC0gSGVhZGVyIG9yIG1haWxib3ggYWRkcmVzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU01UUCBlbnZlbG9wZSBtYWlsYm94LlxuICovXG5mdW5jdGlvbiBlbnZlbG9wZUFkZHJlc3MoYWRkcmVzcykge1xuICBjb25zdCBtYXRjaCA9IGFkZHJlc3MubWF0Y2goLzwoW148Pl0rKT4vKVxuXG4gIHJldHVybiAobWF0Y2ggPyBtYXRjaFsxXSA6IGFkZHJlc3MpLnRyaW0oKVxufVxuXG4vKipcbiAqIFNNVFAgbWFpbGVyIGJhY2tlbmQgdXNpbmcgc210cC1jb25uZWN0aW9uLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTbXRwTWFpbGVyQmFja2VuZCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvbnN0cnVjdG9yIGFyZ3MuXG4gICAqIEBwYXJhbSB7U210cENvbm5lY3Rpb25PcHRpb25zfSBhcmdzLmNvbm5lY3Rpb25PcHRpb25zIC0gc210cC1jb25uZWN0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kZWZhdWx0RnJvbV0gLSBEZWZhdWx0IGZyb20gYWRkcmVzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25uZWN0aW9uT3B0aW9ucywgZGVmYXVsdEZyb20sIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb25PcHRpb25zKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3Npbmcgc210cCBjb25uZWN0aW9uIG9wdGlvbnMuIEdvdDogJHtTdHJpbmcoY29ubmVjdGlvbk9wdGlvbnMpfWApXG4gICAgfVxuXG4gICAgdGhpcy5jb25uZWN0aW9uT3B0aW9ucyA9IGNvbm5lY3Rpb25PcHRpb25zXG4gICAgdGhpcy5kZWZhdWx0RnJvbSA9IGRlZmF1bHRGcm9tXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERlbGl2ZXJ5IGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSBhcmdzLnBheWxvYWQgLSBNYWlsIGRlbGl2ZXJ5IHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIEFjdGl2ZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZGVsaXZlcih7cGF5bG9hZCwgY29uZmlndXJhdGlvbjogX2NvbmZpZ3VyYXRpb24sIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCBmcm9tID0gcGF5bG9hZC5mcm9tIHx8IHRoaXMuZGVmYXVsdEZyb21cblxuICAgIGlmICghZnJvbSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIG1haWwgXCJmcm9tXCIgYWRkcmVzcy4gR290OiAke1N0cmluZyhmcm9tKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IGVudmVsb3BlRnJvbSA9IGVudmVsb3BlQWRkcmVzcyhTdHJpbmcoZnJvbSkpXG5cbiAgICBjb25zdCB0b0xpc3QgPSBub3JtYWxpemVSZWNpcGllbnRzKHBheWxvYWQudG8pXG4gICAgY29uc3QgY2NMaXN0ID0gbm9ybWFsaXplUmVjaXBpZW50cyhwYXlsb2FkLmNjKVxuICAgIGNvbnN0IGJjY0xpc3QgPSBub3JtYWxpemVSZWNpcGllbnRzKHBheWxvYWQuYmNjKVxuICAgIGNvbnN0IHJlY2lwaWVudHMgPSBbLi4udG9MaXN0LCAuLi5jY0xpc3QsIC4uLmJjY0xpc3RdXG5cbiAgICBpZiAocmVjaXBpZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBtYWlsIHJlY2lwaWVudHMuIEdvdDogJHtKU09OLnN0cmluZ2lmeSh7dG86IHBheWxvYWQudG8sIGNjOiBwYXlsb2FkLmNjLCBiY2M6IHBheWxvYWQuYmNjfSl9YClcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgaGVhZGVyTGluZShcIkZyb21cIiwgZnJvbSksXG4gICAgICBoZWFkZXJMaW5lKFwiVG9cIiwgdG9MaXN0Lmxlbmd0aCA+IDAgPyB0b0xpc3Quam9pbihcIiwgXCIpIDogdW5kZWZpbmVkKSxcbiAgICAgIGhlYWRlckxpbmUoXCJDY1wiLCBjY0xpc3QubGVuZ3RoID4gMCA/IGNjTGlzdC5qb2luKFwiLCBcIikgOiB1bmRlZmluZWQpLFxuICAgICAgaGVhZGVyTGluZShcIlN1YmplY3RcIiwgcGF5bG9hZC5zdWJqZWN0KSxcbiAgICAgIFwiTUlNRS1WZXJzaW9uOiAxLjBcIixcbiAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L2h0bWw7IGNoYXJzZXQ9VVRGLThcIlxuICAgIF0uZmlsdGVyKChsaW5lKSA9PiBsaW5lKVxuXG4gICAgaWYgKHBheWxvYWQuaGVhZGVycykge1xuICAgICAgZm9yIChjb25zdCBbaGVhZGVyTmFtZSwgaGVhZGVyVmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBheWxvYWQuaGVhZGVycykpIHtcbiAgICAgICAgaGVhZGVycy5wdXNoKGAke2hlYWRlck5hbWV9OiAke2hlYWRlclZhbHVlfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZSA9IGAke2hlYWRlcnMuam9pbihcIlxcclxcblwiKX1cXHJcXG5cXHJcXG4ke3BheWxvYWQuaHRtbH1gXG4gICAgY29uc3Qge2RlZmF1bHQ6IFNtdHBDb25uZWN0aW9ufSA9IGF3YWl0IGltcG9ydChcInNtdHAtY29ubmVjdGlvblwiKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25PcHRpb25zID0gdGhpcy5jb25uZWN0aW9uT3B0aW9uc1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBuZXcgU210cENvbm5lY3Rpb24oY29ubmVjdGlvbk9wdGlvbnMpXG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlXG4gICAgICBsZXQgc2h1dHRpbmdEb3duID0gZmFsc2VcblxuICAgICAgY29uc3QgY2xlYW51cCA9ICgpID0+IHtcbiAgICAgICAgY29ubmVjdGlvbi5yZW1vdmVMaXN0ZW5lcihcImVuZFwiLCBvbkVuZClcbiAgICAgICAgY29ubmVjdGlvbi5yZW1vdmVMaXN0ZW5lcihcImVycm9yXCIsIG9uRXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc29sdmVEZWxpdmVyeSA9ICgpID0+IHtcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuXG4gICAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICAgIGNsZWFudXAoKVxuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBSZWplY3QgZGVsaXZlcnkuXG4gICAgICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIHRoYXQgZmFpbGVkIGRlbGl2ZXJ5LlxuICAgICAgICovXG4gICAgICBjb25zdCByZWplY3REZWxpdmVyeSA9IChlcnJvcikgPT4ge1xuICAgICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuXG5cbiAgICAgICAgc2V0dGxlZCA9IHRydWVcbiAgICAgICAgY2xlYW51cCgpXG4gICAgICAgIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG9uRW5kID0gKCkgPT4gcmVzb2x2ZURlbGl2ZXJ5KClcblxuICAgICAgLyoqXG4gICAgICAgKiBPbiBlcnJvci5cbiAgICAgICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgZW1pdHRlZCBieSB0aGUgU01UUCBjb25uZWN0aW9uLlxuICAgICAgICovXG4gICAgICBjb25zdCBvbkVycm9yID0gKGVycm9yKSA9PiB7XG4gICAgICAgIGlmIChzaHV0dGluZ0Rvd24pIHtcbiAgICAgICAgICByZXNvbHZlRGVsaXZlcnkoKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgcmVqZWN0RGVsaXZlcnkoZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHF1aXRBZnRlckFjY2VwdGVkTWVzc2FnZSA9ICgpID0+IHtcbiAgICAgICAgc2h1dHRpbmdEb3duID0gdHJ1ZVxuICAgICAgICBjb25uZWN0aW9uLm9uY2UoXCJlbmRcIiwgb25FbmQpXG4gICAgICAgIGNvbm5lY3Rpb24ucXVpdCgpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNlbmRNZXNzYWdlID0gKCkgPT4ge1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoe2Zyb206IGVudmVsb3BlRnJvbSwgdG86IHJlY2lwaWVudHN9LCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobWVzc2FnZSksICgvKiogQHR5cGUge0Vycm9yIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gc2VuZEVycm9yKSA9PiB7XG4gICAgICAgICAgaWYgKHNlbmRFcnJvcikge1xuICAgICAgICAgICAgcmVqZWN0RGVsaXZlcnkoc2VuZEVycm9yKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcXVpdEFmdGVyQWNjZXB0ZWRNZXNzYWdlKClcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXV0aGVudGljYXRlQW5kU2VuZCA9ICgpID0+IHtcbiAgICAgICAgaWYgKCFjb25uZWN0aW9uT3B0aW9ucy5hdXRoKSB7XG4gICAgICAgICAgc2VuZE1lc3NhZ2UoKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgY29ubmVjdGlvbi5sb2dpbihjb25uZWN0aW9uT3B0aW9ucy5hdXRoLCAobG9naW5FcnJvcikgPT4ge1xuICAgICAgICAgIGlmIChsb2dpbkVycm9yKSB7XG4gICAgICAgICAgICByZWplY3REZWxpdmVyeShsb2dpbkVycm9yKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgc2VuZE1lc3NhZ2UoKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBjb25uZWN0aW9uLm9uKFwiZXJyb3JcIiwgb25FcnJvcilcbiAgICAgIGNvbm5lY3Rpb24uY29ubmVjdChhdXRoZW50aWNhdGVBbmRTZW5kKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==
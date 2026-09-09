import BaseCommand from "../../../../cli/base-command.js";
import BeaconServer from "../../../../beacon/server.js";
export default class BeaconCommand extends BaseCommand {
    async execute() {
        // Identify this process in `ps`/`top` instead of a generic "node" entry.
        process.title = "velocious beacon";
        const beacon = new BeaconServer({ configuration: this.getConfiguration() });
        await beacon.start();
        console.log(`Beacon listening on ${beacon.host}:${beacon.getPort()}`);
        await new Promise((resolve) => {
            const shutdown = async () => {
                await beacon.stop();
                resolve(undefined);
            };
            process.once("SIGINT", shutdown);
            process.once("SIGTERM", shutdown);
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmVhY29uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL2JlYWNvbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN6RCxPQUFPLFlBQVksTUFBTSw4QkFBOEIsQ0FBQTtBQUV2RCxNQUFNLENBQUMsT0FBTyxPQUFPLGFBQWMsU0FBUSxXQUFXO0lBQ3BELEtBQUssQ0FBQyxPQUFPO1FBQ1gseUVBQXlFO1FBQ3pFLE9BQU8sQ0FBQyxLQUFLLEdBQUcsa0JBQWtCLENBQUE7UUFFbEMsTUFBTSxNQUFNLEdBQUcsSUFBSSxZQUFZLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixFQUFFLEVBQUMsQ0FBQyxDQUFBO1FBQ3pFLE1BQU0sTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRXBCLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLE1BQU0sQ0FBQyxJQUFJLElBQUksTUFBTSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUVyRSxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDNUIsTUFBTSxRQUFRLEdBQUcsS0FBSyxJQUFJLEVBQUU7Z0JBQzFCLE1BQU0sTUFBTSxDQUFDLElBQUksRUFBRSxDQUFBO2dCQUNuQixPQUFPLENBQUMsU0FBUyxDQUFDLENBQUE7WUFDcEIsQ0FBQyxDQUFBO1lBRUQsT0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUE7WUFDaEMsT0FBTyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFDbkMsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IEJlYWNvblNlcnZlciBmcm9tIFwiLi4vLi4vLi4vLi4vYmVhY29uL3NlcnZlci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJlYWNvbkNvbW1hbmQgZXh0ZW5kcyBCYXNlQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgLy8gSWRlbnRpZnkgdGhpcyBwcm9jZXNzIGluIGBwc2AvYHRvcGAgaW5zdGVhZCBvZiBhIGdlbmVyaWMgXCJub2RlXCIgZW50cnkuXG4gICAgcHJvY2Vzcy50aXRsZSA9IFwidmVsb2Npb3VzIGJlYWNvblwiXG5cbiAgICBjb25zdCBiZWFjb24gPSBuZXcgQmVhY29uU2VydmVyKHtjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKX0pXG4gICAgYXdhaXQgYmVhY29uLnN0YXJ0KClcblxuICAgIGNvbnNvbGUubG9nKGBCZWFjb24gbGlzdGVuaW5nIG9uICR7YmVhY29uLmhvc3R9OiR7YmVhY29uLmdldFBvcnQoKX1gKVxuXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNvbnN0IHNodXRkb3duID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBiZWFjb24uc3RvcCgpXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfVxuXG4gICAgICBwcm9jZXNzLm9uY2UoXCJTSUdJTlRcIiwgc2h1dGRvd24pXG4gICAgICBwcm9jZXNzLm9uY2UoXCJTSUdURVJNXCIsIHNodXRkb3duKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==
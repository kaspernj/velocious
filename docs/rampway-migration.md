## Rampway migration guidance

Velocious no longer ships the deployment API that previously mounted a bounded
`/velocious/deployments` endpoint. Deployment orchestration now belongs in
Rampway rather than Velocious core.

If your app still uses the removed Velocious deployment API:

- Remove the `route.mount(...)` entry that mounted the Velocious deployment endpoint.
- Move the deployment integration, adapter ownership, and caller-facing deploy trigger to Rampway.
- Keep using Velocious for application concerns such as background jobs and data access; only the deployment API moved out.

Rampway repository:

- <https://github.com/kaspernj/rampway>

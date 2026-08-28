Add opt-in release-scoped background-jobs generations with explicit identity,
generation-fenced worker ownership and reporting, quiescent candidates,
synchronous retirement admission fences, same-generation reconnect grace,
retired-main durable recovery, release-local Unix lifecycle control, and
acknowledged `background-jobs:activate` / `background-jobs:retire` commands.
Retiring workers retain heartbeat and exact-endpoint reconnect through accepted
work and acknowledged reports; generation hello and lifecycle control requests
now have hard initiating-side deadlines, and ID-only candidate defaults no
longer conflict with explicit active/retired recovery starts.
Legacy behavior remains unchanged when generation mode is unset.

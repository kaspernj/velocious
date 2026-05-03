# Logging

Velocious logs database queries by default at `info` level using Rails-style query names and elapsed time:

```text
Task Load (1.9ms)  SELECT `tasks`.* FROM `tasks` WHERE `tasks`.`id` = 1 LIMIT 1
  ↳ src/routes/tasks/controller.js:12:in show
```

Model-backed reads use names such as `Task Load`, `Task Count`, and `Task Pluck`. Model writes use names such as `Task Create`, `Task Update`, and `Task Destroy`. Raw `db.query(...)` calls use `SQL`.

The source arrow is included only when Velocious can identify application code. Dependency and framework frames, including `node_modules`, are filtered out; if no application frame is available, Velocious logs only the timed SQL line.

Query logs use the same configured logger outputs as other Velocious logs. Disable them by changing your logging outputs or levels so `info` logs are not emitted.

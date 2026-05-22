# Translations

Backend records can declare translated attributes with `translates(...)`:

```js
import Record from "velocious/build/src/database/record/index.js"

class TaskType extends Record {
}

TaskType.translates("name")
```

`translates(...)` defines the `translations` collection and a `currentTranslation` `hasOne` relationship. `currentTranslation` picks the first available row from the configuration's current locale fallback order and can be used anywhere normal relationships can be joined or preloaded:

```js
const taskTypes = await TaskType
  .preload("currentTranslation")
  .joins("currentTranslation")
  .order({currentTranslation: [["name", "asc"]]})
  .toArray()
```

Frontend-model index requests that sort by a translated attribute use `currentTranslation` internally. This keeps `TaskType.order("name")` or `TaskType.ransack({s: "name asc"})` ordered by the visible fallback-aware value without joining every translation row.

Translated attribute serialization still preloads `translations` when the selected payload needs the translated value, so model methods such as `name()` can use the configured locale fallbacks.

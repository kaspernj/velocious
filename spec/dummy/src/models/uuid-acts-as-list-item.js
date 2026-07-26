import UuidActsAsListItemBase from "../model-bases/uuid-acts-as-list-item.js"

export default class UuidActsAsListItem extends UuidActsAsListItemBase {}

UuidActsAsListItem.actsAsList("position", {scope: "scopeId"})

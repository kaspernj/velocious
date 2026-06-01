// @ts-check

import ActsAsListItemBase from "../model-bases/acts-as-list-item.js"

export default class ActsAsListItem extends ActsAsListItemBase {}

ActsAsListItem.belongsTo("project")
ActsAsListItem.actsAsList("position", {scope: "projectId"})

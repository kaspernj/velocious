import UuidItemBase from "../model-bases/uuid-item.js"

class UuidItem extends UuidItemBase {
}

UuidItem.hasMany("uuidInteractions", {className: "UuidInteraction", foreignKey: "subject_id", polymorphic: true})

export default UuidItem

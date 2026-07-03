import UuidItemBase from "../model-bases/uuid-item.js"

class UuidItem extends UuidItemBase {
}

UuidItem.hasMany("uuidInteractions", {className: "UuidInteraction", foreignKey: "subject_id", polymorphic: true})

// MSSQL stores uuid columns as varchar(36), so the cast keeps the effective
// column type (and writable-attribute inference) driver-uniform.
UuidItem.attribute("id", "uuid")

export default UuidItem

import DatabaseRecord from "../../../../src/database/record/index.js"

class UuidItem extends DatabaseRecord {}

UuidItem.hasMany("uuidInteractions", {className: "UuidInteraction", foreignKey: "subject_id", polymorphic: true})

export default UuidItem

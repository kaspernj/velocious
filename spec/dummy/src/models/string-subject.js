import DatabaseRecord from "../../../../src/database/record/index.js"

class StringSubject extends DatabaseRecord {}

StringSubject.hasMany("stringSubjectInteractions", {className: "StringSubjectInteraction", foreignKey: "subject_id", polymorphic: true})

export default StringSubject

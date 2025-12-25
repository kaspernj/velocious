import StringSubjectBase from "../model-bases/string-subject.js"

class StringSubject extends StringSubjectBase {
}

StringSubject.hasMany("stringSubjectInteractions", {className: "StringSubjectInteraction", foreignKey: "subject_id", polymorphic: true})

export default StringSubject

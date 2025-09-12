import Record from "../../../../src/database/record/index.js"

class AuthenticationToken extends Record {
}

AuthenticationToken.belongsTo("user")

export default AuthenticationToken

import AuthenticationTokenBase from "../model-bases/authentication-token.js"

class AuthenticationToken extends AuthenticationTokenBase {
}

AuthenticationToken.belongsTo("user")

export default AuthenticationToken

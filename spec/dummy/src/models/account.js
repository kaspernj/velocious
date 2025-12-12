import AccountBase from "../model-bases/account.js"

class Account extends AccountBase {
}

Account.setDatabaseIdentifier("mssql")

export default Account

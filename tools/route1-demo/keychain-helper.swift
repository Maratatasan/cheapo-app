import Foundation
import Security
import Darwin

// Credentials enter/leave only through pipes owned by the companion process.
// Default macOS Keychain access controls are retained; no all-apps ACL is added.
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "lock" {
    let descriptor = open(CommandLine.arguments[2], O_RDWR | O_CREAT, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 && flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { exit(75) }
    FileHandle.standardOutput.write(Data("locked\n".utf8))
    _ = FileHandle.standardInput.readDataToEndOfFile()
    close(descriptor)
    exit(0)
}
func fail(_ status: OSStatus) -> Never {
    FileHandle.standardError.write(Data("Keychain operation failed (\(status)).\n".utf8))
    exit(1)
}
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 131072,
      let request = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
      let operation = request["operation"] as? String,
      let account = request["account"] as? String, !account.isEmpty else { exit(64) }
let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,
    kSecAttrService as String:"com.cheapo.local-companion",
    kSecAttrAccount as String:account]
var value: Any = NSNull()
switch operation {
case "read":
    var read = query
    read[kSecReturnData as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(read as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data, let string = String(data:data,encoding:.utf8) { value = string }
    else if status != errSecItemNotFound { fail(status) }
case "write":
    guard let secret = request["secret"] as? String else { exit(64) }
    let attributes = [kSecValueData as String:Data(secret.utf8)]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        var add = query
        add[kSecValueData as String] = Data(secret.utf8)
        status = SecItemAdd(add as CFDictionary,nil)
    }
    if status != errSecSuccess { fail(status) }
case "delete":
    let status = SecItemDelete(query as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound { fail(status) }
default: exit(64)
}
let output = try JSONSerialization.data(withJSONObject:["value":value])
FileHandle.standardOutput.write(output)

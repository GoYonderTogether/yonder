// Public Security.framework only. Apache-2.0. Values use anonymous pipes.
import Foundation
import Security
import LocalAuthentication
let args = CommandLine.arguments
if args.count != 4 || !args[2].hasPrefix("org.goyonder.clipboard.") || UUID(uuidString: args[3]) == nil { exit(64) }
let context = LAContext()
context.interactionNotAllowed = true
var query: [String: Any] = [
 kSecClass as String: kSecClassGenericPassword,
 kSecAttrService as String: args[2],
 kSecAttrAccount as String: args[3],
 kSecUseAuthenticationContext as String: context
]
var status: OSStatus = errSecParam
switch args[1] {
case "put":
 let value = FileHandle.standardInput.readDataToEndOfFile()
 if value.count == 0 || value.count > 65536 { exit(64) }
 query[kSecValueData as String] = value
 query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
 status = SecItemAdd(query as CFDictionary, nil)
case "get":
 query[kSecReturnData as String] = true
 query[kSecMatchLimit as String] = kSecMatchLimitOne
 var result: CFTypeRef?
 status = SecItemCopyMatching(query as CFDictionary, &result)
 if status == errSecSuccess, let data = result as? Data { FileHandle.standardOutput.write(data) }
case "drop":
 status = SecItemDelete(query as CFDictionary)
 if status == errSecItemNotFound { status = errSecSuccess }
default: exit(64)
}
// Never print the OS error string or item data; the caller receives a safe code.
if status != errSecSuccess { exit(status == errSecItemNotFound ? 66 : 77) }

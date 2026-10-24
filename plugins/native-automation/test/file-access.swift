// Standalone ordinary-temp-file tests. Does NOT run the app, launcher or TCC APIs.
import Foundation
import Darwin

@main struct FileAccessTests {
    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let source = root.appendingPathComponent("source.bin").path
        let output = root.appendingPathComponent("output.bin").path
        let bytes = Data((0..<(2 * 1024 * 1024 + 17)).map { UInt8($0 % 251) })
        try bytes.write(to: URL(fileURLWithPath: source))
        try fm.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1700000000)], ofItemAtPath: source)
        let symlink = root.appendingPathComponent("link").path
        try fm.createSymbolicLink(atPath: symlink, withDestinationPath: source)
        var passed = 0
        errno = EPERM
        let denied = HelperFiles.osError("read source")
        precondition(denied.domain == NSPOSIXErrorDomain && denied.code == 1 && denied.localizedDescription.contains("errno 1")); passed += 1
        func reject(_ args: [String: Any], _ contains: String? = nil) throws {
            do { _ = try HelperFiles.run(args, cancelled: {}); fatalError("Expected failure: \(args)") }
            catch { if let contains { precondition(String(describing: error).contains(contains), "\(error)") }; passed += 1 }
        }
        for path in ["relative", "", "/tmp/../x", "/tmp/\0x"] { try reject(["action": "file-list", "path": path]) }
        try reject(["action": "file-export", "path": root.path, "destination": output])
        try reject(["action": "file-export", "path": symlink, "destination": output])
        try reject(["action": "file-list", "path": source])
        let directoryLink = root.appendingPathComponent("dir-link").path
        try fm.createSymbolicLink(atPath: directoryLink, withDestinationPath: root.path)
        for suffix in ["", "/", "/."] { try reject(["action": "file-list", "path": directoryLink + suffix]) }
        try reject(["action": "file-list", "path": root.appendingPathComponent("absent").path], "errno 2")
        let listing = try HelperFiles.run(["action": "file-list", "path": root.path], cancelled: {})
        let entries = listing["entries"] as! [[String: Any]]
        precondition(entries.count == 3 && entries.first { $0["name"] as? String == "link" }?["type"] as? String == "symlink"); passed += 1
        let exported = try HelperFiles.run(["action": "file-export", "path": source, "destination": output], cancelled: {})
        precondition(exported["path"] as? String == output && exported["size"] as? Int64 == Int64(bytes.count)); passed += 1
        let exportedMetadata = exported["metadata"] as! [String: Any]
        precondition(exportedMetadata["name"] as? String == "source.bin" && exportedMetadata["size"] as? Int64 == Int64(bytes.count)); passed += 1
        let copied = try Data(contentsOf: URL(fileURLWithPath: output))
        precondition(copied == bytes); passed += 1
        let original = try fm.attributesOfItem(atPath: source), copy = try fm.attributesOfItem(atPath: output)
        for key in [FileAttributeKey.creationDate, .modificationDate, .posixPermissions, .size] {
            precondition((original[key] as! NSObject).isEqual(copy[key])); passed += 1
        }
        try reject(["action": "file-export", "path": source, "destination": output], "errno 17")
        let unchangedOutput = try Data(contentsOf: URL(fileURLWithPath: output))
        precondition(unchangedOutput == bytes); passed += 1
        let cancelledOutput = root.appendingPathComponent("cancelled.bin").path
        var calls = 0
        do {
            _ = try HelperFiles.run(["action": "file-export", "path": source, "destination": cancelledOutput]) {
                calls += 1
                if calls == 5 { throw HelperFiles.invalid("cancelled test") }
            }
            fatalError("Cancellation must throw")
        } catch { precondition(!fm.fileExists(atPath: cancelledOutput)); passed += 1 }
        let unchangedSource = try Data(contentsOf: URL(fileURLWithPath: source))
        precondition(unchangedSource == bytes); passed += 1
        print("FileAccess: \(passed) passed, 0 failed; temporary ordinary files only")
    }
}

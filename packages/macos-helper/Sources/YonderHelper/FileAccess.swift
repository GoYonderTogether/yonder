import Foundation
import Darwin

// No permission probes/prompts here: the OS decides access for this process.
enum HelperFiles {
    static func invalid(_ message: String) -> NSError {
        NSError(domain: "YonderHelper.Files", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    static func osError(_ operation: String) -> NSError {
        let code = errno
        return NSError(domain: NSPOSIXErrorDomain, code: Int(code), userInfo: [NSLocalizedDescriptionKey: "\(operation): errno \(code) (\(String(cString: strerror(code))))"])
    }
    static func path(_ value: Any?) throws -> String {
        guard let path = value as? String, path.hasPrefix("/"), !path.utf8.contains(0),
              !path.split(separator: "/").contains("..") else { throw invalid("Expected absolute path without NUL or ..") }
        return "/" + path.split(separator: "/").filter { $0 != "." }.joined(separator: "/")
    }
    static func metadata(_ name: String, _ info: stat) -> [String: Any] {
        let kind = info.st_mode & S_IFMT
        let type = kind == S_IFLNK ? "symlink" : kind == S_IFREG ? "file" : kind == S_IFDIR ? "directory" : "other"
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func date(_ t: timespec) -> String { formatter.string(from: Date(timeIntervalSince1970: Double(t.tv_sec) + Double(t.tv_nsec) / 1e9)) }
        return ["name": name, "type": type, "size": info.st_size,
                "creationDate": date(info.st_birthtimespec), "modificationDate": date(info.st_mtimespec)]
    }
    static func run(_ args: [String: Any], cancelled: () throws -> Void) throws -> [String: Any] {
        try cancelled()
        let source = try path(args["path"])
        let action = args["action"] as? String
        let fd = open(source, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard fd >= 0 else { throw osError("open source (symlinks are not followed)") }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0 else { throw osError("stat source") }
        if action == "file-list" {
            guard info.st_mode & S_IFMT == S_IFDIR else { throw invalid("file-list requires a directory, not a symlink or file") }
            // fdopendir owns its duplicate and never follows listed symlink entries.
            guard let dir = fdopendir(dup(fd)) else { throw osError("open directory") }
            defer { closedir(dir) }
            var entries = [[String: Any]]()
            while true {
                try cancelled()
                errno = 0
                guard let entry = readdir(dir) else {
                    if errno != 0 { throw osError("read directory") }
                    break
                }
                let name = withUnsafePointer(to: &entry.pointee.d_name) {
                    $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(cString: $0) }
                }
                if name == "." || name == ".." { continue }
                var child = stat()
                guard fstatat(fd, name, &child, AT_SYMLINK_NOFOLLOW) == 0 else { throw osError("stat directory entry") }
                entries.append(metadata(name, child))
            }
            return ["path": source, "entries": entries.sorted { ($0["name"] as! String) < ($1["name"] as! String) }]
        }
        guard action == "file-export" else { throw invalid("Unknown file action") }
        guard info.st_mode & S_IFMT == S_IFREG else { throw invalid("file-export requires one regular file; directories and special files are not exported") }
        let destination = try path(args["destination"])
        try cancelled()
        let out = open(destination, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard out >= 0 else { throw osError("create artifact (no overwrite)") }
        var complete = false
        defer { close(out); if !complete { unlink(destination) } }
        var buffer = [UInt8](repeating: 0, count: 1024 * 1024)
        var size: Int64 = 0
        while true {
            try cancelled()
            let count = read(fd, &buffer, buffer.count)
            guard count >= 0 else { throw osError("read source") }
            if count == 0 { break }
            try buffer.withUnsafeBytes { bytes in
                var offset = 0
                while offset < count {
                    try cancelled()
                    let written = write(out, bytes.baseAddress!.advanced(by: offset), count - offset)
                    guard written > 0 else { throw osError("write artifact") }
                    offset += written
                }
            }
            size += Int64(count)
        }
        var after = stat()
        guard fstat(fd, &after) == 0 else { throw osError("stat source after export") }
        guard size == info.st_size, after.st_size == info.st_size, after.st_mtimespec.tv_sec == info.st_mtimespec.tv_sec, after.st_mtimespec.tv_nsec == info.st_mtimespec.tv_nsec else { throw invalid("Source changed during export") }
        guard fcopyfile(fd, out, nil, copyfile_flags_t(COPYFILE_METADATA)) == 0 else { throw osError("preserve source metadata") }
        try cancelled()
        complete = true
        return ["path": destination, "size": size, "metadata": metadata(URL(fileURLWithPath: source).lastPathComponent, info)]
    }
}

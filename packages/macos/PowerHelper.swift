import Foundation
import Darwin
import IOKit.pwr_mgt

// No caller-controlled executable, command, path or pmset arguments cross this boundary.
final class PowerLease {
    var leases: [Int32: Int] = [:]
    var active: Int { leases.values.reduce(0, +) }
    func update(_ fd: Int32, _ count: Int?) { leases[fd] = count }
}

@main struct PowerHelper {
    static let socketPath = "/var/run/dev.yonder.power.sock"
    static let journal = "/var/run/dev.yonder.power.restore"
    static let lock = NSLock()
    static let leases = PowerLease()
    static var assertion: IOPMAssertionID = 0
    static var failure: String?

    static func pmset(_ args: [String]) throws -> String {
        // A socket handler stays alive for hours: drain Foundation's autoreleased process objects per call.
        return try autoreleasepool {
            let process = Process(), pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
            process.arguments = args; process.standardInput = FileHandle.nullDevice
            process.standardOutput = pipe; process.standardError = pipe
            defer { try? pipe.fileHandleForReading.close(); try? pipe.fileHandleForWriting.close() }
            try process.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw NSError(domain: "pmset", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: String(decoding: data, as: UTF8.self)]) }
            return String(decoding: data, as: UTF8.self)
        }
    }
    static func sleepDisabled() throws -> Bool {
        for line in try pmset(["-g"]).split(separator: "\n") {
            let fields = line.split(whereSeparator: { $0.isWhitespace })
            if fields.first == "SleepDisabled", fields.count == 2 {
                if fields[1] == "1" { return true }; if fields[1] == "0" { return false }
            }
        }
        throw NSError(domain: "YonderPower", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法读取系统睡眠状态"])
    }
    static func restore() throws {
        if FileManager.default.fileExists(atPath: journal) {
            _ = try pmset(["-a", "disablesleep", "0"])
            guard try !sleepDisabled() else { throw NSError(domain: "YonderPower", code: 2) }
            try FileManager.default.removeItem(atPath: journal)
        }
    }
    static func reconcile() -> [String: Any] {
        do {
            if leases.active > 0 {
                if assertion == 0 {
                    let result = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn), "Yonder active tasks" as CFString, &assertion)
                    guard result == kIOReturnSuccess else { throw NSError(domain: "IOPM", code: Int(result)) }
                }
                if try !sleepDisabled() {
                    try Data("restore-to-zero\n".utf8).write(to: URL(fileURLWithPath: journal), options: .atomic)
                    chmod(journal, 0o600)
                    _ = try pmset(["-a", "disablesleep", "1"])
                }
                guard try sleepDisabled() else { throw NSError(domain: "YonderPower", code: 3) }
            } else {
                if assertion != 0 { IOPMAssertionRelease(assertion); assertion = 0 }
                try restore()
            }
            failure = nil
            return ["protocol": 2, "active": leases.active, "protected": leases.active > 0, "systemSleepDisabled": try sleepDisabled()]
        } catch {
            failure = error.localizedDescription
            return ["protocol": 2, "active": leases.active, "protected": false, "error": error.localizedDescription]
        }
    }
    static func handle(_ fd: Int32, _ uid: uid_t) {
        defer {
            lock.lock(); leases.update(fd, nil); _ = reconcile(); lock.unlock(); Darwin.close(fd)
        }
        var peer: uid_t = 0, group: gid_t = 0
        guard getpeereid(fd, &peer, &group) == 0, peer == uid else { return }
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var buffer = [UInt8](repeating: 0, count: 256), pending = Data()
        while true {
            let n = recv(fd, &buffer, buffer.count, 0)
            guard n > 0 else { return }
            pending.append(contentsOf: buffer.prefix(n))
            guard pending.count <= 256 else { return }
            while let end = pending.firstIndex(of: 10) {
                let line = pending[..<end]; pending.removeSubrange(...end)
                guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                      let count = object["active"] as? Int, (0...100000).contains(count), object.count == 1 else { return }
                lock.lock(); leases.update(fd, count); let state = reconcile(); lock.unlock()
                guard var data = try? JSONSerialization.data(withJSONObject: state) else { return }
                data.append(10)
                let sent = data.withUnsafeBytes { send(fd, $0.baseAddress, data.count, 0) }
                if sent != data.count { return }
            }
        }
    }
    static func main() {
        if CommandLine.arguments.contains("--check") {
            let state = PowerLease(); state.update(1, 2); state.update(2, 1); precondition(state.active == 3)
            state.update(1, nil); precondition(state.active == 1); state.update(2, 0); precondition(state.active == 0)
            for _ in 0..<8 { _ = try! pmset(["-g"]) }
            let before = (0..<1024).filter { fcntl(Int32($0), F_GETFD) >= 0 }.count
            for _ in 0..<64 { _ = try! pmset(["-g"]) }
            let after = (0..<1024).filter { fcntl(Int32($0), F_GETFD) >= 0 }.count
            precondition(after <= before, "pmset leaked file descriptors: \(before) -> \(after)")
            print("Passed: concurrent power leases and 64 repeated pmset calls without descriptor growth (\(before) -> \(after))."); return
        }
        guard geteuid() == 0, CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--serve", let uid = uid_t(CommandLine.arguments[2]), uid > 0 else { exit(64) }
        signal(SIGPIPE, SIG_IGN)
        do { try restore() } catch { fputs("Power restore failed: \(error)\n", stderr); exit(1) }
        let server = socket(AF_UNIX, SOCK_STREAM, 0); guard server >= 0 else { exit(1) }
        unlink(socketPath)
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(socketPath.utf8CString)
        withUnsafeMutableBytes(of: &address.sun_path) { target in bytes.withUnsafeBytes { target.copyBytes(from: $0) } }
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(server, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        guard bound == 0, chmod(socketPath, 0o666) == 0, listen(server, 16) == 0 else { exit(1) }
        signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
        let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        term.setEventHandler { lock.lock(); leases.leases.removeAll(); _ = reconcile(); lock.unlock(); exit(0) }; term.resume()
        while true {
            let fd = accept(server, nil, nil)
            if fd >= 0 { DispatchQueue.global().async { handle(fd, uid) } }
            else if errno != EINTR { exit(1) }
        }
    }
}

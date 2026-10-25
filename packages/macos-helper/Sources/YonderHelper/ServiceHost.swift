import Foundation
import Darwin

// No AppKit, permission probes or prompts on this path. The socket is a lifetime
// lease, not a second service manager: launchd still owns the foreground launcher.
enum HelperServiceHost {
    struct Member: Codable { let pid: Int32; let seconds: UInt64; let micros: UInt64 }
    struct Launch: Codable {
        let launcherPid: Int32
        let program: String
        let arguments: [String]
        let environment: [String: String]
        let cwd: String
        let log: String
        let lock: String
    }
    static func member(_ pid: Int32) -> Member? {
        var info = proc_bsdinfo()
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size)) > 0 else { return nil }
        return Member(pid: pid, seconds: info.pbi_start_tvsec, micros: info.pbi_start_tvusec)
    }
    static func same(_ item: Member) -> Bool {
        guard let current = member(item.pid) else { return false }
        return current.seconds == item.seconds && current.micros == item.micros
    }
    static func collect(_ pid: Int32, _ members: inout [Int32: Member]) {
        var children = [Int32](repeating: 0, count: 4096)
        let count = proc_listchildpids(pid, &children, Int32(children.count * MemoryLayout<Int32>.size))
        guard count > 0 else { return }
        for child in children.prefix(Int(count)) where child > 1 {
            if let item = member(child) { members[child] = item; collect(child, &members) }
        }
    }
    static func cleanup(_ members: [Member], group: Int32, pinnedGroup: Bool = false) {
        // A waitable root pins its PID/PGID until waitpid. Emergency cleanup may
        // only use a still-matching member in that group as its identity anchor.
        func anchored() -> Bool {
            group > 1 && (pinnedGroup || members.contains { same($0) && getpgid($0.pid) == group })
        }
        if anchored() { kill(-group, SIGTERM) }
        for item in members where same(item) { kill(item.pid, SIGTERM) }
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline && (anchored() || members.contains(where: same)) { usleep(50_000) }
        if anchored() { kill(-group, SIGKILL) }
        for item in members where same(item) { kill(item.pid, SIGKILL) }
    }
    static func sendFrame(_ socket: Int32, _ data: Data) throws {
        // A partial frame must be completed before another frame is sent. Bound
        // backpressure so an unresponsive launcher cannot prevent child cleanup.
        let deadline = DispatchTime.now().uptimeNanoseconds + 1_000_000_000
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let sent = send(socket, bytes.baseAddress!.advanced(by: offset), bytes.count - offset, 0)
                if sent > 0 { offset += sent; continue }
                if sent < 0 && errno == EINTR { continue }
                guard sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK),
                    DispatchTime.now().uptimeNanoseconds < deadline else { throw hostError("Lease write failed or timed out") }
                var descriptor = pollfd(fd: socket, events: Int16(POLLOUT), revents: 0)
                _ = poll(&descriptor, 1, 50)
            }
        }
    }
    static func run(_ args: [String]) -> Int32 {
        do {
            if args.count == 2 && args[0] == "service-cleanup" {
                let members = try JSONDecoder().decode([Member].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
                cleanup(members, group: members.first?.pid ?? 0); return 0
            }
            guard args.count == 3, args[0] == "service-host" else { return 2 }
            let config = try JSONDecoder().decode(Launch.self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
            defer {
                // SIGKILL cannot run the launcher's finally block. Remove its
                // private transport/config only after its PID is actually gone.
                let directory = URL(fileURLWithPath: args[2]).deletingLastPathComponent()
                if kill(config.launcherPid, 0) != 0 && errno == ESRCH &&
                    directory.path.hasPrefix("/tmp/yonder-service-") &&
                    URL(fileURLWithPath: args[1]).deletingLastPathComponent() == directory {
                    try? FileManager.default.removeItem(at: directory)
                }
            }
            let lock = open(config.lock, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
            guard lock >= 0 else { throw hostError("Cannot open service lock") }
            defer { close(lock) }
            guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { throw hostError("Service host already running") }
            let socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
            guard socket >= 0 else { throw hostError("Cannot create lease") }
            defer { close(socket) }
            var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
            let path = Array(args[1].utf8CString)
            guard path.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw hostError("Lease path too long") }
            withUnsafeMutableBytes(of: &address.sun_path) { target in path.withUnsafeBytes { target.copyBytes(from: $0) } }
            let connected = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(socket, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
            guard connected == 0 else { throw hostError("Launcher lease unavailable") }
            _ = fcntl(socket, F_SETFD, FD_CLOEXEC)
            _ = fcntl(socket, F_SETFL, O_NONBLOCK)
            signal(SIGPIPE, SIG_IGN)
            // Dispatch sources keep all mutable lifecycle state on this thread.
            signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
            let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
            let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
            // Signal handlers shut down the lease; recv below observes EOF.
            term.setEventHandler { shutdown(socket, SHUT_RDWR) }; interrupt.setEventHandler { shutdown(socket, SHUT_RDWR) }
            term.resume(); interrupt.resume()
            defer { term.cancel(); interrupt.cancel() }
            var actions: posix_spawn_file_actions_t?; posix_spawn_file_actions_init(&actions)
            defer { posix_spawn_file_actions_destroy(&actions) }
            posix_spawn_file_actions_addchdir_np(&actions, config.cwd)
            posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
            posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, config.log, O_WRONLY | O_APPEND | O_CREAT, 0o600)
            posix_spawn_file_actions_adddup2(&actions, STDOUT_FILENO, STDERR_FILENO)
            var attributes: posix_spawnattr_t?; posix_spawnattr_init(&attributes)
            defer { posix_spawnattr_destroy(&attributes) }
            posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK))
            posix_spawnattr_setpgroup(&attributes, 0)
            var defaults = sigset_t(); sigemptyset(&defaults); sigaddset(&defaults, SIGTERM); sigaddset(&defaults, SIGINT); sigaddset(&defaults, SIGPIPE)
            var mask = sigset_t(); sigemptyset(&mask)
            posix_spawnattr_setsigdefault(&attributes, &defaults); posix_spawnattr_setsigmask(&attributes, &mask)
            let argv = ([config.program] + config.arguments).map { strdup($0) } + [nil]
            let env = config.environment.map { strdup("\($0.key)=\($0.value)") } + [nil]
            defer { for item in argv + env { free(item) } }
            var pid: Int32 = 0
            let result = argv.withUnsafeBufferPointer { av in env.withUnsafeBufferPointer { ev in
                posix_spawn(&pid, config.program, &actions, &attributes, av.baseAddress!, ev.baseAddress!)
            } }
            guard result == 0 else { throw hostError("Node spawn failed: \(result)") }
            func supervise() throws -> Int32 {
                var members: [Int32: Member] = [:]
                if let root = member(pid) { members[pid] = root }
                // Installed immediately after successful spawn, before encoding or
                // transport can throw. Root stays waitable through group cleanup.
                defer {
                    cleanup(Array(members.values), group: pid, pinnedGroup: true)
                    var status: Int32 = 0
                    while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
                }
                while true {
                    collect(pid, &members)
                    let snapshot = [members[pid]].compactMap { $0 } + members.values.filter { $0.pid != pid }
                    let message: [String: Any] = ["helperPid": getpid(), "nodePid": pid,
                        "members": try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot))]
                    try sendFrame(socket, JSONSerialization.data(withJSONObject: message) + Data([10]))
                    var byte: UInt8 = 0
                    let read = recv(socket, &byte, 1, 0)
                    if read == 0 { return 143 }
                    if read < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR {
                        throw hostError("Lease read failed")
                    }
                    var info = siginfo_t()
                    let waited = waitid(P_PID, id_t(pid), &info, WEXITED | WNOHANG | WNOWAIT)
                    if waited < 0 && errno != EINTR { throw hostError("Node wait failed") }
                    if waited == 0 && info.si_pid == pid {
                        return info.si_code == CLD_EXITED ? info.si_status : 128 + info.si_status
                    }
                    usleep(100_000)
                }
            }
            let code = try supervise()
            try? sendFrame(socket, Data("{\"exitCode\":\(code)}\n".utf8))
            return code
        } catch {
            FileHandle.standardError.write(Data("Service host: \(error.localizedDescription)\n".utf8)); return 1
        }
    }
    static func hostError(_ text: String) -> NSError { NSError(domain: "YonderServiceHost", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
}

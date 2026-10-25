import Foundation
import Darwin

// No AppKit or permission probes on the lifecycle path. Both owners retain
// identities, never naked PGIDs. The anchor is another mode of this executable,
// not an installed daemon. Helper -> anchor -> business root preserves ancestry.
enum HelperServiceHost {
    struct Member: Codable, Equatable { let pid: Int32; let seconds: UInt64; let micros: UInt64 }
    struct Launch: Codable {
        let launcherPid: Int32
        let program: String
        let arguments: [String]
        let environment: [String: String]
        let cwd: String
        let log: String
        let lock: String
    }
    struct State: Codable {
        let helper: Member
        let anchor: Member
        var members: [Member]
        var registered: [Member]? = nil
        var registering: Member? = nil
        var helperPid: Int32 { helper.pid }
    }
    static func bsd(_ pid: Int32) -> proc_bsdinfo? {
        var info = proc_bsdinfo()
        guard pid > 1, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size)) == MemoryLayout<proc_bsdinfo>.size else { return nil }
        return info
    }
    static func member(_ pid: Int32) -> Member? {
        guard let info = bsd(pid) else { return nil }
        return Member(pid: pid, seconds: info.pbi_start_tvsec, micros: info.pbi_start_tvusec)
    }
    static func same(_ item: Member) -> Bool { member(item.pid) == item }
    static func collect(_ pid: Int32, _ members: inout [Int32: Member]) {
        var children = [Int32](repeating: 0, count: 4096)
        let count = proc_listchildpids(pid, &children, Int32(children.count * MemoryLayout<Int32>.size))
        guard count > 0 else { return }
        for child in children.prefix(Int(count)) where child > 1 {
            if let item = member(child) { members[child] = item; collect(child, &members) }
        }
    }
    static func anchored(_ anchor: Member) -> Bool { same(anchor) && getpgid(anchor.pid) == anchor.pid }
    static func cleanup(_ members: [Member], anchor: Member) {
        // TERM leaves the anchor alive, even after the business root has exited.
        // Recheck its start time AND PGID before each group signal, including the
        // final KILL. No signal is sent to a cached PGID after identity is lost.
        if anchored(anchor) { kill(-anchor.pid, SIGTERM) }
        for item in members where item != anchor && same(item) { kill(item.pid, SIGTERM) }
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline && (anchored(anchor) || members.contains(where: same)) { usleep(50_000) }
        if anchored(anchor) { kill(-anchor.pid, SIGKILL) }
        for item in members where item != anchor && same(item) { kill(item.pid, SIGKILL) }
    }
    static func sendFrame(_ socket: Int32, _ data: Data) throws {
        let deadline = DispatchTime.now().uptimeNanoseconds + 1_000_000_000
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let sent = send(socket, bytes.baseAddress!.advanced(by: offset), bytes.count - offset, 0)
                if sent > 0 { offset += sent; continue }
                if sent < 0 && errno == EINTR { continue }
                guard sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK), DispatchTime.now().uptimeNanoseconds < deadline else { throw hostError("Lease write failed or timed out") }
                var descriptor = pollfd(fd: socket, events: Int16(POLLOUT), revents: 0)
                _ = poll(&descriptor, 1, 50)
            }
        }
    }
    static func sendJSON<T: Encodable>(_ fd: Int32, _ value: T) throws { try sendFrame(fd, JSONEncoder().encode(value) + Data([10])) }
    final class Frames {
        var buffer = Data()
        var eof = false
        func read(_ fd: Int32) throws -> [[String: Any]] {
            var bytes = [UInt8](repeating: 0, count: 16384)
            while true {
                let n = recv(fd, &bytes, bytes.count, 0)
                if n > 0 { buffer.append(contentsOf: bytes.prefix(n)); guard buffer.count <= 1_048_576 else { throw hostError("Lease frame too large") } }
                else if n == 0 { eof = true; break }
                else if errno == EINTR { continue }
                else if errno == EAGAIN || errno == EWOULDBLOCK { break }
                else { throw hostError("Lease read failed") }
            }
            var result: [[String: Any]] = []
            while let end = buffer.firstIndex(of: 10) {
                let data = buffer.prefix(upTo: end); buffer.removeSubrange(...end)
                guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw hostError("Invalid lease frame") }
                result.append(object)
            }
            return result
        }
    }
    static func nonblocking(_ fd: Int32) { _ = fcntl(fd, F_SETFD, FD_CLOEXEC); _ = fcntl(fd, F_SETFL, O_NONBLOCK) }
    static func spawn(_ program: String, _ arguments: [String], _ config: Launch, group: Bool, channel: Int32? = nil, environment: [String: String]? = nil) throws -> Int32 {
        var actions: posix_spawn_file_actions_t?; posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_addchdir_np(&actions, config.cwd)
        posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, config.log, O_WRONLY | O_APPEND | O_CREAT, 0o600)
        posix_spawn_file_actions_adddup2(&actions, STDOUT_FILENO, STDERR_FILENO)
        if let channel { posix_spawn_file_actions_adddup2(&actions, channel, 3) }
        var attributes: posix_spawnattr_t?; posix_spawnattr_init(&attributes)
        defer { posix_spawnattr_destroy(&attributes) }
        var flags = POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK
        if group { flags |= POSIX_SPAWN_SETPGROUP; posix_spawnattr_setpgroup(&attributes, 0) }
        posix_spawnattr_setflags(&attributes, Int16(flags))
        var defaults = sigset_t(); sigemptyset(&defaults)
        for signal in [SIGTERM, SIGINT, SIGPIPE] { sigaddset(&defaults, signal) }
        var mask = sigset_t(); sigemptyset(&mask)
        posix_spawnattr_setsigdefault(&attributes, &defaults); posix_spawnattr_setsigmask(&attributes, &mask)
        let argv = ([program] + arguments).map { strdup($0) } + [nil]
        let env = (environment ?? config.environment).map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { for item in argv + env { free(item) } }
        var pid: Int32 = 0
        let result = argv.withUnsafeBufferPointer { av in env.withUnsafeBufferPointer { ev in
            posix_spawn(&pid, program, &actions, &attributes, av.baseAddress!, ev.baseAddress!)
        } }
        guard result == 0 else { throw hostError("Process spawn failed: \(result)") }
        return pid
    }
    static func wait(_ pid: Int32) { var status: Int32 = 0; while waitpid(pid, &status, 0) < 0 && errno == EINTR {} }
    static func groupAnchor(_ path: String, registration: String) throws -> Int32 {
        let fd: Int32 = 3
        nonblocking(fd); signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGPIPE, SIG_IGN)
        guard let own = member(getpid()), anchored(own) else { throw hostError("Anchor is not group leader") }
        let config = try JSONDecoder().decode(Launch.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let frames = Frames()
        try sendJSON(fd, ["anchor": own])
        var started = false
        let deadline = Date().addingTimeInterval(10)
        while !started {
            for frame in try frames.read(fd) {
                if frame["start"] as? Bool == true { started = true }
            }
            if frames.eof { return 143 } // No business process can exist before both ACKs.
            guard Date() < deadline else { throw hostError("Anchor registration ACK timed out") }
            if !started { usleep(20_000) }
        }
        var environment = config.environment
        environment["YONDER_SERVICE_REGISTRATION"] = registration
        let pid = try spawn(config.program, config.arguments, config, group: false, environment: environment)
        // Any channel failure after spawn must clean this group, never abandon it.
        defer { cleanup([], anchor: own) }
        try sendJSON(fd, ["nodePid": pid])
        var reported = false
        while true {
            _ = try frames.read(fd)
            if frames.eof { return 143 }
            if !reported {
                var info = siginfo_t()
                let result = waitid(P_PID, id_t(pid), &info, WEXITED | WNOHANG | WNOWAIT)
                guard result == 0 || errno == EINTR else { throw hostError("Node wait failed") }
                if result == 0 && info.si_pid == pid {
                    try sendJSON(fd, ["exitCode": info.si_code == CLD_EXITED ? info.si_status : 128 + info.si_status])
                    reported = true // Keep root waitable AND anchor alive until final group KILL.
                }
            }
            usleep(20_000)
        }
    }
    static func object<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) }
    static func verified(_ state: State) -> Bool {
        same(state.helper) && anchored(state.anchor) && bsd(state.anchor.pid)?.pbi_ppid == UInt32(state.helper.pid)
    }
    static func descendant(_ candidate: Member, of roots: [Member]) -> Bool {
        guard same(candidate) else { return false }
        var current = candidate.pid
        var visited = Set<Int32>()
        var links: [(Member, Member)] = []
        for _ in 0..<1024 {
            guard visited.insert(current).inserted, let child = member(current), let info = bsd(current), info.pbi_ppid > 1,
                  let parent = member(Int32(info.pbi_ppid)),
                  parent.seconds < child.seconds || (parent.seconds == child.seconds && parent.micros <= child.micros) else { return false }
            links.append((child, parent))
            if roots.contains(parent) {
                // Recheck every link, not just the endpoints: an intermediate
                // parent exiting/reusing its PID must not fabricate ancestry.
                return same(candidate) && links.allSatisfy { same($0.0) && same($0.1) && bsd($0.0.pid)?.pbi_ppid == UInt32($0.1.pid) }
            }
            current = parent.pid
        }
        return false
    }
    final class Registration {
        let fd: Int32
        let peer: Member?
        let frames = Frames()
        let deadline = Date().addingTimeInterval(4)
        var candidate: Member?
        init(_ fd: Int32) {
            self.fd = fd
            var pid: Int32 = 0, uid: uid_t = 0, gid: gid_t = 0
            var size = socklen_t(MemoryLayout<Int32>.size)
            if getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) == 0,
               getpeereid(fd, &uid, &gid) == 0, uid == geteuid() { peer = member(pid) }
            else { peer = nil }
        }
    }
    static func registrationListener(_ path: String) throws -> Int32 {
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw hostError("Cannot create registration socket") }
        do {
            var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
            let bytes = Array(path.utf8CString)
            guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw hostError("Registration path too long") }
            withUnsafeMutableBytes(of: &address.sun_path) { target in bytes.withUnsafeBytes { target.copyBytes(from: $0) } }
            let result = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
            guard result == 0, chmod(path, 0o600) == 0, listen(fd, 16) == 0 else { throw hostError("Cannot bind registration socket") }
            nonblocking(fd); return fd
        } catch { close(fd); throw error }
    }
    static func acceptRegistrations(_ listener: Int32, clients: inout [Registration]) {
        // Bound admission work so flooding cannot starve owner-death handling.
        for _ in 0..<16 {
            let fd = accept(listener, nil, nil)
            if fd < 0 { return }
            nonblocking(fd)
            if clients.count >= 64 { close(fd) }
            else { clients.append(Registration(fd)) }
        }
    }
    static func run(_ args: [String]) -> Int32 {
        do {
            signal(SIGPIPE, SIG_IGN)
            if args.count == 3 && args[0] == "service-group-anchor" { return try groupAnchor(args[1], registration: args[2]) }
            if args.count == 2 && ["service-cleanup", "service-verify-anchor", "service-verify-member"].contains(args[0]) {
                let state = try JSONDecoder().decode(State.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
                if args[0] == "service-verify-anchor" { guard verified(state) else { throw hostError("Anchor identity/ancestry changed") }; return 0 }
                if args[0] == "service-verify-member" {
                    guard verified(state), let candidate = state.registering, descendant(candidate, of: [state.anchor] + (state.registered ?? []).filter { $0 != candidate }) else { throw hostError("Registration identity/ancestry changed") }
                    return 0
                }
                cleanup(state.members, anchor: state.anchor); return 0
            }
            guard args.count == 3, args[0] == "service-host" else { return 2 }
            let config = try JSONDecoder().decode(Launch.self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
            defer {
                let directory = URL(fileURLWithPath: args[2]).deletingLastPathComponent()
                if kill(config.launcherPid, 0) != 0 && errno == ESRCH && directory.path.hasPrefix("/tmp/yonder-service-") && URL(fileURLWithPath: args[1]).deletingLastPathComponent() == directory {
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
            nonblocking(socket)
            signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
            let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
            let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
            term.setEventHandler { shutdown(socket, SHUT_RDWR) }; interrupt.setEventHandler { shutdown(socket, SHUT_RDWR) }
            term.resume(); interrupt.resume()
            defer { term.cancel(); interrupt.cancel() }
            var pair: [Int32] = [0, 0]
            guard socketpair(AF_UNIX, SOCK_STREAM, 0, &pair) == 0 else { throw hostError("Cannot create anchor channel") }
            nonblocking(pair[0]); nonblocking(pair[1])
            defer { close(pair[0]); close(pair[1]) }
            let executable = Bundle.main.executablePath ?? CommandLine.arguments[0]
            let registration = args[1] + ".register"
            let listener = try registrationListener(registration)
            defer { close(listener); unlink(registration) }
            let anchorPid = try spawn(executable, ["service-group-anchor", args[2], registration], config, group: true, channel: pair[1])
            close(pair[1]); pair[1] = -1
            var members: [Int32: Member] = [:]
            var anchor = member(anchorPid)
            var finalized = false
            defer {
                if !finalized, let anchor { cleanup(Array(members.values), anchor: anchor) }
                // If identity could not be read, close pre-start channel so the
                // still-waitable child exits without ever spawning business code.
                shutdown(pair[0], SHUT_RDWR)
                if !finalized { wait(anchorPid) }
            }
            let fromAnchor = Frames(), fromLauncher = Frames()
            var clients: [Registration] = []
            var registered: [Member] = []
            defer { for client in clients { close(client.fd) } }
            let deadline = Date().addingTimeInterval(8)
            var announced = false, started = false
            var node: Int32?, code: Int32?
            guard let helper = member(getpid()) else { throw hostError("Cannot identify Helper") }
            while true {
                for frame in try fromAnchor.read(pair[0]) {
                    if let value = frame["anchor"] {
                        let actual = try JSONDecoder().decode(Member.self, from: JSONSerialization.data(withJSONObject: value))
                        guard actual.pid == anchorPid, same(actual), anchored(actual), bsd(anchorPid)?.pbi_ppid == UInt32(getpid()) else { throw hostError("Anchor handshake identity mismatch") }
                        anchor = actual; members[actual.pid] = actual; announced = true
                    }
                    if let value = frame["nodePid"] as? Int32 { node = value }
                    if let value = frame["exitCode"] as? Int32 { code = value }
                }
                guard let anchor, anchored(anchor), !fromAnchor.eof else { throw hostError("Group anchor failed") }
                collect(anchorPid, &members)
                // Admission is self-registration only. LOCAL_PEERPID binds the
                // request to its actual sender; no supplied target PID is accepted.
                if started {
                    acceptRegistrations(listener, clients: &clients)
                    for client in clients where client.candidate == nil {
                        do {
                            let requests = try client.frames.read(client.fd)
                            if let request = requests.first {
                                guard requests.count == 1, Set(request.keys) == Set(["register"]), request["register"] as? Bool == true,
                                      let peer = client.peer, descendant(peer, of: [anchor] + registered) else { throw hostError("Registration requires a live verified descendant") }
                                client.candidate = peer; members[peer.pid] = peer
                            }
                        } catch { client.frames.eof = true }
                    }
                    // Rejected, abandoned and stalled clients never block the
                    // service. A pending accepted identity remains owned even if
                    // a client disconnects before receiving its final ACK.
                    clients.removeAll { client in
                        if client.frames.eof || Date() >= client.deadline { close(client.fd); return true }
                        return false
                    }
                }
                if announced {
                    var state = State(helper: helper, anchor: anchor, members: [anchor] + members.values.filter { $0 != anchor })
                    state.registered = registered
                    state.registering = clients.compactMap { $0.candidate }.first
                    var message = try object(state) as! [String: Any]
                    message["helperPid"] = helper.pid; message["anchorPid"] = anchor.pid
                    message["awaitingAnchorAck"] = !started
                    if state.registering == nil { message["registering"] = NSNull() }
                    if let node { message["nodePid"] = node }
                    try sendFrame(socket, JSONSerialization.data(withJSONObject: message) + Data([10]))
                    for frame in try fromLauncher.read(socket) {
                        if !started, let value = frame["anchorAck"] {
                            let ack = try JSONDecoder().decode(Member.self, from: JSONSerialization.data(withJSONObject: value))
                            guard ack == anchor, verified(state) else { throw hostError("Invalid anchor ACK") }
                            try sendJSON(pair[0], ["start": true]); started = true
                        }
                        if let value = frame["memberAck"] {
                            let ack = try JSONDecoder().decode(Member.self, from: JSONSerialization.data(withJSONObject: value))
                            guard let client = clients.first(where: { $0.candidate == ack }), descendant(ack, of: [anchor] + registered) else { throw hostError("Invalid member ACK") }
                            if !registered.contains(ack) { registered.append(ack) }
                            // Only after BOTH registries contain this real identity
                            // may the caller detach or let its ancestor exit.
                            try? sendJSON(client.fd, ["registered": ack])
                            close(client.fd); clients.removeAll { $0 === client }
                        }
                    }
                } else { _ = try fromLauncher.read(socket) }
                if fromLauncher.eof { return 143 }
                if !started && Date() >= deadline { throw hostError("Launcher anchor registration ACK timed out") }
                if let code {
                    // Exit status is independent of anchor lifetime; final cleanup
                    // runs before this frame, so the launcher cannot finish early.
                    cleanup(Array(members.values), anchor: anchor)
                    wait(anchorPid)
                    finalized = true
                    try? sendJSON(socket, ["exitCode": code])
                    return code
                }
                usleep(100_000)
            }
        } catch {
            FileHandle.standardError.write(Data("Service host: \(error.localizedDescription)\n".utf8)); return 1
        }
    }
    static func hostError(_ text: String) -> NSError { NSError(domain: "YonderServiceHost", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
}

import Foundation
import Darwin

/// What the status item shows, from one `activity.watch` result or event (contracts.md §1.3 / §9.2).
struct ActivitySnapshot {
    let running: Int
    let waiting: Int
    let questions: Int
    let agents: [AgentActivity]
}
func parseActivitySummary(_ data: [String: Any]) -> ActivitySnapshot? {
    guard let running = data["running"] as? Int, let waiting = data["waiting"] as? Int, running >= 0, waiting >= 0 else { return nil }
    let questions = data["questions"] as? Int ?? 0
    let agents = (data["agents"] as? [[String: Any]] ?? []).compactMap(AgentActivity.init)
    return ActivitySnapshot(running: running, waiting: waiting, questions: max(0, questions), agents: agents)
}

/// `<home>/.yonder/gateway.json` → port, only while its pid is alive (a crashed gateway leaves the file behind).
func readGatewayPort(_ data: Data) -> Int? {
    guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let port = object["port"] as? Int, port > 0, port <= 65535,
          let pid = object["pid"] as? Int, pid > 0, (kill(pid_t(pid), 0) == 0 || errno == EPERM) else { return nil }
    return port
}

/// One request/response on the local control socket (newline-delimited JSON, see packages/core/src/control/index.ts).
func controlCall(home: String, method: String) -> [String: Any]? {
    let path = home + "/.yonder/control.sock"
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < capacity else { return nil }
    withUnsafeMutableBytes(of: &address.sun_path) { buffer in
        buffer.copyBytes(from: Array(path.utf8) + [0])
    }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return nil }
    defer { close(fd) }
    var timeout = timeval(tv_sec: 3, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    let connected = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    guard connected == 0 else { return nil }
    let request = Array((String(data: try! JSONSerialization.data(withJSONObject: ["method": method]), encoding: .utf8)! + "\n").utf8)
    guard write(fd, request, request.count) == request.count else { return nil }
    var line = Data()
    var byte: UInt8 = 0
    while line.count < 65536, read(fd, &byte, 1) == 1 {
        if byte == 10 { break }
        line.append(byte)
    }
    guard let reply = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any], reply["ok"] as? Bool == true else { return nil }
    return reply["result"] as? [String: Any]
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

/// Exchanges a one-time ticket for the session cookie: the gateway answers `GET /?token=` with 303 + Set-Cookie.
func gatewayCookie(port: Int, ticket: String) -> String? {
    guard let url = URL(string: "http://127.0.0.1:\(port)/?token=\(ticket)") else { return nil }
    let session = URLSession(configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }
    var cookie: String?
    let done = DispatchSemaphore(value: 0)
    var request = URLRequest(url: url)
    request.timeoutInterval = 3
    session.dataTask(with: request) { _, response, _ in
        if let http = response as? HTTPURLResponse, http.statusCode == 303,
           let header = http.value(forHTTPHeaderField: "Set-Cookie") { cookie = header.components(separatedBy: ";").first }
        done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 5)
    return cookie
}

/// Subscribes to `activity.watch` on the local gateway. `onUpdate(nil)` means the gateway is off or the stream dropped;
/// the owner then falls back to the legacy status.json path. Call `ensure()` periodically to (re)connect.
final class GatewayActivityClient {
    var onUpdate: ((ActivitySnapshot?) -> Void)?
    private let home: String
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var connecting = false
    private var generation = 0
    private var pinger: Timer?
    init(home: String) { self.home = home }

    func ensure() {
        guard socket == nil, !connecting else { return }
        connecting = true
        let generation = self.generation
        DispatchQueue.global().async { [home] in
            let state = (try? Data(contentsOf: URL(fileURLWithPath: home + "/.yonder/gateway.json"))).flatMap(readGatewayPort)
            var login: (port: Int, cookie: String)?
            if let state, let ticket = controlCall(home: home, method: "gateway.ticket")?["token"] as? String,
               let cookie = gatewayCookie(port: state, ticket: ticket) { login = (state, cookie) }
            DispatchQueue.main.async {
                guard generation == self.generation else { return }
                self.connecting = false
                if let login { self.open(port: login.port, cookie: login.cookie) } else { self.onUpdate?(nil) }
            }
        }
    }
    func stop() {
        generation += 1; connecting = false
        pinger?.invalidate(); pinger = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        session?.invalidateAndCancel(); session = nil
    }
    private func open(port: Int, cookie: String) {
        var request = URLRequest(url: URL(string: "ws://127.0.0.1:\(port)/api/stream?v=1")!)
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.setValue("http://127.0.0.1:\(port)", forHTTPHeaderField: "Origin")
        let session = URLSession(configuration: .ephemeral)
        let task = session.webSocketTask(with: request)
        self.session = session; socket = task
        task.resume()
        task.send(.string(#"{"t":"sub","sub":"activity","method":"activity.watch","params":{}}"#)) { _ in }
        // The gateway closes a socket that is silent for 60 s.
        pinger = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak task] _ in task?.send(.string(#"{"t":"ping"}"#)) { _ in } }
        RunLoop.main.add(pinger!, forMode: .common)
        receive(task)
    }
    private func receive(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.socket === task else { return }
                switch result {
                case .failure: self.drop()
                case .success(let message):
                    guard case .string(let text) = message, let data = text.data(using: .utf8),
                          let frame = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { self.receive(task); return }
                    switch frame["t"] as? String {
                    case "ready": if let snapshot = (frame["result"] as? [String: Any]).flatMap(parseActivitySummary) { self.onUpdate?(snapshot) }
                    case "ev": if let snapshot = (frame["data"] as? [String: Any]).flatMap(parseActivitySummary) { self.onUpdate?(snapshot) }
                    case "end": self.drop(); return
                    default: break
                    }
                    self.receive(task)
                }
            }
        }
    }
    private func drop() {
        pinger?.invalidate(); pinger = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        session?.invalidateAndCancel(); session = nil
        onUpdate?(nil)
    }
}

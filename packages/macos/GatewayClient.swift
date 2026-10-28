import Foundation

@MainActor
final class GatewayClient {
    private var task: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?

    func start(home: String, executable: String, receive: @escaping ([String: Any]?) -> Void) {
        stop()
        task = Task {
            var delay: UInt64 = 2
            while !Task.isCancelled {
                let session = URLSession(configuration: .ephemeral)
                do {
                    let bytes = try Data(contentsOf: URL(fileURLWithPath: home).appendingPathComponent(".yonder/gateway.json"))
                    guard let state = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                          let port = state["port"] as? Int, (1...65535).contains(port),
                          let basePath = state["basePath"] as? String, basePath.hasPrefix("/") else { throw URLError(.badURL) }
                    let ticket = try await Self.ticket(home: home, executable: executable)
                    let path = basePath.hasSuffix("/") ? basePath : basePath + "/"
                    var login = URLComponents()
                    login.scheme = "http"; login.host = "127.0.0.1"; login.port = port; login.path = path
                    login.queryItems = [URLQueryItem(name: "token", value: ticket)]
                    _ = try await session.data(from: login.url!)
                    guard let cookie = session.configuration.httpCookieStorage?.cookies?.first(where: { $0.name == "yonder_session" }) else {
                        throw URLError(.userAuthenticationRequired)
                    }
                    login.scheme = "ws"; login.path = path + "api/stream"; login.queryItems = nil
                    var request = URLRequest(url: login.url!)
                    request.setValue("\(cookie.name)=\(cookie.value)", forHTTPHeaderField: "Cookie")
                    let ws = session.webSocketTask(with: request)
                    socket = ws
                    defer { ws.cancel(with: .goingAway, reason: nil) }
                    try Task.checkCancellation()
                    ws.resume()
                    try await ws.send(.string(#"{"t":"sub","sub":"activity","method":"activity.watch","params":{}}"#))
                    let heartbeat = Task {
                        while !Task.isCancelled {
                            try await Task.sleep(nanoseconds: 20_000_000_000)
                            try await ws.send(.string(#"{"t":"ping"}"#))
                        }
                    }
                    defer { heartbeat.cancel() }
                    while !Task.isCancelled {
                        let message = try await ws.receive()
                        let data: Data
                        switch message {
                        case .string(let text): data = Data(text.utf8)
                        case .data(let bytes): data = bytes
                        @unknown default: throw URLError(.cannotParseResponse)
                        }
                        guard let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw URLError(.cannotParseResponse) }
                        if let summary = try Self.activity(frame) {
                            delay = 2
                            receive(summary)
                        }
                    }
                } catch {
                    if !Task.isCancelled { receive(nil) }
                }
                session.invalidateAndCancel()
                if Task.isCancelled { break }
                do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { break }
                delay = min(delay * 2, 30)
            }
        }
    }

    func stop() {
        task?.cancel(); task = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
    }

    nonisolated static func activity(_ frame: [String: Any]) throws -> [String: Any]? {
        guard frame["sub"] as? String == "activity" else { return nil }
        let type = frame["t"] as? String
        if type == "end" { throw URLError(.networkConnectionLost) }
        guard type == "ready" || (type == "ev" && frame["type"] as? String == "activity.summary") else { return nil }
        guard let summary = frame[type == "ready" ? "result" : "data"] as? [String: Any],
              summary["running"] is Int, summary["waiting"] is Int,
              summary["sessions"] is [[String: Any]] else { throw URLError(.cannotParseResponse) }
        return summary
    }

    private nonisolated static func ticket(home: String, executable: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(with: Result {
                    let process = Process(), output = Pipe()
                    process.executableURL = URL(fileURLWithPath: executable)
                    process.arguments = ["ui", "--home", home, "--json"]
                    process.standardOutput = output; process.standardError = FileHandle.nullDevice
                    try process.run()
                    let data = output.fileHandleForReading.readDataToEndOfFile()
                    process.waitUntilExit()
                    guard process.terminationStatus == 0,
                          let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let address = result["url"] as? String,
                          let token = URLComponents(string: address)?.queryItems?.first(where: { $0.name == "token" })?.value else {
                        throw URLError(.userAuthenticationRequired)
                    }
                    return token
                })
            }
        }
    }
}

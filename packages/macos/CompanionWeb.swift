import AppKit
import WebKit

@MainActor
final class CompanionWeb {
    private let panel: NSPanel
    private let web: WKWebView
    private let home: String
    private let executable: String

    init(home: String, executable: String) {
        self.home = home; self.executable = executable
        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(WKUserScript(source: "window.__YONDER_SHELL__ = {platform: 'macOS'}", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config)
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        panel.title = "Yonder"; panel.isReleasedWhenClosed = false; panel.level = .floating
        panel.contentView = web; panel.center()
    }

    func show() {
        let home = self.home, executable = self.executable
        DispatchQueue.global().async {
            let process = Process(), output = Pipe()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = ["ui", "--home", home, "--json"]
            process.standardOutput = output; process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                guard process.terminationStatus == 0,
                      let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let address = result["url"] as? String,
                      var url = URLComponents(string: address), url.scheme == "http", url.host == "127.0.0.1" else { throw URLError(.badURL) }
                guard let login = url.url else { throw URLError(.badURL) }
                let session = URLSession(configuration: .ephemeral)
                let semaphore = DispatchSemaphore(value: 0)
                var loginError: Error?
                session.dataTask(with: login) { _, _, error in loginError = error; semaphore.signal() }.resume()
                semaphore.wait()
                if let loginError { throw loginError }
                guard let cookie = session.configuration.httpCookieStorage?.cookies?.first(where: { $0.name == "yonder_session" }) else { throw URLError(.userAuthenticationRequired) }
                url.path = "/console/"; url.percentEncodedQuery = "shell=desktop"
                guard let target = url.url else { throw URLError(.badURL) }
                DispatchQueue.main.async {
                    self.web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
                        self.web.load(URLRequest(url: target))
                        self.panel.makeKeyAndOrderFront(nil)
                        NSApp.activate(ignoringOtherApps: true)
                    }
                }

            } catch {
                DispatchQueue.main.async {
                    let alert = NSAlert(error: error); alert.messageText = "无法打开 Yonder 窗口"; alert.runModal()
                }
            }
        }
    }
}

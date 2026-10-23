import AppKit
import Darwin

final class StatusApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var item: NSStatusItem!
    private var companion: CompanionController!
    private var endpointTimer: Timer?
    private let menu = NSMenu()
    private let current = NSMenuItem(title: "当前交互", action: #selector(openCurrent), keyEquivalent: "")
    private let history = NSMenuItem(title: "交互历史", action: #selector(openHistory), keyEquivalent: "")
    private let status = NSMenuItem(title: "读取服务状态…", action: nil, keyEquivalent: "")
    private let update = NSMenuItem(title: "检查更新", action: #selector(checkUpdate), keyEquivalent: "")
    private let quit = NSMenuItem(title: "停止服务并退出", action: #selector(exitService), keyEquivalent: "q")
    private let install = ProcessInfo.processInfo.environment["YONDER_INSTALL"] ?? NSHomeDirectory() + "/.yonder-harness"
    private let home = ProcessInfo.processInfo.environment["YONDER_HOME"] ?? NSHomeDirectory() + "/.local/share/yonder-harness/home"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(contentsOf: Bundle.main.url(forResource: "menubar-template", withExtension: "png")!)!
        image.size = NSSize(width: 22, height: 22); image.isTemplate = true
        item.button?.image = image
        item.button?.toolTip = "Yonder · 左键交互，右键管理"
        item.button?.setAccessibilityLabel("Yonder")
        item.button?.target = self; item.button?.action = #selector(statusClicked)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        menu.delegate = self; menu.autoenablesItems = false
        status.isEnabled = false
        for entry in [current, history, update, quit] { entry.target = self }
        [current, history, NSMenuItem.separator(), status, update, NSMenuItem.separator(), quit].forEach(menu.addItem)
        companion = CompanionController()
        companion.onVisibility = { [weak self] visible in self?.item.button?.state = visible ? .on : .off }
        companion.isStatusClick = { [weak self] point in
            guard let button = self?.item.button, let window = button.window else { return false }
            return window.convertToScreen(button.convert(button.bounds, to: nil)).contains(point)
        }
        refreshEndpoint()
        endpointTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refreshEndpoint() }
    }
    private func refreshEndpoint() {
        let file = URL(fileURLWithPath: home).appendingPathComponent(".yonder/plugins/ui-companion/desktop.json")
        companion.setEndpoint((try? Data(contentsOf: file)).flatMap(DesktopEndpoint.read))
        current.isEnabled = companion.available; history.isEnabled = companion.available
        current.title = companion.available ? "当前交互" : "交互插件未就绪"
    }
    private func showMenu() {
        item.menu = menu; item.button?.performClick(nil); item.menu = nil
    }
    @objc private func statusClicked() {
        refreshEndpoint()
        if NSApp.currentEvent?.type == .rightMouseUp || !companion.available { showMenu() }
        else { companion.toggle() }
    }
    @objc private func openCurrent() { companion.showCurrent() }
    @objc private func openHistory() { companion.showHistory() }
    func applicationWillTerminate(_ notification: Notification) {
        endpointTimer?.invalidate(); companion.stop()
    }

    private func run(_ args: [String], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let executable = install + "/bin/yonder"
        DispatchQueue.global().async {
            let result = Result<[String: Any], Error> {
                let process = Process(), out = Pipe(), error = Pipe()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = args + ["--json"]
                process.standardOutput = out
                process.standardError = error
                try process.run()
                let bytes = out.fileHandleForReading.readDataToEndOfFile()
                let failure = error.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                guard process.terminationStatus == 0 else {
                    throw NSError(domain: "Yonder", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: String(decoding: failure, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)])
                }
                guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
                    throw NSError(domain: "Yonder", code: 1, userInfo: [NSLocalizedDescriptionKey: "命令没有返回有效状态"])
                }
                return object
            }
            DispatchQueue.main.async { completion(result) }
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        refreshEndpoint()
        status.title = "读取服务状态…"
        run(["service", "info", "--home", home]) { result in
            switch result {
            case .success(let info):
                self.status.title = info["ready"] as? Bool == true ? "运行中 · \(info["version"] ?? "") · PID \(info["pid"] ?? "")" : "服务未就绪"
            case .failure(let error): self.status.title = "服务未就绪：\(error.localizedDescription)"
            }
        }
    }

    @objc private func checkUpdate() {
        update.isEnabled = false
        update.title = "正在检查更新…"
        run(["update", "--check"]) { result in
            self.update.isEnabled = true
            switch result {
            case .success(let info):
                self.update.title = info["updateAvailable"] as? Bool == true ? "有新版 \(info["latest"] ?? "")（仅检查）" : "本机 \(info["current"] ?? "") · 正式版 \(info["latest"] ?? "")"
            case .failure(let error): self.update.title = "检查失败：\(error.localizedDescription)"
            }
        }
    }

    @objc private func exitService() {
        quit.isEnabled = false
        run(["service", "stop"]) { result in
            switch result {
            case .success: NSApp.terminate(nil)
            case .failure(let error):
                self.status.title = "停止失败：\(error.localizedDescription)"
                self.quit.isEnabled = true
            }
        }
    }
}


@main
struct DesktopMain {
    static func main() {
        if CommandLine.arguments.contains("--check") {
            checkCompanionGeometry()
            let path = "/" + UUID().uuidString + "/"
            let data = try! JSONSerialization.data(withJSONObject: ["url": "http://127.0.0.1:12345" + path, "pid": getpid()])
            precondition(DesktopEndpoint.read(data) != nil)
            for value in ["https://example.com" + path, "http://localhost:12345" + path, "http://127.0.0.1:12345/", "http://127.0.0.1:12345" + path + "?extra=1"] {
                let invalid = try! JSONSerialization.data(withJSONObject: ["url": value, "pid": getpid()])
                precondition(DesktopEndpoint.read(invalid) == nil)
            }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let lockPath = directory.appendingPathComponent("lock").path
            let first = Darwin.open(lockPath, O_CREAT | O_RDWR, 0o600)
            let second = Darwin.open(lockPath, O_RDWR)
            precondition(first >= 0 && second >= 0)
            defer { Darwin.close(first); Darwin.close(second) }
            precondition(flock(first, LOCK_EX | LOCK_NB) == 0)
            precondition(flock(second, LOCK_EX | LOCK_NB) != 0)
            precondition(flock(first, LOCK_UN) == 0)
            precondition(flock(second, LOCK_EX | LOCK_NB) == 0)
            print("Passed: desktop endpoint validation and single status host lock.")
            return
        }
        let home = ProcessInfo.processInfo.environment["YONDER_HOME"] ?? NSHomeDirectory() + "/.local/share/yonder-harness/home"
        let directory = URL(fileURLWithPath: home).appendingPathComponent(".yonder")
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { fputs("Cannot create status lock directory: \(error)\n", stderr); return }
        let lock = Darwin.open(directory.appendingPathComponent("status-ui.lock").path, O_CREAT | O_RDWR, 0o600)
        guard lock >= 0 else { perror("status lock"); return }
        defer { Darwin.close(lock) }
        guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { return }
        let app = NSApplication.shared
        let delegate = StatusApp()
        app.delegate = delegate
        app.run()
    }
}

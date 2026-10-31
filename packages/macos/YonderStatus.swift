import AppKit
import Darwin
import UserNotifications

@MainActor
final class StatusApp: NSObject, NSApplicationDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
    private var item: NSStatusItem!
    private let gateway = GatewayClient()
    private let menu = NSMenu()
    private let status = NSMenuItem(title: "服务未就绪 · 状态未知", action: nil, keyEquivalent: "")
    private var needsPowerUpdate = false
    private var powerGeneration = 0
    private var baseImage: NSImage!
    private let awake = NSMenuItem(title: "保持唤醒", action: nil, keyEquivalent: "")
    private let awakeOff = NSMenuItem(title: "关闭", action: #selector(selectAwakeMode(_:)), keyEquivalent: "")
    private let awakeTasks = NSMenuItem(title: "任务期间保持唤醒", action: #selector(selectAwakeMode(_:)), keyEquivalent: "")
    private let awakeAlways = NSMenuItem(title: "始终保持唤醒", action: #selector(selectAwakeMode(_:)), keyEquivalent: "")
    private let powerState = NSMenuItem(title: "读取唤醒状态…", action: nil, keyEquivalent: "")
    private let update = NSMenuItem(title: "检查更新", action: #selector(checkUpdate), keyEquivalent: "")
    private let quit = NSMenuItem(title: "停止服务并退出", action: #selector(exitService), keyEquivalent: "q")
    private let install: String = {
        if let install = ProcessInfo.processInfo.environment["YONDER_INSTALL"] { return install }
        let current = NSHomeDirectory() + "/.local/share/yonder/install"
        let legacy = NSHomeDirectory() + "/.yonder-harness"
        // Remove this migration fallback after two minor releases.
        return !FileManager.default.fileExists(atPath: current) && FileManager.default.fileExists(atPath: legacy) ? legacy : current
    }()
    private let home = ProcessInfo.processInfo.environment["YONDER_HOME"] ?? NSHomeDirectory() + "/.local/share/yonder/home"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(contentsOf: Bundle.main.url(forResource: "menubar-template", withExtension: "png")!)!
        image.size = NSSize(width: 22, height: 22); image.isTemplate = true
        baseImage = image
        item.button?.image = image
        item.button?.toolTip = "Yonder · 点击打开菜单"
        item.button?.setAccessibilityLabel("Yonder")
        item.menu = menu
        menu.delegate = self; menu.autoenablesItems = false
        status.isEnabled = false; powerState.isEnabled = false
        for entry in [awakeOff, awakeTasks, awakeAlways, update, quit] { entry.target = self }
        let awakeMenu = NSMenu()
        awakeMenu.autoenablesItems = false
        awakeOff.representedObject = "off"; awakeTasks.representedObject = "tasks"; awakeAlways.representedObject = "always"
        [awakeOff, awakeTasks, awakeAlways].forEach(awakeMenu.addItem)
        awake.submenu = awakeMenu
        // Fixed skeleton: dynamic state only changes titles, never inserts or removes items.
        [status, NSMenuItem.separator(), awake, powerState, NSMenuItem.separator(), update, NSMenuItem.separator(), quit]
            .forEach(menu.addItem)
        renderActivity(nil)
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        gateway.start(home: home, executable: install + "/bin/yonder", receive: { [weak self] in self?.renderActivity($0) }, notify: { data in
            guard let session = data["session"] as? String, let text = data["text"] as? String else { return }
            let content = UNMutableNotificationContent()
            content.title = "Yonder"; content.body = text; content.userInfo = ["session": session]
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
        })
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let session = response.notification.request.content.userInfo["session"] as? String
        Task { @MainActor in self.openConsole(session: session); completionHandler() }
    }
    func applicationWillTerminate(_ notification: Notification) { gateway.stop() }

    /// The status bar carries no window. A notification opens the web console (the desktop client
    /// loads the same site) with a one-time ticket; the page itself maps `#/s/<id>` to its work route.
    private func openConsole(session: String?) {
        let executable = install + "/bin/yonder", home = self.home
        DispatchQueue.global().async {
            let process = Process(), output = Pipe()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = ["ui", "--home", home, "--json"]
            process.standardOutput = output; process.standardError = FileHandle.nullDevice
            guard (try? process.run()) != nil else { return }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0,
                  let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let address = result["url"] as? String,
                  let session, var url = URLComponents(string: address), url.scheme == "http", url.host == "127.0.0.1" else { return }
            url.fragment = "/s/" + (session.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")
            guard let target = url.url else { return }
            DispatchQueue.main.async { NSWorkspace.shared.open(target) }
        }
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
        refreshPower()
    }

    /// Only the running/waiting counts; the menu never lists agents or sessions.
    private func renderActivity(_ info: [String: Any]?) {
        let snapshot = ActivitySnapshot(info)
        if !snapshot.known {
            status.title = "服务未就绪 · 状态未知"
        } else if snapshot.running == 0 && snapshot.waiting == 0 {
            status.title = "服务运行中 · 空闲"
        } else {
            var parts = ["运行 \(snapshot.running)"]
            if snapshot.waiting > 0 { parts.append("等你 \(snapshot.waiting)") }
            status.title = "服务运行中 · " + parts.joined(separator: " · ")
        }
        status.toolTip = snapshot.known ? nil : "读取不到本机网关的活动状态"
        item.button?.toolTip = snapshot.known ? (snapshot.running > 0 ? "Yonder · 任务运行中" : "Yonder · 空闲") : "Yonder · 运行状态未知"
        let image = NSImage(size: NSSize(width: 22, height: 22))
        image.lockFocus()
        self.baseImage.draw(in: NSRect(x: 0, y: 0, width: 22, height: 22))
        if snapshot.running > 0 || !snapshot.known {
            NSColor.labelColor.setFill()
            let dot = NSBezierPath(ovalIn: NSRect(x: 16, y: 1, width: 5, height: 5))
            if snapshot.running > 0 { dot.fill() } else { dot.lineWidth = 1; dot.stroke() }
        }
        image.unlockFocus(); image.isTemplate = true
        item.button?.image = image
    }

    private func refreshPower() {
        powerGeneration += 1
        let generation = powerGeneration
        run(["awake", "status", "--home", home]) { result in
            guard generation == self.powerGeneration else { return }
            switch result {
            case .success(let info):
                let enabled = info["enabled"] as? Bool == true
                self.needsPowerUpdate = info["requiresUpdate"] as? Bool == true
                let mode = info["mode"] as? String ?? (enabled ? "tasks" : "off")
                self.awake.title = self.needsPowerUpdate ? "保持唤醒 · 更新组件…" : "保持唤醒"
                for entry in [self.awakeOff, self.awakeTasks, self.awakeAlways] {
                    entry.state = entry.representedObject as? String == mode ? .on : .off
                }
                if !enabled { self.powerState.title = "已关闭 · 允许休眠" }
                else if let error = info["error"] as? String { self.powerState.title = "合盖保护未就绪：" + error }
                else if info["protected"] as? Bool == true {
                    if mode == "always" { self.powerState.title = "始终保持唤醒" }
                    else if info["reason"] as? String == "grace", let until = info["holdUntil"] as? Double {
                        let minutes = max(1, Int(ceil((until / 1000 - Date().timeIntervalSince1970) / 60)))
                        self.powerState.title = "缓冲保持唤醒 · 还剩 \(minutes) 分钟"
                    } else { self.powerState.title = "保持唤醒 · \(info["active"] ?? 0) 项任务" }
                }
                else { self.powerState.title = info["systemSleepDisabled"] as? Bool == true ? "系统已保持唤醒" : "空闲 · 允许休眠" }
            case .failure(let error): self.powerState.title = "唤醒状态未知：" + error.localizedDescription
            }
        }
    }
    @objc private func selectAwakeMode(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        let warnAlways = mode == "always" && !UserDefaults.standard.bool(forKey: "alwaysAwakeAcknowledged")
        if warnAlways {
            let alert = NSAlert()
            alert.messageText = "始终保持唤醒"
            alert.informativeText = "即使没有任务，Mac 也会持续运行。合盖会增加耗电和发热，请保持通风，不要放入密闭背包中。"
            alert.addButton(withTitle: "开启"); alert.addButton(withTitle: "取消")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        [awakeOff, awakeTasks, awakeAlways].forEach { $0.isEnabled = false }
        let apply = {
            self.run(["awake", "set", mode, "--home", self.home]) { result in
                [self.awakeOff, self.awakeTasks, self.awakeAlways].forEach { $0.isEnabled = true }
                if case .failure(let error) = result { self.powerState.title = error.localizedDescription }
                else {
                    if warnAlways { UserDefaults.standard.set(true, forKey: "alwaysAwakeAcknowledged") }
                    for entry in [self.awakeOff, self.awakeTasks, self.awakeAlways] {
                        entry.state = entry.representedObject as? String == mode ? .on : .off
                    }
                    self.powerState.title = mode == "off" ? "正在释放保护…" : "正在应用唤醒模式…"
                }
            }
        }
        if mode != "off" && (needsPowerUpdate || !FileManager.default.fileExists(atPath: "/var/run/dev.yonder.power.sock")) {
            let alert = NSAlert()
            alert.messageText = "启用保持唤醒"
            alert.informativeText = "允许合盖期间继续执行，显示器仍可熄灭。首次安装或更新电源组件需要系统管理员授权。"
            alert.addButton(withTitle: "安装并开启"); alert.addButton(withTitle: "取消")
            guard alert.runModal() == .alertFirstButtonReturn else {
                [awakeOff, awakeTasks, awakeAlways].forEach { $0.isEnabled = true }; return
            }
            run(["awake", "install"]) { result in
                switch result {
                case .success: apply()
                case .failure(let error):
                    [self.awakeOff, self.awakeTasks, self.awakeAlways].forEach { $0.isEnabled = true }
                    self.powerState.title = "未授权或安装失败：" + error.localizedDescription
                }
            }
        } else { apply() }
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

/// The only activity facts the menu shows: whether the service is reachable and how many
/// sessions are running or waiting. Agent ids, task summaries and reply fragments stay out.
struct ActivitySnapshot {
    let known: Bool
    let running: Int
    let waiting: Int
    init(_ summary: [String: Any]?) {
        known = summary != nil
        running = summary?["running"] as? Int ?? 0
        waiting = summary?["waiting"] as? Int ?? 0
    }
}

func checkGatewayActivityCases(_ path: String) {
    let data = try! Data(contentsOf: URL(fileURLWithPath: path))
    let cases = try! JSONSerialization.jsonObject(with: data) as! [[String: Any]]
    var checked = 0
    for item in cases {
        guard let frames = item["gatewayFrames"] as? [Any], let expected = item["gatewayExpected"] as? [String: Any] else { continue }
        var summary: [String: Any]?
        for frame in frames {
            if frame is NSNull { summary = nil }
            else {
                do { if let next = try GatewayClient.activity(frame as! [String: Any]) { summary = next } }
                catch { summary = nil }
            }
        }
        let snapshot = ActivitySnapshot(summary)
        precondition(snapshot.known == expected["known"] as! Bool, item["name"] as! String)
        precondition(snapshot.running == expected["running"] as! Int, item["name"] as! String)
        precondition(snapshot.waiting == expected["waiting"] as! Int, item["name"] as! String)
        checked += 1
    }
    precondition(checked == 2)
    print("Passed: \(checked) gateway disconnect/reconnect snapshot cases.")
}


@main
@MainActor
struct DesktopMain {
    static func main() {
        if let index = CommandLine.arguments.firstIndex(of: "--check-activity"), CommandLine.arguments.count > index + 1 {
            checkGatewayActivityCases(CommandLine.arguments[index + 1])
            return
        }
        if CommandLine.arguments.contains("--check") {
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
            print("Passed: single status host lock.")
            return
        }
        let home = ProcessInfo.processInfo.environment["YONDER_HOME"] ?? NSHomeDirectory() + "/.local/share/yonder/home"
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

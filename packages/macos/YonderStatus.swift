import AppKit
import Darwin

final class StatusApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var item: NSStatusItem!
    private var companion: CompanionController!
    private var endpointTimer: Timer?
    private var gateway: GatewayActivityClient!
    private var gatewaySnapshot: ActivitySnapshot?
    private let menu = NSMenu()
    private let current = NSMenuItem(title: "打开悬浮窗", action: #selector(openCurrent), keyEquivalent: "")
    private let history = NSMenuItem(title: "交互历史", action: #selector(openHistory), keyEquivalent: "")
    private let status = NSMenuItem(title: "读取服务状态…", action: nil, keyEquivalent: "")
    private var needsPowerUpdate = false
    private var agentItems: [NSMenuItem] = []
    private var activityKey = ""
    private var baseImage: NSImage!
    private let awake = NSMenuItem(title: "保持唤醒", action: nil, keyEquivalent: "")
    private let awakeOff = NSMenuItem(title: "关闭", action: #selector(selectAwakeMode(_:)), keyEquivalent: "")
    private let awakeTasks = NSMenuItem(title: "任务期间保持唤醒", action: #selector(selectAwakeMode(_:)), keyEquivalent: "")
    private let awakeAlways = NSMenuItem(title: "始终保持唤醒", action: #selector(selectAwakeMode(_:)), keyEquivalent: "")
    private let powerState = NSMenuItem(title: "读取唤醒状态…", action: nil, keyEquivalent: "")
    private let update = NSMenuItem(title: "检查更新", action: #selector(checkUpdate), keyEquivalent: "")
    private let quit = NSMenuItem(title: "停止服务并退出", action: #selector(exitService), keyEquivalent: "q")
    private let install = ProcessInfo.processInfo.environment["YONDER_INSTALL"] ?? NSHomeDirectory() + "/.yonder-harness"
    private let home = ProcessInfo.processInfo.environment["YONDER_HOME"] ?? NSHomeDirectory() + "/.local/share/yonder-harness/home"

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
        for entry in [current, history, awakeOff, awakeTasks, awakeAlways, update, quit] { entry.target = self }
        let awakeMenu = NSMenu()
        awakeMenu.autoenablesItems = false
        awakeOff.representedObject = "off"; awakeTasks.representedObject = "tasks"; awakeAlways.representedObject = "always"
        [awakeOff, awakeTasks, awakeAlways].forEach(awakeMenu.addItem)
        awake.submenu = awakeMenu
        [current, history, NSMenuItem.separator(), awake, powerState, NSMenuItem.separator(), status, update, NSMenuItem.separator(), quit].forEach(menu.addItem)
        companion = CompanionController(preferenceKey: home + ":companion-pinned")
        companion.onVisibility = { [weak self] visible in self?.item.button?.state = visible ? .on : .off }
        companion.isStatusClick = { [weak self] point in
            guard let button = self?.item.button, let window = button.window else { return false }
            return window.convertToScreen(button.convert(button.bounds, to: nil)).contains(point)
        }
        // 网关开着时状态栏订阅 activity.watch；网关没开（--no-gateway）才读 status.json。
        gateway = GatewayActivityClient(home: home)
        gateway.onUpdate = { [weak self] snapshot in
            self?.gatewaySnapshot = snapshot
            self?.refreshActivity()
        }
        refreshEndpoint()
        refreshActivity()
        endpointTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.gateway.ensure(); self?.refreshEndpoint(); self?.refreshActivity() }
        RunLoop.main.add(endpointTimer!, forMode: .common)
    }
    private func refreshEndpoint() {
        let file = URL(fileURLWithPath: home).appendingPathComponent(".yonder/plugins/ui-companion/desktop.json")
        companion.setEndpoint((try? Data(contentsOf: file)).flatMap(DesktopEndpoint.read))
        current.isEnabled = companion.available; history.isEnabled = companion.available
        current.title = companion.available ? "打开悬浮窗" : "交互插件未就绪"
    }
    @objc private func openCurrent() { companion.showCurrent() }
    @objc private func openHistory() { companion.showHistory() }
    func applicationWillTerminate(_ notification: Notification) {
        endpointTimer?.invalidate(); gateway.stop(); companion.stop()
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
        refreshEndpoint()
        refreshActivity()
    }

    /// 优先用网关的 activity.watch 推送；网关未开时退回服务写出的 `.yonder/status.json`，这里只读文件。
    /// 派生 `yonder service info` 每次都要付 Node 启动和整棵模块图加载，2 秒一次就是持续空转。
    private func refreshActivity() {
        var agents: [AgentActivity] = []
        var known = false
        var running = false
        var version = ""
        var detail = ""
        if let snapshot = gatewaySnapshot {
            known = true
            agents = snapshot.agents
            running = snapshot.running > 0
            detail = "网关 · 运行 \(snapshot.running) · 等待 \(snapshot.waiting) · 等你回答 \(snapshot.questions)"
        } else {
            let file = URL(fileURLWithPath: home).appendingPathComponent(".yonder/status.json")
            if let data = try? Data(contentsOf: file),
               let info = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               info["ready"] as? Bool == true,
               let rows = info["agents"] as? [[String: Any]] {
                // 心跳：内容不变时服务每 10 秒刷新 observedAt。30 秒没动就说明服务已经不在了。
                let observedAt = (info["observedAt"] as? Double ?? 0) / 1000
                if Date().timeIntervalSince1970 - observedAt < 30 {
                    known = true
                    version = info["version"] as? String ?? ""
                    agents = rows.compactMap(AgentActivity.init)
                    running = agents.contains { $0.state == "running" } || (info["active"] as? Int ?? 0) > 0
                    detail = "服务运行中 · \(version)"
                }
            }
        }
        self.status.title = known ? detail : "服务未就绪 · 运行状态未知"
        self.companion.setActivity(agents, known: known)
        self.item.button?.toolTip = known ? (running ? "Yonder · 任务运行中" : "Yonder · 空闲") : "Yonder · 运行状态未知"
        let image = NSImage(size: NSSize(width: 22, height: 22))
        image.lockFocus()
        self.baseImage.draw(in: NSRect(x: 0, y: 0, width: 22, height: 22))
        if running || !known {
            NSColor.labelColor.setFill()
            let dot = NSBezierPath(ovalIn: NSRect(x: 16, y: 1, width: 5, height: 5))
            if running { dot.fill() } else { dot.lineWidth = 1; dot.stroke() }
        }
        image.unlockFocus(); image.isTemplate = true
        self.item.button?.image = image
        let key = "\(known):" + agents.map { $0.menuText + $0.tasks.map { $0.summary + $0.detail + $0.text }.joined(separator: "\n") }.joined(separator: "\n")
        guard self.activityKey != key else { return }
        self.activityKey = key
        self.agentItems.forEach { self.menu.removeItem($0) }; self.agentItems = []
        var index = 0
        for agent in agents {
            let title = NSMenuItem(title: agent.menuText, action: nil, keyEquivalent: "")
            title.isEnabled = false
            self.menu.insertItem(title, at: index); index += 1; self.agentItems.append(title)
            for task in agent.tasks {
                let text = [String(task.summary.prefix(44)), task.detail].filter { !$0.isEmpty }.joined(separator: " · ")
                let row = NSMenuItem(title: String(text.prefix(90)), action: nil, keyEquivalent: "")
                row.isEnabled = false; row.indentationLevel = 1; row.toolTip = [task.summary, task.detail].joined(separator: " · ")
                self.menu.insertItem(row, at: index); index += 1; self.agentItems.append(row)
                if !task.text.isEmpty {
                    let output = NSMenuItem(title: String(task.text.replacingOccurrences(of: "\n", with: " ").suffix(64)), action: nil, keyEquivalent: "")
                    output.isEnabled = false; output.indentationLevel = 1; output.toolTip = task.text
                    self.menu.insertItem(output, at: index); index += 1; self.agentItems.append(output)
                }
            }
        }
        if !self.agentItems.isEmpty {
            let separator = NSMenuItem.separator()
            self.menu.insertItem(separator, at: index); self.agentItems.append(separator)
        }
    }

    private func refreshPower() {
        run(["awake", "status", "--home", home]) { result in
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
        if mode != "off" && (needsPowerUpdate || !FileManager.default.fileExists(atPath: "/var/run/dev.yonder.harness.power.sock")) {
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


@main
struct DesktopMain {
    static func main() {
        if let index = CommandLine.arguments.firstIndex(of: "--check-activity-http"), CommandLine.arguments.count > index + 2 {
            checkActivityHTTP(CommandLine.arguments[index + 1], fixture: CommandLine.arguments[index + 2])
            return
        }
        if let index = CommandLine.arguments.firstIndex(of: "--check-activity"), CommandLine.arguments.count > index + 1 {
            let cases = checkActivityCases(CommandLine.arguments[index + 1])
            if let preview = CommandLine.arguments.firstIndex(of: "--preview-activity"), CommandLine.arguments.count > preview + 1 {
                checkDynamicActivityAppearance(cases[0])
                previewActivityCases(cases, directory: CommandLine.arguments[preview + 1])
            }
            return
        }
        // 针对真实网关：gateway.json → control.sock gateway.ticket → cookie → WebSocket activity.watch，打印首个快照。
        if let index = CommandLine.arguments.firstIndex(of: "--check-gateway"), CommandLine.arguments.count > index + 1 {
            let client = GatewayActivityClient(home: CommandLine.arguments[index + 1])
            _ = NSApplication.shared
            client.onUpdate = { snapshot in
                guard let snapshot else { return }
                print("gateway activity: running=\(snapshot.running) waiting=\(snapshot.waiting) questions=\(snapshot.questions) agents=\(snapshot.agents.map { $0.name + ":" + $0.state })")
                exit(0)
            }
            client.ensure()
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { print("gateway activity: no snapshot"); exit(1) }
            RunLoop.main.run()
        }
        if CommandLine.arguments.contains("--check") {
            checkCompanionGeometry()
            precondition(AgentActivity(["id": "main", "name": "main", "state": "unknown"]) == nil)
            let activity = AgentActivity(["id": "main", "name": "main", "state": "running", "tasks": [["detail": "执行 bash"]]])!
            precondition(activity.label == "运行中" && activity.tasks[0].detail == "执行 bash")
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
            let snapshot = parseActivitySummary(["running": 1, "waiting": 2, "questions": 3, "sessions": [],
                                                 "agents": [["id": "main", "name": "Jarvis", "state": "running"]]])!
            precondition(snapshot.running == 1 && snapshot.waiting == 2 && snapshot.questions == 3)
            precondition(snapshot.agents.count == 1 && snapshot.agents[0].name == "Jarvis" && snapshot.agents[0].state == "running")
            precondition(parseActivitySummary(["running": 1]) == nil && parseActivitySummary(["running": -1, "waiting": 0]) == nil)
            precondition(readGatewayPort(try! JSONSerialization.data(withJSONObject: ["port": 7690, "pid": getpid()])) == 7690)
            precondition(readGatewayPort(try! JSONSerialization.data(withJSONObject: ["port": 7690, "pid": 99999999])) == nil)
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

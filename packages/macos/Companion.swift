import AppKit
import WebKit
import Darwin
import QuartzCore

struct AgentActivity {
    struct Task {
        let summary: String
        let detail: String
        let text: String
        let execution: [String: Any]?
        var json: [String: Any] {
            var data: [String: Any] = ["summary": summary, "detail": detail, "text": text]
            if let execution { data["execution"] = execution }
            return data
        }
    }
    let id: String
    let name: String
    let state: String
    let tasks: [Task]
    init?(_ data: [String: Any]) {
        guard let id = data["id"] as? String, let name = data["name"] as? String,
              let state = data["state"] as? String, ["running", "waiting", "idle"].contains(state) else { return nil }
        self.id = id; self.name = name; self.state = state
        tasks = (data["tasks"] as? [[String: Any]] ?? []).map {
            Task(summary: $0["summary"] as? String ?? "", detail: $0["detail"] as? String ?? "", text: $0["text"] as? String ?? "", execution: $0["execution"] as? [String: Any])
        }
    }
    var label: String { presentation(known: true, summary: [:]).label }
    var menuText: String { "\(state == "running" ? "●" : state == "waiting" ? "◐" : "○") \(name) · \(label)" }
    var json: [String: Any] { ["id": id, "name": name, "state": state, "tasks": tasks.map { $0.json }] }
    func presentation(known: Bool, summary: [String: Any]) -> ActivityPresentation {
        let envelope = validatedActivitySummary(summary)
        let availability = envelope["availability"] as? String
        let agents = (envelope["summary"] as? [String: Any])?["agents"] as? [[String: Any]] ?? []
        let counts = agents.first { $0["agentId"] as? String == id } ?? [:]
        let available = availability == "available"
        let blocked = available ? counts["blocked"] as? Int ?? 0 : 0
        let review = available ? counts["review"] as? Int ?? 0 : 0
        let waiting = available ? counts["waitingUser"] as? Int ?? 0 : 0
        let phases = tasks.map { $0.execution?["phase"] as? String }
        let running = phases.contains("running") || (state == "running" && (phases.isEmpty || phases.contains(nil)))
        let retrying = phases.contains("retrying")
        let waitingInput = phases.contains("waiting-input") || (state == "waiting" && (phases.isEmpty || phases.contains(nil)))
        let executionKnown = known && phases.allSatisfy { $0 == nil || ["running", "retrying", "waiting-input", "blocked", "idle"].contains($0!) }
        var status = "idle", label = "无执行"
        if !executionKnown { status = "unknown"; label = "执行状态未知" }
        else if running || retrying { status = "running"; label = running ? "运行中" + (retrying ? " · 重试中" : "") : "重试中" }
        else if waitingInput { status = "waiting"; label = "等你 · 等待输入" }
        else if phases.contains("blocked") { status = "blocked"; label = "执行受阻" }
        else if blocked > 0 { status = "blocked"; label = "有阻塞事项" }
        else if review > 0 { status = "review"; label = "待检查" }
        else if waiting > 0 { status = "waiting"; label = "等你" }
        var items: [String] = []
        if available {
            if blocked > 0 { items.append("阻塞 \(blocked)") }
            if review > 0 { items.append("待检查 \(review)") }
            if waiting > 0 { items.append("等你 \(waiting)") }
        } else { items = [availability == "unpublished" ? "事项状态未接入" : "事项状态暂不可用"] }
        return ActivityPresentation(state: status, label: label, items: items.joined(separator: " · "), emphasized: executionKnown && (running || retrying))
    }
}
func validatedActivitySummary(_ value: [String: Any]) -> [String: Any] {
    guard value["schemaVersion"] as? Int == 1, let revision = value["sourceRevision"] as? Int, revision >= 0 else { return ["availability": "unavailable"] }
    if value["availability"] as? String == "unpublished" { return ["schemaVersion": 1, "sourceRevision": revision, "availability": "unpublished"] }
    guard value["availability"] as? String == "available", let summary = value["summary"] as? [String: Any], summary["schemaVersion"] as? Int == 1,
          summary["observedAt"] is NSNumber, let agents = summary["agents"] as? [[String: Any]], agents.allSatisfy({ agent in
              agent["agentId"] is String && ["blocked", "review", "waitingUser"].allSatisfy { (agent[$0] as? Int ?? -1) >= 0 }
          }) else { return ["availability": "unavailable", "sourceRevision": revision] }
    return value
}
struct ActivityPresentation {
    let state: String
    let label: String
    let items: String
    let emphasized: Bool
    var description: String { [label, items].filter { !$0.isEmpty }.joined(separator: " · ") }
}
enum ActivityColors {
    static func color(_ state: String, dark: Bool) -> NSColor {
        let pair: (UInt32, UInt32)
        switch state {
        case "running": pair = (0x876113, 0xe6bd64)
        case "blocked": pair = (0xb4342c, 0xea6b5f)
        case "review": pair = (0x365e79, 0xa8cbe6)
        default: pair = (0x72716b, 0xa6a6a1)
        }
        let hex = dark ? pair.1 : pair.0
        return NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
}
// Shared by the real compact entry and the explicitly labelled offscreen test preview.
func renderActivityDock(_ view: NSView, agents: [AgentActivity], known: Bool, summary: [String: Any]) {
    for child in view.subviews where !(child is NSImageView) { child.removeFromSuperview() }
    let dark = view.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    view.effectiveAppearance.performAsCurrentDrawingAppearance { view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor }
    if let mark = view.subviews.first as? NSImageView { mark.frame.origin.y = (view.bounds.height - 52) / 2 }
    let rows = known && !agents.isEmpty ? agents.map { ($0.name, $0.presentation(known: known, summary: summary)) } : [(known ? "暂无 Agent" : "状态未知", ActivityPresentation(state: "unknown", label: known ? "暂无 Agent" : "执行状态未知", items: "", emphasized: false))]
    for (index, row) in rows.enumerated() {
        let y = view.bounds.height - 25 - CGFloat(index * 32)
        let dot = NSView(frame: NSRect(x: 62, y: y + 7, width: 7, height: 7))
        dot.wantsLayer = true; dot.layer?.cornerRadius = row.1.state == "waiting" ? 1 : 3.5
        let color = ActivityColors.color(row.1.state, dark: dark)
        if row.1.state == "unknown" { dot.layer?.borderWidth = 1; dot.layer?.borderColor = color.cgColor }
        else { dot.layer?.backgroundColor = color.cgColor }
        // Static semantic lights: no pulsing, including when Reduce Motion is enabled.
        let name = NSTextField(labelWithString: row.0)
        name.frame = NSRect(x: 76, y: y + 2, width: 110, height: 17)
        name.font = .systemFont(ofSize: 11, weight: row.1.emphasized ? .bold : .medium)
        name.lineBreakMode = .byTruncatingTail; name.textColor = .labelColor
        let status = NSTextField(labelWithString: row.1.description)
        status.frame = NSRect(x: 76, y: y - 12, width: 220, height: 15)
        status.font = .systemFont(ofSize: 10); status.textColor = .secondaryLabelColor; status.lineBreakMode = .byTruncatingTail
        name.toolTip = row.0 + " · " + row.1.description; status.toolTip = name.toolTip
        name.setAccessibilityLabel(name.toolTip); status.setAccessibilityLabel(row.1.description)
        dot.setAccessibilityElement(false)
        view.addSubview(dot); view.addSubview(name); view.addSubview(status)
    }
    view.toolTip = rows.map { $0.0 + " · " + $0.1.description }.joined(separator: "\n")
    view.setAccessibilityLabel("打开 Yonder。" + (view.toolTip ?? ""))
}

// Placement only considers the pointer and screen edges, never reads other apps' contents.
func clampedFrame(_ frame: NSRect, in screen: NSRect) -> NSRect {
    let width = min(frame.width, screen.width - 16)
    let height = min(frame.height, screen.height - 16)
    return NSRect(x: max(screen.minX + 8, min(frame.minX, screen.maxX - width - 8)),
                  y: max(screen.minY + 8, min(frame.minY, screen.maxY - height - 8)), width: width, height: height)
}
func awayFrame(size: NSSize, screen: NSRect, mouse: NSPoint) -> NSRect {
    let corners = [NSPoint(x: screen.minX + 16, y: screen.minY + 16), NSPoint(x: screen.maxX - size.width - 16, y: screen.minY + 16), NSPoint(x: screen.minX + 16, y: screen.maxY - size.height - 16), NSPoint(x: screen.maxX - size.width - 16, y: screen.maxY - size.height - 16)]
    return corners.map { clampedFrame(NSRect(origin: $0, size: size), in: screen) }.max {
        hypot($0.midX - mouse.x, $0.midY - mouse.y) < hypot($1.midX - mouse.x, $1.midY - mouse.y)
    }!
}
struct WindowAnchor {
    let point: NSPoint
    let right: Bool
    let top: Bool
    init(frame: NSRect, screen: NSRect) {
        right = frame.midX > screen.midX; top = frame.midY > screen.midY
        point = NSPoint(x: right ? frame.maxX : frame.minX, y: top ? frame.maxY : frame.minY)
    }
    func frame(size: NSSize) -> NSRect {
        NSRect(x: right ? point.x - size.width : point.x, y: top ? point.y - size.height : point.y, width: size.width, height: size.height)
    }
}
final class CompanionPanel: NSPanel {
    var acceptsTyping = true
    override var canBecomeKey: Bool { acceptsTyping }
    override var canBecomeMain: Bool { false }
}
final class DockView: NSView {
    var appearanceChanged: (() -> Void)?
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); appearanceChanged?() }
    var open: (() -> Void)?
    var move: ((NSPoint) -> Void)?
    private var start = NSPoint.zero
    private var origin = NSPoint.zero
    private var moved = false
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { bounds.contains(point) ? self : nil }
    override func mouseDown(with event: NSEvent) { start = NSEvent.mouseLocation; origin = window!.frame.origin; moved = false }
    override func mouseDragged(with event: NSEvent) {
        let point = NSEvent.mouseLocation
        if hypot(point.x - start.x, point.y - start.y) > 3 { moved = true }
        move?(NSPoint(x: origin.x + point.x - start.x, y: origin.y + point.y - start.y))
    }
    override func mouseUp(with event: NSEvent) { if !moved { open?() } }
    override func accessibilityPerformPress() -> Bool { open?(); return true }
}
final class CompanionController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var onVisibility: ((Bool) -> Void)?
    var isStatusClick: ((NSPoint) -> Bool)?
    private var panel: CompanionPanel!
    private var dock: CompanionPanel!
    private var web: WKWebView!
    private var outsideMonitor: Any?
    private var spaceObserver: NSObjectProtocol?
    private var dragStart: (mouse: NSPoint, origin: NSPoint)?
    private var anchor: WindowAnchor?
    private var pending = false
    private var pinned: Bool
    private let preferenceKey: String
    private var agents: [AgentActivity] = []
    private var activityKnown = false
    private var activitySummary: [String: Any] = ["schemaVersion": 1, "sourceRevision": 0, "availability": "unpublished"]
    private var summaryRequest: URLSessionDataTask?
    private var endpointGeneration = 0
    private var hoverTimer: Timer?
    private var enteredPanel = false
    private var editing = false
    private var dockStateKey = ""

    private var page: URL?
    private var historyOnOpen = false
    var available: Bool { page != nil }
    private var screen: NSScreen { NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main! }

    private func makePanel(size: NSSize, typing: Bool) -> CompanionPanel {
        let result = CompanionPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        result.acceptsTyping = typing
        result.becomesKeyOnlyIfNeeded = true
        result.level = .floating
        result.isFloatingPanel = true
        result.hidesOnDeactivate = false
        result.isReleasedWhenClosed = false
        result.hasShadow = true
        result.isOpaque = false
        result.backgroundColor = .clear
        result.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        if #available(macOS 13.0, *) { result.collectionBehavior.insert(.canJoinAllApplications) }
        return result
    }
    init(preferenceKey: String) {
        self.preferenceKey = preferenceKey
        pinned = UserDefaults.standard.bool(forKey: preferenceKey)
        super.init()
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "companion")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.underPageBackgroundColor = .clear
        web.autoresizingMask = [.width, .height]
        panel = makePanel(size: NSSize(width: 400, height: 460), typing: true)
        panel.title = "Yonder"
        let container = NSView(frame: panel.contentView!.bounds)
        container.wantsLayer = true; container.layer?.cornerRadius = 24; container.layer?.masksToBounds = true
        web.frame = container.bounds; container.addSubview(web); panel.contentView = container


        dock = makePanel(size: NSSize(width: 56, height: 56), typing: false)
        dock.title = "Yonder 悬浮入口"
        let dockView = DockView(frame: dock.contentView!.bounds)
        dockView.wantsLayer = true; dockView.layer?.cornerRadius = 16
        dockView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        dockView.setAccessibilityElement(true); dockView.setAccessibilityRole(.button)
        dockView.setAccessibilityLabel("打开 Yonder，拖动可移动")
        let mark = NSImageView(frame: NSRect(x: 2, y: 2, width: 52, height: 52))
        let dockImage = NSImage(contentsOf: Bundle.main.url(forResource: "dock-mark", withExtension: "png")!)!
        dockImage.isTemplate = true
        mark.image = dockImage; mark.imageScaling = .scaleProportionallyUpOrDown; mark.contentTintColor = .labelColor
        dockView.addSubview(mark)
        dockView.open = { [weak self] in self?.showPanel() }
        dockView.move = { [weak self] origin in
            guard let self else { return }
            let candidate = WindowAnchor(frame: NSRect(origin: origin, size: self.dock.frame.size), screen: self.screen.visibleFrame)
            self.anchor = WindowAnchor(frame: clampedFrame(candidate.frame(size: self.panel.frame.size), in: self.screen.visibleFrame), screen: self.screen.visibleFrame)
            self.dock.setFrame(self.anchor!.frame(size: self.dock.frame.size), display: true)
        }
        dock.contentView = dockView
        dockView.appearanceChanged = { [weak self] in
            guard let self else { return }; self.dockStateKey = ""; self.renderDock()
        }
        outsideMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, self.panel.isVisible, !self.panel.frame.contains(NSEvent.mouseLocation) else { return }

            if self.isStatusClick?(NSEvent.mouseLocation) == true { return }
            self.collapse()
        }
        spaceObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.collapse() }
        // Proactive appearance is always the compact entry, including full-screen spaces.
        collapse()
        hoverTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self, self.pinned, self.panel.isVisible else { return }
            if self.panel.frame.contains(NSEvent.mouseLocation) { self.enteredPanel = true }
            else if self.enteredPanel && self.dragStart == nil && !self.editing && NSEvent.pressedMouseButtons == 0 { self.collapse() }
        }
        RunLoop.main.add(hoverTimer!, forMode: .common)
    }
    func setActivity(_ agents: [AgentActivity], known: Bool) {
        self.agents = agents; activityKnown = known
        publishActivity(); renderDock(); refreshActivitySummary()
    }
    private func renderDock() {
        let key = "\(activityKnown):\(dock.effectiveAppearance.name):" + agents.map { $0.name + $0.presentation(known: activityKnown, summary: activitySummary).description }.joined(separator: "\n")
        guard key != dockStateKey, let view = dock.contentView else { return }
        dockStateKey = key
        dock.setContentSize(NSSize(width: 310, height: max(56, 20 + max(1, agents.count) * 32)))
        renderActivityDock(view, agents: agents, known: activityKnown, summary: activitySummary)
        if dock.isVisible { ensureAnchor(); dock.setFrame(anchor!.frame(size: dock.frame.size), display: true) }
    }
    private func refreshActivitySummary() {
        guard summaryRequest == nil, let page else { return }
        let generation = endpointGeneration
        var request = URLRequest(url: page.appendingPathComponent("activity-summary"))
        request.timeoutInterval = 1.8
        summaryRequest = URLSession.shared.dataTask(with: request) { [weak self] bytes, response, _ in
            DispatchQueue.main.async {
                guard let self, self.endpointGeneration == generation else { return }
                self.summaryRequest = nil
                let next: [String: Any]
                if (response as? HTTPURLResponse)?.statusCode == 200, let bytes,
                   let data = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] { next = validatedActivitySummary(data) }
                else { next = ["availability": "unavailable"] }
                if let revision = next["sourceRevision"] as? Int, revision < (self.activitySummary["sourceRevision"] as? Int ?? -1) { return }
                self.activitySummary = next; self.publishActivity(); self.renderDock()
            }
        }
        summaryRequest?.resume()
    }
    private func publishActivity() {
        let data: [String: Any] = ["agents": agents.map { $0.json }, "known": activityKnown, "pinned": pinned, "activitySummary": activitySummary]
        guard let bytes = try? JSONSerialization.data(withJSONObject: data), let json = String(data: bytes, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.yonderUI?.activity(\(json))", completionHandler: nil)
    }
    func setEndpoint(_ next: URL?) {
        guard next != page else { return }
        pending = false; panel.orderOut(nil); dock.orderOut(nil); onVisibility?(false)
        endpointGeneration += 1; summaryRequest?.cancel(); summaryRequest = nil
        activitySummary = ["schemaVersion": 1, "sourceRevision": 0, "availability": "unpublished"]
        dockStateKey = ""
        page = next
        renderDock(); publishActivity()
        if let next { web.load(URLRequest(url: next)); if pinned { collapse() } }
        else { web.loadHTMLString("", baseURL: nil) }
    }
    func showHistory() { showPanel(history: true) }
    func showCurrent() { showPanel() }

    private func ensureAnchor() {
        if anchor == nil || !NSScreen.screens.contains(where: { $0.visibleFrame.contains(anchor!.point) }) {
            anchor = WindowAnchor(frame: awayFrame(size: panel.frame.size, screen: screen.visibleFrame, mouse: NSEvent.mouseLocation), screen: screen.visibleFrame)
        }
    }
    private func showPanel(history: Bool = false) {
        guard available else { return }
        enteredPanel = false
        historyOnOpen = history
        if history { web.evaluateJavaScript("window.yonderUI?.history()", completionHandler: nil) }
        else { web.evaluateJavaScript("window.yonderUI?.current()", completionHandler: nil) }
        ensureAnchor()
        panel.setFrame(anchor!.frame(size: panel.frame.size), display: true)
        dock.orderOut(nil)
        // Never activate the app or make a window key on presentation.
        panel.orderFrontRegardless()
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('yonder-visibility',{detail:true}))", completionHandler: nil)
        onVisibility?(true)
    }
    private func collapse() {
        ensureAnchor()
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('yonder-visibility',{detail:false}))", completionHandler: nil)
        panel.orderOut(nil)
        if available && (pending || pinned) {
            dock.setFrame(anchor!.frame(size: dock.frame.size), display: true)
            dock.orderFrontRegardless()
        } else { dock.orderOut(nil) }
        onVisibility?(false)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let page, message.frameInfo.request.url?.absoluteString == page.absoluteString,
              let data = message.body as? [String: Any], let action = data["action"] as? String else { return }
        switch action {
        case "close": collapse()
        case "editing": editing = data["value"] as? Bool ?? false
        case "pin":
            pinned.toggle(); UserDefaults.standard.set(pinned, forKey: preferenceKey)
            publishActivity()
            if !panel.isVisible { collapse() }
        case "open": showPanel()
        case "attention": pending = true; if !panel.isVisible { collapse() }
        case "state":
            pending = data["pending"] as? Bool ?? false
            if !panel.isVisible { collapse() }
        case "drag-start": dragStart = (NSEvent.mouseLocation, panel.frame.origin)
        case "drag-move":
            if let start = dragStart {
                let mouse = NSEvent.mouseLocation
                let origin = NSPoint(x: start.origin.x + mouse.x - start.mouse.x, y: start.origin.y + mouse.y - start.mouse.y)
                panel.setFrame(clampedFrame(NSRect(origin: origin, size: panel.frame.size), in: screen.visibleFrame), display: true)
                anchor = WindowAnchor(frame: panel.frame, screen: screen.visibleFrame)
            }
        case "drag-end": dragStart = nil
        default: break
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        publishActivity()
        if historyOnOpen && panel.isVisible { web.evaluateJavaScript("window.yonderUI?.history()", completionHandler: nil) }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('yonder-visibility',{detail:\(panel.isVisible)}))", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if let page, url.absoluteString == page.absoluteString { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func stop() {
        summaryRequest?.cancel()
        hoverTimer?.invalidate()
        panel.orderOut(nil); dock.orderOut(nil)
        if let outsideMonitor { NSEvent.removeMonitor(outsideMonitor) }
        if let spaceObserver { NSWorkspace.shared.notificationCenter.removeObserver(spaceObserver) }
        web.configuration.userContentController.removeScriptMessageHandler(forName: "companion")
    }
}
func checkCompanionGeometry() {
    for screen in [NSRect(x: 0,y: 0,width: 1440,height: 900),NSRect(x: -1920,y: 0,width: 1920,height: 1080)] {
        for mouse in [NSPoint(x:screen.minX+30,y:screen.minY+30),NSPoint(x:screen.maxX-30,y:screen.maxY-30)] {
            let frame = awayFrame(size: NSSize(width:400,height:460),screen:screen,mouse:mouse)
            precondition(screen.contains(frame)); precondition(!frame.insetBy(dx:-80,dy:-80).contains(mouse))
            let anchor = WindowAnchor(frame: frame, screen: screen)
            let icon = anchor.frame(size: NSSize(width:56,height:56))
            precondition(frame.contains(icon))
            precondition(anchor.frame(size:frame.size) == frame)
            precondition((anchor.right ? icon.maxX : icon.minX) == anchor.point.x)
            precondition((anchor.top ? icon.maxY : icon.minY) == anchor.point.y)
        }
        let dragged = clampedFrame(NSRect(x: screen.minX-100,y:screen.maxY+100,width:400,height:460),in:screen)
        precondition(screen.contains(dragged))
    }
    print("Passed: pointer avoidance, screen containment, negative-coordinate display, drag bounds, shared expand/collapse anchor.")
}

struct DesktopEndpoint: Decodable {
    let url: URL
    let pid: Int32
    static func read(_ data: Data) -> URL? {
        guard let endpoint = try? JSONDecoder().decode(Self.self, from: data),
              endpoint.pid > 0, (kill(endpoint.pid, 0) == 0 || errno == EPERM),
              let parts = URLComponents(url: endpoint.url, resolvingAgainstBaseURL: false),
              parts.scheme == "http", parts.host == "127.0.0.1", let port = parts.port, port > 0, port <= 65535,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              endpoint.url.pathComponents.count == 2,
              UUID(uuidString: endpoint.url.pathComponents[1]) != nil
        else { return nil }
        return endpoint.url
    }
}

// Local-only, explicitly labelled fixture preview. Never starts the status host, reads home or presents a window.
func checkActivityCases(_ path: String) -> [[String: Any]] {
    let data = try! Data(contentsOf: URL(fileURLWithPath: path))
    let cases = try! JSONSerialization.jsonObject(with: data) as! [[String: Any]]
    for item in cases {
        let agent = AgentActivity(item["agent"] as! [String: Any])!
        let result = agent.presentation(known: item["known"] as! Bool, summary: item["summary"] as! [String: Any])
        let expected = item["expected"] as! [String: Any]
        precondition(result.state == expected["state"] as! String, item["name"] as! String)
        precondition(result.label == expected["label"] as! String, item["name"] as! String)
        precondition(result.emphasized == expected["emphasized"] as! Bool, item["name"] as! String)
    }
    print("Passed: \(cases.count) shared Swift/JS execution and visible summary cases.")
    return cases
}
func previewActivityCases(_ cases: [[String: Any]], directory: String) {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.accessory)
    try! FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
    for dark in [false, true] {
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)!
        let height = CGFloat(110 + ((cases.count + 1) / 2) * 62)
        let canvas = NSView(frame: NSRect(x: 0, y: 0, width: 660, height: height))
        canvas.appearance = appearance; canvas.wantsLayer = true
        appearance.performAsCurrentDrawingAppearance { canvas.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor }
        let heading = NSTextField(labelWithString: "AppKit 测试预览 · 候选、未装机 · \(dark ? "深色" : "浅色")")
        heading.frame = NSRect(x: 20, y: height - 42, width: 620, height: 24); heading.font = .boldSystemFont(ofSize: 16)
        canvas.addSubview(heading)
        let note = NSTextField(labelWithString: "真实 Dock 组件离屏渲染；合成 fixture，非运行数据；状态灯静态，减少动态同样适用。")
        note.frame = NSRect(x: 20, y: height - 66, width: 620, height: 20); note.font = .systemFont(ofSize: 11)
        canvas.addSubview(note)
        for (index, item) in cases.enumerated() {
            let x = CGFloat(12 + (index % 2) * 324)
            let y = height - 142 - CGFloat((index / 2) * 62)
            let row = NSView(frame: NSRect(x: x, y: y, width: 310, height: 56))
            row.wantsLayer = true; row.layer?.cornerRadius = 12; row.appearance = appearance
            canvas.addSubview(row)
            renderActivityDock(row, agents: [AgentActivity(item["agent"] as! [String: Any])!], known: item["known"] as! Bool, summary: item["summary"] as! [String: Any])
        }
        canvas.layoutSubtreeIfNeeded()
        let bitmap = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds)!
        appearance.performAsCurrentDrawingAppearance { canvas.cacheDisplay(in: canvas.bounds, to: bitmap) }
        let path = URL(fileURLWithPath: directory).appendingPathComponent("native-\(dark ? "dark" : "light").png")
        try! bitmap.representation(using: .png, properties: [:])!.write(to: path)
        print("Rendered real AppKit compact component: \(path.path)")
    }
}

func checkDynamicActivityAppearance(_ item: [String: Any]) {
    _ = NSApplication.shared
    let view = DockView(frame: NSRect(x: 0, y: 0, width: 310, height: 56))
    view.wantsLayer = true; view.appearance = NSAppearance(named: .aqua)
    let agent = AgentActivity(item["agent"] as! [String: Any])!
    let render = { renderActivityDock(view, agents: [agent], known: true, summary: item["summary"] as! [String: Any]) }
    render()
    let light = view.subviews[0].layer!.backgroundColor!
    var callbacks = 0
    view.appearanceChanged = { callbacks += 1; render() }
    view.appearance = NSAppearance(named: .darkAqua)
    let dark = view.subviews[0].layer!.backgroundColor!
    precondition(callbacks > 0 && light != dark, "Effective appearance must repaint cached CGColors")
    precondition(dark == ActivityColors.color("running", dark: true).cgColor)
    precondition(view.subviews[0].layer!.animationKeys() == nil)
    precondition((view.subviews[1] as! NSTextField).font == NSFont.systemFont(ofSize: 11, weight: .bold))
    precondition(view.accessibilityLabel()!.contains("运行中"))
    view.appearanceChanged = nil
    print("Passed: real DockView effective-appearance callback recolors light→dark; static light, bold name and accessible status.")
}

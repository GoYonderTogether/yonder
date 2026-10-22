import AppKit
@preconcurrency import ApplicationServices
import PermissionFlow

func axValue(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
    return value
}
func axFrame(_ element: AXUIElement) -> CGRect? {
    guard let p = axValue(element, "AXPosition"), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = axValue(element, "AXSize"), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
@MainActor func settingsGeometry() -> (window: CGRect, list: CGRect?, screen: CGRect)? {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.systempreferences").first,
          let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
          let frame = windows.filter({ ($0[kCGWindowOwnerPID as String] as? pid_t) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 })
            .compactMap({ ($0[kCGWindowBounds as String] as? NSDictionary).flatMap { CGRect(dictionaryRepresentation: $0) } })
            .filter({ $0.width > 320 && $0.height > 240 }).max(by: { $0.width * $0.height < $1.width * $1.height }),
          let primary = NSScreen.screens.first else { return nil }
    func convert(_ rect: CGRect) -> CGRect { CGRect(x: rect.minX, y: primary.frame.maxY - rect.maxY, width: rect.width, height: rect.height) }
    let window = convert(frame)
    guard let screen = NSScreen.screens.max(by: {
        $0.frame.intersection(window).area < $1.frame.intersection(window).area
    }) else { return nil }
    var lists: [CGRect] = []
    if AXIsProcessTrusted() {
        let element = AXUIElementCreateApplication(app.processIdentifier)
        // Scope AX reads to the matching visible Settings window; never scan another app.
        if let windows = axValue(element, "AXWindows") as? [AXUIElement],
           let target = windows.first(where: { axFrame($0).map { abs($0.minX - frame.minX) < 4 && abs($0.minY - frame.minY) < 4 } == true }) {
            var budget = 1000
            func visit(_ node: AXUIElement, _ depth: Int) {
                guard depth < 18, budget > 0 else { return }; budget -= 1
                if let role = axValue(node, "AXRole") as? String, ["AXList", "AXTable", "AXOutline"].contains(role),
                   let rect = axFrame(node), rect.width > 200, rect.height > 40,
                   rect.minX > frame.minX + frame.width * 0.3, frame.contains(rect) {
                    // Keep the list's containing scroll area/controls clear as well.
                    if let parent = axValue(node, "AXParent"), CFGetTypeID(parent) == AXUIElementGetTypeID(),
                       let parentFrame = axFrame(parent as! AXUIElement), frame.contains(parentFrame), parentFrame.minX > frame.minX + frame.width * 0.3 {
                        lists.append(convert(parentFrame))
                    } else { lists.append(convert(rect)) }
                }
                for child in axValue(node, "AXChildren") as? [AXUIElement] ?? [] { visit(child, depth + 1) }
            }
            visit(target, 0)
        }
    }
    // The lowest list keeps all permission sections and their +/- controls unobscured.
    return (window, lists.min(by: { $0.minY < $1.minY }), screen.visibleFrame)
}
private extension CGRect { var area: CGFloat { isNull ? 0 : width * height } }

func freshScreenAccess() throws -> Bool {
    let process = Process(), output = Pipe()
    process.executableURL = Bundle.main.executableURL
    process.arguments = ["--screen-probe"]
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0, let value = String(data: data, encoding: .utf8), ["true\n", "false\n"].contains(value) else { throw failure("Fresh screen preflight failed") }
    return data == Data("true\n".utf8)
}

struct ObservationResult: Encodable {
    let outcome: String
    let exitCode: Int
    let permission: Record
}
func observationOutcome(state: String, closed: Bool, timedOut: Bool) -> String? {
    if closed { return "closed" }
    if state == "granted" { return "granted" }
    if timedOut { return "timeout" }
    return nil
}
@MainActor func observePermission(_ kind: String, identity: Identity, guide: Bool, deadline: Date) async throws -> ObservationResult {
    let controller: PermissionFlowController?
    var closed = false, restart = false
    if guide {
        let flow = PermissionFlowController(configuration: .init(requiredAppURLs: [Bundle.main.bundleURL], promptForAccessibilityTrust: false, localeIdentifier: "zh-Hans"))
        flow.onClose = { closed = true }
        var lastFrame = CGRect.null
        flow.panelFrame = { _, size in
            guard let geometry = settingsGeometry() else { return .zero }
            let frame = guideFrame(settings: geometry.window, list: geometry.list, screen: geometry.screen, size: size)
            if frame != lastFrame {
                lastFrame = frame
                func numbers(_ rect: CGRect) -> [CGFloat] { [rect.minX, rect.minY, rect.width, rect.height] }
                try? emit(["geometry": ["settings": numbers(geometry.window), "list": geometry.list.map(numbers) ?? [], "guide": numbers(frame), "screen": numbers(geometry.screen)]])
                if frame.isEmpty { try? emit(["nextStep": "请将 System Settings 窗口上移，为列表下方的引导窗留出空间。"] ) }
            }
            return frame
        }
        if let pane = panes[kind] { flow.authorize(pane: pane, suggestedAppURLs: [Bundle.main.bundleURL]) }
        else { openSettings(kind) }
        controller = flow
    } else { controller = nil }
    defer { controller?.onClose = nil; controller?.closePanel() }
    while true {
        try checkCancellation()
        var record = try await status(identity).first { $0.kind == kind }!
        if kind == "screen-recording", record.state != "granted", try freshScreenAccess() {
            record = try await status(identity, restartKind: kind).first { $0.kind == kind }!
            controller?.guidanceMessage = "需要重启 Helper / Restart required"
            controller?.restartAction = { restart = true }
            if !guide { restart = true }
        } else {
            controller?.restartAction = nil
            controller?.guidanceMessage = record.state == "revoked-detected" ? "授权已撤销 / Revoked" : nil
        }
        controller?.refreshPanel()
        try emit([record])
        if restart { return ObservationResult(outcome: "relaunch", exitCode: 0, permission: record) }
        if let outcome = observationOutcome(state: record.state, closed: closed, timedOut: Date() >= deadline) {
            if outcome == "granted" {
                controller?.guidanceMessage = "已授权 / Granted"
                controller?.refreshPanel()
                if guide {
                    try await Task.sleep(for: .seconds(1))
                    // A revoke during confirmation must not be reported as success.
                    let checked = try await status(identity).first { $0.kind == kind }!
                    if checked.state != "granted" || closed { continue }
                    record = checked
                }
                return ObservationResult(outcome: outcome, exitCode: 0, permission: record)
            }
            record = try await status(identity, interruptedKind: kind).first { $0.kind == kind }!
            return ObservationResult(outcome: outcome, exitCode: 1, permission: record)
        }
        try await Task.sleep(for: .seconds(1))
    }
}

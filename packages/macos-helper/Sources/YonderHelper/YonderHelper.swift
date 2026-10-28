import AppKit
@preconcurrency import ApplicationServices
import AVFoundation
import Carbon
import ImageIO

import PermissionFlow
import PermissionFlowInputMonitoringStatus
import PermissionFlowScreenRecordingStatus
import Security
import UserNotifications

let kinds = ["accessibility", "screen-recording", "input-monitoring", "camera", "microphone", "notifications", "automation", "full-disk-access", "files-and-folders", "location"]
struct Identity: Codable, Equatable {
    let bundleID: String
    let path: String
    let codeHash: String
    let designatedRequirement: String
}
struct Probe: Codable {
    let kind: String
    let granted: Bool?
    let observable: Bool
    let raw: String
}
struct Record: Codable {
    var kind: String
    var state: String
    var lastCheckedAt: String
    var lastRequestedAt: String?
    var grantedAt: String?
    var responsibleIdentity: Identity
    var raw: String
    var nextStep: String
    var wasGranted: Bool
    var previousCodeHash: String?
    enum CodingKeys: String, CodingKey { case kind, state, lastCheckedAt, lastRequestedAt, grantedAt, responsibleIdentity, raw, nextStep, wasGranted, previousCodeHash }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind); try container.encode(state, forKey: .state)
        try container.encode(lastCheckedAt, forKey: .lastCheckedAt); try container.encode(lastRequestedAt, forKey: .lastRequestedAt)
        try container.encode(grantedAt, forKey: .grantedAt)
        try container.encode(responsibleIdentity, forKey: .responsibleIdentity); try container.encode(raw, forKey: .raw)
        try container.encode(nextStep, forKey: .nextStep); try container.encode(wasGranted, forKey: .wasGranted)
        try container.encode(previousCodeHash, forKey: .previousCodeHash)
    }
}
func transition(_ probe: Probe, previous: Record?, identity: Identity, now: String, requested: Bool = false, restartNeeded: Bool = false, interrupted: Bool = false) -> Record {
    let same = previous?.responsibleIdentity == identity
    let requestedAt = requested ? now : previous?.lastRequestedAt
    let state: String
    if !probe.observable { state = "unobservable" }
    else if probe.granted == true { state = "granted" }
    else if restartNeeded { state = "needs-restart" }
    else if interrupted && requestedAt != nil && previous?.state != "revoked-detected" { state = "requested" }
    else if let previous, (!same && previous.wasGranted) || (same && previous.state == "needs-restart" && !requested) { state = "needs-restart" }
    else if probe.granted == nil { state = "unknown" }
    else if same && previous?.wasGranted == true { state = "revoked-detected" }
    else if requestedAt != nil { state = "requested" }
    else { state = "not-granted" }
    let cli = "\(URL(fileURLWithPath: identity.path).deletingLastPathComponent().path)/yonder-permissions"
    let command = "'\(cli.replacingOccurrences(of: "'", with: "'\\''"))'"
    var next = state == "granted" ? "本次 helper 原生探针已授权。" : "请主人运行 \(command) request \(probe.kind)，再运行 \(command) status。AI 不代授权。"
    if probe.kind == "automation" && state == "unknown" { next = "System Events 目标当前不可预检（可能未运行）；请主人启动目标后重查，或显式运行 \(command) request automation。" }
    if state == "unobservable" { next = "无法全局安全预检；请主人检查具体文件资源及系统设置。\(command) guide \(probe.kind)" }
    if state == "requested" { next = "曾发起请求（不代表待审批或已拒绝）；请主人完成系统提示，再运行 \(command) status；需要设置引导：\(command) guide \(probe.kind)。" }
    if state == "needs-restart" { next = "需要重启 Helper；代码身份变化或当前进程的屏幕授权缓存尚未生效。请主人运行 \(command) guide \(probe.kind)，按重启按钮后重新检查。重启不保证恢复授权。" }
    let previousHash = !same ? previous?.responsibleIdentity.codeHash : previous?.previousCodeHash
    if previousHash != nil && state != "granted" && state != "needs-restart" {
        next = "同路径 helper 代码身份曾变化，旧授权可能失效；请按当前身份检查。" + next
    }
    return Record(kind: probe.kind, state: state, lastCheckedAt: now, lastRequestedAt: requestedAt, grantedAt: probe.granted == true ? (same && previous?.state == "granted" ? previous?.grantedAt ?? now : now) : previous?.grantedAt,
                  responsibleIdentity: identity, raw: probe.raw, nextStep: next,
                  wasGranted: probe.granted == true || (same && previous?.wasGranted == true), previousCodeHash: previousHash)
}
func failure(_ message: String) -> NSError { NSError(domain: "YonderHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
func identity() throws -> Identity {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { throw failure("Cannot identify own signed code") }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { throw failure("Missing static code") }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let dict = info as? [String: Any], let hash = dict[kSecCodeInfoUnique as String] as? Data else { throw failure("Missing code signature hash") }
    var requirement: SecRequirement?
    var requirementText: CFString?
    if SecCodeCopyDesignatedRequirement(staticCode, [], &requirement) == errSecSuccess, let requirement {
        SecRequirementCopyString(requirement, [], &requirementText)
    }
    return Identity(bundleID: Bundle.main.bundleIdentifier ?? "unknown", path: Bundle.main.bundleURL.path,
                    codeHash: hash.map { String(format: "%02x", $0) }.joined(),
                    designatedRequirement: requirementText as String? ?? "unknown")
}
@MainActor func probes() async -> [Probe] {
    let ax = AXIsProcessTrusted(), screen = CGPreflightScreenCaptureAccess(), input = CGPreflightListenEventAccess()
    // Real native comparison in the shipped binary; no substitute OS probe.
    precondition((AccessibilityPermissionStatusProvider().authorizationState() == .granted) == ax)
    precondition((ScreenRecordingPermissionStatusProvider().authorizationState() == .granted) == screen)
    precondition((InputMonitoringPermissionStatusProvider().authorizationState() == .granted) == input)
    var result = [Probe(kind: "accessibility", granted: ax, observable: true, raw: "AXIsProcessTrusted=\(ax)"),
                  Probe(kind: "screen-recording", granted: screen, observable: true, raw: "CGPreflightScreenCaptureAccess=\(screen)"),
                  Probe(kind: "input-monitoring", granted: input, observable: true, raw: "CGPreflightListenEventAccess=\(input)")]
    for (kind, media) in [("camera", AVMediaType.video), ("microphone", .audio)] {
        let status = AVCaptureDevice.authorizationStatus(for: media)
        result.append(Probe(kind: kind, granted: status == .authorized, observable: true, raw: "AVCaptureDevice.authorizationStatus=\(status.rawValue)"))
    }
    let notifications = await UNUserNotificationCenter.current().notificationSettings()
    result.append(Probe(kind: "notifications", granted: [.authorized, .provisional].contains(notifications.authorizationStatus), observable: true, raw: "UNNotificationSettings.authorizationStatus=\(notifications.authorizationStatus.rawValue)"))
    let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.systemevents")
    let automation = AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, false)
    result.append(Probe(kind: "automation", granted: automation == noErr ? true : ([OSStatus(-1743), OSStatus(-1744)].contains(automation) ? false : nil), observable: true, raw: "AEDeterminePermissionToAutomateTarget(ask=false,target=com.apple.systemevents)=\(automation)"))
    for kind in ["full-disk-access", "files-and-folders"] {
        result.append(Probe(kind: kind, granted: nil, observable: false, raw: "No universal non-prompting API; no protected resources probed"))
    }
    return result
}
nonisolated(unsafe) var cancellationFile: String?
func checkCancellation() throws {
    if let cancellationFile, FileManager.default.fileExists(atPath: cancellationFile) { throw failure("Helper request cancelled before input") }
}
let stateDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/yonder/helper")
@MainActor func status(_ identity: Identity, requestedKind: String? = nil, restartKind: String? = nil, interruptedKind: String? = nil) async throws -> [Record] {
    let current = await probes()
    try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let fd = open(stateDirectory.appendingPathComponent("permissions.lock").path, O_CREAT | O_RDWR, 0o600)
    guard fd >= 0 else { throw failure("Cannot open state lock") }
    defer { close(fd) }
    guard lockf(fd, F_LOCK, 0) == 0 else { throw failure("Cannot lock state") }
    let url = stateDirectory.appendingPathComponent("permissions-state.json")
    let prior: [Record]
    if FileManager.default.fileExists(atPath: url.path) { prior = try JSONDecoder().decode([Record].self, from: Data(contentsOf: url)) }
    else { prior = [] }
    let now = ISO8601DateFormatter().string(from: Date())
    let records = current.map { probe in transition(probe, previous: prior.first { $0.kind == probe.kind }, identity: identity, now: now, requested: probe.kind == requestedKind, restartNeeded: probe.kind == restartKind, interrupted: probe.kind == interruptedKind) }
    try JSONEncoder().encode(records).write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    return records
}
func emit<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(value)); FileHandle.standardOutput.write(Data([10]))
}
let panes: [String: PermissionFlowPane] = ["accessibility": .accessibility, "screen-recording": .screenRecording, "input-monitoring": .inputMonitoring, "camera": .camera, "microphone": .microphone, "full-disk-access": .fullDiskAccess]
@MainActor func request(_ kind: String) async throws {
    switch kind {
    case "accessibility": _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    case "screen-recording": _ = CGRequestScreenCaptureAccess()
    case "input-monitoring": _ = CGRequestListenEventAccess()
    case "camera", "microphone": _ = await AVCaptureDevice.requestAccess(for: kind == "camera" ? .video : .audio)
    case "notifications": _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    case "automation":
        let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.systemevents")
        _ = AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, true)
    default: openSettings(kind)
    }
}
@MainActor func openSettings(_ kind: String) {
    if kind == "notifications" {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!); return
    }
    let anchor = ["automation": "Privacy_Automation", "files-and-folders": "Privacy_FilesAndFolders"][kind] ?? "Privacy_AllFiles"
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)")!)
}
func number(_ args: [String: Any], _ key: String) throws -> Int {
    guard let value = args[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite,
          value.doubleValue.rounded() == value.doubleValue, abs(value.doubleValue) <= 1_000_000 else { throw failure("Invalid integer \(key)") }
    return value.intValue
}
@MainActor func desktop(_ args: [String: Any], records: [Record]) throws -> [String: String] {
    guard let action = args["action"] as? String else { throw failure("Missing action") }
    func require(_ kind: String) throws {
        guard records.first(where: { $0.kind == kind })?.state == "granted" else {
            let record = records.first { $0.kind == kind }!
            throw failure("\(kind): \(record.state). \(record.nextStep)")
        }
    }
    try checkCancellation()
    if action == "screenshot" {
        try require("screen-recording")
        guard let path = args["path"] as? String, path.hasPrefix("/") else { throw failure("Missing absolute screenshot path") }
        guard let image = CGDisplayCreateImage(CGMainDisplayID()),
              let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil) else { throw failure("Screen capture failed; recheck Screen Recording and restart helper") }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw failure("Could not save screenshot") }
        return ["path": path, "source": "Yonder Helper CoreGraphics (main display)"]
    }
    try require("accessibility")
    if action == "snapshot" {
        guard let app = NSWorkspace.shared.frontmostApplication else { throw failure("No frontmost application") }
        let element = AXUIElementCreateApplication(app.processIdentifier)
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &value)
        guard error == .success else { throw failure("AX windows error \(error.rawValue)") }
        let titles = (value as? [AXUIElement] ?? []).compactMap { window -> String? in
            var title: CFTypeRef?; AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &title); return title as? String
        }
        return ["application": app.localizedName ?? app.bundleIdentifier ?? "unknown", "windows": titles.joined(separator: "\n")]
    }
    let source = CGEventSource(stateID: .hidSystemState)
    func post(_ event: CGEvent?) throws { guard let event else { throw failure("Cannot create input event") }; event.post(tap: .cghidEventTap) }
    func mouse(_ type: CGEventType, _ x: Int, _ y: Int, _ button: CGMouseButton = .left) throws {
        try post(CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: button))
    }
    switch action {
    case "move", "click", "drag":
        let x = try number(args, "x"), y = try number(args, "y")
        if action == "move" { try mouse(.mouseMoved, x, y) }
        else if action == "click" {
            guard args["button"] == nil || ["left", "right"].contains(args["button"] as? String ?? "") else { throw failure("Invalid button") }
            let right = args["button"] as? String == "right"
            try mouse(right ? .rightMouseDown : .leftMouseDown, x, y, right ? .right : .left)
            try mouse(right ? .rightMouseUp : .leftMouseUp, x, y, right ? .right : .left)
        } else {
            let toX = try number(args, "toX"), toY = try number(args, "toY")
            try mouse(.leftMouseDown, x, y); try mouse(.leftMouseDragged, toX, toY); try mouse(.leftMouseUp, toX, toY)
        }
    case "type":
        guard let text = args["text"] as? String, text.utf16.count <= 20000 else { throw failure("Invalid text") }
        // ponytail: one CGEvent per Unicode scalar; use pasteboard only if large-text performance requires it.
        for scalar in text.unicodeScalars {
            try checkCancellation()
            let units = Array(String(scalar).utf16)
            for down in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { throw failure("Cannot create Unicode event") }
                event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units); try post(event)
            }
        }
    case "key":
        let key = try number(args, "keyCode"); guard (0...127).contains(key) else { throw failure("Invalid keyCode") }
        let mapping: [String: CGEventFlags] = ["command down": .maskCommand, "control down": .maskControl, "option down": .maskAlternate, "shift down": .maskShift]
        guard args["modifiers"] == nil || args["modifiers"] is [String] else { throw failure("Invalid modifiers") }
        let modifiers = args["modifiers"] as? [String] ?? []
        guard modifiers.allSatisfy({ mapping[$0] != nil }) else { throw failure("Invalid modifier") }
        for down in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: down) else { throw failure("Cannot create key event") }
            event.flags = modifiers.reduce(CGEventFlags()) { $0.union(mapping[$1]!) }; try post(event)
        }
    default: throw failure("Unknown desktop action")
    }
    return ["action": action, "performed": "true"]
}
@main struct YonderHelper {
    @MainActor static func main() {
        // Service lifecycle modes must never initialize AppKit or permission
        // probes. The business root remains a descendant of this signed binary.
        if ["service-host", "service-group-anchor", "service-command-anchor", "service-cleanup", "service-verify-anchor", "service-verify-member"].contains(CommandLine.arguments.dropFirst().first ?? "") {
            exit(HelperServiceHost.run(Array(CommandLine.arguments.dropFirst())))
        }
        // Start AppKit outside a Swift task: app.run() must not block the main actor job.
        if CommandLine.arguments.dropFirst().first == "--screen-probe" {
            print(CGPreflightScreenCaptureAccess() ? "true" : "false"); return
        }
        NSApplication.shared.setActivationPolicy(.accessory)
        Task { @MainActor in await execute(); exit(0) }
        NSApplication.shared.run()
    }
    @MainActor static func execute() async {
        do {
            var arguments = Array(CommandLine.arguments.dropFirst())
            if arguments.count >= 2, arguments[arguments.count - 2] == "--pid-file" {
                let pidPath = arguments.removeLast()
                cancellationFile = URL(fileURLWithPath: pidPath).deletingLastPathComponent().appendingPathComponent("cancelled").path
                try String(getpid()).write(toFile: pidPath, atomically: true, encoding: .utf8)
                arguments.removeLast()
            }
            guard PermissionFlowResources.packageBundle != nil else { throw failure("Missing PermissionFlow resources") }
            let id = try identity()
            if arguments == ["rpc"] {
                let data = FileHandle.standardInput.readDataToEndOfFile()
                guard data.count <= 100000, let args = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw failure("Invalid JSON request") }
                try checkCancellation()
                let action = args["action"] as? String ?? ""
                if action == "file-list" || action == "file-export" {
                    let output = try HelperFiles.run(args, cancelled: checkCancellation)
                    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])); return
                }
                if ["location-status", "location-request", "location-collect"].contains(action) {
                    try emit(await HelperLocation(subject: id).run(args)); return
                }
                let records = try await status(id)
                if action == "status" || action == "permissions" {
                    let output: [String: Any] = ["permissions": try JSONSerialization.jsonObject(with: JSONEncoder().encode(records)),
                        "screenCapture": records.first { $0.kind == "screen-recording" }?.state == "granted",
                        "accessibility": records.first { $0.kind == "accessibility" }?.state == "granted", "pid": getpid(), "parentPID": getppid(),
                        "probeChecks": ["passed": 4, "failed": 0], "launch": "LaunchServices; executable itself performs probes and actions"]
                    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])); return
                }
                if action == "self-check" {
                    var count = 0
                    for probe in await probes() {
                        let first = transition(probe, previous: nil, identity: id, now: "1")
                        precondition(first.state == (!probe.observable ? "unobservable" : probe.granted == true ? "granted" : probe.granted == nil ? "unknown" : "not-granted")); count += 1
                    }
                    let yes = Probe(kind: "accessibility", granted: true, observable: true, raw: "explicit recorded grant"), no = Probe(kind: "accessibility", granted: false, observable: true, raw: "explicit recorded revocation")
                    let grant = transition(yes, previous: nil, identity: id, now: "1")
                    precondition(transition(no, previous: grant, identity: id, now: "2").state == "revoked-detected"); count += 1
                    let asked = transition(no, previous: nil, identity: id, now: "2", requested: true)
                    precondition(asked.state == "requested" && asked.lastRequestedAt == "2"); count += 1
                    let changed = Identity(bundleID: id.bundleID, path: id.path, codeHash: "explicit changed code hash", designatedRequirement: id.designatedRequirement)
                    precondition(transition(no, previous: grant, identity: changed, now: "3").state == "needs-restart"); count += 1
                    precondition(transition(no, previous: asked, identity: changed, now: "3").previousCodeHash == id.codeHash); count += 1
                    let pendingRestart = transition(no, previous: grant, identity: changed, now: "3")
                    precondition(transition(no, previous: pendingRestart, identity: changed, now: "4").state == "needs-restart"); count += 1
                    precondition(transition(yes, previous: pendingRestart, identity: changed, now: "4").state == "granted"); count += 1
                    count += guideSelfCheck(identity: id)
                    try emit(["passed": count, "failed": 0]); return
                }
                try emit(desktop(args, records: records)); return
            }
            var timeout: TimeInterval = 600
            if arguments.count == 4, arguments[2] == "--timeout" {
                guard let seconds = TimeInterval(arguments[3]), seconds.isFinite, seconds > 0, seconds <= 600 else { throw failure("Invalid timeout (0 < seconds <= 600)") }
                timeout = seconds; arguments.removeLast(2)
            }
            guard arguments.count == 2, ["request", "guide", "watch"].contains(arguments[0]), kinds.contains(arguments[1]) else { throw failure("Usage: yonder-permissions status | request|guide|watch <kind> [--timeout <seconds>]") }
            let command = arguments[0], kind = arguments[1]
            if kind == "location" {
                guard command == "request" else { throw failure("Location supports status/request/collect RPC, not guide/watch") }
                try emit(await HelperLocation(subject: id).run(["action": "location-request"])); return
            }
            if command != "watch" { _ = try await status(id, requestedKind: kind) }
            if command == "request" { try await request(kind); try emit(await status(id).filter { $0.kind == kind }); return }
            let result = try await observePermission(kind, identity: id, guide: command == "guide", deadline: Date().addingTimeInterval(timeout))
            try emit(result)
            exit(Int32(result.exitCode))
        } catch {
            try? emit(["error": error.localizedDescription]); exit(1)
        }
    }
}

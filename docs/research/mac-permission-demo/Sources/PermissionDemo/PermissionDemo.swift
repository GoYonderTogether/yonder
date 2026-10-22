import AppKit
import ApplicationServices
import AVFoundation
import Carbon
import PermissionFlow
import PermissionFlowInputMonitoringStatus
import PermissionFlowScreenRecordingStatus
import UserNotifications

/// Research only. A successful check here does not establish Yonder service access.
@main
struct PermissionDemo {
    @MainActor static func main() async throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments == ["status"] {
            precondition(PermissionFlowResources.packageBundle != nil, "Packaged PermissionFlow resources missing")
            let ax = AXIsProcessTrusted()
            let screen = CGPreflightScreenCaptureAccess()
            let input = CGPreflightListenEventAccess()
            // Runnable checks use real OS calls in this exact binary, never OS mocks.
            precondition((AccessibilityPermissionStatusProvider().authorizationState() == .granted) == ax)
            precondition((ScreenRecordingPermissionStatusProvider().authorizationState() == .granted) == screen)
            precondition((InputMonitoringPermissionStatusProvider().authorizationState() == .granted) == input)
            let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.systemevents")
            let automation = AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, false)
            let notifications = await UNUserNotificationCenter.current().notificationSettings()
            let result: [String: Any] = [
                "scope": "research app caller only; NOT the launchd Yonder service",
                "checkedAt": ISO8601DateFormatter().string(from: Date()),
                "probePID": ProcessInfo.processInfo.processIdentifier,
                "parentPID": getppid(),
                "executable": Bundle.main.executableURL?.path ?? "unknown",
                "bundleID": Bundle.main.bundleIdentifier ?? "unknown",
                "responsibleProcess": "unverified; parent PID is not proof of TCC responsibility",
                "accessibility": ["api": "AXIsProcessTrusted", "granted": ax],
                "screenRecording": ["api": "CGPreflightScreenCaptureAccess", "granted": screen],
                "inputMonitoring": ["api": "CGPreflightListenEventAccess", "granted": input],
                "camera": ["api": "AVCaptureDevice.authorizationStatus", "raw": AVCaptureDevice.authorizationStatus(for: .video).rawValue],
                "microphone": ["api": "AVCaptureDevice.authorizationStatus", "raw": AVCaptureDevice.authorizationStatus(for: .audio).rawValue],
                "automation": ["api": "AEDeterminePermissionToAutomateTarget(askUserIfNeeded: false)",
                               "target": "com.apple.systemevents", "rawOSStatus": automation],
                "notifications": ["api": "UNUserNotificationCenter.notificationSettings", "raw": notifications.authorizationStatus.rawValue],
                "fullDiskAccess": ["state": "unknown", "reason": "No reliable public universal preflight selected; no protected files probed"],
                "filesAndFolders": ["state": "unknown", "reason": "Resource-specific; no owner files accessed"],
                "checks": ["passed": 4, "failed": 0],
                "nextStep": "Compare service responsibility before using these results to guide Yonder grants. See docs/verification/mac-permissions.md."
            ]
            let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            print(String(decoding: data, as: UTF8.self))
            return
        }
        let panes: [String: PermissionFlowPane] = [
            "accessibility": .accessibility, "screen-recording": .screenRecording,
            "input-monitoring": .inputMonitoring, "full-disk-access": .fullDiskAccess
        ]
        guard arguments.count == 2, arguments[0] == "guide", let pane = panes[arguments[1]],
              Bundle.main.bundleURL.pathExtension == "app" else {
            FileHandle.standardError.write(Data("Usage: bundled PermissionDemo status | guide accessibility|screen-recording|input-monitoring|full-disk-access\n".utf8))
            exit(2)
        }
        // OWNER ONLY: the explicit guide invocation is the sole path opening UI.
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let controller = PermissionFlowController(configuration: .init(
            requiredAppURLs: [Bundle.main.bundleURL], promptForAccessibilityTrust: false,
            localeIdentifier: "zh-Hans"
        ))
        controller.authorize(pane: pane, suggestedAppURLs: [Bundle.main.bundleURL])
        print("Research UI only: dragging this demo app does not authorize Yonder. Close Settings then Ctrl+C to finish.")
        withExtendedLifetime(controller) { app.run() }
    }
}

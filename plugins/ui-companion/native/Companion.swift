import AppKit
import WebKit

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
final class CompanionApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var item: NSStatusItem!
    private var panel: CompanionPanel!
    private var dock: CompanionPanel!
    private var web: WKWebView!
    private var outsideMonitor: Any?
    private var spaceObserver: NSObjectProtocol?
    private var dragStart: (mouse: NSPoint, origin: NSPoint)?
    private var anchor: WindowAnchor?
    private let page = ProcessInfo.processInfo.environment["YONDER_UI_URL"].flatMap(URL.init(string:)) ?? Bundle.main.url(forResource: "index", withExtension: "html")!
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
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let image = NSImage(contentsOf: Bundle.main.url(forResource: "menubar-template", withExtension: "png")!)!
        image.size = NSSize(width: 22, height: 22); image.isTemplate = true
        item.button?.image = image
        item.button?.toolTip = "Yonder · 左键展开，右键退出"
        item.button?.setAccessibilityLabel("Yonder")
        item.button?.target = self; item.button?.action = #selector(statusClicked)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

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
        if page.isFileURL { web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent()) }
        else { web.load(URLRequest(url: page)) }

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
        outsideMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, self.panel.isVisible, !self.panel.frame.contains(NSEvent.mouseLocation) else { return }
            if let button = self.item.button, let window = button.window, window.convertToScreen(button.convert(button.bounds, to: nil)).contains(NSEvent.mouseLocation) { return }
            self.collapse()
        }
        spaceObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.collapse() }
        // Proactive appearance is always the compact entry, including full-screen spaces.
        collapse()
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showPanel(); return true }
    private func ensureAnchor() {
        if anchor == nil || !NSScreen.screens.contains(where: { $0.visibleFrame.contains(anchor!.point) }) {
            anchor = WindowAnchor(frame: awayFrame(size: panel.frame.size, screen: screen.visibleFrame, mouse: NSEvent.mouseLocation), screen: screen.visibleFrame)
        }
    }
    private func showPanel() {
        ensureAnchor()
        panel.setFrame(anchor!.frame(size: panel.frame.size), display: true)
        dock.orderOut(nil)
        // Never activate the app or make a window key on presentation.
        panel.orderFrontRegardless()
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('yonder-visibility',{detail:true}))", completionHandler: nil)
        item.button?.state = .on
    }
    private func collapse() {
        ensureAnchor()
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('yonder-visibility',{detail:false}))", completionHandler: nil)
        panel.orderOut(nil)
        dock.setFrame(anchor!.frame(size: dock.frame.size), display: true)
        dock.orderFrontRegardless(); item.button?.state = .off
    }
    @objc private func statusClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            let show = NSMenuItem(title: "展开", action: #selector(openPanel), keyEquivalent: ""); show.target = self; menu.addItem(show)
            let quit = NSMenuItem(title: "退出", action: #selector(quitApp), keyEquivalent: "q"); quit.target = self; menu.addItem(quit)
            item.menu = menu; item.button?.performClick(nil); item.menu = nil
        } else if panel.isVisible { collapse() } else { showPanel() }
    }
    @objc private func openPanel() { showPanel() }
    @objc private func quitApp() { NSApp.terminate(nil) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.absoluteString == page.absoluteString,
              let data = message.body as? [String: Any], let action = data["action"] as? String else { return }
        switch action {
        case "close": collapse()
        case "open": showPanel()
        case "attention": if !panel.isVisible { collapse() }
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
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('yonder-visibility',{detail:\(panel.isVisible)}))", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == page.absoluteString { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func applicationWillTerminate(_ notification: Notification) {
        if let outsideMonitor { NSEvent.removeMonitor(outsideMonitor) }
        if let spaceObserver { NSWorkspace.shared.notificationCenter.removeObserver(spaceObserver) }
        web.configuration.userContentController.removeScriptMessageHandler(forName: "companion")
    }
}
if CommandLine.arguments.contains("--check") {
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
} else {
    let app = NSApplication.shared
    let delegate = CompanionApp()
    app.delegate = delegate
    app.run()
}

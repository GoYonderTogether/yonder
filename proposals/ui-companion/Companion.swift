import AppKit
import WebKit

final class CompanionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class CompanionApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var item: NSStatusItem!
    private var panel: CompanionPanel!
    private var web: WKWebView!
    private var pinned = false
    private var outsideMonitor: Any?
    private let page = Bundle.main.url(forResource: "index", withExtension: "html")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let appMenu = NSMenu()
        let root = NSMenuItem()
        let menu = NSMenu()
        let quit = NSMenuItem(title: "退出 Yonder UI 原型", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        root.submenu = menu
        appMenu.addItem(root)
        NSApp.mainMenu = appMenu

        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let image = NSImage(contentsOf: Bundle.main.url(forResource: "menubar-template", withExtension: "png")!) {
            image.size = NSSize(width: 22, height: 22)
            image.isTemplate = true
            item.button?.image = image
        }
        item.button?.title = " 试"
        item.button?.font = .systemFont(ofSize: 10, weight: .medium)
        item.button?.toolTip = "Yonder UI 原型 · 左键打开，右键退出"
        item.button?.setAccessibilityLabel("Yonder UI 原型")
        item.button?.target = self
        item.button?.action = #selector(statusClicked)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "companion")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.underPageBackgroundColor = .clear
        web.autoresizingMask = [.width, .height]

        panel = CompanionPanel(contentRect: NSRect(x: 0, y: 0, width: 400, height: 460), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Yonder · UI 原型"
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.hasShadow = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        let container = NSView(frame: panel.contentView!.bounds)
        container.wantsLayer = true
        container.layer?.cornerRadius = 24
        container.layer?.masksToBounds = true
        web.frame = container.bounds
        container.addSubview(web)
        panel.contentView = container
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        outsideMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, self.panel.isVisible, !self.pinned, !self.panel.frame.contains(NSEvent.mouseLocation) else { return }
            // A click on our status button is handled by its own toggle.
            if let button = self.item.button, let window = button.window {
                let frame = window.convertToScreen(button.convert(button.bounds, to: nil))
                if frame.contains(NSEvent.mouseLocation) { return }
            }
            self.hidePanel()
        }
        showPanel(takeFocus: false)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showPanel(takeFocus: true)
        return true
    }

    private func placePanel(width: CGFloat) {
        guard let button = item.button, let window = button.window, let screen = window.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let anchor = window.convertToScreen(button.convert(button.bounds, to: nil))
        let height = min(460, visible.height - 20)
        let x = max(visible.minX + 12, min(anchor.maxX - width, visible.maxX - width - 12))
        let y = max(visible.minY + 10, min(anchor.minY - height - 10, visible.maxY - height - 8))
        panel.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true)
    }

    private func showPanel(takeFocus: Bool) {
        placePanel(width: panel.frame.width)
        if takeFocus { panel.makeKeyAndOrderFront(nil) } else { panel.orderFrontRegardless() }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('yonder-visibility',{detail:true}))", completionHandler: nil)
        item.button?.state = .on
    }

    private func hidePanel() {
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('yonder-visibility',{detail:false}))", completionHandler: nil)
        panel.orderOut(nil)
        item.button?.state = .off
    }

    @objc private func statusClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            let show = NSMenuItem(title: "打开 Yonder UI 原型", action: #selector(openPanel), keyEquivalent: "")
            show.target = self
            menu.addItem(show)
            menu.addItem(.separator())
            let quit = NSMenuItem(title: "退出原型", action: #selector(quitApp), keyEquivalent: "q")
            quit.target = self
            menu.addItem(quit)
            item.menu = menu
            item.button?.performClick(nil)
            item.menu = nil
        } else if panel.isVisible { hidePanel() } else { showPanel(takeFocus: true) }
    }

    @objc private func openPanel() { showPanel(takeFocus: true) }
    @objc private func quitApp() { NSApp.terminate(nil) }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.standardizedFileURL == page.standardizedFileURL,
              let data = message.body as? [String: Any], let action = data["action"] as? String else { return }
        switch action {
        case "close": hidePanel()
        case "open": showPanel(takeFocus: true)
        case "pin": if let value = data["value"] as? Bool { pinned = value }
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.standardizedFileURL == page.standardizedFileURL { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let outsideMonitor { NSEvent.removeMonitor(outsideMonitor) }
        web.configuration.userContentController.removeScriptMessageHandler(forName: "companion")
    }
}

let app = NSApplication.shared
let delegate = CompanionApp()
app.delegate = delegate
app.run()

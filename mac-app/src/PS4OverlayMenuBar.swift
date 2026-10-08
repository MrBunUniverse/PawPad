import Cocoa
import Foundation

/// Menu-bar launcher for the bridge (mac-receiver/server.js).
/// Menu: live status, PS4 target address (click to copy), Copy OBS URL, Open Settings, Start/Stop, Quit.
class AppDelegate: NSObject, NSApplicationDelegate {
    enum State { case stopped, waiting, live, portInUse }

    var statusItem: NSStatusItem!
    var statusLine: NSMenuItem!
    var serverProcess: Process?
    var state: State = .stopped { didSet { refresh() } }
    var currentIp = "127.0.0.1"
    let udpPort = 9999
    let httpPort = 8080
    var projectDir = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        projectDir = (Bundle.main.bundlePath as NSString).deletingLastPathComponent
        if !FileManager.default.fileExists(atPath: "\(projectDir)/mac-receiver/server.js") {
            projectDir = (projectDir as NSString).deletingLastPathComponent
        }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateNetworkIp()
        startServer()
    }

    // MARK: Menu

    func refresh() {
        let (dot, color, text): (String, NSColor, String) = {
            switch state {
            case .live: return ("●", .systemGreen, "PS4 connected")
            case .waiting: return ("●", .systemOrange, "Waiting for PS4")
            case .portInUse: return ("●", .systemRed, "Port in use: close the other bridge")
            case .stopped: return ("○", .secondaryLabelColor, "Stopped")
            }
        }()

        if let button = statusItem.button {
            let title = NSMutableAttributedString(string: "\(dot) ", attributes: [.foregroundColor: color])
            title.append(NSAttributedString(string: "PS4"))
            button.attributedTitle = title
        }
        if let line = statusLine {          // update in place so an open menu changes live
            line.title = text
            line.image = nil
            return
        }
        buildMenu(statusText: text)
    }

    func buildMenu(statusText: String) {
        let menu = NSMenu()

        statusLine = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
        statusLine.isEnabled = false
        menu.addItem(statusLine)

        let target = NSMenuItem(title: "\(currentIp):\(udpPort)", action: #selector(copyTarget), keyEquivalent: "")
        target.target = self
        target.toolTip = "Put this in pad_stream.ini on the PS4. Click to copy."
        menu.addItem(target)

        menu.addItem(.separator())
        menu.addItem(item("Copy OBS URL", #selector(copyObsUrl), "c"))
        menu.addItem(item("Open Settings", #selector(openSettings), "o"))
        menu.addItem(.separator())

        let toggle = item("Stop", #selector(toggleServer), "s")
        toggle.tag = 1
        menu.addItem(toggle)
        menu.addItem(item("Quit", #selector(quitApp), "q"))

        statusItem.menu = menu
        menu.delegate = self
    }

    func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    // MARK: Server

    func updateNetworkIp() {
        let task = Process()
        task.launchPath = "/bin/sh"
        task.arguments = ["-c", "ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1"]
        let pipe = Pipe()
        task.standardOutput = pipe
        try? task.run()
        task.waitUntilExit()
        let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !out.isEmpty { currentIp = out }
    }

    func startServer() {
        guard serverProcess == nil else { return }
        let process = Process()
        process.launchPath = "/bin/sh"
        // exec so that terminate() stops node itself, not just the shell
        process.arguments = ["-c", "export PATH='\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin':\"$PATH\"; cd \"\(projectDir)/mac-receiver\" && exec node server.js"]

        // The bridge prints "[PS4] receiving N packets/s" or "waiting for packets..." every second.
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let text = String(data: handle.availableData, encoding: .utf8), !text.isEmpty else { return }
            DispatchQueue.main.async {
                guard let self = self, self.serverProcess != nil else { return }
                if text.contains("already in use") { self.state = .portInUse }
                else if text.contains("receiving") { self.state = .live }
                else if text.contains("waiting") { self.state = .waiting }
            }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                pipe.fileHandleForReading.readabilityHandler = nil
                guard let self = self else { return }
                self.serverProcess = nil
                if self.state != .portInUse { self.state = .stopped }
                self.updateToggleTitle()
            }
        }

        do {
            try process.run()
            serverProcess = process
            state = .waiting
            updateToggleTitle()
        } catch {
            state = .stopped
        }
    }

    func stopServer() {
        guard let process = serverProcess else { return }
        process.terminationHandler = nil
        (process.standardOutput as? Pipe)?.fileHandleForReading.readabilityHandler = nil
        if process.isRunning { process.terminate() }
        serverProcess = nil
        state = .stopped
        updateToggleTitle()
    }

    func updateToggleTitle() {
        statusItem.menu?.item(withTag: 1)?.title = serverProcess == nil ? "Start" : "Stop"
    }

    // MARK: Actions

    @objc func toggleServer() {
        if serverProcess == nil { updateNetworkIp(); startServer() } else { stopServer() }
    }

    @objc func openSettings() { open("http://localhost:\(httpPort)/") }
    @objc func copyObsUrl() { copy("http://localhost:\(httpPort)/?hideUI=1") }
    @objc func copyTarget() { copy(currentIp) }

    func open(_ s: String) { if let url = URL(string: s) { NSWorkspace.shared.open(url) } }

    func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }

    @objc func quitApp() { NSApplication.shared.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { stopServer() }
}

extension AppDelegate: NSMenuDelegate {
    // Refresh the IP each time the menu opens (it changes when the router hands out a new address).
    func menuWillOpen(_ menu: NSMenu) {
        updateNetworkIp()
        menu.items.dropFirst().first?.title = "\(currentIp):\(udpPort)"
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()

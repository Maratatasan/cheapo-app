import Network
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let screen = MockAuthScreen()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = screen
        window.makeKeyAndVisible()
        self.window = window
    }

    func sceneDidBecomeActive(_ scene: UIScene) { screen.record("active") }
    func sceneWillResignActive(_ scene: UIScene) { screen.record("inactive") }
    func sceneDidEnterBackground(_ scene: UIScene) { screen.record("background") }
    func sceneWillEnterForeground(_ scene: UIScene) { screen.record("foreground") }
}

final class MockAuthScreen: UIViewController {
    private let status = UILabel()
    private let continueButton = UIButton(type: .system)
    private var listener: NWListener?
    private var pendingState: String?
    private var callbackDeadline: Date?
    private var continueDeadline: Date?
    private var callbackTimer: Timer?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        status.numberOfLines = 0
        status.textAlignment = .center
        status.text = "Ready. The browser page uses synthetic data."
        continueButton.setTitle("Continue", for: .normal)
        continueButton.isEnabled = false
        continueButton.addTarget(self, action: #selector(continueAttempt), for: .touchUpInside)
        let controls = UIStackView(arrangedSubviews: [
            status, button("Open Safari", #selector(openSafari)),
            continueButton, button("Cancel", #selector(cancelAttempt))
        ])
        controls.axis = .vertical
        controls.spacing = 16
        controls.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controls)
        NSLayoutConstraint.activate([
            controls.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24)
        ])
    }

    private func button(_ title: String, _ action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    func record(_ event: String) {
        let date = ISO8601DateFormatter().string(from: Date())
        let active = viewIfLoaded?.window?.windowScene?.activationState == .foregroundActive
        let line = "\(date) \(event) foregroundActive=\(active)\n"
        let url = URL.documentsDirectory.appending(path: "events.log")
        let data = Data(line.utf8)
        guard FileManager.default.fileExists(atPath: url.path) else {
            try? data.write(to: url)
            return
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
    }

    @objc private func openSafari() {
        clearAttempt()
        guard let page = mockPage() else {
            status.text = "Set the local mock page address before running."
            return
        }
        let state = UUID().uuidString
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        do {
            let listener = try NWListener(using: parameters)
            self.listener = listener
            pendingState = state
            listener.stateUpdateHandler = { [weak self, weak listener] lifecycle in
                guard let self, let listener, self.listener === listener else { return }
                switch lifecycle {
                case .ready:
                    guard let port = listener.port else { self.cancelAttempt(); return }
                    self.openMockPage(page, callbackPort: port.rawValue, state: state)
                case .failed:
                    self.clearAttempt()
                    self.status.text = "Listener failed. Try again."
                    self.record("listener-failed")
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                connection.start(queue: .main)
                self?.receive(connection, accumulated: Data())
            }
            listener.start(queue: .main)
        } catch {
            clearAttempt()
            status.text = "Listener failed. Try again."
            record("listener-failed")
        }
    }

    private func mockPage() -> URLComponents? {
        if let address = Bundle.main.object(forInfoDictionaryKey: "MockPageURL") as? String {
            return URLComponents(string: address)
        }
        guard let value = ProcessInfo.processInfo.environment["MOCK_PAGE_PORT"], let port = UInt16(value) else {
            return nil
        }
        var page = URLComponents()
        page.scheme = "http"
        page.host = "127.0.0.1"
        page.port = Int(port)
        page.path = "/"
        return page
    }

    private func openMockPage(_ endpoint: URLComponents, callbackPort: UInt16, state: String) {
        var page = endpoint
        page.queryItems = [.init(name: "port", value: String(callbackPort)), .init(name: "state", value: state)]
        guard let url = page.url else { cancelAttempt(); return }
        callbackDeadline = Date().addingTimeInterval(45)
        callbackTimer = Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { [weak self] _ in
            self?.expireCallback()
        }
        status.text = "Waiting for Safari. Return here to continue or cancel."
        record("open-safari")
        UIApplication.shared.open(url) { [weak self] opened in
            if !opened, self?.pendingState == state {
                self?.clearAttempt()
                self?.status.text = "Could not open Safari. Try again."
                self?.record("browser-failed")
            }
        }
    }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1024) { [weak self] data, _, finished, error in
            var request = accumulated
            request.append(data ?? Data())
            if request.count > 2048 || error != nil {
                connection.cancel()
            } else if let lineEnd = request.range(of: Data("\r\n".utf8)) {
                let line = String(decoding: request[..<lineEnd.lowerBound], as: UTF8.self)
                self?.handle(line, connection: connection)
            } else if finished {
                connection.cancel()
            } else {
                self?.receive(connection, accumulated: request)
            }
        }
    }

    private func handle(_ requestLine: String, connection: NWConnection) {
        let parts = requestLine.split(separator: " ")
        let target = parts.count == 3 && parts[0] == "GET" ? String(parts[1]) : ""
        let query = URLComponents(string: target)
        let states = query?.queryItems?.filter { $0.name == "state" } ?? []
        let codes = query?.queryItems?.filter { $0.name == "code" } ?? []
        let valid = target.hasPrefix("/auth/callback?") && query?.fragment == nil
            && query?.queryItems?.contains(where: { $0.name == "error" }) == false
            && pendingState != nil && states.count == 1 && states.first?.value == pendingState
            && codes.count == 1 && codes.first?.value == "mock-code"
            && (callbackDeadline ?? .distantPast) > Date()
        let result = valid ? "200 OK" : "400 Bad Request"
        let message = valid ? "Mock callback accepted. Return to the app." : "Mock callback rejected."
        let response = "HTTP/1.1 \(result)\r\nContent-Type: text/plain\r\nContent-Length: \(message.utf8.count)\r\nConnection: close\r\n\r\n\(message)"
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
        if valid {
            clearAttempt()
            continueDeadline = Date().addingTimeInterval(60)
            continueButton.isEnabled = true
            status.text = "Mock callback received. Tap Continue."
            record("callback-accepted")
        } else {
            record("callback-rejected")
        }
    }

    private func expireCallback() {
        clearAttempt()
        status.text = "No callback arrived. Try again."
        record("callback-timeout")
    }

    @objc private func continueAttempt() {
        guard view.window?.windowScene?.activationState == .foregroundActive else {
            record("continue-blocked-inactive")
            return
        }
        guard let deadline = continueDeadline, deadline > Date() else {
            clearAttempt()
            status.text = "No valid callback to continue. Try again."
            record("continue-blocked-no-callback")
            return
        }
        clearAttempt()
        status.text = "Mock completed after explicit Continue."
        record("continue-completed")
    }

    @objc private func cancelAttempt() {
        clearAttempt()
        status.text = "Cancelled. Start another attempt when ready."
        record("cancelled")
    }

    private func clearAttempt() {
        listener?.cancel()
        listener = nil
        callbackTimer?.invalidate()
        callbackTimer = nil
        pendingState = nil
        callbackDeadline = nil
        continueDeadline = nil
        continueButton.isEnabled = false
    }
}

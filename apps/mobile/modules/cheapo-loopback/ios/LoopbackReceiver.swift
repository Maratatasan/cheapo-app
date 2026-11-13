import Foundation
import Network

/// The caller and all Network callbacks use the main queue.
final class LoopbackReceiver {
  private let listener: NWListener
  private let state: String
  private let deadline = Date().addingTimeInterval(300)
  private var connections: [ObjectIdentifier: NWConnection] = [:]
  private var startReply: ((UInt16?) -> Void)?
  private var callbackReply: ((String?) -> Void)?
  private var callback: String?
  private var timer: DispatchWorkItem?
  private var finished = false

  init(state: String) throws {
    self.state = state
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }

  func start(_ reply: @escaping (UInt16?) -> Void) {
    startReply = reply
    listener.stateUpdateHandler = { [weak self] status in
      guard let self else { return }
      switch status {
      case .ready:
        let reply = self.startReply
        self.startReply = nil
        reply?(self.listener.port?.rawValue)
      case .failed, .cancelled:
        if self.callback == nil { self.stop() }
      default: break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      guard let self, !self.finished, self.connections.count < 4 else { connection.cancel(); return }
      self.connections[ObjectIdentifier(connection)] = connection
      connection.start(queue: .main)
      self.receive(connection, data: Data())
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self, weak connection] in
        if let connection { self?.close(connection) }
      }
    }
    let timer = DispatchWorkItem { [weak self] in self?.stop() }
    self.timer = timer
    DispatchQueue.main.asyncAfter(deadline: .now() + 300, execute: timer)
    listener.start(queue: .main)
  }

  func wait(_ reply: @escaping (String?) -> Void) {
    guard callbackReply == nil else { reply(nil); return }
    if finished {
      let result = callback
      callback = nil
      reply(result)
    } else {
      callbackReply = reply
    }
  }

  func stop() {
    finished = true
    callback = nil
    timer?.cancel()
    listener.stateUpdateHandler = nil
    listener.cancel()
    connections.values.forEach { $0.cancel() }
    connections.removeAll()
    let started = startReply
    let waiting = callbackReply
    startReply = nil
    callbackReply = nil
    started?(nil)
    waiting?(nil)
  }

  private func close(_ connection: NWConnection) {
    connections.removeValue(forKey: ObjectIdentifier(connection))
    connection.cancel()
  }

  private func receive(_ connection: NWConnection, data: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] bytes, _, ended, error in
      guard let self else { connection.cancel(); return }
      var request = data
      request.append(bytes ?? Data())
      if error != nil || request.count > 8192 {
        self.close(connection)
      } else if let lineEnd = request.range(of: Data("\r\n".utf8)) {
        self.handle(String(decoding: request[..<lineEnd.lowerBound], as: UTF8.self), connection)
      } else if ended {
        self.close(connection)
      } else {
        self.receive(connection, data: request)
      }
    }
  }

  private func handle(_ line: String, _ connection: NWConnection) {
    let parts = line.split(separator: " ", omittingEmptySubsequences: false)
    let target = parts.count == 3 && parts[0] == "GET" && ["HTTP/1.0", "HTTP/1.1"].contains(parts[2])
      ? String(parts[1]) : ""
    let valid = !finished && Date() < deadline && Self.validCallback(target, state: state)
    let status = valid ? "200 OK" : "400 Bad Request"
    let body = valid
      ? "Return to Cheapo iPhone Auth Test and tap Continue sign-in."
      : "No valid sign-in callback was received."
    let response = "HTTP/1.1 \(status)\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
    connection.send(content: Data(response.utf8), completion: .contentProcessed { [weak self] _ in
      self?.close(connection)
    })
    guard valid else { return }
    finished = true
    timer?.cancel()
    let waiting = callbackReply
    callbackReply = nil
    if let waiting { waiting(target) }
    else { callback = target }
    // Leave the accepted socket open until its browser response has flushed.
    listener.stateUpdateHandler = nil
    listener.cancel()
  }

  static func validCallback(_ target: String, state: String) -> Bool {
    guard target.hasPrefix("/auth/callback?"),
          let url = URLComponents(string: target), url.path == "/auth/callback",
          url.fragment == nil, let items = url.queryItems,
          items.filter({ $0.name == "state" }).map(\.value) == [state],
          !items.contains(where: { $0.name == "error" })
    else { return false }
    let codes = items.filter { $0.name == "code" }
    return codes.count == 1 && codes[0].value?.isEmpty == false
  }
}

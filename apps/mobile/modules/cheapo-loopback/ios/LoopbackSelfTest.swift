import Foundation
import Network

enum LoopbackSelfTest {
  static func run(state: String, reply: @escaping ([String: Any]) -> Void) {
    let signature = PhoneIdentity.selfTest()
    guard let receiver = try? LoopbackReceiver(state: state) else {
      reply(["callbackVerified": false, "signatureVerified": signature])
      return
    }
    receiver.start { port in
      guard let port else { reply(["callbackVerified": false, "signatureVerified": signature]); return }
      let target = "/auth/callback?state=\(state)&code=local-self-test"
      request(port: port, target: "/wrong?state=\(state)&code=local-self-test") { wrongPath in
        request(port: port, target: "/auth/callback?state=wrong&code=local-self-test") { wrongState in
          request(port: port, target: target) { good in
            guard good == 200 else {
              receiver.stop()
              reply(["callbackVerified": false, "signatureVerified": signature])
              return
            }
            receiver.wait { callback in
              receiver.wait { repeated in
                let verified = wrongPath == 400 && wrongState == 400 && good == 200
                  && callback == target && repeated == nil
                receiver.stop()
                reply(["callbackVerified": verified, "signatureVerified": signature, "boundAddress": "127.0.0.1"])
              }
            }
          }
        }
      }
    }
  }

  private static func request(port: UInt16, target: String, reply: @escaping (Int?) -> Void) {
    guard let port = NWEndpoint.Port(rawValue: port) else { reply(nil); return }
    let connection = NWConnection(host: "127.0.0.1", port: port, using: .tcp)
    var completed = false
    func finish(_ status: Int?) {
      guard !completed else { return }
      completed = true
      connection.stateUpdateHandler = nil
      connection.cancel()
      reply(status)
    }
    connection.stateUpdateHandler = { status in
      switch status {
      case .ready:
        let request = "GET \(target) HTTP/1.1\r\nHost: 127.0.0.1:\(port.rawValue)\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(request.utf8), completion: .contentProcessed { error in
          guard error == nil else { finish(nil); return }
          connection.receive(minimumIncompleteLength: 12, maximumLength: 1024) { bytes, _, _, _ in
            let line = String(decoding: bytes ?? Data(), as: UTF8.self)
            finish(line.split(separator: " ").dropFirst().first.flatMap { Int($0) })
          }
        })
      case .failed: finish(nil)
      default: break
      }
    }
    connection.start(queue: .main)
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { finish(nil) }
  }
}

import ExpoModulesCore
import Foundation
import Network

public final class CheapoLoopbackModule: Module {
  private var receiver: LoopbackReceiver?

  public func definition() -> ModuleDefinition {
    Name("CheapoLoopback")

    AsyncFunction("startReceiver") { (state: String, promise: Promise) in
      self.receiver?.stop()
      self.receiver = nil
      guard state.utf8.count == 64, state.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
            let receiver = try? LoopbackReceiver(state: state)
      else { promise.reject("ERR_CALLBACK", "Could not start the phone callback listener."); return }
      self.receiver = receiver
      receiver.start { port in
        if let port { promise.resolve(["port": Int(port)]) }
        else { promise.reject("ERR_CALLBACK", "Could not start the phone callback listener.") }
      }
    }.runOnQueue(.main)

    AsyncFunction("waitForCallback") { (promise: Promise) in
      guard let receiver = self.receiver else {
        promise.reject("ERR_CALLBACK", "Start phone sign-in again.")
        return
      }
      receiver.wait { callback in
        if let callback { promise.resolve(callback) }
        else { promise.reject("ERR_CALLBACK", "Phone sign-in timed out or was cancelled.") }
      }
    }.runOnQueue(.main)

    AsyncFunction("stopReceiver") {
      self.receiver?.stop()
      self.receiver = nil
    }.runOnQueue(.main)

    Function("decodeBase64Url") { (value: String) throws -> String in
      guard let bytes = PhoneIdentity.base64URL(value), let decoded = String(data: bytes, encoding: .utf8)
      else { throw PhoneAuthError.invalidData }
      return decoded
    }

    Function("verifyRs256") { (input: String, signature: String, modulus: String, exponent: String) in
      PhoneIdentity.verify(input, signature: signature, modulus: modulus, exponent: exponent)
    }

    AsyncFunction("requestJson") { (address: String, form: String?) async throws -> [String: Any] in
      try await PhoneAuthHTTP.request(address, form: form)
    }

    AsyncFunction("selfTest") { (state: String, promise: Promise) in
      LoopbackSelfTest.run(state: state) { result in promise.resolve(result) }
    }.runOnQueue(.main)

    OnDestroy {
      let receiver = self.receiver
      DispatchQueue.main.async { receiver?.stop() }
    }
  }
}

enum PhoneAuthError: Error { case invalidData }

private final class RejectAuthRedirect: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}

private enum PhoneAuthHTTP {
  static func request(_ address: String, form: String?) async throws -> [String: Any] {
    guard let parts = URLComponents(string: address), parts.scheme == "https", parts.host == "auth.openai.com",
          parts.port == nil || parts.port == 443, parts.user == nil, parts.password == nil, parts.fragment == nil,
          let url = parts.url, (form?.utf8.count ?? 0) <= 131_072
    else { throw PhoneAuthError.invalidData }

    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let form {
      request.httpMethod = "POST"
      request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      request.httpBody = Data(form.utf8)
    }
    let config = URLSessionConfiguration.ephemeral
    config.httpShouldSetCookies = false
    config.timeoutIntervalForRequest = 30
    config.timeoutIntervalForResource = 60
    let session = URLSession(configuration: config)
    defer { session.invalidateAndCancel() }
    do {
      let (bytes, response) = try await session.bytes(for: request, delegate: RejectAuthRedirect())
      guard let response = response as? HTTPURLResponse, response.expectedContentLength <= 262_144
      else { throw PhoneAuthError.invalidData }
      var body = Data()
      for try await byte in bytes {
        guard body.count < 262_144 else { throw PhoneAuthError.invalidData }
        body.append(byte)
      }
      return ["status": response.statusCode, "bodyText": String(decoding: body, as: UTF8.self)]
    } catch {
      let category: String
      switch (error as? URLError)?.code {
      case .timedOut: category = "Timeout"
      case .cannotFindHost, .dnsLookupFailed: category = "DNS"
      case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost: category = "Connection"
      case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate: category = "TLS"
      default: category = "NativeTransport"
      }
      // Category strings are fixed. Never expose URL or error descriptions to the UI or log.
      return ["status": 0, "bodyText": "{\"error\":\"native_transport\",\"category\":\"\(category)\"}"]
    }
  }
}

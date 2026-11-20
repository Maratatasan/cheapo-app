import Foundation

let state = String(repeating: "a", count: 64)
precondition(!LoopbackReceiver.validCallback("/auth/callback?state=\(state)&state=\(state)&code=code", state: state))
precondition(!LoopbackReceiver.validCallback("/auth/callback?state=\(state)&code=one&code=two", state: state))
precondition(!LoopbackReceiver.validCallback("/auth/callback?state=\(state)&code=code#fragment", state: state))
LoopbackSelfTest.run(state: state) { result in
  precondition(result["callbackVerified"] as? Bool == true)
  precondition(result["signatureVerified"] as? Bool == true)
  print("Native macOS loopback and RS256 self-test passed")
  exit(0)
}
dispatchMain()

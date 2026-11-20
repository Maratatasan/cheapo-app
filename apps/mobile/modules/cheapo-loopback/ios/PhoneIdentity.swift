import Foundation
import Security

enum PhoneIdentity {
  static func base64URL(_ value: String) -> Data? {
    guard !value.isEmpty, value.utf8.count <= 65_536, value.utf8.allSatisfy({
      (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95
    }) else { return nil }
    var encoded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
    return Data(base64Encoded: encoded)
  }

  static func verify(_ input: String, signature: String, modulus: String, exponent: String) -> Bool {
    guard let n = base64URL(modulus), (256...1024).contains(n.count),
          let e = base64URL(exponent), (1...8).contains(e.count),
          let signature = base64URL(signature), signature.count == n.count
    else { return false }
    let keyDER = der(0x30, unsignedInteger(n) + unsignedInteger(e))
    let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
                                    kSecAttrKeyClass as String: kSecAttrKeyClassPublic]
    guard let key = SecKeyCreateWithData(keyDER as CFData, attributes as CFDictionary, nil) else { return false }
    return verify(input, signature: signature, key: key)
  }

  static func selfTest() -> Bool {
    let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
                                    kSecAttrKeySizeInBits as String: 2048]
    let input = "cheapo-local-rs256-self-test"
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, nil),
          let publicKey = SecKeyCopyPublicKey(privateKey),
          let signature = SecKeyCreateSignature(privateKey, .rsaSignatureMessagePKCS1v15SHA256,
                                                Data(input.utf8) as CFData, nil),
          let representation = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?
    else { return false }
    // A generated RSA public key exports as PKCS#1 SEQUENCE(INTEGER n, INTEGER e).
    var bytes = ArraySlice(representation)
    guard var sequence = takeDER(0x30, from: &bytes), bytes.isEmpty,
          let modulus = takeDER(0x02, from: &sequence),
          let exponent = takeDER(0x02, from: &sequence), sequence.isEmpty
    else { return false }
    let n = encodeBase64URL(Data(modulus.drop(while: { $0 == 0 })))
    let e = encodeBase64URL(Data(exponent))
    let s = encodeBase64URL(signature as Data)
    return verify(input, signature: s, modulus: n, exponent: e)
      && !verify(input + "-tampered", signature: s, modulus: n, exponent: e)
  }

  private static func verify(_ input: String, signature: Data, key: SecKey) -> Bool {
    SecKeyVerifySignature(key, .rsaSignatureMessagePKCS1v15SHA256,
                          Data(input.utf8) as CFData, signature as CFData, nil)
  }

  private static func encodeBase64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  private static func der(_ tag: UInt8, _ value: Data) -> Data {
    let size = value.count
    let length: [UInt8] = size < 128 ? [UInt8(size)]
      : size < 256 ? [0x81, UInt8(size)] : [0x82, UInt8(size >> 8), UInt8(size & 0xff)]
    return Data([tag] + length) + value
  }

  private static func unsignedInteger(_ bytes: Data) -> Data {
    let value = Data(bytes.drop(while: { $0 == 0 }))
    return der(0x02, (value.first ?? 0) >= 128 || value.isEmpty ? Data([0]) + value : value)
  }

  private static func takeDER(_ tag: UInt8, from bytes: inout ArraySlice<UInt8>) -> ArraySlice<UInt8>? {
    guard bytes.popFirst() == tag, let initial = bytes.popFirst() else { return nil }
    var count = Int(initial)
    if initial >= 128 {
      let length = Int(initial & 0x7f)
      guard (1...2).contains(length), bytes.count >= length else { return nil }
      count = bytes.prefix(length).reduce(0) { $0 * 256 + Int($1) }
      bytes = bytes.dropFirst(length)
    }
    guard bytes.count >= count else { return nil }
    let value = bytes.prefix(count)
    bytes = bytes.dropFirst(count)
    return value
  }
}

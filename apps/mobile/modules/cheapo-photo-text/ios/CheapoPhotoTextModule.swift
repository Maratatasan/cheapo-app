import ExpoModulesCore
import Foundation

public final class CheapoPhotoTextModule: Module {
  private let recognitionQueue = DispatchQueue(label: "cheapo.photo-text", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("CheapoPhotoText")
    AsyncFunction("read") { (uri: String) throws -> [String: Any] in
      do {
        return try CheapoPhotoTextVision.read(uri)
      } catch {
        throw NSError(domain: "CheapoPhotoText", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Could not read text from this photo."])
      }
    }.runOnQueue(recognitionQueue)
  }
}

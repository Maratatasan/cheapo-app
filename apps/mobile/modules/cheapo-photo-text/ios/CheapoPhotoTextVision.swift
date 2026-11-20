import CoreGraphics
import Foundation
import Vision

enum CheapoPhotoTextFailure: Error {
  case tooMuchText
}

enum CheapoPhotoTextVision {
  static func read(_ uri: String) throws -> [String: Any] {
    let photo = try CheapoVisionPhoto.load(uri)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: photo.image, orientation: .up).perform([request])
    let observations = request.results ?? []
    guard observations.count <= 200 else { throw CheapoPhotoTextFailure.tooMuchText }

    let blocks = observations.compactMap { observation -> [String: Any]? in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      let text = candidate.string
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
      var line = textWithBox(text, observation.boundingBox)
      line["elements"] = text.split(whereSeparator: \.isWhitespace).prefix(64).map { element in
        let bounds = try? candidate.boundingBox(for: element.startIndex..<element.endIndex)
        return textWithBox(String(element), bounds?.boundingBox)
      }
      return ["lines": [line]]
    }
    return ["width": photo.width, "height": photo.height, "blocks": blocks]
  }

  // Vision's normalized Y axis starts at the bottom. The app and Android
  // adapter use top-left coordinates on the same upright view.
  static func topLeftBox(_ rect: CGRect?) -> [Double]? {
    guard let rect, !rect.isNull, !rect.isInfinite else { return nil }
    let left = max(0, rect.minX)
    let top = max(0, 1 - rect.maxY)
    let right = min(1, rect.maxX)
    let bottom = min(1, 1 - rect.minY)
    guard left < right, top < bottom else { return nil }
    return [Double(left), Double(top), Double(right), Double(bottom)]
  }

  private static func textWithBox(_ text: String, _ bounds: CGRect?) -> [String: Any] {
    var result: [String: Any] = ["text": text]
    if let box = topLeftBox(bounds) { result["box"] = box }
    return result
  }
}

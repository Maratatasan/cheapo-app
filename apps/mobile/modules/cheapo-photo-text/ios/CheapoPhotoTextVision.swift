import CoreGraphics
import Foundation
import ImageIO
import Vision

enum CheapoPhotoTextFailure: Error {
  case unsupportedPhoto
  case tooMuchText
}

enum CheapoPhotoTextVision {
  private static let maxEncodedBytes = 24 * 1024 * 1024
  private static let maxPixels = 64_000_000
  private static let thumbnailSide = 2048

  static func read(_ uri: String) throws -> [String: Any] {
    guard uri.hasPrefix("file:///"), let url = URL(string: uri), url.isFileURL,
      url.query == nil, url.fragment == nil else {
      throw CheapoPhotoTextFailure.unsupportedPhoto
    }
    let file = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard file.isRegularFile == true, let bytes = file.fileSize, bytes > 0, bytes <= maxEncodedBytes,
      let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
      let pixelWidth = properties[kCGImagePropertyPixelWidth as String] as? Int,
      let pixelHeight = properties[kCGImagePropertyPixelHeight as String] as? Int,
      pixelWidth > 0, pixelHeight > 0, pixelWidth <= maxPixels / pixelHeight else {
      throw CheapoPhotoTextFailure.unsupportedPhoto
    }
    let options = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: thumbnailSide,
      kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
      throw CheapoPhotoTextFailure.unsupportedPhoto
    }

    // ImageIO applies the EXIF rotation and mirror before Vision sees the pixels.
    let orientation = properties[kCGImagePropertyOrientation as String] as? Int ?? 1
    let sideways = (5...8).contains(orientation)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image, orientation: .up).perform([request])
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
    return ["width": sideways ? pixelHeight : pixelWidth,
            "height": sideways ? pixelWidth : pixelHeight, "blocks": blocks]
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

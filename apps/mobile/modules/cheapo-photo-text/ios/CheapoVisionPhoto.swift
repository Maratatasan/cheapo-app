import CoreGraphics
import Foundation
import ImageIO

enum CheapoVisionPhotoFailure: Error {
  case unsupportedPhoto
}

struct CheapoVisionPhoto {
  let image: CGImage
  let width: Int
  let height: Int

  private static let maxEncodedBytes = 24 * 1024 * 1024
  private static let maxPixels = 64_000_000
  private static let thumbnailSide = 2048

  static func load(_ uri: String) throws -> CheapoVisionPhoto {
    guard uri.hasPrefix("file:///"), let url = URL(string: uri), url.isFileURL,
      url.query == nil, url.fragment == nil else {
      throw CheapoVisionPhotoFailure.unsupportedPhoto
    }
    let file = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard file.isRegularFile == true, let bytes = file.fileSize, bytes > 0, bytes <= maxEncodedBytes,
      let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
      let pixelWidth = properties[kCGImagePropertyPixelWidth as String] as? Int,
      let pixelHeight = properties[kCGImagePropertyPixelHeight as String] as? Int,
      pixelWidth > 0, pixelHeight > 0, pixelWidth <= maxPixels / pixelHeight else {
      throw CheapoVisionPhotoFailure.unsupportedPhoto
    }
    let options = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: thumbnailSide,
      kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
      throw CheapoVisionPhotoFailure.unsupportedPhoto
    }

    // ImageIO applies the EXIF rotation and mirror before Vision sees the pixels.
    let orientation = properties[kCGImagePropertyOrientation as String] as? Int ?? 1
    let sideways = (5...8).contains(orientation)
    return CheapoVisionPhoto(image: image, width: sideways ? pixelHeight : pixelWidth,
      height: sideways ? pixelWidth : pixelHeight)
  }
}

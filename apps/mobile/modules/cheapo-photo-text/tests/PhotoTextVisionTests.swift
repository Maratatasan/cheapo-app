import CoreGraphics
import CoreText
import Foundation
import ImageIO

@main
enum PhotoTextVisionTests {
  static func main() throws {
    let fixtureDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

    let upright = try writeLabel(in: fixtureDirectory, name: "upright.jpg", orientation: .up)
    let rotated = try writeLabel(in: fixtureDirectory, name: "rotated.jpg", orientation: .left)
    let plain = try labelBox(upright)
    let corrected = try labelBox(rotated)
    precondition(zip(plain, corrected).allSatisfy { abs($0 - $1) < 0.04 }, "EXIF rotation changed upright geometry.")

    let converted = CheapoPhotoTextVision.topLeftBox(CGRect(x: 0.20, y: 0.60, width: 0.40, height: 0.25))
    precondition(zip(converted!, [0.2, 0.15, 0.6, 0.4]).allSatisfy { abs($0 - $1) < 0.0001 })
    precondition(CheapoPhotoTextVision.topLeftBox(CGRect(x: -3, y: 0, width: 2, height: 0.1)) == nil)

    let oversized = fixtureDirectory.appendingPathComponent("oversized.jpg")
    try Data([0]).write(to: oversized)
    let handle = try FileHandle(forWritingTo: oversized)
    try handle.truncate(atOffset: 25 * 1024 * 1024)
    try handle.close()
    for unsupported in ["https://example.test/price.jpg", fixtureDirectory.absoluteString, oversized.absoluteString] {
      do {
        _ = try CheapoPhotoTextVision.read(unsupported)
        preconditionFailure("Invalid photo was accepted.")
      } catch CheapoPhotoTextFailure.unsupportedPhoto {
        continue
      }
    }
    print("Vision read the sample label upright and with EXIF rotation. Normalized geometry and input limits passed.")
  }

  private static func labelBox(_ fixture: URL) throws -> [Double] {
    let result = try CheapoPhotoTextVision.read(fixture.absoluteString)
    precondition(result["width"] as? Int == 1200 && result["height"] as? Int == 800)
    let blocks = result["blocks"] as! [[String: Any]]
    let label = blocks.flatMap { $0["lines"] as! [[String: Any]] }
      .first { ($0["text"] as? String)?.contains("WHOLE OATS") == true }
    precondition(label != nil, "The synthetic label text was not recognized.")
    let box = label!["box"] as! [Double]
    precondition((0.06...0.12).contains(box[0]) && (0.08...0.19).contains(box[1]))
    precondition((label!["elements"] as? [[String: Any]])?.count == 2)
    return box
  }

  private static func writeLabel(in directory: URL, name: String, orientation: CGImagePropertyOrientation) throws -> URL {
    let sideways = orientation == .left
    let canvas = CGContext(data: nil, width: sideways ? 800 : 1200, height: sideways ? 1200 : 800,
      bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    canvas.setFillColor(CGColor(gray: 1, alpha: 1))
    canvas.fill(CGRect(x: 0, y: 0, width: canvas.width, height: canvas.height))
    if sideways {
      canvas.translateBy(x: 0, y: 1200)
      canvas.rotate(by: -.pi / 2)
    }
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, 84, nil)
    let attributes = [NSAttributedString.Key(kCTFontAttributeName as String): font]
    canvas.textPosition = CGPoint(x: 95, y: 640)
    CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string: "WHOLE OATS", attributes: attributes)), canvas)
    let profile = [kCGImagePropertyOrientation: orientation.rawValue] as CFDictionary
    let url = directory.appendingPathComponent(name)
    let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, canvas.makeImage()!, profile)
    precondition(CGImageDestinationFinalize(destination))
    return url
  }
}

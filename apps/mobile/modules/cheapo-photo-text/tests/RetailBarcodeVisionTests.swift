import CoreGraphics
import CoreImage
import Foundation
import ImageIO

@main
enum RetailBarcodeVisionTests {
  private static let left = ["0001101", "0011001", "0010011", "0111101", "0100011",
                             "0110001", "0101111", "0111011", "0110111", "0001011"]
  private static let parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
                               "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

  static func main() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let mixed = makeCanvas(width: 980, height: 720)
    draw("4006381333931", y: 465, on: mixed)
    draw("96385074", y: 160, on: mixed)
    let ordinary = try write(mixed, orientation: .up, to: directory.appendingPathComponent("mixed.jpg"))
    let codes = try CheapoRetailBarcodeVision.read(ordinary.absoluteString)
    precondition(Set(codes) == Set(["4006381333931", "96385074"]), "Multiple generated retail codes were not preserved.")

    let rotated = makeCanvas(width: 720, height: 980)
    rotated.translateBy(x: 0, y: 980)
    rotated.rotate(by: -.pi / 2)
    draw("0036000291452", y: 300, on: rotated)
    let upc = try write(rotated, orientation: .left, to: directory.appendingPathComponent("upc.jpg"))
    let decoded = try CheapoRetailBarcodeVision.read(upc.absoluteString)
    precondition(decoded == ["0036000291452"] || decoded == ["036000291452"], "The rotated UPC-A was not recognized.")

    let qr = CIFilter(name: "CIQRCodeGenerator")!
    qr.setValue(Data("4006381333931".utf8), forKey: "inputMessage")
    let qrImage = qr.outputImage!.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
    let raster = CIContext().createCGImage(qrImage, from: qrImage.extent)!
    let ignored = makeCanvas(width: 600, height: 600)
    ignored.interpolationQuality = .none
    ignored.draw(raster, in: CGRect(x: 95, y: 95, width: 410, height: 410))
    let unsupported = try write(ignored, orientation: .up, to: directory.appendingPathComponent("qr.jpg"))
    let qrDecoded = try CheapoRetailBarcodeVision.read(unsupported.absoluteString)
    precondition(qrDecoded.isEmpty, "A QR payload was treated as a retail barcode.")
    print("Vision read generated EAN-8, EAN-13 and rotated UPC-A, preserved multiple codes and ignored a QR code.")
  }

  private static func makeCanvas(width: Int, height: Int) -> CGContext {
    let canvas = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    canvas.setFillColor(CGColor(gray: 1, alpha: 1))
    canvas.fill(CGRect(x: 0, y: 0, width: width, height: height))
    canvas.setFillColor(CGColor(gray: 0, alpha: 1))
    return canvas
  }

  private static func draw(_ digits: String, y: Int, on canvas: CGContext) {
    let digits = digits.compactMap(\.wholeNumberValue)
    func right(_ digit: Int) -> String {
      String(left[digit].map { $0 == "0" ? Character("1") : Character("0") })
    }
    let front = digits.count == 8 ? digits.prefix(4).map { left[$0] }.joined()
      : zip(digits.dropFirst().prefix(6), parity[digits[0]]).map { digit, mode in
        mode == "L" ? left[digit] : String(right(digit).reversed())
      }.joined()
    let back = digits.suffix(digits.count == 8 ? 4 : 6).map(right).joined()
    let pattern = "101" + front + "01010" + back + "101"
    for (index, module) in pattern.enumerated() where module == "1" {
      canvas.fill(CGRect(x: 95 + 7 * index, y: y, width: 7, height: 160))
    }
  }

  private static func write(_ canvas: CGContext, orientation: CGImagePropertyOrientation, to url: URL) throws -> URL {
    let image = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil)!
    CGImageDestinationAddImage(image, canvas.makeImage()!, [kCGImagePropertyOrientation: orientation.rawValue] as CFDictionary)
    precondition(CGImageDestinationFinalize(image))
    return url
  }
}

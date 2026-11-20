import Vision

enum CheapoRetailBarcodeVision {
  static func read(_ uri: String) throws -> [String] {
    let photo = try CheapoVisionPhoto.load(uri)
    let request = VNDetectBarcodesRequest()
    // Vision reports UPC-A as EAN-13. The shared GTIN validator normalizes its
    // leading zero and deduplicates it with a 12-digit result from Android.
    request.symbologies = [.ean8, .ean13]
    try VNImageRequestHandler(cgImage: photo.image, orientation: .up).perform([request])
    return (request.results ?? []).compactMap(\.payloadStringValue)
  }
}

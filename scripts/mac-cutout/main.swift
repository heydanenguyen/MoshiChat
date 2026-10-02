// moshi-cutout: lifts the subject out of a picture with macOS's own Vision model (the "lift subject" of Photos),
// for stickers. Runs in a fraction of a second with a few dozen MB, where the bundled BiRefNet model needs ~6 GB.
//
//   moshi-cutout <input image> <output png>
//
// Exit codes: 0 done, 2 cannot read the picture, 3 Vision failed, 4 no subject found, 5 macOS older than 14.
import CoreImage
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: moshi-cutout <input> <output.png>\n".data(using: .utf8)!)
  exit(64)
}

func fail(_ code: Int32, _ message: String) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(code)
}

@available(macOS 14.0, *)
func lift(_ input: String, to output: String) -> Never {
  guard let image = CIImage(contentsOf: URL(fileURLWithPath: input)) else { fail(2, "cannot read the picture") }
  let request = VNGenerateForegroundInstanceMaskRequest()
  let handler = VNImageRequestHandler(ciImage: image)
  do { try handler.perform([request]) } catch { fail(3, "vision failed: \(error)") }
  guard let result = request.results?.first, !result.allInstances.isEmpty else { fail(4, "no subject") }
  do {
    let masked = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    try CIContext().writePNGRepresentation(of: CIImage(cvPixelBuffer: masked), to: URL(fileURLWithPath: output), format: .RGBA8, colorSpace: space)
  } catch {
    fail(3, "could not write the cut-out: \(error)")
  }
  exit(0)
}

if #available(macOS 14.0, *) { lift(args[1], to: args[2]) }
fail(5, "needs macOS 14")

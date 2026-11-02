// App Store 拒绝带 alpha 的 1024 图标（错误 90717）。Tauri 生成的 AppIcon 来自品牌 PNG，
// 那些 PNG 带透明通道，这里统一铺白底导出不带 alpha 的版本。
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("用法：flatten-icon <源 PNG> <目标 PNG>\n".data(using: .utf8)!)
    exit(2)
}
let src = URL(fileURLWithPath: args[1])
let dst = URL(fileURLWithPath: args[2])
guard let source = CGImageSourceCreateWithURL(src as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { exit(3) }
let width = image.width, height = image.height
guard let ctx = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else { exit(4) }
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
guard let out = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(dst as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    exit(5)
}
CGImageDestinationAddImage(dest, out, nil)
guard CGImageDestinationFinalize(dest) else { exit(6) }
print("flattened \(width)x\(height) -> \(dst.lastPathComponent)")

import Foundation

// All inputs use AppKit points, bottom-left origin. A zero frame means no safe space.
func guideFrame(settings: CGRect, list: CGRect?, screen: CGRect, size: CGSize) -> CGRect {
    let gap: CGFloat = 8
    let anchor = list ?? settings
    let width = min(size.width, list?.width ?? size.width, screen.width - 24)
    let x = max(screen.minX + 12, min(anchor.maxX - width, screen.maxX - width - 12))
    let top = min(anchor.minY - gap, screen.maxY - 12)
    guard top - size.height >= screen.minY + 12 else { return .zero }
    return CGRect(x: x, y: top - size.height, width: width, height: size.height)
}

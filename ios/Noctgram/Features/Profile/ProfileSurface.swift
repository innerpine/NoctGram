import ImageIO
import SwiftUI

/// The Premium background of a profile card, as app/profile-surface.tsx
/// and profile-design.css paint it: the two colours, each mixed into
/// #0B0B10 at the chosen strength (15–40 %), in a gradient at 145°.
/// «Обложка» takes its colours from the cover, or from the avatar when
/// there is no cover picture, the way lib/image-palette.ts finds them.
struct ProfileSurfaceBackground: View {
    @EnvironmentObject private var session: AppSession
    let profile: Profile
    let active: Bool
    @State private var sampled: (url: URL, colors: [RGBColor])?

    private static let base = RGBColor(0x0B0B10)

    private var source: URL? {
        guard active, profile.background.mode == "cover" else { return nil }
        return session.api.mediaURL(profile.coverImage) ?? session.api.mediaURL(profile.avatar)
    }

    private var colors: [RGBColor] {
        let background = profile.background
        if background.mode == "custom",
           let first = RGBColor(hex: background.first),
           let second = RGBColor(hex: background.second) {
            return [first, second]
        }
        if background.mode == "cover", let sampled, sampled.url == source {
            return sampled.colors
        }
        let theme = profile.appearance.theme.hexes
        return [RGBColor(theme.first), RGBColor(theme.second)]
    }

    var body: some View {
        ZStack {
            Noct.card
            if active {
                let strength = Double(profile.background.intensity) / 100
                CSSLinearGradient(angle: 145, colors: colors.map { $0.mixed(into: Self.base, amount: strength).color })
            }
        }
        .task(id: source) {
            guard let source, let colors = await ImagePalette.colors(at: source) else { return }
            withAnimation(.easeOut(duration: 0.3)) { sampled = (source, colors) }
        }
    }
}

/// linear-gradient(<angle>deg, …) as CSS draws it: the line runs through
/// the centre at the angle, just long enough for the far corners to take
/// the end colours.
struct CSSLinearGradient: View {
    let angle: Double
    let colors: [Color]

    var body: some View {
        GeometryReader { geometry in
            let width = max(Double(geometry.size.width), 1)
            let height = max(Double(geometry.size.height), 1)
            let radians = angle * .pi / 180
            let dx = sin(radians), dy = -cos(radians)
            let length = abs(width * dx) + abs(height * dy)
            let x = dx * length / 2 / width, y = dy * length / 2 / height
            LinearGradient(
                colors: colors,
                startPoint: UnitPoint(x: CGFloat(0.5 - x), y: CGFloat(0.5 - y)),
                endPoint: UnitPoint(x: CGFloat(0.5 + x), y: CGFloat(0.5 + y))
            )
        }
    }
}

/// An sRGB colour with 0–255 channels, mixed as color-mix(in srgb, …) does.
struct RGBColor: Equatable {
    var red: Double
    var green: Double
    var blue: Double

    init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    init(_ hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF), green: Double((hex >> 8) & 0xFF), blue: Double(hex & 0xFF))
    }

    /// "#rrggbb".
    init?(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let number = UInt32(value, radix: 16) else { return nil }
        self.init(number)
    }

    /// This colour at `amount` (0–1), the rest `base`.
    func mixed(into base: RGBColor, amount: Double) -> RGBColor {
        RGBColor(
            red: red * amount + base.red * (1 - amount),
            green: green * amount + base.green * (1 - amount),
            blue: blue * amount + base.blue * (1 - amount)
        )
    }

    var color: Color {
        Color(.sRGB, red: red / 255, green: green / 255, blue: blue / 255, opacity: 1)
    }
}

/// The two main colours of a picture (lib/image-palette.ts): drawn at
/// 24×24, with transparent, nearly black and nearly white pixels left out,
/// the rest put into 512 bins and ranked by area and saturation. The second
/// colour is the first that differs enough from the first.
enum ImagePalette {
    @MainActor private static var cache: [URL: [RGBColor]] = [:]

    @MainActor
    static func colors(at url: URL) async -> [RGBColor]? {
        if let cached = cache[url] { return cached }
        guard let data = await ImagePipeline.shared.data(for: url) else { return nil }
        let colors = await Task.detached(priority: .utility) { palette(of: data) }.value
        if let colors {
            if cache.count >= 64 { cache.removeAll() }
            cache[url] = colors
        }
        return colors
    }

    static func palette(of data: Data) -> [RGBColor]? {
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 96,
        ] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options),
              let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let side = 24
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8,
                bytesPerRow: side * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        return drawn ? palette(pixels) : nil
    }

    /// RGBA bytes, premultiplied as Core Graphics keeps them.
    static func palette(_ pixels: [UInt8]) -> [RGBColor]? {
        struct Bin {
            var red = 0.0, green = 0.0, blue = 0.0, weight = 0.0, count = 0.0
            var order = 0
        }
        var bins: [Int: Bin] = [:]
        for index in stride(from: 0, to: pixels.count - 3, by: 4) {
            let alpha = Double(pixels[index + 3])
            guard alpha >= 128 else { continue }
            // The site reads straight colours from its canvas.
            let straight = { (value: UInt8) in min(255, (Double(value) * 255 / alpha).rounded()) }
            let red = straight(pixels[index]), green = straight(pixels[index + 1]), blue = straight(pixels[index + 2])
            let high = max(red, green, blue), low = min(red, green, blue)
            if high < 28 || low > 235 { continue }
            let key = (Int(red) >> 5) * 64 + (Int(green) >> 5) * 8 + (Int(blue) >> 5)
            var bin = bins[key] ?? Bin(order: bins.count)
            bin.red += red
            bin.green += green
            bin.blue += blue
            bin.count += 1
            bin.weight += 1 + (high - low) / 90
            bins[key] = bin
        }
        let colors = bins.values
            .sorted { $0.weight != $1.weight ? $0.weight > $1.weight : $0.order < $1.order }
            .map { RGBColor(red: $0.red / $0.count, green: $0.green / $0.count, blue: $0.blue / $0.count) }
        guard let first = colors.first else { return nil }
        let apart = { (color: RGBColor) -> Double in
            let red = color.red - first.red, green = color.green - first.green, blue = color.blue - first.blue
            return red * red + green * green + blue * blue
        }
        let second = colors.first { apart($0) > 5000 } ?? colors[min(1, colors.count - 1)]
        let rounded = { (color: RGBColor) in
            RGBColor(red: color.red.rounded(), green: color.green.rounded(), blue: color.blue.rounded())
        }
        return [rounded(first), rounded(second)]
    }
}

private struct ProfileSurfaceKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// The profile card wears its Premium background: quiet text is
    /// brighter and small cards darken it instead of lightening it
    /// (profile-design.css, [data-profile-background]).
    var onProfileSurface: Bool {
        get { self[ProfileSurfaceKey.self] }
        set { self[ProfileSurfaceKey.self] = newValue }
    }
}

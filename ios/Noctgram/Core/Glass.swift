import SwiftUI

/// Liquid Glass. On iOS 26 controls use the system material (refraction,
/// specular highlights, touch response); iOS 16–25 get a frosted imitation
/// with a light edge, so the functional layer looks the same everywhere.
/// Content (cards, posts, bubbles) stays on the solid black surfaces.
enum LiquidGlass {
    static var isNative: Bool {
        if #available(iOS 26.0, *) { return true }
        return false
    }

    /// iOS 26 puts toolbar icons on glass already, so the circled symbol
    /// would draw a ring inside the glass.
    static var moreIcon: String { isNative ? "ellipsis" : "ellipsis.circle" }

    /// Specular rim of the fallback: bright top-left, faint middle.
    static var rim: LinearGradient {
        LinearGradient(
            colors: [.white.opacity(0.42), .white.opacity(0.06), .white.opacity(0.2)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct GlassSurface<S: Shape>: ViewModifier {
    let shape: S
    var interactive = false
    var tint: Color?

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(glass, in: shape)
        } else {
            content
                .background {
                    ZStack {
                        shape.fill(.ultraThinMaterial)
                        if let tint { shape.fill(tint.opacity(0.88)) }
                    }
                }
                .overlay(shape.stroke(LiquidGlass.rim, lineWidth: 0.75))
        }
    }

    @available(iOS 26.0, *)
    private var glass: Glass {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint) }
        if interactive { glass = glass.interactive() }
        return glass
    }
}

extension View {
    func noctGlass<S: Shape>(_ shape: S, interactive: Bool = false, tint: Color? = nil) -> some View {
        modifier(GlassSurface(shape: shape, interactive: interactive, tint: tint))
    }

    func glassCapsule(interactive: Bool = false, tint: Color? = nil) -> some View {
        noctGlass(Capsule(), interactive: interactive, tint: tint)
    }

    func glassCircle(interactive: Bool = false, tint: Color? = nil) -> some View {
        noctGlass(Circle(), interactive: interactive, tint: tint)
    }

    func glassRect(_ radius: CGFloat, interactive: Bool = false, tint: Color? = nil) -> some View {
        noctGlass(RoundedRectangle(cornerRadius: radius, style: .continuous), interactive: interactive, tint: tint)
    }

    /// Input field on glass (login, composers).
    func glassField(radius: CGFloat = 16) -> some View {
        padding(.horizontal, 16)
            .padding(.vertical, 13)
            .glassRect(radius)
    }

    /// A bottom bar that content scrolls under; iOS 26 blurs the edge beneath
    /// it, earlier systems get a dark fade so the glass controls stay legible.
    @ViewBuilder
    func glassBottomBar<Bar: View>(@ViewBuilder _ bar: () -> Bar) -> some View {
        let content = bar()
        if #available(iOS 26.0, *) {
            if ChatProbe.has("nobar") {
                safeAreaInset(edge: .bottom) { content }
            } else {
                safeAreaBar(edge: .bottom) { content }
            }
        } else {
            safeAreaInset(edge: .bottom) {
                content.background {
                    LinearGradient(colors: [.black.opacity(0), .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                        .ignoresSafeArea(edges: .bottom)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    /// Search field: in the floating tab bar on iOS 26 (the search tab),
    /// under the navigation bar earlier.
    @ViewBuilder
    func glassSearchable(text: Binding<String>, prompt: String) -> some View {
        if #available(iOS 26.0, *) {
            searchable(text: text, prompt: Text(prompt))
        } else {
            searchable(text: text, placement: .navigationBarDrawer(displayMode: .always), prompt: Text(prompt))
        }
    }

    /// Sheets keep the system glass on iOS 26 and the elevated black earlier.
    @ViewBuilder
    func sheetSurface() -> some View {
        if #available(iOS 26.0, *) {
            self
        } else {
            background(Noct.elevated.ignoresSafeArea())
        }
    }

    /// The floating tab bar shrinks while scrolling down (iOS 26).
    @ViewBuilder
    func minimizesTabBarOnScroll() -> some View {
        if #available(iOS 26.0, *) {
            tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
    }

    /// Reports whether the view is on screen inside a scroll view (iOS 18+).
    @ViewBuilder
    func onScrollVisible(_ action: @escaping (Bool) -> Void) -> some View {
        if #available(iOS 18.0, *) {
            onScrollVisibilityChange(threshold: 0.1) { action($0) }
        } else {
            self
        }
    }
}

extension Noct {
    /// Row fill inside sheets: iOS 26 sheets are glass themselves.
    static var sheetRow: Color { LiquidGlass.isNative ? Color.white.opacity(0.04) : elevated }
}

/// Groups glass shapes so they are sampled together and blend like liquid
/// when they move close (GlassEffectContainer on iOS 26).
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat?
    @ViewBuilder var content: Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

/// Slow night aurora behind glass controls on the login screens, so the
/// glass has colour to refract while the page stays black.
struct NightAurora: View {
    @State private var drift = false

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            ZStack {
                Color.black
                Circle()
                    .fill(Color(hex: 0x7A56C4))
                    .frame(width: size.width * 1.1)
                    .blur(radius: 90)
                    .opacity(0.55)
                    .offset(x: drift ? -size.width * 0.28 : size.width * 0.18, y: drift ? -size.height * 0.34 : -size.height * 0.18)
                Circle()
                    .fill(Color(hex: 0x426B98))
                    .frame(width: size.width)
                    .blur(radius: 100)
                    .opacity(0.5)
                    .offset(x: drift ? size.width * 0.32 : -size.width * 0.12, y: drift ? -size.height * 0.02 : -size.height * 0.26)
                Circle()
                    .fill(Color(hex: 0xC9A9FF))
                    .frame(width: size.width * 0.55)
                    .blur(radius: 80)
                    .opacity(0.3)
                    .offset(x: drift ? -size.width * 0.05 : size.width * 0.3, y: drift ? -size.height * 0.12 : -size.height * 0.38)
                LinearGradient(colors: [.clear, .black.opacity(0.65), .black], startPoint: .center, endPoint: .bottom)
            }
            .frame(width: size.width, height: size.height)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.easeInOut(duration: 14).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

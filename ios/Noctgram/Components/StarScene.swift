import SceneKit
import SwiftUI
import UIKit

/// The Noct Stars hero, as on the site (app/star-scene.tsx) and in Telegram:
/// a gold star in 3D that sways on its own and spins under the finger, with
/// small stars flying out around it. A tap spins it and restarts the burst.
struct StarScene: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var burst = Date()

    var body: some View {
        ZStack {
            StarBurst(start: burst, still: reduceMotion)
            GoldStar(still: reduceMotion) { burst = Date() }
                .frame(width: 156, height: 156)
                .shadow(color: Color(hex: 0x9C63FF, opacity: 0.12), radius: 12, y: 8)
        }
        .frame(width: 276, height: 184)
        .accessibilityElement()
        .accessibilityLabel("Noct Stars")
        .accessibilityAddTraits(.isImage)
    }
}

/// Twelve small stars fly out of the centre and fade, again and again
/// (premium-particle-flight in app/redesign.css): 4.8 s each, from the
/// centre to 58 % of the way with a turn, then on to the end, shrinking.
private struct StarBurst: View {
    let start: Date
    let still: Bool

    /// x, y, size, turn in degrees, delay in seconds (app/star-scene.tsx).
    private static let particles: [(x: CGFloat, y: CGFloat, size: CGFloat, turn: Double, delay: Double)] = [
        (-108, -56, 15, -42, 0), (-58, -76, 12, 28, 0.22), (3, -83, 13, -24, 0.45),
        (64, -66, 18, 40, 0.13), (113, -36, 12, 65, 0.64), (120, 12, 15, -38, 0.36),
        (84, 61, 11, 54, 0.78), (35, 76, 14, -28, 0.28), (-35, 72, 11, 48, 0.92),
        (-94, 45, 17, -55, 0.53), (-124, 3, 11, 32, 0.82), (42, -38, 9, -70, 1.1),
    ]
    private static let period = 4.8

    var body: some View {
        Group {
            if still {
                // Reduce Motion: four stars rest where they would land, as on the site.
                ZStack {
                    ForEach(0..<4, id: \.self) { index in
                        let particle = Self.particles[index]
                        icon(particle.size)
                            .rotationEffect(.degrees(particle.turn))
                            .scaleEffect(0.7)
                            .offset(x: particle.x, y: particle.y)
                            .opacity(0.55)
                    }
                }
            } else {
                TimelineView(.animation) { timeline in
                    let elapsed = timeline.date.timeIntervalSince(start)
                    ZStack {
                        ForEach(0..<Self.particles.count, id: \.self) { index in
                            let particle = Self.particles[index]
                            let flight = Flight(at: elapsed - particle.delay, period: Self.period)
                            icon(particle.size)
                                .rotationEffect(.degrees(particle.turn * flight.turns))
                                .scaleEffect(flight.scale)
                                .offset(x: particle.x * flight.travel, y: particle.y * flight.travel)
                                .opacity(flight.opacity)
                        }
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func icon(_ size: CGFloat) -> some View {
        Image("StarsIcon").resizable().scaledToFit().frame(width: size, height: size)
    }

    /// One particle's keyframes at a moment of its loop.
    struct Flight {
        var opacity = 0.0
        var travel: CGFloat = 0
        var scale: CGFloat = 0.15
        var turns = 0.0

        init(at time: Double, period: Double) {
            // Before its delay a particle is not shown yet.
            guard time >= 0 else { return }
            let p = time.truncatingRemainder(dividingBy: period) / period
            switch p {
            case ..<0.06:
                break
            case ..<0.36:
                let e = Self.ease((p - 0.06) / 0.30)
                travel = 0.58 * e
                scale = 0.15 + 0.85 * e
                turns = e
            case ..<0.68:
                let e = Self.ease((p - 0.36) / 0.32)
                travel = 0.58 + 0.42 * e
                scale = 1 - 0.75 * e
                turns = 1 + e
            default:
                travel = 1
                scale = 0.25
                turns = 2
            }
            switch p {
            case ..<0.06: opacity = 0
            case ..<0.15: opacity = 0.85 * Self.ease((p - 0.06) / 0.09)
            case ..<0.36: opacity = 0.85 - 0.05 * Self.ease((p - 0.15) / 0.21)
            case ..<0.68: opacity = 0.8 * (1 - Self.ease((p - 0.36) / 0.32))
            default: opacity = 0
            }
        }

        /// cubic-bezier(0.22, 1, 0.36, 1), the site's --motion.
        static func ease(_ x: Double) -> Double {
            let x1 = 0.22, y1 = 1.0, x2 = 0.36, y2 = 1.0
            func curve(_ t: Double, _ a: Double, _ b: Double) -> Double {
                3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t
            }
            var t = x
            for _ in 0..<8 {
                let slope = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2)
                guard abs(slope) > 1e-6 else { break }
                t = min(1, max(0, t - (curve(t, x1, x2) - x) / slope))
            }
            return curve(t, y1, y2)
        }
    }
}

/// The star of the Noct Stars icon in gold, extruded with rounded edges.
private struct GoldStar: UIViewRepresentable {
    let still: Bool
    let tapped: () -> Void

    func makeCoordinator() -> GoldStarController {
        GoldStarController()
    }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero)
        view.backgroundColor = .clear
        view.antialiasingMode = .multisampling4X
        view.preferredFramesPerSecond = 60
        context.coordinator.tapped = tapped
        context.coordinator.attach(to: view, still: still)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        context.coordinator.tapped = tapped
    }

    static func dismantleUIView(_ view: SCNView, coordinator: GoldStarController) {
        view.scene?.isPaused = true
    }
}

/// Sways the star (the web's float: up and down with a tilt) and spins it
/// with the finger; a spin always settles facing the viewer.
final class GoldStarController: NSObject, UIGestureRecognizerDelegate {
    var tapped: () -> Void = {}
    private let sway = SCNNode()
    private let star = SCNNode()
    private var dragStart: Float = 0
    private let fullTurn = Float.pi * 2

    func attach(to view: SCNView, still: Bool) {
        let scene = SCNScene()
        scene.background.contents = UIColor.clear
        scene.lightingEnvironment.contents = Self.environment()
        scene.lightingEnvironment.intensity = 1.4

        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 28
        camera.position = SCNVector3(0, 0, 5)
        scene.rootNode.addChildNode(camera)

        let key = SCNNode()
        key.light = SCNLight()
        key.light?.type = .directional
        key.light?.intensity = 800
        key.eulerAngles = SCNVector3(-0.7, 0.6, 0)
        scene.rootNode.addChildNode(key)

        star.geometry = Self.geometry()
        sway.addChildNode(star)
        scene.rootNode.addChildNode(sway)

        view.scene = scene
        view.pointOfView = camera
        view.autoenablesDefaultLighting = false
        view.allowsCameraControl = false

        let drag = UIPanGestureRecognizer(target: self, action: #selector(turn(_:)))
        drag.delegate = self
        view.addGestureRecognizer(drag)
        view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tap)))

        if !still { swayForever() }
    }

    /// app/redesign.css premium-star-float: 5 s up and down with a tilt,
    /// here also a little turn to show the depth.
    private func swayForever() {
        let up = SCNAction.group([
            .move(to: SCNVector3(0, 0.07, 0), duration: 2.5),
            .rotateTo(x: -0.06, y: 0.32, z: 0.09, duration: 2.5, usesShortestUnitArc: true),
        ])
        let down = SCNAction.group([
            .move(to: SCNVector3(0, -0.03, 0), duration: 2.5),
            .rotateTo(x: 0.05, y: -0.32, z: -0.07, duration: 2.5, usesShortestUnitArc: true),
        ])
        up.timingMode = .easeInEaseOut
        down.timingMode = .easeInEaseOut
        sway.runAction(.repeatForever(.sequence([up, down])), forKey: "sway")
    }

    @objc private func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        tapped()
        spin(to: (star.eulerAngles.y / fullTurn).rounded() * fullTurn + fullTurn, duration: 1.1)
    }

    @objc private func turn(_ pan: UIPanGestureRecognizer) {
        let dx = Float(pan.translation(in: pan.view).x)
        switch pan.state {
        case .began:
            star.removeAction(forKey: "spin")
            dragStart = star.eulerAngles.y
        case .changed:
            star.eulerAngles.y = dragStart + dx * 0.012
        case .ended, .cancelled:
            // Keep turning with the finger's speed, then face the viewer.
            let fling = Float(pan.velocity(in: pan.view).x) * 0.0025
            let target = ((star.eulerAngles.y + fling) / fullTurn).rounded() * fullTurn
            spin(to: target, duration: Double(min(1.6, max(0.5, abs(target - star.eulerAngles.y) / 5))))
        default:
            break
        }
    }

    private func spin(to angle: Float, duration: Double) {
        let action = SCNAction.rotateTo(x: 0, y: CGFloat(angle), z: 0, duration: duration, usesShortestUnitArc: false)
        action.timingMode = .easeOut
        star.runAction(action, forKey: "spin")
    }

    /// Only a sideways drag turns the star; up and down scroll the page,
    /// which waits for a sideways drag to be ruled out.
    func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
        guard let pan = recognizer as? UIPanGestureRecognizer else { return true }
        var way = pan.translation(in: pan.view)
        if way == .zero { way = pan.velocity(in: pan.view) }
        return abs(way.x) > abs(way.y)
    }

    func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        recognizer is UIPanGestureRecognizer && other.view is UIScrollView
    }

    /// The outline of the icon's star (traced from StarsArt, x and y in
    /// -1…1), smoothed with Catmull-Rom curves and extruded.
    private static func geometry() -> SCNGeometry {
        let points = stride(from: 0, to: outline.count - 1, by: 2).map { CGPoint(x: outline[$0], y: outline[$0 + 1]) }
        let path = UIBezierPath()
        path.move(to: points[0])
        for index in points.indices {
            let p0 = points[(index + points.count - 1) % points.count]
            let p1 = points[index]
            let p2 = points[(index + 1) % points.count]
            let p3 = points[(index + 2) % points.count]
            path.addCurve(
                to: p2,
                controlPoint1: CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6),
                controlPoint2: CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6)
            )
        }
        path.close()
        path.flatness = 0.004

        let shape = SCNShape(path: path, extrusionDepth: 0.3)
        shape.chamferRadius = 0.06
        shape.chamferMode = .both
        // A quarter circle: rounded, not cut, edges.
        let profile = UIBezierPath(arcCenter: CGPoint(x: 1, y: 1), radius: 1, startAngle: .pi, endAngle: .pi * 1.5, clockwise: true)
        profile.flatness = 0.05
        shape.chamferProfile = profile
        shape.materials = [gold()]
        return shape
    }

    /// Polished gold, yellow at the top and amber below like the icon.
    private static func gold() -> SCNMaterial {
        let size = CGSize(width: 8, height: 256)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            let colors = [UIColor(red: 1, green: 0.86, blue: 0.34, alpha: 1).cgColor, UIColor(red: 1, green: 0.66, blue: 0.1, alpha: 1).cgColor]
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1]) {
                context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            }
        }
        let material = SCNMaterial()
        material.lightingModel = .physicallyBased
        material.diffuse.contents = image
        material.metalness.contents = 0.8
        material.roughness.contents = 0.26
        return material
    }

    /// A soft studio for the reflections: warm light above, a lilac floor
    /// like the app's accents, two bright windows for highlights.
    private static func environment() -> UIImage {
        let size = CGSize(width: 256, height: 128)
        return UIGraphicsImageRenderer(size: size).image { context in
            let cg = context.cgContext
            let colors = [
                UIColor(white: 1, alpha: 1).cgColor,
                UIColor(red: 1, green: 0.93, blue: 0.8, alpha: 1).cgColor,
                UIColor(red: 0.35, green: 0.27, blue: 0.45, alpha: 1).cgColor,
                UIColor(red: 0.08, green: 0.07, blue: 0.1, alpha: 1).cgColor,
            ]
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 0.4, 0.55, 1]) {
                cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            }
            cg.setFillColor(UIColor.white.cgColor)
            cg.fillEllipse(in: CGRect(x: 40, y: 20, width: 46, height: 26))
            cg.fillEllipse(in: CGRect(x: 170, y: 30, width: 30, height: 18))
        }
    }

    private static let outline: [CGFloat] = [
        -0.0059, 0.9279, -0.0327, 0.9150, -0.0520, 0.9002, -0.0789, 0.8690, -0.1583, 0.7309,
        -0.3070, 0.4459, -0.3310, 0.4115, -0.3578, 0.3875, -0.3979, 0.3696, -0.4468, 0.3598,
        -0.9100, 0.2867, -0.9412, 0.2778, -0.9679, 0.2650, -0.9857, 0.2493, -0.9961, 0.2321,
        -1.0000, 0.2010, -0.9962, 0.1831, -0.9833, 0.1564, -0.9546, 0.1178, -0.8992, 0.0629,
        -0.8209, -0.0001, -0.7586, -0.0409, -0.7052, -0.0676, -0.6517, -0.0851, -0.5894, -0.0945,
        -0.5315, -0.0932, 0.0386, -0.0110, 0.0876, -0.0123, 0.1054, -0.0204, 0.1118, -0.0306,
        0.1115, -0.0395, 0.1054, -0.0510, 0.0698, -0.0811, 0.0208, -0.1078, -0.1752, -0.1983,
        -0.3845, -0.3058, -0.4602, -0.3546, -0.5191, -0.4092, -0.5420, -0.4404, -0.5596, -0.4715,
        -0.5817, -0.5294, -0.6043, -0.6141, -0.6306, -0.7610, -0.6341, -0.8189, -0.6265, -0.8635,
        -0.6081, -0.8946, -0.5983, -0.9042, -0.5805, -0.9138, -0.5626, -0.9186, -0.5359, -0.9189,
        -0.4958, -0.9092, -0.3667, -0.8466, -0.1039, -0.7104, -0.0638, -0.6934, -0.0237, -0.6875,
        0.0208, -0.6977, 0.2568, -0.8247, 0.4528, -0.9139, 0.4929, -0.9269, 0.5330, -0.9314,
        0.5597, -0.9271, 0.5864, -0.9133, 0.6051, -0.8946, 0.6236, -0.8590, 0.6321, -0.8189,
        0.6338, -0.7833, 0.6319, -0.7388, 0.6231, -0.6675, 0.5758, -0.3647, 0.5723, -0.3112,
        0.5811, -0.2711, 0.6076, -0.2310, 0.6398, -0.1987, 0.9313, 0.0674, 0.9708, 0.1119,
        0.9932, 0.1520, 1.0000, 0.1921, 0.9926, 0.2277, 0.9717, 0.2544, 0.9382, 0.2735,
        0.8759, 0.2866, 0.6888, 0.3067, 0.4706, 0.3376, 0.4305, 0.3468, 0.3870, 0.3702,
        0.3637, 0.3934, 0.3393, 0.4326, 0.2125, 0.6998, 0.1240, 0.8690, 0.0999, 0.9002,
        0.0742, 0.9200, 0.0385, 0.9314, 0.0114, 0.9314,
    ]
}

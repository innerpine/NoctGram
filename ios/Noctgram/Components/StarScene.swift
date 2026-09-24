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

    /// The outline of the icon's star (traced from StarsArt, smoothed and
    /// evenly spaced, x and y in -1…1), extruded.
    private static func geometry() -> SCNGeometry {
        let path = UIBezierPath()
        path.move(to: CGPoint(x: outline[0], y: outline[1]))
        for index in stride(from: 2, to: outline.count - 1, by: 2) {
            path.addLine(to: CGPoint(x: outline[index], y: outline[index + 1]))
        }
        path.close()

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

    /// A soft studio for the reflections: warm light above, a dark amber
    /// floor for golden edges, two bright windows for highlights.
    private static func environment() -> UIImage {
        let size = CGSize(width: 256, height: 128)
        return UIGraphicsImageRenderer(size: size).image { context in
            let cg = context.cgContext
            let colors = [
                UIColor(white: 1, alpha: 1).cgColor,
                UIColor(red: 1, green: 0.93, blue: 0.8, alpha: 1).cgColor,
                UIColor(red: 0.42, green: 0.25, blue: 0.08, alpha: 1).cgColor,
                UIColor(red: 0.1, green: 0.06, blue: 0.03, alpha: 1).cgColor,
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
        -0.0198, 0.9232, -0.0472, 0.9059, -0.0703, 0.8830, -0.0899, 0.8571, -0.1074, 0.8296,
        -0.1236, 0.8014, -0.1394, 0.7729, -0.1549, 0.7443, -0.1703, 0.7156, -0.1856, 0.6869,
        -0.2008, 0.6580, -0.2158, 0.6292, -0.2308, 0.6003, -0.2458, 0.5714, -0.2607, 0.5425,
        -0.2758, 0.5136, -0.2910, 0.4848, -0.3070, 0.4565, -0.3252, 0.4295, -0.3474, 0.4057,
        -0.3740, 0.3871, -0.4038, 0.3742, -0.4353, 0.3659, -0.4672, 0.3597, -0.4993, 0.3542,
        -0.5314, 0.3488, -0.5635, 0.3435, -0.5957, 0.3382, -0.6278, 0.3330, -0.6600, 0.3279,
        -0.6921, 0.3230, -0.7243, 0.3181, -0.7565, 0.3134, -0.7887, 0.3087, -0.8210, 0.3040,
        -0.8532, 0.2992, -0.8852, 0.2936, -0.9170, 0.2865, -0.9477, 0.2757, -0.9751, 0.2586,
        -0.9944, 0.2328, -1.0000, 0.2011, -0.9922, 0.1696, -0.9764, 0.1412, -0.9564, 0.1155,
        -0.9342, 0.0917, -0.9107, 0.0692, -0.8862, 0.0478, -0.8610, 0.0271, -0.8352, 0.0073,
        -0.8087, -0.0115, -0.7814, -0.0292, -0.7532, -0.0455, -0.7240, -0.0600, -0.6939, -0.0722,
        -0.6628, -0.0819, -0.6310, -0.0888, -0.5987, -0.0928, -0.5662, -0.0939, -0.5337, -0.0923,
        -0.5013, -0.0890, -0.4690, -0.0847, -0.4368, -0.0800, -0.4046, -0.0752, -0.3724, -0.0703,
        -0.3402, -0.0655, -0.3081, -0.0606, -0.2759, -0.0558, -0.2436, -0.0511, -0.2114, -0.0463,
        -0.1793, -0.0415, -0.1471, -0.0367, -0.1148, -0.0319, -0.0826, -0.0274, -0.0504, -0.0229,
        -0.0181, -0.0184, 0.0142, -0.0146, 0.0467, -0.0130, 0.0785, -0.0188, 0.0954, -0.0430,
        0.0790, -0.0703, 0.0528, -0.0895, 0.0242, -0.1052, -0.0050, -0.1194, -0.0346, -0.1331,
        -0.0642, -0.1466, -0.0937, -0.1604, -0.1231, -0.1743, -0.1525, -0.1883, -0.1818, -0.2025,
        -0.2110, -0.2168, -0.2402, -0.2312, -0.2693, -0.2458, -0.2984, -0.2605, -0.3273, -0.2755,
        -0.3560, -0.2909, -0.3844, -0.3068, -0.4123, -0.3234, -0.4397, -0.3411, -0.4660, -0.3602,
        -0.4909, -0.3812, -0.5139, -0.4042, -0.5344, -0.4295, -0.5520, -0.4568, -0.5669, -0.4858,
        -0.5791, -0.5159, -0.5894, -0.5468, -0.5983, -0.5781, -0.6061, -0.6097, -0.6130, -0.6415,
        -0.6193, -0.6735, -0.6252, -0.7055, -0.6304, -0.7376, -0.6345, -0.7699, -0.6365, -0.8024,
        -0.6347, -0.8348, -0.6264, -0.8662, -0.6093, -0.8936, -0.5831, -0.9125, -0.5517, -0.9199,
        -0.5194, -0.9173, -0.4882, -0.9080, -0.4582, -0.8953, -0.4289, -0.8812, -0.3998, -0.8666,
        -0.3708, -0.8518, -0.3419, -0.8369, -0.3130, -0.8220, -0.2841, -0.8070, -0.2552, -0.7920,
        -0.2263, -0.7770, -0.1974, -0.7620, -0.1684, -0.7471, -0.1394, -0.7323, -0.1101, -0.7182,
        -0.0800, -0.7059, -0.0485, -0.6980, -0.0160, -0.6971, 0.0157, -0.7039, 0.0458, -0.7163,
        0.0747, -0.7312, 0.1032, -0.7469, 0.1317, -0.7627, 0.1602, -0.7783, 0.1889, -0.7937,
        0.2177, -0.8088, 0.2468, -0.8236, 0.2759, -0.8381, 0.3052, -0.8523, 0.3347, -0.8662,
        0.3642, -0.8798, 0.3939, -0.8931, 0.4238, -0.9060, 0.4542, -0.9178, 0.4853, -0.9273,
        0.5174, -0.9323, 0.5497, -0.9300, 0.5797, -0.9180, 0.6040, -0.8966, 0.6207, -0.8688,
        0.6303, -0.8378, 0.6347, -0.8056, 0.6354, -0.7731, 0.6337, -0.7406, 0.6304, -0.7082,
        0.6261, -0.6759, 0.6213, -0.6437, 0.6162, -0.6116, 0.6111, -0.5794, 0.6060, -0.5473,
        0.6008, -0.5151, 0.5957, -0.4830, 0.5907, -0.4508, 0.5859, -0.4186, 0.5816, -0.3864,
        0.5784, -0.3540, 0.5781, -0.3214, 0.5834, -0.2894, 0.5957, -0.2594, 0.6139, -0.2325,
        0.6358, -0.2084, 0.6592, -0.1858, 0.6832, -0.1638, 0.7074, -0.1420, 0.7315, -0.1201,
        0.7557, -0.0984, 0.7799, -0.0766, 0.8041, -0.0548, 0.8282, -0.0329, 0.8523, -0.0110,
        0.8763, 0.0110, 0.9001, 0.0332, 0.9235, 0.0558, 0.9460, 0.0793, 0.9669, 0.1043,
        0.9845, 0.1316, 0.9966, 0.1618, 1.0000, 0.1941, 0.9922, 0.2254, 0.9731, 0.2515,
        0.9462, 0.2695, 0.9156, 0.2804, 0.8837, 0.2868, 0.8514, 0.2912, 0.8191, 0.2948,
        0.7867, 0.2984, 0.7544, 0.3020, 0.7220, 0.3057, 0.6897, 0.3095, 0.6574, 0.3135,
        0.6251, 0.3177, 0.5928, 0.3221, 0.5606, 0.3266, 0.5284, 0.3314, 0.4962, 0.3365,
        0.4643, 0.3429, 0.4332, 0.3523, 0.4040, 0.3667, 0.3785, 0.3868, 0.3574, 0.4116,
        0.3402, 0.4392, 0.3253, 0.4681, 0.3112, 0.4974, 0.2974, 0.5269, 0.2837, 0.5565,
        0.2699, 0.5860, 0.2560, 0.6154, 0.2419, 0.6447, 0.2276, 0.6740, 0.2133, 0.7032,
        0.1988, 0.7324, 0.1842, 0.7615, 0.1694, 0.7904, 0.1542, 0.8193, 0.1384, 0.8477,
        0.1209, 0.8752, 0.1000, 0.9000, 0.0741, 0.9196, 0.0438, 0.9310, 0.0114, 0.9323,
    ]
}

import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Prepares picked photos and videos for /api/upload: JPG/PNG/WebP/GIF,
/// MP4/WebM/MOV up to 25 MB (app/api/upload/route.ts).
enum MediaEncoder {
    struct Prepared {
        let data: Data
        let mimeType: String
        let filename: String
        let preview: UIImage?
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
    }

    static let limit = 25 * 1024 * 1024

    static func isVideo(_ types: [UTType]) -> Bool {
        types.contains { $0.conforms(to: .movie) || $0.conforms(to: .video) }
    }

    static func prepare(_ data: Data, types: [UTType], maxPixel: CGFloat = 2560) throws -> Prepared {
        if isVideo(types) {
            guard data.count <= limit else { throw Failure(errorDescription: "Видео больше 25 МБ. Выбери ролик покороче.") }
            let mp4 = types.contains { $0.conforms(to: .mpeg4Movie) }
            return Prepared(
                data: data,
                mimeType: mp4 ? "video/mp4" : "video/quicktime",
                filename: mp4 ? "video.mp4" : "video.mov",
                preview: videoPreview(data, ext: mp4 ? "mp4" : "mov")
            )
        }
        if types.contains(where: { $0.conforms(to: .gif) }), data.count <= limit {
            return Prepared(data: data, mimeType: "image/gif", filename: "animation.gif", preview: UIImage(data: data))
        }
        guard let image = ImagePipeline.downsample(data, maxPixel: maxPixel),
              let jpeg = image.jpegData(compressionQuality: 0.88) else {
            throw Failure(errorDescription: "Не удалось прочитать изображение.")
        }
        guard jpeg.count <= limit else { throw Failure(errorDescription: "Фото больше 25 МБ.") }
        return Prepared(data: jpeg, mimeType: "image/jpeg", filename: "photo.jpg", preview: image)
    }

    private static func videoPreview(_ data: Data, ext: String) -> UIImage? {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
        guard (try? data.write(to: file)) != nil else { return nil }
        defer { try? FileManager.default.removeItem(at: file) }
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: file))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 400, height: 400)
        guard let image = try? generator.copyCGImage(at: .zero, actualTime: nil) else { return nil }
        return UIImage(cgImage: image)
    }
}

struct ComposerAttachment: Identifiable {
    let id = UUID()
    var isVideo: Bool
    var preview: UIImage?
    var uploadId: String?
    var failed = false
}

/// New publication: text (5000), up to four photos/videos, a 2–6 option poll
/// and the 18+ mark. Channel admins can publish as the channel.
struct ComposerView: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    /// The channel to publish as; nil publishes from the own profile.
    let author: Identity?
    var onPublished: () -> Void = {}

    @State private var text = ""
    @State private var attachments: [ComposerAttachment] = []
    @State private var picked: [PhotosPickerItem] = []
    @State private var pollEnabled = false
    @State private var pollOptions = ["", ""]
    @State private var adult = false
    @State private var publishing = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var uploading: Bool { attachments.contains { $0.uploadId == nil && !$0.failed } }
    private var validPoll: [String] {
        pollOptions.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private var canPublish: Bool {
        guard !publishing, !uploading, text.count <= 5000 else { return false }
        let media = attachments.contains { $0.uploadId != nil }
        if pollEnabled { return !trimmed.isEmpty && validPoll.count >= 2 && !media }
        return !trimmed.isEmpty || media
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 12) {
                        if let person = author ?? session.me?.identity {
                            AvatarView(person: person, size: 40)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            if let author, author.id != session.myId {
                                Text("От имени канала «\(author.name)»")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundColor(Noct.text60)
                            }
                            TextField(pollEnabled ? "Вопрос опроса" : "Что нового?", text: $text, axis: .vertical)
                                .font(.system(size: 17))
                                .lineLimit(3...24)
                                .focused($focused)
                        }
                    }
                    if !attachments.isEmpty {
                        attachmentStrip
                    }
                    if pollEnabled {
                        pollEditor
                    }
                    if attachments.contains(where: { $0.uploadId != nil }) {
                        Toggle(isOn: $adult) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Отметить 18+")
                                    .font(.system(size: 15, weight: .medium))
                                Text("Фото и видео скроются до нажатия «Показать».")
                                    .font(.system(size: 12))
                                    .foregroundColor(Noct.text48)
                            }
                        }
                        .tint(Noct.green)
                    }
                    if let error {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(Noct.red)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Noct.elevated.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { bottomBar }
            .navigationTitle("Новая публикация")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await publish() }
                    } label: {
                        if publishing {
                            ProgressView().tint(.white)
                        } else {
                            Text("Опубликовать").fontWeight(.semibold)
                        }
                    }
                    .disabled(!canPublish)
                }
            }
        }
        .onChange(of: picked) { items in
            guard !items.isEmpty else { return }
            Task { await add(items) }
        }
        .onAppear { focused = true }
        .interactiveDismissDisabled(publishing || uploading)
    }

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(attachments) { item in
                    ZStack(alignment: .topTrailing) {
                        ZStack {
                            Noct.coverFill
                            if let preview = item.preview {
                                Image(uiImage: preview).resizable().scaledToFill()
                            }
                            if item.uploadId == nil && !item.failed {
                                Color.black.opacity(0.45)
                                ProgressView().tint(.white)
                            }
                            if item.failed {
                                Color.black.opacity(0.55)
                                Image(systemName: "exclamationmark.triangle.fill").foregroundColor(Noct.red)
                            }
                            if item.isVideo && item.uploadId != nil {
                                Image(systemName: "play.fill")
                                    .foregroundColor(.white)
                                    .padding(8)
                                    .background(Circle().fill(Color.black.opacity(0.5)))
                            }
                        }
                        .frame(width: 104, height: 104)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        Button {
                            attachments.removeAll { $0.id == item.id }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: 24, height: 24)
                                .background(Circle().fill(Color.black.opacity(0.7)))
                        }
                        .padding(5)
                    }
                }
            }
        }
    }

    private var pollEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Варианты ответа")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Noct.text48)
            ForEach(pollOptions.indices, id: \.self) { index in
                HStack(spacing: 8) {
                    TextField("Вариант \(index + 1)", text: Binding(
                        get: { pollOptions.indices.contains(index) ? pollOptions[index] : "" },
                        set: { value in
                            if pollOptions.indices.contains(index) { pollOptions[index] = String(value.prefix(100)) }
                        }
                    ))
                    .noctField()
                    if pollOptions.count > 2 {
                        Button {
                            pollOptions.remove(at: index)
                        } label: {
                            Image(systemName: "minus.circle")
                                .foregroundColor(Noct.text48)
                        }
                    }
                }
            }
            if pollOptions.count < 6 {
                Button {
                    pollOptions.append("")
                } label: {
                    Label("Добавить вариант", systemImage: "plus")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundColor(Noct.text75)
            }
            Text("Опрос публикуется без фото и видео, до 6 вариантов.")
                .font(.system(size: 12))
                .foregroundColor(Noct.text48)
        }
        .padding(14)
        .noctCard(radius: 14)
    }

    private var bottomBar: some View {
        HStack(spacing: 18) {
            PhotosPicker(
                selection: $picked,
                maxSelectionCount: max(1, 4 - attachments.count),
                matching: .any(of: [.images, .videos])
            ) {
                Image(systemName: "photo.on.rectangle")
                    .font(.system(size: 20))
            }
            .disabled(attachments.count >= 4 || pollEnabled)
            Button {
                withAnimation(Noct.quick) { pollEnabled.toggle() }
            } label: {
                Image(systemName: pollEnabled ? "chart.bar.fill" : "chart.bar")
                    .font(.system(size: 20))
            }
            .disabled(!attachments.isEmpty)
            Spacer()
            Text("\(text.count)/5000")
                .font(.system(size: 12))
                .foregroundColor(text.count > 5000 ? Noct.red : Noct.text48)
                .monospacedDigit()
        }
        .foregroundColor(.white)
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(Noct.elevated)
        .overlay(alignment: .top) { Rectangle().fill(Noct.border).frame(height: 0.5) }
    }

    private func update(_ id: UUID, _ change: (inout ComposerAttachment) -> Void) {
        guard let index = attachments.firstIndex(where: { $0.id == id }) else { return }
        change(&attachments[index])
    }

    private func add(_ items: [PhotosPickerItem]) async {
        picked = []
        for item in items.prefix(max(0, 4 - attachments.count)) {
            let attachment = ComposerAttachment(isVideo: MediaEncoder.isVideo(item.supportedContentTypes))
            attachments.append(attachment)
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw MediaEncoder.Failure(errorDescription: "Не удалось открыть файл.")
                }
                let prepared = try MediaEncoder.prepare(data, types: item.supportedContentTypes)
                update(attachment.id) { $0.preview = prepared.preview }
                let result = try await session.api.upload("/api/upload", data: prepared.data, filename: prepared.filename, mimeType: prepared.mimeType)
                update(attachment.id) { $0.uploadId = result["id"].str }
            } catch {
                update(attachment.id) { $0.failed = true }
                self.error = error.userMessage
            }
        }
    }

    private func publish() async {
        publishing = true
        error = nil
        defer { publishing = false }
        var body: [String: Any] = ["text": trimmed]
        let media = attachments.compactMap(\.uploadId)
        if pollEnabled {
            body["poll"] = validPoll
        } else if !media.isEmpty {
            body["media"] = media
            if adult { body["adult"] = true }
        }
        if let author, author.id != session.myId { body["as"] = author.id }
        do {
            let data = try await session.api.socialPost("post", body)
            Haptics.success()
            session.show(data["id"].string != nil ? "Опубликовано" : "Публикация отправлена на проверку")
            PostBus.shared.send(.created)
            onPublished()
            dismiss()
            await session.refreshMe()
        } catch {
            self.error = error.userMessage
        }
    }
}

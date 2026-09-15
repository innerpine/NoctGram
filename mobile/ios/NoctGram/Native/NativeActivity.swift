import SwiftUI

struct NGActivityView: View {
    @State private var rows: [NGRecord] = []
    @State private var loading = true
    @State private var error: String?
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if loading && rows.isEmpty { ProgressView().padding(40) }
                if let error {
                    Text(error).foregroundColor(.orange).font(.subheadline).padding()
                    Button("Обновить") { Task { await load() } }.padding()
                }
                if !loading && rows.isEmpty && error == nil {
                    NGEmptyState(title: "Пока тихо", message: "Здесь появятся новые сообщения, публикации и подарки.", systemImage: "bell")
                }
                ForEach(rows) { row in
                    NavigationLink {
                        NGActivityDestination(notification: row)
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            NGAvatar(url: row.string("avatar"), name: row.string("name"), size: 46)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(row.string("name", default: "NoctGram")).font(.headline).foregroundColor(.primary)
                                Text(description(row)).font(.subheadline).foregroundColor(NGTheme.muted)
                                Text(Date(timeIntervalSince1970: row.double("created") / 1000), style: .relative).font(.caption).foregroundColor(NGTheme.muted)
                            }
                            Spacer(minLength: 2)
                            if !row.bool("read") { Circle().fill(NGTheme.accent).frame(width: 7, height: 7).accessibilityLabel("Не прочитано") }
                        }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain)
                    Divider().padding(.leading, 76)
                }
            }
        }
        .background(NGTheme.background).navigationTitle("События")
        .refreshable { await load() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await load()
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Прочитано") { Task { await markRead() } }
                    .disabled(!rows.contains(where: { !$0.bool("read") }))
            }
        }
    }
    private func description(_ row: NGRecord) -> String {
        switch row.string("kind") {
        case "message": return "Новое сообщение"
        case "post": return "Новая публикация"
        case "gift": return "Отправил подарок"
        case "call": return "Аудиозвонок"
        default: return "Новое событие"
        }
    }
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let response = try await NoctAPI.shared.get("/api/social", query: ["action": "notifications"])
            try Task.checkCancellation()
            rows = response.objects("items")
            error = nil
        } catch is CancellationError { } catch { self.error = error.localizedDescription }
    }
    private func markRead() async {
        guard let before = rows.map({ $0.double("created") }).max() else { return }
        do {
            _ = try await NoctAPI.shared.post("/api/social", body: ["action": "readNotifications", "before": before])
            await load()
        } catch { self.error = error.localizedDescription }
    }
}

private struct NGActivityDestination: View {
    let notification: NGRecord
    @State private var destination: NGRecord?
    @State private var error: String?
    var body: some View {
        Group {
            if let destination {
                if notification.string("kind") == "post" { NGPostDetailView(post: destination) }
                else if notification.string("kind") == "message" { NGConversationView(person: destination) }
                else { NGProfileView(userID: destination.id) }
            } else if let error {
                NGEmptyState(title: "Недоступно", message: error, systemImage: "exclamationmark.circle")
            } else { ProgressView() }
        }
        .task {
            do {
                let isPost = notification.string("kind") == "post"
                let target = isPost ? notification.string("targetId") : notification.string("giftRecipient", default: notification.string("actorId"))
                destination = try await NoctAPI.shared.get("/api/social", query: ["action": isPost ? "post" : "profile", "id": target])
            } catch { self.error = error.localizedDescription }
        }
    }
}

import SwiftUI

/// Followers or following of a profile, 30 per page (action=connections).
struct ConnectionsView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let profileId: String
    let kind: ConnectionKind

    @State private var people: [Person] = []
    @State private var cursor: String?
    @State private var hasMore = true
    @State private var loading = false
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(people) { person in
                    Button {
                        nav.push(.profile(person.id))
                    } label: {
                        PersonRow(person: person.identity, subtitle: person.isChannel ? "Канал · @" + person.handle : nil)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(PressableStyle())
                    .onAppear {
                        if person.id == people.last?.id { Task { await load(reset: false) } }
                    }
                }
                if loading {
                    LoadingRow()
                } else if loaded && people.isEmpty {
                    if let error {
                        ErrorBanner(text: error) { Task { await load(reset: true) } }
                    } else {
                        EmptyState(icon: "person.2", text: kind == .followers ? "Подписчиков пока нет." : "Подписок пока нет.")
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .background(Noct.background)
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(reset: true) }
        .task { if !loaded { await load(reset: true) } }
    }

    private func load(reset: Bool) async {
        guard !loading, reset || hasMore else { return }
        loading = true
        defer { loading = false }
        var query: [String: String?] = ["id": profileId, "kind": kind.rawValue]
        if !reset, let cursor { query["after"] = cursor }
        do {
            let data = try await session.api.social("connections", query)
            let page = data["people"].array.map { Person($0) }
            people = reset ? page : people + page
            hasMore = data["hasMore"].bool
            cursor = data["nextCursor"].string
            error = nil
        } catch {
            if let message = error.userMessage { self.error = message }
            hasMore = false
        }
        loaded = true
    }
}

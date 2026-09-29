import SwiftUI

/// Search inside one chat (/api/chat-search, scope=chat), as «Поиск» in a
/// Telegram chat: matching messages newest first, a tap goes to one.
struct ChatSearchSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    /// `peer=<id>` for a dialogue, `room=<id>` for a group.
    let scope: [String: String]
    let open: (String) -> Void
    @State private var query = ""
    @State private var hits: [MessageHit] = []
    @State private var total: Int?
    @State private var searching = false
    @FocusState private var focused: Bool

    private var term: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            List {
                if let total, !term.isEmpty {
                    Text(total == 0 ? "Ничего не нашлось" : "Найдено: \(Format.count(total))")
                        .font(.system(size: 13))
                        .foregroundColor(Noct.text48)
                        .listRowBackground(Color.clear)
                }
                ForEach(hits) { hit in
                    Button {
                        dismiss()
                        open(hit.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(hit.senderName)
                                    .font(.system(size: 14, weight: .semibold))
                                    .lineLimit(1)
                                Spacer(minLength: 6)
                                Text(Format.threadTime(hit.created))
                                    .font(.system(size: 12))
                                    .foregroundColor(Noct.text48)
                            }
                            Text(PremiumEmoji.replace(hit.text))
                                .font(.system(size: 14))
                                .foregroundColor(Noct.text75)
                                .lineLimit(3)
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowBackground(Noct.sheetRow)
                    .accessibilityIdentifier("chat-hit-" + hit.id)
                }
                if searching && hits.isEmpty {
                    LoadingRow().listRowBackground(Color.clear)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .sheetSurface()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Поиск в чате")
            .navigationTitle("Поиск")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .task(id: term) { await search() }
        }
        .presentationDetents([.medium, .large])
    }

    private func search() async {
        guard !term.isEmpty else {
            hits = []
            total = nil
            return
        }
        searching = true
        defer { searching = false }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        var params: [String: String?] = ["scope": "chat", "q": term]
        for (key, value) in scope { params[key] = value }
        let data = try? await session.api.get("/api/chat-search", params)
        guard !Task.isCancelled else { return }
        hits = data?["items"].array.map { MessageHit($0) } ?? []
        total = data?["total"].int ?? hits.count
    }
}

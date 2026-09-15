import SwiftUI
import Foundation
import UIKit

private let ngChatReactionEmoji = ["👍", "❤️", "😂", "🔥", "🎉", "🤯", "😢", "👎"]

struct NGChatListItem: Identifiable {
    let record: NGRecord
    let isRoom: Bool
    var id: String { (isRoom ? "room:" : "person:") + record.id }
    var time: Double { isRoom ? (record.object("lastMessage")?.double("created") ?? record.double("updatedAt")) : record.double("lastTime") }
    var preview: String {
        if isRoom && record.string("kind") == "secret" { return "Секретный чат · требуется поддержка шифрования" }
        return isRoom ? (record.object("lastMessage")?.string("text", default: "Группа") ?? "Группа") : record.string("lastText")
    }
}

@MainActor
final class NGChatsModel: ObservableObject {
    @Published var items: [NGChatListItem] = []
    @Published var people: [NGRecord] = []
    @Published var foundRooms: [NGRecord] = []
    @Published var loading = false
    @Published var searching = false
    @Published var error: String?
    let api: NoctAPI
    private var owner = ""
    private var refreshSerial = 0
    private var searchSerial = 0
    private var archived = false

    init(api: NoctAPI? = nil) { self.api = api ?? .shared }

    func reset(owner: String) {
        guard self.owner != owner else { return }
        self.owner = owner
        refreshSerial += 1; searchSerial += 1
        items = []; people = []; foundRooms = []; error = nil
        loading = false; searching = false
    }

    func refresh(owner: String, archived: Bool) async {
        reset(owner: owner)
        guard !owner.isEmpty, !Task.isCancelled else { return }
        if self.archived != archived { items = []; self.archived = archived }
        refreshSerial += 1
        let ticket = refreshSerial
        if items.isEmpty { loading = true }
        defer { if self.owner == owner && ticket == refreshSerial { loading = false } }
        async let direct = ngChatFetch(api, path: "/api/social", query: ["action": "threads", "archived": archived ? "1" : "0", "actor": owner], key: "items")
        async let groups = ngChatFetch(api, path: "/api/rooms", query: ["action": "list", "archived": archived ? "1" : "0", "actor": owner], key: "rooms")
        let results = await [direct, groups]
        guard !Task.isCancelled, self.owner == owner, ticket == refreshSerial else { return }
        if let failure = results.compactMap(ngChatFailure).first(where: { ($0 as? NoctAPIError)?.isUnauthorized == true }) {
            items = []; error = failure.localizedDescription; return
        }
        var problems: [String] = []
        for (index, result) in results.enumerated() {
            let isRoom = index == 1
            switch result {
            case .success(let records):
                items.removeAll { $0.isRoom == isRoom }
                items.append(contentsOf: records.map { NGChatListItem(record: $0, isRoom: isRoom) })
            case .failure(let failure):
                if let apiError = failure as? NoctAPIError, [403, 404].contains(apiError.status) {
                    items.removeAll { $0.isRoom == isRoom }
                }
                problems.append((isRoom ? "Группы: " : "Диалоги: ") + failure.localizedDescription)
            }
        }
        items.sort { $0.time == $1.time ? $0.id < $1.id : $0.time > $1.time }
        error = problems.isEmpty ? nil : problems.joined(separator: "\n")
    }

    func search(_ query: String, owner: String) async {
        reset(owner: owner)
        searchSerial += 1
        let ticket = searchSerial
        people = []; foundRooms = []
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= 2, !owner.isEmpty else { searching = false; return }
        searching = true
        defer { if self.owner == owner && ticket == searchSerial { searching = false } }
        do {
            try await Task.sleep(nanoseconds: 350_000_000)
            async let users = ngChatFetch(api, path: "/api/social", query: ["action": "people", "q": term, "actor": owner], key: "items")
            async let rooms = ngChatFetch(api, path: "/api/rooms", query: ["action": "search", "q": term, "actor": owner], key: "rooms")
            let results = await [users, rooms]
            try Task.checkCancellation()
            guard self.owner == owner, ticket == searchSerial else { return }
            let failures = results.compactMap(ngChatFailure)
            if !failures.contains(where: { ($0 as? NoctAPIError)?.isUnauthorized == true }) {
                if case .success(let records) = results[0] { people = records }
                if case .success(let records) = results[1] { foundRooms = records.filter { $0.string("kind") != "secret" } }
            }
            error = failures.isEmpty ? nil : failures.map(\.localizedDescription).joined(separator: "\n")
        } catch {
            if !Task.isCancelled && self.owner == owner && ticket == searchSerial { self.error = error.localizedDescription }
        }
    }

    func archive(_ item: NGChatListItem, archived: Bool, owner: String) async {
        guard !owner.isEmpty, self.owner == owner else { return }
        do {
            if item.isRoom {
                _ = try await api.post("/api/rooms", body: ["action": "archive", "id": item.record.id, "archived": archived, "actor": owner])
            } else {
                _ = try await api.post("/api/social", body: ["action": "archiveChat", "peer": item.record.id, "archived": archived, "actor": owner])
            }
            guard self.owner == owner else { return }
            items.removeAll { $0.id == item.id }
        } catch { if self.owner == owner { self.error = error.localizedDescription } }
    }
}

private func ngChatRecords(_ result: NGRecord, key: String) throws -> [NGRecord] {
    guard let values = result.raw[key] as? [[String: Any]],
          values.allSatisfy({ !NGRecord($0).string("id").isEmpty }) else {
        throw NoctAPIError(code: "INVALID_CHAT_RESPONSE", message: "Сервер вернул некорректный список сообщений. Потяните экран вниз, чтобы повторить загрузку.")
    }
    return values.map { NGRecord($0) }
}

@MainActor
private func ngChatFetch(_ api: NoctAPI, path: String, query: [String: String], key: String) async -> Result<[NGRecord], Error> {
    do { return .success(try ngChatRecords(await api.get(path, query: query), key: key)) }
    catch { return .failure(error) }
}

private func ngChatFailure(_ result: Result<[NGRecord], Error>) -> Error? {
    if case .failure(let error) = result { return error }
    return nil
}

@MainActor
struct NGChatsView: View {
    @EnvironmentObject private var session: NativeSession
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model: NGChatsModel
    @State private var query = ""
    @State private var archived = false
    @State private var visible = false

    init(api: NoctAPI? = nil) {
        _model = StateObject(wrappedValue: NGChatsModel(api: api))
    }

    private var owner: String { session.user?.id ?? "" }
    private var taskID: String { "\(owner):\(visible):\(scenePhase == .active):\(archived)" }

    var body: some View {
        List {
            if let error = model.error {
                Text(error).font(.footnote).foregroundColor(.orange).listRowBackground(NGTheme.surface)
            }
            if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                searchResults
            } else if model.loading && model.items.isEmpty {
                HStack { Spacer(); ProgressView("Загружаем чаты"); Spacer() }.padding()
            } else if model.items.isEmpty {
                NGEmptyState(title: archived ? "Архив пуст" : "Пока нет чатов", message: "Найдите человека по имени или нику, чтобы начать переписку.", systemImage: "bubble.left.and.bubble.right")
                    .listRowBackground(Color.clear)
            } else {
                ForEach(model.items) { item in
                    chatLink(item)
                        .listRowBackground(NGTheme.surface)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button {
                                Task { await model.archive(item, archived: !archived, owner: owner) }
                            } label: {
                                Label(archived ? "Вернуть" : "В архив", systemImage: archived ? "tray.and.arrow.up" : "archivebox")
                            }.tint(NGTheme.accent)
                        }
                }
            }
        }
        .listStyle(.plain)
        .background(NGTheme.background)
        .navigationTitle(archived ? "Архив" : "Чаты")
        .searchable(text: $query, prompt: "Люди и публичные группы")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { archived.toggle(); query = "" } label: {
                    Image(systemName: archived ? "bubble.left.and.bubble.right" : "archivebox").frame(minWidth: 44, minHeight: 44)
                }.accessibilityLabel(archived ? "Вернуться к чатам" : "Открыть архив")
            }
        }
        .refreshable { await model.refresh(owner: owner, archived: archived) }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .onChange(of: archived) { _ in model.items = [] }
        .task(id: taskID) {
            guard visible, scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh(owner: owner, archived: archived)
                do { try await Task.sleep(nanoseconds: 6_000_000_000) } catch { break }
            }
        }
        .task(id: query + taskID) {
            guard visible, scenePhase == .active else { return }
            model.reset(owner: owner)
            await model.search(query, owner: owner)
        }
    }

    @ViewBuilder private var searchResults: some View {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 {
            Text("Введите хотя бы два символа").foregroundColor(NGTheme.muted)
        } else if model.searching {
            ProgressView("Поиск").padding()
        } else if model.people.isEmpty && model.foundRooms.isEmpty {
            NGEmptyState(title: "Ничего не найдено", message: "Попробуйте другое имя или ник.", systemImage: "magnifyingglass")
                .listRowBackground(Color.clear)
        }
        if !model.people.isEmpty {
            Section("Люди") {
                ForEach(model.people, id: \.id) { person in
                    NavigationLink(destination: NGConversationView(person: person, api: model.api)) {
                        NGChatPersonRow(person: person, subtitle: "@" + person.string("handle"))
                    }.listRowBackground(NGTheme.surface)
                }
            }
        }
        if !model.foundRooms.isEmpty {
            Section("Публичные группы") {
                ForEach(model.foundRooms, id: \.id) { room in
                    NavigationLink(destination: NGRoomConversationView(room: room, api: model.api)) {
                        NGChatPersonRow(person: room, subtitle: "\(room.int("memberCount")) участников")
                    }.listRowBackground(NGTheme.surface)
                }
            }
        }
    }

    @ViewBuilder private func chatLink(_ item: NGChatListItem) -> some View {
        if item.isRoom {
            NavigationLink(destination: NGRoomConversationView(room: item.record, api: model.api)) {
                NGChatSummaryRow(item: item).accessibilityIdentifier("chats.row." + item.record.id)
            }
        } else {
            NavigationLink(destination: NGConversationView(person: item.record, api: model.api)) {
                NGChatSummaryRow(item: item).accessibilityIdentifier("chats.row." + item.record.id)
            }
        }
    }
}

private struct NGChatPersonRow: View {
    let person: NGRecord
    let subtitle: String
    var body: some View {
        HStack(spacing: 12) {
            NGAvatar(url: person.string("avatar"), name: person.string("name"), size: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(person.string("name", default: "Участник")).font(.headline).foregroundColor(.primary)
                Text(subtitle).font(.subheadline).foregroundColor(NGTheme.muted).lineLimit(2)
            }
            Spacer(minLength: 0)
        }.padding(.vertical, 6)
    }
}

private struct NGChatSummaryRow: View {
    let item: NGChatListItem
    var body: some View {
        HStack(spacing: 12) {
            NGAvatar(url: item.record.string("avatar"), name: item.record.string("name"), size: 52)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(item.record.string("name", default: "Чат")).font(.headline).lineLimit(1)
                    if item.isRoom { Image(systemName: item.record.string("kind") == "secret" ? "lock.shield" : "person.2.fill").font(.caption).foregroundColor(NGTheme.muted) }
                    Spacer(minLength: 4)
                    if item.time > 0 { Text(ngChatDate(item.time), style: .time).font(.caption).foregroundColor(NGTheme.muted) }
                }
                HStack {
                    Text(item.preview.isEmpty ? "Сообщение" : item.preview).font(.subheadline).foregroundColor(NGTheme.muted).lineLimit(2)
                    Spacer(minLength: 4)
                    if item.record.int("unread") > 0 {
                        Text(item.record.int("unread") > 99 ? "99+" : String(item.record.int("unread")))
                            .font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 4)
                            .foregroundColor(.black).background(NGTheme.accent, in: Capsule())
                    }
                }
            }
        }.padding(.vertical, 7)
    }
}

private func ngChatDate(_ timestamp: Double) -> Date {
    Date(timeIntervalSince1970: timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp)
}

private struct NGChatPendingSend {
    let key: String
    let text: String
    let attachments: [String]
    let replyID: String?
}

@MainActor
final class NGConversationModel: ObservableObject {
    let target: NGRecord
    let isRoom: Bool
    let api: NoctAPI
    @Published var messages: [NGRecord] = []
    @Published var detail: NGRecord?
    @Published var draft = ""
    @Published var reply: NGRecord?
    @Published var uploads: [NGRecord] = []
    @Published var loading = true
    @Published var loadingEarlier = false
    @Published var sending = false
    @Published var uploading = false
    @Published var canSend = false
    @Published var needsJoin: Bool
    @Published var error: String?
    @Published var notice: String?
    @Published var retryPending = false
    @Published var nextCursor = ""
    var active = false
    private var owner = ""
    private var readThrough = ""
    private var pending: NGChatPendingSend?
    private var refreshSerial = 0
    private var reacting = Set<String>()
    private var loadedEarlier = false

    init(target: NGRecord, isRoom: Bool, api: NoctAPI? = nil) {
        self.target = target; self.isRoom = isRoom
        self.api = api ?? .shared
        self.needsJoin = isRoom && target.raw["joined"] != nil && !target.bool("joined")
    }

    var secret: Bool { target.string("kind") == "secret" || detail?.string("kind") == "secret" }
    var title: String { detail?.string("name") ?? target.string("name", default: "Чат") }
    var lastMessageID: String { messages.last?.id ?? "" }
    var composerLocked: Bool { !canSend || sending || uploading || retryPending || secret }
    var sendEnabled: Bool { !composerLocked && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !uploads.isEmpty) && draft.utf16.count <= 4000 }

    func reset(owner: String) {
        guard self.owner != owner else { return }
        self.owner = owner; refreshSerial += 1
        messages = []; detail = nil; uploads = []; draft = ""; reply = nil
        pending = nil; retryPending = false; readThrough = ""; nextCursor = ""
        error = nil; notice = nil; canSend = false; loading = true
        reacting = []; loadedEarlier = false
        sending = false; uploading = false; loadingEarlier = false
    }

    func refresh(owner: String) async {
        guard active, !owner.isEmpty, !secret, !Task.isCancelled else { return }
        reset(owner: owner)
        guard !needsJoin else { loading = false; return }
        refreshSerial += 1
        let ticket = refreshSerial
        defer { if self.owner == owner && ticket == refreshSerial { loading = false } }
        do {
            if isRoom {
                let result = try await api.get("/api/rooms", query: ["action": "room", "id": target.id, "actor": owner])
                try Task.checkCancellation()
                guard active, self.owner == owner, ticket == refreshSerial else { return }
                guard result.string("kind") != "secret" else { detail = result; messages = []; canSend = false; loading = false; return }
                try validateRoom(result, owner: owner)
                let page = try ngChatRecords(result, key: "messages")
                detail = result; canSend = result.bool("canSend")
                replaceLatest(page)
                loading = false; error = nil
                if !loadedEarlier { nextCursor = result.string("nextCursor") }
                if let latest = page.last, latest.id != readThrough, active {
                    try Task.checkCancellation()
                    do {
                        _ = try await api.post("/api/rooms", body: ["action": "read", "id": target.id, "through": latest.id, "actor": owner])
                        if active && self.owner == owner { readThrough = latest.id }
                    } catch {
                        // A read-receipt outage must not discard an already authorized history response.
                        if let apiError = error as? NoctAPIError, [401, 403, 404].contains(apiError.status) { throw error }
                        if active && self.owner == owner && !Task.isCancelled {
                            self.error = "Не удалось отметить сообщения прочитанными. " + error.localizedDescription
                        }
                    }
                }
            } else {
                // This endpoint marks incoming messages read. Never call it for a hidden conversation.
                async let conversation = ngChatFetch(api, path: "/api/social", query: ["action": "messages", "peer": target.id, "actor": owner], key: "items")
                async let access = messageAccess(owner: owner)
                let (result, permission) = await (conversation, access)
                try Task.checkCancellation()
                guard active, self.owner == owner, ticket == refreshSerial else { return }
                if case .failure(let failure) = permission,
                   let apiError = failure as? NoctAPIError, [401, 403, 404].contains(apiError.status) { throw failure }
                messages = try result.get()
                switch permission {
                case .success(let allowed): canSend = allowed; error = nil
                case .failure(let failure):
                    canSend = false
                    error = "Не удалось проверить возможность отправки. " + failure.localizedDescription
                }
            }
            guard self.owner == owner, !Task.isCancelled else { return }
            if let pending = pending {
                let expectedID = isRoom ? pending.key : "message:\(owner):\(pending.key)"
                if messages.contains(where: { $0.id == expectedID }) { finishDraft() }
            }
            loading = false
        } catch {
            if active && !Task.isCancelled && self.owner == owner && ticket == refreshSerial {
                self.error = error.localizedDescription; loading = false
                if let apiError = error as? NoctAPIError, [401, 403, 404].contains(apiError.status) {
                    messages = []; canSend = false; detail = nil; nextCursor = ""
                }
            }
        }
    }

    private func messageAccess(owner: String) async -> Result<Bool, Error> {
        do {
            let permission = try await api.get("/api/social", query: ["action": "messageAccess", "peer": target.id, "actor": owner])
            guard permission.raw["allowed"] is NSNumber else {
                throw NoctAPIError(code: "INVALID_CHAT_ACCESS", message: "Сервер не подтвердил права отправки сообщений.")
            }
            return .success(permission.bool("allowed"))
        } catch { return .failure(error) }
    }

    private func validateRoom(_ result: NGRecord, owner: String) throws {
        guard result.string("me") == owner else {
            throw NoctAPIError(status: 401, code: "CHAT_ACCOUNT_CHANGED", message: "Аккаунт изменился. Откройте чат снова.")
        }
        guard result.string("id") == target.id, result.string("kind") == "group",
              result.raw["canSend"] is NSNumber else {
            throw NoctAPIError(code: "INVALID_CHAT_RESPONSE", message: "Не удалось прочитать ответ сервера. Потяните экран вниз, чтобы повторить загрузку.")
        }
    }

    private func replaceLatest(_ page: [NGRecord]) {
        // Messages removed from the freshly fetched window must not survive in a local merge.
        guard let first = page.first else { messages = []; return }
        messages = messages.filter {
            $0.double("created") < first.double("created") || ($0.double("created") == first.double("created") && $0.id < first.id)
        }
        merge(page)
    }

    private func merge(_ page: [NGRecord]) {
        let replacements = Dictionary(page.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        let older = messages.filter { replacements[$0.id] == nil }
        messages = (older + page).sorted {
            $0.double("created") == $1.double("created") ? $0.id < $1.id : $0.double("created") < $1.double("created")
        }
    }

    func loadEarlier(owner: String) async {
        guard active, isRoom, !secret, !nextCursor.isEmpty, !loadingEarlier else { return }
        loadingEarlier = true
        defer { if self.owner == owner { loadingEarlier = false } }
        do {
            let result = try await api.get("/api/rooms", query: ["action": "room", "id": target.id, "before": nextCursor, "actor": owner])
            try Task.checkCancellation()
            guard active, self.owner == owner else { return }
            guard result.string("kind") != "secret" else { detail = result; messages = []; canSend = false; return }
            try validateRoom(result, owner: owner)
            merge(try ngChatRecords(result, key: "messages")); nextCursor = result.string("nextCursor"); loadedEarlier = true
        } catch { if active && self.owner == owner { self.error = error.localizedDescription } }
    }

    func join(owner: String) async {
        guard !secret, needsJoin, !sending, !owner.isEmpty, self.owner == owner else { return }
        sending = true
        defer { if self.owner == owner { sending = false } }
        do {
            _ = try await api.post("/api/rooms", body: ["action": "join", "id": target.id, "actor": owner])
            guard self.owner == owner else { return }
            needsJoin = false
            await refresh(owner: owner)
        } catch { if self.owner == owner { self.error = error.localizedDescription } }
    }

    func attach(_ data: Data, fileName: String, mimeType: String, owner: String) async {
        guard !isRoom, !secret, canSend, !uploading, !sending, pending == nil, self.owner == owner else { return }
        guard !data.isEmpty, data.count <= 25 * 1024 * 1024, uploads.count < 10 else {
            error = "Можно прикрепить до 10 файлов, каждый не больше 25 МБ."; return
        }
        uploading = true
        defer { if self.owner == owner { uploading = false } }
        do {
            let result = try await api.upload(data: data, fileName: fileName, mimeType: mimeType, chat: true, peer: target.id)
            guard self.owner == owner else { return }
            guard !result.string("id").isEmpty else {
                throw NoctAPIError(code: "INVALID_UPLOAD", message: "Сервер не подтвердил загрузку файла.")
            }
            uploads.append(result)
        } catch { if self.owner == owner { self.error = error.localizedDescription } }
    }

    func removeUpload(_ upload: NGRecord, owner: String) async {
        guard !sending, pending == nil, self.owner == owner else { return }
        do {
            _ = try await api.delete("/api/chat-upload", body: ["id": upload.id])
            if self.owner == owner { uploads.removeAll { $0.id == upload.id } }
        } catch { if self.owner == owner { self.error = error.localizedDescription } }
    }

    func send(owner: String) async {
        guard !secret, !sending, !uploading, canSend, self.owner == owner else { return }
        let snapshot: NGChatPendingSend
        if let existing = pending { snapshot = existing }
        else {
            guard sendEnabled else { return }
            snapshot = NGChatPendingSend(key: UUID().uuidString.lowercased(), text: draft.trimmingCharacters(in: .whitespacesAndNewlines), attachments: uploads.map(\.id), replyID: reply?.id)
            pending = snapshot
        }
        sending = true; retryPending = false; error = nil
        defer { if self.owner == owner { sending = false } }
        var body: [String: Any] = ["action": isRoom ? "send" : "message", "id": target.id, "text": snapshot.text, "key": snapshot.key, "actor": owner]
        if let replyID = snapshot.replyID { body["replyTo"] = replyID }
        // Published main accepts group text only; do not send even an empty attachments array there.
        if !isRoom { body["attachments"] = snapshot.attachments; body["expectedSender"] = owner }
        do {
            let result = try await api.post(isRoom ? "/api/rooms" : "/api/social", body: body)
            guard self.owner == owner else { return }
            finishDraft()
            if result.bool("queued") { notice = "Сообщение отправлено на проверку. Оно появится после одобрения." }
            if active { await refresh(owner: owner) }
        } catch {
            guard self.owner == owner else { return }
            // A foreground poll can confirm delivery while the original POST response is lost.
            guard pending?.key == snapshot.key else { return }
            if let apiError = error as? NoctAPIError, (400..<500).contains(apiError.status), apiError.status != 408 {
                pending = nil; retryPending = false
                self.error = apiError.localizedDescription
                return
            }
            retryPending = true
            self.error = error.localizedDescription
        }
    }

    func clearUnconfirmedDraft(owner: String) async {
        guard self.owner == owner else { return }
        // Removing the local draft does not recall a message already accepted by the server.
        let files = uploads
        finishDraft()
        for file in files where self.owner == owner {
            // The server refuses to discard any upload already bound to an accepted message.
            _ = try? await api.delete("/api/chat-upload", body: ["id": file.id])
        }
    }

    private func finishDraft() {
        pending = nil; retryPending = false; draft = ""; reply = nil; uploads = []; error = nil
    }

    func react(_ message: NGRecord, emoji: String, owner: String) async {
        guard active, canSend, !secret, message.int("deletedAt") == 0, self.owner == owner, !reacting.contains(message.id) else { return }
        reacting.insert(message.id)
        defer { if self.owner == owner { reacting.remove(message.id) } }
        let removing = message.objects("reactions").contains { $0.string("emoji") == emoji && $0.bool("own") }
        var reactionValue: Any = emoji
        if removing { reactionValue = NSNull() }
        do {
            if isRoom {
                _ = try await api.post("/api/rooms", body: ["action": "reaction", "id": target.id, "messageId": message.id, "emoji": reactionValue, "actor": owner])
            } else {
                _ = try await api.post("/api/social", body: ["action": "messageReaction", "id": message.id, "peer": target.id, "emoji": reactionValue, "actor": owner, "expectedSender": owner])
            }
            if self.owner == owner { applyReaction(messageID: message.id, emoji: removing ? nil : emoji) }
            if active { await refresh(owner: owner) }
        } catch { if active && self.owner == owner { self.error = error.localizedDescription } }
    }

    private func applyReaction(messageID: String, emoji: String?) {
        guard let index = messages.firstIndex(where: { $0.id == messageID }) else { return }
        var raw = messages[index].raw
        var counts = messages[index].objects("reactions").map { record -> [String: Any] in
            ["emoji": record.string("emoji"), "count": max(0, record.int("count") - (record.bool("own") ? 1 : 0)), "own": false]
        }
        if let emoji = emoji {
            if let slot = counts.firstIndex(where: { ($0["emoji"] as? String) == emoji }) {
                counts[slot]["count"] = (counts[slot]["count"] as? Int ?? 0) + 1
                counts[slot]["own"] = true
            } else { counts.append(["emoji": emoji, "count": 1, "own": true]) }
        }
        raw["reactions"] = counts.filter { ($0["count"] as? Int ?? 0) > 0 }
        messages[index] = NGRecord(raw: raw)
    }
}

@MainActor
struct NGConversationView: View {
    let person: NGRecord
    var api: NoctAPI? = nil
    var body: some View { NGNativeConversation(target: person, isRoom: false, api: api) }
}

@MainActor
struct NGRoomConversationView: View {
    let room: NGRecord
    var api: NoctAPI? = nil
    var body: some View { NGNativeConversation(target: room, isRoom: true, api: api) }
}

private enum NGChatSheet: String, Identifiable {
    case photo, file, members
    var id: String { rawValue }
}

@MainActor
private struct NGNativeConversation: View {
    @EnvironmentObject private var session: NativeSession
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @StateObject private var model: NGConversationModel
    @State private var visible = false
    @State private var atBottom = true
    @State private var initiallyScrolled = false
    @State private var sheet: NGChatSheet?
    @State private var sheetOwner = ""
    @State private var abandonConfirmation = false
    @State private var groupHelp = false
    @FocusState private var composerFocused: Bool
    @ScaledMetric(relativeTo: .body) private var editorHeight: CGFloat = 58

    init(target: NGRecord, isRoom: Bool, api: NoctAPI? = nil) {
        _model = StateObject(wrappedValue: NGConversationModel(target: target, isRoom: isRoom, api: api))
    }

    private var owner: String { session.user?.id ?? "" }
    private var taskID: String { "\(owner):\(visible):\(scenePhase == .active)" }

    var body: some View {
        VStack(spacing: 0) {
            if model.secret {
                NGEmptyState(title: "Секретный чат", message: "Эта версия iOS пока не поддерживает ключи сквозного шифрования. Откройте чат на устройстве, где настроен секретный чат.", systemImage: "lock.shield")
            } else if model.needsJoin {
                joinView
            } else {
                history
            }
        }
        .background(NGTheme.background)
        .navigationTitle(model.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { conversationToolbar }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !model.secret && !model.needsJoin { composer }
        }
        .sheet(item: $sheet) { selected in
            let attachmentOwner = sheetOwner
            switch selected {
            case .photo:
                NGPhotoPicker { data, name, type in
                    sheet = nil
                    Task { await model.attach(data, fileName: name, mimeType: type, owner: attachmentOwner) }
                }
            case .file:
                NGDocumentPicker { data, name, type in
                    sheet = nil
                    Task { await model.attach(data, fileName: name, mimeType: type, owner: attachmentOwner) }
                }
            case .members:
                NGChatMembersView(members: model.detail?.objects("members") ?? [])
            }
        }
        .alert("Медиа в группе", isPresented: $groupHelp) {
            Button("Понятно", role: .cancel) {}
        } message: { Text("Сервер пока принимает в группах только текст. Фото и файлы доступны в личных диалогах.") }
        .confirmationDialog("Убрать неподтверждённое сообщение из редактора? Если сервер уже принял его, оно останется в переписке.", isPresented: $abandonConfirmation, titleVisibility: .visible) {
            Button("Убрать из редактора", role: .destructive) { Task { await model.clearUnconfirmedDraft(owner: owner) } }
            Button("Отмена", role: .cancel) {}
        }
        .onAppear { visible = true; model.active = scenePhase == .active }
        .onDisappear { visible = false; model.active = false }
        .onChange(of: scenePhase) { phase in model.active = visible && phase == .active }
        .onChange(of: owner) { value in model.reset(owner: value); initiallyScrolled = false }
        .task(id: taskID) {
            model.active = visible && scenePhase == .active
            guard model.active, !model.secret else { return }
            model.reset(owner: owner)
            while !Task.isCancelled {
                await model.refresh(owner: owner)
                do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { break }
            }
        }
    }

    @ToolbarContentBuilder private var conversationToolbar: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            if model.isRoom {
                Menu {
                    if !model.secret {
                        Button { sheet = .members } label: { Label("Участники", systemImage: "person.2") }
                        Button { groupHelp = true } label: { Label("Фото и файлы", systemImage: "info.circle") }
                    }
                } label: { Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44) }
                .accessibilityLabel("О группе")
                .disabled(model.secret)
            } else {
                NavigationLink(destination: NGProfileView(userID: model.target.id)) {
                    NGAvatar(url: model.target.string("avatar"), name: model.target.string("name"), size: 32)
                        .frame(minWidth: 44, minHeight: 44)
                }.accessibilityLabel("Профиль собеседника")
            }
        }
    }

    private var joinView: some View {
        VStack(spacing: 20) {
            NGAvatar(url: model.target.string("avatar"), name: model.title, size: 80)
            Text(model.title).font(.title2.bold())
            Text(model.target.string("description")).foregroundColor(NGTheme.muted).multilineTextAlignment(.center)
            Text("\(model.target.int("memberCount")) участников").font(.subheadline).foregroundColor(NGTheme.muted)
            if let error = model.error { Text(error).font(.footnote).foregroundColor(.orange) }
            Button { Task { await model.join(owner: owner) } } label: {
                HStack { if model.sending { ProgressView() }; Text("Вступить в группу").font(.headline) }
                    .frame(maxWidth: .infinity, minHeight: 48)
            }.buttonStyle(NGPrimaryButtonStyle()).disabled(model.sending)
            Spacer()
        }.padding(24)
    }

    private var history: some View {
        ScrollViewReader { proxy in
            List {
                if model.loading && model.messages.isEmpty { ProgressView("Загрузка сообщений").padding().listRowBackground(Color.clear) }
                if !model.nextCursor.isEmpty {
                    Button { Task { await model.loadEarlier(owner: owner) } } label: {
                        HStack { Spacer(); if model.loadingEarlier { ProgressView() }; Text("Ранние сообщения"); Spacer() }.frame(minHeight: 44)
                    }.disabled(model.loadingEarlier).listRowBackground(Color.clear)
                }
                if !model.loading && model.messages.isEmpty {
                    if let error = model.error {
                        VStack(spacing: 12) {
                            NGEmptyState(title: "Не удалось загрузить переписку", message: error, systemImage: "wifi.exclamationmark")
                            Button("Повторить загрузку") { Task { await model.refresh(owner: owner) } }
                                .frame(minHeight: 44)
                        }.listRowBackground(Color.clear)
                    } else {
                        NGEmptyState(title: "Начните разговор", message: "Отправьте первое сообщение.", systemImage: "bubble.left")
                            .listRowBackground(Color.clear)
                    }
                }
                ForEach(model.messages, id: \.id) { message in
                    NGChatMessageBubble(message: message, own: message.string("sender") == owner, isRoom: model.isRoom, quote: quotedMessage(message)) { emoji in
                        Task { await model.react(message, emoji: emoji, owner: owner) }
                    }
                    .accessibilityIdentifier("chat.message." + message.id)
                    .id(message.id)
                    .listRowInsets(EdgeInsets(top: 5, leading: 12, bottom: 5, trailing: 12))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        if model.canSend && message.int("deletedAt") == 0 {
                            Button { selectReply(message) } label: { Label("Ответить", systemImage: "arrowshape.turn.up.left") }.tint(NGTheme.accent)
                        }
                    }
                    .contextMenu {
                        if message.int("deletedAt") == 0 {
                            if model.canSend {
                                Button { selectReply(message) } label: { Label("Ответить", systemImage: "arrowshape.turn.up.left") }
                                Menu("Реакция") {
                                    ForEach(ngChatReactionEmoji, id: \.self) { emoji in
                                        Button(emoji) { Task { await model.react(message, emoji: emoji, owner: owner) } }
                                    }
                                }
                            }
                            if !message.string("text").isEmpty {
                                Button { UIPasteboard.general.string = message.string("text") } label: { Label("Копировать", systemImage: "doc.on.doc") }
                            }
                        }
                    }
                }
                Color.clear.frame(height: 1).id("conversation-bottom")
                    .listRowInsets(EdgeInsets()).listRowSeparator(.hidden).listRowBackground(Color.clear)
                    .onAppear { atBottom = true }.onDisappear { atBottom = false }
            }
            .listStyle(.plain)
            .refreshable { await model.refresh(owner: owner) }
            .onChange(of: model.lastMessageID) { _ in
                if atBottom || !initiallyScrolled || model.sending {
                    if reducedMotion || !initiallyScrolled { proxy.scrollTo("conversation-bottom", anchor: .bottom) }
                    else { withAnimation { proxy.scrollTo("conversation-bottom", anchor: .bottom) } }
                    initiallyScrolled = true
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if !atBottom && !model.messages.isEmpty {
                    Button { withAnimation(reducedMotion ? nil : .easeOut) { proxy.scrollTo("conversation-bottom", anchor: .bottom) } } label: {
                        Image(systemName: "arrow.down").font(.headline).frame(width: 44, height: 44)
                            .ngGlass(radius: 22)
                    }.padding(12).accessibilityLabel("К последним сообщениям")
                }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let notice = model.notice {
                HStack {
                    Text(notice).font(.footnote)
                    Button { model.notice = nil } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }.accessibilityLabel("Закрыть уведомление")
                }
            }
            if let error = model.error {
                Text(error).font(.footnote).foregroundColor(.orange).frame(maxWidth: .infinity, alignment: .leading)
            }
            if model.retryPending {
                HStack {
                    Button("Повторить отправку") { Task { await model.send(owner: owner) } }.frame(minHeight: 44)
                    Spacer()
                    Button { abandonConfirmation = true } label: { Image(systemName: "xmark.circle").frame(width: 44, height: 44) }.accessibilityLabel("Убрать неподтверждённое сообщение")
                }
            }
            if let reply = model.reply {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Ответ на сообщение").font(.caption.bold()).foregroundColor(NGTheme.accent)
                        Text(ngChatMessageSummary(reply)).font(.caption).lineLimit(2)
                    }
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(NGTheme.accent).frame(width: 3) }
                    Spacer()
                    Button { model.reply = nil } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                        .disabled(model.sending || model.retryPending).accessibilityLabel("Отменить ответ")
                }.frame(minHeight: 44)
            }
            if !model.uploads.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(model.uploads, id: \.id) { file in
                            HStack {
                                Image(systemName: file.string("kind") == "image" ? "photo" : "doc")
                                Text(file.string("name", default: "Файл")).font(.caption).lineLimit(1)
                                Button { Task { await model.removeUpload(file, owner: owner) } } label: { Image(systemName: "xmark.circle.fill").frame(width: 44, height: 44) }
                                    .accessibilityLabel("Убрать \(file.string("name"))").disabled(model.sending || model.retryPending)
                            }.padding(.leading, 10).background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }
            }
            if !model.canSend && !model.loading {
                Text("Отправка сообщений недоступна. Проверьте права доступа к чату.")
                    .font(.footnote).foregroundColor(NGTheme.muted).frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .bottom, spacing: 8) {
                if !model.isRoom {
                    Menu {
                        Button { composerFocused = false; sheetOwner = owner; sheet = .photo } label: { Label("Фото", systemImage: "photo") }
                        Button { composerFocused = false; sheetOwner = owner; sheet = .file } label: { Label("Файл", systemImage: "doc") }
                    } label: {
                        Group { if model.uploading { ProgressView() } else { Image(systemName: "plus") } }.frame(width: 44, height: 44)
                    }.disabled(model.composerLocked).accessibilityLabel("Прикрепить файл")
                }
                ZStack(alignment: .topLeading) {
                    if model.draft.isEmpty { Text("Сообщение").foregroundColor(NGTheme.muted).padding(.top, 8).padding(.leading, 5).allowsHitTesting(false) }
                    TextEditor(text: $model.draft).frame(height: min(editorHeight, 140)).focused($composerFocused)
                        .opacity(model.draft.isEmpty ? 0.75 : 1).disabled(model.composerLocked)
                        .accessibilityLabel("Текст сообщения")
                        .accessibilityIdentifier("chat.composer")
                }
                Button {
                    composerFocused = false
                    Task { await model.send(owner: owner) }
                } label: {
                    Group { if model.sending { ProgressView() } else { Image(systemName: "arrow.up").font(.headline) } }
                        .frame(width: 44, height: 44).background(NGTheme.accent.opacity(model.sendEnabled ? 1 : 0.25), in: Circle()).foregroundColor(.black)
                }.disabled(!model.sendEnabled).accessibilityLabel("Отправить сообщение").accessibilityIdentifier("chat.send")
            }
            if model.draft.utf16.count > 3800 {
                Text("\(model.draft.utf16.count) / 4000").font(.caption).foregroundColor(model.draft.utf16.count > 4000 ? .orange : NGTheme.muted).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .ngGlass(radius: 24)
    }

    private func selectReply(_ message: NGRecord) {
        guard !model.composerLocked else { return }
        model.reply = message; composerFocused = true
    }

    private func quotedMessage(_ message: NGRecord) -> String? {
        if let reply = message.object("reply") { return reply.string("text", default: "Сообщение недоступно") }
        let id = message.string("replyTo")
        guard !id.isEmpty else { return nil }
        return model.messages.first(where: { $0.id == id }).map(ngChatMessageSummary) ?? "Ответ на более раннее сообщение"
    }
}

private func ngChatMessageSummary(_ message: NGRecord) -> String {
    if message.int("deletedAt") > 0 { return "Сообщение удалено" }
    if !message.string("text").isEmpty { return message.string("text") }
    if message.object("gift") != nil { return "Подарок" }
    return message.objects("attachments").first?.string("name", default: "Вложение") ?? "Сообщение"
}

private struct NGChatMessageBubble: View {
    let message: NGRecord
    let own: Bool
    let isRoom: Bool
    let quote: String?
    let onReaction: (String) -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            if own { Spacer(minLength: 36) }
            VStack(alignment: .leading, spacing: 7) {
                if isRoom && !own {
                    Text(message.string("senderName", default: "Участник")).font(.caption.bold()).foregroundColor(NGTheme.accent)
                }
                if message.int("deletedAt") > 0 {
                    Text("Сообщение удалено").font(.subheadline).italic().foregroundColor(NGTheme.muted)
                } else {
                    if let quote = quote {
                        HStack(spacing: 7) { Rectangle().fill(NGTheme.accent).frame(width: 3); Text(quote).font(.caption).lineLimit(3) }
                            .fixedSize(horizontal: false, vertical: true).padding(8).background(NGTheme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
                    }
                    if !message.string("forwardedName").isEmpty {
                        Text("Переслано: " + message.string("forwardedName")).font(.caption).foregroundColor(NGTheme.muted)
                    }
                    ForEach(message.objects("attachments"), id: \.id) { file in
                        NGMediaView(record: file, isPrivate: true)
                    }
                    if message.object("gift") != nil { Label("Подарок", systemImage: "gift.fill").font(.headline).foregroundColor(NGTheme.accent) }
                    if !message.string("text").isEmpty { Text(message.string("text")).font(.body).textSelection(.enabled) }
                }
                HStack(spacing: 5) {
                    Spacer(minLength: 0)
                    if message.int("editedAt") > 0 { Text("изменено").font(.caption2) }
                    Text(ngChatDate(message.double("created")), style: .time).font(.caption2)
                    if own && !isRoom {
                        Image(systemName: message.bool("read") ? "checkmark.circle.fill" : "checkmark")
                            .font(.caption2).accessibilityLabel(message.bool("read") ? "Прочитано" : "Отправлено")
                    }
                }.foregroundColor(NGTheme.muted)
                if !message.objects("reactions").isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(message.objects("reactions"), id: \.rawEmojiIdentity) { reaction in
                                Button { onReaction(reaction.string("emoji")) } label: {
                                    Text("\(reaction.string("emoji")) \(reaction.int("count"))").font(.caption)
                                        .padding(.horizontal, 8).frame(minHeight: 44)
                                        .background(NGTheme.accent.opacity(reaction.bool("own") ? 0.22 : 0.08), in: Capsule())
                                }.buttonStyle(.plain).accessibilityLabel("\(reaction.string("emoji")), \(reaction.int("count")) реакций")
                            }
                        }
                    }
                }
            }
            .padding(11)
            .background(own ? NGTheme.accent.opacity(0.15) : NGTheme.surface, in: RoundedRectangle(cornerRadius: 18))
            if !own { Spacer(minLength: 36) }
        }
    }
}

private extension NGRecord {
    var rawEmojiIdentity: String { string("emoji") }
}

@MainActor
private struct NGChatMembersView: View {
    let members: [NGRecord]
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationView {
            List(members, id: \.rawMemberIdentity) { member in
                NavigationLink(destination: NGProfileView(userID: member.string("userId"))) {
                    NGChatPersonRow(person: member, subtitle: member.string("role") == "owner" ? "Владелец" : member.string("role") == "admin" ? "Администратор" : "Участник")
                }.listRowBackground(NGTheme.surface)
            }
            .listStyle(.plain).background(NGTheme.background).navigationTitle("Участники")
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Готово") { dismiss() }.frame(minHeight: 44) } }
        }
    }
}

private extension NGRecord {
    var rawMemberIdentity: String { string("userId") }
}

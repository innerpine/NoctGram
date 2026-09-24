import SwiftUI

/// Likes, comments, followers, Stars, gifts and messages (app/notifications.tsx).
struct NotificationsView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @State private var items: [NoctNotification] = []
    @State private var filter = "all"
    @State private var loading = false
    @State private var loaded = false
    @State private var hasMore = true
    @State private var error: String?

    private let filters: [(id: String, label: String, kinds: String)] = [
        ("all", "Все", ""),
        ("reactions", "Реакции", "like,support"),
        ("comments", "Комментарии", "comment"),
        ("follows", "Подписчики", "follow"),
        ("messages", "Сообщения", "message,call,gift"),
    ]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(filters, id: \.id) { option in
                                Button {
                                    guard filter != option.id else { return }
                                    filter = option.id
                                    Task { await load(reset: true) }
                                } label: {
                                    Text(option.label)
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundColor(filter == option.id ? .black : Noct.text75)
                                        .padding(.horizontal, 14)
                                        .frame(height: 34)
                                        .background(Capsule().fill(filter == option.id ? Color.white : Noct.fill))
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                        .padding(.horizontal, 12)
                    }
                    .padding(.vertical, 10)
                    .id("top")

                    ForEach(items) { item in
                        Button {
                            open(item)
                        } label: {
                            NotificationRow(item: item, me: session.myId ?? "")
                        }
                        .buttonStyle(PressableStyle())
                        .onAppear {
                            if item.id == items.last?.id { Task { await load(reset: false) } }
                        }
                    }
                    if loading {
                        LoadingRow()
                    } else if loaded && items.isEmpty {
                        if let error {
                            ErrorBanner(text: error) { Task { await load(reset: true) } }
                        } else {
                            EmptyState(icon: "bell", text: "Здесь появятся лайки, комментарии, подписчики и подарки.")
                        }
                    }
                }
            }
            .background(Noct.background)
            .refreshable { await load(reset: true) }
            .onChange(of: nav.rootTap) { tap in
                guard tap.tab == .notifications else { return }
                withAnimation(Noct.motion) { proxy.scrollTo("top", anchor: .top) }
            }
        }
        .navigationTitle("Уведомления")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(reset: true) }
    }

    private var kinds: String {
        filters.first { $0.id == filter }?.kinds ?? ""
    }

    private func load(reset: Bool) async {
        guard !loading, reset || hasMore else { return }
        loading = true
        defer { loading = false }
        var query: [String: String?] = [:]
        if !kinds.isEmpty { query["kinds"] = kinds }
        if !reset, let last = items.last {
            query["before"] = String(Int64(last.created))
            query["beforeId"] = last.id
        }
        do {
            let data = try await session.api.social("notifications", query)
            let page = data.array.map { NoctNotification($0) }
            if reset {
                items = page
            } else {
                let known = Set(items.map(\.id))
                items += page.filter { !known.contains($0.id) }
            }
            hasMore = page.count >= 30
            error = nil
            if reset { await markRead() }
        } catch {
            if let message = error.userMessage { self.error = message }
            hasMore = false
        }
        loaded = true
    }

    /// Everything up to the newest shown notification counts as seen.
    private func markRead() async {
        guard let newest = items.first?.created, items.contains(where: { !$0.read }) else {
            session.unreadNotifications = 0
            return
        }
        _ = try? await session.api.socialPost("readNotifications", ["before": Int64(newest)])
        session.unreadNotifications = 0
    }

    private func open(_ item: NoctNotification) {
        switch item.kind {
        case "follow":
            nav.push(.profile(item.actorId))
        case "gift":
            nav.push(.profile(item.giftRecipient.isEmpty ? (session.myId ?? item.actorId) : item.giftRecipient))
        case "market":
            nav.push(.web(title: "Маркет", path: "/market?view=assets"))
        case "like", "comment", "support", "post":
            if !item.postId.isEmpty { nav.push(.post(item.postId)) }
        default:
            nav.push(.chat(Person(identity: item.actor)))
        }
    }
}

struct NotificationRow: View {
    @EnvironmentObject private var session: AppSession
    let item: NoctNotification
    let me: String

    private var described: (icon: String, tint: Color, text: String, quote: String, amount: String) {
        let stars = Format.count(item.amount)
        switch item.kind {
        case "like":
            let others = item.others > 0 ? " и ещё \(item.others)" : ""
            return ("heart.fill", Color(hex: 0xFF6B8A), "Нравится твоя публикация" + others, item.postText, "")
        case "comment":
            return ("text.bubble.fill", Color(hex: 0x8AB4FF), "Комментарий к твоей публикации", item.commentText, "")
        case "follow":
            return ("person.fill.badge.plus", Noct.green, "Новый подписчик", "", "")
        case "support":
            return ("star.fill", Noct.gold, "Поддержка публикации", item.postText, "\(stars) Stars")
        case "market":
            return ("storefront.fill", Noct.gold, "Покупка в Маркете: " + (item.lotTitle.isEmpty ? "лот" : item.lotTitle), "", "+\(stars) Stars")
        case "gift":
            return ("gift.fill", Color(hex: 0xE5A2B4), !item.giftRecipient.isEmpty && item.giftRecipient != me ? "Подарок твоему каналу" : "Новый подарок", "", "")
        case "call":
            return ("phone.fill", Noct.green, "Аудиозвонок", "", "")
        case "post":
            return ("newspaper.fill", Noct.lilac, "Новая публикация", item.postText, "")
        default:
            return ("message.fill", Color(hex: 0x8AB4FF), "Новое сообщение", "", "")
        }
    }

    var body: some View {
        let info = described
        HStack(alignment: .top, spacing: 12) {
            AvatarView(person: item.actor, size: 44)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: info.icon)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.black)
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(info.tint))
                        .overlay(Circle().stroke(Noct.background, lineWidth: 2))
                        .offset(x: 4, y: 4)
                }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    DisplayName(person: item.actor, size: 14)
                    Text(Format.ago(item.created))
                        .font(.system(size: 12))
                        .foregroundColor(Noct.text48)
                }
                Text(info.text)
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text75)
                if !info.quote.isEmpty {
                    Text(PremiumEmoji.replace(info.quote))
                        .font(.system(size: 13))
                        .foregroundColor(Noct.text48)
                        .lineLimit(2)
                }
                if !info.amount.isEmpty {
                    Text(info.amount)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Noct.gold)
                }
            }
            Spacer(minLength: 0)
            if !item.postImage.isEmpty {
                RemoteImage(url: session.api.mediaURL("/api/media/" + item.postImage), maxPixel: 160)
                    .frame(width: 46, height: 46)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            if !item.read {
                Circle().fill(Color.white).frame(width: 8, height: 8).padding(.top, 6)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(item.read ? Color.clear : Color.white.opacity(0.025))
        .contentShape(Rectangle())
    }
}

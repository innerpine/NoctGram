import SwiftUI
import UIKit

/// The author above a group message: the name in the colour of their
/// Premium palette with the badges after it.
struct BubbleAuthor {
    let name: String
    let appearance: Appearance
}

/// A message as in Telegram, in the web's colours: the bubble hugs its
/// text, the time sits at the end of the last line and photos run edge to
/// edge with the time on glass. Stickers, round videos and messages of a
/// few emoji stand without a bubble. Dialogues and groups share it.
struct MessageBubble: View {
    @EnvironmentObject private var session: AppSession
    let message: ChatMessage
    let mine: Bool
    /// The other person of the dialogue (reactions, quotes).
    let peer: Identity
    let palette: ChatPalette
    /// The previous message is from the same sender a moment earlier.
    let joinsPrevious: Bool
    let openMedia: ([MediaItem], Int) -> Void
    /// Only the bubble, drawn in the held-message overlay or by a group row.
    var standalone = false
    /// Groups: the author's name over the first message of a run.
    var author: BubbleAuthor?
    /// Groups have no read receipts: a sent message shows one state.
    var readReceipts = true
    /// «Избранное» shows no ticks at all, only sending and failures.
    var ticks = true
    /// A voice or round message nobody has listened to yet.
    var unheard = false
    /// The first play of a recording (listened marks).
    var onListen: (() -> Void)?
    /// Holding lifts the bubble with reactions and actions (MessageFocus).
    var onFocus: ((CGRect) -> Void)?
    /// Swiping left answers the message.
    var onReply: (() -> Void)?
    /// A tap on a reaction puts it (an emoji) or takes the viewer's back (nil).
    var onReact: ((String?) -> Void)?
    /// A reactor list per reaction; nil shows counts.
    var reactors: ((Reaction) -> [Identity]?)?
    /// Opens a profile (a forwarded message's author) or a shared post.
    var onOpenProfile: ((String) -> Void)?
    var onOpenPost: ((String) -> Void)?
    var onOpenPack: ((Sticker) -> Void)?
    @State private var ratio: CGFloat?

    private let maxMedia: CGFloat = 270

    private var shape: BubbleShape { .message(mine: mine, joinsPrevious: joinsPrevious) }
    private var media: [MediaItem] {
        message.attachments.filter(\.isMedia).map {
            MediaItem(JSON.object(["id": .string($0.id), "type": .string($0.type), "name": .string($0.name), "size": .number(Double($0.size))]))
        }
    }
    private var files: [ChatAttachment] { message.attachments.filter(\.isFile) }
    private var reactions: [Reaction] { ChatProbe.has("nochips") ? [] : message.reactions }
    private var hasText: Bool { !message.text.isEmpty && message.gift == nil && !message.deleted }
    private var status: MessageStatus? {
        guard mine else { return nil }
        if message.failed { return .failed }
        if message.pending { return .pending }
        guard ticks else { return nil }
        return message.read && readReceipts ? .read : .sent
    }
    /// Nothing around the text or media: no quote, forward, files, gift or reactions.
    private var bare: Bool {
        message.reply == nil && message.forwardedName.isEmpty && files.isEmpty && message.gift == nil
            && reactions.isEmpty && message.postShare.isEmpty && message.voice == nil
    }
    private var emojiOnly: Bool { hasText && media.isEmpty && bare && EmojiTokens.largeCount(message.text) > 0 }
    /// A group keeps the author's name over photos in a bubble.
    private var mediaOnly: Bool { !media.isEmpty && !hasText && bare && author == nil }
    private var standsAlone: Bool { !message.deleted && (!message.sticker.isEmpty || message.round != nil) }
    private var mediaSize: CGSize { ChatMedia.size(count: media.count, ratio: ratio ?? cachedRatio, maxWidth: maxMedia) }

    /// A photo already in memory gives its shape at once, without a jump.
    private var cachedRatio: CGFloat? {
        guard media.count == 1, let item = media.first, !item.isVideo,
              let url = session.api.mediaURL(item.path),
              let image = ImagePipeline.shared.cached(url, maxPixel: 900), image.size.height > 0 else { return nil }
        return image.size.width / image.size.height
    }

    /// A dialogue has two people, so every reaction has a face: the other
    /// person's and the viewer's own.
    private func dialogueReactors(_ reaction: Reaction) -> [Identity]? {
        if let reactors { return reactors(reaction) }
        var people: [Identity] = []
        if reaction.count - (reaction.own ? 1 : 0) == 1 { people.append(peer) }
        if reaction.own, let me = session.me?.identity { people.append(me) }
        return people.count == reaction.count ? people : nil
    }

    /// What VoiceOver says: forward and reply, the text or what is attached,
    /// the reactions and the time.
    var spoken: String {
        var parts: [String] = []
        if let author, !mine { parts.append(author.name) }
        if !message.forwardedName.isEmpty { parts.append("Переслано от \(message.forwardedName)") }
        if let reply = message.reply {
            let quoted = reply.quote.isEmpty ? reply.text : reply.quote
            parts.append("Ответ на «\(reply.unavailable ? "удалённое сообщение" : (quoted.isEmpty ? "вложение" : PremiumEmoji.replace(quoted)))»")
        }
        if message.deleted {
            parts.append("Сообщение удалено")
        } else if let gift = message.gift {
            parts.append(GiftCatalog.shared.name(for: gift.giftId).map { "Подарок «\($0)»" } ?? "Подарок")
            if !gift.message.isEmpty { parts.append(gift.message) }
        } else if hasText {
            parts.append(PremiumEmoji.replace(message.text))
        }
        if !message.sticker.isEmpty { parts.append("Стикер") }
        if let voice = message.voice { parts.append("Голосовое сообщение, \(Waveform.clock(voice.duration))") }
        if let round = message.round { parts.append("Видеосообщение, \(Waveform.clock(round.duration))") }
        if !message.postShare.isEmpty { parts.append("Публикация") }
        let videos = media.filter(\.isVideo).count, photos = media.count - videos
        if photos > 0 { parts.append(photos == 1 ? "Фото" : "Фото: \(photos)") }
        if videos > 0 { parts.append(videos == 1 ? "Видео" : "Видео: \(videos)") }
        parts += files.map { "Файл \($0.name)" }
        parts += SpokenBubble.reactions(reactions)
        parts.append(Format.clock(message.created))
        return parts.joined(separator: ", ")
    }

    private func time(onMedia: Bool = false) -> BubbleTime {
        BubbleTime(created: message.created, edited: message.editedAt > 0, status: status, onMedia: onMedia, mine: mine, pinned: message.pinnedAt > 0)
    }

    var body: some View {
        let _ = ChatProbe.count("bubble body")
        if standalone {
            content
                .opacity(message.pending ? 0.7 : 1)
                .task(id: media.first?.path) { await measure() }
        } else {
            HStack(spacing: 0) {
                if mine { Spacer(minLength: 52) }
                content
                    .opacity(message.pending ? 0.7 : 1)
                    .modifier(SpokenBubble(label: spoken))
                    .accessibilityIdentifier("message-" + message.id)
                    .accessibilityAction(named: "Ответить") { onReply?() }
                    .modifier(HoldToFocus(action: message.pending || ChatProbe.has("nohold") ? nil : onFocus))
                if !mine { Spacer(minLength: 52) }
            }
            .modifier(SwipeToReply(action: message.pending || ChatProbe.has("noswipe") ? nil : onReply))
            #if DEBUG
            .onAppear { ChatProbe.count("appear " + ChatProbe.short(message.id)) }
            .onDisappear { ChatProbe.count("disappear " + ChatProbe.short(message.id)) }
            #endif
            .task(id: media.first?.path) { await measure() }
        }
    }

    @ViewBuilder private var content: some View {
        if standsAlone {
            alone
        } else if emojiOnly {
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                BigEmojiView(text: message.text)
                time(onMedia: true)
            }
        } else if mediaOnly {
            ChatMedia(items: media, size: mediaSize) { openMedia(media, $0) }
                .clipShape(shape)
                .overlay(alignment: .bottomTrailing) {
                    time(onMedia: true).padding(7)
                }
        } else {
            bubble
        }
    }

    /// A sticker or a round video: the author, forward and reply on dark
    /// pills above, reactions and the time below.
    private var alone: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            if author != nil || !message.forwardedName.isEmpty || message.reply != nil {
                VStack(alignment: .leading, spacing: 4) {
                    if let author, !mine {
                        SenderName(name: author.name, look: author.appearance)
                    }
                    forwardLine
                    if let reply = message.reply { quote(reply) }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(maxWidth: 250, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(palette.incoming))
            }
            if !message.sticker.isEmpty {
                StickerMessageView(ref: message.sticker, onOpenPack: onOpenPack)
            } else if let round = message.round {
                RoundMessageView(attachment: round, accent: palette.accent, unheard: unheard, onPlay: onListen)
            }
            HStack(alignment: .bottom, spacing: 8) {
                if !reactions.isEmpty {
                    BubbleReactions(reactions: reactions, accent: palette.accent, reactors: dialogueReactors, toggle: onReact)
                }
                time(onMedia: true)
            }
        }
    }

    #if DEBUG
    /// The «plainstack» probe stacks the parts without BubbleStack.
    private var column: AnyLayout {
        ChatProbe.has("plainstack") ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0)) : AnyLayout(BubbleStack())
    }
    #else
    private var column: BubbleStack { BubbleStack() }
    #endif

    @ViewBuilder private var forwardLine: some View {
        if !message.forwardedName.isEmpty {
            Button {
                if !message.forwardedSender.isEmpty { onOpenProfile?(message.forwardedSender) }
            } label: {
                (Text("Переслано от ") + Text(message.forwardedName).fontWeight(.semibold))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(palette.accent)
                    .lineLimit(1)
            }
            .buttonStyle(PressableStyle())
            .disabled(message.forwardedSender.isEmpty || onOpenProfile == nil)
        }
    }

    private func quote(_ reply: ReplyPreview) -> some View {
        let quoted = reply.quote.isEmpty ? reply.text : reply.quote
        return BubbleQuote(
            name: reply.sender == session.myId ? "Вы" : (reply.name.isEmpty ? peer.name : reply.name),
            text: reply.unavailable ? "Сообщение удалено" : PremiumEmoji.replace(quoted.isEmpty ? "Вложение" : quoted),
            accent: palette.accent
        )
    }

    private var bubble: some View {
        column {
            if (author != nil && !mine) || !message.forwardedName.isEmpty || message.reply != nil {
                VStack(alignment: .leading, spacing: 6) {
                    if let author, !mine {
                        SenderName(name: author.name, look: author.appearance)
                    }
                    forwardLine
                    if let reply = message.reply { quote(reply) }
                }
                .padding(.horizontal, author != nil && message.reply == nil && message.forwardedName.isEmpty ? 12 : 8)
                .padding(.top, 8)
                .padding(.bottom, media.isEmpty ? 0 : 8)
            }
            if !media.isEmpty {
                ChatMedia(items: media, size: mediaSize) { openMedia(media, $0) }
            }
            if let voice = message.voice, !message.deleted {
                VoiceMessageView(attachment: voice, accent: palette.accent, mine: mine, unheard: unheard, onPlay: onListen)
                    .padding(.horizontal, 10)
                    .padding(.top, 8)
            }
            if !message.postShare.isEmpty && !message.deleted {
                SharedPostCard(id: message.postShare, accent: palette.accent, open: onOpenPost)
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
            }
            if let gift = message.gift {
                giftCard(gift)
                    .padding(.horizontal, 10)
                    .padding(.top, 10)
            }
            ForEach(files) { file in
                fileRow(file)
                    .padding(.horizontal, 10)
                    .padding(.top, 8)
            }
            footer
        }
        .frame(width: media.isEmpty ? nil : mediaSize.width)
        .background(shape.fill(mine ? palette.outgoing : palette.incoming))
        .clipShape(shape)
        .overlay(shape.stroke(Color.white.opacity(0.06), lineWidth: 1))
    }

    @ViewBuilder private var footer: some View {
        if message.deleted {
            HStack(alignment: .bottom, spacing: 8) {
                Text("Сообщение удалено")
                    .font(.system(size: 15).italic())
                    .foregroundColor(Noct.text48)
                Spacer(minLength: 4)
                time()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        } else if hasText && reactions.isEmpty {
            InlineTimeText(text: message.text, time: time(), accent: palette.accent)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
        } else if hasText {
            VStack(alignment: .leading, spacing: 6) {
                InlineTimeText(text: message.text, accent: palette.accent)
                HStack(alignment: .bottom, spacing: 8) {
                    BubbleReactions(reactions: reactions, accent: palette.accent, reactors: dialogueReactors, toggle: onReact)
                    Spacer(minLength: 4)
                    time()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        } else if !reactions.isEmpty {
            HStack(alignment: .bottom, spacing: 8) {
                BubbleReactions(reactions: reactions, accent: palette.accent, reactors: dialogueReactors, toggle: onReact)
                Spacer(minLength: 4)
                time()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
        } else {
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                time()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
    }

    private func fileRow(_ file: ChatAttachment) -> some View {
        Group {
            if let url = session.api.mediaURL(file.path + "?download=1") {
                Link(destination: url) {
                    HStack(spacing: 10) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 18))
                            .foregroundColor(Color.black.opacity(0.8))
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(palette.accent))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(file.name).font(.system(size: 15, weight: .medium)).lineLimit(1)
                            Text(Format.fileSize(file.size)).font(.system(size: 12)).foregroundColor(Noct.text48)
                        }
                        Spacer(minLength: 0)
                    }
                    .foregroundColor(.white)
                }
            }
        }
    }

    private func giftCard(_ gift: ChatGift) -> some View {
        VStack(spacing: 6) {
            giftArt(gift)
                .frame(width: 150, height: 150)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            Text(GiftCatalog.shared.name(for: gift.giftId).map { "Подарок «\($0)»" } ?? "Подарок")
                .font(.system(size: 15, weight: .semibold))
            HStack(spacing: 4) {
                Image("StarsIcon").resizable().scaledToFit().frame(width: 14, height: 14)
                Text("\(gift.price)").font(.system(size: 13, weight: .semibold)).foregroundColor(Noct.gold)
            }
            if !gift.message.isEmpty {
                Text(PremiumEmoji.replace(gift.message))
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text75)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func giftArt(_ gift: ChatGift) -> some View {
        let path = gift.collectible.map { "/assets/gifts/\($0.modelAsset).webp" } ?? "/assets/gifts/\(gift.giftId).webp"
        if ChatProbe.has("nogift") {
            // Probe: the picture alone, no gift player.
            RemoteImage(url: session.api.mediaURL(path), maxPixel: 360, contentMode: .fit, placeholder: .clear)
        } else {
            GiftArt(path: path, collectible: gift.collectible, animated: !ChatProbe.has("stillgift"), featured: true)
        }
    }

    private func measure() async {
        guard ratio == nil, media.count == 1, let item = media.first, let url = session.api.mediaURL(item.path) else { return }
        let image = item.isVideo
            ? await VideoThumbnails.shared.thumbnail(for: url)
            : await ImagePipeline.shared.image(for: url, maxPixel: 900)
        guard let image, image.size.height > 0 else { return }
        ratio = image.size.width / image.size.height
        #if DEBUG
        ChatProbe.count("ratio " + ChatProbe.short(message.id))
        #endif
    }
}

/// The author above a bubble in a group, as in Telegram: the name in the
/// colour of their Premium palette with the badges after it.
struct SenderName: View {
    let name: String
    let look: Appearance

    var body: some View {
        HStack(spacing: 4) {
            styled
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            if look.verified {
                VerifiedBadge(appearance: look, size: 14)
            }
            if look.premium {
                PremiumBadge(appearance: look, size: 14)
            }
        }
    }

    @ViewBuilder private var styled: some View {
        if look.hasDesign && look.nameGradient {
            Text(name).foregroundStyle(
                LinearGradient(colors: [look.theme.first, look.theme.second], startPoint: .leading, endPoint: .trailing)
            )
        } else if look.hasDesign {
            Text(name).foregroundColor(look.theme.first)
        } else {
            Text(name).foregroundColor(Noct.lilac)
        }
    }
}

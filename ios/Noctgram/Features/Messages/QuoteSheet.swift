import SwiftUI
import UIKit

/// «Цитировать»: the message's text to select a fragment from, as the web
/// and Telegram quote part of a message in a reply (lib/reply-quote.ts). The
/// server checks that the quote is a piece of the stored text, so the raw
/// text is shown and the selection is sent as it is.
struct QuoteSheet: View {
    @Environment(\.dismiss) private var dismiss
    let name: String
    let text: String
    let quote: (String) -> Void
    @State private var selection = ""

    /// A fragment the server takes: trimmed, up to 1024 characters.
    private var fragment: String {
        let trimmed = selection.replacingOccurrences(of: "\u{00A0}", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.utf16.count <= 1024 else { return String(trimmed.prefix(1000)) }
        return trimmed
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("Выдели часть сообщения, на которую отвечаешь")
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text60)
                SelectableText(text: text, selection: $selection)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.06)))
                    .accessibilityIdentifier("quote-text")
                Spacer(minLength: 0)
            }
            .padding(16)
            .sheetSurface()
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Ответить") {
                        let value = fragment
                        dismiss()
                        quote(value)
                    }
                    .disabled(fragment.isEmpty || !text.contains(fragment))
                    .accessibilityIdentifier("quote-confirm")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Read-only text with the system selection handles.
private struct SelectableText: UIViewRepresentable {
    let text: String
    @Binding var selection: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = true
        view.backgroundColor = .clear
        view.font = .systemFont(ofSize: 17)
        view.textColor = .white
        view.tintColor = .white
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.text = text
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(selection: $selection)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        let selection: Binding<String>

        init(selection: Binding<String>) {
            self.selection = selection
        }

        func textViewDidChangeSelection(_ view: UITextView) {
            let range = view.selectedRange
            let value = range.length > 0 ? (view.text as NSString).substring(with: range) : ""
            if selection.wrappedValue != value { selection.wrappedValue = value }
        }
    }
}

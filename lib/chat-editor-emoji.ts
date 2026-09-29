import {
  $applyNodeReplacement,
  TextNode,
  type EditorConfig,
  type NodeKey,
  type SerializedTextNode,
} from 'lexical';
import { appleEmojiUrl, chatEmojiParts } from './chat-emoji';
import type { PremiumEmoji } from './premium-emoji';
import { posterFor } from './sticker-catalog';

// Catalog emoji draw their poster or picture; a short video stays a token.
function premiumArtwork(emoji: PremiumEmoji) {
  if (!emoji.asset) return '/assets/emoji/' + emoji.id + '.preview.webp';
  if (emoji.format === 'webm') return '';
  return emoji.format === 'webp' ? emoji.asset : posterFor(emoji.asset);
}

export class ChatEmojiNode extends TextNode {
  static getType() {
    return 'chat-emoji';
  }
  static clone(node: ChatEmojiNode) {
    return new ChatEmojiNode(node.__text, node.__key);
  }
  constructor(text: string, key?: NodeKey) {
    super(text, key);
  }
  static importJSON(serialized: SerializedTextNode) {
    return $createChatEmojiNode(serialized.text).updateFromJSON(serialized);
  }
  createDOM(config: EditorConfig) {
    const dom = super.createDOM(config);
    const part = chatEmojiParts(this.__text)[0];
    const url = part?.premium
      ? premiumArtwork(part.premium)
      : part?.unified
        ? appleEmojiUrl(part.unified)
        : '';
    if (!url) return dom;
    dom.classList.add('chat-editor-emoji');
    dom.style.backgroundImage = `url("${url}")`;
    if (part.premium) dom.setAttribute('aria-label', part.premium.fallback);
    return dom;
  }
  updateDOM(previous: this, dom: HTMLElement, config: EditorConfig) {
    if (previous.__text !== this.__text) return true;
    return super.updateDOM(previous, dom, config);
  }
  exportJSON(): SerializedTextNode {
    return { ...super.exportJSON(), type: 'chat-emoji', version: 1 };
  }
}
export function $createChatEmojiNode(text: string) {
  return $applyNodeReplacement(new ChatEmojiNode(text)).setMode('token');
}
export function $transformChatEmoji(node: TextNode) {
  if (!node.isSimpleText() || node.isComposing()) return;
  let offset = 0;
  for (const part of chatEmojiParts(node.getTextContent())) {
    if (part.unified || part.premium) {
      const pieces = node.splitText(offset, offset + part.text.length);
      const target = pieces[offset === 0 ? 0 : 1];
      target.replace($createChatEmojiNode(part.text));
      return;
    }
    offset += part.text.length;
  }
}

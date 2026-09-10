import {
  $applyNodeReplacement,
  TextNode,
  type EditorConfig,
  type NodeKey,
  type SerializedTextNode,
} from 'lexical';
import { appleEmojiUrl, chatEmojiParts } from './chat-emoji';

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
    const unified = chatEmojiParts(this.__text)[0]?.unified;
    dom.classList.add('chat-editor-emoji');
    if (unified) dom.style.backgroundImage = `url("${appleEmojiUrl(unified)}")`;
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
    if (part.unified) {
      const pieces = node.splitText(offset, offset + part.text.length);
      const target = pieces[offset === 0 ? 0 : 1];
      target.replace($createChatEmojiNode(part.text));
      return;
    }
    offset += part.text.length;
  }
}

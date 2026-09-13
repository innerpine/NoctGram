import { $getRoot, HISTORIC_TAG, type LexicalEditor } from 'lexical';
import { $restoreEditorState } from '@lexical/utils';
import { emojiParts } from './premium-emoji';

export function registerChatTextChanges(
  editor: LexicalEditor,
  callbacks: {
    change: (text: string) => void;
    limit: (reason: 'length' | 'premium') => void;
  },
) {
  return editor.registerUpdateListener(
    ({ editorState, prevEditorState, tags }) => {
      if (tags.has('external-draft') || tags.has('chat-limit-rollback')) return;
      const text = editorState.read(() => $getRoot().getTextContent());
      const previous = prevEditorState.read(() => $getRoot().getTextContent());
      // Native selection changes aren't edits. Restoring state on these updates
      // can recursively re-enter this listener for an old oversized draft.
      if (text === previous) return;
      const premium = (value: string) =>
        emojiParts(value).filter((part) => part.emoji).length;
      const tooLong = text.length > 4000 && text.length > previous.length;
      const count = premium(text);
      const tooMany = count > 30 && count > premium(previous);
      if (tooLong || tooMany) {
        editor.update(() => $restoreEditorState(editor, prevEditorState), {
          tag: [HISTORIC_TAG, 'chat-limit-rollback'],
          discrete: true,
        });
        callbacks.limit(tooMany ? 'premium' : 'length');
        return;
      }
      callbacks.change(text);
    },
  );
}

'use client';
/* The editor owns its editable DOM and native selection/history. */
/* contentEditable needs textbox semantics; native textarea cannot contain artwork. */
/* eslint-disable react/react-compiler, jsx-a11y/prefer-tag-over-role */
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { registerPlainText } from '@lexical/plain-text';
import { $restoreEditorState } from '@lexical/utils';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  HISTORIC_TAG,
  HISTORY_PUSH_TAG,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  TextNode,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { ChatEmojiNode, $transformChatEmoji } from '@/lib/chat-editor-emoji';
import { emojiParts } from '@/lib/premium-emoji';

export type ChatTextEditorHandle = {
  focus: () => void;
  rememberSelection: () => void;
  insertEmoji: (emoji: string) => void;
};
function $setText(text: string) {
  const paragraph = $createParagraphNode();
  text.split('\n').forEach((line, index) => {
    if (index) paragraph.append($createLineBreakNode());
    if (line) paragraph.append($createTextNode(line));
  });
  $getRoot().clear().append(paragraph);
}
export function ChatTextEditor(props: {
  ref?: Ref<ChatTextEditorHandle>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  className?: string;
  onFiles?: (files: File[]) => void;
  onSubmit?: () => void;
  onLimit?: (reason: 'length' | 'premium') => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useRef<LexicalEditor | null>(null);
  const remembered = useRef<RangeSelection | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useImperativeHandle(
    props.ref,
    () => ({
      focus() {
        root.current?.focus({ preventScroll: true });
      },
      rememberSelection() {
        instance.current?.getEditorState().read(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection))
            remembered.current = selection.clone();
        });
      },
      insertEmoji(emoji) {
        const editor = instance.current;
        if (!editor || latest.current.disabled) return;
        root.current?.focus({ preventScroll: true });
        editor.update(
          () => {
            if (
              remembered.current &&
              $getNodeByKey(remembered.current.anchor.key) &&
              $getNodeByKey(remembered.current.focus.key)
            )
              $setSelection(remembered.current.clone());
            remembered.current = null;
            const selection = $getSelection() ?? $getRoot().selectEnd();
            if ($isRangeSelection(selection)) selection.insertText(emoji);
          },
          { tag: HISTORY_PUSH_TAG, discrete: true },
        );
      },
    }),
    [],
  );
  useLayoutEffect(() => {
    let ready = false;
    const editor = createEditor({
      namespace: 'NoctgramChat',
      nodes: [ChatEmojiNode],
      editable: !latest.current.disabled,
      onError(error) {
        throw error;
      },
    });
    instance.current = editor;
    const cleanups = [
      registerPlainText(editor),
      registerHistory(editor, createEmptyHistoryState(), 300),
      editor.registerNodeTransform(TextNode, $transformChatEmoji),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (
            !latest.current.onSubmit ||
            !event ||
            event.shiftKey ||
            event.isComposing ||
            editor.isComposing()
          )
            return false;
          if (
            window.matchMedia('(pointer: coarse)').matches &&
            !event.ctrlKey &&
            !event.metaKey
          )
            return false;
          event.preventDefault();
          latest.current.onSubmit();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (
            !latest.current.onFiles ||
            !event ||
            !('clipboardData' in event) ||
            !event.clipboardData?.files.length
          )
            return false;
          event.preventDefault();
          latest.current.onFiles(Array.from(event.clipboardData.files));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerUpdateListener(
        ({ editorState, prevEditorState, tags }) => {
          if (!ready) return;
          const text = editorState.read(() => $getRoot().getTextContent());
          const tooManyPremium =
            emojiParts(text).filter((part) => part.emoji).length > 30;
          if (text.length > 4000 || tooManyPremium) {
            editor.update(() => $restoreEditorState(editor, prevEditorState), {
              tag: HISTORIC_TAG,
              discrete: true,
            });
            latest.current.onLimit?.(tooManyPremium ? 'premium' : 'length');
            return;
          }
          if (!tags.has('external-draft') && text !== latest.current.value)
            latest.current.onChange(text);
        },
      ),
    ];
    editor.setRootElement(root.current);
    editor.update(
      () => {
        $setText(latest.current.value);
        $setSelection(null);
      },
      { tag: ['external-draft', SKIP_DOM_SELECTION_TAG], discrete: true },
    );
    ready = true;
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      editor.setRootElement(null);
      instance.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const editor = instance.current;
    if (!editor) return;
    editor.setEditable(!props.disabled);
    if (
      editor.getEditorState().read(() => $getRoot().getTextContent()) ===
      props.value
    )
      return;
    editor.update(
      () => {
        $setText(props.value);
        remembered.current = null;
        if (document.activeElement === root.current) $getRoot().selectEnd();
        else $setSelection(null);
      },
      { tag: 'external-draft', discrete: true },
    );
    if (!props.value) editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [props.value, props.disabled]);
  return (
    <div
      ref={root}
      className={'chat-text-editor ' + (props.className ?? '')}
      contentEditable={!props.disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-label={props.label ?? 'Сообщение'}
      aria-multiline="true"
      aria-disabled={props.disabled || undefined}
      data-placeholder={props.placeholder ?? 'Написать сообщение…'}
      data-empty={!props.value || undefined}
      spellCheck
    />
  );
}

'use client';

import EmojiPicker, {
  Categories,
  EmojiStyle,
  SuggestionMode,
  Theme,
} from 'emoji-picker-react';
import russian from 'emoji-picker-react/dist/data/emojis-ru';

export default function ChatEmojiPicker({
  onSelect,
}: {
  onSelect: (emoji: string) => void;
}) {
  return (
    <EmojiPicker
      theme={Theme.DARK}
      emojiStyle={EmojiStyle.APPLE}
      emojiVersion="16.0"
      emojiData={russian}
      suggestedEmojisMode={SuggestionMode.RECENT}
      categories={[
        { category: Categories.SUGGESTED, name: 'Недавние' },
        { category: Categories.SMILEYS_PEOPLE, name: 'Смайлы и люди' },
        { category: Categories.ANIMALS_NATURE, name: 'Животные и природа' },
        { category: Categories.FOOD_DRINK, name: 'Еда и напитки' },
        { category: Categories.TRAVEL_PLACES, name: 'Путешествия' },
        { category: Categories.ACTIVITIES, name: 'Спорт и отдых' },
        { category: Categories.OBJECTS, name: 'Предметы' },
        { category: Categories.SYMBOLS, name: 'Символы' },
        { category: Categories.FLAGS, name: 'Флаги' },
      ]}
      getEmojiUrl={(unified) =>
        `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/${unified}.png`
      }
      onEmojiClick={({ emoji }) => onSelect(emoji)}
      autoFocusSearch={false}
      lazyLoadEmojis
      searchPlaceholder="Найти эмодзи"
      previewConfig={{ showPreview: false }}
      width="100%"
      height="100%"
    />
  );
}

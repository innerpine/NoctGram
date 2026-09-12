import type { GiftCollectible } from './gift-collectibles';

export type GiftDefinition = {
  id: string;
  name: string;
  price: number;
  color: string;
};

function collection(
  price: number,
  color: string,
  entries: [string, string, number?][],
): GiftDefinition[] {
  return entries.map(([id, name, itemPrice = price]) => ({
    id,
    name,
    price: itemPrice,
    color,
  }));
}

// Noct Stars prices belong to our catalog, independently of Telegram resale prices.
export const GIFT_CATALOG: readonly GiftDefinition[] = [
  ...collection(25, '#e5a2b4', [
    ['gift_5170145012310081615', 'Сердце с бантом'],
    ['gift_5170233102089322756', 'Плюшевый мишка'],
    ['gift_5170250947678437525', 'Сюрприз'],
    ['gift_5168103777563050263', 'Алая роза'],
  ]),
  ...collection(50, '#dcbf9c', [
    ['gift_5170144170496491616', 'Праздничный торт'],
    ['gift_5170314324215857265', 'Букет цветов'],
    ['gift_6028601630662853006', 'Шампанское'],
  ]),
  ...collection(100, '#a5cbdd', [
    ['gift_5168043875654172773', 'Кубок'],
    ['gift_5170521118301225164', 'Бриллиант'],
  ]),
  { id: 'toy_bear', name: 'Мишка', price: 75, color: '#daa27a' },
  { id: 'trapped_heart', name: 'Сердце', price: 100, color: '#ec839e' },
  { id: 'homemade_cake', name: 'Торт', price: 50, color: '#d2a5eb' },
  { id: 'eternal_rose', name: 'Роза', price: 250, color: '#db6e87' },
  ...collection(250, '#d1be92', [
    ['durovs_figurine', 'Статуэтка Дурова', 350],
    ['plush_pepe', 'Плюшевый Пепе', 1000],
  ]),
  ...collection(100, '#9bb8d9', [
    ['scared_cat', 'Пугливый кот', 200],
    ['joyful_bundle', 'Свёрток счастья'],
    ['ionic_dryer', 'Фен', 150],
    ['mighty_arm', 'Могучая рука', 250],
    ['ion_gem', 'Ионный кристалл', 450],
    ['love_potion', 'Приворотное зелье', 250],
    ['chill_flame', 'Холодное пламя'],
    ['loot_bag', 'Мешок сокровищ'],
    ['swiss_watch', 'Швейцарские часы', 450],
    ['perfume_bottle', 'Флакон духов'],
    ['heart_pendant', 'Подвеска-сердце'],
    ['moon_pendant', 'Лунный кулон'],
    ['nail_bracelet', 'Браслет-гвоздь', 150],
    ['bonded_ring', 'Парные кольца', 250],
    ['gem_signet', 'Перстень с камнем', 350],
    ['redo', 'REDO', 750],
  ]),
  ...collection(50, '#c4a2d9', [
    ['lush_bouquet', 'Пышный букет'],
    ['pretty_posy', 'Нежный букет'],
    ['sakura_flower', 'Цветок сакуры'],
    ['bow_tie', 'Галстук-бабочка', 250],
    ['santa_hat', 'Шапка Санты'],
    ['fresh_socks', 'Носочки', 500],
    ['love_candle', 'Свеча любви', 150],
    ['bday_candle', 'Именинная свеча'],
    ['input_key', 'Клавиша', 250],
    ['berry_box', 'Коробочка ягод', 150],
  ]),
  ...collection(75, '#e6aeae', [['bunny_muffin', 'Кекс-зайчик']]),
];

// Display old receipts without making retired gifts purchasable again.
export const RETIRED_GIFTS: readonly GiftDefinition[] = [
  { id: 'diamond_ring', name: 'Кольцо', price: 100, color: '#e4cd8a' },
  { id: 'stellar_rocket', name: 'Ракета', price: 100, color: '#89b9ea' },
  ...collection(250, '#d1be92', [
    ['liberty_figure', 'Статуя Свободы'],
    ['mini_oscar', 'Мини-Оскар'],
  ]),
  ...collection(100, '#9bb8d9', [
    ['durovs_cap', 'Кепка Дурова'],
    ['durovs_glasses', 'Очки Дурова'],
    ['durovs_boots', 'Ботинки Дурова'],
    ['durovs_coat', 'Пальто Дурова'],
    ['khabibs_papakha', 'Папаха Хабиба'],
    ['snoop_dogg', 'Снуп Догг'],
    ['jolly_chimp', 'Весёлый шимпанзе'],
    ['kissed_frog', 'Зачарованная лягушка'],
    ['triple_meow', 'Три котёнка'],
    ['rare_bird', 'Редкая птица'],
    ['pet_snake', 'Змейка'],
    ['lunar_snake', 'Лунная змея'],
    ['jelly_bunny', 'Мармеладный зайчик'],
    ['voodoo_doll', 'Кукла вуду'],
    ['tama_gadget', 'Тамагочи'],
    ['record_player', 'Проигрыватель'],
    ['low_rider', 'Лоурайдер'],
    ['trojan_horse', 'Троянский конь'],
    ['surge_board', 'Доска для сёрфинга'],
    ['pool_float', 'Надувной круг'],
    ['sand_castle', 'Замок из песка'],
    ['heroic_helmet', 'Шлем героя'],
    ['neko_helmet', 'Кошачий шлем'],
    ['light_sword', 'Световой меч'],
    ['ufc_strike', 'Удар UFC'],
    ['victory_medal', 'Медаль победителя'],
    ['algorithm_cup', 'Кубок алгоритмов'],
    ['intelligence_cup', 'Кубок интеллекта'],
    ['artisan_brick', 'Кирпич'],
    ['astral_shard', 'Астральный осколок'],
    ['electric_skull', 'Электрический череп'],
    ['crystal_ball', 'Хрустальный шар'],
    ['genie_lamp', 'Лампа джинна'],
    ['magic_potion', 'Волшебное зелье'],
    ['restless_jar', 'Беспокойная банка'],
    ['flying_broom', 'Летающая метла'],
    ['hex_pot', 'Ведьмин котёл'],
    ['spy_agaric', 'Мухомор-шпион'],
    ['jackinthebox', 'Чёртик из коробки'],
    ['money_pot', 'Горшочек золота'],
    ['case', 'Чемодан'],
    ['swag_bag', 'Стильная сумка'],
    ['sky_stilettos', 'Туфельки'],
    ['heart_locket', 'Медальон-сердце'],
    ['signet_ring', 'Печатка'],
    ['bling_binky', 'Драгоценная соска'],
    ['vintage_cigar', 'Винтажная сигара'],
    ['snoop_cigar', 'Сигара Снупа'],
    ['westside_sign', 'Знак Вестсайда'],
    ['timeless_book', 'Книга времени'],
  ]),
  ...collection(50, '#c4a2d9', [
    ['eight_roses', 'Восемь роз'],
    ['skull_flower', 'Цветок-череп'],
    ['cupid_charm', 'Талисман Купидона'],
    ['evil_eye', 'Глаз-оберег'],
    ['faith_amulet', 'Амулет веры'],
    ['clover_pin', 'Счастливый клевер'],
    ['telegram_pin', 'Значок Telegram'],
    ['red_star', 'Красная звезда'],
    ['hanging_star', 'Подвесная звезда'],
    ['top_hat', 'Цилиндр'],
    ['jester_hat', 'Шутовской колпак'],
    ['witch_hat', 'Ведьмина шляпа'],
    ['snow_mittens', 'Варежки'],
    ['xmas_stocking', 'Рождественский носок'],
    ['winter_wreath', 'Зимний венок'],
    ['snow_globe', 'Снежный шар'],
    ['sleigh_bell', 'Колокольчик'],
    ['jingle_bells', 'Бубенчики'],
    ['eternal_candle', 'Вечная свеча'],
    ['party_sparkler', 'Бенгальский огонёк'],
    ['big_year', 'Счастливый год'],
    ['desk_calendar', 'Настольный календарь'],
    ['star_notepad', 'Звёздный блокнот'],
    ['mood_pack', 'Набор настроений'],
    ['valentine_box', 'Валентинка'],
    ['snake_box', 'Коробочка со змеёй'],
    ['spring_basket', 'Весенняя корзинка'],
    ['easter_egg', 'Пасхальное яйцо'],
    ['easter_cake', 'Пасхальный кулич'],
    ['may', 'Первомай'],
    ['mad_pumpkin', 'Безумная тыква'],
    ['coffin', 'Гробик'],
    ['gravestone', 'Надгробие'],
  ]),
  ...collection(25, '#e6aeae', [
    ['whip_cupcake', 'Капкейк'],
    ['mousse_cake', 'Муссовый торт'],
    ['happy_brownie', 'Счастливый брауни'],
    ['ginger_cookie', 'Имбирное печенье'],
    ['cookie_heart', 'Печенье-сердце'],
    ['precious_peach', 'Персик'],
    ['candy_cane', 'Сладкая трость'],
    ['hypno_lollipop', 'Гипноледенец'],
    ['lol_pop', 'Леденец'],
    ['ice_cream', 'Мороженое'],
    ['vice_cream', 'Дерзкое мороженое'],
    ['instant_ramen', 'Рамен'],
    ['holiday_drink', 'Праздничный напиток'],
    ['spiced_wine', 'Глинтвейн'],
    ['coconut_drink', 'Кокосовый коктейль'],
    ['sharp_tongue', 'Острый язык'],
  ]),
];
export function availableGiftDefinition(id: unknown) {
  return GIFT_CATALOG.find((gift) => gift.id === id);
}
export function giftDefinition(id: unknown) {
  return (
    availableGiftDefinition(id) || RETIRED_GIFTS.find((gift) => gift.id === id)
  );
}
export type ReceivedGift = {
  id: string;
  giftId: string;
  sender: string;
  recipient: string;
  message: string;
  hidden: number;
  created: number;
  senderName: string;
  senderAvatar: string;
  senderHandle: string;
  collectible?: GiftCollectible | null;
};

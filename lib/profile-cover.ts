// The «Жидкое» banner is drawn from the avatar, so `users.cover` stores this
// marker instead of an image URL. Everything that needs a real image goes
// through coverImage().
export const LIQUID_COVER = 'liquid';
export const coverImage = (cover?: string | null) =>
  cover && cover !== LIQUID_COVER ? cover : '';

export const CHAT_FILE_LIMIT = 25 * 1024 * 1024;
export const CHAT_ATTACHMENT_LIMIT = 10;
export type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: 'image' | 'video' | 'file';
};
export function chatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}
export function chatFileKind(type: string): ChatAttachment['kind'] {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type))
    return 'image';
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(type))
    return 'video';
  return 'file';
}
export function validChatMedia(type: string, bytes: Uint8Array) {
  if (chatFileKind(type) === 'file') return true;
  if (bytes.length < 12) return false;
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.slice(start, end));
  if (type === 'image/jpeg')
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/png')
    return (
      ascii(1, 4) === 'PNG' &&
      bytes[0] === 137 &&
      bytes[4] === 13 &&
      bytes[5] === 10
    );
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (type === 'image/webp')
    return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (type === 'video/webm')
    return (
      bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163
    );
  return ascii(4, 8) === 'ftyp';
}

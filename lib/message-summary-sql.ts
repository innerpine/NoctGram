// Plain-text previews for chat lists and reply quotes. Arguments are internal
// SQL expressions (a media JSON column and a text column), never user input.
export function mediaLabelSql(media: string, filePrefix = '') {
  if (!/^[a-z]*\.?[a-z]+$/i.test(media)) throw new Error('Invalid SQL column');
  return `CASE json_extract(${media},'$[0].kind') WHEN 'image' THEN 'Фото' WHEN 'video' THEN 'Видео'
    WHEN 'voice' THEN 'Голосовое сообщение' WHEN 'round' THEN 'Видеосообщение'
    ELSE ${filePrefix ? `'${filePrefix.replace(/'/g, "''")}'||` : ''}json_extract(${media},'$[0].name') END`;
}
export function messageSummarySql(
  alias: string,
  { textLimit = 0, filePrefix = '', empty = 'Сообщение' } = {},
) {
  if (!/^[a-z]*$/i.test(alias)) throw new Error('Invalid SQL alias');
  const column = (name: string) => (alias ? `${alias}.${name}` : name);
  const text = textLimit
    ? `substr(${column('text')},1,${Math.trunc(textLimit)})`
    : column('text');
  return `CASE WHEN ${column('text')}<>'' THEN ${text} WHEN json_array_length(${column('media')})>0 THEN ${mediaLabelSql(column('media'), filePrefix)}
    WHEN ${column('stickerId')} IS NOT NULL THEN 'Стикер' WHEN ${column('postShareId')} IS NOT NULL THEN 'Публикация' ELSE '${empty.replace(/'/g, "''")}' END`;
}

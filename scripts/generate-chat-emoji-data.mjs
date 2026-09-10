import { readFile, writeFile } from 'node:fs/promises';
// A compact list of supported artwork names, without picker/search translations.
const source = await readFile(
  new URL(
    '../node_modules/emoji-picker-react/dist/data/emojis-en.js',
    import.meta.url,
  ),
  'utf8',
);
const data = JSON.parse(
  source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1),
);
const names = new Set(
  Object.values(data.emojis)
    .flat()
    .filter((item) => Number(item.a) <= 16)
    .flatMap((item) => [item.u, ...(item.v || [])]),
);
await writeFile(
  new URL('../lib/chat-emoji-data.json', import.meta.url),
  JSON.stringify([...names].sort((a, b) => a.localeCompare(b))) + '\n',
);
console.log(`Generated ${names.size} Apple emoji artwork names (Unicode 16).`);

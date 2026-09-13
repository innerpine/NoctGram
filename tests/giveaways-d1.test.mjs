import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
const root = process.cwd(), source = process.env.NOCT_GIVEAWAY_SOURCE || root;
const require = createRequire(join(root, 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { build } = require('esbuild');

test('giveaways use real D1 transactions, SQL limits, uniform membership ranks and one debit', { timeout: 180000 }, async (t) => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default {fetch(){return new Response("Isolated giveaway test",{status:404})}};',
    compatibilityDate: '2026-05-15', d1Databases: ['DB'], d1Persist: false, cachePersist: false,
    durableObjectsPersist: false, outboundService: () => { throw new Error('No external network'); },
  }));
  t.after(() => mf.dispose());
  const d = await mf.getD1Database('DB');
  const sqlFiles = JSON.parse(readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8')).entries
    .filter((entry) => entry.tag !== '0044_giveaways').map((entry) => join(root, 'drizzle', entry.tag + '.sql'));
  sqlFiles.push(join(source, 'drizzle/0044_giveaways.sql'));
  for (const file of sqlFiles) for (const sql of readFileSync(file, 'utf8').split('--> statement-breakpoint')) if (sql.trim()) await d.prepare(sql).run();
  globalThis.__giveawayRealD1 = d;
  t.after(() => { delete globalThis.__giveawayRealD1; });
  const compiled = await build({ entryPoints: [join(source, 'lib/giveaways.ts')], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'real-d1', setup(build) {
    build.onResolve({ filter: /^\.\/storage$/ }, () => ({ path: 'storage', namespace: 'fixture' }));
    build.onResolve({ filter: /^\.\/auth-session$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'storage'
      ? 'export const db = () => globalThis.__giveawayRealD1;'
      : "export const setting=()=>''; export const tokenHash=async s=>s;" }));
    build.onResolve({ filter: /^\.\// }, (args) => {
      try { readFileSync(join(args.resolveDir,args.path+'.ts')); return undefined; }
      catch { return { path: join(root,'lib',args.path+'.ts') }; }
    });
  } }] });
  const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const now = Date.now();
  for (const id of ['owner','a','b','c']) await d.prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)').bind(id,id,now).run();
  await d.prepare("INSERT INTO chat_rooms(id,ownerId,name,created,updatedAt) VALUES('group','owner','Group',?,?)").bind(now,now).run();
  for (const id of ['owner','a','b','c']) await d.prepare("INSERT INTO chat_room_members(roomId,userId,role,joinedAt) VALUES('group',?,?,?)").bind(id,id==='owner'?'owner':'member',now).run();
  await d.prepare("INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES('grant','owner',1000,'admin_grant',?)").bind(now).run();
  const draft = { action:'create',key:crypto.randomUUID(),targetKind:'group',targetId:'group',prize:'stars',winnerCount:2,starsPerWinner:350,endsAt:now+3600000 };
  const concurrent = await Promise.allSettled([api.createGiveaway('owner', draft, now), api.createGiveaway('owner',{...draft,key:crypto.randomUUID()},now)]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  const giveaway = concurrent.find(r=>r.status==='fulfilled').value.giveaway;
  const settlement = await Promise.all([api.settleGiveaway(giveaway.id,giveaway.endsAt),api.settleGiveaway(giveaway.id,giveaway.endsAt)]);
  assert.equal(settlement.filter(Boolean).length,1);
  assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM star_transfers WHERE kind='giveaway_prize'").first()).n,2);
  assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM star_transfers WHERE kind='giveaway_debit'").first()).n,1);
  const details = await api.getGiveaway('a',giveaway.id,giveaway.endsAt);
  assert.equal(details.winners.length,2);
  assert.equal(new Set(details.winners.map(w=>w.id)).size,2);
  assert.ok(details.winners.every(w=>w.id!=='owner'));
  await d.prepare("INSERT INTO users(id,name,kind,ownerId,created) VALUES('channel','Channel','channel','owner',?)").bind(now).run();
  await d.prepare("INSERT INTO follows(follower,following) VALUES('a','channel')").run();
  await d.prepare("INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES('extra','owner',1000,'admin_grant',?)").bind(now).run();
  const premium = await api.createGiveaway('owner',{...draft,key:crypto.randomUUID(),targetKind:'channel',targetId:'channel',prize:'premium',winnerCount:2},now);
  await api.settleGiveaway(premium.giveaway.id,premium.giveaway.endsAt);
  assert.equal((await d.prepare("SELECT source FROM premium_entitlements WHERE userId='a'").first()).source,'giveaway');
  assert.equal((await api.getGiveaway('b',premium.giveaway.id,premium.giveaway.endsAt)).refund,500);
});

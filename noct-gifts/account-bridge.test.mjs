import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const bridge = await readFile(new URL('./account-bridge.js', import.meta.url), 'utf8');
const html = await readFile(new URL('./Noct Gifts App.dc.html', import.meta.url), 'utf8');
const model = html.match(/<script\b(?=[^>]*\bdata-dc-script\b)[^>]*>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(model, 'The app must contain its real DC model');
const plain = value => JSON.parse(JSON.stringify(value));
const auth = 'auth_date=12345&user=%7B%22id%22%3A111%7D&hash=synthetic-auth';
const links = { siteUrl: 'https://noct.test/', linkAccountUrl: 'https://noct.test/', linkAccountHint: 'Noct Stars → Telegram' };
const ownedGift = (id, patch = {}) => ({ id, giftId: 'toy_bear', name: 'Мишка', price: 25, color: '#daa27a', imageUrl: 'https://noct.test/assets/gifts/toy_bear.webp', animationUrl: 'https://noct.test/assets/gifts/toy_bear.json', hidden: false, created: 1, collectible: null, ...patch });
const games={version:'2026-09-15-3',cases:[{id:'eclipse',n:'Затмение',p:320,t:'#C7ACE8',s:'diamond',items:[['orb',50],['watch',50]]},{id:'moon',n:'Лунный',p:75,t:'#C7ACE8',s:'circle',items:[['orb',100]]}],gifts:{orb:{giftId:'crystal_ball',name:'Хрустальный шар',price:100,color:'#C7ACE8',rarity:'rare',imageUrl:'/assets/gifts/crystal_ball.webp',animationUrl:'/assets/gifts/crystal_ball.json'},watch:{giftId:'swiss_watch',name:'Часы',price:250,color:'#FFD36A',rarity:'rare',imageUrl:'/assets/gifts/swiss_watch.webp',animationUrl:'/assets/gifts/swiss_watch.json'}},upgrade:{feePercent:0,chancePercent:88,minChance:2,maxChance:92}};
const linked = (patch = {}) => ({ status: 'linked', authExpiresAt: Date.now()+3600000, user: { id: 'alice', name: 'Alice', handle: 'alice', avatar: '' }, balance: 500, gifts: [ownedGift('canonical-1')], next: null, history: [], links, capabilities: { sharedAccount: true, caseOpening: true, upgrading: true }, games, catalog: { telegram: true, products: [{ id: 'stars500', product: 'stars', title: '500 Noct Stars', xtr: 75, rub: 75, units: 500 },{ id: 'stars1000', product: 'stars', title: '1000 Noct Stars', xtr: 139, rub: 139, units: 1000 }] }, ...patch });

function fixture({ inTelegram = true, storage = new Map(), search = '', directAssets = false } = {}) {
  const calls = [], pending = [], jobs = new Map(), listeners = new Map(), opened = [];
  const created = [], revoked = [];
  class AvatarURL extends URL {
    static createObjectURL(blob){created.push(blob);return 'blob:avatar-'+created.length;}
    static revokeObjectURL(url){revoked.push(url);}
  }
  let next = 1, clock = 0, uuid = 0, ready = 0;
  const schedule = (fn, ms = 0) => { const id=next++;jobs.set(id,{fn,at:clock+ms});return id; };
  const document = { hidden: false, addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);}, removeEventListener(type,fn){listeners.get(type)?.delete(fn);} };
  const media = { matches: false, addEventListener(){}, removeEventListener(){} };
  const telegram = { initData: inTelegram ? auth : '', ready(){ready++;}, openTelegramLink(url){opened.push(url);}, openLink(url){opened.push(url);} };
  const window = { NoctGiftsConfig:{directAssets}, Telegram:{WebApp:telegram}, location:{search,origin:'http://127.0.0.1:4186'}, matchMedia:()=>media, open:url=>opened.push(url) };
  class DCLogic { constructor(props){this.props=props;this.state={};} setState(patch,callback){this.state={...this.state,...(typeof patch==='function'?patch(this.state):patch)};callback?.();} }
  const context=vm.createContext({ window,document,location:window.location,DCLogic,React:{createRef:()=>({current:null})},URL:AvatarURL,URLSearchParams,Date,Math,console,
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},crypto:{randomUUID:()=>`request-id-${++uuid}`},AbortSignal:{timeout:ms=>({timeout:ms})},
    setTimeout:schedule,clearTimeout:id=>jobs.delete(id),requestAnimationFrame:fn=>schedule(fn,16),cancelAnimationFrame:id=>jobs.delete(id),
    fetch:(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return new Promise((resolve,reject)=>pending.push({resolve,reject}));},
  });
  vm.runInContext(bridge,context,{filename:'account-bridge.js'});
  vm.runInContext(model+'\n;globalThis.App=Component;',context,{filename:'Noct Gifts App.dc.html'});
  const app=new context.App({variant:'cases'});
  app.componentDidMount();
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {app,calls,opened,window,jobs,listeners,pending,storage,created,revoked,ready:()=>ready,flush,
    async replyImage(index=0,type='image/webp'){assert.ok(pending[index]);pending.splice(index,1)[0].resolve({ok:true,headers:new Headers({'Content-Type':type}),blob:async()=>new Blob(['image'],{type})});await flush();},
    async reply(data,status=200){assert.ok(pending.length,'Expected a pending network request');pending.shift().resolve({ok:status>=200&&status<300,status,json:async()=>data});await flush();},
    async replyAt(index,data,status=200){assert.ok(pending[index]);pending.splice(index,1)[0].resolve({ok:status>=200&&status<300,status,json:async()=>data});await flush();},
    async reject(message='Network failure'){assert.ok(pending.length);pending.shift().reject(new Error(message));await flush();},
    async tick(ms){const end=clock+ms;let count=0;for(;;){const entry=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;assert.ok(++count<100,'Unexpected timer loop');jobs.delete(entry[0]);clock=entry[1].at;entry[1].fn(clock);await flush();}clock=end;},
    dispose(){app.componentWillUnmount();},
  };
}

const withAvatar=(avatar='https://noct.test/api/media/avatar-alice',id='alice')=>linked({user:{id,name:id,handle:id,avatar}});
void test('profile uses authenticated NoctGram avatar bytes, refreshes changed images and releases blobs',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(withAvatar());
  const call=f.calls.at(-1);assert.equal(call.url,'/api/noct-gifts/avatar');
  assert.deepEqual(plain(call.body),{initData:auth});assert.equal(call.options.credentials,'omit');
  assert.equal(call.options.cache,'no-store');await f.replyImage();
  assert.equal(f.app.renderVals().profileAvatar,'blob:avatar-1');
  let refresh=f.app.refreshAccount();await f.reply(withAvatar());await refresh;
  assert.equal(f.calls.filter(c=>c.url.endsWith('/avatar')).length,1);
  refresh=f.app.refreshAccount();await f.reply(withAvatar('https://noct.test/api/media/new-avatar'));await refresh;
  assert.deepEqual(f.revoked,['blob:avatar-1']);await f.replyImage();
  assert.equal(f.app.renderVals().profileAvatar,'blob:avatar-2');
  f.dispose();assert.ok(f.revoked.includes('blob:avatar-2'));
});
void test('late avatar responses cannot replace another account or update an unmounted app',async()=>{
  const f=fixture();await f.reply(withAvatar());
  const refresh=f.app.refreshAccount();await f.replyAt(1,withAvatar('https://noct.test/api/media/avatar-bob','bob'));await refresh;
  await f.replyImage(1);assert.equal(f.app.renderVals().profileAvatar,'blob:avatar-1');
  await f.replyImage();assert.equal(f.created.length,1);f.dispose();
  const closed=fixture();await closed.reply(withAvatar());closed.dispose();await closed.replyImage();
  assert.equal(closed.created.length,0);
});
void test('failed avatar download can retry and blank or unsafe avatars use the placeholder',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(withAvatar());await f.replyImage(0,'text/html');
  assert.equal(f.app.renderVals().profileAvatar,'assets/noctgram-logo.png');
  let refresh=f.app.refreshAccount();await f.reply(withAvatar());await refresh;await f.replyImage();
  assert.equal(f.app.renderVals().profileAvatar,'blob:avatar-1');
  for(const source of ['https://noct.test/assets/profile.png','','javascript:alert(1)']){
    refresh=f.app.refreshAccount();await f.reply(withAvatar(source));await refresh;
    assert.equal(f.app.renderVals().profileAvatar,source.startsWith('https:')?source:'assets/noctgram-logo.png');
    assert.equal(f.pending.length,0);
  }
});

void test('main-domain mini-app uses original gift assets and the existing authenticated API', async t=>{
  const f=fixture({directAssets:true});t.after(()=>f.dispose());
  await f.reply(linked());
  assert.equal(f.app.state.sharedGifts[0].image,'/assets/gifts/toy_bear.webp');
  assert.equal(f.app.state.sharedGifts[0].animation,'/assets/gifts/toy_bear.json');
  assert.equal(f.calls[0].url,'/api/noct-gifts/account');
  assert.equal(f.calls[0].options.credentials,'omit');
  assert.equal(f.app.state.accountMode,'linked');
});

void test('Telegram identity is sent only in bounded JSON POST body; browser credentials are omitted', async t=>{
  const f=fixture();t.after(()=>f.dispose());
  assert.equal(f.ready(),1);assert.equal(f.app.state.accountMode,'loading');assert.equal(f.app.state.balance,0);assert.deepEqual(plain(f.app.state.inv),[]);
  const first=f.calls[0];assert.equal(first.url,'/api/noct-gifts/account');assert.equal(first.options.method,'POST');assert.equal(first.body.initData,auth);
  assert.equal(first.options.credentials,'omit');assert.equal(first.options.cache,'no-store');assert.equal(first.options.headers['Content-Type'],'application/json');
  assert.equal(first.url.includes('auth_date'),false);assert.equal(JSON.stringify(first.options.headers).includes('synthetic-auth'),false);
  await f.reply(linked());
});
void test('plain browser has no fictional account, balance, prizes or API access even with a result query',t=>{
  const f=fixture({inTelegram:false,search:'?view=open-result'});t.after(()=>f.dispose());assert.equal(f.calls.length,0);assert.equal(f.app.state.accountMode,'telegram');assert.equal(f.app.state.balance,0);assert.equal(f.app.state.prizeGift,null);assert.equal(f.app.renderVals().needsAuth,true);assert.equal(f.app.renderVals().isOpen,false);f.app.startOpen();f.app.runUpgrade();f.app.confirmPay();assert.equal(f.calls.length,0);f.app.renderVals().openTelegram();assert.equal(f.opened[0],'https://t.me/noctgramdrop_bot');
});
void test('canonical gifts and cursor pagination preserve real instance IDs, artwork, numbers and deduplicate',async t=>{
  const f=fixture();t.after(()=>f.dispose());
  const special=ownedGift('outside-demo',{giftId:'gift_5170145012310081615',name:'Сердце с бантом',imageUrl:'https://noct.test/assets/gifts/gift_5170145012310081615.webp'});
  await f.reply(linked({gifts:[special],next:'outside-demo'}));
  assert.equal(f.app.state.balance,500);assert.deepEqual(plain(f.app.state.inv),[]);assert.equal(f.app.state.sharedGifts[0].giftId,special.giftId);assert.equal(f.app.state.sharedGifts[0].image,'/noctgram-assets/gifts/gift_5170145012310081615.webp');
  const more=f.app.refreshAccount(true);assert.equal(f.calls.at(-1).body.before,'outside-demo');
  const collectible=ownedGift('pepe-seven',{giftId:'plush_pepe',collectible:{family:'plush_pepe',number:7,model:{name:'Black',asset:'collectible-plush_pepe-123456abcdef'}},animationUrl:'https://noct.test/assets/gifts/collectible-plush_pepe-123456abcdef.tgs'});
  await f.reply(linked({gifts:[special,collectible]}));await more;
  assert.deepEqual(plain(f.app.state.sharedGifts.map(g=>g.id)),['outside-demo','pepe-seven']);assert.equal(f.app.state.sharedNext,null);
  const vals=f.app.renderVals();assert.equal(vals.sharedGifts[1].number,'#7');vals.sharedGifts[1].open();assert.equal(f.app.state.sharedGift.id,'pepe-seven');
});
void test('unlinked response removes old private balance, inventory, pagination and open gift sheet',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked({next:'next-gift'}));
  f.app.renderVals().sharedGifts[0].open();f.app.setState({acceptedTerms:true,payPhase:'pending'});
  const refreshing=f.app.refreshAccount();await f.reply({status:'unlinked',links});await refreshing;
  assert.equal(f.app.state.accountMode,'unlinked');assert.equal(f.app.state.balance,0);assert.equal(f.app.state.shared,null);assert.deepEqual(plain(f.app.state.sharedGifts),[]);
  assert.equal(f.app.state.sharedNext,null,'A former owner cursor must not survive unlink');assert.ok(!f.app.state.sharedGift,'A private gift detail must close on unlink');assert.equal(f.app.state.sheet,null);assert.equal(f.app.state.acceptedTerms,false);assert.equal(f.app.state.payPhase,'idle');
});
for(const status of [401,403])void test(`HTTP ${status} revokes cached private account instead of leaving it linked`,async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked({next:'old-cursor'}));f.app.renderVals().sharedGifts[0].open();
  const refreshing=f.app.refreshAccount();await f.reply({error:'Access denied'},status);await refreshing;
  assert.notEqual(f.app.state.accountMode,'linked');assert.equal(f.app.state.balance,0);assert.equal(f.app.state.shared,null);assert.deepEqual(plain(f.app.state.sharedGifts),[]);assert.equal(f.app.state.sharedNext,null);assert.ok(!f.app.state.sharedGift);assert.equal(f.app.state.sheet,null);
});
void test('a changed linked NoctGram owner cannot append old owner gifts or compare balances',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked({next:'alice-cursor'}));f.app.renderVals().sharedGifts[0].open();
  const refreshing=f.app.refreshAccount(true);
  await f.reply(linked({user:{id:'bob',name:'Bob'},balance:900,gifts:[],next:null}));
  if(f.pending.length){assert.equal('before' in f.calls.at(-1).body,false);await f.reply(linked({user:{id:'bob',name:'Bob'},balance:900,gifts:[ownedGift('bob-gift')]}));}
  await refreshing;
  assert.equal(f.app.state.shared.user.id,'bob');assert.ok(f.app.state.sharedGifts.every(g=>g.id!=='canonical-1'),'Alice gifts cannot be shown under Bob');
  assert.ok(!f.app.state.sharedGift);assert.equal(f.app.state.sheet,null);assert.equal(f.app.state.celebration,0,'Changing identity is not a top-up');
});
void test('live confirmPay uses common catalog and existing bot checkout, never awards fake credit',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());f.app.setState({pack:0,acceptedTerms:true,sheet:'pay'});
  const payment=f.app.confirmPay();const topup=f.calls.at(-1);
  assert.equal(topup.url,'/api/noct-gifts/topup');assert.equal(topup.body.sku,'stars500');assert.equal(topup.body.acceptedTerms,true);assert.ok(topup.body.key);assert.equal(topup.body.initData,auth);
  f.app.confirmPay();assert.equal(f.calls.filter(c=>c.url.endsWith('/topup')).length,1);
  await f.reply({id:'order-1',status:'pending',checkoutUrl:'https://t.me/noct_test_bot?start=pay_123'});await payment;
  assert.equal(f.app.state.balance,500);assert.equal(f.app.state.inv.length,0);assert.equal(f.opened[0],'https://t.me/noct_test_bot?start=pay_123');
  await f.tick(1800);assert.equal(f.app.state.balance,500);assert.equal(f.app.state.celebration,0);
});
void test('a failed payment reuses its request key; changing SKU starts a distinct request',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());f.app.setState({pack:0,acceptedTerms:true});
  let payment=f.app.confirmPay();const key=f.calls.at(-1).body.key;await f.reject();await payment;
  payment=f.app.confirmPay();assert.equal(f.calls.at(-1).body.key,key);await f.reply({error:'temporarily unavailable'},503);await payment;
  f.app.setState({pack:1});payment=f.app.confirmPay();assert.notEqual(f.calls.at(-1).body.key,key);assert.equal(f.calls.at(-1).body.sku,'stars1000');await f.reject();await payment;
  assert.equal(f.app.state.balance,500);
});
void test('payment requires consent and unlinked game actions cannot send requests',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());
  const count=f.calls.length;await f.app.confirmPay();assert.equal(f.calls.length,count);
  for(const accountMode of ['loading','unlinked','error','telegram']){
    f.app.setState({accountMode});const before=plain({balance:f.app.state.balance,sharedGifts:f.app.state.sharedGifts});f.app.startOpen();f.app.runUpgrade();
    assert.deepEqual(plain({balance:f.app.state.balance,sharedGifts:f.app.state.sharedGifts}),before);assert.equal(f.calls.length,count);
  }
});
void test('unmount ignores a late account response and removes listeners',async()=>{
  const f=fixture();const before=plain(f.app.state);f.dispose();await f.reply(linked());
  assert.deepEqual(plain(f.app.state),before);assert.equal(f.listeners.get('visibilitychange')?.size,0);assert.equal(f.jobs.size,0);
});
const caseResult=(body,{balance=180,id='won-1',available=true,userId='alice'}={})=>({userId,operation:{id:'operation-'+id,key:body.key,kind:'case',caseId:body.caseId,giftAlias:'orb',success:true,price:320,created:1},balance,gift:ownedGift(id,{giftId:'crystal_ball',name:'Хрустальный шар',price:100,available})});
const upgradeResult=(body,{success=true,balance=500,id='upgraded-1'}={})=>({userId:'alice',operation:{id:'operation-'+id,key:body.key,kind:'upgrade',sourceReceiptId:body.receiptId,targetGiftId:body.targetGiftId,giftAlias:success?'watch':null,chance:9,roll:success?2:90,success,price:0,created:1},balance,gift:success?ownedGift(id,{giftId:'swiss_watch',name:'Часы',price:250,available:true}):null});
const batchResult=(body,kind='case')=>{
  const results=Array.from({length:kind==='case'?body.count:body.receiptIds.length},(_,i)=>{
    const input={...body,key:i?body.key+':'+(i+1):body.key,receiptId:body.receiptIds?.[i]};
    const single=kind==='case'?caseResult(input,{id:'batch-'+i}):upgradeResult(input,{id:'batch-'+i,success:i%2===0});
    return {operation:single.operation,gift:single.gift};
  });
  return {userId:'alice',operation:{...results[0].operation,count:results.length,price:results.reduce((sum,item)=>sum+item.operation.price,0)},results,balance:kind==='case'?10000-results.length*320:0};
};
for(const amount of [3,5,10])void test(`case batch ${amount} freezes total price and shows every distinct prize`,async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked({balance:10000}));f.app.go({screen:'case'});
  f.app.setBatchCount('case',amount);assert.match(f.app.renderVals().ctaLabel,new RegExp('×'+amount));
  const opening=f.app.startOpen(),body=f.calls.at(-1).body;assert.equal(body.count,amount);
  f.app.setBatchCount('case',1);f.app.startOpen();assert.equal(f.app.state.caseCount,amount);assert.equal(f.pending.length,1);
  await f.reply(batchResult(body));await opening;
  assert.equal(f.app.state.balance,10000-amount*320);assert.equal(f.app.state.sharedGifts.length,1+amount);
  assert.equal(f.app.renderVals().batchCards.length,amount);assert.equal(f.app.state.phase,'spin');
  f.app.finishOpen();assert.equal(f.app.state.phase,'result');assert.equal(f.app.renderVals().multiCase,true);
  assert.match(f.app.renderVals().repeatCaseLabel,new RegExp('×'+amount));assert.equal(f.storage.size,0);
});
void test('batch opening requires enough balance for all draws and incomplete responses never commit client state',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());f.app.go({screen:'case'});f.app.setBatchCount('case',3);
  assert.equal(f.app.renderVals().ctaDisabled,true);await f.app.startOpen();assert.equal(f.pending.length,0);
  f.app.setState({balance:10000});let opening=f.app.startOpen();const body=f.calls.at(-1).body,result=batchResult(body);
  await f.reply({...result,results:result.results.slice(0,2)});await opening;
  assert.equal(f.app.state.gameRetry,true);assert.equal(f.app.state.balance,10000);assert.equal(f.app.state.sharedGifts.length,1);
  f.app.setBatchCount('case',10);opening=f.app.retryGame();assert.deepEqual(plain(f.calls.at(-1).body),body);
  await f.reply(result);await opening;assert.equal(f.app.state.sharedGifts.length,4);
});
void test('batch retry after closing the app restores original count and excludes already used prizes',async t=>{
  const storage=new Map(),f=fixture({storage});await f.reply(linked({balance:10000}));f.app.setBatchCount('case',5);
  const opening=f.app.startOpen(),body=f.calls.at(-1).body;await f.reject();await opening;f.dispose();
  const next=fixture({storage});t.after(()=>next.dispose());await next.reply(linked({balance:8400}));
  const retry=next.app.retryGame();assert.deepEqual(plain(next.calls.at(-1).body),body);
  const response=batchResult(body);response.results[2].gift.available=false;await next.reply(response);await retry;
  assert.equal(next.app.state.caseCount,5);assert.equal(next.app.state.sharedGifts.length,5);
  assert.equal(next.app.state.sharedGifts.some(g=>g.id==='batch-2'),false);
});
for(const amount of [3,5,10])void test(`upgrade ${amount} selects distinct gifts and consumes them without Stars`,async t=>{
  const f=fixture();t.after(()=>f.dispose());const gifts=Array.from({length:amount+1},(_,i)=>ownedGift('source-'+i));
  await f.reply(linked({gifts,balance:0}));f.app.go({screen:'upgrade'});f.app.setBatchCount('upgrade',amount);
  for(let i=0;i<amount;i++)f.app.chooseUpgradeSource({uid:'source-'+i});
  f.app.setState({toId:'watch'});assert.equal(f.app.renderVals().ctaDisabled,false);assert.equal(f.app.renderVals().upgradeRows.length,amount);
  assert.ok(f.app.renderVals().upgradeRows.every(row=>row.chance==='9%'));
  const upgrading=f.app.runUpgrade(),body=f.calls.at(-1).body;
  assert.equal(body.receiptId,undefined);assert.equal(body.receiptIds.length,amount);
  f.app.setBatchCount('upgrade',1);f.app.runUpgrade();assert.equal(f.pending.length,1);
  await f.reply(batchResult(body,'upgrade'));await upgrading;await f.tick(3600);
  assert.equal(f.app.state.balance,0);assert.equal(f.app.state.upPhase,'success');
  assert.equal(f.app.state.sharedGifts.length,1+Math.ceil(amount/2));assert.ok(f.app.state.sharedGifts.some(g=>g.id==='source-'+amount));
  assert.match(f.app.renderVals().resultText,/Noct Stars не списаны/);
  assert.equal(f.app.renderVals().upgradeRows.filter(row=>row.status==='Успех').length,Math.ceil(amount/2));
});
void test('batch source selection can toggle, preserves independent prices and rejects a too-cheap target',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked({gifts:[ownedGift('a'),ownedGift('b',{price:150}),ownedGift('c')]}));
  f.app.go({screen:'upgrade',toId:'orb'});f.app.setBatchCount('upgrade',3);
  f.app.chooseUpgradeSource({uid:'a'});f.app.chooseUpgradeSource({uid:'a'});assert.equal(f.app.selectedUpgradeGifts().length,0);
  for(const uid of ['a','b','c'])f.app.chooseUpgradeSource({uid});assert.equal(f.app.state.toId,null);
  assert.equal(f.app.renderVals().ctaDisabled,true);f.app.setState({toId:'watch'});
  assert.deepEqual(plain(f.app.renderVals().upgradeRows.map(row=>row.chance)),['9%','53%','9%']);
  assert.equal(f.app.renderVals().ctaDisabled,false);
});

void test('case opening waits for an authoritative receipt, credits it immediately and animation cannot award again',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());
  const before=plain({balance:f.app.state.balance,gifts:f.app.state.sharedGifts});
  const opening=f.app.startOpen();f.app.startOpen();
  assert.equal(f.calls.filter(c=>c.url.endsWith('/case')).length,1);
  const body=f.calls.at(-1).body;assert.equal(body.caseId,'eclipse');assert.equal(body.version,games.version);assert.ok(body.key);
  assert.equal('balance' in body,false);assert.equal('prize' in body,false);
  assert.equal(f.app.state.gamePending,true);assert.equal(f.app.state.phase,'idle');
  assert.deepEqual(plain({balance:f.app.state.balance,gifts:f.app.state.sharedGifts}),before);
  await f.reply(caseResult(body));await opening;
  assert.equal(f.app.state.balance,180);assert.ok(f.app.state.sharedGifts.some(g=>g.id==='won-1'));
  assert.equal(f.app.state.phase,'spin');assert.equal(f.app.state.reel[34],'orb');assert.equal(f.app.state.prizeNum,'');
  const committed=plain({balance:f.app.state.balance,gifts:f.app.state.sharedGifts});
  f.app.renderVals().skip();f.app.renderVals().goProfile();await f.tick(6000);
  assert.deepEqual(plain({balance:f.app.state.balance,gifts:f.app.state.sharedGifts}),committed);
  assert.equal(f.storage.size,0);
});
void test('unknown case outcome retries the same frozen key after reload without starting another paid opening',async t=>{
  const storage=new Map(),f=fixture({storage});await f.reply(linked());
  const opening=f.app.startOpen(),body=plain(f.calls.at(-1).body);await f.reject();await opening;
  assert.equal(f.app.state.gameRetry,true);assert.equal(f.app.state.balance,500);
  f.app.setState({caseId:'moon'});f.app.startOpen();assert.equal(f.calls.filter(c=>c.url.endsWith('/case')).length,1);
  assert.equal([...storage.values()].some(value=>value.includes(auth)),false,'Telegram credentials must not be persisted');
  f.dispose();const reopened=fixture({storage});t.after(()=>reopened.dispose());await reopened.reply(linked());
  assert.equal(reopened.app.state.gameRetry,true);
  const retry=reopened.app.retryGame();assert.deepEqual(plain(reopened.calls.at(-1).body),body);
  await reopened.reply(caseResult(body));await retry;
  assert.equal(reopened.app.state.sharedGifts.filter(g=>g.id==='won-1').length,1);assert.equal(reopened.app.state.balance,180);assert.equal(storage.size,0);
});
void test('definite insufficient balance error clears the request; rate limits keep its key and no balance is invented',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());
  let opening=f.app.startOpen();const first=f.calls.at(-1).body.key;await f.reply({error:'Недостаточно Noct Stars',code:'insufficient_balance'},402);await opening;
  assert.equal(f.app.state.gameRetry,false);assert.match(f.app.state.gameError,/Недостаточно/);assert.equal(f.storage.size,0);assert.equal(f.app.state.balance,500);
  opening=f.app.startOpen();const body=f.calls.at(-1).body;assert.notEqual(body.key,first);await f.reply({error:'Попробуйте позже'},429);await opening;
  assert.equal(f.app.state.gameRetry,true);opening=f.app.retryGame();assert.equal(f.calls.at(-1).body.key,body.key);await f.reply(caseResult(body));await opening;
});
void test('a response from a pre-debit account refresh cannot overwrite the committed balance or gift',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());
  const refresh=f.app.refreshAccount(),opening=f.app.startOpen(),body=f.calls.at(-1).body;
  await f.replyAt(1,caseResult(body));await opening;assert.equal(f.app.state.balance,180);
  await f.reply(linked({balance:500,gifts:[ownedGift('canonical-1')]}));await refresh;
  assert.equal(f.app.state.balance,180);assert.ok(f.app.state.sharedGifts.some(g=>g.id==='won-1'));
});
void test('same-owner refresh preserves upgrade selections and any ordinary canonical gift is a valid source',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());
  f.app.setState({screen:'upgrade',fromUid:'canonical-1',fromId:'toy_bear',toId:'watch'});
  const refresh=f.app.refreshAccount();await f.reply(linked());await refresh;
  assert.equal(f.app.state.fromUid,'canonical-1');assert.equal(f.app.state.toId,'watch');
  assert.equal(f.app.chanceOf(),9);assert.match(f.app.renderVals().ctaNoteText,/Noct Stars не списываются/);
  const before=plain(f.app.state.sharedGifts),upgrade=f.app.runUpgrade(),body=f.calls.at(-1).body;
  assert.equal(body.receiptId,'canonical-1');assert.equal(body.targetGiftId,'swiss_watch');assert.equal(body.version,games.version);
  assert.deepEqual(plain(f.app.state.sharedGifts),before);assert.equal(f.app.state.balance,500);
  await f.reply(upgradeResult(body));await upgrade;
  assert.equal(f.app.state.balance,500);assert.ok(!f.app.state.sharedGifts.some(g=>g.id==='canonical-1'));assert.ok(f.app.state.sharedGifts.some(g=>g.id==='upgraded-1'));
  assert.equal(f.app.state.upPhase,'pending');assert.equal(f.app.state.dialRoll,2);await f.tick(3600);assert.equal(f.app.state.upPhase,'success');
});
for(const success of [true,false]) void test(`zero-balance upgrade is enabled and ${success?'success':'failure'} never presents a Star charge`,async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked({balance:0}));
  f.app.setState({screen:'upgrade',fromUid:'canonical-1',fromId:'toy_bear',toId:'watch'});
  const view=f.app.renderVals();assert.equal(view.ctaDisabled,false);assert.match(view.ctaNoteText,/Noct Stars не списываются/);
  const upgrading=view.ctaAction(),body=f.calls.at(-1).body;
  assert.equal('price' in body,false);assert.equal('fee' in body,false);
  await f.reply(upgradeResult(body,{success,balance:0}));await upgrading;await f.tick(3600);
  assert.equal(f.app.state.balance,0);assert.equal(f.app.state.upPhase,success?'success':'fail');
  assert.match(f.app.renderVals().resultText,/Noct Stars не списаны/);
  assert.ok(!f.app.state.sharedGifts.some(g=>g.id==='canonical-1'));
});

void test('a failed server upgrade consumes just its source; collectible gifts cannot be submitted',async t=>{
  const f=fixture();t.after(()=>f.dispose());const collectible=ownedGift('collectible-1',{collectible:{family:'bear',number:7}});
  await f.reply(linked({gifts:[ownedGift('canonical-1'),ownedGift('same-kind-other-receipt'),collectible]}));
  f.app.setState({screen:'upgrade',fromUid:collectible.id,fromId:collectible.giftId,toId:'watch'});f.app.runUpgrade();assert.equal(f.calls.length,1);
  f.app.setState({fromUid:'canonical-1'});const upgrade=f.app.runUpgrade(),body=f.calls.at(-1).body;await f.reply(upgradeResult(body,{success:false}));await upgrade;
  assert.deepEqual(plain(f.app.state.sharedGifts.map(g=>g.id)),['same-kind-other-receipt','collectible-1']);assert.equal(f.app.state.balance,500);
  await f.tick(3600);assert.equal(f.app.state.upPhase,'fail');assert.match(f.app.renderVals().dialAccessible,/не удался/);
});
void test('retrying a historical result does not resurrect a gift already consumed elsewhere',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());
  let opening=f.app.startOpen();const body=f.calls.at(-1).body;await f.reject();await opening;
  opening=f.app.retryGame();await f.reply(caseResult(body,{available:false,balance:400}));await opening;
  assert.ok(!f.app.state.sharedGifts.some(g=>g.id==='won-1'));assert.equal(f.app.state.balance,400);f.app.finishOpen();assert.match(f.app.renderVals().reelStatus,/использован/);
});
void test('auth failure clears private state but retains the unresolved key for reauthentication',async t=>{
  const storage=new Map(),f=fixture({storage});await f.reply(linked());const opening=f.app.startOpen(),body=f.calls.at(-1).body;
  await f.reply({error:'Expired'},401);await opening;assert.equal(f.app.state.balance,0);assert.equal(f.app.state.sharedGifts.length,0);assert.equal(f.app.state.accountMode,'error');assert.equal(storage.size,1);
  f.dispose();const reopened=fixture({storage});t.after(()=>reopened.dispose());await reopened.reply(linked());const retry=reopened.app.retryGame();assert.equal(reopened.calls.at(-1).body.key,body.key);await reopened.reply(caseResult(body));await retry;
});
void test('another linked owner cannot resume or display a former owner unresolved request',async t=>{
  const storage=new Map(),f=fixture({storage});await f.reply(linked());const opening=f.app.startOpen();await f.reject();await opening;f.dispose();
  const other=fixture({storage});t.after(()=>other.dispose());await other.reply(linked({user:{id:'bob',name:'Bob'},balance:90,gifts:[]}));
  assert.equal(other.app.state.gameRetry,false);other.app.retryGame();assert.equal(other.calls.length,1);assert.equal(other.app.state.sharedGifts.length,0);assert.equal(other.app.state.balance,90);
});
void test('a disconnected component ignores a late committed response while preserving its request for recovery',async()=>{
  const f=fixture();await f.reply(linked());const opening=f.app.startOpen(),body=f.calls.at(-1).body;f.dispose();const before=plain(f.app.state);await f.reply(caseResult(body));await opening;assert.deepEqual(plain(f.app.state),before);assert.equal(f.storage.size,1);
});
void test('an unknown upgrade retains the exact source and target on retry without prematurely consuming the source',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked({gifts:[ownedGift('canonical-1'),ownedGift('another-source')]}));
  f.app.setState({screen:'upgrade',fromUid:'canonical-1',fromId:'toy_bear',toId:'watch'});
  let upgrading=f.app.runUpgrade();const original=plain(f.calls.at(-1).body);await f.reject();await upgrading;
  assert.ok(f.app.state.sharedGifts.some(g=>g.id==='canonical-1'));assert.equal(f.app.state.balance,500);
  f.app.setState({fromUid:'another-source',toId:'orb'});f.app.runUpgrade();assert.equal(f.calls.filter(c=>c.url.endsWith('/upgrade')).length,1);
  upgrading=f.app.retryGame();assert.deepEqual(plain(f.calls.at(-1).body),original);await f.reply(upgradeResult(original));await upgrading;
  assert.ok(!f.app.state.sharedGifts.some(g=>g.id==='canonical-1'));assert.ok(f.app.state.sharedGifts.some(g=>g.id==='another-source'));
});
void test('a game response for another verified owner clears stale private UI instead of attaching the result',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.reply(linked());const opening=f.app.startOpen(),body=f.calls.at(-1).body;
  await f.reply(caseResult(body,{userId:'bob'}));await opening;
  assert.equal(f.app.state.shared,null);assert.equal(f.app.state.sharedGifts.length,0);assert.equal(f.app.state.balance,0);assert.equal(f.app.state.accountMode,'error');assert.equal(f.storage.size,1);
});
void test('failure to durably save an operation prevents sending a paid request',async t=>{
  const storage=new Map();storage.set=()=>{throw Error('Storage unavailable');};const f=fixture({storage});t.after(()=>f.dispose());await f.reply(linked());
  f.app.startOpen();assert.equal(f.calls.length,1);assert.equal(f.app.state.balance,500);assert.match(f.app.state.gameError,/сохранить запрос/);
});

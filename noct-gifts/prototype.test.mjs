import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const html=await readFile(new URL('./Noct Gifts App.dc.html',import.meta.url),'utf8');
const script=html.match(/<script\b(?=[^>]*\bdata-dc-script\b)[^>]*>([\s\S]*?)<\/script>/i)[1];
const plain=value=>JSON.parse(JSON.stringify(value));
const games={version:'test-catalog',cases:[{id:'eclipse',n:'Затмение',p:320,items:[['orb',50],['watch',50]]}],gifts:{orb:{giftId:'crystal_ball',name:'Хрустальный шар',price:100,color:'#C7ACE8',rarity:'rare',imageUrl:'/assets/gifts/crystal_ball.webp',animationUrl:'/assets/gifts/crystal_ball.json'},watch:{giftId:'swiss_watch',name:'Часы',price:250,color:'#FFD36A',rarity:'rare',imageUrl:'/assets/gifts/swiss_watch.webp',animationUrl:'/assets/gifts/swiss_watch.json'}},upgrade:{feePercent:0,chancePercent:110,minChance:3,maxChance:95}};
const source={id:'receipt-source',giftId:'ordinary_bear',name:'Мишка',price:25,color:'#daa27a',image:'/assets/gifts/toy_bear.webp',animation:'/assets/gifts/toy_bear.json',collectible:null};
const gift={id:'receipt-won',giftId:'crystal_ball',name:'Хрустальный шар',price:100,image:'/assets/gifts/crystal_ball.webp',animation:'/assets/gifts/crystal_ball.json',collectible:null};
const caseOp=(id='case-1')=>({id,kind:'case',caseId:'eclipse',giftAlias:'orb',success:true,price:320});
const upgradeOp=success=>({id:'upgrade-1',kind:'upgrade',sourceReceiptId:source.id,targetGiftId:'swiss_watch',success,roll:success?2:80,chance:9,price:0});
function fixture({reduced=false,linked=true,search=''}={}){
  let now=1000000,id=0;const jobs=new Map(),listeners=new Set();
  const schedule=(fn,ms=0)=>{const token=++id;jobs.set(token,{fn,at:now+ms});return token;};
  class ClockDate extends Date{static now(){return now;}}
  class DCLogic{constructor(props){this.props=props;}setState(patch,cb){this.state={...this.state,...(typeof patch==='function'?patch(this.state):patch)};cb?.();}}
  const media={matches:reduced,addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn)};
  const math=Object.create(Math);math.random=()=>{throw Error('Presentation must never draw a financial outcome');};
  const context=vm.createContext({DCLogic,React:{createRef:()=>({current:null})},window:{location:{search},matchMedia:()=>media,NoctAccount:{asset:url=>url||'',connect:()=>null}},Math:math,Date:ClockDate,URLSearchParams,console,setTimeout:schedule,clearTimeout:token=>jobs.delete(token),requestAnimationFrame:fn=>schedule(fn,16),cancelAnimationFrame:token=>jobs.delete(token)});
  vm.runInContext(script+';globalThis.App=Component;',context);const app=new context.App({variant:'open-result'});app.componentDidMount();
  if(linked)app.setState({accountMode:'linked',shared:{user:{id:'owner',name:'Имя'},capabilities:{caseOpening:true,upgrading:true},history:[],catalog:{products:[]}},games,balance:500,sharedGifts:[source],fromId:source.giftId,fromUid:source.id,toId:'watch'});
  return {app,tick(ms){const end=now+ms;let count=0;for(;;){const next=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert.ok(++count<1000);jobs.delete(next[0]);now=next[1].at;next[1].fn(now);}now=end;},setReduced(value){media.matches=value;for(const fn of listeners)fn({matches:value});},dispose(){app.componentWillUnmount();},jobs,listeners};
}

void test('unauthenticated startup ignores preview parameters and never presents a fictional balance or prize',()=>{
  const f=fixture({linked:false,search:'?view=open-result'}),{app}=f;
  assert.equal(app.state.balance,0);assert.deepEqual(plain(app.state.sharedGifts),[]);assert.equal(app.state.prizeGift,null);
  assert.equal(app.renderVals().needsAuth,true);assert.equal(app.renderVals().balanceFmt,'—');assert.equal(app.renderVals().isOpen,false);assert.equal(app.renderVals().isProfile,false);f.dispose();
});
void test('public actions delegate to the authenticated bridge and do not write balances or receipts',()=>{
  const f=fixture(),{app}=f;let opens=0,upgrades=0,payments=0;
  app.openSharedCase=()=>opens++;app.upgradeSharedGift=()=>upgrades++;app.payShared=()=>payments++;
  const before=plain({balance:app.state.balance,gifts:app.state.sharedGifts});app.startOpen();app.runUpgrade();app.confirmPay();
  assert.deepEqual([opens,upgrades,payments],[1,1,1]);assert.deepEqual(plain({balance:app.state.balance,gifts:app.state.sharedGifts}),before);f.dispose();
});
void test('case animation reveals the server receipt and cannot award, renumber or debit it',()=>{
  const f=fixture(),{app}=f,before=plain({balance:app.state.balance,gifts:app.state.sharedGifts});
  app.revealCaseResult(caseOp(),gift);assert.equal(app.state.phase,'spin');assert.equal(app.state.reel[34],'orb');assert.equal(app.state.prizeUid,gift.id);assert.equal(app.state.prizeNum,'');
  f.tick(4800);assert.equal(app.state.phase,'result');assert.equal(app.renderVals().prize.n,'Хрустальный шар');app.finishOpen();
  assert.deepEqual(plain({balance:app.state.balance,gifts:app.state.sharedGifts}),before);f.dispose();
});
void test('skip followed by another server result isolates old reveal timers',()=>{
  const f=fixture(),{app}=f;app.revealCaseResult(caseOp(),gift);f.tick(1000);app.renderVals().skip();
  app.revealCaseResult(caseOp('case-2'),{...gift,id:'next-receipt'});f.tick(3800);assert.equal(app.state.phase,'spin');assert.equal(app.state.prizeUid,'next-receipt');f.tick(1000);assert.equal(app.state.phase,'result');f.dispose();
});
void test('fast cases reveal immediately while upgrade duration and outcome stay server-controlled',()=>{
  const f=fixture(),{app}=f;app.renderVals().toggleReduced();app.revealCaseResult(caseOp(),gift);assert.equal(app.state.phase,'result');
  app.revealUpgradeResult(upgradeOp(true),gift,source);f.tick(3599);assert.equal(app.state.upPhase,'pending');assert.equal(app.state.dialRoll,2);assert.equal(app.state.dialChance,9);f.tick(1);assert.equal(app.state.upPhase,'success');f.dispose();
});
void test('successful reveal announces the result and celebrates once, without replay on navigation',()=>{
  const f=fixture(),{app}=f;let bursts=0;app.dialRef.current={closest:()=>null,querySelector:()=>({play(){bursts++;}})};
  app.revealUpgradeResult(upgradeOp(true),gift,source);f.tick(3599);assert.equal(bursts,0);assert.equal(app.renderVals().dialShowChance,true);f.tick(17);
  assert.equal(bursts,1);assert.equal(app.renderVals().dialShowChance,false);assert.match(app.renderVals().dialAccessible,/Апгрейд удался/);assert.match(app.renderVals().dialAnnouncement,/коллекции/);
  app.finishUpgrade();app.renderVals().goProfile();app.renderVals().goUpgrade();f.tick(1000);assert.equal(bursts,1);f.dispose();
});
void test('failure, reduced motion and navigation suppress confetti but preserve the committed outcome',()=>{
  for(const scenario of ['failure','reduced','away','leave-before-paint','reduce-before-paint']){
    const f=fixture({reduced:scenario==='reduced'}),{app}=f;let bursts=0;app.dialRef.current={closest:()=>null,querySelector:()=>({play(){bursts++;}})};
    app.revealUpgradeResult(upgradeOp(scenario!=='failure'),scenario==='failure'?null:gift,source);
    if(scenario==='away')app.renderVals().goProfile();f.tick(3600);
    if(scenario==='leave-before-paint')app.renderVals().goProfile();if(scenario==='reduce-before-paint')f.setReduced(true);f.tick(1000);
    assert.equal(bursts,0,scenario);assert.equal(app.renderVals().dialFinished,true);assert.match(app.renderVals().dialAccessible,scenario==='failure'?/не удался/:/удался/);
    app.renderVals().goUpgrade();f.setReduced(false);app.finishUpgrade();f.tick(1000);assert.equal(bursts,0);f.dispose();
  }
});
void test('repeat rejects an old receipt handler and a double click after instant server reveal',()=>{
  const f=fixture(),{app}=f;let opens=0;app.openSharedCase=()=>opens++;
  app.renderVals().toggleReduced();app.revealCaseResult(caseOp(),gift);const old=app.renderVals().repeatCase;
  old({detail:1});assert.equal(opens,1);app.revealCaseResult(caseOp('case-2'),{...gift,id:'next-receipt'});old({detail:1});app.renderVals().repeatCase({detail:2});assert.equal(opens,1);
  app.renderVals().repeatCase({detail:1});assert.equal(opens,2);f.dispose();
});
void test('a source outside the case catalog uses its canonical price and source receipt identity',()=>{
  const f=fixture(),{app}=f;assert.equal(app.chanceOf(),11);app.setState({screen:'upgrade',balance:0});assert.equal(app.renderVals().ctaDisabled,false);assert.match(app.renderVals().ctaNoteText,/Noct Stars не списываются/);assert.equal(app.renderVals().fromGift.n,'Мишка');
  app.renderVals().pickFrom();const choices=app.renderVals().pickList;assert.equal(choices.length,1);choices[0].choose();assert.equal(app.state.fromUid,source.id);
  app.setState({gamePending:true});const before=app.state.toId;app.renderVals().pickTo();assert.equal(app.state.toId,before);f.dispose();
});
void test('system reduced motion settles visual operations, without touching the committed wallet',()=>{
  const f=fixture(),{app}=f,before=plain({balance:app.state.balance,gifts:app.state.sharedGifts});app.revealUpgradeResult(upgradeOp(true),gift,source);f.setReduced(true);
  assert.equal(app.state.upPhase,'success');assert.equal(app.state.caseFast,false);f.tick(5000);assert.deepEqual(plain({balance:app.state.balance,gifts:app.state.sharedGifts}),before);f.dispose();
});
void test('unmount clears operation reveal timers and preference listeners',()=>{
  const f=fixture();f.app.revealCaseResult(caseOp(),gift);f.tick(16);f.dispose();assert.equal(f.jobs.size,0);assert.equal(f.listeners.size,0);
});

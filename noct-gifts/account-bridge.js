/* Telegram authentication and authoritative NoctGram operations. No local awards. */
(() => {
  const telegram=window.Telegram?.WebApp, inTelegram=!!telegram?.initData;
  const friendlyError=status=>status===401?'Вход истёк. Откройте мини-апп заново.':status===403?'Доступ к аккаунту ограничен.':'Не удалось связаться с NoctGram. Попробуйте ещё раз.';
  const assetPrefix=window.NoctGiftsConfig?.directAssets===true?'/assets/':'/noctgram-assets/';
  function asset(url) {try{const p=new URL(url,location.origin);if(p.pathname.startsWith('/assets/')&&!p.pathname.includes('..'))return assetPrefix+p.pathname.slice(8);}catch{}return '';}
  const normalizeGift=gift=>({...gift,image:asset(gift.imageUrl)||'assets/noctgram-logo.png',animation:asset(gift.animationUrl)});
  async function request(route,body={}) {
    if(!inTelegram)throw Error('Откройте Noct Gifts в Telegram.');
    const r=await fetch('/api/noct-gifts/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,initData:telegram.initData}),signal:AbortSignal.timeout(15000),cache:'no-store',credentials:'omit'});
    const data=await r.json().catch(()=>null);
    if(!r.ok){const e=Error(r.status===401||r.status===403?friendlyError(r.status):typeof data?.error==='string'?data.error:friendlyError(r.status));e.status=r.status;e.code=data?.code;throw e;}
    if(!data||typeof data!=='object')throw Error('Не удалось проверить ответ NoctGram. Повторите проверку.');
    return data;
  }
  function connect(app) {
    if(!inTelegram){app.setState({accountMode:'telegram',balance:0,sharedGifts:[],inv:[]});return ()=>{};}
    telegram.ready();telegram.expand?.();telegram.setHeaderColor?.('#000000');telegram.setBackgroundColor?.('#000000');
    let alive=true,epoch=0,refreshing=false,gameWorking=false,timer=null,intent=null;
    let avatarEpoch=0,avatarKey='',avatarObjectUrl='';
    const clearAvatar=()=>{avatarEpoch++;avatarKey='';if(avatarObjectUrl)URL.revokeObjectURL(avatarObjectUrl);avatarObjectUrl='';app.setState({profileAvatar:''});};
    const loadAvatar=data=>{
      const value=data.user.avatar;
      let source;
      try{if(!value)throw Error();source=new URL(value,data.links?.siteUrl||location.origin);if(source.username||source.password||!(source.protocol==='https:'||(source.protocol==='http:'&&source.origin===location.origin)))throw Error();}catch{clearAvatar();return;}
      const key=data.user.id+' '+source.href;
      if(avatarKey===key)return;
      clearAvatar();avatarKey=key;
      if(!/^\/api\/media\/[a-zA-Z0-9_-]+$/.test(source.pathname)){app.setState({profileAvatar:source.href});return;}
      const token=avatarEpoch;
      void (async()=>{
        try{
          const response=await fetch('/api/noct-gifts/avatar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:telegram.initData}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
          if(!response.ok||!/^image\/(?:png|jpeg|webp|gif|avif)(?:;|$)/i.test(response.headers.get('Content-Type')||''))throw Error();
          const blob=await response.blob();
          if(!alive||token!==avatarEpoch)return;
          if(!blob.size||blob.size>16*1024*1024)throw Error();
          avatarObjectUrl=URL.createObjectURL(blob);app.setState({profileAvatar:avatarObjectUrl});
        }catch{if(alive&&token===avatarEpoch)avatarKey='';}
      })();
    };
    const storageKey=owner=>'noct-gifts-operation-v1:'+owner;
    const saved=owner=>{try{const p=JSON.parse(sessionStorage.getItem(storageKey(owner)));return p?.owner===owner&&['case','upgrade'].includes(p.kind)&&typeof p.body?.key==='string'?p:null;}catch{return null;}};
    const storeIntent=value=>{try{sessionStorage.setItem(storageKey(value.owner),JSON.stringify(value));}catch{throw Error('Не удалось сохранить запрос. Разрешите хранилище мини-аппа и повторите.');}};
    const forgetIntent=value=>{try{sessionStorage.removeItem(storageKey(value.owner));}catch{}if(intent===value)intent=null;};
    app.accountState={key:null,sku:null};
    const clearAccount=(mode,links=null,error=null)=>{
      clearAvatar();
      epoch++;intent=null;app.accountState={key:null,sku:null};app.openOp=null;app.upgradeOp=null;
      app.setState({accountMode:mode,shared:null,sharedGifts:[],sharedNext:null,sharedGift:null,balance:0,inv:[],games:null,fromId:null,toId:null,fromUid:null,
        screen:'profile',phase:'idle',upPhase:'select',gamePending:false,gameRetry:false,gameError:null,gameResult:null,prizeGift:null,upgradeSource:null,
        sheet:null,payPhase:'idle',acceptedTerms:false,accountError:error,sharedLinks:links,celebration:0,toast:null});
    };
    const applyAccount=(data,append)=>{
      const same=app.state.shared?.user?.id===data.user.id&&app.state.accountMode==='linked';
      const seen=new Map((append&&same?app.state.sharedGifts:[]).map(g=>[g.id,g]));
      for(const gift of data.gifts)seen.set(gift.id,normalizeGift(gift));
      const patch={accountMode:'linked',accountError:null,shared:data,games:data.games||null,sharedGifts:[...seen.values()],sharedNext:data.next,sharedLinks:data.links,balance:data.balance};
      if(!same){
        app.openOp=null;app.upgradeOp=null;app.accountState={key:null,sku:null};intent=saved(data.user.id);
        Object.assign(patch,{screen:'cases',phase:'idle',upPhase:'select',fromId:null,toId:null,fromUid:null,upgradeSource:null,prizeGift:null,gameResult:null,sheet:null,sharedGift:null,
          pack:0,payPhase:'idle',acceptedTerms:false,celebration:0,toast:null,gamePending:false,gameRetry:!!intent,gameError:intent?'Остался незавершённый запрос. Проверьте его результат перед новой попыткой.':null});
      }
      app.setState(patch);
      loadAvatar(data);
    };
    const refresh=async(append=false)=>{
      if(refreshing||gameWorking||!alive)return;
      refreshing=true;const token=++epoch;
      try{
        let data=await request('account',append?{before:app.state.sharedNext}:{});
        if(!alive||token!==epoch)return;
        if(data.status!=='linked'){clearAccount('unlinked',data.links);return;}
        if(append&&app.state.shared?.user?.id!==data.user.id){data=await request('account');append=false;if(!alive||token!==epoch)return;if(data.status!=='linked'){clearAccount('unlinked',data.links);return;}}
        applyAccount(data,append);
      }catch(error){if(alive&&token===epoch){if(error.status===401||error.status===403)clearAccount('error',null,error.message);else app.setState({accountError:error.message,accountMode:app.state.accountMode==='linked'?'linked':'error'});}}
      finally{refreshing=false;}
    };
    app.refreshAccount=refresh;
    const runIntent=async value=>{
      if(!alive||gameWorking||app.state.accountMode!=='linked'||app.state.shared?.user?.id!==value.owner)return;
      gameWorking=true;epoch++;const owner=value.owner;
      app.setState({gamePending:true,gameRetry:false,gameError:null});
      try{
        const data=await request(value.kind,value.body);
        if(!alive||app.state.accountMode!=='linked'||app.state.shared?.user?.id!==owner)return;
        if(data.userId!==owner){clearAccount('error',null,'Аккаунт изменился. Обновите подключение к NoctGram.');return;}
        if(data.operation?.key!==value.body.key||data.operation?.kind!==value.kind||!Number.isSafeInteger(data.balance)||data.balance<0)throw Error('Не удалось подтвердить результат. Повторите проверку этого запроса.');
        const op=data.operation;
        if(value.kind==='case'&&(op.caseId!==value.body.caseId||!op.success||!data.gift))throw Error('Не удалось подтвердить выпавший подарок. Повторите проверку.');
        if(value.kind==='upgrade'&&(op.sourceReceiptId!==value.body.receiptId||op.targetGiftId!==value.body.targetGiftId||typeof op.success!=='boolean'||!Number.isFinite(op.roll)||!Number.isFinite(op.chance)||(op.success&&!data.gift)))throw Error('Не удалось подтвердить апгрейд. Повторите проверку.');
        if(data.gift&&(typeof data.gift.id!=='string'||typeof data.gift.giftId!=='string'||typeof data.gift.name!=='string'))throw Error('Не удалось проверить подарок. Повторите проверку результата.');
        const gift=data.gift?normalizeGift(data.gift):null;
        const seen=new Map(app.state.sharedGifts.map(g=>[g.id,g]));
        if(value.kind==='upgrade')seen.delete(op.sourceReceiptId);
        if(gift&&gift.available!==false)seen.set(gift.id,gift);
        if(gift?.available===false)seen.delete(gift.id);
        app.setState({balance:data.balance,sharedGifts:[...seen.values()],shared:{...app.state.shared,balance:data.balance},gamePending:false,gameRetry:false,gameError:null,gameResult:op});
        forgetIntent(value);
        if(value.kind==='case')app.revealCaseResult(op,gift);
        else app.revealUpgradeResult(op,gift,value.source);
      }catch(error){
        if(!alive||app.state.shared?.user?.id!==owner)return;
        if(error.status===401||error.status===403){clearAccount('error',null,error.message);return;}
        const definite=error.status>=400&&error.status<500&&error.status!==429;
        if(definite)forgetIntent(value);
        app.setState({gamePending:false,gameRetry:!definite,gameError:definite?error.message:error.message+(value.kind==='upgrade'?' Подарок мог быть использован — проверка повторяет тот же запрос.':' Списание могло пройти — проверка повторяет тот же запрос.')});
      }finally{gameWorking=false;}
    };
    const begin=(kind,body,source=null)=>{
      if(app.state.accountMode!=='linked'){app.setState({gameError:'Сначала подключите аккаунт NoctGram.'});return;}
      if(gameWorking||app.openOp||app.upgradeOp)return;
      if(intent){app.setState({gameRetry:true,gameError:'Сначала проверьте результат предыдущего запроса.'});return;}
      const owner=app.state.shared.user.id,value={owner,kind,body:{...body,version:app.state.games?.version,key:crypto.randomUUID()},source};
      try{storeIntent(value);}catch(error){app.setState({gameError:error.message});return;}
      intent=value;return runIntent(value);
    };
    app.openSharedCase=()=>{
      const c=app.caseOf(app.state.caseId);
      if(!app.state.shared?.capabilities?.caseOpening||!c.id){app.setState({gameError:'Открытие кейсов сейчас недоступно.'});return;}
      return begin('case',{caseId:c.id});
    };
    app.upgradeSharedGift=()=>{
      const source=app.state.sharedGifts.find(g=>g.id===app.state.fromUid),target=app.gameGifts()[app.state.toId];
      if(!app.state.shared?.capabilities?.upgrading){app.setState({gameError:'Апгрейд сейчас недоступен.'});return;}
      if(!source||source.collectible||!target||target.v<=source.price){app.setState({gameError:'Выберите обычный подарок и более дорогую цель.'});return;}
      return begin('upgrade',{receiptId:source.id,targetGiftId:target.giftId},source);
    };
    app.retryGame=()=>{if(intent)return runIntent(intent);};
    app.payShared=async()=>{
      if(app.state.payPhase==='pending')return;
      if(app.state.accountMode!=='linked'){app.setState({toast:'Сначала привяжите Telegram к аккаунту NoctGram.'});return;}
      if(!app.state.acceptedTerms){app.setState({toast:'Подтвердите условия покупки.'});return;}
      const product=app.state.shared?.catalog?.products?.[app.state.pack],payer=app.state.shared?.user?.id;
      if(!product||!app.state.shared.catalog.telegram){app.setState({toast:'Пополнение сейчас недоступно.'});return;}
      if(app.accountState.sku!==product.id)app.accountState={sku:product.id,key:crypto.randomUUID()};
      app.setState({payPhase:'pending'});
      try{
        const order=await request('topup',{sku:product.id,key:app.accountState.key,acceptedTerms:true});
        if(!alive||app.state.accountMode!=='linked'||app.state.shared?.user?.id!==payer)return;
        const url=new URL(order.checkoutUrl);if(url.protocol!=='https:'||url.hostname!=='t.me')throw Error('Не удалось открыть оплату.');
        telegram.openTelegramLink(url.href);app.setState({payPhase:'idle',sheet:null,acceptedTerms:false,toast:'Завершите оплату в боте. Баланс обновится после подтверждения.'});app.accountState={sku:null,key:null};
        app.later(()=>{if(alive)app.setState({toast:null});},5000);
        let tries=0;const poll=async()=>{if(!alive)return;await refresh();if(++tries<12)timer=setTimeout(poll,5000);};clearTimeout(timer);timer=setTimeout(poll,3000);
      }catch(error){if(alive&&app.state.shared?.user?.id===payer){if(error.status===401||error.status===403)clearAccount('error',null,error.message);else app.setState({payPhase:'error',toast:error.message});}}
    };
    const visible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visible);void refresh();
    return ()=>{alive=false;epoch++;avatarEpoch++;if(avatarObjectUrl)URL.revokeObjectURL(avatarObjectUrl);avatarObjectUrl='';clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  }
  window.NoctAccount={inTelegram,connect,asset,openTelegram(){const url='https://t.me/noctgramdrop_bot';if(telegram?.openTelegramLink)telegram.openTelegramLink(url);else window.open(url,'_blank','noopener,noreferrer');},openLink(url){try{const u=new URL(url);if(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))){if(telegram?.openLink)telegram.openLink(u.href);else window.open(u.href,'_blank','noopener,noreferrer');}}catch{}}};
})();

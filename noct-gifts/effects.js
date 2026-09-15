/* NoctGram's StarScene motion + transitions.dev number-pop-in/modal timing.
   Local Lottie gift assets. No account data or credentials are kept here. */
(() => {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const players = new Set();
  const cache = new Map();
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) { entry.target.visible = entry.isIntersecting; }
    schedulePlayers();
  }, { threshold: .2 });
  function schedulePlayers() {
    let slots = 4;
    for (const gift of [...players].sort((a,b)=>Number(!!b.closest('.ng-sheet'))-Number(!!a.closest('.ng-sheet')))) {
      const active = gift.visible && !document.hidden && !media.matches && slots-- > 0;
      if (active) gift.loadPlayer();
      if (gift.player) { if (active) gift.player.play(); else gift.player.pause(); }
    }
  }
  class GiftMotion extends HTMLElement {
    static get observedAttributes() { return ['data-src']; }
    connectedCallback() {
      this.style.display = 'block';
      players.add(this); intersection.observe(this);
      this.addEventListener('pointerenter', this.replay);
    }
    disconnectedCallback() {
      intersection.unobserve(this); players.delete(this);
      this.removeEventListener('pointerenter', this.replay);
      this.dispose(); schedulePlayers();
    }
    attributeChangedCallback() { this.dispose(); if (this.isConnected) schedulePlayers(); }
    replay = () => { if (!media.matches && this.player && this.visible) this.player.goToAndPlay(0,true); };
    dispose() {
      this.removeAttribute('data-ready');
      this.generation = (this.generation || 0) + 1;
      this.player?.destroy(); this.player = null; this.loading = false;
      this.host?.remove(); this.host = null;
    }
    async loadPlayer() {
      if (this.player || this.loading || !window.lottie) return;
      const src = this.getAttribute('data-src');
      if (!/^(?:assets\/gifts\/[a-z_]+\.json|\/noctgram-assets\/gifts\/[a-zA-Z0-9_-]+\.(?:json|tgs))$/.test(src || '')) return;
      this.loading = true;
      const generation = this.generation;
      try {
        if (!cache.has(src)) cache.set(src, fetch(src).then(async r => {
          if (!r.ok) throw Error('Gift animation unavailable');
          if (!src.endsWith('.tgs')) return r.json();
          const bytes=await r.arrayBuffer();
          return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
        }));
        const data = await cache.get(src);
        if (!this.isConnected || generation !== this.generation) return;
        const host = document.createElement('span');
        host.style.cssText = 'position:absolute;inset:0;display:block;opacity:0;transition:opacity 180ms';
        this.append(host); this.host = host;
        this.player = lottie.loadAnimation({container:host, renderer:'svg',loop:true,autoplay:false,animationData:JSON.parse(JSON.stringify(data)),rendererSettings:{progressiveLoad:true}});
        this.player.setSubframe(false);
        this.player.addEventListener('DOMLoaded', () => {
          if (!this.isConnected || generation !== this.generation) return;
          this.style.backgroundImage='none'; host.style.opacity='1'; this.setAttribute('data-ready','true'); schedulePlayers();
        });
      } catch { cache.delete(src); /* Static WebP remains available. */ }
      finally { if (generation === this.generation) this.loading = false; }
    }
  }
  customElements.define('ng-gift-motion', GiftMotion);
  media.addEventListener('change', schedulePlayers);
  document.addEventListener('visibilitychange', schedulePlayers);

  // Original particle implementation, visually inspired by transitions.dev's
  // Confetti burst preview. Completion triggers it once; mounting never does.
  class UpgradeBurst extends HTMLElement {
    connectedCallback() {
      this.stopOnPreference = () => { if (media.matches || document.hidden) this.stop(); };
      media.addEventListener('change', this.stopOnPreference);
      document.addEventListener('visibilitychange', this.stopOnPreference);
    }
    disconnectedCallback() {
      this.stop();
      media.removeEventListener('change', this.stopOnPreference);
      document.removeEventListener('visibilitychange', this.stopOnPreference);
    }
    stop() {
      cancelAnimationFrame(this.frame || 0); this.frame = 0;
      this.canvas?.remove(); this.canvas = null;
    }
    play() {
      this.stop();
      if (!this.isConnected || media.matches || document.hidden) return;
      const { width, height } = this.getBoundingClientRect();
      if (!width || !height) return;
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(width * dpr); canvas.height = Math.ceil(height * dpr);
      ctx.scale(dpr, dpr); this.append(canvas); this.canvas = canvas;
      const colors = ['#c7ace8','#e6d6fa','#b2dfce','#ffd36a','#f7f0ff'];
      // Low-discrepancy cosmetic variation keeps outcome RNG completely separate.
      const frac = value => value - Math.floor(value);
      const particles = Array.from({length:42}, (_, i) => {
        const a=frac((i+1)*.618034), b=frac((i+1)*.414214), side=i%2 ? 1 : -1;
        return {x:width/2+side*42,y:55+(height-145)*.4,
          vx:side*(26+a*88),vy:-100-b*110,delay:(i%7)*.018,
          rotation:a*Math.PI*2,spin:(b-.5)*10,size:3+a*3,color:colors[i%colors.length],round:i%5===0};
      });
      const started=performance.now();
      const draw = now => {
        if (!this.isConnected || media.matches || document.hidden) { this.stop(); return; }
        const elapsed=(now-started)/1000;
        if (elapsed>=2.1) { this.stop(); return; }
        ctx.clearRect(0,0,width,height);
        for (const p of particles) {
          const t=elapsed-p.delay; if(t<0) continue;
          const x=p.x+p.vx*(1-Math.exp(-t*1.25))/1.25;
          const y=p.y+p.vy*t+125*t*t;
          ctx.save(); ctx.globalAlpha=Math.min(1,t/.06)*Math.max(0,Math.min(1,(2-t)/.55));
          ctx.translate(x,y); ctx.rotate(p.rotation+p.spin*t);
          ctx.scale(1,Math.max(.18,Math.abs(Math.cos(t*7+p.rotation))));
          ctx.fillStyle=p.color;
          if(p.round){ctx.beginPath();ctx.arc(0,0,p.size/2,0,Math.PI*2);ctx.fill();}
          else ctx.fillRect(-p.size/2,-p.size*.35,p.size,p.size*.7);
          ctx.restore();
        }
        this.frame=requestAnimationFrame(draw);
      };
      this.frame=requestAnimationFrame(draw);
    }
  }
  customElements.define('ng-upgrade-burst', UpgradeBurst);

  document.addEventListener('click', event => {
    const scene = event.target.closest?.('[data-star-scene]');
    if (scene && !media.matches) {
      scene.querySelectorAll('.ng-star-particle').forEach(p => p.getAnimations().forEach(a => { a.currentTime=0; }));
      scene.querySelector('.ng-star-float')?.animate([
        {scale:'.92'}, {scale:'1.08',offset:.4}, {scale:'1'}
      ],{duration:520,easing:'cubic-bezier(.22,1,.36,1)'});
    }
  });
  // Balance updates are observed, not changed: financial state belongs to the app/server.
  const values = new WeakMap();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued=true;
    requestAnimationFrame(() => {
      queued=false;
      document.querySelectorAll('[data-balance]').forEach(el => {
        const value=el.getAttribute('data-balance');
        if (values.get(el)===value) return;
        values.set(el,value);
        if(media.matches) return;
        el.querySelectorAll('.ng-digit').forEach((digit,i) => {
          digit.getAnimations().forEach(a=>a.cancel());
          digit.animate([{transform:'translateY(8px)',opacity:0,filter:'blur(2px)'},{transform:'translateY(0)',opacity:1,filter:'blur(0)'}],
            {duration:500,delay:Math.min(i*35,180),easing:'cubic-bezier(.34,1.45,.64,1)',fill:'both'});
        });
      });
    });
  }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-balance']});
})();

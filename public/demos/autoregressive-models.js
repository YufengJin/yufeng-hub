/* ml/autoregressive-models 笔记的交互 demo（浅色主题：白底画布 + 深色文字/线条）。
 * navigation.instant 下内联 <script> 翻页不重跑，故走 extra_javascript + document$.subscribe，
 * 并对每个 demo 做存在性守卫。 */
(function () {
  /* 页面语言：构建后英文页在 /en/ 子路径下 */
  const EN = location.pathname.indexOf('/en/') !== -1;
  /* 所有渲染给读者看的文案集中在这里；坐标/颜色/数据不随语言改变 */
  const T = EN ? {
    toks: ['[CLS]', 'task', 'prompt', ';', 'A1', 'A2', 'A3', '|'],
    keyAxis: 'key (attended to) →', queryAxis: '← query (who attends)',
    maskCausal: 'Causal mask: the lower triangle is lit — each token can only attend to itself and what is to its left. The prerequisite for autoregressive generation.',
    maskBidir: 'Bidirectional mask: everything is lit — each token sees every position. Good for understanding, cannot generate directly.',
    maskPrefix: 'Prefix-LM: the top-left prefix block is bidirectional (green); the suffix sees the whole prefix and is causal over the suffix (blue lower triangle). π₀-FAST uses this.',
    genHist: 'Generated sequence (autoregressive history):',
    genProbs: 'Probability distribution over the next token (sampled from this):',
    genOut: (tok, p) => `Sampled "${tok}" (probability ${p}%) and fed it back as input → predict the next one. That is the autoregressive loop.`,
    genLimit: ' (10 generated, hit reset)'
  } : {
    toks: ['[CLS]', '任务', '提示', ';', 'A1', 'A2', 'A3', '|'],
    keyAxis: 'key（被注意）→', queryAxis: '← query（谁在看）',
    maskCausal: '因果掩码：下三角全亮——每个 token 只能注意自己及左侧。自回归生成的前提。',
    maskBidir: '双向掩码：全亮——每个 token 看到所有位置。适合理解，无法直接生成。',
    maskPrefix: 'Prefix-LM：左上前缀块双向（绿），后缀对前缀全可见、对后缀因果（蓝下三角）。π₀-FAST 用这个。',
    genHist: '已生成序列（自回归历史）：',
    genProbs: '下一个 token 的概率分布（采样自此）：',
    genOut: (tok, p) => `采样得到 "${tok}"（概率 ${p}%）并接回输入 → 继续预测下一个。这就是自回归循环。`,
    genLimit: ' （已生成 10 个，点重置）'
  };

  function run() {
    const $ = (id) => document.getElementById(id);
    if (!$('cvMask') && !$('cvGen')) return;

    const INK='#201F1C', MUTED='#6B675F', LINE='#D8D2C7', OFF='#EDEAE3';
    const BLUE='#58a6ff', GREEN='#3fb950', PURPLE='#bc8cff';

    /* ===== 注意力掩码对比 ===== */
    (function(){
      const cv=$('cvMask'); if(!cv) return; const x=cv.getContext('2d'),out=$('maskOut');
      const toks=T.toks;
      const N=toks.length, prefixLen=4;
      let mode='causal';
      const btns={causal:$('mCausal'),bidir:$('mBidir'),prefix:$('mPrefix')};
      function allow(q,k){
        if(mode==='bidir') return true;
        if(mode==='causal') return k<=q;
        if(q<prefixLen && k<prefixLen) return true;
        return k<=q;
      }
      function draw(){
        const W=cv.width,H=cv.height,pad=70,cell=(W-pad-14)/N;
        x.clearRect(0,0,W,H);
        x.font='11px monospace';
        for(let i=0;i<N;i++){ x.save();
          x.fillStyle = i<prefixLen?GREEN:BLUE;
          x.translate(pad+cell*i+cell/2, pad-8); x.rotate(-Math.PI/4); x.textAlign='left'; x.fillText(toks[i],0,0); x.restore();
          x.fillStyle = i<prefixLen?GREEN:BLUE; x.textAlign='right'; x.fillText(toks[i],pad-8,pad+cell*i+cell/2+3);
        }
        x.fillStyle=MUTED; x.font='12px sans-serif'; x.textAlign='left';
        x.fillText(T.keyAxis,pad,28); x.save(); x.translate(20,pad); x.rotate(-Math.PI/2); x.fillText(T.queryAxis,-110,0); x.restore();
        for(let q=0;q<N;q++)for(let k=0;k<N;k++){
          const px=pad+cell*k, py=pad+cell*q;
          const ok=allow(q,k);
          x.fillStyle= ok ? (q<prefixLen&&k<prefixLen&&mode==='prefix'?'rgba(63,185,80,.45)':'rgba(88,166,255,.42)') : OFF;
          x.fillRect(px+1,py+1,cell-2,cell-2);
          x.strokeStyle=LINE; x.strokeRect(px+1,py+1,cell-2,cell-2);
        }
        const txt={causal:T.maskCausal, bidir:T.maskBidir, prefix:T.maskPrefix};
        out.textContent=txt[mode];
      }
      Object.entries(btns).forEach(([m,b])=>{ if(!b) return; b.onclick=()=>{mode=m;Object.values(btns).forEach(x=>x&&x.classList.remove('on'));b.classList.add('on');draw();}; });
      draw();
    })();

    /* ===== 自回归生成 ===== */
    (function(){
      const cv=$('cvGen'); if(!cv) return; const x=cv.getContext('2d'),out=$('genOut');
      const step=$('genStep'),reset=$('genReset'),T=$('genT'),TV=$('genTV');
      const vocab=['↑','↓','←','→','◦','✋','⊙'];
      let gen=['<S>']; let lastProbs=null;
      function logitsFor(hist){ const last=hist[hist.length-1]; return vocab.map((v,i)=>Math.sin(i*1.7+hist.length*0.9+(last?last.charCodeAt(0):0)*0.13)+1.2); }
      function softmax(l,tau){const z=l.map(v=>Math.exp(v/tau));const s=z.reduce((a,b)=>a+b,0);return z.map(v=>v/s);}
      function draw(){
        const W=cv.width,H=cv.height;x.clearRect(0,0,W,H);
        x.font='13px sans-serif';x.fillStyle=MUTED;x.fillText(T.genHist,14,22);
        let px=14,py=54;x.font='20px sans-serif';
        gen.forEach((t,i)=>{const w=t==='<S>'?42:34;
          x.fillStyle=i===0?OFF:'rgba(88,166,255,.18)';x.fillRect(px,py-26,w-4,34);
          x.strokeStyle=i===0?LINE:BLUE;x.strokeRect(px+0.5,py-25.5,w-5,33);
          x.fillStyle=INK;x.fillText(t,px+ (t==='<S>'?4:9),py-2);px+=w;});
        if(lastProbs){
          x.font='13px sans-serif';x.fillStyle=MUTED;x.fillText(T.genProbs,14,120);
          const bw=60,by=200,maxp=Math.max(...lastProbs);
          vocab.forEach((v,i)=>{const h=lastProbs[i]/maxp*70;const bx=20+i*bw;
            x.fillStyle=PURPLE;x.fillRect(bx,by-h,bw-14,h);
            x.fillStyle=INK;x.font='18px sans-serif';x.fillText(v,bx+8,by+22);
            x.fillStyle=MUTED;x.font='11px sans-serif';x.fillText((lastProbs[i]*100).toFixed(0)+'%',bx+4,by-h-4);});
        }
      }
      function doStep(){const tau=+T.value/100;const p=softmax(logitsFor(gen),tau);lastProbs=p;
        let r=Math.random(),acc=0,idx=0;for(let i=0;i<p.length;i++){acc+=p[i];if(r<=acc){idx=i;break;}}
        gen.push(vocab[idx]);draw();
        out.textContent=T.genOut(vocab[idx], (p[idx]*100).toFixed(0));
        if(gen.length>10){out.textContent+=T.genLimit;step.disabled=true;}
      }
      step.onclick=doStep;reset.onclick=()=>{gen=['<S>'];lastProbs=null;step.disabled=false;out.textContent='';draw();};
      T.oninput=()=>{TV.textContent=(+T.value/100).toFixed(2);};
      draw();
    })();
  }

  if (typeof window.document$ !== 'undefined' && window.document$.subscribe) {
    window.document$.subscribe(run);
  } else if (document.readyState !== 'loading') {
    run();
  } else {
    document.addEventListener('DOMContentLoaded', run);
  }
})();

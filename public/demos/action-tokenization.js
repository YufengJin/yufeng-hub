/* 机器人 Action Tokenization 笔记的交互 demo（浅色主题：白底画布 + 深色文字/线条）。
 * navigation.instant（SPA 即时加载）下，正文内联 <script> 翻页时不会重跑，
 * 所以这里走 extra_javascript + document$.subscribe，并对每个 demo 做存在性守卫，
 * 这样在别的页面不会报错、回到本页能重新初始化。 */
(function () {
  /* 页面语言：构建后英文页在 /en/ 子路径下 */
  const EN = location.pathname.indexOf('/en/') !== -1;
  /* 所有渲染给读者看的文案集中在这里；坐标/颜色/数据不随语言改变 */
  const T = EN ? {
    modeLeft: 'demos going LEFT', modeRight: 'demos going RIGHT',
    modeL2: '← L2 regression "best prediction" = mean of the two clusters',
    modeObstacle: 'obstacle',
    modeCat: 'Discrete distribution (one token probability per bin): both peaks stay lit',
    modeZero: '↑ probability ≈0 at the mean (no-man\'s land)',
    modeOut: (g) => `Mode gap ≈ ${g}px | the L2 prediction lands at the midpoint (the obstacle); the wider the gap, the worse it gets, while the discrete distribution keeps both peaks.`,
    dctSig: '① Time-domain signal (one joint angle over time)',
    dctCoef: '② DCT coefficients (low → high frequency): a smooth signal packs its energy on the left',
    dctLow: 'low freq (purple)', dctHigh: 'high freq →',
    dctOut: (p) => `The first 6 low-frequency coefficients hold ${p}% of the total energy | the smoother the signal, the closer this ratio gets to 100%, and the closer the high-frequency coefficients get to 0 (after rounding → lots of 0s → compressible).`,
    quantOrig: 'original signal', quantRec: 'quantized (staircase)',
    quantOut: (nb, bits, mse) => `${nb} quantization levels (≈${bits} bit/value) | reconstruction MSE = ${mse} | fewer levels cost fewer tokens but distort more — this is the precision ↔ compression trade-off.`,
    bpeSeq: 'Current token sequence:',
    bpeOut: (len, init, pct, n, dict) => `Length: ${len} (initially ${init}, compression ${pct}%) | new merged symbols: ${n} ${dict}`,
    bpeDone: 'No repeated pair left to merge (already minimal).',
    rtP1: '① Trajectory + IDCT reconstruction (dashed)',
    rtP2: '② DCT coefficients (energy at low frequencies)',
    rtP3: '③ Quantized round(C·scale): many → 0',
    rtTrade: 'scale sweep trade-off: finer scale → MSE↓ (red) but nonzero coefficients/tokens↑ (blue)',
    rtCur: 'current scale', rtNnz: 'nonzero (≈tokens)',
    rtOut: (scale, nnz, mse) => `scale=${scale} | nonzero DCT coefficients = ${nnz} (≈ the payload before BPE, fewer compresses better) | reconstruction MSE = ${mse} | the only loss comes from the rounding in ②: a larger scale is finer but costs more tokens.`,
    fsqLegend: 'blue = continuous z   green = snapped codeword   gray = codebook grid',
    fsqOut: (n1, n2, tot, z1, z2, d1, d2, token) => `Codebook size = ${n1}×${n2} = ${tot} codewords | current z=(${z1},${z2}) → digits=(${d1},${d2}) → single integer token #${token}`,
    tempLegend: 'softmax distribution (purple) | sampling histogram (pink outline)',
    tempPeak1: 'peak ① "left"', tempPeak2: 'peak ② "right"',
    tempArgmax: '≈argmax: only ever takes the tallest peak, dropping the other solution',
    tempBoth: 'both peaks can be sampled → multimodal, multiple solutions',
    tempOut: (tau, ent, mid, total) => `τ=${tau} | entropy=${ent} (higher = more diverse) | ${mid} | sampled ${total} times`,
    cmpTitle: 'Action dim 0: original vs three reconstructions',
    cmpOrig: 'Original', cmpFsq: 'FSQ (approx)',
    cmpMse: 'Reconstruction MSE (lower is better, log height)',
    cmpTok: 'Token count (fewer is cheaper)',
    cmpOut: (fm, ft, sm, st, bm, bt) => `FAST: MSE ${fm}, ${ft} nonzero coefficients (pre-BPE) | FSQ (approx): MSE ${sm}, ${st} tokens (fixed) | Binning: MSE ${bm}, ${bt} tokens (=T×D). Raise the smoothness to watch FAST/FSQ overtake Binning with fewer tokens; tick the noise box to see high frequencies push all three errors up.`
  } : {
    modeLeft: '演示「向左」的动作', modeRight: '演示「向右」的动作',
    modeL2: '← L2 回归的"最优预测"=两簇均值',
    modeObstacle: '障碍',
    modeCat: '离散分布（每个 bin 一个 token 的概率）：两个峰都能点亮',
    modeZero: '↑ 均值处概率≈0（无人区）',
    modeOut: (g) => `两模式间距 ≈ ${g}px ｜ L2 预测落在中点（障碍处），间距越大越离谱；离散分布保留双峰。`,
    dctSig: '① 时域信号（某关节角度随时间）',
    dctCoef: '② DCT 系数（频率从低→高）：平滑信号能量集中在最左',
    dctLow: '低频(紫)', dctHigh: '高频→',
    dctOut: (p) => `前 6 个低频系数占总能量 ${p}% ｜ 信号越平滑，这个比例越接近 100%，高频系数越接近 0（取整后→大量 0→可压缩）。`,
    quantOrig: '原始连续信号', quantRec: '量化重建（阶梯）',
    quantOut: (nb, bits, mse) => `${nb} 个量化级（≈${bits} bit/值）｜ 重建 MSE = ${mse} ｜ 级数越少越省 token 但越失真——这就是精度↔压缩的权衡。`,
    bpeSeq: '当前 token 序列：',
    bpeOut: (len, init, pct, n, dict) => `长度：${len}（初始 ${init}，压缩率 ${pct}%） ｜ 新合并符号：${n} 个 ${dict}`,
    bpeDone: '没有重复 pair 可合并了（已最简）。',
    rtP1: '① 连续轨迹 + IDCT 重建（虚线）',
    rtP2: '② DCT 系数（能量集中在低频）',
    rtP3: '③ 量化后系数 round(C·scale)：大量→0',
    rtTrade: 'scale 扫描权衡：精细 scale → MSE↓（红）但非零系数/token↑（蓝）',
    rtCur: '当前 scale', rtNnz: '非零系数(≈token)',
    rtOut: (scale, nnz, mse) => `scale=${scale} ｜ 非零 DCT 系数 = ${nnz} 个（≈ BPE 前的有效信息量，越少越好压缩）｜ 重建 MSE = ${mse} ｜ 唯一损失来自②的取整：scale 越大越精细但 token 越多。`,
    fsqLegend: '蓝=连续编码值 z   绿=吸附到的码字   灰=码本网格',
    fsqOut: (n1, n2, tot, z1, z2, d1, d2, token) => `码本大小 = ${n1}×${n2} = ${tot} 个码字 ｜ 当前 z=(${z1},${z2}) → digits=(${d1},${d2}) → 单整数 token #${token}`,
    tempLegend: 'softmax 概率分布（紫）｜ 采样统计（粉描边）',
    tempPeak1: '峰①「向左」', tempPeak2: '峰②「向右」',
    tempArgmax: '≈argmax：只会取最高峰，丢掉另一个解',
    tempBoth: '双峰都有概率被采到 → 多模态多解',
    tempOut: (tau, ent, mid, total) => `τ=${tau} ｜ 分布熵=${ent}（越大越多样）｜ ${mid} ｜ 已采样 ${total} 次`,
    cmpTitle: '动作维度 0：原始 vs 三种重建',
    cmpOrig: '原始', cmpFsq: 'FSQ(示意)',
    cmpMse: '重建 MSE（越低越好，log 高度）',
    cmpTok: 'token 数（越少越省）',
    cmpOut: (fm, ft, sm, st, bm, bt) => `FAST: MSE ${fm}, ${ft} 个非零系数(BPE前) ｜ FSQ(示意): MSE ${sm}, ${st} token(固定) ｜ Binning: MSE ${bm}, ${bt} token(=T×D). 把平滑度调高看 FAST/FSQ 用更少 token 反超 Binning；勾选噪声看高频如何同时拉高三者误差。`
  };

  function run() {
    const $ = (id) => document.getElementById(id);
    // 任一 demo 画布存在才执行（即“当前在本笔记页”）
    if (!$('cvMode') && !$('cvDct') && !$('cvQuant') && !$('cvBpe') &&
        !$('cvRT') && !$('cvFsq') && !$('cvTemp') && !$('cvCmp')) return;

    // ── 浅色主题调色板 ──
    const INK='#201F1C', MUTED='#6B675F', LINE='#D8D2C7', GRID='rgba(0,0,0,.06)';
    const OFF='#EDEAE3', ZERO='#E4E0D7', DIM='#C4BFB4', REF='#8C8780';
    const BLUE='#58a6ff', GREEN='#3fb950', RED='#f85149', PURPLE='#bc8cff', PINK='#f778ba';

    function seededRand(seed){ let s=seed%2147483647; if(s<=0)s+=2147483646; return ()=>(s=s*16807%2147483647)/2147483647; }
    function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
    function dct(sig){ const N=sig.length, X=new Array(N).fill(0);
      for(let k=0;k<N;k++){ let s=0; for(let n=0;n<N;n++){ s+=sig[n]*Math.cos(Math.PI/N*(n+0.5)*k); } X[k]=s; } return X; }
    function dctOrtho(x){ const N=x.length, X=new Array(N).fill(0);
      for(let k=0;k<N;k++){ let s=0; for(let n=0;n<N;n++) s+=x[n]*Math.cos(Math.PI/N*(n+0.5)*k);
        const f = k===0 ? Math.sqrt(1/N) : Math.sqrt(2/N); X[k]=f*s; } return X; }
    function idctOrtho(X){ const N=X.length, x=new Array(N).fill(0);
      for(let n=0;n<N;n++){ let s=0; for(let k=0;k<N;k++){ const f=k===0?Math.sqrt(1/N):Math.sqrt(2/N);
        s+=f*X[k]*Math.cos(Math.PI/N*(n+0.5)*k); } x[n]=s; } return x; }

    /* ===== Demo 1: mode averaging ===== */
    (function(){
      const cv=$('cvMode'); if(!cv) return; const x=cv.getContext('2d');
      const gap=$('modeGap'),showCat=$('showCat'),out=$('modeOut');
      function draw(){
        const W=cv.width,H=cv.height; x.clearRect(0,0,W,H);
        const cx=W/2, g=+gap.value*2;
        const leftX=cx-g/2-60, rightX=cx+g/2+60, y0=110;
        const rnd=seededRand(7);
        function cluster(mx,col){ for(let i=0;i<40;i++){ const px=mx+(rnd()-.5)*46, py=y0+(rnd()-.5)*46; x.fillStyle=col; x.beginPath(); x.arc(px,py,3.2,0,7); x.fill(); } }
        cluster(leftX,BLUE); cluster(rightX,GREEN);
        x.fillStyle=MUTED; x.font='13px sans-serif';
        x.fillText(T.modeLeft, leftX-60, y0-58);
        x.fillText(T.modeRight, rightX-60, y0-58);
        const mean=(leftX+rightX)/2;
        x.strokeStyle=RED; x.lineWidth=3; x.beginPath(); x.moveTo(mean,30); x.lineTo(mean,y0+70); x.stroke();
        x.fillStyle=RED; x.font='bold 13px sans-serif';
        x.fillText(T.modeL2, mean+8, 44);
        x.fillStyle='rgba(248,81,73,.22)'; x.fillRect(mean-22,y0-26,44,52);
        x.strokeStyle=RED; x.lineWidth=1; x.strokeRect(mean-22,y0-26,44,52);
        x.fillStyle=RED; x.fillText(T.modeObstacle, mean-16,y0+4);
        if(showCat.checked){
          const by=200, bw=14, n=Math.floor(W/bw);
          x.fillStyle=MUTED; x.font='13px sans-serif'; x.fillText(T.modeCat, 10, by-12);
          for(let i=0;i<n;i++){
            const bx=i*bw+1, center=i*bw+bw/2;
            const pL=Math.exp(-((center-leftX)**2)/(2*22*22));
            const pR=Math.exp(-((center-rightX)**2)/(2*22*22));
            const p=pL+pR; const hgt=p*70;
            x.fillStyle = (Math.abs(center-leftX)<g/2+70 && pL>pR)?BLUE:GREEN;
            if(p<0.02) x.fillStyle=LINE;
            x.fillRect(bx,by+60-hgt,bw-2,hgt);
          }
          x.fillStyle=RED; x.beginPath(); x.moveTo(mean,by-4); x.lineTo(mean,by+60); x.lineWidth=2; x.stroke();
          x.fillText(T.modeZero, mean-30, by+78);
        }
        out.textContent = T.modeOut(g);
      }
      gap.oninput=draw; showCat.onchange=draw; draw();
    })();

    /* ===== Demo 2: DCT energy ===== */
    (function(){
      const cv=$('cvDct'); if(!cv) return; const x=cv.getContext('2d');
      const sm=$('dctSmooth'),roll=$('dctReroll'),out=$('dctOut');
      let seed=3;
      function genSignal(N,smooth){ const rnd=seededRand(seed); const raw=[]; for(let i=0;i<N;i++)raw.push(rnd()-.5);
        const sig=[]; for(let i=0;i<N;i++){ let s=0,c=0; for(let j=-smooth;j<=smooth;j++){ const k=i+j; if(k>=0&&k<N){s+=raw[k];c++;} } sig.push(s/c*3); } return sig; }
      function draw(){
        const W=cv.width,H=cv.height; x.clearRect(0,0,W,H);
        const N=48, sig=genSignal(N,+sm.value), X=dct(sig);
        x.fillStyle=MUTED; x.font='13px sans-serif'; x.fillText(T.dctSig, 10, 18);
        const mid1=90, sc=40;
        x.strokeStyle=LINE; x.beginPath(); x.moveTo(40,mid1); x.lineTo(W-10,mid1); x.stroke();
        x.strokeStyle=BLUE; x.lineWidth=2; x.beginPath();
        for(let i=0;i<N;i++){ const px=40+i/(N-1)*(W-60), py=mid1-sig[i]*sc; i?x.lineTo(px,py):x.moveTo(px,py); } x.stroke();
        x.fillStyle=MUTED; x.fillText(T.dctCoef, 10, 188);
        const by=330, maxC=Math.max(...X.map(Math.abs),1e-6), bw=(W-60)/N;
        let lowE=0,totE=0; for(let i=0;i<N;i++){ totE+=X[i]*X[i]; if(i<6)lowE+=X[i]*X[i]; }
        for(let i=0;i<N;i++){ const h=Math.abs(X[i])/maxC*120; const px=40+i*bw;
          x.fillStyle = i<6?PURPLE:DIM; x.fillRect(px,by-h,bw-1.5,h); }
        x.strokeStyle=LINE; x.beginPath(); x.moveTo(40,by); x.lineTo(W-10,by); x.stroke();
        x.fillStyle=PURPLE; x.fillText(T.dctLow, 44, by+16); x.fillStyle=MUTED; x.fillText(T.dctHigh, W-90, by+16);
        out.textContent = T.dctOut((lowE/totE*100).toFixed(1));
      }
      sm.oninput=draw; roll.onclick=()=>{seed=(seed*7+11)%9973; draw();}; draw();
    })();

    /* ===== Demo 3: quantization ===== */
    (function(){
      const cv=$('cvQuant'); if(!cv) return; const x=cv.getContext('2d');
      const bins=$('qBins'),binsV=$('qBinsV'),out=$('quantOut');
      function sigAt(t){ return Math.sin(t*6.28)*0.6 + Math.sin(t*18.8)*0.18; }
      function draw(){
        const W=cv.width,H=cv.height,mid=H/2,sc=H*0.36; x.clearRect(0,0,W,H);
        const nb=+bins.value; binsV.textContent=nb;
        x.strokeStyle=LINE; x.beginPath(); x.moveTo(40,mid); x.lineTo(W-10,mid); x.stroke();
        x.strokeStyle=GRID;
        for(let b=0;b<=nb;b++){ const v=b/nb*2-1, py=mid-v*sc; x.beginPath(); x.moveTo(40,py); x.lineTo(W-10,py); x.stroke(); }
        x.strokeStyle=BLUE; x.lineWidth=2; x.beginPath();
        const N=300; for(let i=0;i<N;i++){ const t=i/(N-1), v=sigAt(t), px=40+t*(W-60), py=mid-v*sc; i?x.lineTo(px,py):x.moveTo(px,py);} x.stroke();
        x.strokeStyle=RED; x.lineWidth=2; x.beginPath(); let mse=0,cnt=0;
        for(let i=0;i<N;i++){ const t=i/(N-1), v=sigAt(t); const q=Math.round((v+1)/2*nb)/nb*2-1; mse+=(v-q)**2;cnt++;
          const px=40+t*(W-60), py=mid-q*sc; i?x.lineTo(px,py):x.moveTo(px,py);} x.stroke();
        x.fillStyle=BLUE; x.font='13px sans-serif'; x.fillText(T.quantOrig, 46,18);
        x.fillStyle=RED; x.fillText(T.quantRec, 160,18);
        const bitsPerTok=Math.log2(nb).toFixed(2);
        out.textContent = T.quantOut(nb, bitsPerTok, (mse/cnt).toExponential(2));
      }
      bins.oninput=draw; draw();
    })();

    /* ===== Demo 4: BPE（浅底 token 方块：浅彩填充 + 同色描边 + 深字）===== */
    (function(){
      const cv=$('cvBpe'); if(!cv) return; const x=cv.getContext('2d');
      const step=$('bpeStep'),reset=$('bpeReset'),out=$('bpeOut');
      let seq, dict, nextSym, initLen;
      function init(){
        seq=[5,0,0,0,3,0,0,0,5,0,0,0,3,0,0,0,5,0,0,0,3,0,0,0,7,0,0];
        dict=[]; nextSym=10; initLen=seq.length; draw();
      }
      function draw(){
        const W=cv.width,H=cv.height; x.clearRect(0,0,W,H);
        let px=14, py=44;
        x.fillStyle=MUTED; x.font='13px sans-serif'; x.fillText(T.bpeSeq, 14,22); x.font='15px monospace';
        seq.forEach(t=>{
          const w=24; if(px+w>W-14){px=14;py+=34;}
          let fill,border;
          if(t>=10){ fill='rgba(188,140,255,.22)'; border=PURPLE; }
          else if(t===0){ fill=OFF; border=LINE; }
          else { fill='rgba(88,166,255,.18)'; border=BLUE; }
          x.fillStyle=fill; x.fillRect(px,py-16,w-3,24);
          x.strokeStyle=border; x.lineWidth=1; x.strokeRect(px+0.5,py-15.5,w-4,23);
          x.fillStyle=INK; x.fillText(t, px+ (t>9?2:6), py+1);
          px+=w;
        });
        out.textContent = T.bpeOut(seq.length, initLen, (seq.length/initLen*100).toFixed(0), dict.length, dict.map(d=>`#${d.sym}=(${d.pair})`).join('  '));
      }
      function doStep(){
        const cnt={};
        for(let i=0;i<seq.length-1;i++){ const k=seq[i]+','+seq[i+1]; cnt[k]=(cnt[k]||0)+1; }
        let best=null,bc=1; for(const k in cnt){ if(cnt[k]>bc){bc=cnt[k];best=k;} }
        if(!best){ out.textContent=T.bpeDone; return; }
        const [a,b]=best.split(',').map(Number); const sym=nextSym++;
        dict.push({sym,pair:best});
        const ns=[]; for(let i=0;i<seq.length;i++){ if(i<seq.length-1&&seq[i]===a&&seq[i+1]===b){ns.push(sym);i++;} else ns.push(seq[i]); }
        seq=ns; draw();
      }
      step.onclick=doStep; reset.onclick=init; init();
    })();

    /* ===== Demo 5: FAST round-trip ===== */
    (function(){
      const cvRT=$('cvRT'); if(!cvRT) return; const rt=cvRT.getContext('2d');
      const cvT=$('cvTrade'), tr=cvT.getContext('2d');
      const sc=$('rtScale'), scV=$('rtScaleV');
      const roll=$('rtReroll'), out=$('rtOut');
      const T=32, D=2, COL=[BLUE,GREEN]; let seed=0;
      function makeTraj(){
        const rnd=seededRand(seed*131+7), A=[];
        let mx=1e-8;
        for(let i=0;i<T;i++){ const t=i/(T-1), row=[];
          for(let j=0;j<D;j++){ const v=0.6*Math.sin(2*Math.PI*(1+j)*t+j)+0.3*Math.sin(2*Math.PI*(2+j)*t)+0.05*(rnd()-0.5)*2; row.push(v); mx=Math.max(mx,Math.abs(v)); }
          A.push(row); }
        for(let i=0;i<T;i++)for(let j=0;j<D;j++)A[i][j]/=mx; return A;
      }
      function col(A,j){ return A.map(r=>r[j]); }
      function roundtrip(A,scale){
        const Cs=[],Cqs=[],Rec=[]; let nnz=0, se=0, cnt=0;
        for(let j=0;j<D;j++){ const C=dctOrtho(col(A,j)); const Cq=C.map(c=>Math.round(c*scale));
          const rec=idctOrtho(Cq.map(c=>c/scale)); Cs.push(C); Cqs.push(Cq); Rec.push(rec);
          for(let i=0;i<T;i++){ if(Cq[i]!==0)nnz++; const d=A[i][j]-rec[i]; se+=d*d; cnt++; } }
        return {Cs,Cqs,Rec,nnz,mse:se/cnt};
      }
      let A=makeTraj();
      function panel(x0,w,title){ rt.fillStyle=MUTED; rt.font='12px sans-serif'; rt.fillText(title,x0,16); }
      function drawMain(scale){
        const W=cvRT.width,H=cvRT.height; rt.clearRect(0,0,W,H);
        const r=roundtrip(A,scale);
        const pw=W/3, top=30, bh=H-70, mid=top+bh/2;
        panel(10,pw,T.rtP1);
        rt.strokeStyle=LINE; rt.beginPath(); rt.moveTo(20,mid); rt.lineTo(pw-10,mid); rt.stroke();
        for(let j=0;j<D;j++){ const c=col(A,j);
          rt.strokeStyle=COL[j]; rt.lineWidth=2; rt.beginPath();
          for(let i=0;i<T;i++){ const px=20+i/(T-1)*(pw-30), py=mid-c[i]*bh*0.45; i?rt.lineTo(px,py):rt.moveTo(px,py);} rt.stroke();
          rt.strokeStyle=COL[j]; rt.setLineDash([4,3]); rt.lineWidth=1.5; rt.beginPath();
          for(let i=0;i<T;i++){ const px=20+i/(T-1)*(pw-30), py=mid-r.Rec[j][i]*bh*0.45; i?rt.lineTo(px,py):rt.moveTo(px,py);} rt.stroke(); rt.setLineDash([]);
        }
        const x2=pw; panel(x2+10,pw,T.rtP2);
        let maxC=1e-6; for(let j=0;j<D;j++)for(const v of r.Cs[j])maxC=Math.max(maxC,Math.abs(v));
        const bw2=(pw-30)/T;
        rt.strokeStyle=LINE; rt.beginPath(); rt.moveTo(x2+20,mid); rt.lineTo(x2+pw-10,mid); rt.stroke();
        for(let j=0;j<D;j++)for(let i=0;i<T;i++){ const v=r.Cs[j][i]/maxC*bh*0.42; const px=x2+20+i*bw2+(j-0.5)*bw2*0.45;
          rt.fillStyle=COL[j]; rt.fillRect(px, v>=0?mid-v:mid, bw2*0.4, Math.abs(v)); }
        const x3=2*pw; panel(x3+10,pw,T.rtP3);
        let maxQ=1e-6; for(let j=0;j<D;j++)for(const v of r.Cqs[j])maxQ=Math.max(maxQ,Math.abs(v));
        rt.strokeStyle=LINE; rt.beginPath(); rt.moveTo(x3+20,mid); rt.lineTo(x3+pw-10,mid); rt.stroke();
        for(let j=0;j<D;j++)for(let i=0;i<T;i++){ const raw=r.Cqs[j][i]; const v=raw/maxQ*bh*0.42; const px=x3+20+i*bw2+(j-0.5)*bw2*0.45;
          rt.fillStyle = raw===0?ZERO:COL[j]; rt.fillRect(px, v>=0?mid-v:mid, bw2*0.4, Math.max(Math.abs(v),raw===0?1:0)); }
        return r;
      }
      function drawTrade(curScale){
        const W=cvT.width,H=cvT.height; tr.clearRect(0,0,W,H);
        tr.fillStyle=MUTED; tr.font='12px sans-serif';
        tr.fillText(T.rtTrade, 10, 16);
        const scales=[]; for(let s=1;s<=64;s*=1.4142)scales.push(s);
        const data=scales.map(s=>{ const r=roundtrip(A,s); return {s,mse:Math.max(r.mse,1e-9),nnz:r.nnz}; });
        const x0=46,x1=W-46,y0=H-26,y1=30;
        const lmse=data.map(d=>Math.log10(d.mse)), minL=Math.min(...lmse), maxL=Math.max(...lmse);
        const maxN=Math.max(...data.map(d=>d.nnz)), maxS=64;
        const X=s=>x0+(Math.log2(s)/Math.log2(maxS))*(x1-x0);
        const Ymse=l=>y0-(l-minL)/(maxL-minL+1e-9)*(y0-y1);
        const Ynnz=n=>y0-n/maxN*(y0-y1);
        tr.strokeStyle=LINE; tr.beginPath(); tr.moveTo(x0,y0); tr.lineTo(x1,y0); tr.stroke();
        tr.strokeStyle=RED; tr.lineWidth=2; tr.beginPath();
        data.forEach((d,i)=>{ const px=X(d.s),py=Ymse(lmse[i]); i?tr.lineTo(px,py):tr.moveTo(px,py); }); tr.stroke();
        data.forEach((d,i)=>{ tr.fillStyle=RED; tr.beginPath(); tr.arc(X(d.s),Ymse(lmse[i]),2.5,0,7); tr.fill(); });
        tr.strokeStyle=BLUE; tr.lineWidth=2; tr.beginPath();
        data.forEach((d,i)=>{ const px=X(d.s),py=Ynnz(d.nnz); i?tr.lineTo(px,py):tr.moveTo(px,py); }); tr.stroke();
        data.forEach(d=>{ tr.fillStyle=BLUE; tr.beginPath(); tr.arc(X(d.s),Ynnz(d.nnz),2.5,0,7); tr.fill(); });
        tr.strokeStyle=PURPLE; tr.setLineDash([4,3]); tr.beginPath(); tr.moveTo(X(curScale),y1); tr.lineTo(X(curScale),y0); tr.stroke(); tr.setLineDash([]);
        tr.fillStyle=PURPLE; tr.fillText(T.rtCur, X(curScale)+4, y1+10);
        tr.fillStyle=RED; tr.fillText('MSE(log)', x0, y1-2);
        tr.fillStyle=BLUE; tr.fillText(T.rtNnz, x1-110, y1-2);
        tr.fillStyle=MUTED; tr.fillText('scale 1', x0-6, y0+18); tr.fillText('64', x1-6, y0+18);
      }
      function update(){ const scale=+sc.value; scV.textContent=scale; const r=drawMain(scale); drawTrade(scale);
        out.textContent = T.rtOut(scale, r.nnz, r.mse.toExponential(2));
      }
      sc.oninput=update; roll.onclick=()=>{seed++; A=makeTraj(); update();}; update();
    })();

    /* ===== Demo 6: FSQ grid ===== */
    (function(){
      const cv=$('cvFsq'); if(!cv) return; const x=cv.getContext('2d');
      const b1=$('fsqB1'),b2=$('fsqB2'),b1v=$('fsqB1V'),b2v=$('fsqB2V'),out=$('fsqOut');
      let mx=0.3,my=-0.2;
      function toPix(v){ return 40+(v+1)/2*(cv.width-80); }
      function draw(){
        const W=cv.width,H=cv.height; x.clearRect(0,0,W,H);
        const n1=+b1.value,n2=+b2.value; b1v.textContent=n1; b2v.textContent=n2;
        for(let i=0;i<n1;i++)for(let j=0;j<n2;j++){
          const gx=i/(n1-1)*2-1, gy=j/(n2-1)*2-1;
          x.fillStyle=DIM; x.beginPath(); x.arc(toPix(gx),toPix(gy),4,0,7); x.fill();
        }
        const cz1=Math.tanh(mx*2), cz2=Math.tanh(my*2);
        const cpx=toPix(cz1),cpy=toPix(cz2);
        const d1=Math.round((cz1+1)*(n1-1)/2), d2=Math.round((cz2+1)*(n2-1)/2);
        const qz1=d1/(n1-1)*2-1, qz2=d2/(n2-1)*2-1;
        x.strokeStyle=PINK; x.lineWidth=1.5; x.beginPath(); x.moveTo(cpx,cpy); x.lineTo(toPix(qz1),toPix(qz2)); x.stroke();
        x.fillStyle=BLUE; x.beginPath(); x.arc(cpx,cpy,6,0,7); x.fill();
        x.fillStyle=GREEN; x.beginPath(); x.arc(toPix(qz1),toPix(qz2),8,0,7); x.fill();
        x.fillStyle=MUTED; x.font='12px sans-serif';
        x.fillText(T.fsqLegend, 10, H-10);
        const token=d2*n1+d1;
        out.textContent = T.fsqOut(n1, n2, n1*n2, cz1.toFixed(2), cz2.toFixed(2), d1, d2, token);
      }
      function move(e){ const r=cv.getBoundingClientRect();
        const sx=cv.width/r.width, sy=cv.height/r.height;
        const px=((e.touches?e.touches[0].clientX:e.clientX)-r.left)*sx;
        const py=((e.touches?e.touches[0].clientY:e.clientY)-r.top)*sy;
        mx=((px-40)/(cv.width-80)*2-1); my=((py-40)/(cv.height-80)*2-1); mx=clamp(mx,-1,1);my=clamp(my,-1,1); draw(); }
      cv.addEventListener('mousemove',move); cv.addEventListener('touchmove',e=>{move(e);e.preventDefault();},{passive:false});
      b1.oninput=draw; b2.oninput=draw; draw();
    })();

    /* ===== Demo 7: temperature softmax ===== */
    (function(){
      const cv=$('cvTemp'); if(!cv) return; const x=cv.getContext('2d');
      const tT=$('tempT'),tTV=$('tempTV'),samp=$('tempSample'),out=$('tempOut');
      const N=40; const logits=[]; for(let i=0;i<N;i++){ const a=Math.exp(-((i-10)**2)/18)*4, b=Math.exp(-((i-29)**2)/18)*3.6; logits.push(a+b); }
      let counts=new Array(N).fill(0), total=0;
      function softmax(tau){ const t=Math.max(tau,1e-3); const z=logits.map(l=>Math.exp(l/t)); const s=z.reduce((a,b)=>a+b,0); return z.map(v=>v/s); }
      function draw(){
        const W=cv.width,H=cv.height; x.clearRect(0,0,W,H);
        const tau=+tT.value/100; tTV.textContent=tau.toFixed(2);
        const p=softmax(tau), maxp=Math.max(...p), bw=(W-60)/N, by=H-40;
        x.fillStyle=MUTED; x.font='13px sans-serif'; x.fillText(T.tempLegend, 14,18);
        for(let i=0;i<N;i++){ const h=p[i]/maxp*(H-90), px=40+i*bw;
          x.fillStyle=PURPLE; x.fillRect(px,by-h,bw-2,h);
          if(total>0){ const sh=counts[i]/total/maxp*(H-90); x.strokeStyle=PINK; x.lineWidth=2; x.strokeRect(px,by-sh,bw-2,sh); }
        }
        x.strokeStyle=LINE; x.beginPath(); x.moveTo(40,by); x.lineTo(W-10,by); x.stroke();
        x.fillStyle=BLUE; x.fillText(T.tempPeak1, 40+10*bw-20, by+16);
        x.fillStyle=GREEN; x.fillText(T.tempPeak2, 40+29*bw-20, by+16);
        const ent=-p.reduce((a,v)=>a+(v>1e-9?v*Math.log(v):0),0);
        out.textContent = T.tempOut(tau.toFixed(2), ent.toFixed(2), tau<0.05?T.tempArgmax:T.tempBoth, total);
      }
      function sample(){ const tau=Math.max(+tT.value/100,1e-3); const p=softmax(tau);
        for(let k=0;k<20;k++){ let r=Math.random(),acc=0,idx=0; for(let i=0;i<N;i++){acc+=p[i]; if(r<=acc){idx=i;break;}} counts[idx]++; total++; } draw(); }
      tT.oninput=()=>{counts=new Array(N).fill(0);total=0;draw();}; samp.onclick=sample; draw();
    })();

    /* ===== Demo 8: FAST vs Binning vs FSQ 重建对比 ===== */
    (function(){
      const cv=$('cvCmp'); if(!cv) return; const c=cv.getContext('2d');
      const cb=$('cvCmpBar'), b=cb.getContext('2d');
      const smooth=$('cmpSmooth'),smoothV=$('cmpSmoothV');
      const noise=$('cmpNoise'),scale=$('cmpScale'),scaleV=$('cmpScaleV');
      const fsqN=$('cmpFsqN'),fsqNV=$('cmpFsqNV'),out=$('cmpOut');
      const T=32,D=2,NBINS=256;
      function makeTraj(){
        const sm=+smooth.value, raw=[]; const rnd=seededRand(99);
        for(let j=0;j<D;j++){const r=[];for(let i=0;i<T;i++)r.push(rnd()-0.5);raw.push(r);}
        const A=[];let mx=1e-8;
        for(let i=0;i<T;i++){const row=[];for(let j=0;j<D;j++){
          let s=0,cnt=0;for(let k=-sm;k<=sm;k++){const idx=i+k;if(idx>=0&&idx<T){s+=raw[j][idx];cnt++;}}
          let v=s/cnt*3.2; if(noise.checked)v+=0.06*(rnd()-0.5)*2; row.push(v);mx=Math.max(mx,Math.abs(v));}A.push(row);}
        for(let i=0;i<T;i++)for(let j=0;j<D;j++)A[i][j]/=mx; return A;
      }
      function colOf(A,j){return A.map(r=>r[j]);}
      function fast(A,s){const Rec=[],nz=[];let se=0;
        for(let j=0;j<D;j++){const C=dctOrtho(colOf(A,j));const Cq=C.map(v=>Math.round(v*s));
          let n=0;for(const v of Cq)if(v!==0)n++;nz.push(n);const r=idctOrtho(Cq.map(v=>v/s));Rec.push(r);
          for(let i=0;i<T;i++)se+=(A[i][j]-r[i])**2;}
        return {rec:Rec,mse:se/(T*D),tokens:nz.reduce((a,b)=>a+b,0)};
      }
      function binning(A){const Rec=[];let se=0;
        for(let j=0;j<D;j++){const r=[];for(let i=0;i<T;i++){const tok=Math.min(NBINS-1,Math.max(0,Math.round((A[i][j]+1)/2*NBINS)));const dec=tok/NBINS*2-1;r.push(dec);se+=(A[i][j]-dec)**2;}Rec.push(r);}
        return {rec:Rec,mse:se/(T*D),tokens:T*D};
      }
      function fsqApprox(A,numTok){const L=8,Rec=[];let se=0;const per=Math.max(1,Math.round(numTok/D));
        for(let j=0;j<D;j++){const C=dctOrtho(colOf(A,j));const mxc=Math.max(...C.map(Math.abs),1e-6);
          const Cq=C.map((v,i)=>{ if(i>=per)return 0; const z=Math.max(-1,Math.min(1,v/mxc)); const d=Math.round((z+1)*(L-1)/2); return (d/(L-1)*2-1)*mxc; });
          const r=idctOrtho(Cq);Rec.push(r);for(let i=0;i<T;i++)se+=(A[i][j]-r[i])**2;}
        return {rec:Rec,mse:se/(T*D),tokens:per*D};
      }
      let A=makeTraj();
      function drawTraj(rF,rB,rS){
        const W=cv.width,H=cv.height,mid=H/2,amp=H*0.34;c.clearRect(0,0,W,H);
        c.fillStyle=MUTED;c.font='12px sans-serif';c.fillText(T.cmpTitle,12,18);
        c.strokeStyle=LINE;c.beginPath();c.moveTo(20,mid);c.lineTo(W-10,mid);c.stroke();
        function line(col,arr,dash,w){c.strokeStyle=col;c.setLineDash(dash);c.lineWidth=w;c.beginPath();
          for(let i=0;i<T;i++){const px=20+i/(T-1)*(W-30),py=mid-arr[i]*amp;i?c.lineTo(px,py):c.moveTo(px,py);}c.stroke();c.setLineDash([]);}
        line(INK,colOf(A,0),[],3);
        line(PURPLE,rF.rec[0],[6,3],1.8);
        line(PINK,rS.rec[0],[2,3],1.8);
        line(BLUE,rB.rec[0],[1,4],1.8);
        const lg=[[INK,T.cmpOrig],[PURPLE,'FAST'],[PINK,T.cmpFsq],[BLUE,'Binning']];
        let lx=W-360;lg.forEach(([col,t])=>{c.fillStyle=col;c.fillRect(lx,8,14,4);c.fillStyle=MUTED;c.fillText(t,lx+18,14);lx+=90;});
      }
      function drawBars(rF,rB,rS){
        const W=cb.width,H=cb.height;b.clearRect(0,0,W,H);
        const methods=[['FAST',PURPLE,rF],[T.cmpFsq,PINK,rS],['Binning',BLUE,rB]];
        b.fillStyle=MUTED;b.font='12px sans-serif';
        b.fillText(T.cmpMse,20,18);b.fillText(T.cmpTok,W/2+20,18);
        const mxLog=Math.max(...methods.map(m=>Math.log10(m[2].mse+1e-12)));
        const mnLog=Math.min(...methods.map(m=>Math.log10(m[2].mse+1e-12)))-0.5;
        const mxTok=Math.max(...methods.map(m=>m[2].tokens));
        const baseY=H-30,bw=70;
        methods.forEach((m,i)=>{const x=40+i*95;const lg=Math.log10(m[2].mse+1e-12);
          const h=Math.max(4,(lg-mnLog)/(mxLog-mnLog+1e-9)*100);
          b.fillStyle=m[1];b.fillRect(x,baseY-h,bw,h);
          b.fillStyle=INK;b.font='11px sans-serif';b.fillText(m[2].mse.toExponential(1),x,baseY-h-6);
          b.fillStyle=MUTED;b.fillText(m[0],x,baseY+16);});
        methods.forEach((m,i)=>{const x=W/2+40+i*95;const h=Math.max(4,m[2].tokens/mxTok*100);
          b.fillStyle=m[1];b.fillRect(x,baseY-h,bw,h);
          b.fillStyle=INK;b.font='11px sans-serif';b.fillText(m[2].tokens,x+8,baseY-h-6);
          b.fillStyle=MUTED;b.fillText(m[0],x,baseY+16);});
      }
      function update(){
        smoothV.textContent=smooth.value;scaleV.textContent=scale.value;fsqNV.textContent=fsqN.value;
        const rF=fast(A,+scale.value),rB=binning(A),rS=fsqApprox(A,+fsqN.value);
        drawTraj(rF,rB,rS);drawBars(rF,rB,rS);
        out.textContent=T.cmpOut(rF.mse.toExponential(2), rF.tokens, rS.mse.toExponential(2), rS.tokens, rB.mse.toExponential(2), rB.tokens);
      }
      [smooth,scale,fsqN].forEach(el=>el.oninput=()=>{A=makeTraj();update();});
      noise.onchange=()=>{A=makeTraj();update();};
      update();
    })();
  }

  if (typeof window.document$ !== 'undefined' && window.document$.subscribe) {
    window.document$.subscribe(run);            // Material instant loading：每次翻页都触发
  } else if (document.readyState !== 'loading') {
    run();
  } else {
    document.addEventListener('DOMContentLoaded', run);
  }
})();

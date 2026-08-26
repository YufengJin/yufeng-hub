/* ml/fm-solvers 笔记的交互 demo（流匹配 ODE 求解器）。
 * 移植自 fm_solver_exp/solver_blog_offline.html：
 *   - CSS 变量全部改用 --fms-* 前缀（定义在 stylesheets/extra.css），不污染全局；
 *   - 站点为单一浅色主题，已移除原页的 data-theme / prefers-color-scheme 监听；
 *   - 悬停读数的 tooltip 改为脚本按需创建（#fmsTip）；
 *   - 图 5/6 的 REAL 数据逐字来自 fm_solver_exp/summary.csv 的真实实验，不得改动。
 * 结构沿用仓库惯例：extra_javascript + document$.subscribe（存在性守卫，翻页安全）。 */
(function () {
  /* 页面语言：构建后英文页在 /en/ 子路径下 */
  const EN = location.pathname.indexOf('/en/') !== -1;
  /* 所有渲染给读者看的文案集中在这里；坐标/颜色/实验数据不随语言改变 */
  const T = EN ? {
    descEuler: "One evaluation: the start velocity k₁ is used for the whole step. The tangent drifts further and further off the arc.",
    descMidpoint: "A half-step probe takes the midpoint velocity k₂ — the direction is already “pre-bent”, and the error goes from O(dt²) to O(dt³).",
    descHeun: "A full-step probe gives k₂, averaged with k₁ — the trapezoidal rule, also order 2 but with a different error constant.",
    descRk4: "Four evaluations weighted as (k₁+2k₂+2k₃+k₄)/6 — essentially Simpson integration inside the step.",
    trueSol: "exact",
    errName: "error",
    convTitle: "Endpoint error of dx/dt = x² (exact x(1)=1)",
    nfeLog: "NFE (log)",
    convYlabel: "|x(1) − 1| (log)",
    dpXlabel: "t (integration time)",
    dpYlabel: "dt (log)",
    epYlabel: "endpoint_err (log)"
  } : {
    descEuler: "一次评估：起点速度 k₁ 用到底。切线离弧线越走越远。",
    descMidpoint: "半步探路取中点速度 k₂——方向已经「预弯」，误差从 O(dt²) 变 O(dt³)。",
    descHeun: "满步探路得 k₂，与 k₁ 取平均——梯形法，同为 2 阶但误差常数不同。",
    descRk4: "四次评估加权 (k₁+2k₂+2k₃+k₄)/6——本质是在步内做 Simpson 积分。",
    trueSol: "真解",
    errName: "误差",
    convTitle: "dx/dt = x² 的终点误差（真解 x(1)=1）",
    nfeLog: "NFE（log）",
    convYlabel: "|x(1) − 1|（log）",
    dpXlabel: "t（积分时间）",
    dpYlabel: "dt（log）",
    epYlabel: "endpoint_err（log）"
  };

  function run() {
    if (!document.getElementById("heroCv") && !document.getElementById("anatomyCv")) return;
    "use strict";
    /* ================= utilities ================= */
    const $=id=>document.getElementById(id);
    const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const SOLVERS=["euler","midpoint","heun","rk4"];
    const SNAME={euler:"Euler",midpoint:"Midpoint",heun:"Heun",rk4:"RK4",dopri5:"Dopri5"};
    const scolor=s=>css("--fms-"+s);
    const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* module isolation: one failing module must not kill the others */
    function safe(fn){try{fn();}catch(e){console.error("[tutorial] module failed:",e);}}

    /* resize redraw registry (site is single light theme — no theme observer) */
    const redraws=[];
    function onTheme(fn){redraws.push(fn);}
    function redrawAll(){redraws.forEach(f=>{try{f();}catch(e){}});}
    addEventListener("resize",redrawAll);
    /* iframe-safe: artifact viewers may lay us out late (clientWidth=0 at load,
       no resize event) — redraw everything whenever real width appears/changes */
    safe(function(){let lastW=-1;
      function check(){const w=document.documentElement.clientWidth;
        if(w>0&&w!==lastW){lastW=w;redrawAll();}}
      if(typeof ResizeObserver!=="undefined")
        new ResizeObserver(check).observe(document.documentElement);
      else{let n=0;const iv=setInterval(function(){check();if(++n>40)clearInterval(iv);},250);}
    });

    /* seeded rng + gaussians */
    function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
      let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
      return((t^t>>>14)>>>0)/4294967296;}}
    function gaussPair(rng){const u=Math.max(rng(),1e-12),v=rng();
      const r=Math.sqrt(-2*Math.log(u));return[r*Math.cos(2*Math.PI*v),r*Math.sin(2*Math.PI*v)];}

    /* hi-dpi canvas prep; returns ctx sized in CSS px.
       NOTE: cache the design height on first call — cv.height=h*dpr rewrites the
       height attribute, so re-reading it each redraw would compound by dpr every
       hover/click and grow the panel without bound on retina/zoomed displays. */
    function prep(cv){const dpr=devicePixelRatio||1;
      if(cv._cssH===undefined)
        cv._cssH=parseInt(cv.getAttribute("height"))||cv.clientHeight;
      const w=cv.clientWidth,h=cv._cssH;
      cv.style.height=h+"px";cv.width=w*dpr;cv.height=h*dpr;
      const ctx=cv.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);return[ctx,w,h];}

    /* ============ exact FM field for 8 gaussians (closed form) ============ */
    const SIG2=0.0064; /* std=0.08 squared */
    const CX=[],CY=[];
    for(let k=0;k<8;k++){CX.push(Math.cos(k*Math.PI/4));CY.push(Math.sin(k*Math.PI/4));}
    /* v(x,t)=Σ w_k [ μ_k + c·(x−tμ_k) ],  w_k ∝ exp(−|x−tμ_k|²/2s²) */
    function fmField(x,y,t,out){
      const s2=(1-t)*(1-t)+t*t*SIG2, c=((t-1)+t*SIG2)/s2;
      let dmin=1e30;const d2=fmField._d2||(fmField._d2=new Float64Array(8));
      for(let k=0;k<8;k++){const dx=x-t*CX[k],dy=y-t*CY[k];
        d2[k]=dx*dx+dy*dy;if(d2[k]<dmin)dmin=d2[k];}
      let sw=0,vx=0,vy=0;
      for(let k=0;k<8;k++){const w=Math.exp(-(d2[k]-dmin)/(2*s2));sw+=w;
        vx+=w*(CX[k]+c*(x-t*CX[k]));vy+=w*(CY[k]+c*(y-t*CY[k]));}
      out[0]=vx/sw;out[1]=vy/sw;}

    /* batch integrators on fmField (arrays xs,ys mutated) */
    function stepBatch(method,xs,ys,t,dt){
      const n=xs.length,v=[0,0];
      if(method==="euler"){for(let i=0;i<n;i++){fmField(xs[i],ys[i],t,v);
        xs[i]+=dt*v[0];ys[i]+=dt*v[1];}return 1;}
      if(method==="midpoint"){for(let i=0;i<n;i++){fmField(xs[i],ys[i],t,v);
        const mx=xs[i]+.5*dt*v[0],my=ys[i]+.5*dt*v[1];
        fmField(mx,my,t+.5*dt,v);xs[i]+=dt*v[0];ys[i]+=dt*v[1];}return 2;}
      if(method==="heun"){for(let i=0;i<n;i++){fmField(xs[i],ys[i],t,v);
        const k1x=v[0],k1y=v[1];
        fmField(xs[i]+dt*k1x,ys[i]+dt*k1y,t+dt,v);
        xs[i]+=.5*dt*(k1x+v[0]);ys[i]+=.5*dt*(k1y+v[1]);}return 2;}
      /* rk4 */
      for(let i=0;i<n;i++){const x=xs[i],y=ys[i];
        fmField(x,y,t,v);const k1x=v[0],k1y=v[1];
        fmField(x+.5*dt*k1x,y+.5*dt*k1y,t+.5*dt,v);const k2x=v[0],k2y=v[1];
        fmField(x+.5*dt*k2x,y+.5*dt*k2y,t+.5*dt,v);const k3x=v[0],k3y=v[1];
        fmField(x+dt*k3x,y+dt*k3y,t+dt,v);
        xs[i]+=dt/6*(k1x+2*k2x+2*k3x+v[0]);ys[i]+=dt/6*(k1y+2*k2y+2*k3y+v[1]);}
      return 4;}

    /* ================= HERO: particles flowing along the FM field ================= */
    safe(function(){
      const cv=$("heroCv");let W,H,ctx;
      const N=520,rng=mulberry32(42);
      const px=new Float64Array(N),py=new Float64Array(N),age=new Float64Array(N);
      function reset(i){const g=gaussPair(rng);px[i]=g[0];py[i]=g[1];age[i]=rng()*0.2;}
      for(let i=0;i<N;i++)reset(i);
      const S=150; /* px per unit */
      function toPx(x,y){return[W/2+x*S*(W/900),H/2-y*S*(W/900)*0.92];}
      function frame(){
        [ctx,W,H]=[cv.getContext("2d"),cv.clientWidth,cv.clientHeight];
        const dpr=devicePixelRatio||1;
        if(cv.width!==W*dpr){cv.width=W*dpr;cv.height=H*dpr;}
        ctx.setTransform(dpr,0,0,dpr,0,0);
        ctx.fillStyle=css("--fms-bg");ctx.fillRect(0,0,W,H);
        /* faint direction field at t=0.5 */
        ctx.strokeStyle=css("--fms-line");ctx.lineWidth=1;const v=[0,0];
        for(let gx=-3;gx<=3;gx+=0.5)for(let gy=-1.6;gy<=1.6;gy+=0.45){
          fmField(gx,gy,0.5,v);const n=Math.hypot(v[0],v[1])||1;
          const[ax,ay]=toPx(gx,gy),L=9;
          ctx.beginPath();ctx.moveTo(ax-v[0]/n*L,ay+v[1]/n*L);
          ctx.lineTo(ax+v[0]/n*L,ay-v[1]/n*L);ctx.stroke();}
        /* particles: advance along field, color by t */
        const acc=css("--fms-midpoint");
        for(let i=0;i<N;i++){
          const t=age[i];
          if(t>=1){ /* hold briefly at target then respawn */
            age[i]+=0.006;if(age[i]>1.25)reset(i);
          }else{
            fmField(px[i],py[i],t,v);const dt=0.007;
            /* midpoint step for smooth trails */
            const mx=px[i]+.5*dt*v[0],my=py[i]+.5*dt*v[1];
            fmField(mx,my,Math.min(t+.5*dt,0.9999),v);
            px[i]+=dt*v[0];py[i]+=dt*v[1];age[i]+=dt;
          }
          const[X,Y]=toPx(px[i],py[i]);
          ctx.globalAlpha=t>=1?0.85:0.25+0.5*t;
          ctx.fillStyle=acc;
          ctx.beginPath();ctx.arc(X,Y,t>=1?2.1:1.6,0,7);ctx.fill();}
        ctx.globalAlpha=1;
        /* true mode marks */
        ctx.strokeStyle=css("--fms-euler");ctx.lineWidth=1.6;
        for(let k=0;k<8;k++){const[X,Y]=toPx(CX[k],CY[k]);
          ctx.beginPath();ctx.moveTo(X-5,Y-5);ctx.lineTo(X+5,Y+5);
          ctx.moveTo(X+5,Y-5);ctx.lineTo(X-5,Y+5);ctx.stroke();}
        if(!reduceMotion)requestAnimationFrame(frame);
      }
      if(reduceMotion){ /* static: integrate all to t=1 then draw once */
        for(let i=0;i<N;i++){let t=0;while(t<1){const dt=Math.min(0.02,1-t);
          stepBatch("midpoint",px.subarray(i,i+1),py.subarray(i,i+1),t,dt);t+=dt;}age[i]=1;}
        frame();onTheme(frame);
      }else{requestAnimationFrame(frame);onTheme(()=>{});}
    });

    /* ================= §2 step anatomy ================= */
    safe(function(){
      const cv=$("anatomyCv");
      let method="euler";
      const seg=$("anatomySeg");
      SOLVERS.forEach(s=>{const b=document.createElement("button");
        b.textContent=SNAME[s];b.style.color="";
        b.addEventListener("click",()=>{method=s;sync();});seg.appendChild(b);});
      const slider=$("anatomyDt");
      const DESC={euler:T.descEuler,midpoint:T.descMidpoint,
        heun:T.descHeun,rk4:T.descRk4};
      /* rotation field: exact solution = circular arc */
      const om=1;const f=(x,y)=>[-om*y,om*x];
      function draw(){
        const dt=parseFloat(slider.value);
        $("anatomyDtVal").textContent=dt.toFixed(2);
        const[ctx,W,H]=prep(cv);
        ctx.fillStyle=css("--fms-panel");ctx.fillRect(0,0,W,H);
        const R=Math.min(W,H)*0.40,Cx=W/2,Cy=H*0.60;
        const toPx=(x,y)=>[Cx+x*R,Cy-y*R];
        /* true circle (faint) + start point at angle -0.5 */
        ctx.strokeStyle=css("--fms-grid");ctx.lineWidth=1;
        ctx.beginPath();ctx.arc(Cx,Cy,R,0,7);ctx.stroke();
        const a0=-0.45,x0=Math.cos(a0),y0=Math.sin(a0);
        /* true arc over dt (thick, muted ink) */
        ctx.strokeStyle=css("--fms-muted");ctx.lineWidth=2.5;ctx.beginPath();
        for(let i=0;i<=40;i++){const a=a0+dt*i/40;const[X,Y]=toPx(Math.cos(a),Math.sin(a));
          i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);}ctx.stroke();
        const trueEnd=[Math.cos(a0+dt),Math.sin(a0+dt)];
        /* stage geometry per method */
        const col=scolor(method);
        function arrow(x,y,vx,vy,len,color,dash){
          const n=Math.hypot(vx,vy)||1;const ex=x+vx/n*len,ey=y+vy/n*len;
          const[X1,Y1]=toPx(x,y),[X2,Y2]=toPx(ex,ey);
          ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;
          ctx.setLineDash(dash?[5,4]:[]);
          ctx.beginPath();ctx.moveTo(X1,Y1);ctx.lineTo(X2,Y2);ctx.stroke();ctx.setLineDash([]);
          const ang=Math.atan2(Y2-Y1,X2-X1);
          ctx.beginPath();ctx.moveTo(X2,Y2);
          ctx.lineTo(X2-8*Math.cos(ang-0.42),Y2-8*Math.sin(ang-0.42));
          ctx.lineTo(X2-8*Math.cos(ang+0.42),Y2-8*Math.sin(ang+0.42));
          ctx.closePath();ctx.fill();
          return[ex,ey];}
        function dot(x,y,color,r){const[X,Y]=toPx(x,y);
          ctx.fillStyle=color;ctx.beginPath();ctx.arc(X,Y,r||4,0,7);ctx.fill();}
        function label(x,y,txt,color,dyPx){const[X,Y]=toPx(x,y);
          ctx.fillStyle=color;ctx.font="600 13px "+css("--fms-mono");
          ctx.fillText(txt,X+8,Y+(dyPx||-8));}
        const alen=v=>Math.hypot(v[0],v[1])*dt; /* arrow length == dt*|v| in field units */
        let end,nfe;
        const k1=f(x0,y0);
        if(method==="euler"){
          arrow(x0,y0,k1[0],k1[1],alen(k1),col);
          end=[x0+dt*k1[0],y0+dt*k1[1]];nfe=1;
          label(x0,y0,"k₁",col);
        }else if(method==="midpoint"){
          const mx=x0+.5*dt*k1[0],my=y0+.5*dt*k1[1];
          arrow(x0,y0,k1[0],k1[1],alen(k1)*.5,css("--fms-muted"),true);
          dot(mx,my,css("--fms-muted"),3);label(x0,y0,"k₁·dt/2",css("--fms-muted"));
          const k2=f(mx,my);
          arrow(x0,y0,k2[0],k2[1],alen(k2),col);
          label(mx,my,"k₂",col,-10);
          end=[x0+dt*k2[0],y0+dt*k2[1]];nfe=2;
        }else if(method==="heun"){
          const ex=x0+dt*k1[0],ey=y0+dt*k1[1];
          arrow(x0,y0,k1[0],k1[1],alen(k1),css("--fms-muted"),true);
          dot(ex,ey,css("--fms-muted"),3);label(x0,y0,"k₁",css("--fms-muted"));
          const k2=f(ex,ey);
          arrow(ex,ey,k2[0],k2[1],alen(k2)*.6,css("--fms-muted"),true);
          label(ex,ey,"k₂",css("--fms-muted"),14);
          const ax=(k1[0]+k2[0])/2,ay=(k1[1]+k2[1])/2;
          arrow(x0,y0,ax,ay,Math.hypot(ax,ay)*dt,col);
          label(x0+dt*ax*.55,y0+dt*ay*.55,"(k₁+k₂)/2",col,-10);
          end=[x0+dt*ax,y0+dt*ay];nfe=2;
        }else{ /* rk4 */
          const m1x=x0+.5*dt*k1[0],m1y=y0+.5*dt*k1[1];const k2=f(m1x,m1y);
          const m2x=x0+.5*dt*k2[0],m2y=y0+.5*dt*k2[1];const k3=f(m2x,m2y);
          const e3x=x0+dt*k3[0],e3y=y0+dt*k3[1];const k4=f(e3x,e3y);
          arrow(x0,y0,k1[0],k1[1],alen(k1)*.45,css("--fms-muted"),true);
          dot(m1x,m1y,css("--fms-muted"),3);label(m1x,m1y,"k₂",css("--fms-muted"),-8);
          dot(m2x,m2y,css("--fms-muted"),3);label(m2x,m2y,"k₃",css("--fms-muted"),14);
          dot(e3x,e3y,css("--fms-muted"),3);label(e3x,e3y,"k₄",css("--fms-muted"),14);
          const ax=(k1[0]+2*k2[0]+2*k3[0]+k4[0])/6,ay=(k1[1]+2*k2[1]+2*k3[1]+k4[1])/6;
          arrow(x0,y0,ax,ay,Math.hypot(ax,ay)*dt,col);
          label(x0+dt*ax*.5,y0+dt*ay*.5,"Σwᵢkᵢ",col,-10);
          end=[x0+dt*ax,y0+dt*ay];nfe=4;
        }
        /* start, numeric end, true end */
        dot(x0,y0,css("--fms-ink"),4.5);label(x0,y0,"x₀",css("--fms-ink"),20);
        dot(end[0],end[1],col,5);
        dot(trueEnd[0],trueEnd[1],css("--fms-muted"),4);
        label(trueEnd[0],trueEnd[1],T.trueSol,css("--fms-muted"),-10);
        /* error segment */
        ctx.strokeStyle=css("--fms-bad");ctx.lineWidth=1.4;ctx.setLineDash([3,3]);
        const[Xa,Ya]=toPx(end[0],end[1]),[Xb,Yb]=toPx(trueEnd[0],trueEnd[1]);
        ctx.beginPath();ctx.moveTo(Xa,Ya);ctx.lineTo(Xb,Yb);ctx.stroke();ctx.setLineDash([]);
        const err=Math.hypot(end[0]-trueEnd[0],end[1]-trueEnd[1]);
        $("anatomyNfe").textContent=nfe;
        $("anatomyErr").textContent=err.toExponential(2);
        $("anatomyDesc").textContent=DESC[method];
        [...seg.children].forEach((b,i)=>b.setAttribute("aria-pressed",SOLVERS[i]===method));
      }
      function sync(){draw();}
      slider.addEventListener("input",draw);
      onTheme(draw);draw();
    });

    /* ================= shared mini chart (canvas, log/linear, hover) ================= */
    const tip=(function(){let el=$("fmsTip");
      if(!el){el=document.createElement("div");el.id="fmsTip";el.setAttribute("role","status");
        document.body.appendChild(el);}return el;})();
    function chart(cv,cfg){
      /* cfg: {panels:[{title,series:[{label,color,pts:[[x,y]],star}],refs,xlog,ylog,
                  xlabel,ylabel,floors:[{y,label}]}]} vertical stack */
      const hover={p:null};
      function draw(){
        const[ctx,W,Htot]=prep(cv);
        ctx.fillStyle=css("--fms-panel");ctx.fillRect(0,0,W,Htot);
        const nP=cfg.panels.length,H=Htot/nP;
        const hits=[];
        cfg.panels.forEach((P,pi)=>{
          const top=pi*H,m={l:64,r:16,t:34,b:44};
          const pw=W-m.l-m.r,ph=H-m.t-m.b;
          let xs=[],ys=[];
          P.series.forEach(s=>s.pts.forEach(p=>{xs.push(p[0]);ys.push(p[1]);}));
          (P.floors||[]).forEach(f=>ys.push(f.y));
          const tx=v=>P.xlog?Math.log10(v):v, ty=v=>P.ylog?Math.log10(v):v;
          let x0=Math.min(...xs.map(tx)),x1=Math.max(...xs.map(tx));
          let y0=Math.min(...ys.map(ty)),y1=Math.max(...ys.map(ty));
          const padY=(y1-y0)*0.08||1;y0-=padY;y1+=padY;
          const X=v=>m.l+(tx(v)-x0)/(x1-x0)*pw;
          const Y=v=>top+m.t+ph-(ty(v)-y0)/(y1-y0)*ph;
          const labels=[]; /* end-of-line direct labels, drawn after all series */
          /* grid + ticks */
          ctx.strokeStyle=css("--fms-grid");ctx.fillStyle=css("--fms-muted");
          ctx.lineWidth=1;ctx.font="11px "+css("--fms-mono");
          function xticks(){const out=[];
            if(P.xlog){for(let e=Math.floor(x0);e<=Math.ceil(x1);e++)
              for(const mfac of[1,2,5]){const v=mfac*Math.pow(10,e);
                if(Math.log10(v)>=x0-1e-9&&Math.log10(v)<=x1+1e-9)out.push(v);}}
            else{const step=Math.pow(10,Math.floor(Math.log10((x1-x0)/5)));
              for(let v=Math.ceil(x0/step)*step;v<=x1;v+=step)out.push(v);}
            return out;}
          function yticks(){const out=[];
            if(P.ylog){for(let e=Math.floor(y0);e<=Math.ceil(y1);e++)
              if(e>=y0-1e-9&&e<=y1+1e-9)out.push(Math.pow(10,e));}
            else{const raw=(y1-y0)/5;const mag=Math.pow(10,Math.floor(Math.log10(raw)));
              const step=raw/mag>5?10*mag:raw/mag>2?5*mag:raw/mag>1?2*mag:mag;
              for(let v=Math.ceil(y0/step)*step;v<=y1+1e-12;v+=step)out.push(v);}
            return out;}
          ctx.textAlign="center";
          xticks().forEach(v=>{const px=X(v);
            ctx.beginPath();ctx.moveTo(px,top+m.t);ctx.lineTo(px,top+m.t+ph);ctx.stroke();
            ctx.fillText(P.xlog&&v>=1000?(v/1000)+"k":String(Math.round(v*100)/100),px,top+m.t+ph+16);});
          ctx.textAlign="right";
          yticks().forEach(v=>{const py=Y(v);
            ctx.beginPath();ctx.moveTo(m.l,py);ctx.lineTo(m.l+pw,py);ctx.stroke();
            const lab=P.ylog?(v>=1?String(v):"1e"+Math.round(Math.log10(v))):String(Math.round(v*1000)/1000);
            ctx.fillText(lab,m.l-8,py+4);});
          /* reference slope lines */
          (P.refs||[]).forEach(rf=>{ /* {slope, anchor:[x,y]} in data coords, log-log */
            ctx.strokeStyle=css("--fms-line");ctx.setLineDash([5,4]);ctx.lineWidth=1.2;
            const xa=Math.pow(10,x0+0.04*(x1-x0)),xb=Math.pow(10,x1-0.04*(x1-x0));
            const f=x=>rf.anchor[1]*Math.pow(x/rf.anchor[0],rf.slope);
            ctx.beginPath();ctx.moveTo(X(xa),Y(f(xa)));ctx.lineTo(X(xb),Y(f(xb)));ctx.stroke();
            ctx.setLineDash([]);ctx.fillStyle=css("--fms-muted");ctx.textAlign="left";
            const ylab=f(xb);
            if(ty(ylab)>y0&&ty(ylab)<y1)ctx.fillText(rf.label,X(xb)-34,Y(ylab)-6);});
          /* floors */
          (P.floors||[]).forEach(fl=>{
            ctx.strokeStyle=css("--fms-muted");ctx.setLineDash([2,4]);ctx.lineWidth=1.2;
            ctx.beginPath();ctx.moveTo(m.l,Y(fl.y));ctx.lineTo(m.l+pw,Y(fl.y));ctx.stroke();
            ctx.setLineDash([]);ctx.textAlign="left";ctx.fillStyle=css("--fms-muted");
            ctx.fillText(fl.label,m.l+6,Y(fl.y)-5);});
          /* series */
          P.series.forEach(s=>{
            ctx.strokeStyle=s.color();ctx.fillStyle=s.color();ctx.lineWidth=2;
            ctx.beginPath();
            s.pts.forEach((p,i)=>{const px=X(p[0]),py=Y(p[1]);
              i?ctx.lineTo(px,py):ctx.moveTo(px,py);});
            ctx.stroke();
            s.pts.forEach(p=>{const px=X(p[0]),py=Y(p[1]);
              hits.push({x:px,y:py,s,p,panel:P});
              ctx.beginPath();
              if(s.star){ctx.save();ctx.translate(px,py);
                for(let a=0;a<5;a++){const th=-Math.PI/2+a*2*Math.PI/5;
                  a?ctx.lineTo(5.4*Math.cos(th),5.4*Math.sin(th)):ctx.moveTo(0,-5.4);
                  const th2=th+Math.PI/5;ctx.lineTo(2.3*Math.cos(th2),2.3*Math.sin(th2));}
                ctx.closePath();ctx.fill();ctx.restore();}
              else{ctx.arc(px,py,3.2,0,7);ctx.fill();
                ctx.strokeStyle=css("--fms-panel");ctx.lineWidth=1.2;ctx.stroke();
                ctx.strokeStyle=s.color();ctx.lineWidth=2;}});
            /* collect direct label for de-collision pass below */
            const last=s.pts[s.pts.length-1];
            labels.push({x:X(last[0])+8,y:Y(last[1])+4,txt:s.label,color:s.color()});});
          /* direct labels: clamp inside right edge, push overlaps apart */
          ctx.font="600 11px "+css("--fms-mono");ctx.textAlign="left";
          labels.forEach(L=>{L.w=ctx.measureText(L.txt).width;
            L.x=Math.min(L.x,W-m.r-L.w-2);});
          labels.sort((a,b)=>a.y-b.y);
          for(let i=1;i<labels.length;i++){
            const b=labels[i];
            for(let j=0;j<i;j++){const a=labels[j];
              const xOverlap=b.x<a.x+a.w+6&&a.x<b.x+b.w+6;
              if(xOverlap&&Math.abs(b.y-a.y)<13)b.y=a.y+13;}}
          labels.forEach(L=>{ctx.fillStyle=L.color;ctx.fillText(L.txt,L.x,L.y);});
          /* titles + axis labels */
          ctx.fillStyle=css("--fms-ink");ctx.font="600 13px "+css("--fms-sans");
          ctx.textAlign="left";ctx.fillText(P.title,m.l,top+18);
          ctx.fillStyle=css("--fms-muted");ctx.font="11px "+css("--fms-mono");
          ctx.textAlign="center";ctx.fillText(P.xlabel||"NFE",m.l+pw/2,top+m.t+ph+34);
          ctx.save();ctx.translate(14,top+m.t+ph/2);ctx.rotate(-Math.PI/2);
          ctx.fillText(P.ylabel||"",0,0);ctx.restore();
          /* hover marker */
          if(hover.p&&hits.includes(hover.p)){
            ctx.strokeStyle=css("--fms-ink");ctx.lineWidth=1.4;
            ctx.beginPath();ctx.arc(hover.p.x,hover.p.y,6,0,7);ctx.stroke();}
        });
        draw._hits=hits;
      }
      cv.addEventListener("pointermove",e=>{
        const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
        let best=null,bd=18*18;
        (draw._hits||[]).forEach(h=>{const d=(h.x-mx)**2+(h.y-my)**2;
          if(d<bd){bd=d;best=h;}});
        if(best!==hover.p){hover.p=best;draw();}
        if(best){tip.style.opacity=1;
          tip.style.left=Math.min(e.clientX+14,innerWidth-240)+"px";
          tip.style.top=(e.clientY+14)+"px";
          tip.innerHTML=`<b style="color:${best.s.color()}">${best.s.label}</b> ${best.s.cfglab||""}`+
            `<br>NFE ${best.p[0]}<br>${cv._yname||"y"} ${best.p[1]<0.01?best.p[1].toExponential(2):best.p[1].toFixed(4)}`;}
        else tip.style.opacity=0;});
      cv.addEventListener("pointerleave",()=>{tip.style.opacity=0;
        if(hover.p){hover.p=null;draw();}});
      onTheme(draw);draw();
      return draw;
    }
    function legendInto(el,solvers){
      el.innerHTML=solvers.map(s=>
        `<span><span class="fms-chip fms-c-${s}"></span>${SNAME[s]}</span>`).join("");}

    /* ================= §3 convergence on dx/dt = x² =================
       NOTE: deliberately nonlinear — on a LINEAR ODE (e.g. dx/dt=x) the
       midpoint and heun updates are algebraically identical, so their
       curves coincide bitwise and the chart looks broken. */
    safe(function(){
      const f=x=>x*x, X0=0.5, E=1.0; /* true solution: x(t)=1/(2-t), x(1)=1 */
      function solve(method,steps){
        let x=X0;const dt=1/steps;
        for(let i=0;i<steps;i++){const t=i*dt;
          if(method==="euler")x+=dt*f(x);
          else if(method==="midpoint"){const k1=f(x);x+=dt*f(x+.5*dt*k1);}
          else if(method==="heun"){const k1=f(x);const k2=f(x+dt*k1);x+=.5*dt*(k1+k2);}
          else{const k1=f(x),k2=f(x+.5*dt*k1),k3=f(x+.5*dt*k2),k4=f(x+dt*k3);
            x+=dt/6*(k1+2*k2+2*k3+k4);}}
        return x;}
      const grid=[2,4,8,16,32,64,128,256];
      const mult={euler:1,midpoint:2,heun:2,rk4:4};
      const series=SOLVERS.map(s=>({label:SNAME[s],color:()=>scolor(s),
        pts:grid.map(n=>[n*mult[s],Math.abs(solve(s,n)-E)])}));
      legendInto($("convLegend"),SOLVERS);
      const anchor=[2,Math.abs(solve("euler",2)-E)];
      $("convCv")._yname=T.errName;
      chart($("convCv"),{panels:[{
        title:T.convTitle,
        series,xlog:true,ylog:true,xlabel:T.nfeLog,ylabel:T.convYlabel,
        refs:[{slope:-1,anchor,label:"−1"},{slope:-2,anchor,label:"−2"},
              {slope:-4,anchor,label:"−4"}]}]});
    });

    /* ================= §4 dopri5 on the FM field ================= */
    safe(function(){
      const A=[[],[1/5],[3/40,9/40],[44/45,-56/15,32/9],
        [19372/6561,-25360/2187,64448/6561,-212/729],
        [9017/3168,-355/33,46732/5247,49/176,-5103/18656],
        [35/384,0,500/1113,125/192,-2187/6784,11/84]];
      const C=[0,1/5,3/10,4/5,8/9,1,1];
      const B5=[35/384,0,500/1113,125/192,-2187/6784,11/84,0];
      const B4=[5179/57600,0,7571/16695,393/640,-92097/339200,187/2100,1/40];
      const N=512;
      function run(rtol){
        const atol=rtol/100,rng=mulberry32(123);
        const xs=new Float64Array(N),ys=new Float64Array(N);
        for(let i=0;i<N;i++){const g=gaussPair(rng);xs[i]=g[0];ys[i]=g[1];}
        const kx=[],ky=[];for(let s=0;s<7;s++){kx.push(new Float64Array(N));ky.push(new Float64Array(N));}
        const v=[0,0];let t=0,dt=0.1,nfe=0;
        for(let i=0;i<N;i++){fmField(xs[i],ys[i],0,v);kx[0][i]=v[0];ky[0][i]=v[1];}
        nfe++;
        const steps=[];let guard=0;
        while(t<1-1e-12&&guard++<3000){
          if(t+dt>1)dt=1-t;
          for(let s=1;s<7;s++){
            for(let i=0;i<N;i++){let ax=xs[i],ay=ys[i];
              for(let j=0;j<s;j++){const a=A[s][j];if(a){ax+=dt*a*kx[j][i];ay+=dt*a*ky[j][i];}}
              fmField(ax,ay,t+C[s]*dt,v);kx[s][i]=v[0];ky[s][i]=v[1];}
            nfe++;}
          let se=0;
          const y5x=new Float64Array(N),y5y=new Float64Array(N);
          for(let i=0;i<N;i++){let ax=xs[i],ay=ys[i],bx=xs[i],by=ys[i];
            for(let s=0;s<7;s++){if(B5[s]){ax+=dt*B5[s]*kx[s][i];ay+=dt*B5[s]*ky[s][i];}
              if(B4[s]){bx+=dt*B4[s]*kx[s][i];by+=dt*B4[s]*ky[s][i];}}
            y5x[i]=ax;y5y[i]=ay;
            const scx=atol+rtol*Math.max(Math.abs(xs[i]),Math.abs(ax));
            const scy=atol+rtol*Math.max(Math.abs(ys[i]),Math.abs(ay));
            se+=((ax-bx)/scx)**2+((ay-by)/scy)**2;}
          const err=Math.sqrt(se/(2*N));
          const ok=err<=1;
          steps.push({t,dt,ok});
          if(ok){t+=dt;xs.set(y5x);ys.set(y5y);
            kx[0].set(kx[6]);ky[0].set(ky[6]);}
          let fac=err===0?5:0.9*Math.pow(err,-0.2);
          dt*=Math.min(5,Math.max(0.2,fac));}
        return{steps,nfe};
      }
      const RTOLS=[1e-2,3e-3,1e-3,3e-4,1e-4];
      const cache={};let cur=1e-3;
      const seg=$("dpSeg");
      RTOLS.forEach(r=>{const b=document.createElement("button");
        b.textContent=r.toExponential(0).replace("e-","e−");
        b.addEventListener("click",()=>{cur=r;draw();});seg.appendChild(b);});
      function draw(){
        const res=cache[cur]||(cache[cur]=run(cur));
        [...seg.children].forEach((b,i)=>b.setAttribute("aria-pressed",RTOLS[i]===cur));
        const[ctx,W,H]=prep($("dpCv"));
        ctx.fillStyle=css("--fms-panel");ctx.fillRect(0,0,W,H);
        const m={l:60,r:14,t:14,b:40},pw=W-m.l-m.r,ph=H-m.t-m.b;
        const dts=res.steps.map(s=>s.dt);
        const lmin=Math.log10(Math.min(...dts))-0.15,lmax=Math.log10(Math.max(...dts))+0.15;
        const X=t=>m.l+t*pw, Y=dt=>m.t+ph-(Math.log10(dt)-lmin)/(lmax-lmin)*ph;
        /* grid */
        ctx.strokeStyle=css("--fms-grid");ctx.fillStyle=css("--fms-muted");
        ctx.font="11px "+css("--fms-mono");ctx.textAlign="right";
        for(let e=Math.ceil(lmin);e<=Math.floor(lmax);e++){const py=Y(Math.pow(10,e));
          ctx.beginPath();ctx.moveTo(m.l,py);ctx.lineTo(m.l+pw,py);ctx.stroke();
          ctx.fillText("1e"+e,m.l-8,py+4);}
        ctx.textAlign="center";
        for(let tt=0;tt<=1.001;tt+=0.2){ctx.beginPath();ctx.moveTo(X(tt),m.t);
          ctx.lineTo(X(tt),m.t+ph);ctx.stroke();ctx.fillText(tt.toFixed(1),X(tt),m.t+ph+16);}
        ctx.fillText(T.dpXlabel,m.l+pw/2,m.t+ph+32);
        ctx.save();ctx.translate(14,m.t+ph/2);ctx.rotate(-Math.PI/2);
        ctx.fillText(T.dpYlabel,0,0);ctx.restore();
        /* bars */
        let acc=0,rej=0;
        res.steps.forEach(s=>{
          const x1=X(s.t),x2=X(Math.min(s.t+s.dt,1)),py=Y(s.dt);
          if(s.ok){ctx.fillStyle=scolor("dopri5");ctx.globalAlpha=0.75;
            ctx.fillRect(x1,py,Math.max(x2-x1-1.5,1.5),m.t+ph-py);acc++;}
          else{ctx.globalAlpha=0.9;ctx.strokeStyle=css("--fms-bad");ctx.lineWidth=1.4;
            ctx.strokeRect(x1,py,Math.max(x2-x1-1.5,2),m.t+ph-py);rej++;}
          ctx.globalAlpha=1;});
        $("dpAcc").textContent=acc;$("dpRej").textContent=rej;
        $("dpNfe").textContent=res.nfe;
        $("dpRange").textContent=Math.min(...dts).toExponential(1)+" / "+Math.max(...dts).toExponential(1);
      }
      onTheme(draw);draw();
    });

    /* ================= §5 playground ================= */
    safe(function(){
      const N=1500,GRID=[2,3,4,6,8,12,20,40,80];
      let method="euler",stepIdx=3;
      const rng0=mulberry32(123);
      const Z0x=new Float64Array(N),Z0y=new Float64Array(N);
      for(let i=0;i<N;i++){const g=gaussPair(rng0);Z0x[i]=g[0];Z0y[i]=g[1];}
      /* real samples for overlay */
      const rngR=mulberry32(7),RN=1200,Rx=new Float64Array(RN),Ry=new Float64Array(RN);
      for(let i=0;i<RN;i++){const k=Math.floor(rngR()*8),g=gaussPair(rngR);
        Rx[i]=CX[k]+0.08*g[0];Ry[i]=CY[k]+0.08*g[1];}
      const seg=$("pgSeg");
      [...SOLVERS,"dopri5"].forEach(s=>{const b=document.createElement("button");
        b.textContent=SNAME[s];
        b.addEventListener("click",()=>{method=s;draw();});seg.appendChild(b);});
      const slider=$("pgSteps");slider.max=GRID.length-1;
      const cache={};
      function integrate(){
        const key=method+(method==="dopri5"?"":GRID[stepIdx]);
        if(cache[key])return cache[key];
        const xs=Float64Array.from(Z0x),ys=Float64Array.from(Z0y);
        let nfe=0;
        if(method==="dopri5"){
          /* fixed representative rtol=1e-3, batch-shared — reuse §4 machinery cheaply:
             simple adaptive loop, per spec */
          const rtol=1e-3,atol=rtol/100;
          let t=0,dt=0.1;const v=[0,0];
          const A=[[],[1/5],[3/40,9/40],[44/45,-56/15,32/9],
            [19372/6561,-25360/2187,64448/6561,-212/729],
            [9017/3168,-355/33,46732/5247,49/176,-5103/18656],
            [35/384,0,500/1113,125/192,-2187/6784,11/84]];
          const C=[0,1/5,3/10,4/5,8/9,1,1];
          const B5=[35/384,0,500/1113,125/192,-2187/6784,11/84,0];
          const B4=[5179/57600,0,7571/16695,393/640,-92097/339200,187/2100,1/40];
          const kx=[],ky=[];for(let s=0;s<7;s++){kx.push(new Float64Array(N));ky.push(new Float64Array(N));}
          for(let i=0;i<N;i++){fmField(xs[i],ys[i],0,v);kx[0][i]=v[0];ky[0][i]=v[1];}
          nfe++;let guard=0;
          while(t<1-1e-12&&guard++<2000){
            if(t+dt>1)dt=1-t;
            for(let s=1;s<7;s++){for(let i=0;i<N;i++){let ax=xs[i],ay=ys[i];
              for(let j=0;j<s;j++){const a=A[s][j];if(a){ax+=dt*a*kx[j][i];ay+=dt*a*ky[j][i];}}
              fmField(ax,ay,t+C[s]*dt,v);kx[s][i]=v[0];ky[s][i]=v[1];}nfe++;}
            let se=0;const y5x=new Float64Array(N),y5y=new Float64Array(N);
            for(let i=0;i<N;i++){let ax=xs[i],ay=ys[i],bx=xs[i],by=ys[i];
              for(let s=0;s<7;s++){if(B5[s]){ax+=dt*B5[s]*kx[s][i];ay+=dt*B5[s]*ky[s][i];}
                if(B4[s]){bx+=dt*B4[s]*kx[s][i];by+=dt*B4[s]*ky[s][i];}}
              y5x[i]=ax;y5y[i]=ay;
              const scx=atol+rtol*Math.max(Math.abs(xs[i]),Math.abs(ax));
              const scy=atol+rtol*Math.max(Math.abs(ys[i]),Math.abs(ay));
              se+=((ax-bx)/scx)**2+((ay-by)/scy)**2;}
            const err=Math.sqrt(se/(2*N));
            if(err<=1){t+=dt;xs.set(y5x);ys.set(y5y);kx[0].set(kx[6]);ky[0].set(ky[6]);}
            dt*=Math.min(5,Math.max(0.2,err===0?5:0.9*Math.pow(err,-0.2)));}
        }else{
          const steps=GRID[stepIdx],dt=1/steps;
          let perStep=0;
          for(let i=0;i<steps;i++)perStep=stepBatch(method,xs,ys,i*dt,dt);
          nfe=steps*perStep;
        }
        /* metrics */
        let hq=0;const counts=new Array(8).fill(0);
        for(let i=0;i<N;i++){let bd=1e9,bk=0;
          for(let k=0;k<8;k++){const d=(xs[i]-CX[k])**2+(ys[i]-CY[k])**2;
            if(d<bd){bd=d;bk=k;}}
          if(Math.sqrt(bd)<0.16){hq++;counts[bk]++;}}
        const modes=counts.filter(c=>c>0.005*N).length;
        return cache[key]={xs,ys,nfe,hqf:hq/N,modes};
      }
      function draw(){
        stepIdx=parseInt(slider.value);
        const isAd=method==="dopri5";
        $("pgStepsLab").style.opacity=isAd?0.35:1;slider.disabled=isAd;
        $("pgStepsVal").textContent=isAd?"—":GRID[stepIdx];
        const r=integrate();
        [...seg.children].forEach((b,i)=>
          b.setAttribute("aria-pressed",[...SOLVERS,"dopri5"][i]===method));
        const[ctx,W,H]=prep($("pgCv"));
        ctx.fillStyle=css("--fms-panel");ctx.fillRect(0,0,W,H);
        const S=Math.min(W,H)/3.4,Cx0=W/2,Cy0=H/2;
        const toPx=(x,y)=>[Cx0+x*S,Cy0-y*S];
        /* faint unit circle */
        ctx.strokeStyle=css("--fms-grid");ctx.lineWidth=1;
        ctx.beginPath();ctx.arc(Cx0,Cy0,S,0,7);ctx.stroke();
        if($("pgShowReal").checked){
          ctx.fillStyle=css("--fms-muted");ctx.globalAlpha=0.30;
          for(let i=0;i<RN;i++){const[X,Y]=toPx(Rx[i],Ry[i]);
            ctx.beginPath();ctx.arc(X,Y,1.7,0,7);ctx.fill();}
          ctx.globalAlpha=1;}
        ctx.fillStyle=scolor(method);ctx.globalAlpha=0.45;
        for(let i=0;i<N;i++){const[X,Y]=toPx(r.xs[i],r.ys[i]);
          ctx.beginPath();ctx.arc(X,Y,2,0,7);ctx.fill();}
        ctx.globalAlpha=1;
        ctx.strokeStyle=css("--fms-euler");ctx.lineWidth=2;
        for(let k=0;k<8;k++){const[X,Y]=toPx(CX[k],CY[k]);
          ctx.beginPath();ctx.moveTo(X-6,Y-6);ctx.lineTo(X+6,Y+6);
          ctx.moveTo(X+6,Y-6);ctx.lineTo(X-6,Y+6);ctx.stroke();}
        $("pgNfe").textContent=r.nfe;
        $("pgHqf").textContent=r.hqf.toFixed(3);
        $("pgModes").textContent=r.modes;
      }
      slider.addEventListener("input",draw);
      $("pgShowReal").addEventListener("change",draw);
      onTheme(draw);draw();
    });

    /* ================= §6 real experiment data (from summary.csv) ================= */
    const REAL={
     /* [nfe, w2, endpoint_err] per solver, per dataset */
     eight_gaussians:{
      euler:[[2,.5231,.5127],[3,.2908,.2703],[4,.1941,.1663],[6,.1289,.0745],[8,.1224,.0551],[12,.1267,.0347],[20,.1266,.0220],[40,.1271,.0121],[80,.1296,.005738]],
      midpoint:[[4,.2793,.2612],[6,.1775,.1510],[8,.1384,.0973],[12,.1405,.0229],[16,.1307,.009940],[24,.1258,.005358],[40,.1278,.004738],[80,.1323,.002842],[160,.1313,.002074]],
      heun:[[4,.2804,.2403],[6,.1863,.1493],[8,.1495,.1018],[12,.1274,.0368],[16,.1238,.017932],[24,.1315,.009188],[40,.1300,.004677],[80,.1293,.003832],[160,.1312,.001530]],
      rk4:[[8,.1340,.0743],[12,.1275,.014487],[16,.1247,.010019],[24,.1336,.009172],[32,.1306,.007049],[48,.1289,.003399],[80,.1291,.003960],[160,.1320,.001691],[320,.1314,.001819]],
      dopri5:[[37,.1384,.008845],[49,.1338,.005836],[85,.1318,.003176],[133,.1314,.000943],[307,.1309,.000729],[529,.1309,.000273]],
      floor:.165},
     two_moons:{
      euler:[[2,.4394,.4254],[3,.2911,.2784],[4,.2243,.2095],[6,.1542,.1329],[8,.1210,.0998],[12,.0846,.0646],[20,.0612,.0397],[40,.0506,.019897],[80,.0503,.010437]],
      midpoint:[[4,.1313,.1136],[6,.0951,.0922],[8,.0755,.0607],[12,.0603,.022343],[16,.0538,.011870],[24,.0546,.005133],[40,.0557,.003086],[80,.0546,.002797],[160,.0552,.002370]],
      heun:[[4,.2739,.2347],[6,.1583,.1250],[8,.1091,.0796],[12,.0738,.037231],[16,.0637,.021456],[24,.0589,.008723],[40,.0559,.004258],[80,.0552,.002699],[160,.0548,.002266]],
      rk4:[[8,.0965,.0651],[12,.0606,.028290],[16,.0573,.012220],[24,.0569,.004021],[32,.0547,.004953],[48,.0554,.002824],[80,.0551,.002651],[160,.0546,.002294],[320,.0550,.002271]],
      dopri5:[[43,.0561,.007145],[44,.0566,.004533],[73,.0577,.003773],[139,.0550,.001639],[289,.0549,.000703],[493,.0550,.000309]],
      floor:.0558}};
    safe(function(){
      const DSNAME={eight_gaussians:"8-Gaussians",two_moons:"Two-Moons"};
      const ALL=[...SOLVERS,"dopri5"];
      legendInto($("w2Legend"),ALL);legendInto($("epLegend"),ALL);
      function mkSeries(ds,col){ /* col: 1=w2, 2=eperr */
        return ALL.map(s=>({label:SNAME[s],color:()=>scolor(s),star:s==="dopri5",
          pts:REAL[ds][s].map(r=>[r[0],r[col]])}));}
      $("w2Cv")._yname="W2";
      chart($("w2Cv"),{panels:["eight_gaussians","two_moons"].map(ds=>({
        title:"W2 vs NFE — "+DSNAME[ds],
        series:mkSeries(ds,1),xlog:true,ylog:false,
        xlabel:T.nfeLog,ylabel:"W2",
        floors:[{y:REAL[ds].floor,label:"sample floor "+REAL[ds].floor}]}))});
      $("epCv")._yname="endpoint_err";
      chart($("epCv"),{panels:["eight_gaussians","two_moons"].map(ds=>{
        const a=REAL[ds].euler[0];
        return{title:"endpoint_err vs NFE — "+DSNAME[ds],
          series:mkSeries(ds,2),xlog:true,ylog:true,
          xlabel:T.nfeLog,ylabel:T.epYlabel,
          refs:[{slope:-1,anchor:a,label:"−1"},{slope:-2,anchor:a,label:"−2"},
                {slope:-4,anchor:a,label:"−4"}]};})});
    });
  }
  if (typeof document$ !== "undefined") {
    document$.subscribe(run);
  } else if (document.readyState !== "loading") {
    run();
  } else {
    document.addEventListener("DOMContentLoaded", run);
  }
})();

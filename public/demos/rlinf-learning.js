/* ============================================================
   RLinf 学习手册的三件交互，从旧的自包含静态站移植过来：

     .rlinf-cast   终端回放 —— 播放 record_session.py 用 PTY 录下的真实执行，
                   时间戳是录制时的真实耗时。数据体积大（单个几十 KB），走
                   vault-static 挂载 fetch，不内联进笔记。
     .rlinf-chart  训练曲线 —— 数据点内联在挂载点的 data-series 上（原站把它们
                   烧在 SVG 热区里，迁移时取了出来），canvas 重画并支持 hover。
     .rlinf-check  实验进度 —— 勾选状态存 localStorage，按 data-step 记名。

   三者都有存在性守卫：页面上没有对应挂载点就什么都不做，所以这一个脚本可以
   被手册的任意一章挂载。画布按「图片」对待固定浅色，与 demos.css 里既有的
   数据图约定一致。
   ============================================================ */
(function () {
  'use strict';

  var INK = '#1d1d1f', MUTED = '#6e6e73', LINE = '#d2d2d7',
      ACC = '#1b5e7e', ACC_WEAK = 'rgba(27,94,126,.10)', PAPER = '#ffffff';

  /* 手册页面的路径必然是 <base>/vault/rlinf-learning/<章>/，据此推出 base，
     不必把部署前缀硬编码进脚本。 */
  function assetRoot() {
    var m = location.pathname.match(/^(.*?)\/vault\/rlinf-learning\//);
    return (m ? m[1] : '') + '/vault-static/rlinf-learning';
  }

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function fmt(s) {
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* ---------------- 终端回放 ---------------- */
  function mountCast(host) {
    var name = host.getAttribute('data-cast');
    if (!name) return;

    var bar = el('div', 'rlinf-cast__bar');
    var title = el('span', 'rlinf-cast__name', name + ' — 真实执行录像');
    var play = el('button', 'rlinf-cast__btn', '▶ 播放');
    var speed = el('button', 'rlinf-cast__btn', '1×');
    var end = el('button', 'rlinf-cast__btn', '跳到结尾');
    var track = el('span', 'rlinf-cast__track');
    var fill = el('span', 'rlinf-cast__fill');
    var meta = el('span', 'rlinf-cast__meta', '—');
    [play, speed, end].forEach(function (b) { b.type = 'button'; });
    track.appendChild(fill);
    [title, play, speed, end, track, meta].forEach(function (n) { bar.appendChild(n); });
    var screen = el('pre', 'rlinf-cast__screen', '载入录像…');
    host.appendChild(bar); host.appendChild(screen);

    var data = null, timer = null, idx = 0, rate = 1, playing = false;

    function setMeta(t) {
      meta.textContent = fmt(t) + ' / ' + fmt(data.duration) + '  ·  exit=' + data.exit_code;
      fill.style.width = (data.duration ? (t / data.duration * 100) : 0) + '%';
    }
    function render(upTo) {
      var out = '';
      for (var i = 0; i < upTo; i++) out += data.events[i][1];
      screen.textContent = out;
      screen.scrollTop = screen.scrollHeight;
    }
    function stop() {
      playing = false;
      if (timer) { clearTimeout(timer); timer = null; }
      play.textContent = '▶ 播放';
      play.setAttribute('aria-pressed', 'false');
    }
    function tick() {
      if (!data || idx >= data.events.length) { stop(); return; }
      var ev = data.events[idx]; idx++;
      render(idx); setMeta(ev[0]);
      if (idx >= data.events.length) { stop(); return; }
      var gap = (data.events[idx][0] - ev[0]) * 1000 / rate;
      timer = setTimeout(tick, Math.max(16, Math.min(gap, 4000)));
    }

    play.addEventListener('click', function () {
      if (!data) return;
      if (playing) { stop(); return; }
      if (idx >= data.events.length) { idx = 0; render(0); }
      playing = true;
      play.textContent = '⏸ 暂停';
      play.setAttribute('aria-pressed', 'true');
      tick();
    });
    speed.addEventListener('click', function () {
      rate = rate === 1 ? 2 : rate === 2 ? 4 : 1;
      speed.textContent = rate + '×';
    });
    end.addEventListener('click', function () {
      if (!data) return;
      stop(); idx = data.events.length; render(idx); setMeta(data.duration);
    });

    fetch(assetRoot() + '/assets/casts/' + name + '.json')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        data = j;
        screen.textContent = '点「▶ 播放」回放这次真实执行（时间戳是录制时的真实耗时）。';
        setMeta(0);
      })
      .catch(function () {
        screen.textContent = '录像未挂载：它随 vault 仓库的 site/ 目录发布，'
          + '本机跑一次 update-site.sh 即可。';
      });
  }

  /* ---------------- 训练曲线 ---------------- */
  function parseSeries(s) {
    var seen = Object.create(null);
    (s || '').split(',').forEach(function (p) {
      var kv = p.split(':');
      if (kv.length !== 2) return;
      var step = Number(kv[0]), v = Number(kv[1]);
      if (isFinite(step) && isFinite(v)) seen[step] = v;   // 同步数重复时取后者
    });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; })
      .map(function (k) { return [k, seen[k]]; });
  }

  function mountChart(host) {
    var pts = parseSeries(host.getAttribute('data-series'));
    if (!pts.length) return;
    var label = host.getAttribute('data-metric') || '';

    var W = 720, H = 220, PAD_L = 62, PAD_R = 14, PAD_T = 26, PAD_B = 34;
    var cv = el('canvas', 'rlinf-chart__cv');
    cv.width = W * 2; cv.height = H * 2;                  // HiDPI
    cv.style.width = '100%'; cv.style.maxWidth = W + 'px'; cv.style.height = 'auto';
    cv.setAttribute('role', 'img');
    var tip = el('div', 'rlinf-chart__tip'); tip.hidden = true;
    host.appendChild(cv); host.appendChild(tip);

    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    var pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
    var X = function (v) { return PAD_L + (x1 === x0 ? 0 : (v - x0) / (x1 - x0)) * (W - PAD_L - PAD_R); };
    var Y = function (v) { return PAD_T + (1 - (v - y0) / (y1 - y0)) * (H - PAD_T - PAD_B); };
    var fmtV = function (v) {
      var a = Math.abs(v);
      return a === 0 ? '0' : (a < 0.01 || a >= 1e4) ? v.toExponential(2) : String(Math.round(v * 1000) / 1000);
    };

    var hover = -1;
    function draw() {
      var g = cv.getContext('2d');
      g.setTransform(2, 0, 0, 2, 0, 0);
      g.clearRect(0, 0, W, H);
      g.fillStyle = PAPER; g.fillRect(0, 0, W, H);

      g.font = '11px ui-sans-serif, system-ui, sans-serif';
      g.strokeStyle = LINE; g.fillStyle = MUTED; g.lineWidth = 1;
      for (var i = 0; i <= 4; i++) {                        // y 网格与刻度
        var v = y0 + (y1 - y0) * i / 4, y = Math.round(Y(v)) + 0.5;
        g.beginPath(); g.moveTo(PAD_L, y); g.lineTo(W - PAD_R, y); g.stroke();
        g.textAlign = 'right'; g.textBaseline = 'middle';
        g.fillText(fmtV(v), PAD_L - 8, y);
      }
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (var s = x0; s <= x1; s += Math.max(1, Math.round((x1 - x0) / 6))) {
        g.fillText(String(s), X(s), H - PAD_B + 8);
      }
      g.fillStyle = MUTED; g.textAlign = 'left';
      g.fillText('step', W - PAD_R - 26, H - PAD_B + 8);
      g.fillStyle = INK; g.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      g.textBaseline = 'alphabetic';
      g.fillText(label, PAD_L, PAD_T - 10);

      g.beginPath();                                       // 面积
      pts.forEach(function (p, i) { i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); });
      g.lineTo(X(x1), Y(y0)); g.lineTo(X(x0), Y(y0)); g.closePath();
      g.fillStyle = ACC_WEAK; g.fill();

      g.beginPath();                                       // 曲线
      pts.forEach(function (p, i) { i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); });
      g.strokeStyle = ACC; g.lineWidth = 1.8; g.lineJoin = 'round'; g.stroke();

      if (hover >= 0) {
        var hp = pts[hover];
        g.strokeStyle = LINE; g.lineWidth = 1;
        g.beginPath(); g.moveTo(X(hp[0]), PAD_T); g.lineTo(X(hp[0]), H - PAD_B); g.stroke();
        g.beginPath(); g.arc(X(hp[0]), Y(hp[1]), 3.5, 0, Math.PI * 2);
        g.fillStyle = ACC; g.fill();
      }
      cv.setAttribute('aria-label',
        label + ' 曲线：step ' + x0 + ' 时 ' + fmtV(ys[0]) + '，step ' + x1 + ' 时 ' + fmtV(ys[ys.length - 1]));
    }

    function nearest(clientX) {
      var r = cv.getBoundingClientRect();
      var px = (clientX - r.left) / r.width * W;
      var best = 0, bd = Infinity;
      pts.forEach(function (p, i) {
        var d = Math.abs(X(p[0]) - px);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }
    cv.addEventListener('mousemove', function (e) {
      hover = nearest(e.clientX);
      var p = pts[hover], r = cv.getBoundingClientRect();
      tip.hidden = false;
      tip.textContent = 'step ' + p[0] + ' · ' + fmtV(p[1]);
      tip.style.left = (X(p[0]) / W * r.width) + 'px';
      draw();
    });
    cv.addEventListener('mouseleave', function () { hover = -1; tip.hidden = true; draw(); });
    draw();
  }

  /* ---------------- 实验进度 ---------------- */
  function mountChecks(inputs) {
    var KEY = 'rlinf-learning:progress';
    var state = {};
    try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }

    inputs.forEach(function (box) {
      var step = box.getAttribute('data-step');
      if (!step) return;
      box.checked = !!state[step];
      if (box.checked) box.closest('.rlinf-check').classList.add('is-done');
      box.addEventListener('change', function () {
        state[step] = box.checked;
        box.closest('.rlinf-check').classList.toggle('is-done', box.checked);
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式：不记就不记 */ }
      });
    });
  }

  var casts = [].slice.call(document.querySelectorAll('.rlinf-cast'));
  var charts = [].slice.call(document.querySelectorAll('.rlinf-chart'));
  var checks = [].slice.call(document.querySelectorAll('.rlinf-check input[type=checkbox]'));
  casts.forEach(mountCast);
  charts.forEach(mountChart);
  if (checks.length) mountChecks(checks);
})();

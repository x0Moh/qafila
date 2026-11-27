/* قافلة — واجهة اللاعب */
(() => {
  'use strict';

  const TEAM_SIZES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
  const store = {
    get id() { return localStorage.getItem('qafila.id'); },
    set id(v) { localStorage.setItem('qafila.id', v); },
    get room() { return localStorage.getItem('qafila.room'); },
    set room(v) { v ? localStorage.setItem('qafila.room', v) : localStorage.removeItem('qafila.room'); },
    get key() { return localStorage.getItem('qafila.key'); },
    set key(v) { localStorage.setItem('qafila.key', v); },
    get name() { return localStorage.getItem('qafila.name') || ''; },
    set name(v) { localStorage.setItem('qafila.name', v); },
  };

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const $fx = document.getElementById('fx');
  const $theme = document.querySelector('meta[name="theme-color"]');
  const socket = io({ transports: ['websocket', 'polling'] });

  let state = null;            // { room, game } from the server
  let ui = { revealed: false, picked: [], peek: false, target: null, confirmAbort: false };
  let lastPhaseKey = '';

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('ar-SA');
  const nameOf = id => { const p = state?.room?.players.find(x => x.id === id); return p ? p.name : '؟'; };
  const names = ids => ids.map(nameOf).map(esc).join('، ');
  const ORDINAL = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة'];

  // motion: everything below respects the phone's "reduce motion" setting
  const motionQuery = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const calm = () => motionQuery.matches;
  const buzz = pattern => { try { if (!calm() && navigator.vibrate) navigator.vibrate(pattern); } catch (_) { /* not supported */ } };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function toast(msg, kind = '') {
    $toast.textContent = msg;
    $toast.className = kind;
    $toast.hidden = false;
    void $toast.offsetWidth;
    $toast.classList.add('in');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.classList.remove('in'); setTimeout(() => { $toast.hidden = true; }, 250); }, 2800);
  }

  function send(event, payload = {}) {
    return new Promise(resolve => {
      socket.emit(event, payload, res => {
        if (res && !res.ok) toast(res.error || 'صار خطأ');
        resolve(res || { ok: false });
      });
    });
  }

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (_) { /* not supported or denied: fine */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state?.game && state.game.phase !== 'end') keepAwake(true);
  });

  // ---------- art ----------
  const CAMEL = '<path d="M30 63 C26 70 25 80 27 92 C28 95 31 95 31 92 C30 82 31 72 33 65 Z"/><path d="M30 62 C22 64 17 74 19 85 C21 96 27 104 30 110 L28 148 C28 151 34 152 36 150 L37 112 C38 105 41 100 46 97 C60 99 82 101 100 100 L104 104 C106 111 106 118 106 124 L107 148 C107 151 113 152 115 150 L113 124 C114 116 116 108 120 100 C126 98 130 92 132 86 C136 80 142 75 150 73 C158 70 163 62 166 53 L168 45 L176 47 C182 48 186 47 189 44 C191 41 190 37 186 35 C180 32 172 30 166 30 C162 28 160 26 158 26 L156 21 L153 27 C149 31 147 37 147 45 C146 54 140 60 132 62 C124 64 118 60 114 54 C108 44 100 29 86 27 C72 25 62 35 56 45 C50 54 42 60 30 62 Z"/><path d="M40 92 C46 98 50 104 50 112 L42 148 C42 151 48 152 50 150 L57 114 C58 104 56 96 52 90 Z"/><path d="M110 98 C116 104 120 112 121 122 L130 148 C130 151 136 152 138 150 L129 121 C128 112 126 104 122 96 Z"/>';
  const camel = (w = 56) => `<svg class="camel-svg" viewBox="0 0 200 160" width="${w}" height="${Math.round(w * 0.8)}" aria-hidden="true"><g fill="currentColor">${CAMEL}</g></svg>`;

  const logo = (small) => `
    <div class="logo ${small ? 'small' : ''}" aria-label="قافلة">
      <span class="seal" aria-hidden="true">ق</span>
      <span class="word">قافلة</span>
      <span class="latin" dir="ltr">QAFILAH</span>
    </div>`;
  const stroke = (color = 'currentColor') => `<svg class="stroke" aria-hidden="true" viewBox="0 0 160 20" width="160" height="20"><path pathLength="1" d="M4 12 C40 2 66 18 92 8 S140 6 156 10" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;

  // painted portraits we have so far; the rest get a calligraphy seal
  const PORTRAITS = ['AHNAF', 'FARIS', 'RAHHALA', 'WAHSHI', 'LULUA', 'ALQAMI'];
  const portrait = (role, cls = '') => PORTRAITS.includes(role.id)
    ? `<img class="portrait ${cls}" src="img/roles/${role.id.toLowerCase()}.webp" alt="" draggable="false">`
    : `<span class="portrait glyph ${cls}" aria-hidden="true">${esc(role.name.replace(/^ال/, '').charAt(0))}</span>`;

  // a neutral seal with the player's first letter (never hints at a role)
  const avatar = (name, i) => `<span class="avatar" style="--h:${(i * 47) % 360}" aria-hidden="true">${esc(String(name).trim().charAt(0) || '؟')}</span>`;

  const dunes = () => `<div class="dunes" aria-hidden="true">
      <svg viewBox="0 0 1200 160" preserveAspectRatio="none"><path d="M0 110 C160 70 300 70 460 100 S760 140 900 96 S1120 60 1200 84 L1200 160 L0 160 Z" class="d1"/><path d="M0 132 C200 104 360 120 540 130 S860 150 1020 122 S1160 112 1200 118 L1200 160 L0 160 Z" class="d2"/></svg>
      <div class="caravan-walk">${camel(48)}${camel(40)}${camel(44)}</div>
    </div>`;

  const seenPlayers = new Set();   // lobby chips pop in only when someone new joins

  // dots that only "pop" when they newly fill in
  const seenDots = {};
  function dots(total, on, key) {
    const k = `${lastPhaseKey}|${key}`;
    const was = k in seenDots ? seenDots[k] : on;
    seenDots[k] = on;
    return `<div class="progress">${Array.from({ length: total }, (_, i) => `<i class="${i < on ? (i >= was ? 'on pop' : 'on') : ''}"></i>`).join('')}</div>`;
  }

  // ---------- screens ----------
  function homeView() {
    const code = new URLSearchParams(location.search).get('r') || '';
    return `<div class="screen home">
      <div class="hero stack center">
        <div style="margin-top:24px">${logo()}</div>
        <p class="muted tagline">واحد منكم مو منكم.</p>
        <p class="pitch muted">لعبة خداع جماعية تلعبونها وأنتم جالسين مع بعض. قافلة تقطع الصحراء بالليل، وبين المسافرين غزاة متنكرين. اكشفوهم قبل لا تفشل الرحلة.</p>
      </div>
      <div class="stack">
      <form class="stack card" data-form="join" autocomplete="off">
        <label for="name">اسمك</label>
        <input id="name" name="name" type="text" maxlength="18" placeholder="مثلًا: مشاري" value="${esc(store.name)}" required>
        <label for="code">كود الغرفة</label>
        <input id="code" name="code" class="code" type="tel" inputmode="numeric" maxlength="4" placeholder="0000" value="${esc(code)}">
        <button class="btn" type="submit">ادخل القافلة</button>
        <button class="btn ghost" type="button" data-act="create">أنشئ غرفة جديدة</button>
      </form>
      <p class="center muted small">بدون تسجيل · من ٥ إلى ١٠ لاعبين · العبوها وأنتم جالسين مع بعض</p>
      </div>${dunes()}</div>`;
  }

  function lobbyView() {
    const r = state.room;
    const n = r.players.length;
    const evil = TEAM_SIZES[Math.min(Math.max(n, 5), 10)][1];
    const o = r.options;
    const used = 1 + (o.farisLulua ? 1 : 0) + (o.alqami ? 1 : 0) + (o.shamhoroush ? 1 : 0);
    const canAdd = used < evil;
    const opt = (key, title, desc) => {
      const on = !!o[key];
      const disabled = !r.isHost || (!on && !canAdd);
      return `<label class="toggle ${disabled && !on ? 'disabled' : ''}">
        <input type="checkbox" data-opt="${key}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span><span class="t">${title}</span><br><span class="d">${desc}</span></span></label>`;
    };
    const ready = n >= r.min;
    const players = r.players.map((p, i) => {
      const fresh = !seenPlayers.has(p.id);
      seenPlayers.add(p.id);
      return `<li class="${p.connected ? '' : 'off'} ${fresh ? 'pop' : ''}" style="--i:${i}">${avatar(p.name, i)}<span class="nm"><b>${esc(p.name)}</b>${p.id === r.me || p.id === r.hostId ? `<small>${[p.id === r.hostId ? 'المضيف' : '', p.id === r.me ? 'أنت' : ''].filter(Boolean).join(' · ')}</small>` : ''}</span></li>`;
    }).join('');
    const empty = Array.from({ length: Math.max(0, r.min - n) }, () => '<li class="empty" aria-hidden="true"><span class="avatar"></span><span class="nm">بانتظار…</span></li>').join('');
    return `<div class="screen lobby">
      <div class="topbar a-top">${logo(true)}<button class="link" data-act="leave">اطلع</button></div>
      <div class="card stack center a-code">
        <span class="muted small">كود الغرفة</span>
        <div class="roomcode" dir="ltr">${esc(r.code).split('').map((d, i) => `<span style="--i:${i}">${d}</span>`).join('')}</div>
        <button class="btn ghost" data-act="share">شارك رابط الغرفة</button>
      </div>
      <div class="stack a-players">
        <div class="row spread"><h2 style="font-size:18px">المسافرين</h2><span class="muted small">${num(n)} من ${num(r.max)}</span></div>
        <ul class="players">${players}${empty}</ul>
      </div>
      <div class="card a-roles">
        <h2 style="font-size:18px;margin-bottom:6px">الشخصيات</h2>
        <p class="small muted" style="margin-bottom:6px">الأحنف ووحشي موجودين دايم. ${r.isHost ? 'اختر الإضافات:' : 'المضيف يختار الإضافات.'}</p>
        ${opt('farisLulua', 'فارس ولؤلؤة', 'فارس يشوف الأحنف ولؤلؤة بدون ما يعرف مين مين. ينصح فيهم بعد أول قيم.')}
        ${opt('alqami', 'العلقمي', 'قائد الغزاة، والأحنف ما يشوفه. يناسب ٧ لاعبين وفوق.')}
        ${opt('shamhoroush', 'شمهروش', 'غازي ضايع ما يعرف جماعته. يناسب ١٠ لاعبين.')}
      </div>
      <div class="a-start">${r.isHost
        ? `<button class="btn ${ready ? 'glow' : ''}" data-act="start" ${ready ? '' : 'disabled'}>${ready ? 'ابدأ الرحلة' : `تحتاجون ${num(r.min - n)} لاعبين بعد`}</button>`
        : `<p class="center muted waiting">بانتظار المضيف يبدأ الرحلة<span class="ell"><i>.</i><i>.</i><i>.</i></span></p>`}</div>
    </div>`;
  }

  function roleCard(g) {
    const r = g.myRole;
    const seen = g.night && g.night.seen.length
      ? `<div class="seen"><span class="small">${esc(g.night.label)}</span><div class="chips">${g.night.seen.map((id, i) => `<span class="chip" style="--i:${i}">${esc(nameOf(id))}</span>`).join('')}</div></div>`
      : '';
    return `<div class="role ${r.team}">
      <span class="team">${r.team === 'caravan' ? 'فريق القافلة' : 'فريق الغزاة'}</span>
      <div class="arch">${portrait(r)}</div>
      <span class="name">${esc(r.name)}</span>
      ${stroke(r.team === 'caravan' ? '#1A1613' : '#E0473C')}
      <p class="blurb">${esc(r.blurb)}</p>
      ${seen}
    </div>`;
  }

  const nightCover = (inner, act = '') => `<${act ? 'button' : 'div'} class="cover" ${act ? `data-act="${act}"` : ''}>
      <span class="moon" aria-hidden="true"></span>
      <span class="sky" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--y:${(i * 53) % 70}%;--d:${(i % 5) * 0.4}s"></i>`).join('')}</span>
      ${inner}
      <span class="cover-camels" aria-hidden="true">${camel(34)}${camel(28)}${camel(32)}</span>
    </${act ? 'button' : 'div'}>`;

  function nightView(g) {
    const me = g.players.find(p => p.id === g.me);
    const readyCount = g.players.filter(p => p.ready).length;
    if (me && me.ready) {
      return `<div class="screen night"><div class="topbar">${logo(true)}<span class="muted small">الليل</span></div>
        ${nightCover(`<span class="display">نامت القافلة…</span><span>بانتظار الباقين يشوفون أدوارهم</span>
        ${dots(g.players.length, readyCount, 'ready')}
        <span class="small">${num(readyCount)} من ${num(g.players.length)}</span>`)}</div>`;
    }
    return `<div class="screen night">
      <div class="topbar">${logo(true)}<span class="muted small">الليل · غرفة ${esc(state.room.code)}</span></div>
      <p class="center">غطِّ جوالك عن اللي جنبك، وشوف دورك.</p>
      ${ui.revealed
        ? `<div class="flipwrap ${ui.once.has('flip') ? 'flip' : ''}">${roleCard(g)}</div><button class="btn" data-act="ready">حفظت دوري، أخفه</button>`
        : nightCover('<span class="display">نامت القافلة…</span><span>اضغط عشان تكشف دورك</span><span class="hint">اضغط</span>', 'reveal')}</div>`;
  }

  // where the camel should stand on the route
  const camelTarget = g => (g.phase === 'assassin' || g.phase === 'end') ? Math.max(g.results.length - 1, 0) : Math.min(g.results.length, 4);

  function routeBoard(g) {
    const at = ui.camelAt ?? camelTarget(g);
    return `<div class="card stack route-card">
      <div class="route" style="--at:${at}">
        <svg class="trail" viewBox="0 0 500 40" preserveAspectRatio="none" aria-hidden="true"><path d="M50 22 C110 6 150 34 200 22 S290 8 350 22 S420 34 450 22" fill="none" stroke-dasharray="2 7" stroke-linecap="round"/></svg>
        <div class="camel" aria-hidden="true">${camel(40)}</div>
        ${g.stations.map((s, i) => {
          const r = g.results[i];
          const cls = r ? (r.success ? 'win' : 'lose') : (i === g.questIndex && g.phase !== 'end' ? 'now' : '');
          const mark = r ? (r.success ? '✓' : '✕') : num(g.questSizes[i]);
          const stamp = ui.once.has(`stamp${i}`) ? 'stamp' : '';
          return `<div class="stop"><div class="dot ${cls} ${stamp}" aria-label="${esc(s)}: ${r ? (r.success ? 'نجحت' : 'فشلت') : num(g.questSizes[i]) + ' لاعبين'}">${mark}</div>
            <span class="s">${esc(s)}</span><span class="n">${g.failsNeeded[i] > 1 ? 'تحتاج تخريبين' : num(g.questSizes[i]) + ' بالفريق'}</span></div>`;
        }).join('')}
      </div>
      <div class="rejects" aria-label="الرفض المتتالي ${num(g.rejects)} من ${num(g.maxRejects)}">الرفض المتتالي
        ${Array.from({ length: g.maxRejects }, (_, i) => `<i class="${i < g.rejects ? 'on' : ''} ${ui.once.has('reject') && i === g.rejects - 1 ? 'pop' : ''}"></i>`).join('')}
      </div>
    </div>`;
  }

  function lastEvent(g) {
    const h = g.history[g.history.length - 1];
    const res = g.results[g.results.length - 1];
    if (g.phase === 'team' && h && !h.approved) {
      return `<div class="banner bad">انرفض فريق ${esc(nameOf(h.leader))}: ${names(h.team)}</div>`;
    }
    if (g.phase === 'quest' && h && h.approved) {
      return `<div class="banner ok">الفريق انقبل. ${names(h.team)} طالعين للمحطة.</div>`;
    }
    if ((g.phase === 'team' || g.phase === 'assassin') && res && g.results.length && (!h || h.approved)) {
      const i = g.results.length - 1;
      return `<div class="banner ${res.success ? 'ok' : 'bad'}">محطة ${esc(g.stations[i])} ${res.success ? 'نجحت' : 'فشلت'}${res.fails ? ` · عدد التخريب: ${num(res.fails)}` : ' · بدون تخريب'}</div>`;
    }
    return '';
  }

  function historyView(g) {
    if (!g.history.length) return '';
    const items = g.history.slice().reverse().map(h => {
      const yes = Object.entries(h.votes).filter(([, v]) => v).map(([id]) => id);
      const no = Object.entries(h.votes).filter(([, v]) => !v).map(([id]) => id);
      return `<div class="hist-item">
        <span><b>${esc(g.stations[h.quest])}</b> · القائد ${esc(nameOf(h.leader))} · ${h.approved ? 'انقبل' : 'انرفض'}</span>
        <span class="muted">الفريق: ${names(h.team)}</span>
        <div class="votes">${yes.map(id => `<span class="y">${esc(nameOf(id))} ✓</span>`).join('')}${no.map(id => `<span class="n">${esc(nameOf(id))} ✕</span>`).join('')}</div>
      </div>`;
    }).join('');
    return `<details class="history"><summary>سجل الرحلة</summary>${items}</details>`;
  }

  function phasePanel(g) {
    const leader = g.leader === g.me;
    const size = g.questSizes[g.questIndex];
    if (g.phase === 'team') {
      if (!leader) return `<div class="card stack center"><span class="muted small">القائد</span><span class="display leader-name" style="font-size:34px">${esc(nameOf(g.leader))}</span><span>يختار ${num(size)} لمحطة ${esc(g.stations[g.questIndex])}. ناقشوه!</span></div>`;
      ui.picked = ui.picked.filter(id => g.players.some(p => p.id === id));
      return `<div class="stack"><div><span class="tag lantern">أنت القائد</span></div>
        <h2 style="font-size:20px">اختر ${num(size)} لمحطة ${esc(g.stations[g.questIndex])}</h2>
        <div class="pick">${g.players.map((p, i) => `<button data-pick="${esc(p.id)}" aria-pressed="${ui.picked.includes(p.id)}">${avatar(p.name, i)}<span>${esc(p.name)}${p.id === g.me ? ' (أنت)' : ''}</span></button>`).join('')}</div>
        <button class="btn" data-act="propose" ${ui.picked.length === size ? '' : 'disabled'}>اعرض الفريق للتصويت (${num(ui.picked.length)} من ${num(size)})</button></div>`;
    }
    if (g.phase === 'vote') {
      const head = `<div class="stack"><h2 style="font-size:20px">تثق بهالفريق؟</h2><span class="muted">${esc(nameOf(g.leader))} اقترح:</span><div class="team-list">${g.team.map((id, i) => `<span style="--i:${i}">${esc(nameOf(id))}</span>`).join('')}</div></div>`;
      const progress = `<div class="stack center">${dots(g.players.length, g.votedCount, 'vote')}<span class="small muted">صوّت ${num(g.votedCount)} من ${num(g.players.length)} · الأصوات تنكشف لما يصوّت الكل</span></div>`;
      if (g.myVote === undefined) return head + `<div class="vote"><button class="yes" data-vote="1"><b>✓</b><span>موافق</span></button><button class="no" data-vote="0"><b>✕</b><span>رافض</span></button></div>` + progress;
      return head + `<div class="voted ${g.myVote ? 'yes' : 'no'} ${ui.once.has('sealed') ? 'sealed' : ''}"><b>${g.myVote ? '✓' : '✕'}</b><span>صوّتّ: ${g.myVote ? 'موافق' : 'رافض'}</span><small>صوتك مختوم. ينكشف مع الباقين.</small></div>` + progress;
    }
    if (g.phase === 'quest') {
      const inTeam = g.team.includes(g.me);
      const waiting = `<div class="stack center">${dots(g.team.length, g.playedCount, 'quest')}<span class="small muted">بانتظار الفريق: ${num(g.playedCount)} من ${num(g.team.length)}</span></div>`;
      if (inTeam && !g.iPlayed) {
        return `<div class="stack"><h2 style="font-size:20px">اختر بسرّية</h2><p class="muted small">محد بيعرف وش اخترت، بس النتيجة تنكشف للكل.</p>
          <div class="quest"><button data-quest="0"><span class="qi water" aria-hidden="true"></span><span class="q">أوصل القافلة</span><span class="qs">قربة ماء</span></button>
          <button data-quest="1"><span class="qi poison" aria-hidden="true"></span><span class="q">خرّب</span><span class="qs">ماء مسموم</span></button></div>
          <p class="small muted">الشاشة نفسها تطلع للكل. أهل القافلة لو اختاروا «خرّب» تنحسب «أوصل».</p></div>` + waiting;
      }
      return `<div class="card stack center"><span>الفريق في محطة ${esc(g.stations[g.questIndex])}:</span><div class="team-list" style="justify-content:center">${g.team.map(id => `<span>${esc(nameOf(id))}</span>`).join('')}</div>${inTeam ? '<span class="muted small">اخترت. بانتظار الباقين.</span>' : ''}</div>` + waiting;
    }
    if (g.phase === 'assassin') {
      const raiders = g.raidersReveal;
      if (!raiders) return `<div class="banner ok">ثلاث محطات نجحت! بس الرحلة ما خلصت…</div><div class="card stack center assassin-wait"><span class="display" style="font-size:30px">الغزاة يتشاورون</span><span>وحشي بيحاول يعرف مين الأحنف. لو عرفه، يفوز الغزاة.</span></div>`;
      const raiderIds = raiders.map(r => r.id);
      const list = `<div class="card stack"><span class="small muted">الغزاة (تقدرون تتشاورون):</span><div class="chips" style="justify-content:flex-start">${raiders.map(r => `<span class="chip" style="color:var(--raiders)">${esc(nameOf(r.id))} · ${esc(r.role.name)}</span>`).join('')}</div></div>`;
      if (!g.isWahshi) return `<div class="banner bad">القافلة نجحت في ثلاث محطات. وحشي يختار الحين.</div>` + list;
      const options = g.players.filter(p => !raiderIds.includes(p.id));
      return `<div class="banner bad">أنت وحشي. فرصة أخيرة: مين الأحنف؟</div>` + list + `
        <div class="pick target">${options.map(p => `<button data-target="${esc(p.id)}" aria-pressed="${ui.target === p.id}">${esc(p.name)}</button>`).join('')}</div>
        <button class="btn red" data-act="assassinate" ${ui.target ? '' : 'disabled'}>هذا الأحنف</button>`;
    }
    return '';
  }

  function playView(g) {
    return `<div class="screen play">
      <div class="topbar a-top">${logo(true)}<button class="peek" data-act="peek">دوري</button></div>
      <div class="a-route">${routeBoard(g)}</div>
      <div class="a-event">${lastEvent(g)}</div>
      <div class="a-panel stack ${ui.once.has('ping') ? 'ping' : ''}" data-phase="${g.phase}">${phasePanel(g)}</div>
      <div class="a-hist">${historyView(g)}</div>
      ${state.room.isHost ? `<div class="a-abort center"><button class="link" data-act="abort">${ui.confirmAbort ? 'متأكد؟ اضغط مرة ثانية وترجعون للانتظار' : 'إنهاء اللعبة (للمضيف)'}</button></div>` : ''}
      </div>
      ${ui.peek ? `<div class="sheet ${ui.once.has('sheet') ? 'open' : ''}" data-act="peek"><div>${roleCard(g)}<button class="btn" data-act="peek">أخفِ</button></div></div>` : ''}`;
  }

  function endView(g) {
    const win = g.winner;
    const dust = Array.from({ length: 18 }, (_, i) => `<i style="--x:${(i * 41) % 100}%;--d:${(i % 6) * 0.18}s;--r:${(i * 67) % 360}deg"></i>`).join('');
    return `<div class="screen end">
      <div class="topbar a-top">${logo(true)}<span class="muted small">الصباح</span></div>
      <div class="winner a-win ${win}"><span class="dust" aria-hidden="true">${dust}</span><span class="small">${esc(g.reason)}</span><span class="display">${win === 'caravan' ? 'وصلت القافلة!' : 'فاز الغزاة!'}</span><span class="stamp-seal" aria-hidden="true">${win === 'caravan' ? 'ق' : 'غ'}</span></div>
      ${g.assassinTarget ? `<div class="banner info a-target">وحشي اختار ${esc(nameOf(g.assassinTarget))}.</div>` : ''}
      <div class="a-route">${routeBoard(g)}</div>
      <div class="stack a-reveal"><h2 style="font-size:18px">انكشف كل شي</h2>
        <ul class="reveal">${g.reveal.map((r, i) => `<li class="${r.role.team}" style="--i:${i}">${portrait(r.role, 'mini')}<span class="who">${esc(nameOf(r.id))}${r.id === g.me ? ' (أنت)' : ''}</span><span class="r">${esc(r.role.name)}</span></li>`).join('')}</ul></div>
      <div class="a-hist">${historyView(g).replace('<details class="history">', '<details class="history" open>')}</div>
      <div class="a-again">${state.room.isHost ? `<button class="btn" data-act="again">جولة جديدة</button>` : `<p class="center muted">بانتظار المضيف يبدأ جولة جديدة…</p>`}</div>
    </div>`;
  }

  // ---------- render ----------
  ui.once = new Set();     // one-shot animation flags, cleared after each render
  let screenKey = '';
  function render() {
    let html, key;
    if (!state || !state.room) { html = homeView(); key = 'home'; }
    else if (!state.game) { html = lobbyView(); key = 'lobby'; }
    else if (state.game.phase === 'night') { html = nightView(state.game); key = 'night'; }
    else if (state.game.phase === 'end') { html = endView(state.game); key = 'end'; }
    else { html = playView(state.game); key = 'play'; }
    // a new screen plays its entrance once, but not while an overlay is covering it
    const fresh = key !== screenKey && !fx.busy;
    if (!fx.busy) screenKey = key;
    $app.innerHTML = html;
    if (fresh && $app.firstElementChild) $app.firstElementChild.classList.add('fresh');
    const dark = key === 'night';
    document.body.classList.toggle('dark', dark);
    if ($theme) $theme.content = dark ? '#15110E' : '#F4ECDD';
    ui.once.clear();
    walkCamel();
  }

  // the camel walks to the next station after the quest result has been shown
  function walkCamel() {
    const g = state?.game;
    const el = $app.querySelector('.route');
    if (!g || !el) return;
    const target = camelTarget(g);
    if (ui.camelAt == null || calm()) { ui.camelAt = target; el.style.setProperty('--at', target); return; }
    if (fx.busy || ui.camelAt === target) return;
    const from = ui.camelAt;
    ui.camelAt = target;
    el.style.setProperty('--at', from);
    void el.offsetWidth;
    el.classList.add('walking');
    el.style.setProperty('--at', target);
    setTimeout(() => { const r = $app.querySelector('.route'); if (r) r.classList.remove('walking'); }, 1700);
  }

  // ---------- big moments (overlays outside #app so re-renders don't cut them) ----------
  const fx = { busy: false, queue: [] };
  function queueFx(run) {
    if (calm()) return;
    fx.queue.push(run);
    if (!fx.busy) nextFx();
  }
  function nextFx() {
    const run = fx.queue.shift();
    if (!run) { fx.busy = false; render(); return; }
    fx.busy = true;
    let finished = false;
    const layer = document.createElement('div');
    layer.className = 'fx-layer';
    $fx.appendChild(layer);
    const done = () => {
      if (finished) return;
      finished = true;
      layer.classList.add('out');
      setTimeout(() => { layer.remove(); nextFx(); }, 260);
    };
    layer.addEventListener('click', () => { if (layer.dataset.skip) done(); });
    run(layer, done);
  }

  function fxDusk(layer, done) {
    layer.classList.add('fx-sky', 'dusk');
    layer.innerHTML = `<span class="sky" aria-hidden="true">${Array.from({ length: 30 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--y:${(i * 23) % 60}%;--d:${(i % 7) * 0.15}s"></i>`).join('')}</span>
      <span class="moon big" aria-hidden="true"></span>
      <div class="fx-text"><span class="display">نامت القافلة…</span><span>كل واحد يشوف دوره بسرّية</span></div>`;
    buzz(30);
    setTimeout(done, 2000);
  }

  function fxDawn(layer, done) {
    layer.classList.add('fx-sky', 'dawn');
    layer.innerHTML = `<span class="sun" aria-hidden="true"></span>
      <div class="dawn-dunes" aria-hidden="true"><svg viewBox="0 0 1200 160" preserveAspectRatio="none"><path d="M0 110 C160 70 300 70 460 100 S760 140 900 96 S1120 60 1200 84 L1200 160 L0 160 Z"/></svg></div>
      <div class="fx-text"><span class="display">طلع الصبح</span><span>القافلة تمشي للبير</span></div>`;
    setTimeout(done, 2000);
  }

  function fxVote(entry, g) {
    return (layer, done) => {
      const order = g.players.map(p => p.id).filter(id => id in entry.votes);
      const yes = order.filter(id => entry.votes[id]).length;
      layer.classList.add('fx-cards');
      layer.innerHTML = `<div class="fx-box">
        <span class="fx-kicker">انكشفت الأصوات</span>
        <div class="vcards" style="--n:${Math.min(order.length, 5)}">${order.map((id, i) => `<div class="vcard" style="--i:${i}"><div class="in"><div class="back">ق</div><div class="face ${entry.votes[id] ? 'y' : 'n'}"><b>${entry.votes[id] ? '✓' : '✕'}</b><span>${esc(nameOf(id))}</span></div></div></div>`).join('')}</div>
        <div class="tally"><span class="y">موافق ${num(yes)}</span><span class="n">رافض ${num(order.length - yes)}</span></div>
        <div class="verdict ${entry.approved ? 'ok' : 'bad'}">${entry.approved ? 'انقبل الفريق' : 'انرفض الفريق'}</div>
        <span class="fx-sub">${entry.approved ? `${names(entry.team)} طالعين للمحطة` : `الرفض المتتالي: ${num(g.rejects || 5)} من ${num(g.maxRejects)}`}</span>
        <span class="tap">اضغط للمتابعة</span></div>`;
      layer.dataset.skip = '1';
      setTimeout(() => layer.classList.add('flipped'), 650);
      setTimeout(() => { layer.classList.add('decided'); buzz(entry.approved ? 40 : [60, 40, 60]); }, 1350);
      setTimeout(done, 3600);
    };
  }

  function fxQuest(index, res, g) {
    return (layer, done) => {
      const run = g.history.filter(h => h.quest === index && h.approved).pop();
      const size = run ? run.team.length : g.questSizes[index];
      const cards = Array.from({ length: size }, (_, i) => i < res.fails);
      for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      layer.classList.add('fx-cards', 'quest-fx');
      layer.innerHTML = `<div class="fx-box">
        <span class="fx-kicker">محطة ${esc(g.stations[index])}</span>
        <span class="fx-sub step">نخلط البطاقات…</span>
        <div class="qcards shuffling">${cards.map((bad, i) => `<div class="qcard" style="--i:${i}"><div class="in"><div class="back">ق</div><div class="face ${bad ? 'bad' : 'good'}"><span class="qi ${bad ? 'poison' : 'water'}"></span><span>${bad ? 'خرّب' : 'أوصل'}</span></div></div></div>`).join('')}</div>
        <div class="verdict ${res.success ? 'ok' : 'bad'}">${res.success ? 'نجحت المحطة' : 'فشلت المحطة'}</div>
        <span class="fx-sub">${res.fails ? `عدد التخريب: ${num(res.fails)}` : 'بدون تخريب'}${res.success && res.fails && g.failsNeeded[index] > 1 ? ' · كانت تحتاج تخريبين عشان تفشل' : ''}</span>
        <span class="tap">اضغط للمتابعة</span></div>`;
      const $step = layer.querySelector('.step');
      const $cards = layer.querySelectorAll('.qcard');
      const t0 = 1000, gap = 700;
      setTimeout(() => layer.querySelector('.qcards').classList.remove('shuffling'), t0 - 150);
      cards.forEach((bad, i) => {
        setTimeout(() => { $step.textContent = i === cards.length - 1 && i > 0 ? 'والبطاقة الأخيرة…' : `البطاقة ${ORDINAL[i]}…`; }, t0 + i * gap - 300);
        setTimeout(() => {
          $cards[i].classList.add('open');
          if (bad) { $cards[i].classList.add('hit'); layer.classList.remove('flash'); void layer.offsetWidth; layer.classList.add('flash'); buzz(140); }
        }, t0 + i * gap);
      });
      const end = t0 + cards.length * gap + 200;
      setTimeout(() => { layer.classList.add('decided'); layer.dataset.skip = '1'; buzz(res.success ? 40 : [80, 50, 80]); }, end);
      setTimeout(() => { ui.once.add(`stamp${index}`); done(); }, end + 2200);
    };
  }

  const myTurn = g => {
    if (!g) return '';
    if (g.phase === 'team' && g.leader === g.me) return 'دورك! أنت القائد، اختر الفريق';
    if (g.phase === 'vote' && g.myVote === undefined) return 'دورك تصوّت';
    if (g.phase === 'quest' && g.team.includes(g.me) && !g.iPlayed) return 'دورك! اختر بسرّية';
    if (g.phase === 'assassin' && g.isWahshi) return 'دورك يا وحشي: مين الأحنف؟';
    return '';
  };

  // compare the old and new state and stage the moments worth showing
  function stageMoments(prev, next) {
    const a = prev?.game, b = next?.game;
    if (!b) return;
    if (!a) { if (prev?.room && b.phase === 'night') queueFx(fxDusk); return; }
    if (a.phase === 'night' && b.phase !== 'night') queueFx(fxDawn);
    if (b.history.length > a.history.length) queueFx(fxVote(b.history[b.history.length - 1], b));
    if (b.rejects > a.rejects) ui.once.add('reject');
    if (b.results.length > a.results.length) {
      const i = b.results.length - 1;
      queueFx(fxQuest(i, b.results[i], b));
      if (calm()) ui.once.add(`stamp${i}`);
    }
    if (b.phase === 'end' && a.phase !== 'end') queueFx((layer, done) => { buzz(b.winner === 'caravan' ? [50, 40, 50, 40, 120] : [200, 80, 200]); layer.remove(); done(); });
    const turn = myTurn(b);
    if (turn && turn !== myTurn(a)) {
      const nudge = () => { toast(turn, 'turn'); buzz([70, 50, 70]); ui.once.add('ping'); };
      if (calm()) toast(turn, 'turn');
      else queueFx((layer, done) => { layer.remove(); nudge(); done(); });
    }
  }

  // reset per-phase UI bits when the phase moves on
  function onState(next) {
    const prev = state;
    state = next;
    const g = state.game;
    const key = g ? `${g.phase}:${g.questIndex}:${g.history.length}` : (state.room ? 'lobby' : 'home');
    if (key !== lastPhaseKey) {
      ui.picked = []; ui.target = null;
      if (!g || g.phase !== 'night') ui.revealed = false;
      lastPhaseKey = key;
    }
    if (!g) ui.camelAt = null;
    if (!state.room) seenPlayers.clear();
    keepAwake(!!g && g.phase !== 'end');
    stageMoments(prev, next);
    render();
  }

  // ---------- events ----------
  $app.addEventListener('submit', async e => {
    const form = e.target.closest('[data-form="join"]');
    if (!form) return;
    e.preventDefault();
    const name = form.name.value.trim();
    const code = form.code.value.trim();
    if (!name) return toast('اكتب اسمك');
    if (!/^\d{4}$/.test(code)) return toast('الكود أربعة أرقام');
    store.name = name;
    const res = await send('join', { code, name, playerId: store.id, key: store.key });
    if (res.ok) { store.id = res.playerId; store.key = res.key; store.room = res.code; history.replaceState(null, '', '/'); }
  });

  $app.addEventListener('click', async e => {
    const t = e.target.closest('[data-act],[data-pick],[data-vote],[data-quest],[data-target]');
    if (!t) return;
    if (t.dataset.pick) {
      const id = t.dataset.pick;
      const size = state.game.questSizes[state.game.questIndex];
      if (ui.picked.includes(id)) ui.picked = ui.picked.filter(x => x !== id);
      else if (ui.picked.length < size) ui.picked.push(id);
      else { toast(`الفريق ${num(size)} بس`); t.classList.remove('nope'); void t.offsetWidth; t.classList.add('nope'); return; }
      buzz(10);
      return render();
    }
    if (t.dataset.target) { ui.target = t.dataset.target; buzz(15); return render(); }
    if (t.dataset.vote) { buzz(25); ui.once.add('sealed'); return send('vote', { approve: t.dataset.vote === '1' }); }
    if (t.dataset.quest) {
      buzz(25);
      t.classList.add('chosen');
      await wait(calm() ? 0 : 280);
      return send('quest', { sabotage: t.dataset.quest === '1' });
    }

    switch (t.dataset.act) {
      case 'create': {
        const name = ($app.querySelector('#name')?.value || '').trim();
        if (!name) return toast('اكتب اسمك أول');
        store.name = name;
        const res = await send('create', { name });
        if (res.ok) { store.id = res.playerId; store.key = res.key; store.room = res.code; }
        break;
      }
      case 'share': {
        const url = `${location.origin}/?r=${state.room.code}`;
        try {
          if (navigator.share) await navigator.share({ title: 'قافلة', text: `تعال العب معنا قافلة. كود الغرفة ${state.room.code}`, url });
          else { await navigator.clipboard.writeText(url); toast('نسخت الرابط'); }
        } catch (_) { /* user cancelled */ }
        break;
      }
      case 'leave': {
        const res = await send('leave');
        if (res.ok) { store.room = null; state = null; render(); }
        break;
      }
      case 'start': send('start'); break;
      case 'reveal': ui.revealed = true; ui.once.add('flip'); buzz(30); render(); break;
      case 'ready': ui.revealed = false; send('ready'); break;
      case 'propose': send('propose', { team: ui.picked }); break;
      case 'assassinate': if (ui.target) send('assassinate', { target: ui.target }); break;
      case 'again': send('again'); break;
      case 'abort':
        if (!ui.confirmAbort) { ui.confirmAbort = true; render(); setTimeout(() => { ui.confirmAbort = false; render(); }, 4000); }
        else { ui.confirmAbort = false; send('abort'); }
        break;
      case 'peek':
        if (e.target.closest('.sheet > div') && !e.target.closest('button')) return;
        ui.peek = !ui.peek;
        if (ui.peek) ui.once.add('sheet');
        render(); break;
    }
  });

  $app.addEventListener('change', e => {
    const box = e.target.closest('[data-opt]');
    if (!box) return;
    const o = { ...state.room.options, [box.dataset.opt]: box.checked };
    send('options', o);
  });

  // ---------- connection ----------
  socket.on('state', onState);
  socket.on('connect', async () => {
    if (store.room && store.id) {
      const res = await new Promise(r => socket.emit('join', { code: store.room, playerId: store.id, key: store.key, name: store.name }, r));
      if (res && res.ok) { store.id = res.playerId; store.key = res.key; }
      else { store.room = null; state = null; render(); }
    }
  });
  socket.on('disconnect', () => toast('انقطع الاتصال… نحاول نرجع'));

  render();
})();

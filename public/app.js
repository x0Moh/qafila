/* قافلة — واجهة اللاعب وشاشة المجلس */
(() => {
  'use strict';

  const TEAM_SIZES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
  const QUEST_SIZES = { 5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4], 8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5] };
  const STATIONS = ['البير', 'الوادي', 'الجبل', 'الكثيب', 'الواحة'];
  const store = {
    get id() { return localStorage.getItem('qafila.id'); },
    set id(v) { localStorage.setItem('qafila.id', v); },
    get room() { return localStorage.getItem('qafila.room'); },
    set room(v) { v ? localStorage.setItem('qafila.room', v) : localStorage.removeItem('qafila.room'); },
    get key() { return localStorage.getItem('qafila.key'); },
    set key(v) { localStorage.setItem('qafila.key', v); },
    get name() { return localStorage.getItem('qafila.name') || ''; },
    set name(v) { localStorage.setItem('qafila.name', v); },
    get screen() { return localStorage.getItem('qafila.screen'); },
    set screen(v) { v ? localStorage.setItem('qafila.screen', v) : localStorage.removeItem('qafila.screen'); },
  };

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const $fx = document.getElementById('fx');
  const $theme = document.querySelector('meta[name="theme-color"]');
  const socket = io({ transports: ['websocket', 'polling'] });

  let state = null;            // { room, game } from the server
  const ui = { revealed: false, picked: [], peek: false, target: null, confirmAbort: false, page: null, tvForm: false, tvPreview: false };
  let lastPhaseKey = '';

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('ar-SA');
  const nameOf = id => { const p = state?.room?.players.find(x => x.id === id); return p ? p.name : '؟'; };
  const names = ids => ids.map(nameOf).map(esc).join('، ');
  const ORDINAL = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة'];
  const isScreen = () => !!(state?.room?.screen || ui.tvPreview);

  // motion: everything below respects the phone's "reduce motion" setting
  const motionQuery = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const calm = () => motionQuery.matches;
  const buzz = pattern => { try { if (!calm() && !isScreen() && navigator.vibrate) navigator.vibrate(pattern); } catch (_) { /* not supported */ } };
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
    if (document.visibilityState === 'visible' && state?.room && (isScreen() || (state.game && state.game.phase !== 'end'))) keepAwake(true);
  });

  // ---------- art ----------
  const CAMEL = '<path d="M30 63 C26 70 25 80 27 92 C28 95 31 95 31 92 C30 82 31 72 33 65 Z"/><path d="M30 62 C22 64 17 74 19 85 C21 96 27 104 30 110 L28 148 C28 151 34 152 36 150 L37 112 C38 105 41 100 46 97 C60 99 82 101 100 100 L104 104 C106 111 106 118 106 124 L107 148 C107 151 113 152 115 150 L113 124 C114 116 116 108 120 100 C126 98 130 92 132 86 C136 80 142 75 150 73 C158 70 163 62 166 53 L168 45 L176 47 C182 48 186 47 189 44 C191 41 190 37 186 35 C180 32 172 30 166 30 C162 28 160 26 158 26 L156 21 L153 27 C149 31 147 37 147 45 C146 54 140 60 132 62 C124 64 118 60 114 54 C108 44 100 29 86 27 C72 25 62 35 56 45 C50 54 42 60 30 62 Z"/><path d="M40 92 C46 98 50 104 50 112 L42 148 C42 151 48 152 50 150 L57 114 C58 104 56 96 52 90 Z"/><path d="M110 98 C116 104 120 112 121 122 L130 148 C130 151 136 152 138 150 L129 121 C128 112 126 104 122 96 Z"/>';
  const camel = (w = 56) => `<svg class="camel-svg" viewBox="0 0 200 160" width="${w}" height="${Math.round(w * 0.8)}" aria-hidden="true"><g fill="currentColor">${CAMEL}</g></svg>`;
  const LANTERN = '<svg viewBox="0 0 26 38" width="26" height="38" aria-hidden="true"><path d="M13 0 V5" stroke="#1A1613" stroke-width="2"/><path d="M7 7 H19 L17 10 H9Z" fill="#1A1613"/><rect x="7" y="10" width="12" height="18" rx="3" fill="#F7C76B" stroke="#1A1613" stroke-width="2"/><path d="M13 14 C11 17 11 20 13 23 C15 20 15 17 13 14Z" fill="#E8742C"/><path d="M6 28 H20 L18 32 H8Z" fill="#1A1613"/></svg>';
  const DAGGER = '<svg viewBox="0 0 48 48" width="52" height="52" aria-hidden="true"><path d="M8 40 L14 34" stroke="#C9A270" stroke-width="5" stroke-linecap="round"/><rect x="12" y="29" width="10" height="5" rx="2" transform="rotate(-45 17 31)" fill="#B8892E"/><path d="M18 30 C24 22 30 14 42 6 C38 16 32 24 22 34Z" fill="#E7DCCB" stroke="#8C7A62" stroke-width="1"/></svg>';
  const PALM = (cls, style) => `<svg class="palm ${cls}" style="${style}" viewBox="0 0 90 170" aria-hidden="true"><path d="M44 170 C46 120 42 70 46 30" stroke="#6B4A2E" stroke-width="7" fill="none"/><g class="leaves" fill="#4F6B3A"><path d="M46 30 C30 14 12 16 2 30 C18 24 32 26 46 32Z"/><path d="M46 30 C62 12 80 14 90 28 C74 22 60 24 46 32Z"/><path d="M46 30 C40 10 48 0 58 0 C50 10 50 20 46 32Z"/><path d="M46 30 C26 30 14 46 12 58 C22 44 34 38 46 34Z"/><path d="M46 30 C66 30 78 46 80 58 C70 44 58 38 46 34Z"/></g></svg>`;

  const logo = (small) => `
    <div class="logo ${small ? 'small' : ''}" aria-label="قافلة">
      <span class="seal" aria-hidden="true">ق</span>
      <span class="word">قافلة</span>
      <span class="latin" dir="ltr">QAFILAH</span>
    </div>`;
  const stroke = (color = 'currentColor') => `<svg class="stroke" aria-hidden="true" viewBox="0 0 160 20" width="160" height="20"><path pathLength="1" d="M4 12 C40 2 66 18 92 8 S140 6 156 10" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;

  // pixel portraits for every role
  const portrait = (role, cls = '') => `<img class="portrait ${cls}" src="img/roles/${role.id.toLowerCase()}.webp" alt="" draggable="false">`;

  // a neutral seal with the player's first letter (never hints at a role)
  const avatar = (name, i) => `<span class="avatar" style="--h:${(i * 47) % 360}" aria-hidden="true">${esc(String(name).trim().charAt(0) || '؟')}</span>`;

  const dunes = () => `<div class="dunes" aria-hidden="true">
      <svg viewBox="0 0 1200 160" preserveAspectRatio="none"><path d="M0 110 C160 70 300 70 460 100 S760 140 900 96 S1120 60 1200 84 L1200 160 L0 160 Z" class="d1"/><path d="M0 132 C200 104 360 120 540 130 S860 150 1020 122 S1160 112 1200 118 L1200 160 L0 160 Z" class="d2"/></svg>
      <div class="caravan-walk">${camel(48)}${camel(40)}${camel(44)}</div>
    </div>`;
  const sadu = () => '<div class="sadu" aria-hidden="true"></div>';

  const seenPlayers = new Set();   // lobby chips pop in only when someone new joins

  // dots that only "pop" when they newly fill in
  const seenDots = {};
  function dots(total, on, key) {
    const k = `${lastPhaseKey}|${key}`;
    const was = k in seenDots ? seenDots[k] : on;
    seenDots[k] = on;
    return `<div class="progress">${Array.from({ length: total }, (_, i) => `<i class="${i < on ? (i >= was ? 'on pop' : 'on') : ''}"></i>`).join('')}</div>`;
  }

  // ---------- home ----------
  function homeView() {
    const code = new URLSearchParams(location.search).get('r') || '';
    if (ui.tvForm) {
      return `<div class="screen home">
        <div class="hero stack center"><div style="margin-top:24px">${logo()}</div><p class="muted tagline">شاشة المجلس</p>
          <p class="pitch muted" style="display:block">افتح هذي الصفحة على لابتوب أو تلفزيون في نص المجلس. تعرض الطريق والقائد والأصوات للكل، وما تكشف أي سر.</p></div>
        <div class="stack"><form class="stack card" data-form="watch" autocomplete="off">
          <label for="code">كود الغرفة</label>
          <input id="code" name="code" class="code" type="tel" inputmode="numeric" maxlength="4" placeholder="0000" value="${esc(code)}">
          <button class="btn" type="submit">اعرض المجلس</button>
          <button class="btn ghost" type="button" data-act="tvform">رجوع</button>
        </form></div>${dunes()}</div>`;
    }
    return `<div class="screen home">
      <div class="hero stack center">
        <div style="margin-top:24px">${logo()}</div>
        <p class="muted tagline">واحد منكم مو منكم.</p>
        <p class="pitch muted">لعبة خداع جماعية تلعبونها وأنتم جالسين مع بعض. قافلة تقطع الصحراء بالليل، وبين المسافرين غزاة متنكرين. اكشفوهم قبل لا تفشل الرحلة.</p>
        <div class="home-links"><button class="chip-btn" data-page="rules">كيف تلعب</button><button class="chip-btn" data-page="roles">الشخصيات</button><button class="chip-btn" data-act="tvform">شاشة المجلس</button></div>
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

  // ---------- pages: how to play, characters ----------
  const ROLE_INFO = [
    { id: 'AHNAF', name: 'الأحنف', team: 'caravan', when: 'دايم', sees: 'الغزاة كلهم إلا العلقمي', seenBy: 'فارس (بس يختلط عليه مع لؤلؤة)', blurb: 'حكيم القافلة. يعرف الغزاة، بس لو بيّن إنه يعرف، وحشي بيكشفه في النهاية.', tip: 'لمّح ولا تصرّح. خلّ غيرك يتهم بدالك.' },
    { id: 'FARIS', name: 'فارس', team: 'caravan', when: 'اختياري مع لؤلؤة', sees: 'الأحنف ولؤلؤة، بدون ما يعرف مين مين', seenBy: 'محد', blurb: 'حامي الأحنف. يشوف اثنين: واحد الأحنف، والثاني لؤلؤة المتنكرة.', tip: 'راقب الاثنين: الأحنف يدفع للفريق الصح، ولؤلؤة تحاول تقنعك.' },
    { id: 'RAHHALA', name: 'رحّالة', team: 'caravan', when: 'دايم (الباقين من القافلة)', sees: 'ولا أحد', seenBy: 'محد', blurb: 'مسافر عادي ما يعرف شي. سلاحه الملاحظة: مين يختار مين، ومين فشلت محطاته.', tip: 'تذكّر مين كان في كل فريق فشل.' },
    { id: 'WAHSHI', name: 'وحشي', team: 'raiders', when: 'دايم', sees: 'جماعته من الغزاة (إلا شمهروش)', seenBy: 'الأحنف', blurb: 'قاتل الغزاة. لو نجحت القافلة في ثلاث محطات، عنده فرصة أخيرة: يختار الأحنف ويفوز الغزاة.', tip: 'طول اللعبة راقب مين يعرف أكثر من اللازم.' },
    { id: 'LULUA', name: 'لؤلؤة', team: 'raiders', when: 'اختياري مع فارس', sees: 'جماعتها من الغزاة', seenBy: 'الأحنف، وفارس (يحسبها الأحنف يمكن)', blurb: 'متنكرة. تبان لفارس كأنها الأحنف، فتقدر تسحبه لصفها.', tip: 'تصرّفي كأنك تعرفين الغزاة، وخلّي فارس يثق فيك.' },
    { id: 'ALQAMI', name: 'العلقمي', team: 'raiders', when: 'اختياري (٧ لاعبين وفوق)', sees: 'جماعته من الغزاة', seenBy: 'جماعته بس، والأحنف ما يشوفه', blurb: 'قائد الغزاة الخفي. الأحنف نفسه ما يعرفه، فهو أخطر واحد في القافلة.', tip: 'كن أكثر واحد يبان مخلص.' },
    { id: 'SHAMHOROUSH', name: 'شمهروش', team: 'raiders', when: 'اختياري (١٠ لاعبين)', sees: 'ولا أحد', seenBy: 'الأحنف', blurb: 'غازي ضايع. ما يعرف جماعته وهم ما يعرفونه، بس الأحنف يشوفه.', tip: 'دوّر على جماعتك من طريقة تصويتهم.' },
    { id: 'RAIDER', name: 'غازي', team: 'raiders', when: 'الباقين من الغزاة', sees: 'جماعته من الغزاة', seenBy: 'الأحنف', blurb: 'من الغزاة المتنكرين بين المسافرين. يخرّب المحطات بدون ما ينكشف.', tip: 'لا تخرّب كل مرة، أحيانًا الصبر يفوّز.' },
  ];

  function rolesPage() {
    return `<div class="screen page roles-page">
      <div class="topbar">${logo(true)}<button class="link" data-page="">رجوع</button></div>
      ${sadu()}
      <div class="page-head"><h1 class="display">الشخصيات</h1><p class="muted">ثلاث من القافلة، وخمس من الغزاة. الأحنف ووحشي موجودين في كل لعبة، والباقين حسب عددكم واختيار المضيف.</p></div>
      <div class="role-grid">${ROLE_INFO.map((r, i) => `
        <article class="rcard ${r.team}" style="--i:${i}">
          <div class="rart">${portrait(r)}</div>
          <div class="rbody">
            <span class="rteam">${r.team === 'caravan' ? 'القافلة' : 'الغزاة'} · ${esc(r.when)}</span>
            <h2 class="display">${esc(r.name)}</h2>
            <p>${esc(r.blurb)}</p>
            <dl><dt>يشوف</dt><dd>${esc(r.sees)}</dd><dt>يشوفه</dt><dd>${esc(r.seenBy)}</dd></dl>
            <p class="tip">${esc(r.tip)}</p>
          </div>
        </article>`).join('')}</div>
      <button class="btn" data-page="rules">كيف تلعب</button>
    </div>`;
  }

  function rulesPage() {
    const rows = [5, 6, 7, 8, 9, 10].map(n => `<tr><td>${num(n)}</td><td class="cv">${num(TEAM_SIZES[n][0])}</td><td class="rd">${num(TEAM_SIZES[n][1])}</td><td><span class="qsz">${QUEST_SIZES[n].map(q => `<i>${num(q)}</i>`).join('')}</span></td></tr>`).join('');
    const step = (n, title, body, art = '') => `<section class="rstep" style="--i:${n}"><span class="rnum">${num(n)}</span><div><h2>${title}</h2>${body}</div>${art ? `<div class="rart-mini">${art}</div>` : ''}</section>`;
    return `<div class="screen page rules-page">
      <div class="topbar">${logo(true)}<button class="link" data-page="">رجوع</button></div>
      ${sadu()}
      <div class="page-head"><h1 class="display">كيف تلعب</h1><p class="muted">قافلة تقطع الصحراء في خمس محطات، وبين المسافرين غزاة متنكرين. كل واحد يلعب من جواله، والنقاش بينكم بصوت عالي.</p></div>
      <div class="teams-row"><div class="tbox cv"><b class="display">القافلة</b><span>يبون ثلاث محطات تنجح</span></div><div class="tbox rd"><b class="display">الغزاة</b><span>يبون ثلاث محطات تفشل</span></div></div>
      ${step(1, 'الليل: كل واحد يشوف دوره', '<p>غطّ جوالك واكشف دورك بسرّية. بعض الشخصيات تعرف ناس ثانيين، مثل الأحنف اللي يعرف الغزاة. شوف <button class="inline-link" data-page="roles">الشخصيات</button>.</p>', '<span class="moon-mini"></span>')}
      ${step(2, 'القائد يختار الفريق', '<p>اللي معه الفانوس هو القائد. يختار مين يطلع للمحطة، وتتناقشون: تثقون فيهم؟ الفانوس يمشي للي جنبه كل جولة.</p>', LANTERN)}
      ${step(3, 'الكل يصوّت بسرّية', '<p>كل واحد يختار موافق أو رافض من جواله. إذا الموافقين أكثر من النص ينقبل الفريق، والتعادل رفض. <b>التصويت سرّي:</b> يطلع العدد بس، ومحد يعرف مين رفض.</p><p>كل رفض يطفي مشعل. لو انطفت <b>خمس مشاعل ورا بعض</b> يفوز الغزاة.</p>', '<span class="torch-mini"><i></i></span>')}
      ${step(4, 'الفريق في المحطة', '<p>اللي في الفريق بس يختارون بسرّية: <b>أوصل القافلة</b> أو <b>خرّب</b>. أهل القافلة لازم يوصلون، ولو ضغطوا «خرّب» تنحسب «أوصل». البطاقات تنخلط وتنكشف بدون أسماء.</p><p><b>تخريب واحد يكفي:</b> لو واحد خرّب، تفشل المحطة.</p>', '<span class="qi water"></span><span class="qi poison"></span>')}
      ${step(5, 'مين يفوز؟', '<p>ثلاث محطات تفشل: يفوز الغزاة على طول. ثلاث محطات تنجح: القافلة قربت، بس باقي <b>لحظة وحشي</b>: الغزاة ينكشفون لبعض، ووحشي يختار واحد. لو كان الأحنف، يفوز الغزاة. لو غلط، تفوز القافلة.</p>', DAGGER)}
      <div class="card"><h2 style="font-size:18px;margin-bottom:8px">كم واحد في كل فريق؟</h2>
        <table class="ctable"><thead><tr><th>اللاعبين</th><th>القافلة</th><th>الغزاة</th><th>حجم الفريق في المحطات الخمس</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card tips"><h2 style="font-size:18px;margin-bottom:6px">نصائح</h2>
        <ul><li>راقبوا مين كان في الفرق اللي فشلت.</li><li>الأحنف لا يبيّن إنه يعرف كل شي، وحشي يراقب.</li><li>شاشة المجلس على لابتوب في النص تسهّل على الكل.</li></ul></div>
      <button class="btn" data-page="roles">الشخصيات</button>
    </div>`;
  }

  // ---------- lobby ----------
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
      <div class="topbar a-top">${logo(true)}<span class="row" style="gap:4px"><button class="help" data-page="rules" aria-label="كيف تلعب">؟</button><button class="link" data-act="leave">اطلع</button></span></div>
      <div class="card stack center a-code">
        <span class="muted small">كود الغرفة</span>
        <div class="roomcode" dir="ltr">${esc(r.code).split('').map((d, i) => `<span style="--i:${i}">${d}</span>`).join('')}</div>
        <button class="btn ghost" data-act="share">شارك رابط الغرفة</button>
        <p class="small muted">عندكم لابتوب أو تلفزيون؟ افتحوا الموقع عليه واختاروا «شاشة المجلس».</p>
      </div>
      <div class="stack a-players">
        <div class="row spread"><h2 style="font-size:18px">المسافرين</h2><span class="muted small">${num(n)} من ${num(r.max)}</span></div>
        <ul class="players">${players}${empty}</ul>
        <p class="small muted">ادخلوا بترتيب جلستكم: الفانوس يمشي على هالترتيب.</p>
      </div>
      <div class="card a-roles">
        <div class="row spread" style="margin-bottom:6px"><h2 style="font-size:18px">الشخصيات</h2><button class="inline-link" data-page="roles">وش يسوون؟</button></div>
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

  // ---------- night ----------
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

  const stars = (n, spread = 70) => Array.from({ length: n }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--y:${(i * 53) % spread}%;--d:${(i % 5) * 0.4}s"></i>`).join('');
  const nightCover = (inner, act = '') => `<${act ? 'button' : 'div'} class="cover" ${act ? `data-act="${act}"` : ''}>
      <span class="moon" aria-hidden="true"></span>
      <span class="sky" aria-hidden="true">${stars(14)}</span>
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

  // ---------- board pieces ----------
  const camelTarget = g => (g.phase === 'assassin' || g.phase === 'end') ? Math.max(g.results.length - 1, 0) : Math.min(g.results.length, 4);
  const STATION_ICON = [
    '<ellipse cx="0" cy="8" rx="15" ry="5"/><rect x="-15" y="-1" width="30" height="9"/><rect x="-13" y="-20" width="3" height="20"/><rect x="10" y="-20" width="3" height="20"/><rect x="-15" y="-22" width="30" height="4"/><rect x="-3" y="-16" width="6" height="6" rx="1"/>',
    '<path d="M-22 10 L-9 -15 L-2 4 L2 4 L9 -15 L22 10Z"/>',
    '<path d="M-24 11 L-7 -19 L2 -4 L9 -13 L24 11Z"/><path d="M-7 -19 L-2 -10 L-11 -11Z" fill="#F4ECDD"/>',
    '<path d="M-24 11 C-13 -8 -2 -15 7 -9 C15 -5 20 4 24 11Z"/>',
    '<path d="M-1 13 C0 2 -2 -6 0 -11" stroke="currentColor" stroke-width="3" fill="none"/><path d="M0 -11 C-8 -19 -17 -17 -21 -9 C-13 -13 -6 -12 0 -9Z"/><path d="M0 -11 C8 -20 17 -18 21 -10 C13 -14 6 -12 0 -9Z"/><path d="M0 -11 C-2 -21 4 -25 9 -24 C4 -19 3 -15 0 -9Z"/>',
  ];

  function routeBoard(g) {
    const at = ui.camelAt ?? camelTarget(g);
    return `<div class="card stack route-card">
      <div class="route" style="--at:${at}">
        <svg class="trail" viewBox="0 0 500 40" preserveAspectRatio="none" aria-hidden="true"><path d="M50 22 C110 6 150 34 200 22 S290 8 350 22 S420 34 450 22" fill="none" stroke-dasharray="2 7" stroke-linecap="round"/></svg>
        <div class="camel" aria-hidden="true">${camel(40)}</div>
        ${g.stations.map((s, i) => {
          const r = g.results[i];
          const cls = r ? (r.success ? 'win' : 'lose') : (i === g.questIndex && g.phase !== 'end' && g.phase !== 'assassin' ? 'now' : '');
          const stamp = ui.once.has(`stamp${i}`) ? 'stamp' : '';
          return `<div class="stop"><div class="dot ${cls} ${stamp}" aria-label="${esc(s)}: ${r ? (r.success ? 'نجحت' : 'فشلت') : num(g.questSizes[i]) + ' لاعبين'}">
              <svg viewBox="-26 -26 52 52" class="sicon" aria-hidden="true"><g fill="currentColor">${STATION_ICON[i]}</g></svg>
              ${r ? `<span class="res">${r.success ? '✓' : '✕'}</span>` : ''}</div>
            <span class="s">${esc(s)}</span><span class="n">${num(g.questSizes[i])} بالفريق</span></div>`;
        }).join('')}
      </div>
      ${torches(g)}
    </div>`;
  }

  // five torches: each rejected team in a row puts one out
  function torches(g) {
    const out = g.rejects;
    return `<div class="torches ${out >= 3 ? 'danger' : ''}" aria-label="الرفض المتتالي ${num(out)} من ${num(g.maxRejects)}" style="--warm:${1 - out * 0.17}">
      <span class="tlabel">${out ? `انطفى ${num(out)} من ${num(g.maxRejects)}` : 'المشاعل شابّة'}</span>
      <div class="trow">${Array.from({ length: g.maxRejects }, (_, i) => {
        const isOut = i < out;
        const just = isOut && ui.once.has('reject') && i === out - 1;
        const relit = !isOut && ui.once.has('relight');
        return `<span class="torch ${isOut ? 'out' : ''} ${just ? 'just' : ''} ${relit ? 'relit' : ''}" style="--i:${i}"><i class="fl"></i><i class="smoke"></i><i class="cup"></i><i class="stick"></i></span>`;
      }).join('')}</div>
    </div>`;
  }

  // the majlis: everyone around the fire in seating order, me at the bottom
  function majlis(g, opts = {}) {
    const order = g.players.map(p => p.id);
    const n = order.length;
    const meIdx = Math.max(order.indexOf(g.me), 0);
    const pos = id => {
      const k = (order.indexOf(id) - meIdx + n) % n;
      const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
      return { x: 50 + 40 * Math.cos(a), y: 50 + 39 * Math.sin(a) };
    };
    const picking = opts.picking;
    const team = picking ? ui.picked : (g.phase === 'vote' || g.phase === 'quest' ? g.team : []);
    const voted = g.phase === 'vote' ? (g.votedIds || []) : null;
    const connected = id => (state.room.players.find(p => p.id === id) || {}).connected !== false;
    const targets = opts.targets || null;
    const seats = order.map((id, i) => {
      const { x, y } = pos(id);
      const inTeam = team.includes(id);
      const mark = voted ? (voted.includes(id) ? '<span class="vmark done">✓</span>' : '<span class="vmark">…</span>') : '';
      const tag = picking ? 'button' : 'div';
      const attrs = picking ? `data-pick="${esc(id)}" aria-pressed="${inTeam}"` : (targets && targets.includes(id) ? `data-target="${esc(id)}" aria-pressed="${ui.target === id}"` : '');
      const realTag = targets && targets.includes(id) ? 'button' : tag;
      return `<${realTag} class="seat ${id === g.me ? 'me' : ''} ${id === g.leader && g.phase !== 'assassin' ? 'lead' : ''} ${inTeam ? 'inteam' : ''} ${connected(id) ? '' : 'off'} ${ui.target === id ? 'aimed' : ''}" style="left:${x}%;top:${y}%" ${attrs}>
        ${avatar(nameOf(id), i)}${mark}<span class="nm">${id === g.me ? 'أنت' : esc(nameOf(id))}</span></${realTag}>`;
    }).join('');
    const lp = pos(g.leader);
    const at = ui.lanternAt && order.includes(ui.lanternAt) ? pos(ui.lanternAt) : lp;
    return `<div class="majlis ${opts.big ? 'big' : ''} ${g.phase === 'assassin' ? 'blood' : ''}" data-lx="${lp.x}" data-ly="${lp.y}">
      <div class="rug"></div><div class="glow"></div>
      <div class="fire"><div class="logs"></div><div class="flame"></div><div class="flame b"></div><div class="flame c"></div></div>
      ${seats}
      ${g.phase !== 'assassin' && g.phase !== 'end' ? `<div class="lantern" style="left:${at.x}%;top:${at.y}%"><span class="sw">${LANTERN}</span></div>` : ''}
    </div>`;
  }

  function lastEvent(g) {
    const h = g.history[g.history.length - 1];
    const res = g.results[g.results.length - 1];
    if (g.phase === 'team' && h && !h.approved) {
      return `<div class="banner bad">انرفض فريق ${esc(nameOf(h.leader))} · موافق ${num(h.yes)} · رافض ${num(h.no)}</div>`;
    }
    if (g.phase === 'quest' && h && h.approved) {
      return `<div class="banner ok">الفريق انقبل (موافق ${num(h.yes)} · رافض ${num(h.no)}). ${names(h.team)} طالعين للمحطة.</div>`;
    }
    if (g.phase === 'team' && res && g.results.length && (!h || h.approved)) {
      const i = g.results.length - 1;
      return `<div class="banner ${res.success ? 'ok' : 'bad'}">محطة ${esc(g.stations[i])} ${res.success ? 'نجحت' : 'فشلت'}${res.fails ? ` · عدد التخريب: ${num(res.fails)}` : ' · بدون تخريب'}</div>`;
    }
    return '';
  }

  function historyView(g) {
    if (!g.history.length) return '';
    const items = g.history.slice().reverse().map(h => `<div class="hist-item">
        <span><b>${esc(g.stations[h.quest])}</b> · القائد ${esc(nameOf(h.leader))} · ${h.approved ? 'انقبل' : 'انرفض'}</span>
        <span class="muted">الفريق: ${names(h.team)}</span>
        <div class="votes"><span class="y">موافق ${num(h.yes)}</span><span class="n">رافض ${num(h.no)}</span></div>
      </div>`).join('');
    return `<details class="history"><summary>سجل الرحلة</summary>${items}<p class="small muted" style="padding:4px 0 10px">التصويت سرّي: يبان العدد بس.</p></details>`;
  }

  function phasePanel(g) {
    const leader = g.leader === g.me;
    const size = g.questSizes[g.questIndex];
    if (g.phase === 'team') {
      if (!leader) return `${majlis(g)}<div class="card stack center"><span class="muted small">معه الفانوس</span><span class="display leader-name" style="font-size:32px">${esc(nameOf(g.leader))}</span><span>يختار ${num(size)} لمحطة ${esc(g.stations[g.questIndex])}. ناقشوه!</span></div>`;
      ui.picked = ui.picked.filter(id => g.players.some(p => p.id === id));
      return `<div class="row spread"><span class="tag lantern-tag">${LANTERN} معك الفانوس</span><span class="small muted">${num(ui.picked.length)} من ${num(size)}</span></div>
        <h2 style="font-size:20px">اختر ${num(size)} لمحطة ${esc(g.stations[g.questIndex])}</h2>
        <p class="small muted" style="margin-top:-6px">اضغط على الأسماء حول النار.</p>
        ${majlis(g, { picking: true })}
        <button class="btn" data-act="propose" ${ui.picked.length === size ? '' : 'disabled'}>اعرض الفريق للتصويت</button>`;
    }
    if (g.phase === 'vote') {
      const head = `<div class="stack"><h2 style="font-size:20px">تثق بهالفريق؟</h2><span class="muted">${esc(nameOf(g.leader))} اقترح:</span><div class="team-list">${g.team.map((id, i) => `<span style="--i:${i}">${esc(nameOf(id))}</span>`).join('')}</div></div>`;
      const progress = `<div class="stack center"><span class="small muted">صوّت ${num(g.votedCount)} من ${num(g.players.length)} · التصويت سرّي، يبان العدد بس</span></div>`;
      if (g.myVote === undefined) return head + `<div class="vote"><button class="yes" data-vote="1"><b>✓</b><span>موافق</span></button><button class="no" data-vote="0"><b>✕</b><span>رافض</span></button></div>` + majlis(g) + progress;
      return head + `<div class="voted ${g.myVote ? 'yes' : 'no'} ${ui.once.has('sealed') ? 'sealed' : ''}"><b>${g.myVote ? '✓' : '✕'}</b><span>صوّتّ: ${g.myVote ? 'موافق' : 'رافض'}</span><small>صوتك مختوم ومحد بيعرفه.</small></div>` + majlis(g) + progress;
    }
    if (g.phase === 'quest') {
      const inTeam = g.team.includes(g.me);
      const waiting = `<div class="stack center">${dots(g.team.length, g.playedCount, 'quest')}<span class="small muted">بانتظار الفريق: ${num(g.playedCount)} من ${num(g.team.length)}</span></div>`;
      if (inTeam && !g.iPlayed) {
        return `<div class="stack"><h2 style="font-size:20px">اختر بسرّية</h2><p class="muted small">محد بيعرف وش اخترت. تخريب واحد يكفي عشان تفشل المحطة.</p>
          <div class="quest"><button data-quest="0"><span class="qi water" aria-hidden="true"></span><span class="q">أوصل القافلة</span><span class="qs">قربة ماء</span></button>
          <button data-quest="1"><span class="qi poison" aria-hidden="true"></span><span class="q">خرّب</span><span class="qs">ماء مسموم</span></button></div>
          <p class="small muted">الشاشة نفسها تطلع للكل. أهل القافلة لو اختاروا «خرّب» تنحسب «أوصل».</p></div>` + waiting;
      }
      return `${majlis(g)}<div class="card stack center"><span>الفريق في محطة ${esc(g.stations[g.questIndex])}</span>${inTeam ? '<span class="muted small">اخترت. بانتظار الباقين.</span>' : ''}</div>` + waiting;
    }
    if (g.phase === 'assassin') {
      const raiders = g.raidersReveal;
      if (!raiders) return `<div class="card stack center assassin-wait"><img class="assassin-face" src="img/roles/wahshi.webp" alt=""><span class="display" style="font-size:30px">وحشي يدوّر على الأحنف</span><span>ثلاث محطات نجحت، بس الرحلة ما خلصت. الغزاة يتشاورون الحين. لو عرف وحشي الأحنف، يفوز الغزاة.</span></div>`;
      const raiderIds = raiders.map(r => r.id);
      const list = `<div class="card stack"><span class="small muted">الغزاة (تقدرون تتشاورون):</span><div class="chips" style="justify-content:flex-start">${raiders.map(r => `<span class="chip" style="color:var(--raiders)">${esc(nameOf(r.id))} · ${esc(r.role.name)}</span>`).join('')}</div></div>`;
      if (!g.isWahshi) return `<div class="banner bad">القافلة نجحت في ثلاث محطات. وحشي يختار الحين.</div>` + list + majlis(g);
      const options = g.players.filter(p => !raiderIds.includes(p.id)).map(p => p.id);
      return `<div class="banner bad">أنت وحشي. فرصة أخيرة: مين الأحنف؟</div>` + list +
        `<p class="small muted">اضغط على اللي تشك إنه الأحنف.</p>` + majlis(g, { targets: options }) +
        `<button class="btn red" data-act="assassinate" ${ui.target ? '' : 'disabled'}>${ui.target ? `${esc(nameOf(ui.target))} هو الأحنف` : 'اختر واحد'}</button>`;
    }
    return '';
  }

  function playView(g) {
    return `<div class="screen play ${g.phase === 'assassin' ? 'blood' : ''}">
      <div class="topbar a-top">${logo(true)}<span class="row" style="gap:6px"><button class="help" data-page="rules" aria-label="كيف تلعب">؟</button><button class="peek" data-act="peek">دوري</button></span></div>
      <div class="a-route">${routeBoard(g)}</div>
      <div class="a-event">${lastEvent(g)}</div>
      <div class="a-panel stack ${ui.once.has('ping') ? 'ping' : ''}" data-phase="${g.phase}">${phasePanel(g)}</div>
      <div class="a-hist">${historyView(g)}</div>
      ${state.room.isHost ? `<div class="a-abort center"><button class="link" data-act="abort">${ui.confirmAbort ? 'متأكد؟ اضغط مرة ثانية وترجعون للانتظار' : 'إنهاء اللعبة (للمضيف)'}</button></div>` : ''}
      </div>
      ${ui.peek ? `<div class="sheet ${ui.once.has('sheet') ? 'open' : ''}" data-act="peek"><div>${roleCard(g)}<button class="btn" data-act="peek">أخفِ</button></div></div>` : ''}`;
  }

  // ---------- endings ----------
  function endingScene(win) {
    if (win === 'caravan') {
      return `<div class="scene oasis" aria-hidden="true"><span class="sunset"></span>
        ${PALM('', 'left:6%')}${PALM('p2', 'left:18%;height:110px;bottom:52px')}${PALM('p3', 'right:6%')}
        <span class="water"></span>
        <svg class="ground" viewBox="0 0 1000 90" preserveAspectRatio="none"><path d="M0 30 C200 0 380 20 520 30 S820 10 1000 24 L1000 90 L0 90Z" fill="#DFCDAE"/></svg>
        <div class="arrive">${camel(52)}${camel(44)}${camel(48)}</div></div>`;
    }
    return `<div class="scene storm-scene" aria-hidden="true">
      <svg class="ground" viewBox="0 0 1000 90" preserveAspectRatio="none"><path d="M0 30 C200 0 380 20 520 30 S820 10 1000 24 L1000 90 L0 90Z" fill="#B8935F"/></svg>
      <div class="lost">${camel(52)}${camel(44)}${camel(48)}</div>
      <div class="storm"></div><div class="storm s2"></div>
      <div class="grains">${Array.from({ length: 36 }, (_, i) => `<i style="--y:${(i * 37) % 100}%;--d:${(i % 10) * 0.11}s"></i>`).join('')}</div></div>`;
  }

  function endView(g) {
    const win = g.winner;
    return `<div class="screen end">
      <div class="topbar a-top">${logo(true)}<span class="muted small">الصباح</span></div>
      <div class="winner a-win ${win}">${endingScene(win)}<div class="wtext"><span class="display">${win === 'caravan' ? 'وصلت القافلة!' : 'فاز الغزاة!'}</span><span class="small">${esc(g.reason)}</span></div></div>
      ${g.assassinTarget ? `<div class="banner info a-target">وحشي اختار ${esc(nameOf(g.assassinTarget))}.</div>` : ''}
      <div class="a-route">${routeBoard(g)}</div>
      <div class="stack a-reveal"><h2 style="font-size:18px">انكشف كل شي</h2>
        <ul class="reveal">${g.reveal.map((r, i) => `<li class="${r.role.team}" style="--i:${i}">${portrait(r.role, 'mini')}<span class="who">${esc(nameOf(r.id))}${r.id === g.me ? ' (أنت)' : ''}</span><span class="r">${esc(r.role.name)}</span></li>`).join('')}</ul></div>
      <div class="a-hist">${historyView(g).replace('<details class="history">', '<details class="history" open>')}</div>
      <div class="a-again">${state.room.isHost ? `<button class="btn" data-act="again">جولة جديدة</button>` : `<p class="center muted">بانتظار المضيف يبدأ جولة جديدة…</p>`}</div>
    </div>`;
  }

  // ---------- the big screen (laptop / TV in the middle of the majlis) ----------
  function tvView() {
    const r = state.room;
    const g = state.game;
    const exit = ui.tvPreview ? '<button class="link" data-act="tvpreview">رجوع لجوالك</button>' : '<button class="link" data-act="unwatch">اطلع</button>';
    if (!g) {
      return `<div class="screen tv tv-lobby">
        <div class="tv-top">${logo(true)}${exit}</div>
        <div class="tv-join"><span class="muted">ادخلوا من جوالاتكم على</span><b dir="ltr">${esc(location.host)}</b><span class="muted">وكود الغرفة</span>
          <div class="roomcode big" dir="ltr">${esc(r.code).split('').map((d, i) => `<span style="--i:${i}">${d}</span>`).join('')}</div></div>
        <div class="tv-players">${r.players.map((p, i) => `<span class="tvp" style="--i:${i}">${avatar(p.name, i)}${esc(p.name)}</span>`).join('') || '<span class="muted">محد دخل للحين</span>'}</div>
        <p class="muted center">${num(r.players.length)} من ${num(r.max)} · المضيف يبدأ الرحلة من جواله</p>
        ${dunes()}</div>`;
    }
    if (g.phase === 'night') {
      const readyCount = g.players.filter(p => p.ready).length;
      return `<div class="screen tv tv-night"><span class="sky" aria-hidden="true">${stars(40, 60)}</span><span class="moon big" aria-hidden="true"></span>
        <div class="tv-center"><span class="display">نامت القافلة…</span><span>كل واحد يشوف دوره في جواله بسرّية</span>${dots(g.players.length, readyCount, 'ready')}<span class="small">${num(readyCount)} من ${num(g.players.length)} جاهزين</span></div>
        <span class="cover-camels" aria-hidden="true">${camel(70)}${camel(58)}${camel(64)}</span></div>`;
    }
    if (g.phase === 'end') {
      return `<div class="screen tv tv-end">
        <div class="winner ${g.winner}">${endingScene(g.winner)}<div class="wtext"><span class="display">${g.winner === 'caravan' ? 'وصلت القافلة!' : 'فاز الغزاة!'}</span><span>${esc(g.reason)}</span></div></div>
        <ul class="reveal tvgrid">${g.reveal.map((x, i) => `<li class="${x.role.team}" style="--i:${i}">${portrait(x.role, 'mini')}<span class="who">${esc(nameOf(x.id))}</span><span class="r">${esc(x.role.name)}</span></li>`).join('')}</ul>
        <div class="tv-foot">${exit}</div></div>`;
    }
    const size = g.questSizes[g.questIndex];
    const station = g.stations[g.questIndex];
    let big = '', sub = '';
    if (g.phase === 'team') { big = `معه الفانوس <em>${esc(nameOf(g.leader))}</em><br>يختار ${num(size)} لمحطة ${esc(station)}`; sub = 'ناقشوه بصوت عالي. مين تثقون فيه؟'; }
    if (g.phase === 'vote') { big = `تثقون بالفريق؟`; sub = `${names(g.team)} · صوّت ${num(g.votedCount)} من ${num(g.players.length)}، والأصوات سرّية`; }
    if (g.phase === 'quest') { big = `الفريق في <em>${esc(station)}</em>`; sub = `${names(g.team)} يختارون بسرّية · ${num(g.playedCount)} من ${num(g.team.length)}`; }
    if (g.phase === 'assassin') { big = `<em class="red">وحشي</em> يدوّر على الأحنف`; sub = 'ثلاث محطات نجحت. الغزاة يتشاورون، وفرصة أخيرة لوحشي.'; }
    return `<div class="screen tv tv-play ${g.phase === 'assassin' ? 'blood' : ''}">
      <div class="tv-left">
        <div class="tv-top">${logo(true)}<span class="pill">كود الغرفة <b dir="ltr">${esc(r.code)}</b></span></div>
        ${routeBoard(g)}
        <div class="tv-status"><div class="big">${big}</div><div class="sub">${sub}</div>
          ${g.phase === 'vote' ? dots(g.players.length, g.votedCount, 'vote') : g.phase === 'quest' ? dots(g.team.length, g.playedCount, 'quest') : ''}</div>
        ${lastEvent(g)}
        <div class="tv-foot">${exit}</div>
      </div>
      <div class="tv-right">${majlis(g, { big: true })}</div>
    </div>`;
  }

  // ---------- render ----------
  ui.once = new Set();     // one-shot animation flags, cleared after each render
  let screenKey = '';
  function render() {
    let html, key;
    if (ui.page === 'rules') { html = rulesPage(); key = 'rules'; }
    else if (ui.page === 'roles') { html = rolesPage(); key = 'roles'; }
    else if (!state || !state.room) { html = homeView(); key = ui.tvForm ? 'tvform' : 'home'; }
    else if (isScreen()) { html = tvView(); key = 'tv-' + (state.game ? state.game.phase : 'lobby'); }
    else if (!state.game) { html = lobbyView(); key = 'lobby'; }
    else if (state.game.phase === 'night') { html = nightView(state.game); key = 'night'; }
    else if (state.game.phase === 'end') { html = endView(state.game); key = 'end'; }
    else { html = playView(state.game); key = 'play'; }
    // a new screen plays its entrance once, but not while an overlay is covering it
    const fresh = key !== screenKey && !fx.busy;
    if (!fx.busy) screenKey = key;
    $app.innerHTML = html;
    $app.classList.toggle('wide', isScreen() && !ui.page);
    document.body.classList.toggle('tvmode', isScreen() && !ui.page && window.innerWidth >= 900);
    if (fresh && $app.firstElementChild) { $app.firstElementChild.classList.add('fresh'); if (ui.page) window.scrollTo(0, 0); }
    const dark = !ui.page && (key === 'night' || key === 'tv-night');
    document.body.classList.toggle('dark', dark);
    if ($theme) $theme.content = dark ? '#15110E' : '#F4ECDD';
    ui.once.clear();
    walkCamel();
    moveLantern();
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

  // the lantern walks around the circle to the next leader
  function moveLantern() {
    const g = state?.game;
    const m = $app.querySelector('.majlis');
    const L = m && m.querySelector('.lantern');
    if (!g || !L) return;
    if (ui.lanternAt === g.leader || calm() || fx.busy) { if (!fx.busy) ui.lanternAt = g.leader; return; }
    ui.lanternAt = g.leader;
    void L.offsetWidth;
    L.classList.add('moving');
    L.style.left = m.dataset.lx + '%';
    L.style.top = m.dataset.ly + '%';
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
      <div class="fx-text"><span class="display">نامت القافلة…</span><span>${isScreen() ? 'كل واحد يشوف دوره في جواله' : 'كل واحد يشوف دوره بسرّية'}</span></div>`;
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

  // secret vote: the cards come face down in random order, with no names on them
  function fxVote(entry, g) {
    return (layer, done) => {
      const cards = Array.from({ length: entry.yes + entry.no }, (_, i) => i < entry.yes);
      for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      layer.classList.add('fx-cards');
      layer.innerHTML = `<div class="fx-box">
        <span class="fx-kicker">انكشفت الأصوات</span>
        <div class="vcards" style="--n:${Math.min(cards.length, 5)}">${cards.map((v, i) => `<div class="vcard" style="--i:${i}"><div class="in"><div class="back">ق</div><div class="face ${v ? 'y' : 'n'}"><b>${v ? '✓' : '✕'}</b></div></div></div>`).join('')}</div>
        <div class="tally"><span class="y">موافق ${num(entry.yes)}</span><span class="n">رافض ${num(entry.no)}</span></div>
        <div class="verdict ${entry.approved ? 'ok' : 'bad'}">${entry.approved ? 'انقبل الفريق' : 'انرفض الفريق'}</div>
        <span class="fx-sub">${entry.approved ? `${names(entry.team)} طالعين للمحطة` : `انطفى مشعل · ${num(g.rejects || g.maxRejects)} من ${num(g.maxRejects)}`}</span>
        <span class="tap">اضغط للمتابعة</span></div>`;
      layer.dataset.skip = '1';
      setTimeout(() => layer.classList.add('flipped'), 650);
      setTimeout(() => { layer.classList.add('decided'); buzz(entry.approved ? 40 : [60, 40, 60]); }, 1350);
      setTimeout(done, 3600);
    };
  }

  function fxQuest(index, res, g) {
    return (layer, done) => {
      const size = res.team ? res.team.length : g.questSizes[index];
      const cards = Array.from({ length: size }, (_, i) => i < res.fails);
      for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      layer.classList.add('fx-cards', 'quest-fx');
      layer.innerHTML = `<div class="fx-box">
        <span class="fx-kicker">محطة ${esc(g.stations[index])}</span>
        <span class="fx-sub step">نخلط البطاقات…</span>
        <div class="qcards shuffling">${cards.map((bad, i) => `<div class="qcard" style="--i:${i}"><div class="in"><div class="back">ق</div><div class="face ${bad ? 'bad' : 'good'}"><span class="qi ${bad ? 'poison' : 'water'}"></span><span>${bad ? 'خرّب' : 'أوصل'}</span></div></div></div>`).join('')}</div>
        <div class="verdict ${res.success ? 'ok' : 'bad'}">${res.success ? 'نجحت المحطة' : 'فشلت المحطة'}</div>
        <span class="fx-sub">${res.fails ? `عدد التخريب: ${num(res.fails)}` : 'بدون تخريب'}</span>
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

  // Wahshi's moment, part one: the screen turns red for everyone
  function fxWahshi(layer, done) {
    layer.classList.add('fx-wahshi');
    layer.innerHTML = `<div class="redwash"></div><div class="fx-box">
      <div class="wface"><img src="img/roles/wahshi.webp" alt=""></div>
      <span class="fx-kicker red">لحظة وحشي</span>
      <span class="fx-sub">ثلاث محطات نجحت… بس الرحلة ما خلصت.<br>لو عرف وحشي الأحنف، يفوز الغزاة.</span></div>`;
    buzz([80, 120, 80]);
    layer.dataset.skip = '1';
    setTimeout(done, 3200);
  }

  // part two: the dagger wanders over the caravan, then strikes
  function fxDagger(g) {
    return (layer, done) => {
      const caravan = g.reveal.filter(x => x.role.team === 'caravan').map(x => x.id);
      const target = g.assassinTarget;
      const right = g.winner === 'raiders';
      layer.classList.add('fx-wahshi', 'dagger-fx');
      layer.innerHTML = `<div class="redwash"></div><div class="fx-box">
        <span class="fx-kicker red">وحشي يختار…</span>
        <div class="dtargets">${caravan.map(id => `<div data-id="${esc(id)}">${esc(nameOf(id))}</div>`).join('')}<span class="dagger">${DAGGER}</span></div>
        <div class="verdict ${right ? 'bad' : 'ok'}">${right ? 'عرف الأحنف!' : 'طلع غلط!'}</div>
        <span class="fx-sub">${esc(nameOf(target))} ${right ? 'هو الأحنف فعلًا' : 'ما كان الأحنف'}</span>
        <span class="tap">اضغط للمتابعة</span></div>`;
      const boxes = [...layer.querySelectorAll('.dtargets div')];
      const dg = layer.querySelector('.dagger');
      const aim = el => { boxes.forEach(b => b.classList.toggle('hover', b === el)); dg.style.left = (el.offsetLeft + el.offsetWidth - 30) + 'px'; dg.style.top = (el.offsetTop + 4) + 'px'; };
      const ti = Math.max(0, boxes.findIndex(b => b.dataset.id === target));
      const path = [];
      for (let k = 0; k < 6; k++) path.push(boxes[(k * 2 + 1) % boxes.length]);
      path.push(boxes[ti]);
      path.forEach((b, k) => setTimeout(() => aim(b), 500 + k * (k < 4 ? 380 : 560)));
      const hitAt = 500 + 4 * 380 + 3 * 560 + 200;
      setTimeout(() => { dg.classList.add('strike'); boxes[ti].classList.add('hit'); buzz([30, 30, 160]); }, hitAt);
      setTimeout(() => { layer.classList.add('decided'); layer.dataset.skip = '1'; }, hitAt + 450);
      setTimeout(done, hitAt + 2800);
    };
  }

  const myTurn = g => {
    if (!g || isScreen()) return '';
    if (g.phase === 'team' && g.leader === g.me) return 'دورك! معك الفانوس، اختر الفريق';
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
    if (b.history.length > a.history.length) {
      const h = b.history[b.history.length - 1];
      queueFx(fxVote(h, b));
      if (!h.approved) ui.once.add('reject');
      else if (a.rejects > 0) ui.once.add('relight');
    }
    if (b.results.length > a.results.length) {
      const i = b.results.length - 1;
      queueFx(fxQuest(i, b.results[i], b));
      if (calm()) ui.once.add(`stamp${i}`);
    }
    if (b.phase === 'assassin' && a.phase !== 'assassin') queueFx(fxWahshi);
    if (b.phase === 'end' && a.phase !== 'end') {
      if (b.assassinTarget) queueFx(fxDagger(b));
      queueFx((layer, done) => { buzz(b.winner === 'caravan' ? [50, 40, 50, 40, 120] : [200, 80, 200]); layer.remove(); done(); });
    }
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
    if (!g) { ui.camelAt = null; ui.lanternAt = null; }
    if (!state.room) seenPlayers.clear();
    keepAwake(isScreen() || (!!g && g.phase !== 'end'));
    stageMoments(prev, next);
    render();
  }

  // ---------- events ----------
  $app.addEventListener('submit', async e => {
    const watch = e.target.closest('[data-form="watch"]');
    if (watch) {
      e.preventDefault();
      const code = watch.code.value.trim();
      if (!/^\d{4}$/.test(code)) return toast('الكود أربعة أرقام');
      const res = await send('watch', { code });
      if (res.ok) { store.screen = res.code; ui.tvForm = false; history.replaceState(null, '', '/'); }
      return;
    }
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
    const pg = e.target.closest('[data-page]');
    if (pg) { ui.page = pg.dataset.page || null; return render(); }
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
      case 'tvform': ui.tvForm = !ui.tvForm; render(); break;
      case 'tvpreview': ui.tvPreview = !ui.tvPreview; render(); break;
      case 'unwatch': store.screen = null; location.reload(); break;
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
    const params = new URLSearchParams(location.search);
    if (params.get('screen')) { store.screen = params.get('screen'); history.replaceState(null, '', '/'); }
    if (store.screen) {
      const res = await new Promise(r => socket.emit('watch', { code: store.screen }, r));
      if (!res || !res.ok) { store.screen = null; state = null; render(); }
      return;
    }
    if (store.room && store.id) {
      const res = await new Promise(r => socket.emit('join', { code: store.room, playerId: store.id, key: store.key, name: store.name }, r));
      if (res && res.ok) { store.id = res.playerId; store.key = res.key; }
      else { store.room = null; state = null; render(); }
    }
  });
  socket.on('disconnect', () => toast('انقطع الاتصال… نحاول نرجع'));

  render();
})();

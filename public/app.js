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
  const socket = io({ transports: ['websocket', 'polling'] });

  let state = null;            // { room, game } from the server
  let ui = { revealed: false, picked: [], peek: false, target: null, confirmAbort: false };
  let lastPhaseKey = '';

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('ar-SA');
  const nameOf = id => { const p = state?.room?.players.find(x => x.id === id); return p ? p.name : '؟'; };
  const names = ids => ids.map(nameOf).map(esc).join('، ');

  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.hidden = true; }, 2800);
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

  const logo = (small) => `
    <div class="logo ${small ? 'small' : ''}" aria-label="قافلة">
      <span class="seal" aria-hidden="true">ق</span>
      <span class="word">قافلة</span>
      <span class="latin" dir="ltr">QAFILAH</span>
    </div>`;
  const stroke = (color = 'currentColor') => `<svg class="stroke" aria-hidden="true" viewBox="0 0 160 20" width="160" height="20"><path d="M4 12 C40 2 66 18 92 8 S140 6 156 10" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;

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
      </div></div>`;
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
    return `<div class="screen lobby">
      <div class="topbar a-top">${logo(true)}<button class="link" data-act="leave">اطلع</button></div>
      <div class="card stack center a-code">
        <span class="muted small">كود الغرفة</span>
        <div class="roomcode">${esc(r.code)}</div>
        <button class="btn ghost" data-act="share">شارك رابط الغرفة</button>
      </div>
      <div class="stack a-players">
        <div class="row spread"><h2 style="font-size:18px">المسافرين</h2><span class="muted small">${num(n)} من ${num(r.max)}</span></div>
        <ul class="players">
          ${r.players.map(p => `<li class="${p.connected ? '' : 'off'}"><span>${esc(p.name)}${p.id === r.me ? ' (أنت)' : ''}</span>${p.id === r.hostId ? '<span class="tag">المضيف</span>' : ''}</li>`).join('')}
        </ul>
      </div>
      <div class="card a-roles">
        <h2 style="font-size:18px;margin-bottom:6px">الشخصيات</h2>
        <p class="small muted" style="margin-bottom:6px">الأحنف ووحشي موجودين دايم. ${r.isHost ? 'اختر الإضافات:' : 'المضيف يختار الإضافات.'}</p>
        ${opt('farisLulua', 'فارس ولؤلؤة', 'فارس يشوف الأحنف ولؤلؤة بدون ما يعرف مين مين. ينصح فيهم بعد أول قيم.')}
        ${opt('alqami', 'العلقمي', 'قائد الغزاة، والأحنف ما يشوفه. يناسب ٧ لاعبين وفوق.')}
        ${opt('shamhoroush', 'شمهروش', 'غازي ضايع ما يعرف جماعته. يناسب ١٠ لاعبين.')}
      </div>
      <div class="a-start">${r.isHost
        ? `<button class="btn" data-act="start" ${ready ? '' : 'disabled'}>${ready ? 'ابدأ الرحلة' : `تحتاجون ${num(r.min - n)} لاعبين بعد`}</button>`
        : `<p class="center muted">بانتظار المضيف يبدأ الرحلة…</p>`}</div>
    </div>`;
  }

  function roleCard(g) {
    const r = g.myRole;
    const seen = g.night && g.night.seen.length
      ? `<div class="seen"><span class="small">${esc(g.night.label)}</span><div class="chips">${g.night.seen.map(id => `<span class="chip">${esc(nameOf(id))}</span>`).join('')}</div></div>`
      : '';
    return `<div class="role ${r.team}">
      <span class="team">${r.team === 'caravan' ? 'فريق القافلة' : 'فريق الغزاة'}</span>
      <span class="name">${esc(r.name)}</span>
      ${stroke(r.team === 'caravan' ? '#1A1613' : '#E0473C')}
      <p class="blurb">${esc(r.blurb)}</p>
      ${seen}
    </div>`;
  }

  function nightView(g) {
    const me = g.players.find(p => p.id === g.me);
    const readyCount = g.players.filter(p => p.ready).length;
    if (me && me.ready) {
      return `<div class="screen night"><div class="topbar">${logo(true)}<span class="muted small">الليل</span></div>
        <div class="cover"><span class="display">نامت القافلة…</span><span>بانتظار الباقين يشوفون أدوارهم</span>
        <div class="progress">${g.players.map(p => `<i class="${p.ready ? 'on' : ''}"></i>`).join('')}</div>
        <span class="small">${num(readyCount)} من ${num(g.players.length)}</span></div></div>`;
    }
    return `<div class="screen night">
      <div class="topbar">${logo(true)}<span class="muted small">الليل · غرفة ${esc(state.room.code)}</span></div>
      <p class="center">غطِّ جوالك عن اللي جنبك، وشوف دورك.</p>
      ${ui.revealed
        ? roleCard(g) + `<button class="btn" data-act="ready">حفظت دوري، أخفه</button>`
        : `<button class="cover" data-act="reveal"><span class="display">نامت القافلة…</span><span>اضغط عشان تكشف دورك</span></button>`}</div>`;
  }

  function routeBoard(g) {
    return `<div class="card stack">
      <div class="route">
        ${g.stations.map((s, i) => {
          const r = g.results[i];
          const cls = r ? (r.success ? 'win' : 'lose') : (i === g.questIndex && g.phase !== 'end' ? 'now' : '');
          const mark = r ? (r.success ? '✓' : '✕') : num(g.questSizes[i]);
          return `<div class="stop"><div class="dot ${cls}" aria-label="${esc(s)}: ${r ? (r.success ? 'نجحت' : 'فشلت') : num(g.questSizes[i]) + ' لاعبين'}">${mark}</div>
            <span class="s">${esc(s)}</span><span class="n">${g.failsNeeded[i] > 1 ? 'تحتاج تخريبين' : num(g.questSizes[i]) + ' بالفريق'}</span></div>`;
        }).join('')}
      </div>
      <div class="rejects" aria-label="الرفض المتتالي ${num(g.rejects)} من ${num(g.maxRejects)}">الرفض المتتالي
        ${Array.from({ length: g.maxRejects }, (_, i) => `<i class="${i < g.rejects ? 'on' : ''}"></i>`).join('')}
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
      if (!leader) return `<div class="card stack center"><span class="muted small">القائد</span><span class="display" style="font-size:34px">${esc(nameOf(g.leader))}</span><span>يختار ${num(size)} لمحطة ${esc(g.stations[g.questIndex])}. ناقشوه!</span></div>`;
      ui.picked = ui.picked.filter(id => g.players.some(p => p.id === id));
      return `<div class="stack"><div><span class="tag">أنت القائد</span></div>
        <h2 style="font-size:20px">اختر ${num(size)} لمحطة ${esc(g.stations[g.questIndex])}</h2>
        <div class="pick">${g.players.map(p => `<button data-pick="${esc(p.id)}" aria-pressed="${ui.picked.includes(p.id)}">${esc(p.name)}${p.id === g.me ? ' (أنت)' : ''}</button>`).join('')}</div>
        <button class="btn" data-act="propose" ${ui.picked.length === size ? '' : 'disabled'}>اعرض الفريق للتصويت (${num(ui.picked.length)} من ${num(size)})</button></div>`;
    }
    if (g.phase === 'vote') {
      const head = `<div class="stack"><h2 style="font-size:20px">تثق بهالفريق؟</h2><span class="muted">${esc(nameOf(g.leader))} اقترح:</span><div class="team-list">${g.team.map(id => `<span>${esc(nameOf(id))}</span>`).join('')}</div></div>`;
      const progress = `<div class="stack center"><div class="progress">${g.players.map((_, i) => `<i class="${i < g.votedCount ? 'on' : ''}"></i>`).join('')}</div><span class="small muted">صوّت ${num(g.votedCount)} من ${num(g.players.length)} · الأصوات تنكشف لما يصوّت الكل</span></div>`;
      if (g.myVote === undefined) return head + `<div class="vote"><button class="yes" data-vote="1">✓<span>موافق</span></button><button class="no" data-vote="0">✕<span>رافض</span></button></div>` + progress;
      return head + `<div class="banner info center">صوّتّ: ${g.myVote ? 'موافق' : 'رافض'}</div>` + progress;
    }
    if (g.phase === 'quest') {
      const inTeam = g.team.includes(g.me);
      const waiting = `<div class="stack center"><div class="progress">${g.team.map((_, i) => `<i class="${i < g.playedCount ? 'on' : ''}"></i>`).join('')}</div><span class="small muted">بانتظار الفريق: ${num(g.playedCount)} من ${num(g.team.length)}</span></div>`;
      if (inTeam && !g.iPlayed) {
        return `<div class="stack"><h2 style="font-size:20px">اختر بسرّية</h2><p class="muted small">محد بيعرف وش اخترت، بس النتيجة تنكشف للكل.</p>
          <div class="quest"><button data-quest="0"><span class="q">أوصل القافلة</span><span class="qs">قربة ماء</span></button>
          <button data-quest="1"><span class="q">خرّب</span><span class="qs">ماء مسموم</span></button></div>
          <p class="small muted">الشاشة نفسها تطلع للكل. أهل القافلة لو اختاروا «خرّب» تنحسب «أوصل».</p></div>` + waiting;
      }
      return `<div class="card stack center"><span>الفريق في محطة ${esc(g.stations[g.questIndex])}:</span><div class="team-list" style="justify-content:center">${g.team.map(id => `<span>${esc(nameOf(id))}</span>`).join('')}</div>${inTeam ? '<span class="muted small">اخترت. بانتظار الباقين.</span>' : ''}</div>` + waiting;
    }
    if (g.phase === 'assassin') {
      const raiders = g.raidersReveal;
      if (!raiders) return `<div class="banner ok">ثلاث محطات نجحت! بس الرحلة ما خلصت…</div><div class="card stack center"><span class="display" style="font-size:30px">الغزاة يتشاورون</span><span>وحشي بيحاول يعرف مين الأحنف. لو عرفه، يفوز الغزاة.</span></div>`;
      const raiderIds = raiders.map(r => r.id);
      const list = `<div class="card stack"><span class="small muted">الغزاة (تقدرون تتشاورون):</span><div class="chips" style="justify-content:flex-start">${raiders.map(r => `<span class="chip" style="color:var(--raiders)">${esc(nameOf(r.id))} · ${esc(r.role.name)}</span>`).join('')}</div></div>`;
      if (!g.isWahshi) return `<div class="banner bad">القافلة نجحت في ثلاث محطات. وحشي يختار الحين.</div>` + list;
      const options = g.players.filter(p => !raiderIds.includes(p.id));
      return `<div class="banner bad">أنت وحشي. فرصة أخيرة: مين الأحنف؟</div>` + list + `
        <div class="pick">${options.map(p => `<button data-target="${esc(p.id)}" aria-pressed="${ui.target === p.id}">${esc(p.name)}</button>`).join('')}</div>
        <button class="btn red" data-act="assassinate" ${ui.target ? '' : 'disabled'}>هذا الأحنف</button>`;
    }
    return '';
  }

  function playView(g) {
    return `<div class="screen play">
      <div class="topbar a-top">${logo(true)}<button class="peek" data-act="peek">دوري</button></div>
      <div class="a-route">${routeBoard(g)}</div>
      <div class="a-event">${lastEvent(g)}</div>
      <div class="a-panel stack">${phasePanel(g)}</div>
      <div class="a-hist">${historyView(g)}</div>
      ${state.room.isHost ? `<div class="a-abort center"><button class="link" data-act="abort">${ui.confirmAbort ? 'متأكد؟ اضغط مرة ثانية وترجعون للانتظار' : 'إنهاء اللعبة (للمضيف)'}</button></div>` : ''}
      </div>
      ${ui.peek ? `<div class="sheet" data-act="peek"><div>${roleCard(g)}<button class="btn" data-act="peek">أخفِ</button></div></div>` : ''}`;
  }

  function endView(g) {
    const win = g.winner;
    return `<div class="screen end">
      <div class="topbar a-top">${logo(true)}<span class="muted small">الصباح</span></div>
      <div class="winner a-win ${win}"><span class="small">${esc(g.reason)}</span><span class="display">${win === 'caravan' ? 'وصلت القافلة!' : 'فاز الغزاة!'}</span></div>
      ${g.assassinTarget ? `<div class="banner info a-target">وحشي اختار ${esc(nameOf(g.assassinTarget))}.</div>` : ''}
      <div class="a-route">${routeBoard(g)}</div>
      <div class="stack a-reveal"><h2 style="font-size:18px">انكشف كل شي</h2>
        <ul class="reveal">${g.reveal.map(r => `<li class="${r.role.team}"><span>${esc(nameOf(r.id))}${r.id === g.me ? ' (أنت)' : ''}</span><span class="r">${esc(r.role.name)}</span></li>`).join('')}</ul></div>
      <div class="a-hist">${historyView(g).replace('<details class="history">', '<details class="history" open>')}</div>
      <div class="a-again">${state.room.isHost ? `<button class="btn" data-act="again">جولة جديدة</button>` : `<p class="center muted">بانتظار المضيف يبدأ جولة جديدة…</p>`}</div>
    </div>`;
  }

  // ---------- render ----------
  function render() {
    let html;
    if (!state || !state.room) html = homeView();
    else if (!state.game) html = lobbyView();
    else if (state.game.phase === 'night') html = nightView(state.game);
    else if (state.game.phase === 'end') html = endView(state.game);
    else html = playView(state.game);
    $app.innerHTML = html;
  }

  // reset per-phase UI bits when the phase moves on
  function onState(next) {
    state = next;
    const g = state.game;
    const key = g ? `${g.phase}:${g.questIndex}:${g.history.length}` : (state.room ? 'lobby' : 'home');
    if (key !== lastPhaseKey) {
      ui.picked = []; ui.target = null;
      if (!g || g.phase !== 'night') ui.revealed = false;
      lastPhaseKey = key;
    }
    keepAwake(!!g && g.phase !== 'end');
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
      else toast(`الفريق ${num(size)} بس`);
      return render();
    }
    if (t.dataset.target) { ui.target = t.dataset.target; return render(); }
    if (t.dataset.vote) return send('vote', { approve: t.dataset.vote === '1' });
    if (t.dataset.quest) return send('quest', { sabotage: t.dataset.quest === '1' });

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
      case 'reveal': ui.revealed = true; render(); break;
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
        ui.peek = !ui.peek; render(); break;
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

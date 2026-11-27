'use strict';
// Qafila game rules — the official Avalon rules with an Arabic theme.
// Pure logic: no sockets, no timers. Every function takes a game state and returns/mutates it.

const ROLES = {
  AHNAF:    { id: 'AHNAF',    name: 'الأحنف',   team: 'caravan', blurb: 'تعرف الغزاة إلا العلقمي. ساعد القافلة بدون ما تكشف نفسك، لأن وحشي بيدوّر عليك في النهاية.' },
  FARIS:    { id: 'FARIS',    name: 'فارس',     team: 'caravan', blurb: 'تشوف الأحنف ولؤلؤة بدون ما تعرف مين فيهم الأحنف. احمِ الأحنف.' },
  RAHHALA:  { id: 'RAHHALA',  name: 'رحّالة',   team: 'caravan', blurb: 'ما تعرف شي. راقب التصويت والمحطات واكشف الغزاة.' },
  WAHSHI:   { id: 'WAHSHI',   name: 'وحشي',     team: 'raiders', blurb: 'لو وصلت القافلة، عندك فرصة أخيرة: اختر الأحنف وتفوزون.' },
  LULUA:    { id: 'LULUA',    name: 'لؤلؤة',    team: 'raiders', blurb: 'تبانين لفارس كأنك الأحنف. خليه يصدّقك.' },
  ALQAMI:   { id: 'ALQAMI',   name: 'العلقمي',  team: 'raiders', blurb: 'قائد الغزاة. الأحنف نفسه ما يقدر يشوفك.' },
  SHAMHOROUSH: { id: 'SHAMHOROUSH', name: 'شمهروش', team: 'raiders', blurb: 'غازي ضايع: ما تعرف جماعتك وهم ما يعرفونك.' },
  RAIDER:   { id: 'RAIDER',   name: 'غازي',     team: 'raiders', blurb: 'خرّب الرحلة بدون ما ينكشف أمرك.' },
};

// [caravan, raiders] per player count
const TEAM_SIZES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };

// team size for each of the 5 stations
const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

const STATIONS = ['البير', 'الوادي', 'الجبل', 'الكثيب', 'الواحة'];

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;
const MAX_REJECTS = 5;

// House rule (قافلة): a single sabotage fails any station, at every player count.
function failsNeeded(playerCount, questIndex) { // eslint-disable-line no-unused-vars
  return 1;
}

function defaultOptions(count) {
  return {
    farisLulua: true,
    alqami: count >= 7,
    shamhoroush: count >= 10,
  };
}

// Build the role list for a player count and options. Throws if the options don't fit.
function buildRoles(count, options) {
  const sizes = TEAM_SIZES[count];
  if (!sizes) throw new Error(`عدد اللاعبين لازم يكون من ${MIN_PLAYERS} إلى ${MAX_PLAYERS}`);
  const [good, evil] = sizes;
  const caravan = ['AHNAF'];
  const raiders = ['WAHSHI'];
  if (options.farisLulua) { caravan.push('FARIS'); raiders.push('LULUA'); }
  if (options.alqami) raiders.push('ALQAMI');
  if (options.shamhoroush) raiders.push('SHAMHOROUSH');
  if (raiders.length > evil) throw new Error('الشخصيات المختارة للغزاة أكثر من عددهم لهالعدد من اللاعبين');
  while (caravan.length < good) caravan.push('RAHHALA');
  while (raiders.length < evil) raiders.push('RAIDER');
  return caravan.concat(raiders);
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// players: [{id, name}] in seating order
function newGame(players, options, rng = Math.random) {
  const count = players.length;
  const roles = shuffle(buildRoles(count, options), rng);
  const roleOf = {};
  players.forEach((p, i) => { roleOf[p.id] = roles[i]; });
  return {
    phase: 'night',            // night → team → vote → quest → (assassin) → end
    order: players.map(p => p.id),
    names: Object.fromEntries(players.map(p => [p.id, p.name])),
    roleOf,
    options,
    ready: {},                 // night acknowledgements
    leaderIndex: Math.floor(rng() * count),
    questIndex: 0,
    rejects: 0,
    team: [],
    votes: {},
    questPlays: {},
    results: [],               // [{ success, fails, team }]
    history: [],               // every proposal: { quest, leader, team, votes, approved }
    winner: null,              // 'caravan' | 'raiders'
    reason: null,
    assassinTarget: null,
  };
}

const teamOf = (g, id) => (g.roleOf[id] ? ROLES[g.roleOf[id]].team : null);
const leaderId = g => g.order[g.leaderIndex];
const questSize = g => QUEST_SIZES[g.order.length][g.questIndex];

// What one player is allowed to know during the night.
function nightInfo(g, id) {
  const role = g.roleOf[id];
  const others = g.order.filter(p => p !== id);
  let seen = [];
  let label = '';
  if (role === 'AHNAF') {
    seen = others.filter(p => teamOf(g, p) === 'raiders' && g.roleOf[p] !== 'ALQAMI');
    label = 'الغزاة اللي تعرفهم';
  } else if (role === 'FARIS') {
    seen = others.filter(p => g.roleOf[p] === 'AHNAF' || g.roleOf[p] === 'LULUA');
    label = seen.length > 1 ? 'واحد منهم الأحنف، والثاني لؤلؤة' : 'الأحنف';
  } else if (teamOf(g, id) === 'raiders' && role !== 'SHAMHOROUSH') {
    seen = others.filter(p => teamOf(g, p) === 'raiders' && g.roleOf[p] !== 'SHAMHOROUSH');
    label = 'جماعتك من الغزاة';
  }
  // seating order, not shuffled: a shuffle on every update would make the list jump around
  return { label, seen };
}

function ackNight(g, id) {
  if (g.phase !== 'night') return;
  g.ready[id] = true;
  if (g.order.every(p => g.ready[p])) g.phase = 'team';
}

function proposeTeam(g, id, team) {
  if (g.phase !== 'team') throw new Error('مو وقت اختيار الفريق');
  if (id !== leaderId(g)) throw new Error('القائد بس يختار الفريق');
  const unique = [...new Set(team)];
  if (unique.length !== questSize(g)) throw new Error(`لازم تختار ${questSize(g)} بالضبط`);
  if (!unique.every(p => g.order.includes(p))) throw new Error('لاعب غير موجود');
  g.team = unique;
  g.votes = {};
  g.phase = 'vote';
}

function vote(g, id, approve) {
  if (g.phase !== 'vote') throw new Error('مو وقت التصويت');
  if (!g.order.includes(id)) return;
  g.votes[id] = !!approve;
  if (Object.keys(g.votes).length < g.order.length) return;

  const yes = Object.values(g.votes).filter(Boolean).length;
  const approved = yes > g.order.length / 2;
  g.history.push({ quest: g.questIndex, leader: leaderId(g), team: g.team.slice(), votes: { ...g.votes }, approved });
  if (approved) {
    g.rejects = 0;
    g.questPlays = {};
    g.phase = 'quest';
  } else {
    g.rejects += 1;
    if (g.rejects >= MAX_REJECTS) return finish(g, 'raiders', 'انرفض الفريق خمس مرات ورا بعض');
    nextLeader(g);
    g.team = [];
    g.phase = 'team';
  }
}

// The caravan cannot sabotage: whatever a caravan player taps counts as success.
function playQuest(g, id, sabotage) {
  if (g.phase !== 'quest') throw new Error('مو وقت المحطة');
  if (!g.team.includes(id)) throw new Error('أنت مو في فريق هالمحطة');
  g.questPlays[id] = teamOf(g, id) === 'raiders' ? !!sabotage : false;
  if (Object.keys(g.questPlays).length < g.team.length) return;

  const fails = Object.values(g.questPlays).filter(Boolean).length;
  const success = fails < failsNeeded(g.order.length, g.questIndex);
  g.results.push({ success, fails, team: g.team.slice() });

  const wins = g.results.filter(r => r.success).length;
  const losses = g.results.length - wins;
  if (losses >= 3) return finish(g, 'raiders', 'فشلت ثلاث محطات');
  if (wins >= 3) { g.phase = 'assassin'; return; }

  g.questIndex += 1;
  nextLeader(g);
  g.team = [];
  g.phase = 'team';
}

function assassinate(g, id, targetId) {
  if (g.phase !== 'assassin') throw new Error('مو وقت وحشي');
  if (g.roleOf[id] !== 'WAHSHI') throw new Error('وحشي بس يختار');
  if (!g.order.includes(targetId) || targetId === id) throw new Error('اختيار غير صالح');
  g.assassinTarget = targetId;
  if (g.roleOf[targetId] === 'AHNAF') finish(g, 'raiders', 'وحشي عرف الأحنف');
  else finish(g, 'caravan', 'وصلت القافلة، ووحشي ما عرف الأحنف');
}

function nextLeader(g) { g.leaderIndex = (g.leaderIndex + 1) % g.order.length; }

function finish(g, winner, reason) {
  g.winner = winner;
  g.reason = reason;
  g.phase = 'end';
}

// The state one player is allowed to see. Secret roles never leave the server
// except the viewer's own, until the game ends.
function viewFor(g, id) {
  const ended = g.phase === 'end';
  const me = g.roleOf[id];
  return {
    phase: g.phase,
    players: g.order.map(p => ({ id: p, name: g.names[p], ready: !!g.ready[p] })),
    me: id,
    myRole: me ? { ...ROLES[me] } : null,
    night: me ? nightInfo(g, id) : null,
    leader: leaderId(g),
    questIndex: g.questIndex,
    questSizes: QUEST_SIZES[g.order.length],
    failsNeeded: QUEST_SIZES[g.order.length].map((_, i) => failsNeeded(g.order.length, i)),
    stations: STATIONS,
    rejects: g.rejects,
    maxRejects: MAX_REJECTS,
    team: g.team,
    votedCount: Object.keys(g.votes).length,
    votedIds: Object.keys(g.votes),   // who has voted, never how
    myVote: g.votes[id],
    playedCount: Object.keys(g.questPlays).length,
    iPlayed: id in g.questPlays,
    results: g.results.map(r => ({ success: r.success, fails: r.fails, team: r.team })),
    // House rule (قافلة): votes are secret. Only the totals are ever shown, never who voted what.
    history: g.history.map(h => {
      const yes = Object.values(h.votes).filter(Boolean).length;
      return { quest: h.quest, leader: h.leader, team: h.team.slice(), approved: h.approved, yes, no: Object.keys(h.votes).length - yes };
    }),
    isWahshi: me === 'WAHSHI',
    winner: g.winner,
    reason: g.reason,
    assassinTarget: g.assassinTarget,
    reveal: ended ? g.order.map(p => ({ id: p, role: ROLES[g.roleOf[p]] })) : null,
    raidersReveal: g.phase === 'assassin' && teamOf(g, id) === 'raiders'
      ? g.order.filter(p => teamOf(g, p) === 'raiders').map(p => ({ id: p, role: ROLES[g.roleOf[p]] }))
      : null,
  };
}

module.exports = {
  ROLES, TEAM_SIZES, QUEST_SIZES, STATIONS, MIN_PLAYERS, MAX_PLAYERS,
  defaultOptions, buildRoles, newGame, nightInfo, ackNight, proposeTeam, vote, playQuest, assassinate,
  viewFor, failsNeeded, leaderId, questSize,
};

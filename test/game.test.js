'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../server/game');

const players = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'لاعب ' + i }));
const seeded = seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const byRole = (g, role) => g.order.filter(p => g.roleOf[p] === role);
const byTeam = (g, team) => g.order.filter(p => G.ROLES[g.roleOf[p]].team === team);

function startGame(n, opts, seed = 7) {
  const g = G.newGame(players(n), opts || G.defaultOptions(n), seeded(seed));
  g.order.forEach(p => G.ackNight(g, p));
  return g;
}
function approveTeam(g, team) {
  G.proposeTeam(g, G.leaderId(g), team);
  g.order.forEach(p => G.vote(g, p, true));
}

test('team sizes follow the official table for 5 to 10 players', () => {
  for (let n = 5; n <= 10; n++) {
    const roles = G.buildRoles(n, G.defaultOptions(n));
    const evil = roles.filter(r => G.ROLES[r].team === 'raiders').length;
    assert.equal(roles.length, n);
    assert.equal(evil, G.TEAM_SIZES[n][1]);
    assert.ok(roles.includes('AHNAF') && roles.includes('WAHSHI'));
  }
});

test('rejects role sets that do not fit', () => {
  assert.throws(() => G.buildRoles(5, { farisLulua: true, alqami: true }));
  assert.throws(() => G.buildRoles(4, {}));
});

test('night knowledge: Ahnaf misses Alqami, raiders miss Shamhoroush, Faris sees two', () => {
  const g = startGame(10, { farisLulua: true, alqami: true, shamhoroush: true });
  const [ahnaf] = byRole(g, 'AHNAF');
  const seenByAhnaf = G.nightInfo(g, ahnaf).seen;
  assert.ok(!seenByAhnaf.includes(byRole(g, 'ALQAMI')[0]));
  assert.ok(seenByAhnaf.includes(byRole(g, 'SHAMHOROUSH')[0]));
  assert.equal(seenByAhnaf.length, 3);

  const [wahshi] = byRole(g, 'WAHSHI');
  const seenByWahshi = G.nightInfo(g, wahshi).seen;
  assert.ok(!seenByWahshi.includes(byRole(g, 'SHAMHOROUSH')[0]));
  assert.equal(seenByWahshi.length, 2);

  assert.equal(G.nightInfo(g, byRole(g, 'SHAMHOROUSH')[0]).seen.length, 0);
  assert.equal(G.nightInfo(g, byRole(g, 'RAHHALA')[0]).seen.length, 0);
  const faris = G.nightInfo(g, byRole(g, 'FARIS')[0]).seen.sort();
  assert.deepEqual(faris, [ahnaf, byRole(g, 'LULUA')[0]].sort());
});

test('five rejections in a row hand the win to the raiders', () => {
  const g = startGame(5);
  for (let i = 0; i < 5; i++) {
    G.proposeTeam(g, G.leaderId(g), g.order.slice(0, G.questSize(g)));
    g.order.forEach(p => G.vote(g, p, false));
  }
  assert.equal(g.phase, 'end');
  assert.equal(g.winner, 'raiders');
});

test('a tie vote rejects the team and passes leadership', () => {
  const g = startGame(6);
  const first = G.leaderId(g);
  G.proposeTeam(g, first, g.order.slice(0, 2));
  g.order.forEach((p, i) => G.vote(g, p, i < 3));
  assert.equal(g.phase, 'team');
  assert.equal(g.rejects, 1);
  assert.notEqual(G.leaderId(g), first);
});

test('caravan players cannot sabotage even if they tap it', () => {
  const g = startGame(5);
  const caravan = byTeam(g, 'caravan').slice(0, 2);
  approveTeam(g, caravan);
  caravan.forEach(p => G.playQuest(g, p, true));
  assert.equal(g.results[0].success, true);
  assert.equal(g.results[0].fails, 0);
});

test('the fourth station needs two sabotages with seven or more players', () => {
  const g = startGame(7);
  const caravan = byTeam(g, 'caravan');
  const raiders = byTeam(g, 'raiders');
  // stations 1 and 2 succeed, station 3 fails
  approveTeam(g, caravan.slice(0, 2)); g.team.forEach(p => G.playQuest(g, p, false));
  approveTeam(g, caravan.slice(0, 3)); g.team.forEach(p => G.playQuest(g, p, false));
  approveTeam(g, [raiders[0], ...caravan.slice(0, 2)]); g.team.forEach(p => G.playQuest(g, p, true));
  assert.equal(g.results[2].success, false);
  // station 4: one sabotage is not enough
  approveTeam(g, [raiders[0], ...caravan.slice(0, 3)]); g.team.forEach(p => G.playQuest(g, p, true));
  assert.equal(g.results[3].fails, 1);
  assert.equal(g.results[3].success, true);
  assert.equal(g.phase, 'assassin');
});

test('three successes go to Wahshi; finding Ahnaf wins it for the raiders', () => {
  for (const hit of [true, false]) {
    const g = startGame(5, undefined, hit ? 3 : 11);
    const caravan = byTeam(g, 'caravan');
    for (let q = 0; q < 3; q++) {
      approveTeam(g, caravan.slice(0, G.questSize(g)));
      g.team.forEach(p => G.playQuest(g, p, false));
    }
    assert.equal(g.phase, 'assassin');
    const [wahshi] = byRole(g, 'WAHSHI');
    const target = hit ? byRole(g, 'AHNAF')[0] : byRole(g, 'RAHHALA')[0];
    G.assassinate(g, wahshi, target);
    assert.equal(g.winner, hit ? 'raiders' : 'caravan');
  }
});

test('three failed stations end the game at once', () => {
  const g = startGame(5);
  const [r] = byTeam(g, 'raiders');
  const c = byTeam(g, 'caravan');
  for (let q = 0; q < 3; q++) {
    approveTeam(g, [r, ...c].slice(0, G.questSize(g)));
    g.team.forEach(p => G.playQuest(g, p, true));
  }
  assert.equal(g.winner, 'raiders');
});

test('a player view never contains other players\' roles before the end', () => {
  const g = startGame(8);
  for (const p of g.order) {
    const v = G.viewFor(g, p);
    assert.equal(v.reveal, null);
    const text = JSON.stringify({ ...v, myRole: null, night: null });
    for (const other of g.order) {
      if (other === p) continue;
      assert.ok(!text.includes(G.ROLES[g.roleOf[other]].blurb));
    }
  }
});

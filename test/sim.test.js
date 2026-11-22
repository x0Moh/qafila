'use strict';
// End-to-end: real server, real sockets, seven phones playing a full game.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server } = require('../server/index');

const call = (s, ev, payload) => new Promise(r => s.emit(ev, payload, r));

test('seven players play a whole game over sockets', async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const phones = [];
  const latest = new Map();

  try {
    for (let i = 0; i < 7; i++) {
      const s = connect(url, { transports: ['websocket'], forceNew: true });
      s.on('state', st => latest.set(s, st));
      await new Promise(r => s.on('connect', r));
      phones.push(s);
    }
    const host = phones[0];
    const created = await call(host, 'create', { name: 'مشاري' });
    assert.ok(created.ok);
    for (let i = 1; i < 7; i++) {
      const res = await call(phones[i], 'join', { code: created.code, name: 'لاعب ' + i });
      assert.ok(res.ok, res.error);
    }
    const bad = await call(phones[1], 'start');
    assert.equal(bad.ok, false, 'only the host can start');
    assert.ok((await call(host, 'start')).ok);
    const wait = () => new Promise(r => setTimeout(r, 30));
    await wait();

    // nobody sees anyone else's role
    for (const s of phones) {
      const g = latest.get(s).game;
      assert.equal(g.phase, 'night');
      assert.equal(g.reveal, null);
    }
    for (const s of phones) await call(s, 'ready');
    await wait();

    const view = s => latest.get(s).game;
    const phoneOf = id => phones.find(s => view(s).me === id);
    let guard = 0;
    while (view(host).phase !== 'end' && guard++ < 60) {
      const g = view(host);
      if (g.phase === 'team') {
        const leader = phoneOf(g.leader);
        const size = g.questSizes[g.questIndex];
        const team = g.players.slice(0, size).map(p => p.id);
        assert.ok((await call(leader, 'propose', { team })).ok);
      } else if (g.phase === 'vote') {
        for (const s of phones) await call(s, 'vote', { approve: true });
      } else if (g.phase === 'quest') {
        for (const id of g.team) await call(phoneOf(id), 'quest', { sabotage: true });
      } else if (g.phase === 'assassin') {
        const wahshi = phones.find(s => view(s).isWahshi);
        const raiders = view(wahshi).raidersReveal.map(r => r.id);
        const target = view(wahshi).players.find(p => !raiders.includes(p.id)).id;
        assert.ok((await call(wahshi, 'assassinate', { target })).ok);
      }
      await wait();
    }
    const end = view(host);
    assert.equal(end.phase, 'end');
    assert.ok(['caravan', 'raiders'].includes(end.winner));
    assert.equal(end.reveal.length, 7);
    assert.ok((await call(host, 'again')).ok);
    await wait();
    assert.equal(latest.get(host).game, null);
  } finally {
    phones.forEach(s => s.close());
    await new Promise(r => server.close(r));
  }
});

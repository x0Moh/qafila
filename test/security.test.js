'use strict';
// A player must not be able to take over someone else's seat (and see their role)
// just by knowing their public id, which every phone receives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server } = require('../server/index');

const call = (s, ev, payload) => new Promise(r => s.emit(ev, payload, r));
const wait = ms => new Promise(r => setTimeout(r, ms));

test('knowing another player\'s public id is not enough to take their seat', async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const phones = [];
  const latest = new Map();
  const open = async () => {
    const s = connect(url, { transports: ['websocket'], forceNew: true });
    s.on('state', st => latest.set(s, st));
    await new Promise(r => s.on('connect', r));
    phones.push(s);
    return s;
  };
  try {
    const host = await open();
    const made = await call(host, 'create', { name: 'مشاري' });
    for (let i = 1; i < 5; i++) await call(await open(), 'join', { code: made.code, name: 'لاعب ' + i });
    await call(host, 'start');
    await wait(50);

    const victim = latest.get(phones[1]).game.me;
    const thief = await open();
    const res = await call(thief, 'join', { code: made.code, playerId: victim });
    assert.equal(res.ok, false, 'joining with only a public id must fail');
    assert.equal(latest.get(thief), undefined, 'the thief must receive no state');
  } finally {
    phones.forEach(s => s.close());
    await new Promise(r => server.close(r));
  }
});

test('a player who reconnects with their key gets their seat back', async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const socks = [];
  try {
    const open = async () => { const s = connect(url, { transports: ['websocket'], forceNew: true }); await new Promise(r => s.on('connect', r)); socks.push(s); return s; };
    const host = await open();
    const made = await call(host, 'create', { name: 'مشاري' });
    const p = await open();
    const joined = await call(p, 'join', { code: made.code, name: 'فهد' });
    assert.ok(joined.ok && joined.key, 'join returns a secret key');
    p.close();
    const again = await open();
    let state;
    again.on('state', s => { state = s; });
    const back = await call(again, 'join', { code: made.code, playerId: joined.playerId, key: joined.key });
    assert.ok(back.ok, back.error);
    await wait(30);
    assert.equal(state.room.me, joined.playerId);
  } finally {
    socks.forEach(s => s.close());
    await new Promise(r => server.close(r));
  }
});

test('the big screen sees the board but no roles and no single vote', async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const socks = [];
  try {
    const open = async () => { const s = connect(url, { transports: ['websocket'], forceNew: true }); await new Promise(r => s.on('connect', r)); socks.push(s); return s; };
    const host = await open();
    const made = await call(host, 'create', { name: 'مشاري' });
    for (let i = 1; i < 5; i++) await call(await open(), 'join', { code: made.code, name: 'لاعب ' + i });
    const tv = await open();
    let last = null;
    tv.on('state', st => { last = st; });
    const res = await call(tv, 'watch', { code: made.code });
    assert.equal(res.ok, true);
    await call(host, 'start');
    await wait(80);
    assert.equal(last.room.screen, true);
    assert.equal(last.game.phase, 'night');
    assert.equal(last.game.myRole, null);
    assert.equal(last.game.night, null);
    assert.equal(last.game.reveal, null);
    assert.equal(last.room.players.length, 5, 'a screen takes no seat');
    assert.ok(!JSON.stringify(last).includes('"key"'));
  } finally {
    socks.forEach(s => s.close());
    await new Promise(r => server.close(r));
  }
});

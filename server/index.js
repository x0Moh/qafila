'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const G = require('./game');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server);

/**
 * room = {
 *   code, hostId, options,
 *   players: [{ id, key, name, connected }],   // seating order; id is public, key is secret
 *   game: null | game state,
 *   touched: timestamp
 * }
 * Every phone sees the other players' ids, so an id alone proves nothing.
 * Each seat also has a secret key that only its own browser keeps (localStorage);
 * a refresh or a locked phone rejoins the same seat with id + key.
 */
const rooms = new Map();
const socketsOf = new Map(); // playerId -> Set(socket)

function newCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('ما قدرنا ننشئ غرفة، جرّب مرة ثانية');
}

const newKey = () => crypto.randomBytes(18).toString('base64url');
const sameKey = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// keep the chosen extra roles valid when the number of players changes
function fitOptions(room) {
  const n = Math.min(Math.max(room.players.length, G.MIN_PLAYERS), G.MAX_PLAYERS);
  if (!room.optionsTouched) { room.options = G.defaultOptions(n); return; }
  const o = { ...room.options };
  for (const key of ['shamhoroush', 'alqami', 'farisLulua']) {
    try { G.buildRoles(n, o); return void (room.options = o); } catch (_) { o[key] = false; }
  }
  room.options = o;
}

const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 18);

function lobbyView(room, id) {
  return {
    code: room.code,
    hostId: room.hostId,
    isHost: room.hostId === id,
    me: id,
    options: room.options,
    players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })),
    min: G.MIN_PLAYERS,
    max: G.MAX_PLAYERS,
  };
}

// the big screen in the middle of the majlis: it sees only what everyone sees
function screenView(room) {
  return {
    room: { ...lobbyView(room, null), screen: true },
    game: room.game ? G.viewFor(room.game, null) : null,
  };
}

function broadcast(room) {
  room.touched = Date.now();
  if (room.screens && room.screens.size) {
    const view = screenView(room);
    for (const s of room.screens) s.emit('state', view);
  }
  for (const p of room.players) {
    const view = {
      room: lobbyView(room, p.id),
      game: room.game ? G.viewFor(room.game, p.id) : null,
    };
    for (const s of socketsOf.get(p.id) || []) s.emit('state', view);
  }
}

function attach(socket, room, playerId) {
  socket.data.roomCode = room.code;
  socket.data.playerId = playerId;
  socket.join(room.code);
  if (!socketsOf.has(playerId)) socketsOf.set(playerId, new Set());
  socketsOf.get(playerId).add(socket);
  const p = room.players.find(x => x.id === playerId);
  if (p) p.connected = true;
}

function ensureHost(room) {
  const host = room.players.find(p => p.id === room.hostId);
  if (host && host.connected) return;
  const next = room.players.find(p => p.connected);
  if (next) room.hostId = next.id;
}

io.on('connection', socket => {
  const reply = (cb, payload) => typeof cb === 'function' && cb(payload);
  const fail = (cb, err) => reply(cb, { ok: false, error: err.message || String(err) });

  const ctx = () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) throw new Error('الغرفة انتهت، ارجع للبداية');
    return { room, id: socket.data.playerId };
  };

  socket.on('create', ({ name } = {}, cb) => {
    try {
      name = cleanName(name);
      if (!name) throw new Error('اكتب اسمك');
      const id = crypto.randomUUID();
      const key = newKey();
      const code = newCode();
      const room = { code, hostId: id, options: G.defaultOptions(5), players: [{ id, key, name, connected: true }], game: null, touched: Date.now() };
      rooms.set(code, room);
      attach(socket, room, id);
      reply(cb, { ok: true, code, playerId: id, key });
      broadcast(room);
    } catch (e) { fail(cb, e); }
  });

  socket.on('join', ({ code, name, playerId, key } = {}, cb) => {
    try {
      const room = rooms.get(String(code || '').trim());
      if (!room) throw new Error('ما لقينا غرفة بهالكود');
      const seat = playerId && room.players.find(p => p.id === playerId);
      const existing = seat && sameKey(seat.key, key) ? seat : null;
      let id = existing ? existing.id : null;
      if (!existing) {
        // a returning phone without its id can't take a seat mid-game
        if (room.game) throw new Error('اللعبة بدأت. انتظر الجولة الجاية');
        name = cleanName(name);
        if (!name) throw new Error('اكتب اسمك');
        if (room.players.length >= G.MAX_PLAYERS) throw new Error('الغرفة مليانة');
        if (room.players.some(p => p.name === name)) throw new Error('فيه أحد بنفس الاسم، غيّره شوي');
        id = crypto.randomUUID();
        key = newKey();
        room.players.push({ id, key, name, connected: true });
        fitOptions(room);
      }
      attach(socket, room, id);
      ensureHost(room);
      reply(cb, { ok: true, code: room.code, playerId: id, key: existing ? existing.key : key });
      broadcast(room);
    } catch (e) { fail(cb, e); }
  });

  // a laptop or TV joins as a screen: no seat, no role, public view only
  socket.on('watch', ({ code } = {}, cb) => {
    try {
      const room = rooms.get(String(code || '').trim());
      if (!room) throw new Error('ما لقينا غرفة بهالكود');
      if (!room.screens) room.screens = new Set();
      if (room.screens.size >= 4) throw new Error('فيه شاشات كثير على هالغرفة');
      room.screens.add(socket);
      socket.data.screenOf = room.code;
      reply(cb, { ok: true, code: room.code });
      socket.emit('state', screenView(room));
    } catch (e) { fail(cb, e); }
  });

  socket.on('leave', (_ = {}, cb) => {
    try {
      const { room, id } = ctx();
      if (room.game) throw new Error('ما تقدر تطلع واللعبة شغالة');
      room.players = room.players.filter(p => p.id !== id);
      socket.leave(room.code);
      socket.data.roomCode = null;
      if (!room.players.length) rooms.delete(room.code);
      else { fitOptions(room); ensureHost(room); broadcast(room); }
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e); }
  });

  socket.on('options', (opts = {}, cb) => {
    try {
      const { room, id } = ctx();
      if (room.hostId !== id) throw new Error('المضيف بس يغيّر الإعدادات');
      if (room.game) throw new Error('اللعبة شغالة');
      room.options = { farisLulua: !!opts.farisLulua, alqami: !!opts.alqami, shamhoroush: !!opts.shamhoroush };
      room.optionsTouched = true;
      broadcast(room);
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e); }
  });

  socket.on('start', (_ = {}, cb) => {
    try {
      const { room, id } = ctx();
      if (room.hostId !== id) throw new Error('المضيف بس يبدأ اللعبة');
      const n = room.players.length;
      if (n < G.MIN_PLAYERS) throw new Error(`تحتاجون ${G.MIN_PLAYERS} لاعبين على الأقل`);
      G.buildRoles(n, room.options); // validates the options before we start
      room.game = G.newGame(room.players, room.options);
      broadcast(room);
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e); }
  });

  const gameAction = (event, fn) => socket.on(event, (payload = {}, cb) => {
    try {
      const { room, id } = ctx();
      if (!room.game) throw new Error('ما فيه لعبة شغالة');
      fn(room.game, id, payload);
      broadcast(room);
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e); }
  });

  gameAction('ready', (g, id) => G.ackNight(g, id));
  gameAction('propose', (g, id, { team }) => G.proposeTeam(g, id, team || []));
  gameAction('vote', (g, id, { approve }) => G.vote(g, id, approve));
  gameAction('quest', (g, id, { sabotage }) => G.playQuest(g, id, sabotage));
  gameAction('assassinate', (g, id, { target }) => G.assassinate(g, id, target));

  // 'again' after the morning reveal; 'abort' lets the host end a game that is stuck
  // (for example, someone left for good and the vote can never finish)
  const backToLobby = (room) => {
    room.game = null;
    room.players = room.players.filter(p => p.connected);
    fitOptions(room);
    ensureHost(room);
  };
  socket.on('abort', (_ = {}, cb) => {
    try {
      const { room, id } = ctx();
      if (room.hostId !== id) throw new Error('المضيف بس ينهي اللعبة');
      if (!room.game) throw new Error('ما فيه لعبة شغالة');
      backToLobby(room);
      broadcast(room);
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e); }
  });

  socket.on('again', (_ = {}, cb) => {
    try {
      const { room, id } = ctx();
      if (room.hostId !== id) throw new Error('المضيف بس يبدأ جولة جديدة');
      if (room.game && room.game.phase !== 'end') throw new Error('اللعبة لسه ما خلصت');
      backToLobby(room);
      broadcast(room);
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e); }
  });

  socket.on('disconnect', () => {
    const { roomCode, playerId, screenOf } = socket.data;
    if (screenOf) { const r = rooms.get(screenOf); if (r && r.screens) r.screens.delete(socket); return; }
    const set = socketsOf.get(playerId);
    if (set) { set.delete(socket); if (!set.size) socketsOf.delete(playerId); }
    const room = rooms.get(roomCode);
    if (!room) return;
    const p = room.players.find(x => x.id === playerId);
    if (p && !socketsOf.has(playerId)) p.connected = false;
    // before the game starts, a player who closed the page simply leaves after a short grace period
    if (!room.game) {
      setTimeout(() => {
        const r = rooms.get(roomCode);
        if (!r || r.game) return;
        const still = r.players.find(x => x.id === playerId);
        if (still && !still.connected) {
          r.players = r.players.filter(x => x.id !== playerId);
          if (!r.players.length) { rooms.delete(roomCode); return; }
          fitOptions(r);
          ensureHost(r);
          broadcast(r);
        }
      }, 60_000);
    }
    ensureHost(room);
    broadcast(room);
  });
});

// forget rooms nobody touched for 6 hours
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (room.touched < cutoff) rooms.delete(code);
}, 10 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`قافلة شغالة على http://localhost:${PORT}`));
}

module.exports = { server, rooms };

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
 *   players: [{ id, name, connected }],   // seating order
 *   game: null | game state,
 *   touched: timestamp
 * }
 * A player is identified by a random id kept in the browser (localStorage),
 * so a refresh or a locked phone rejoins the same seat.
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

function broadcast(room) {
  room.touched = Date.now();
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

  socket.on('create', ({ name, playerId } = {}, cb) => {
    try {
      name = cleanName(name);
      if (!name) throw new Error('اكتب اسمك');
      const id = playerId || crypto.randomUUID();
      const code = newCode();
      const room = { code, hostId: id, options: G.defaultOptions(5), players: [{ id, name, connected: true }], game: null, touched: Date.now() };
      rooms.set(code, room);
      attach(socket, room, id);
      reply(cb, { ok: true, code, playerId: id });
      broadcast(room);
    } catch (e) { fail(cb, e); }
  });

  socket.on('join', ({ code, name, playerId } = {}, cb) => {
    try {
      const room = rooms.get(String(code || '').trim());
      if (!room) throw new Error('ما لقينا غرفة بهالكود');
      let id = playerId;
      const existing = id && room.players.find(p => p.id === id);
      if (!existing) {
        // a returning phone without its id can't take a seat mid-game
        if (room.game) throw new Error('اللعبة بدأت. انتظر الجولة الجاية');
        name = cleanName(name);
        if (!name) throw new Error('اكتب اسمك');
        if (room.players.length >= G.MAX_PLAYERS) throw new Error('الغرفة مليانة');
        if (room.players.some(p => p.name === name)) throw new Error('فيه أحد بنفس الاسم، غيّره شوي');
        id = id || crypto.randomUUID();
        room.players.push({ id, name, connected: true });
        if (room.players.length >= 7 && !room.optionsTouched) room.options = G.defaultOptions(room.players.length);
      }
      attach(socket, room, id);
      ensureHost(room);
      reply(cb, { ok: true, code: room.code, playerId: id });
      broadcast(room);
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
      else { ensureHost(room); broadcast(room); }
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

  socket.on('again', (_ = {}, cb) => {
    try {
      const { room, id } = ctx();
      if (room.hostId !== id) throw new Error('المضيف بس يبدأ جولة جديدة');
      if (room.game && room.game.phase !== 'end') throw new Error('اللعبة لسه ما خلصت');
      room.game = null;
      room.players = room.players.filter(p => p.connected);
      ensureHost(room);
      broadcast(room);
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e); }
  });

  socket.on('disconnect', () => {
    const { roomCode, playerId } = socket.data;
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

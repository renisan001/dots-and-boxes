const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 20000,
  pingInterval: 25000
});
const rooms = new Map();
const pongLoops = new Map();

// ─── Pong Constants ──────────────────────────────────────────────────────────
const PONG_Y1        = 0.93;  // Player 1 bottom paddle center-Y
const PONG_Y2        = 0.07;  // Player 2 top paddle center-Y
const PONG_PAD_HALF  = 0.16;  // Half the paddle width (normalized)
const PONG_BALL_R    = 0.026; // Ball radius
const PONG_SPEED_MIN = 0.010;
const PONG_SPEED_MAX = 0.038;
const PONG_WIN       = 7;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', rooms: rooms.size, ts: Date.now() }));
app.get('/game/:roomId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.get('/api/rooms', (req, res) => {
  const list = [];
  for (const [id, r] of rooms.entries()) {
    if (r.status !== 'finished') list.push({ id, gameType: r.gameType, gridSize: r.gridSize, playerCount: r.players.length, status: r.status });
  }
  res.json(list);
});

// ─── Game State Factories ─────────────────────────────────────────────────────

function createDotsState(n) {
  const hLines = {}, vLines = {}, boxes = {};
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) hLines[`h-${r}-${c}`] = null;
  for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) vLines[`v-${r}-${c}`] = null;
  return { hLines, vLines, boxes, scores: { 1: 0, 2: 0 } };
}

function createGomokuState() {
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  return { board, scores: { 1: 0, 2: 0 } };
}

const EMOJIS = ['🐶','🐱','🦊','🐻','🦁','🐯','🐸','🐧','🦋','🌸','🍕','🎸','🚀','🌈','🎯','🦄','🍦','🎭'];
const PAIR_COUNTS = { 4: 8, 5: 12, 6: 18 };

function _rSign() { return Math.random() < 0.5 ? 1 : -1; }

function createPingPongState() {
  const spd = PONG_SPEED_MIN + 0.002;
  return {
    ball:    { x: 0.5, y: 0.5, vx: _rSign() * spd * 0.7, vy: _rSign() * spd },
    paddles: { 1: 0.5, 2: 0.5 },
    scores:  { 1: 0, 2: 0 },
    paused:  true,
    pauseUntil: 0
  };
}

function _resetPongBall(gs, scoredBy) {
  const spd = PONG_SPEED_MIN + 0.002;
  // After scoring, ball heads toward the player who LOST the point
  const vy = scoredBy === 1 ? -spd : spd;
  gs.ball = { x: 0.5, y: 0.5, vx: _rSign() * spd * 0.6, vy };
  gs.paused     = true;
  gs.pauseUntil = Date.now() + 1400;
}

function _tickPong(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') { _stopPongLoop(roomId); return; }
  const gs = room.gameState;

  if (gs.paused) {
    if (Date.now() >= gs.pauseUntil) gs.paused = false;
    io.to(roomId).emit('pong_tick', { ball: gs.ball, paddles: gs.paddles, scores: gs.scores, paused: true });
    return;
  }

  const b = gs.ball;
  b.x += b.vx;
  b.y += b.vy;

  // Left / right wall bounce
  if (b.x < PONG_BALL_R)        { b.x = PONG_BALL_R;        b.vx =  Math.abs(b.vx); }
  if (b.x > 1 - PONG_BALL_R)   { b.x = 1 - PONG_BALL_R;    b.vx = -Math.abs(b.vx); }

  // ── Player 2 top paddle ──
  if (b.vy < 0 && b.y <= PONG_Y2 + PONG_BALL_R) {
    const px = gs.paddles[2];
    if (Math.abs(b.x - px) <= PONG_PAD_HALF + PONG_BALL_R) {
      b.y  = PONG_Y2 + PONG_BALL_R;
      b.vy = Math.abs(b.vy) * 1.05;
      const off = (b.x - px) / PONG_PAD_HALF;
      b.vx = off * 0.022;
      const spd = Math.hypot(b.vx, b.vy);
      if (spd > PONG_SPEED_MAX) { b.vx *= PONG_SPEED_MAX/spd; b.vy *= PONG_SPEED_MAX/spd; }
    } else if (b.y < PONG_Y2) {
      gs.scores[1]++;
      io.to(roomId).emit('pong_goal', { scorer: 1, scores: gs.scores });
      if (gs.scores[1] >= PONG_WIN) {
        room.status = 'finished';
        io.to(roomId).emit('game_over', { winner: 1, scores: gs.scores });
        _stopPongLoop(roomId); broadcastRoomList(); return;
      }
      _resetPongBall(gs, 1);
    }
  }

  // ── Player 1 bottom paddle ──
  if (b.vy > 0 && b.y >= PONG_Y1 - PONG_BALL_R) {
    const px = gs.paddles[1];
    if (Math.abs(b.x - px) <= PONG_PAD_HALF + PONG_BALL_R) {
      b.y  = PONG_Y1 - PONG_BALL_R;
      b.vy = -Math.abs(b.vy) * 1.05;
      const off = (b.x - px) / PONG_PAD_HALF;
      b.vx = off * 0.022;
      const spd = Math.hypot(b.vx, b.vy);
      if (spd > PONG_SPEED_MAX) { b.vx *= PONG_SPEED_MAX/spd; b.vy *= PONG_SPEED_MAX/spd; }
    } else if (b.y > PONG_Y1) {
      gs.scores[2]++;
      io.to(roomId).emit('pong_goal', { scorer: 2, scores: gs.scores });
      if (gs.scores[2] >= PONG_WIN) {
        room.status = 'finished';
        io.to(roomId).emit('game_over', { winner: 2, scores: gs.scores });
        _stopPongLoop(roomId); broadcastRoomList(); return;
      }
      _resetPongBall(gs, 2);
    }
  }

  io.to(roomId).emit('pong_tick', { ball: b, paddles: gs.paddles, scores: gs.scores, paused: false });
}

function _startPongLoop(roomId) {
  if (pongLoops.has(roomId)) return;
  const id = setInterval(() => _tickPong(roomId), 33); // ~30 fps
  pongLoops.set(roomId, id);
}

function _stopPongLoop(roomId) {
  const id = pongLoops.get(roomId);
  if (id !== undefined) { clearInterval(id); pongLoops.delete(roomId); }
}

function createMemoryState(gridSize) {
  const numPairs = PAIR_COUNTS[gridSize] || 8;
  const pairs = EMOJIS.slice(0, numPairs);
  const cards = [...pairs, ...pairs]
    .map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false, claimedBy: null }))
    .sort(() => Math.random() - 0.5);
  return { cards, scores: { 1: 0, 2: 0 }, flippedIndices: [] };
}

// ─── Dots Helpers ─────────────────────────────────────────────────────────────

function checkDotsBoxes(gs, lineId, player, n) {
  const { hLines, vLines, boxes } = gs;
  const claimed = [];
  const tryBox = (r, c) => {
    if (r < 0 || r >= n || c < 0 || c >= n || boxes[`b-${r}-${c}`] != null) return;
    if (hLines[`h-${r}-${c}`] && hLines[`h-${r+1}-${c}`] && vLines[`v-${r}-${c}`] && vLines[`v-${r}-${c+1}`]) {
      boxes[`b-${r}-${c}`] = player; gs.scores[player]++;
      claimed.push({ r, c, player });
    }
  };
  const p = lineId.split('-'); const r = +p[1], c = +p[2];
  if (lineId[0] === 'h') { tryBox(r - 1, c); tryBox(r, c); }
  else { tryBox(r, c - 1); tryBox(r, c); }
  return claimed;
}

// ─── Gomoku Helpers ───────────────────────────────────────────────────────────

function checkGomokuWin(board, r, c, player) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let d = 1; d < 5; d++) { const nr = r+dr*d, nc = c+dc*d; if (nr<0||nr>=15||nc<0||nc>=15||board[nr][nc]!==player) break; count++; }
    for (let d = 1; d < 5; d++) { const nr = r-dr*d, nc = c-dc*d; if (nr<0||nr>=15||nc<0||nc>=15||board[nr][nc]!==player) break; count++; }
    if (count >= 5) return true;
  }
  return false;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function generateRoomId() { return Math.random().toString(36).substr(2, 6).toUpperCase(); }

function broadcastRoomList() {
  const list = [];
  for (const [id, r] of rooms.entries()) {
    if (r.status !== 'finished') list.push({ id, gameType: r.gameType, gridSize: r.gridSize, playerCount: r.players.length, status: r.status });
  }
  io.emit('room_list_update', list);
}

// ─── Socket ───────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  socket.on('create_room', ({ gameType, gridSize }) => {
    const roomId = generateRoomId();
    let gameState;
    if (gameType === 'gomoku') gameState = createGomokuState();
    else if (gameType === 'memory') gameState = createMemoryState(gridSize);
    else if (gameType === 'pong')   gameState = createPingPongState();
    else gameState = createDotsState(gridSize);

    rooms.set(roomId, { id: roomId, gameType, gridSize, players: [{ id: socket.id, number: 1 }], gameState, currentTurn: 1, status: 'waiting', createdAt: Date.now(), messages: [] });
    socket.join(roomId); socket.data.roomId = roomId; socket.data.playerNumber = 1;
    socket.emit('room_created', { roomId, gameType, gridSize, playerNumber: 1 });
    broadcastRoomList();
  });

  socket.on('join_room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error_msg', { message: 'Room not found.' }); return; }
    if (room.players.length >= 2) { socket.emit('error_msg', { message: 'Room is full.' }); return; }
    room.players.push({ id: socket.id, number: 2 }); room.status = 'playing';
    socket.join(roomId); socket.data.roomId = roomId; socket.data.playerNumber = 2;
    socket.emit('joined_room', { roomId, gameType: room.gameType, gridSize: room.gridSize, playerNumber: 2, gameState: room.gameState, currentTurn: room.currentTurn, messages: room.messages });
    io.to(roomId).emit('game_start', { gameType: room.gameType, gridSize: room.gridSize, currentTurn: room.currentTurn });
    if (room.gameType === 'pong') {
      room.gameState.paused = true;
      room.gameState.pauseUntil = Date.now() + 2200;
      setTimeout(() => _startPongLoop(roomId), 150);
    }
    broadcastRoomList();
  });

  socket.on('rejoin_room', ({ roomId, playerNumber }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error_msg', { message: 'Room no longer exists.' }); return; }
    const p = room.players.find(x => x.number === playerNumber);
    if (p) p.id = socket.id; else room.players.push({ id: socket.id, number: playerNumber });
    socket.join(roomId); socket.data.roomId = roomId; socket.data.playerNumber = playerNumber;
    socket.emit('game_state_sync', { roomId, gameType: room.gameType, gridSize: room.gridSize, playerNumber, gameState: room.gameState, currentTurn: room.currentTurn, status: room.status, messages: room.messages });
    if (room.gameType === 'pong' && room.status === 'playing' && !pongLoops.has(roomId)) {
      room.gameState.paused = true;
      room.gameState.pauseUntil = Date.now() + 1500;
      setTimeout(() => _startPongLoop(roomId), 150);
    }
  });

  // ── Dots & Boxes ──
  socket.on('draw_line', ({ lineId }) => {
    const { roomId, playerNumber } = socket.data;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing' || room.currentTurn !== playerNumber) return;
    const { gameState, gridSize } = room;
    const existing = lineId[0]==='h' ? gameState.hLines[lineId] : gameState.vLines[lineId];
    if (existing != null) return;
    if (lineId[0]==='h') gameState.hLines[lineId] = playerNumber; else gameState.vLines[lineId] = playerNumber;
    const claimed = checkDotsBoxes(gameState, lineId, playerNumber, gridSize);
    const nextTurn = claimed.length > 0 ? playerNumber : (playerNumber === 1 ? 2 : 1);
    room.currentTurn = nextTurn;
    const gameOver = Object.keys(gameState.boxes).length === gridSize * gridSize;
    io.to(roomId).emit('line_drawn', { lineId, player: playerNumber, claimedBoxes: claimed, scores: gameState.scores, currentTurn: nextTurn, gameOver });
    if (gameOver) { const s1=gameState.scores[1],s2=gameState.scores[2]; io.to(roomId).emit('game_over',{winner:s1>s2?1:s2>s1?2:0,scores:gameState.scores}); room.status='finished'; broadcastRoomList(); }
  });

  // ── Gomoku ──
  socket.on('place_stone', ({ row, col }) => {
    const { roomId, playerNumber } = socket.data;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing' || room.currentTurn !== playerNumber) return;
    const { board } = room.gameState;
    if (board[row][col] != null) return;
    board[row][col] = playerNumber;
    const won = checkGomokuWin(board, row, col, playerNumber);
    const nextTurn = playerNumber === 1 ? 2 : 1;
    room.currentTurn = nextTurn;
    const totalCells = 15 * 15;
    const filled = board.flat().filter(v => v != null).length;
    const draw = !won && filled === totalCells;
    io.to(roomId).emit('stone_placed', { row, col, player: playerNumber, currentTurn: nextTurn, won, draw });
    if (won || draw) { room.gameState.scores[playerNumber]++; io.to(roomId).emit('game_over', { winner: won ? playerNumber : 0, scores: room.gameState.scores }); room.status = 'finished'; broadcastRoomList(); }
  });

  // ── Memory ──
  socket.on('flip_card', ({ cardIndex }) => {
    const { roomId, playerNumber } = socket.data;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing' || room.currentTurn !== playerNumber) return;
    const { gameState } = room;
    const card = gameState.cards[cardIndex];
    if (!card || card.matched || card.flipped || gameState.flippedIndices.length >= 2) return;
    card.flipped = true;
    gameState.flippedIndices.push(cardIndex);
    io.to(roomId).emit('card_flipped', { cardIndex, emoji: card.emoji, player: playerNumber });

    if (gameState.flippedIndices.length === 2) {
      const [i1, i2] = gameState.flippedIndices;
      const c1 = gameState.cards[i1], c2 = gameState.cards[i2];
      if (c1.emoji === c2.emoji) {
        c1.matched = c2.matched = true; c1.claimedBy = c2.claimedBy = playerNumber;
        gameState.scores[playerNumber]++; gameState.flippedIndices = [];
        const totalPairs = gameState.cards.length / 2;
        const matchedPairs = gameState.cards.filter(c => c.matched).length / 2;
        const gameOver = matchedPairs === totalPairs;
        io.to(roomId).emit('cards_matched', { indices: [i1, i2], player: playerNumber, scores: gameState.scores, currentTurn: playerNumber, gameOver });
        if (gameOver) { const s1=gameState.scores[1],s2=gameState.scores[2]; io.to(roomId).emit('game_over',{winner:s1>s2?1:s2>s1?2:0,scores:gameState.scores}); room.status='finished'; broadcastRoomList(); }
      } else {
        const nextTurn = playerNumber === 1 ? 2 : 1;
        room.currentTurn = nextTurn;
        io.to(roomId).emit('cards_no_match', { indices: [i1, i2], currentTurn: nextTurn });
        setTimeout(() => {
          if (!rooms.has(roomId)) return;
          c1.flipped = false; c2.flipped = false; gameState.flippedIndices = [];
          io.to(roomId).emit('cards_reset', { indices: [i1, i2] });
        }, 1200);
      }
    }
  });

  // ── Chat & Reactions ──
  // ── Pong ──
  socket.on('paddle_move', ({ x }) => {
    const { roomId, playerNumber } = socket.data;
    const room = rooms.get(roomId);
    if (!room || room.gameType !== 'pong' || room.status !== 'playing') return;
    const clamped = Math.max(0.12, Math.min(0.88, x));
    room.gameState.paddles[playerNumber] = clamped;
  });

  socket.on('send_reaction', ({ emoji }) => {
    const { roomId, playerNumber } = socket.data;
    if (!rooms.has(roomId)) return;
    socket.to(roomId).emit('reaction_received', { emoji, player: playerNumber });
  });

  socket.on('send_message', ({ text, name }) => {
    const { roomId, playerNumber } = socket.data;
    const room = rooms.get(roomId);
    if (!room) return;
    const msg = { text: String(text).slice(0, 200), player: playerNumber, name: String(name).slice(0, 30), ts: Date.now() };
    room.messages = [...room.messages, msg].slice(-50);
    io.to(roomId).emit('message_received', msg);
  });

  socket.on('typing', ({ isTyping }) => {
    const { roomId, playerNumber } = socket.data;
    if (!rooms.has(roomId)) return;
    socket.to(roomId).emit('opponent_typing', { isTyping, player: playerNumber });
  });

  socket.on('disconnect', () => {
    const { roomId } = socket.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      if (room.gameType === 'pong') _stopPongLoop(roomId);
      // Clean up empty room after 5 minutes (was 30)
      setTimeout(() => { if (rooms.get(roomId)?.players.length === 0) { rooms.delete(roomId); broadcastRoomList(); } }, 5 * 60 * 1000);
    } else {
      io.to(roomId).emit('opponent_disconnected');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Game Lobby → http://localhost:${PORT}`));

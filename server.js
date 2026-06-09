const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
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
    else gameState = createDotsState(gridSize);

    rooms.set(roomId, { id: roomId, gameType, gridSize, players: [{ id: socket.id, number: 1 }], gameState, currentTurn: 1, status: 'waiting', createdAt: Date.now() });
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
    socket.emit('joined_room', { roomId, gameType: room.gameType, gridSize: room.gridSize, playerNumber: 2, gameState: room.gameState, currentTurn: room.currentTurn });
    io.to(roomId).emit('game_start', { gameType: room.gameType, gridSize: room.gridSize, currentTurn: room.currentTurn });
    broadcastRoomList();
  });

  socket.on('rejoin_room', ({ roomId, playerNumber }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error_msg', { message: 'Room no longer exists.' }); return; }
    const p = room.players.find(x => x.number === playerNumber);
    if (p) p.id = socket.id; else room.players.push({ id: socket.id, number: playerNumber });
    socket.join(roomId); socket.data.roomId = roomId; socket.data.playerNumber = playerNumber;
    socket.emit('game_state_sync', { roomId, gameType: room.gameType, gridSize: room.gridSize, playerNumber, gameState: room.gameState, currentTurn: room.currentTurn, status: room.status });
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

  socket.on('disconnect', () => {
    const { roomId } = socket.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) setTimeout(() => { if (rooms.get(roomId)?.players.length === 0) { rooms.delete(roomId); broadcastRoomList(); } }, 30*60*1000);
    else io.to(roomId).emit('opponent_disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Game Lobby → http://localhost:${PORT}`));

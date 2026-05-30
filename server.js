const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// In-memory room storage
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/game/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/api/rooms', (req, res) => {
  const list = [];
  for (const [id, room] of rooms.entries()) {
    if (room.status !== 'finished') {
      list.push({ id, gridSize: room.gridSize, playerCount: room.players.length, status: room.status });
    }
  }
  res.json(list);
});

// ─── Game State Helpers ───────────────────────────────────────────────────────

function createGameState(gridSize) {
  const n = gridSize;
  const hLines = {}, vLines = {}, boxes = {};
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) hLines[`h-${r}-${c}`] = null;
  for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) vLines[`v-${r}-${c}`] = null;
  return { hLines, vLines, boxes, scores: { 1: 0, 2: 0 } };
}

function checkBoxes(gameState, lineId, player, gridSize) {
  const n = gridSize;
  const { hLines, vLines, boxes } = gameState;
  const claimed = [];

  const tryBox = (r, c) => {
    if (r < 0 || r >= n || c < 0 || c >= n) return;
    if (boxes[`b-${r}-${c}`] != null) return;
    if (hLines[`h-${r}-${c}`] && hLines[`h-${r+1}-${c}`] && vLines[`v-${r}-${c}`] && vLines[`v-${r}-${c+1}`]) {
      boxes[`b-${r}-${c}`] = player;
      gameState.scores[player]++;
      claimed.push({ r, c, player });
    }
  };

  const parts = lineId.split('-');
  const r = +parts[1], c = +parts[2];
  if (lineId.startsWith('h')) { tryBox(r - 1, c); tryBox(r, c); }
  else { tryBox(r, c - 1); tryBox(r, c); }
  return claimed;
}

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function broadcastRoomList() {
  const list = [];
  for (const [id, room] of rooms.entries()) {
    if (room.status !== 'finished') {
      list.push({ id, gridSize: room.gridSize, playerCount: room.players.length, status: room.status });
    }
  }
  io.emit('room_list_update', list);
}

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  socket.on('create_room', ({ gridSize }) => {
    const roomId = generateRoomId();
    rooms.set(roomId, {
      id: roomId, gridSize,
      players: [{ id: socket.id, number: 1 }],
      gameState: createGameState(gridSize),
      currentTurn: 1,
      status: 'waiting',
      createdAt: Date.now()
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerNumber = 1;
    socket.emit('room_created', { roomId, gridSize, playerNumber: 1 });
    broadcastRoomList();
  });

  socket.on('join_room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error_msg', { message: 'Room not found.' }); return; }
    if (room.players.length >= 2) { socket.emit('error_msg', { message: 'Room is full.' }); return; }

    room.players.push({ id: socket.id, number: 2 });
    room.status = 'playing';
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerNumber = 2;

    socket.emit('joined_room', {
      roomId, gridSize: room.gridSize, playerNumber: 2,
      gameState: room.gameState, currentTurn: room.currentTurn
    });
    io.to(roomId).emit('game_start', { gridSize: room.gridSize, currentTurn: room.currentTurn });
    broadcastRoomList();
  });

  socket.on('rejoin_room', ({ roomId, playerNumber }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error_msg', { message: 'Room no longer exists.' }); return; }
    const player = room.players.find(p => p.number === playerNumber);
    if (player) player.id = socket.id;
    else room.players.push({ id: socket.id, number: playerNumber });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerNumber = playerNumber;
    socket.emit('game_state_sync', {
      roomId, gridSize: room.gridSize, playerNumber,
      gameState: room.gameState, currentTurn: room.currentTurn, status: room.status
    });
  });

  socket.on('draw_line', ({ lineId }) => {
    const { roomId, playerNumber } = socket.data;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.currentTurn !== playerNumber) { socket.emit('error_msg', { message: "Not your turn!" }); return; }

    const { gameState } = room;
    const existing = lineId.startsWith('h') ? gameState.hLines[lineId] : gameState.vLines[lineId];
    if (existing != null) { socket.emit('error_msg', { message: 'Line already drawn.' }); return; }

    if (lineId.startsWith('h')) gameState.hLines[lineId] = playerNumber;
    else gameState.vLines[lineId] = playerNumber;

    const claimedBoxes = checkBoxes(gameState, lineId, playerNumber, room.gridSize);
    const nextTurn = claimedBoxes.length > 0 ? playerNumber : (playerNumber === 1 ? 2 : 1);
    room.currentTurn = nextTurn;

    const totalBoxes = room.gridSize * room.gridSize;
    const gameOver = Object.keys(gameState.boxes).length === totalBoxes;

    io.to(roomId).emit('line_drawn', {
      lineId, player: playerNumber, claimedBoxes,
      scores: gameState.scores, currentTurn: nextTurn, gameOver
    });

    if (gameOver) {
      const s1 = gameState.scores[1], s2 = gameState.scores[2];
      io.to(roomId).emit('game_over', { winner: s1 > s2 ? 1 : s2 > s1 ? 2 : 0, scores: gameState.scores });
      room.status = 'finished';
      broadcastRoomList();
    }
  });

  socket.on('disconnect', () => {
    const { roomId } = socket.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      setTimeout(() => { if (rooms.get(roomId)?.players.length === 0) { rooms.delete(roomId); broadcastRoomList(); } }, 30 * 60 * 1000);
    } else {
      io.to(roomId).emit('opponent_disconnected');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Dots & Boxes → http://localhost:${PORT}`));

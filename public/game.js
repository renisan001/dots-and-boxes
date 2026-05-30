/* game.js — Full game logic with SVG board */

// ─── Constants ────────────────────────────────────────────────────────────────
const SPACING = 80;
const PAD     = 48;
const DOT_R   = 5;
const HIT_W   = 20; // hit area half-width

const P_COLOR = { 1: '#f97316', 2: '#a855f7' };
const P_FILL  = { 1: 'rgba(249,115,22,0.22)', 2: 'rgba(168,85,247,0.22)' };

// ─── State ────────────────────────────────────────────────────────────────────
let socket, roomId, playerNumber, gridSize;
let gameState = { hLines: {}, vLines: {}, boxes: {}, scores: { 1: 0, 2: 0 } };
let currentTurn = 1;
let gameStarted = false;

const NS = 'http://www.w3.org/2000/svg';

// ─── DOM ──────────────────────────────────────────────────────────────────────
const svg          = document.getElementById('board-svg');
const panelP1      = document.getElementById('panel-p1');
const panelP2      = document.getElementById('panel-p2');
const scoreP1      = document.getElementById('score-p1');
const scoreP2      = document.getElementById('score-p2');
const nameP1       = document.getElementById('name-p1');
const nameP2       = document.getElementById('name-p2');
const shareBanner  = document.getElementById('share-banner');
const shareUrl     = document.getElementById('share-url');
const copyBtn      = document.getElementById('copy-btn');
const waitOverlay  = document.getElementById('waiting-overlay');
const turnBar      = document.getElementById('turn-bar');
const gameOverMod  = document.getElementById('game-over-modal');
const disconnBar   = document.getElementById('disconnect-bar');
const errorState   = document.getElementById('error-state');
const gameArea     = document.getElementById('game-area');
const roomLabel    = document.getElementById('room-label');
const toast        = document.getElementById('toast');
const playAgainBtn = document.getElementById('play-again-btn');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function dotX(c) { return PAD + c * SPACING; }
function dotY(r) { return PAD + r * SPACING; }

function showToast(msg, dur = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), dur);
}

function animateScore(el, newVal) {
  el.style.transform = 'scale(1.35)';
  el.textContent = newVal;
  setTimeout(() => { el.style.transform = 'scale(1)'; }, 300);
}

// ─── Board Rendering ──────────────────────────────────────────────────────────
function buildBoard(n) {
  const size = PAD * 2 + n * SPACING;
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = '';

  // ── Box fill layer (behind everything)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      el('rect', {
        id: `box-${r}-${c}`,
        x: dotX(c) + DOT_R + 1,
        y: dotY(r) + DOT_R + 1,
        width: SPACING - (DOT_R + 1) * 2,
        height: SPACING - (DOT_R + 1) * 2,
        fill: 'transparent',
        rx: 4,
        style: 'transition: fill 0.3s ease;'
      }, svg);
    }
  }

  // ── Box labels (initials)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const txt = el('text', {
        id: `box-lbl-${r}-${c}`,
        x: dotX(c) + SPACING / 2,
        y: dotY(r) + SPACING / 2 + 5,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: 'transparent',
        'font-family': "'Space Grotesk',sans-serif",
        'font-size': '13',
        'font-weight': '700',
        style: 'transition: fill 0.3s ease; pointer-events:none;'
      }, svg);
      txt.textContent = '';
    }
  }

  // ── Horizontal lines
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c < n; c++) {
      const id = `h-${r}-${c}`;
      const x1 = dotX(c) + DOT_R + 2;
      const x2 = dotX(c + 1) - DOT_R - 2;
      const y  = dotY(r);

      // Visual line (drawn state)
      el('line', {
        id: `line-${id}`,
        x1, y1: y, x2, y2: y,
        stroke: 'transparent', 'stroke-width': 4,
        'stroke-linecap': 'round',
        style: 'transition: stroke 0.2s ease, stroke-width 0.2s;'
      }, svg);

      // Hit area
      const hit = el('rect', {
        x: x1, y: y - HIT_W / 2,
        width: x2 - x1, height: HIT_W,
        fill: 'transparent', 'data-line': id,
        class: 'hit-area',
        style: 'cursor:pointer;'
      }, svg);

      // Hover preview line
      el('line', {
        id: `prev-${id}`,
        x1, y1: y, x2, y2: y,
        stroke: 'rgba(255,255,255,0.18)', 'stroke-width': 3,
        'stroke-linecap': 'round', 'stroke-dasharray': '4 4',
        opacity: 0,
        style: 'transition: opacity 0.15s; pointer-events:none;'
      }, svg);

      hit.addEventListener('mouseenter', () => onHoverLine(id));
      hit.addEventListener('mouseleave', () => onLeaveHover(id));
      hit.addEventListener('click', () => onClickLine(id));
    }
  }

  // ── Vertical lines
  for (let r = 0; r < n; r++) {
    for (let c = 0; c <= n; c++) {
      const id = `v-${r}-${c}`;
      const x  = dotX(c);
      const y1 = dotY(r) + DOT_R + 2;
      const y2 = dotY(r + 1) - DOT_R - 2;

      el('line', {
        id: `line-${id}`,
        x1: x, y1, x2: x, y2,
        stroke: 'transparent', 'stroke-width': 4,
        'stroke-linecap': 'round',
        style: 'transition: stroke 0.2s ease;'
      }, svg);

      const hit = el('rect', {
        x: x - HIT_W / 2, y: y1,
        width: HIT_W, height: y2 - y1,
        fill: 'transparent', 'data-line': id,
        class: 'hit-area',
        style: 'cursor:pointer;'
      }, svg);

      el('line', {
        id: `prev-${id}`,
        x1: x, y1, x2: x, y2,
        stroke: 'rgba(255,255,255,0.18)', 'stroke-width': 3,
        'stroke-linecap': 'round', 'stroke-dasharray': '4 4',
        opacity: 0,
        style: 'transition: opacity 0.15s; pointer-events:none;'
      }, svg);

      hit.addEventListener('mouseenter', () => onHoverLine(id));
      hit.addEventListener('mouseleave', () => onLeaveHover(id));
      hit.addEventListener('click', () => onClickLine(id));
    }
  }

  // ── Dots (on top)
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c <= n; c++) {
      el('circle', {
        cx: dotX(c), cy: dotY(r), r: DOT_R,
        fill: '#94a3b8',
        style: 'pointer-events:none;'
      }, svg);
    }
  }
}

function lineIsDrawn(id) {
  return (gameState.hLines[id] != null) || (gameState.vLines[id] != null);
}

function onHoverLine(id) {
  if (!gameStarted || currentTurn !== playerNumber || lineIsDrawn(id)) return;
  const prev = document.getElementById(`prev-${id}`);
  if (prev) {
    prev.setAttribute('stroke', P_COLOR[playerNumber]);
    prev.setAttribute('opacity', '0.7');
  }
}

function onLeaveHover(id) {
  const prev = document.getElementById(`prev-${id}`);
  if (prev) prev.setAttribute('opacity', '0');
}

function onClickLine(id) {
  if (!gameStarted) { showToast('Waiting for opponent to join…'); return; }
  if (currentTurn !== playerNumber) { showToast("It's not your turn!"); return; }
  if (lineIsDrawn(id)) { showToast('Line already drawn.'); return; }
  socket.emit('draw_line', { lineId: id });
}

function drawLine(id, player) {
  const lineEl = document.getElementById(`line-${id}`);
  if (lineEl) {
    lineEl.setAttribute('stroke', P_COLOR[player]);
    lineEl.setAttribute('stroke-width', '4');
  }
  const prev = document.getElementById(`prev-${id}`);
  if (prev) prev.setAttribute('opacity', '0');
}

function fillBox(r, c, player) {
  const boxEl = document.getElementById(`box-${r}-${c}`);
  if (boxEl) boxEl.setAttribute('fill', P_FILL[player]);
  const lbl = document.getElementById(`box-lbl-${r}-${c}`);
  if (lbl) {
    lbl.textContent = player === 1 ? 'P1' : 'P2';
    lbl.setAttribute('fill', P_COLOR[player]);
  }
}

function pulseBox(r, c) {
  const boxEl = document.getElementById(`box-${r}-${c}`);
  if (!boxEl) return;
  boxEl.style.transform = 'scale(1.15)';
  boxEl.style.transformOrigin = 'center';
  setTimeout(() => { boxEl.style.transform = 'scale(1)'; }, 300);
}

function restoreGameState() {
  if (!gridSize) return;
  // Re-draw all lines
  for (const [id, player] of Object.entries(gameState.hLines)) {
    if (player != null) drawLine(id, player);
  }
  for (const [id, player] of Object.entries(gameState.vLines)) {
    if (player != null) drawLine(id, player);
  }
  // Re-fill all boxes
  for (const [key, player] of Object.entries(gameState.boxes)) {
    const [, r, c] = key.split('-');
    fillBox(+r, +c, player);
  }
}

// ─── UI Updates ───────────────────────────────────────────────────────────────
function updateTurnBar() {
  const myTurn = currentTurn === playerNumber;
  turnBar.className = `turn-bar ${currentTurn === 1 ? 'p1-turn' : 'p2-turn'}`;
  if (!gameStarted) {
    turnBar.innerHTML = 'Waiting for opponent…';
  } else if (myTurn) {
    turnBar.innerHTML = '<strong>Your turn</strong> — draw a line!';
  } else {
    const pName = currentTurn === 1 ? 'Player 1' : 'Player 2';
    turnBar.innerHTML = `<strong>${pName}'s turn</strong> — waiting…`;
  }

  panelP1.classList.toggle('active', currentTurn === 1 && gameStarted);
  panelP2.classList.toggle('active', currentTurn === 2 && gameStarted);
}

function updateScores() {
  scoreP1.textContent = gameState.scores[1];
  scoreP2.textContent = gameState.scores[2];
}

function updatePlayerNames() {
  if (playerNumber === 1) {
    nameP1.textContent = 'You';
    nameP2.textContent = gameStarted ? 'Opponent' : 'Waiting…';
  } else {
    nameP1.textContent = 'Opponent';
    nameP2.textContent = 'You';
  }
}

// ─── Socket Events ────────────────────────────────────────────────────────────
function initSocket() {
  socket = io();

  socket.on('joined_room', (data) => {
    roomId = data.roomId;
    gridSize = data.gridSize;
    playerNumber = data.playerNumber;
    currentTurn = data.currentTurn;
    gameState = data.gameState;

    sessionStorage.setItem(`dots-room-${roomId}`, JSON.stringify({ playerNumber, gridSize }));

    shareBanner.classList.add('hidden');
    roomLabel.textContent = `Room ${roomId}`;
    buildBoard(gridSize);
    restoreGameState();
    updatePlayerNames();
    updateScores();
    updateTurnBar();
  });

  socket.on('game_start', (data) => {
    currentTurn = data.currentTurn;
    gameStarted = true;
    waitOverlay.classList.add('hidden');
    shareBanner.classList.add('hidden');
    nameP2.textContent = 'Opponent';
    updateTurnBar();
    showToast('🎮 Game started! Good luck!');
  });

  socket.on('game_state_sync', (data) => {
    roomId = data.roomId;
    gridSize = data.gridSize;
    playerNumber = data.playerNumber;
    currentTurn = data.currentTurn;
    gameState = data.gameState;
    gameStarted = data.status === 'playing';

    sessionStorage.setItem(`dots-room-${roomId}`, JSON.stringify({ playerNumber, gridSize }));
    roomLabel.textContent = `Room ${roomId}`;
    buildBoard(gridSize);
    restoreGameState();
    updatePlayerNames();
    updateScores();

    if (gameStarted) {
      waitOverlay.classList.add('hidden');
      shareBanner.classList.add('hidden');
    } else if (playerNumber === 1) {
      shareBanner.classList.remove('hidden');
      shareUrl.textContent = window.location.href;
    }
    updateTurnBar();
  });

  socket.on('line_drawn', (data) => {
    const { lineId, player, claimedBoxes, scores, currentTurn: nextTurn } = data;

    if (lineId.startsWith('h')) gameState.hLines[lineId] = player;
    else gameState.vLines[lineId] = player;

    drawLine(lineId, player);

    claimedBoxes.forEach(b => {
      gameState.boxes[`b-${b.r}-${b.c}`] = b.player;
      fillBox(b.r, b.c, b.player);
      setTimeout(() => pulseBox(b.r, b.c), 50);
    });

    if (claimedBoxes.length > 0) {
      gameState.scores = scores;
      animateScore(player === 1 ? scoreP1 : scoreP2, scores[player]);
      if (claimedBoxes.length > 0 && player === playerNumber) {
        showToast(`🎯 You claimed ${claimedBoxes.length} box${claimedBoxes.length > 1 ? 'es' : ''}! Go again!`);
      }
    } else {
      gameState.scores = scores;
      updateScores();
    }

    currentTurn = nextTurn;
    updateTurnBar();
  });

  socket.on('game_over', (data) => {
    const { winner, scores } = data;
    document.getElementById('modal-s1').textContent = scores[1];
    document.getElementById('modal-s2').textContent = scores[2];

    if (winner === 0) {
      document.getElementById('modal-emoji').textContent = '🤝';
      document.getElementById('modal-title').textContent = "It's a Tie!";
      document.getElementById('modal-sub').textContent = 'Both players played equally well.';
    } else {
      const isWinner = winner === playerNumber;
      document.getElementById('modal-emoji').textContent = isWinner ? '🏆' : '😔';
      document.getElementById('modal-title').textContent = isWinner ? 'You Win!' : 'You Lose!';
      document.getElementById('modal-title').style.color = P_COLOR[winner];
      document.getElementById('modal-sub').textContent = isWinner
        ? 'Congratulations! Well played!'
        : 'Better luck next time!';
    }
    gameOverMod.classList.remove('hidden');
  });

  socket.on('opponent_disconnected', () => {
    disconnBar.classList.add('show');
    gameStarted = false;
    updateTurnBar();
  });

  socket.on('error_msg', ({ message }) => {
    showToast('⚠️ ' + message);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  const parts = window.location.pathname.split('/');
  roomId = parts[parts.length - 1];

  if (!roomId || roomId === 'game') {
    window.location.href = '/';
    return;
  }

  initSocket();

  const saved = sessionStorage.getItem(`dots-room-${roomId}`);
  if (saved) {
    const { playerNumber: pn, gridSize: gs } = JSON.parse(saved);
    playerNumber = pn; gridSize = gs;

    roomLabel.textContent = `Room ${roomId}`;

    // P1 sees share banner while waiting
    if (playerNumber === 1) {
      shareBanner.classList.remove('hidden');
      shareUrl.textContent = window.location.href;
    }

    socket.emit('rejoin_room', { roomId, playerNumber });
  } else {
    // New visitor → P2
    socket.emit('join_room', { roomId });
  }

  // Copy link
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showToast('✅ Link copied to clipboard!');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
    });
  });

  // Play again
  playAgainBtn.addEventListener('click', () => {
    sessionStorage.removeItem(`dots-room-${roomId}`);
    window.location.href = '/';
  });
}

init();

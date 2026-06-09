/* game.js — Universal dispatcher: connects socket, determines game type, delegates to game module */

let socket, roomId, playerNumber, gameType, gridSize;
let gameStarted = false;
let activeModule = null;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const panelP1     = document.getElementById('panel-p1');
const panelP2     = document.getElementById('panel-p2');
const scoreP1El   = document.getElementById('score-p1');
const scoreP2El   = document.getElementById('score-p2');
const nameP1El    = document.getElementById('name-p1');
const nameP2El    = document.getElementById('name-p2');
const shareBanner = document.getElementById('share-banner');
const shareUrlEl  = document.getElementById('share-url');
const copyBtn     = document.getElementById('copy-btn');
const waitOverlay = document.getElementById('waiting-overlay');
const turnBar     = document.getElementById('turn-bar');
const gameOverMod = document.getElementById('game-over-modal');
const disconnBar  = document.getElementById('disconnect-bar');
const roomLabel   = document.getElementById('room-label');
const toast       = document.getElementById('toast');
const playAgainBtn= document.getElementById('play-again-btn');

// ─── Utils ────────────────────────────────────────────────────────────────────
function showToast(msg, dur = 3000) {
  toast.textContent = msg; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), dur);
}
function animateScore(el, val) {
  el.style.transform = 'scale(1.4)'; el.textContent = val;
  setTimeout(() => el.style.transform = 'scale(1)', 280);
}
function updateTurnBar(currentTurn, pNum, started) {
  if (!started) { turnBar.innerHTML = 'Waiting for opponent…'; turnBar.className = 'turn-bar'; return; }
  const myTurn = currentTurn === pNum;
  turnBar.className = `turn-bar ${currentTurn === 1 ? 'p1-turn' : 'p2-turn'}`;
  turnBar.innerHTML = myTurn ? '<strong>Your turn!</strong>' : `<strong>Opponent's turn</strong> — waiting…`;
  panelP1.classList.toggle('active', currentTurn === 1);
  panelP2.classList.toggle('active', currentTurn === 2);
}
function updateNames(pNum) {
  nameP1El.textContent = pNum === 1 ? getProfile().name.split('#')[0] : 'Opponent';
  nameP2El.textContent = pNum === 2 ? getProfile().name.split('#')[0] : (gameStarted ? 'Opponent' : 'Waiting…');
}
function updateScores(scores) {
  scoreP1El.textContent = scores[1]; scoreP2El.textContent = scores[2];
}

// ─── Game Over ────────────────────────────────────────────────────────────────
function handleGameOver(data) {
  const { winner, scores } = data;
  document.getElementById('modal-s1').textContent = scores[1];
  document.getElementById('modal-s2').textContent = scores[2];
  const isWinner = winner === playerNumber;
  const isDraw = winner === 0;
  document.getElementById('modal-emoji').textContent = isDraw ? '🤝' : isWinner ? '🏆' : '😔';
  document.getElementById('modal-title').textContent = isDraw ? "It's a Tie!" : isWinner ? 'You Win!' : 'You Lose!';
  document.getElementById('modal-title').style.color = isDraw ? '' : ['','var(--p1)','var(--p2)'][winner];
  document.getElementById('modal-sub').textContent = isDraw ? 'Evenly matched!' : isWinner ? 'Excellent play!' : 'Better luck next time!';
  gameOverMod.classList.remove('hidden');
  // Record stats
  recordResult(gameType, isDraw ? 'draw' : isWinner ? 'win' : 'loss');
}

// ─── Socket Setup ─────────────────────────────────────────────────────────────
function setupSocket() {
  socket = io();

  socket.on('joined_room', d => {
    playerNumber = d.playerNumber; gameType = d.gameType; gridSize = d.gridSize;
    sessionStorage.setItem(`gp-room-${roomId}`, JSON.stringify({ playerNumber, gameType, gridSize }));
    roomLabel.textContent = `Room ${roomId}`;
    updateNames(playerNumber);
    updateScores(d.gameState.scores);
    shareBanner.classList.add('hidden');
    waitOverlay.classList.add('hidden');
    loadGameModule(gameType, gridSize, d.gameState, d.currentTurn);
    activeModule?.setStarted?.();
    updateTurnBar(d.currentTurn, playerNumber, true);
  });

  socket.on('game_start', d => {
    gameStarted = true;
    waitOverlay.classList.add('hidden');
    shareBanner.classList.add('hidden');
    nameP2El.textContent = 'Opponent';
    updateTurnBar(d.currentTurn, playerNumber, true);
    showToast('🎮 Game started! Good luck!');
    activeModule?.setStarted?.();
  });

  socket.on('game_state_sync', d => {
    playerNumber = d.playerNumber; gameType = d.gameType; gridSize = d.gridSize;
    sessionStorage.setItem(`gp-room-${roomId}`, JSON.stringify({ playerNumber, gameType, gridSize }));
    gameStarted = d.status === 'playing';
    roomLabel.textContent = `Room ${roomId}`;
    updateNames(playerNumber);
    updateScores(d.gameState.scores);
    if (gameStarted) { waitOverlay.classList.add('hidden'); shareBanner.classList.add('hidden'); }
    else if (playerNumber === 1) { shareBanner.classList.remove('hidden'); shareUrlEl.textContent = window.location.href; }
    loadGameModule(gameType, gridSize, d.gameState, d.currentTurn);
    if (gameStarted) activeModule?.setStarted?.();
    updateTurnBar(d.currentTurn, playerNumber, gameStarted);
  });

  // Delegate game events to active module
  socket.on('line_drawn',       d => { activeModule?.onLineDrawn?.(d);      updateScores(d.scores); updateTurnBar(d.currentTurn, playerNumber, true); if(d.gameOver) return; });
  socket.on('stone_placed',     d => { activeModule?.onStonePlaced?.(d);     updateTurnBar(d.currentTurn, playerNumber, true); });
  socket.on('card_flipped',     d => { activeModule?.onCardFlipped?.(d); });
  socket.on('cards_matched',    d => { activeModule?.onCardsMatched?.(d);    updateScores(d.scores); updateTurnBar(d.currentTurn, playerNumber, true); });
  socket.on('cards_no_match',   d => { activeModule?.onCardsNoMatch?.(d);    updateTurnBar(d.currentTurn, playerNumber, true); });
  socket.on('cards_reset',      d => { activeModule?.onCardsReset?.(d); });
  socket.on('game_over',        d => handleGameOver(d));
  socket.on('opponent_disconnected', () => { disconnBar.classList.add('show'); });
  socket.on('error_msg', ({ message }) => showToast('⚠️ ' + message));
}

function loadGameModule(gt, gs, gameState, currentTurn) {
  const container = document.getElementById('board-container');
  container.innerHTML = '';
  if (gt === 'dots')   { activeModule = DotsGame;   DotsGame.init(container, gs, gameState, currentTurn, playerNumber, socket); }
  if (gt === 'gomoku') { activeModule = GomokuGame; GomokuGame.init(container, gs, gameState, currentTurn, playerNumber, socket); }
  if (gt === 'memory') { activeModule = MemoryGame; MemoryGame.init(container, gs, gameState, currentTurn, playerNumber, socket); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  const parts = window.location.pathname.split('/');
  roomId = parts[parts.length - 1];
  if (!roomId || roomId === 'game') { window.location.href = '/'; return; }

  setupSocket();

  const saved = sessionStorage.getItem(`gp-room-${roomId}`);
  if (saved) {
    const s = JSON.parse(saved);
    playerNumber = s.playerNumber; gameType = s.gameType; gridSize = s.gridSize;
    if (playerNumber === 1) { shareBanner.classList.remove('hidden'); shareUrlEl.textContent = window.location.href; }
    socket.emit('rejoin_room', { roomId, playerNumber });
  } else {
    socket.emit('join_room', { roomId });
  }

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showToast('✅ Link copied!'); copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy Link', 2000);
    });
  });

  playAgainBtn.addEventListener('click', () => {
    sessionStorage.removeItem(`gp-room-${roomId}`);
    window.location.href = '/';
  });
}

init();

/* home.js — Game lobby logic */

const socket = io();
let selectedGame = null;
let selectedGrid = 4;
let creating = false;
let allRooms = [];
let activeFilter = 'all';

const GAME_INFO = {
  dots:   { label: 'Dots & Boxes', icon: '⬛', grids: [3,4,5,6], gridLabel: g => `${g}×${g} grid (${g*g} boxes)` },
  gomoku: { label: 'Gomoku', icon: '🔵', grids: [], gridLabel: () => '15×15 board · first to 5 in a row' },
  memory: { label: 'Memory', icon: '🃏', grids: [4,5,6], gridLabel: g => ({ 4:'4×4 (8 pairs)', 5:'4×6 (12 pairs)', 6:'6×6 (18 pairs)' })[g] }
};

const HOW_TO = {
  dots: `<details class="how-to"><summary>How to Play <span class="chev">▾</span></summary><div class="how-to-body">
    <div class="how-to-step"><div class="step-num">1</div><p class="step-text"><strong>Take turns</strong> drawing a line between adjacent dots.</p></div>
    <div class="how-to-step"><div class="step-num">2</div><p class="step-text"><strong>Close a box</strong> by drawing its 4th side — score a point and go again!</p></div>
    <div class="how-to-step"><div class="step-num">3</div><p class="step-text"><strong>Most boxes</strong> when the board fills up = winner.</p></div>
  </div></details>`,
  gomoku: `<details class="how-to"><summary>How to Play <span class="chev">▾</span></summary><div class="how-to-body">
    <div class="how-to-step"><div class="step-num">1</div><p class="step-text"><strong>Take turns</strong> placing a stone on any empty intersection.</p></div>
    <div class="how-to-step"><div class="step-num">2</div><p class="step-text"><strong>Get 5 in a row</strong> — horizontally, vertically, or diagonally.</p></div>
    <div class="how-to-step"><div class="step-num">3</div><p class="step-text"><strong>Block</strong> your opponent while building your own sequences.</p></div>
  </div></details>`,
  memory: `<details class="how-to"><summary>How to Play <span class="chev">▾</span></summary><div class="how-to-body">
    <div class="how-to-step"><div class="step-num">1</div><p class="step-text"><strong>Take turns</strong> flipping 2 face-down cards.</p></div>
    <div class="how-to-step"><div class="step-num">2</div><p class="step-text"><strong>Match!</strong> If both cards are the same, you claim the pair and go again.</p></div>
    <div class="how-to-step"><div class="step-num">3</div><p class="step-text"><strong>No match?</strong> Cards flip back and your opponent goes.</p></div>
    <div class="how-to-step"><div class="step-num">4</div><p class="step-text"><strong>Most pairs</strong> when all cards are matched = winner.</p></div>
  </div></details>`
};

// ─── Game Card Selection ──────────────────────────────────────────────────────
document.querySelectorAll('.game-card').forEach(card => {
  card.addEventListener('click', () => selectGame(card.dataset.game));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectGame(card.dataset.game); });
});

function selectGame(game) {
  selectedGame = game;
  document.querySelectorAll('.game-card').forEach(c => {
    c.classList.toggle('active', c.dataset.game === game);
    c.setAttribute('aria-pressed', c.dataset.game === game ? 'true' : 'false');
  });
  renderConfigPanel();
  renderRooms(allRooms);
}

function renderConfigPanel() {
  if (!selectedGame) return;
  const info = GAME_INFO[selectedGame];
  const configTitle = document.getElementById('config-title');
  const configBody = document.getElementById('config-body');
  configTitle.textContent = `${info.icon} ${info.label}`;

  let gridHTML = '';
  if (info.grids.length > 0) {
    if (selectedGame === 'memory') selectedGrid = 4;
    else if (selectedGame === 'dots') selectedGrid = 4;
    gridHTML = `
      <label>Grid Size</label>
      <div class="grid-selector" id="grid-selector">
        ${info.grids.map(g => `<button class="grid-btn ${g === selectedGrid ? 'active' : ''}" data-size="${g}">${GAME_INFO[selectedGame].gridLabel(g)}</button>`).join('')}
      </div>
      <div class="mt-2 text-sm text-muted" id="grid-hint"></div>
    `;
  } else {
    gridHTML = `<p class="text-sm text-muted" style="margin-bottom:4px;">15×15 board — standard tournament size</p>`;
  }

  configBody.innerHTML = `
    ${gridHTML}
    <button class="btn btn-primary btn-lg mt-4" id="create-btn" style="width:100%;justify-content:center;">
      <span id="create-icon">✦</span> <span id="create-text">Create Room</span>
    </button>
    ${HOW_TO[selectedGame]}
  `;

  // Grid button listeners
  document.querySelectorAll('.grid-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.grid-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedGrid = parseInt(btn.dataset.size);
    });
  });

  document.getElementById('create-btn').addEventListener('click', createRoom);
}

function createRoom() {
  if (creating || !selectedGame) return;
  creating = true;
  document.getElementById('create-text').textContent = 'Creating…';
  document.getElementById('create-icon').textContent = '⏳';
  document.getElementById('create-btn').disabled = true;
  socket.emit('create_room', { gameType: selectedGame, gridSize: selectedGrid });
}

// ─── Socket ───────────────────────────────────────────────────────────────────
socket.on('room_created', ({ roomId, gameType, gridSize, playerNumber }) => {
  sessionStorage.setItem(`gp-room-${roomId}`, JSON.stringify({ playerNumber, gameType, gridSize }));
  window.location.href = `/game/${roomId}`;
});

socket.on('room_list_update', rooms => { allRooms = rooms; renderRooms(rooms); });
socket.on('error_msg', ({ message }) => {
  showToast('⚠️ ' + message);
  creating = false;
  const btn = document.getElementById('create-btn');
  const txt = document.getElementById('create-text');
  const ico = document.getElementById('create-icon');
  if (btn) { btn.disabled = false; if(txt) txt.textContent = 'Create Room'; if(ico) ico.textContent = '✦'; }
});

// ─── Room List ────────────────────────────────────────────────────────────────
const GAME_ICONS = { dots: '⬛', gomoku: '🔵', memory: '🃏' };
const GAME_NAMES = { dots: 'Dots & Boxes', gomoku: 'Gomoku', memory: 'Memory' };

function renderRooms(rooms) {
  const filtered = activeFilter === 'all' ? rooms : rooms.filter(r => r.gameType === activeFilter);
  const countEl = document.getElementById('room-count');
  if (countEl) countEl.textContent = rooms.length;

  const listEl = document.getElementById('room-list');
  if (!listEl) return;
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🎲</div>No ${activeFilter === 'all' ? 'open' : GAME_NAMES[activeFilter]} rooms yet.</div>`;
    return;
  }
  listEl.innerHTML = filtered.map(r => `
    <div class="room-card">
      <div>
        <div class="room-id">${r.id}</div>
        <div class="room-meta" style="display:flex;gap:6px;align-items:center;margin-top:3px;">
          <span class="game-type-pill">${GAME_ICONS[r.gameType]} ${GAME_NAMES[r.gameType]}</span>
          ${r.gameType !== 'gomoku' ? `<span style="color:var(--text3)">·</span><span style="font-size:0.77rem;color:var(--text3);">${r.gridSize}×${r.gridSize}</span>` : ''}
          <span style="color:var(--text3)">·</span><span style="font-size:0.77rem;color:var(--text3);">${r.playerCount}/2</span>
        </div>
      </div>
      <div class="room-spacer"></div>
      ${r.status === 'waiting'
        ? `<span class="badge badge-waiting">Waiting</span><a href="/game/${r.id}" class="btn btn-primary btn-sm">Join</a>`
        : `<span class="badge badge-playing">In Progress</span>`}
    </div>
  `).join('');
}

// Filter tabs
document.querySelectorAll('#filter-tabs .btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filter-tabs .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderRooms(allRooms);
  });
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  fetch('/api/rooms').then(r => r.json()).then(data => { allRooms = data; renderRooms(data); });
});

// Initial fetch
fetch('/api/rooms').then(r => r.json()).then(data => { allRooms = data; renderRooms(data); });

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

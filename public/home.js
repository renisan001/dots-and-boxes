/* home.js — Dashboard logic */

const socket = io();
let selectedGrid = 4;
let creating = false;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const gridBtns = document.querySelectorAll('.grid-btn');
const createBtn = document.getElementById('create-btn');
const createBtnText = document.getElementById('create-btn-text');
const createBtnIcon = document.getElementById('create-btn-icon');
const gridDesc = document.getElementById('grid-desc');
const roomList = document.getElementById('room-list');
const roomCount = document.getElementById('room-count');
const refreshBtn = document.getElementById('refresh-btn');
const toast = document.getElementById('toast');
const dotGrid = document.getElementById('dot-grid');

// ─── Grid Descriptions ────────────────────────────────────────────────────────
const gridDescs = {
  3: '3 × 3 grid · 9 boxes · Quick 2 min blitz',
  4: '4 × 4 grid · 16 boxes · ~5 min game',
  5: '5 × 5 grid · 25 boxes · ~10 min game',
  6: '6 × 6 grid · 36 boxes · Intense 15 min battle'
};

// ─── Animated Dot Grid (hero decoration) ─────────────────────────────────────
function buildDotGrid() {
  dotGrid.innerHTML = '';
  for (let i = 0; i < 25; i++) {
    const d = document.createElement('div');
    d.className = 'd';
    dotGrid.appendChild(d);
  }
  animateDots();
}

function animateDots() {
  const dots = dotGrid.querySelectorAll('.d');
  setInterval(() => {
    dots.forEach(d => d.classList.remove('lit'));
    const count = Math.floor(Math.random() * 5) + 3;
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * dots.length);
      dots[idx].classList.add('lit');
    }
  }, 700);
}

buildDotGrid();

// ─── Grid Size Selector ───────────────────────────────────────────────────────
gridBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    gridBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    selectedGrid = parseInt(btn.dataset.size);
    gridDesc.textContent = gridDescs[selectedGrid];
  });
});

// ─── Create Room ──────────────────────────────────────────────────────────────
createBtn.addEventListener('click', () => {
  if (creating) return;
  creating = true;
  createBtnText.textContent = 'Creating…';
  createBtnIcon.textContent = '⏳';
  createBtn.disabled = true;
  socket.emit('create_room', { gridSize: selectedGrid });
});

socket.on('room_created', ({ roomId, gridSize, playerNumber }) => {
  sessionStorage.setItem(`dots-room-${roomId}`, JSON.stringify({ playerNumber, gridSize }));
  window.location.href = `/game/${roomId}`;
});

// ─── Room List ────────────────────────────────────────────────────────────────
function renderRooms(rooms) {
  roomCount.textContent = rooms.length;

  if (rooms.length === 0) {
    roomList.innerHTML = `<div class="empty-state"><div class="empty-icon">🎲</div>No open rooms yet. Create one above!</div>`;
    return;
  }

  roomList.innerHTML = rooms.map(r => `
    <div class="room-card" style="margin-bottom:10px;">
      <div>
        <div class="room-id">${r.id}</div>
        <div class="room-meta">${r.gridSize}×${r.gridSize} grid · ${r.playerCount}/2 players</div>
      </div>
      <div class="room-spacer"></div>
      ${r.status === 'waiting'
        ? `<span class="badge badge-waiting">Waiting</span>
           <a href="/game/${r.id}" class="btn btn-primary btn-sm">Join</a>`
        : `<span class="badge badge-playing">In Progress</span>`
      }
    </div>
  `).join('');
}

socket.on('room_list_update', renderRooms);

// Initial fetch
fetch('/api/rooms').then(r => r.json()).then(renderRooms).catch(() => {});

refreshBtn.addEventListener('click', () => {
  fetch('/api/rooms').then(r => r.json()).then(renderRooms).catch(() => {});
});

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

socket.on('error_msg', ({ message }) => {
  showToast('⚠️ ' + message);
  creating = false;
  createBtnText.textContent = 'Create Room';
  createBtnIcon.textContent = '✦';
  createBtn.disabled = false;
});

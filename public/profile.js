/* profile.js — User identity & stats, loaded on every page */

const ADJECTIVES = ['Swift','Cool','Brave','Dark','Neon','Wild','Cosmic','Shadow','Storm','Iron','Golden','Cyber','Blazing','Stealth','Turbo','Arctic','Silent','Hyper','Pixel','Lunar'];
const ANIMALS    = ['Fox','Wolf','Eagle','Tiger','Panda','Dragon','Phoenix','Falcon','Lynx','Viper','Raven','Cobra','Hawk','Orca','Jaguar','Gecko','Mamba','Badger','Ferret','Quasar'];

function generateName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const ani = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = String(Math.floor(Math.random() * 9000) + 1000);
  return `${adj}${ani}#${num}`;
}

function getProfile() {
  let p = JSON.parse(localStorage.getItem('gp_profile') || 'null');
  if (!p) {
    p = {
      name: generateName(),
      createdAt: Date.now(),
      stats: {
        dots:   { wins: 0, losses: 0, draws: 0, played: 0 },
        gomoku: { wins: 0, losses: 0, draws: 0, played: 0 },
        memory: { wins: 0, losses: 0, draws: 0, played: 0 }
      }
    };
    localStorage.setItem('gp_profile', JSON.stringify(p));
  }
  return p;
}

function saveProfile(p) { localStorage.setItem('gp_profile', JSON.stringify(p)); }

function recordResult(gameType, result) { // result: 'win'|'loss'|'draw'
  const p = getProfile();
  const s = p.stats[gameType] || { wins: 0, losses: 0, draws: 0, played: 0 };
  s.played++;
  if (result === 'win') s.wins++;
  else if (result === 'loss') s.losses++;
  else s.draws++;
  p.stats[gameType] = s;
  saveProfile(p);
}

function winRate(s) {
  if (!s.played) return '—';
  return Math.round((s.wins / s.played) * 100) + '%';
}

function getAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 70%, 55%)`;
}

function buildProfileModal() {
  if (document.getElementById('profile-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'profile-modal';
  modal.className = 'modal-backdrop hidden';
  modal.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px;">
        <div id="pm-avatar" style="width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;font-size:1.3rem;font-weight:800;color:#fff;flex-shrink:0;"></div>
        <div style="flex:1;">
          <div id="pm-name" style="font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:700;color:var(--text);"></div>
          <div style="font-size:0.75rem;color:var(--text3);margin-top:2px;">Your gamer tag</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="pm-regen" title="Get new name">🎲 New Name</button>
      </div>

      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
          <thead>
            <tr style="color:var(--text3);text-transform:uppercase;font-size:0.7rem;letter-spacing:0.08em;">
              <th style="text-align:left;padding:6px 8px;">Game</th>
              <th style="text-align:center;padding:6px 8px;">Played</th>
              <th style="text-align:center;padding:6px 8px;color:var(--a2);">Wins</th>
              <th style="text-align:center;padding:6px 8px;color:#f87171;">Losses</th>
              <th style="text-align:center;padding:6px 8px;">Draws</th>
              <th style="text-align:center;padding:6px 8px;">Win %</th>
            </tr>
          </thead>
          <tbody id="pm-stats">
          </tbody>
        </table>
      </div>

      <div style="margin-top:24px;text-align:right;">
        <button class="btn btn-ghost btn-sm" id="pm-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', e => { if (e.target === modal) closeProfile(); });
  document.getElementById('pm-close').addEventListener('click', closeProfile);
  document.getElementById('pm-regen').addEventListener('click', () => {
    const p = getProfile(); p.name = generateName(); saveProfile(p); renderProfile();
  });
}

const GAME_LABELS = { dots: '⬛ Dots & Boxes', gomoku: '🔵 Gomoku', memory: '🃏 Memory' };

function renderProfile() {
  const p = getProfile();
  const av = document.getElementById('pm-avatar');
  const nm = document.getElementById('pm-name');
  const tb = document.getElementById('pm-stats');
  if (!av) return;
  av.textContent = p.name[0];
  av.style.background = getAvatarColor(p.name);
  nm.textContent = p.name;
  tb.innerHTML = ['dots','gomoku','memory'].map(g => {
    const s = p.stats[g] || { wins: 0, losses: 0, draws: 0, played: 0 };
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:10px 8px;color:var(--text);">${GAME_LABELS[g]}</td>
      <td style="text-align:center;padding:10px 8px;color:var(--text2);">${s.played}</td>
      <td style="text-align:center;padding:10px 8px;color:var(--a2);font-weight:600;">${s.wins}</td>
      <td style="text-align:center;padding:10px 8px;color:#f87171;">${s.losses}</td>
      <td style="text-align:center;padding:10px 8px;color:var(--text2);">${s.draws}</td>
      <td style="text-align:center;padding:10px 8px;font-weight:600;">${winRate(s)}</td>
    </tr>`;
  }).join('');

  // Update navbar avatar too
  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) { navAvatar.textContent = p.name[0]; navAvatar.style.background = getAvatarColor(p.name); }
  const navName = document.getElementById('nav-name');
  if (navName) navName.textContent = p.name.split('#')[0];
}

function openProfile() {
  buildProfileModal();
  renderProfile();
  document.getElementById('profile-modal').classList.remove('hidden');
}

function closeProfile() {
  const m = document.getElementById('profile-modal');
  if (m) m.classList.add('hidden');
}

// Auto-init nav avatar click
document.addEventListener('DOMContentLoaded', () => {
  renderProfile();
  const btn = document.getElementById('profile-btn');
  if (btn) btn.addEventListener('click', openProfile);
});

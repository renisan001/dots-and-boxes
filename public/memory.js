/* memory.js — Memory Card Game module */

const MemoryGame = (() => {
  const GRID_COLS = { 4: 4, 5: 6, 6: 6 };
  const GRID_ROWS = { 4: 4, 5: 4, 6: 6 };
  const P_COLOR   = { 1: 'var(--p1)', 2: 'var(--p2)' };

  let _socket, _player, _turn, _started = false, _cards, _gridSize;
  let _locked = false; // lock during no-match reveal

  function buildGrid(container, gridSize, cards) {
    const cols = GRID_COLS[gridSize] || 4;
    const grid = document.createElement('div');
    grid.className = 'memory-grid';
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.setAttribute('id', 'memory-grid');
    container.appendChild(grid);

    cards.forEach((card, i) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'memory-card' + (card.flipped || card.matched ? ' flipped' : '') + (card.matched ? ' matched' : '');
      if (card.matched && card.claimedBy) wrapper.classList.add(`p${card.claimedBy}`);
      wrapper.setAttribute('id', `mc-${i}`);
      wrapper.setAttribute('role', 'button');
      wrapper.setAttribute('aria-label', `Card ${i + 1}`);
      wrapper.setAttribute('tabindex', '0');

      wrapper.innerHTML = `
        <div class="memory-card-inner">
          <div class="memory-card-face card-back">
            <span class="card-back-pattern">✦</span>
          </div>
          <div class="memory-card-face card-front">${card.emoji || ''}</div>
        </div>
      `;

      wrapper.addEventListener('click', () => onCardClick(i));
      wrapper.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') onCardClick(i); });
      grid.appendChild(wrapper);
    });
  }

  function onCardClick(index) {
    if (!_started) { showToast('Waiting for opponent…'); return; }
    if (_turn !== _player) { showToast("Not your turn!"); return; }
    if (_locked) return;
    const card = _cards[index];
    if (!card || card.matched || card.flipped) return;
    _socket.emit('flip_card', { cardIndex: index });
  }

  function flipCardEl(index, emoji, show) {
    const el = document.getElementById(`mc-${index}`);
    if (!el) return;
    if (show) {
      el.querySelector('.card-front').textContent = emoji;
      el.classList.add('flipped');
    } else {
      el.classList.remove('flipped');
    }
  }

  function markMatched(indices, player) {
    indices.forEach(i => {
      const el = document.getElementById(`mc-${i}`);
      if (el) { el.classList.add('matched', `p${player}`); }
    });
  }

  return {
    init(container, gridSize, gameState, currentTurn, player, socket) {
      _gridSize = gridSize; _cards = gameState.cards;
      _turn = currentTurn; _player = player; _socket = socket;
      _started = false; _locked = false;
      buildGrid(container, gridSize, gameState.cards);
    },

    onCardFlipped(d) {
      _started = true;
      _cards[d.cardIndex].flipped = true;
      flipCardEl(d.cardIndex, d.emoji, true);
    },

    onCardsMatched(d) {
      _locked = false;
      d.indices.forEach(i => { _cards[i].matched = true; _cards[i].claimedBy = d.player; });
      markMatched(d.indices, d.player);
      if (d.player === _player) showToast('✨ Match! Go again!');
      _turn = d.currentTurn;
    },

    onCardsNoMatch(d) {
      _locked = true; // lock until reset
      _turn = d.currentTurn;
    },

    onCardsReset(d) {
      d.indices.forEach(i => {
        _cards[i].flipped = false;
        flipCardEl(i, '', false);
      });
      _locked = false;
    }
  };
})();

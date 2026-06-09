/* gomoku.js — Gomoku (5 in a Row) game module */

const GomokuGame = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const SIZE = 15, CELL = 34, PAD = 24;
  const TOTAL = PAD*2 + (SIZE-1)*CELL;
  const P_COLOR = { 1: '#f97316', 2: '#a855f7' };

  let _socket, _player, _turn, _started = false, _board;

  function cx(c) { return PAD + c * CELL; }
  function cy(r) { return PAD + r * CELL; }

  function buildBoard(container) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${TOTAL} ${TOTAL}`);
    svg.setAttribute('width', '100%'); svg.setAttribute('id', 'gomoku-board');
    svg.style.maxWidth = '560px'; svg.style.display = 'block'; svg.style.margin = '0 auto';
    container.appendChild(svg);

    // Board background
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', TOTAL); bg.setAttribute('height', TOTAL);
    bg.setAttribute('fill', '#0f1a0f'); bg.setAttribute('rx', '12'); svg.appendChild(bg);

    // Grid lines
    for (let i = 0; i < SIZE; i++) {
      const hl = document.createElementNS(NS, 'line');
      hl.setAttribute('x1', cx(0)); hl.setAttribute('y1', cy(i));
      hl.setAttribute('x2', cx(SIZE-1)); hl.setAttribute('y2', cy(i));
      hl.setAttribute('stroke', 'rgba(255,255,255,0.12)'); hl.setAttribute('stroke-width', '1');
      svg.appendChild(hl);
      const vl = document.createElementNS(NS, 'line');
      vl.setAttribute('x1', cx(i)); vl.setAttribute('y1', cy(0));
      vl.setAttribute('x2', cx(i)); vl.setAttribute('y2', cy(SIZE-1));
      vl.setAttribute('stroke', 'rgba(255,255,255,0.12)'); vl.setAttribute('stroke-width', '1');
      svg.appendChild(vl);
    }

    // Star points (standard gomoku)
    [[3,3],[3,11],[7,7],[11,3],[11,11]].forEach(([r,c]) => {
      const star = document.createElementNS(NS, 'circle');
      star.setAttribute('cx', cx(c)); star.setAttribute('cy', cy(r));
      star.setAttribute('r', 3); star.setAttribute('fill', 'rgba(255,255,255,0.3)');
      svg.appendChild(star);
    });

    // Stone layer
    const stonesG = document.createElementNS(NS, 'g');
    stonesG.setAttribute('id', 'stones-layer'); svg.appendChild(stonesG);

    // Hit areas
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', cx(c) - CELL/2); hit.setAttribute('y', cy(r) - CELL/2);
      hit.setAttribute('width', CELL); hit.setAttribute('height', CELL);
      hit.setAttribute('fill', 'transparent'); hit.setAttribute('data-r', r); hit.setAttribute('data-c', c);
      hit.style.cursor = 'crosshair';
      hit.addEventListener('mouseenter', () => onHover(r, c));
      hit.addEventListener('mouseleave', () => onLeave(r, c));
      hit.addEventListener('click', () => onClick(r, c));
      svg.appendChild(hit);
    }

    // Preview stone
    const preview = document.createElementNS(NS, 'circle');
    preview.setAttribute('id', 'stone-preview'); preview.setAttribute('r', 13);
    preview.setAttribute('fill', 'transparent'); preview.setAttribute('opacity', '0');
    preview.style.pointerEvents = 'none'; preview.style.transition = 'opacity 0.15s';
    svg.appendChild(preview);
  }

  function placeStone(r, c, player, isLast = false) {
    const g = document.getElementById('stones-layer');
    const x = cx(c), y = cy(r);
    const stone = document.createElementNS(NS, 'circle');
    stone.setAttribute('cx', x); stone.setAttribute('cy', y); stone.setAttribute('r', 14);
    stone.setAttribute('id', `stone-${r}-${c}`);

    // Gradient fill for 3D look
    const gradId = `sg-${r}-${c}`;
    const defs = document.querySelector('#gomoku-board defs') || (() => {
      const d = document.createElementNS(NS, 'defs');
      document.getElementById('gomoku-board').insertBefore(d, document.getElementById('gomoku-board').firstChild);
      return d;
    })();
    const rg = document.createElementNS(NS, 'radialGradient');
    rg.setAttribute('id', gradId); rg.setAttribute('cx', '35%'); rg.setAttribute('cy', '30%');
    const s1 = document.createElementNS(NS, 'stop'); s1.setAttribute('offset','0%');
    const s2 = document.createElementNS(NS, 'stop'); s2.setAttribute('offset','100%');
    const base = player === 1 ? '#f97316' : '#a855f7';
    const light = player === 1 ? '#fcd34d' : '#e0aaff';
    s1.setAttribute('stop-color', light); s2.setAttribute('stop-color', base);
    rg.appendChild(s1); rg.appendChild(s2); defs.appendChild(rg);

    stone.setAttribute('fill', `url(#${gradId})`);
    stone.setAttribute('stroke', player===1?'#ea580c':'#9333ea');
    stone.setAttribute('stroke-width', '1.5');
    stone.style.animation = 'pop-in-stone 0.2s ease';
    g.appendChild(stone);

    // Dot on last placed stone
    document.querySelectorAll('.last-dot').forEach(d => d.remove());
    if (isLast) {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 4);
      dot.setAttribute('fill', player===1?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.6)');
      dot.setAttribute('class', 'last-dot'); dot.style.pointerEvents='none';
      g.appendChild(dot);
    }
  }

  function onHover(r, c) {
    if (!_started || _turn !== _player || _board[r][c] != null) return;
    const p = document.getElementById('stone-preview');
    p.setAttribute('cx', cx(c)); p.setAttribute('cy', cy(r));
    p.setAttribute('fill', P_COLOR[_player]); p.setAttribute('opacity', '0.35');
  }
  function onLeave(r, c) {
    document.getElementById('stone-preview')?.setAttribute('opacity', '0');
  }
  function onClick(r, c) {
    if (!_started) { showToast('Waiting for opponent…'); return; }
    if (_turn !== _player) { showToast("Not your turn!"); return; }
    if (_board[r][c] != null) { showToast('Cell occupied.'); return; }
    _socket.emit('place_stone', { row: r, col: c });
  }

  function restore() {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++)
      if (_board[r][c] != null) placeStone(r, c, _board[r][c]);
  }

  return {
    init(container, _gs, gameState, currentTurn, player, socket) {
      _board = gameState.board; _turn = currentTurn; _player = player; _socket = socket; _started = false;
      buildBoard(container); restore();
    },
    onStonePlaced(d) {
      _started = true; _board[d.row][d.col] = d.player;
      placeStone(d.row, d.col, d.player, true);
      document.getElementById('stone-preview')?.setAttribute('opacity','0');
      _turn = d.currentTurn;
      if (d.won) showToast(d.player === _player ? '🏆 You won!' : '😔 Opponent wins!');
    }
  };
})();

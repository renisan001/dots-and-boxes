/* pong.js — Vertical Ping Pong — Player 1 = BOTTOM, Player 2 = TOP */

const PongGame = (() => {
  let _socket, _playerNumber;
  let _canvas, _ctx;
  let _started = false;
  let _animId  = null;

  // Render state
  let _ball    = { x: 0.5, y: 0.5 };
  let _tBall   = { x: 0.5, y: 0.5 };   // server target (lerp toward)
  let _paddles = { 1: 0.5, 2: 0.5 };
  let _scores  = { 1: 0, 2: 0 };
  let _paused  = false;

  // Ball trail
  const TRAIL_MAX = 10;
  let _trail = [];

  // Goal flash { scorer, frame }
  let _flash = null;
  const FLASH_FRAMES = 90;

  // My paddle – predict locally for responsive feel
  let _myX   = 0.5;
  let _sentX = 0.5;

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init(container, _gs, gameState, _turn, pNum, socket) {
    _socket       = socket;
    _playerNumber = pNum;

    if (gameState && gameState.ball) {
      _tBall   = { x: gameState.ball.x, y: gameState.ball.y };
      _ball    = { x: gameState.ball.x, y: gameState.ball.y };
      _paddles = { 1: gameState.paddles[1], 2: gameState.paddles[2] };
      _scores  = { 1: gameState.scores[1], 2: gameState.scores[2] };
    }

    _myX = _paddles[_playerNumber];

    // Build canvas
    _canvas = document.createElement('canvas');
    _canvas.id = 'pong-canvas';
    _canvas.style.cssText = 'display:block;touch-action:none;border-radius:20px;margin:0 auto;cursor:none;';
    container.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    _doResize();
    window.addEventListener('resize', _doResize);
    _setupInput();

    // Kick off render loop
    if (_animId) cancelAnimationFrame(_animId);
    (function loop() { _animId = requestAnimationFrame(loop); _render(); })();
  }

  // ─── Resize ─────────────────────────────────────────────────────────────────
  function _doResize() {
    if (!_canvas) return;
    const parentW = (_canvas.parentElement ? _canvas.parentElement.offsetWidth : 0) || 340;
    const w = Math.min(parentW, 420);
    const h = Math.round(w * 1.55);
    _canvas.width  = w;
    _canvas.height = h;
    _canvas.style.width  = w + 'px';
    _canvas.style.height = h + 'px';
  }

  // ─── Input ───────────────────────────────────────────────────────────────────
  function _setupInput() {
    function normX(clientX) {
      const r = _canvas.getBoundingClientRect();
      return Math.max(0.16, Math.min(0.84, (clientX - r.left) / r.width));
    }
    function move(x) {
      _myX = x;
      _paddles[_playerNumber] = x;
      if (Math.abs(x - _sentX) > 0.004 && _socket) {
        _socket.emit('paddle_move', { x });
        _sentX = x;
      }
    }
    _canvas.addEventListener('mousemove',  e => move(normX(e.clientX)));
    _canvas.addEventListener('touchstart', e => { e.preventDefault(); move(normX(e.touches[0].clientX)); }, { passive: false });
    _canvas.addEventListener('touchmove',  e => { e.preventDefault(); move(normX(e.touches[0].clientX)); }, { passive: false });
  }

  // ─── Server Events ───────────────────────────────────────────────────────────
  function onPongTick(data) {
    _tBall  = data.ball;
    // Only update the opponent's paddle — keep ours predicted locally
    const opp = _playerNumber === 1 ? 2 : 1;
    if (data.paddles) _paddles[opp] = data.paddles[opp];
    _paused = data.paused;
  }

  function onGoal(data) {
    _scores = data.scores;
    _flash  = { scorer: data.scorer, frame: 0 };
    if (typeof animateScore === 'function') {
      animateScore(document.getElementById('score-p1'), _scores[1]);
      animateScore(document.getElementById('score-p2'), _scores[2]);
    }
  }

  function setStarted() { _started = true; }

  // ─── Render ──────────────────────────────────────────────────────────────────
  function _render() {
    if (!_canvas || !_ctx) return;
    const W = _canvas.width, H = _canvas.height;
    const ctx = _ctx;

    // Lerp ball toward server target
    _ball.x += (_tBall.x - _ball.x) * 0.42;
    _ball.y += (_tBall.y - _ball.y) * 0.42;

    // Push trail
    if (_started && !_paused) {
      _trail.push({ x: _ball.x, y: _ball.y });
      if (_trail.length > TRAIL_MAX) _trail.shift();
    } else {
      _trail = [];
    }

    // ── Background ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(W*i/4, 0); ctx.lineTo(W*i/4, H); ctx.stroke();
    }
    ctx.restore();

    // Center dashed line
    ctx.save();
    ctx.setLineDash([7, 12]);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
    ctx.restore();

    // ── Big score numbers in each half ─────────────────────────────────────
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const scoreFontSize = Math.round(W * 0.24);
    ctx.font = `800 ${scoreFontSize}px 'Space Grotesk', sans-serif`;
    ctx.fillStyle = 'rgba(168,85,247,0.18)';
    ctx.fillText(_scores[2], W / 2, H * 0.32);
    ctx.fillStyle = 'rgba(249,115,22,0.18)';
    ctx.fillText(_scores[1], W / 2, H * 0.72);
    ctx.restore();

    // ── Player labels ──────────────────────────────────────────────────────
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelSize = Math.round(W * 0.04);
    ctx.font = `700 ${labelSize}px Inter, sans-serif`;
    ctx.fillStyle = 'rgba(168,85,247,0.55)';
    ctx.fillText(_playerNumber === 2 ? '— YOU —' : '— OPP —', W/2, H * 0.14);
    ctx.fillStyle = 'rgba(249,115,22,0.55)';
    ctx.fillText(_playerNumber === 1 ? '— YOU —' : '— OPP —', W/2, H * 0.88);
    ctx.restore();

    // ── Paddles ────────────────────────────────────────────────────────────
    const PW = W * 0.30;
    const PH = Math.max(10, H * 0.022);
    const PR = PH / 2;

    _drawPaddle(ctx, _paddles[2] * W, H * 0.07, PW, PH, PR, '#a855f7', _playerNumber === 2);
    _drawPaddle(ctx, _paddles[1] * W, H * 0.93, PW, PH, PR, '#f97316', _playerNumber === 1);

    // ── Ball + Trail ───────────────────────────────────────────────────────
    if (_started && !_paused) {
      const bx = _ball.x * W, by = _ball.y * H;
      const br = W * 0.028;

      // Trail
      for (let i = 0; i < _trail.length; i++) {
        const p  = i / _trail.length;
        const tr = br * p * 0.8;
        const ta = p * 0.35;
        ctx.beginPath();
        ctx.arc(_trail[i].x * W, _trail[i].y * H, tr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(6,182,212,${ta})`;
        ctx.fill();
      }

      // Glow halo
      const grd = ctx.createRadialGradient(bx, by, 0, bx, by, br * 5);
      grd.addColorStop(0, 'rgba(6,182,212,0.65)');
      grd.addColorStop(1, 'rgba(6,182,212,0)');
      ctx.beginPath();
      ctx.arc(bx, by, br * 5, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Ball
      ctx.save();
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur  = 20;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = '#e0f7ff';
      ctx.fill();
      ctx.restore();

    } else if (_started && _paused) {
      // "GET READY" pulsing text
      const pulse = 0.65 + 0.35 * Math.sin(Date.now() / 280);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(W * 0.092)}px 'Space Grotesk', sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#6366f1';
      ctx.shadowBlur  = 24;
      ctx.fillText('GET READY', W / 2, H / 2);
      ctx.restore();
    }

    // ── GOAL Flash ─────────────────────────────────────────────────────────
    if (_flash) {
      _flash.frame++;
      const pct = _flash.frame / FLASH_FRAMES;
      if (pct < 1) {
        const alpha = Math.sin(pct * Math.PI);
        const scale = 1 + 0.15 * (1 - pct);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(W / 2, H / 2);
        ctx.scale(scale, scale);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.round(W * 0.14)}px 'Space Grotesk', sans-serif`;
        const c = _flash.scorer === 1 ? '#f97316' : '#a855f7';
        ctx.fillStyle = c;
        ctx.shadowColor = c;
        ctx.shadowBlur  = 40;
        ctx.fillText('GOAL! 🎉', 0, 0);
        ctx.restore();
      } else {
        _flash = null;
      }
    }

    // ── Waiting Overlay (before opponent joins) ─────────────────────────────
    if (!_started) {
      ctx.save();
      ctx.fillStyle = 'rgba(8,12,20,0.7)';
      ctx.fillRect(0, 0, W, H);
      const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 700);
      ctx.globalAlpha = pulse;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(W * 0.053)}px Inter, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText('Waiting for opponent…', W / 2, H / 2);
      ctx.restore();
    }
  }

  // ─── Draw Paddle (rounded rect) ──────────────────────────────────────────────
  function _drawPaddle(ctx, cx, cy, pw, ph, pr, color, isMe) {
    const x = cx - pw / 2;
    const y = cy - ph / 2;
    ctx.save();
    if (isMe) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = 28;
    }
    ctx.beginPath();
    ctx.moveTo(x + pr, y);
    ctx.lineTo(x + pw - pr, y);
    ctx.quadraticCurveTo(x + pw, y,      x + pw, y + pr);
    ctx.lineTo(x + pw, y + ph - pr);
    ctx.quadraticCurveTo(x + pw, y + ph, x + pw - pr, y + ph);
    ctx.lineTo(x + pr, y + ph);
    ctx.quadraticCurveTo(x,      y + ph, x,           y + ph - pr);
    ctx.lineTo(x, y + pr);
    ctx.quadraticCurveTo(x,      y,      x + pr,      y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  function destroy() {
    if (_animId) cancelAnimationFrame(_animId);
    _animId = null;
    window.removeEventListener('resize', _doResize);
  }

  return { init, setStarted, onPongTick, onGoal, destroy };
})();

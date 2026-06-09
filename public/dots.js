/* dots.js — Dots & Boxes game module */

const DotsGame = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const SPACING = 80, PAD = 48, DOT_R = 5, HIT_W = 20;
  const P_COLOR = { 1: '#f97316', 2: '#a855f7' };
  const P_FILL  = { 1: 'rgba(249,115,22,0.22)', 2: 'rgba(168,85,247,0.22)' };

  let _socket, _player, _turn, _started = false, _gs, _n;

  function e(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }
  function dx(c) { return PAD + c * SPACING; }
  function dy(r) { return PAD + r * SPACING; }

  function lineDrawn(id) { return _gs.hLines[id] != null || _gs.vLines[id] != null; }

  function onHover(id) {
    if (!_started || _turn !== _player || lineDrawn(id)) return;
    const prev = document.getElementById(`prev-${id}`);
    if (prev) { prev.setAttribute('stroke', P_COLOR[_player]); prev.setAttribute('opacity','0.65'); }
  }
  function onLeave(id) {
    const prev = document.getElementById(`prev-${id}`);
    if (prev) prev.setAttribute('opacity','0');
  }
  function onClick(id) {
    if (!_started) { showToast('Waiting for opponent…'); return; }
    if (_turn !== _player) { showToast("Not your turn!"); return; }
    if (lineDrawn(id)) { showToast('Already drawn.'); return; }
    _socket.emit('draw_line', { lineId: id });
  }

  function drawLine(id, player) {
    const el = document.getElementById(`line-${id}`);
    if (el) { el.setAttribute('stroke', P_COLOR[player]); el.setAttribute('stroke-width','4'); }
    const prev = document.getElementById(`prev-${id}`);
    if (prev) prev.setAttribute('opacity','0');
  }

  function fillBox(r, c, player) {
    const box = document.getElementById(`box-${r}-${c}`);
    if (box) box.setAttribute('fill', P_FILL[player]);
    const lbl = document.getElementById(`blbl-${r}-${c}`);
    if (lbl) { lbl.textContent = `P${player}`; lbl.setAttribute('fill', P_COLOR[player]); }
  }

  function buildBoard(container, n) {
    const size = PAD*2 + n*SPACING;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', '100%'); svg.setAttribute('id', 'board-svg');
    svg.style.maxWidth = '560px'; svg.style.display = 'block'; svg.style.margin = '0 auto';
    container.appendChild(svg);

    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      e('rect', { id:`box-${r}-${c}`, x:dx(c)+DOT_R+1, y:dy(r)+DOT_R+1, width:SPACING-(DOT_R+1)*2, height:SPACING-(DOT_R+1)*2, fill:'transparent', rx:4, style:'transition:fill 0.3s;' }, svg);
      const t = e('text', { id:`blbl-${r}-${c}`, x:dx(c)+SPACING/2, y:dy(r)+SPACING/2+5, 'text-anchor':'middle', fill:'transparent', 'font-family':"'Space Grotesk',sans-serif", 'font-size':'12', 'font-weight':'700', style:'pointer-events:none;transition:fill 0.3s;' }, svg);
      t.textContent = '';
    }

    for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) {
      const id = `h-${r}-${c}`, x1=dx(c)+DOT_R+2, x2=dx(c+1)-DOT_R-2, y=dy(r);
      e('line',{id:`line-${id}`,x1,y1:y,x2,y2:y,stroke:'transparent','stroke-width':4,'stroke-linecap':'round',style:'transition:stroke 0.2s;'},svg);
      const hit = e('rect',{x:x1,y:y-HIT_W/2,width:x2-x1,height:HIT_W,fill:'transparent',style:'cursor:pointer;'},svg);
      e('line',{id:`prev-${id}`,x1,y1:y,x2,y2:y,stroke:'rgba(255,255,255,0.2)','stroke-width':3,'stroke-linecap':'round','stroke-dasharray':'4 4',opacity:0,style:'pointer-events:none;transition:opacity 0.15s;'},svg);
      hit.addEventListener('mouseenter',()=>onHover(id));
      hit.addEventListener('mouseleave',()=>onLeave(id));
      hit.addEventListener('click',()=>onClick(id));
    }

    for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) {
      const id = `v-${r}-${c}`, x=dx(c), y1=dy(r)+DOT_R+2, y2=dy(r+1)-DOT_R-2;
      e('line',{id:`line-${id}`,x1:x,y1,x2:x,y2,stroke:'transparent','stroke-width':4,'stroke-linecap':'round',style:'transition:stroke 0.2s;'},svg);
      const hit = e('rect',{x:x-HIT_W/2,y:y1,width:HIT_W,height:y2-y1,fill:'transparent',style:'cursor:pointer;'},svg);
      e('line',{id:`prev-${id}`,x1:x,y1,x2:x,y2,stroke:'rgba(255,255,255,0.2)','stroke-width':3,'stroke-linecap':'round','stroke-dasharray':'4 4',opacity:0,style:'pointer-events:none;transition:opacity 0.15s;'},svg);
      hit.addEventListener('mouseenter',()=>onHover(id));
      hit.addEventListener('mouseleave',()=>onLeave(id));
      hit.addEventListener('click',()=>onClick(id));
    }

    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++)
      e('circle',{cx:dx(c),cy:dy(r),r:DOT_R,fill:'#94a3b8',style:'pointer-events:none;'},svg);
  }

  function restore() {
    for (const [id, p] of Object.entries(_gs.hLines)) if (p != null) drawLine(id, p);
    for (const [id, p] of Object.entries(_gs.vLines)) if (p != null) drawLine(id, p);
    for (const [key, p] of Object.entries(_gs.boxes)) { const [,r,c]=key.split('-'); fillBox(+r,+c,p); }
  }

  return {
    init(container, n, gameState, currentTurn, player, socket) {
      _n=n; _gs=gameState; _turn=currentTurn; _player=player; _socket=socket; _started=false;
      buildBoard(container, n); restore();
    },
    onLineDrawn(d) {
      _started = true;
      if (d.lineId[0]==='h') _gs.hLines[d.lineId]=d.player; else _gs.vLines[d.lineId]=d.player;
      drawLine(d.lineId, d.player);
      d.claimedBoxes.forEach(b => { _gs.boxes[`b-${b.r}-${b.c}`]=b.player; fillBox(b.r,b.c,b.player); });
      if (d.claimedBoxes.length > 0 && d.player === _player) showToast(`🎯 +${d.claimedBoxes.length} box${d.claimedBoxes.length>1?'es':''}! Go again!`);
      _turn = d.currentTurn;
    },
    setStarted() { _started = true; }
  };
})();

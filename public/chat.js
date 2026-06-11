/* chat.js — Clash Royale-style reactions + in-game text chat */

const ChatSystem = (() => {
  const REACTIONS = ['😂','🔥','💀','👑','😤','🙏','👏','😮'];
  const P_COLOR = { 1: '#f97316', 2: '#a855f7' };
  const RADIUS = 64; // px from wheel center

  let _socket, _player, _getName;
  let _wheelOpen = false;
  let _cooldown = false;
  let _chatOpen = false;
  let _unread = 0;
  let _typingTimer = null;
  let _isTyping = false;
  let _built = false; // ← BUG FIX: guard against double-build

  // ─── Build UI ──────────────────────────────────────────────────────────────

  function build() {
    if (_built) return; // ← called twice for P2 (joined_room + game_start) — only build once
    _built = true;

    // ── Reaction + Chat bar ──
    const bar = document.createElement('div');
    bar.id = 'chat-reaction-bar';
    bar.innerHTML = `
      <div class="wheel-anchor" id="wheel-anchor">
        <button class="react-trigger" id="react-btn" title="Reactions">
          <span class="react-trigger-emoji">😊</span>
          <span class="react-cooldown-ring" id="cooldown-ring"></span>
        </button>
        <div class="reaction-wheel hidden" id="reaction-wheel">
          ${REACTIONS.map((e, i) => `<button class="reaction-item" data-emoji="${e}" title="${e}">${e}</button>`).join('')}
        </div>
      </div>
      <button class="chat-toggle-btn" id="chat-toggle-btn" title="Chat">
        💬 Chat
        <span class="chat-unread hidden" id="chat-unread">0</span>
      </button>
    `;

    const turnBar = document.getElementById('turn-bar');
    if (turnBar) turnBar.parentNode.insertBefore(bar, turnBar);

    // ← BUG FIX: position wheel items using left/top (NOT transform) so hover scale doesn't break position
    positionWheelItems();

    // ── Floating stage ──
    if (!document.getElementById('reaction-stage')) {
      const stage = document.createElement('div');
      stage.id = 'reaction-stage';
      document.body.appendChild(stage);
    }

    // ── Chat panel ──
    if (!document.getElementById('chat-panel')) {
      const panel = document.createElement('div');
      panel.className = 'chat-panel'; panel.id = 'chat-panel';
      panel.innerHTML = `
        <div class="chat-header">
          <span>💬 In-Game Chat</span>
          <button class="chat-close-btn" id="chat-close">✕</button>
        </div>
        <div class="chat-messages" id="chat-messages">
          <div class="chat-empty">Say something! 👋</div>
        </div>
        <div class="chat-typing-row hidden" id="typing-row">
          <span class="typing-dots"><span></span><span></span><span></span></span>
          <span class="typing-label">Opponent is typing…</span>
        </div>
        <div class="chat-input-row">
          <input type="text" class="chat-input" id="chat-input" placeholder="Type a message…" maxlength="200" autocomplete="off"/>
          <button class="chat-send-btn" id="chat-send">➤</button>
        </div>
      `;
      document.body.appendChild(panel);
    }

    bindEvents();
  }

  // Position 8 reaction items in a circle using left/top — transform is reserved for hover/animation only
  function positionWheelItems() {
    document.querySelectorAll('.reaction-item').forEach((item, i) => {
      const angleDeg = i * 45 - 90; // start from top, clockwise
      const rad = angleDeg * Math.PI / 180;
      const x = Math.round(Math.cos(rad) * RADIUS);
      const y = Math.round(Math.sin(rad) * RADIUS);
      // Position using left/top so transform: scale() on hover works independently
      item.style.left = `calc(50% + ${x}px - 22px)`;
      item.style.top  = `calc(50% + ${y}px - 22px)`;
    });
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  function bindEvents() {
    document.getElementById('react-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (_cooldown) return;
      toggleWheel();
    });

    document.querySelectorAll('.reaction-item').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        sendReaction(btn.dataset.emoji);
      });
    });

    document.addEventListener('click', closeWheel);

    document.getElementById('chat-toggle-btn').addEventListener('click', toggleChat);
    document.getElementById('chat-close').addEventListener('click', toggleChat);
    document.getElementById('chat-send').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') sendMessage();
      handleTyping();
    });
    document.getElementById('chat-input').addEventListener('input', handleTyping);
  }

  function toggleWheel() {
    _wheelOpen = !_wheelOpen;
    const wheel = document.getElementById('reaction-wheel');
    const btn   = document.getElementById('react-btn');
    wheel.classList.toggle('hidden', !_wheelOpen);
    btn.classList.toggle('active', _wheelOpen);

    if (_wheelOpen) {
      document.querySelectorAll('.reaction-item').forEach((item, i) => {
        item.style.animationDelay = `${i * 28}ms`;
        item.classList.remove('item-in');
        void item.offsetWidth; // force reflow
        item.classList.add('item-in');
      });
    }
  }

  function closeWheel() {
    if (!_wheelOpen) return;
    _wheelOpen = false;
    document.getElementById('reaction-wheel')?.classList.add('hidden');
    document.getElementById('react-btn')?.classList.remove('active');
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  function sendReaction(emoji) {
    if (_cooldown) return;
    closeWheel();
    _socket.emit('send_reaction', { emoji });
    showFloatingReaction(emoji, _player); // show to self immediately
    startCooldown();
  }

  function startCooldown() {
    _cooldown = true;
    const btn  = document.getElementById('react-btn');
    const ring = document.getElementById('cooldown-ring');
    btn.classList.add('cooldown');
    ring.style.animation = 'none';
    void ring.offsetWidth;
    ring.style.animation = 'cooldown-spin 3s linear forwards';
    setTimeout(() => {
      _cooldown = false;
      btn.classList.remove('cooldown');
      ring.style.animation = 'none';
    }, 3000);
  }

  function showFloatingReaction(emoji, player) {
    const panelEl = document.getElementById(`panel-p${player}`);
    if (!panelEl) return;
    const rect = panelEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = (rect.left + rect.width / 2 - 32) + 'px';
    el.style.top  = (rect.top + 8) + 'px';
    document.getElementById('reaction-stage')?.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  function toggleChat() {
    _chatOpen = !_chatOpen;
    document.getElementById('chat-panel')?.classList.toggle('open', _chatOpen);
    if (_chatOpen) {
      _unread = 0;
      updateUnreadBadge();
      setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
      scrollToBottom();
    }
  }

  function sendMessage() {
    const input = document.getElementById('chat-input');
    const text  = (input?.value || '').trim();
    if (!text) return;
    input.value = '';
    _socket.emit('send_message', { text, name: _getName() });
    stopTyping();
  }

  function handleTyping() {
    if (!_isTyping) { _isTyping = true; _socket.emit('typing', { isTyping: true }); }
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(stopTyping, 1500);
  }

  function stopTyping() {
    if (_isTyping) { _isTyping = false; _socket.emit('typing', { isTyping: false }); }
    clearTimeout(_typingTimer);
  }

  function addMessage(msg) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.querySelector('.chat-empty')?.remove();

    const isMe = msg.player === _player;
    const time  = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const el = document.createElement('div');
    el.className = `chat-msg ${isMe ? 'mine' : 'theirs'}`;
    el.innerHTML = `
      <div class="msg-meta">
        <span class="msg-name" style="color:${P_COLOR[msg.player]}">${esc(msg.name)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-bubble">${esc(msg.text)}</div>
    `;
    container.appendChild(el);
    scrollToBottom();

    if (!isMe && !_chatOpen) {
      _unread++;
      updateUnreadBadge();
      const tb = document.getElementById('chat-toggle-btn');
      tb?.classList.add('peek');
      setTimeout(() => tb?.classList.remove('peek'), 600);
    }
  }

  function updateUnreadBadge() {
    const badge = document.getElementById('chat-unread');
    if (!badge) return;
    badge.textContent = _unread;
    badge.classList.toggle('hidden', _unread === 0);
  }

  function scrollToBottom() {
    const c = document.getElementById('chat-messages');
    if (c) c.scrollTop = c.scrollHeight;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    init(socket, player, getNameFn) {
      _socket = socket; _player = player; _getName = getNameFn;
      build(); // safe to call multiple times — guarded by _built flag
    },
    loadHistory(messages) {
      (messages || []).forEach(m => addMessage(m));
    },
    onReactionReceived(d) { showFloatingReaction(d.emoji, d.player); },
    onMessageReceived(d)  { addMessage(d); },
    onOpponentTyping(d)   {
      document.getElementById('typing-row')?.classList.toggle('hidden', !d.isTyping);
    }
  };
})();

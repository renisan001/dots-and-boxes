/* chat.js — Clash Royale-style reactions + in-game text chat */

const ChatSystem = (() => {
  const REACTIONS = ['😂','🔥','💀','👑','😤','🙏','👏','😮'];
  const P_COLOR = { 1: '#f97316', 2: '#a855f7' };

  let _socket, _player, _getName;
  let _wheelOpen = false;
  let _cooldown = false;
  let _chatOpen = false;
  let _unread = 0;
  let _typingTimer = null;
  let _isTyping = false;

  // ─── Build UI ──────────────────────────────────────────────────────────────

  function build() {
    // ── Reaction + Chat toggle bar (injected after players-bar) ──
    const bar = document.createElement('div');
    bar.id = 'chat-reaction-bar';
    bar.innerHTML = `
      <div style="position:relative;display:inline-block;">
        <button class="react-trigger" id="react-btn" title="Reactions">
          <span class="react-trigger-emoji">😊</span>
          <span class="react-cooldown-ring" id="cooldown-ring"></span>
        </button>
        <div class="reaction-wheel hidden" id="reaction-wheel">
          ${REACTIONS.map((e,i) => `
            <button class="reaction-item" data-emoji="${e}" style="--i:${i};" title="${e}">
              ${e}
            </button>`).join('')}
        </div>
      </div>
      <button class="chat-toggle-btn" id="chat-toggle-btn" title="Chat">
        💬 Chat
        <span class="chat-unread hidden" id="chat-unread">0</span>
      </button>
    `;

    const turnBar = document.getElementById('turn-bar');
    if (turnBar) turnBar.parentNode.insertBefore(bar, turnBar);

    // ── Floating reaction stage ──
    const stage = document.createElement('div');
    stage.id = 'reaction-stage'; document.body.appendChild(stage);

    // ── Chat panel ──
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

    bindEvents();
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  function bindEvents() {
    // Reaction wheel toggle
    document.getElementById('react-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (_cooldown) return;
      toggleWheel();
    });

    // Reaction item click
    document.querySelectorAll('.reaction-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const emoji = btn.dataset.emoji;
        sendReaction(emoji);
      });
    });

    // Close wheel on outside click
    document.addEventListener('click', () => closeWheel());

    // Chat toggle
    document.getElementById('chat-toggle-btn').addEventListener('click', toggleChat);
    document.getElementById('chat-close').addEventListener('click', toggleChat);

    // Send message
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
    const btn = document.getElementById('react-btn');
    wheel.classList.toggle('hidden', !_wheelOpen);
    btn.classList.toggle('active', _wheelOpen);
    if (_wheelOpen) {
      // Animate items in
      document.querySelectorAll('.reaction-item').forEach((item, i) => {
        item.style.animationDelay = `${i * 30}ms`;
        item.classList.remove('item-in');
        void item.offsetWidth; // reflow
        item.classList.add('item-in');
      });
    }
  }

  function closeWheel() {
    _wheelOpen = false;
    document.getElementById('reaction-wheel')?.classList.add('hidden');
    document.getElementById('react-btn')?.classList.remove('active');
  }

  function sendReaction(emoji) {
    if (_cooldown) return;
    closeWheel();
    _socket.emit('send_reaction', { emoji });
    showFloatingReaction(emoji, _player); // show locally immediately
    startCooldown();
  }

  function startCooldown() {
    _cooldown = true;
    const btn = document.getElementById('react-btn');
    const ring = document.getElementById('cooldown-ring');
    btn.classList.add('cooldown');
    ring.style.animation = 'none';
    void ring.offsetWidth;
    ring.style.animation = 'cooldown-fill 3s linear forwards';
    setTimeout(() => {
      _cooldown = false;
      btn.classList.remove('cooldown');
      ring.style.animation = 'none';
    }, 3000);
  }

  // ─── Floating Reaction ────────────────────────────────────────────────────

  function showFloatingReaction(emoji, player) {
    // Position over the correct player panel
    const panelEl = document.getElementById(`panel-p${player}`);
    if (!panelEl) return;

    const rect = panelEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = (rect.left + rect.width / 2 - 32) + 'px';
    el.style.top  = (rect.top - 20) + 'px';
    el.style.color = P_COLOR[player];

    document.getElementById('reaction-stage').appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  function toggleChat() {
    _chatOpen = !_chatOpen;
    document.getElementById('chat-panel').classList.toggle('open', _chatOpen);
    if (_chatOpen) {
      _unread = 0;
      updateUnreadBadge();
      setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
      scrollToBottom();
    }
  }

  function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const name = _getName();
    _socket.emit('send_message', { text, name });
    stopTyping();
  }

  function handleTyping() {
    if (!_isTyping) {
      _isTyping = true;
      _socket.emit('typing', { isTyping: true });
    }
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(stopTyping, 1500);
  }

  function stopTyping() {
    if (_isTyping) {
      _isTyping = false;
      _socket.emit('typing', { isTyping: false });
    }
    clearTimeout(_typingTimer);
  }

  function addMessage(msg) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    // Remove empty state
    const empty = container.querySelector('.chat-empty');
    if (empty) empty.remove();

    const isMe = msg.player === _player;
    const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const el = document.createElement('div');
    el.className = `chat-msg ${isMe ? 'mine' : 'theirs'}`;
    el.innerHTML = `
      <div class="msg-meta">
        <span class="msg-name" style="color:${P_COLOR[msg.player]}">${escHtml(msg.name)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-bubble">${escHtml(msg.text)}</div>
    `;
    container.appendChild(el);
    scrollToBottom();

    if (!isMe && !_chatOpen) {
      _unread++;
      updateUnreadBadge();
      // Quick peek animation on chat button
      document.getElementById('chat-toggle-btn')?.classList.add('peek');
      setTimeout(() => document.getElementById('chat-toggle-btn')?.classList.remove('peek'), 600);
    }
  }

  function updateUnreadBadge() {
    const badge = document.getElementById('chat-unread');
    if (!badge) return;
    if (_unread > 0) { badge.textContent = _unread; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }

  function scrollToBottom() {
    const c = document.getElementById('chat-messages');
    if (c) c.scrollTop = c.scrollHeight;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function loadHistory(messages) {
    if (!messages || !messages.length) return;
    messages.forEach(msg => addMessage(msg));
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    init(socket, player, getNameFn) {
      _socket = socket; _player = player; _getName = getNameFn;
      build();
    },

    loadHistory(messages) { loadHistory(messages); },

    // Called by game.js from socket events
    onReactionReceived(d) { showFloatingReaction(d.emoji, d.player); },
    onMessageReceived(d)  { addMessage(d); },
    onOpponentTyping(d)   {
      const row = document.getElementById('typing-row');
      if (row) row.classList.toggle('hidden', !d.isTyping);
    }
  };
})();

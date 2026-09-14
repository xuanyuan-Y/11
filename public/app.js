// 掼蛋在线 - 客户端逻辑
'use strict';

let ws = null;
let mySeat = -1;
let roomId = '';
let gameState = null;
let selectedCards = new Set();
let isReady = false;

const SEAT_NAMES = ['你（南）', '西家', '队友（北）', '东家'];
const PATTERN_NAMES = {
  single: '单张', pair: '对子', triple: '三张', triplePair: '三带二',
  straight: '顺子', straightPair: '连对', airplane: '飞机',
  bomb: '炸弹', straightFlush: '同花顺', kingBomb: '天王炸'
};

// 页面切换
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Toast
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// 连接WebSocket
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => console.log('已连接');
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => toast('连接已断开');
  ws.onerror = () => toast('连接失败');
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'created':
      roomId = msg.data.roomId;
      mySeat = msg.data.seat;
      document.getElementById('roomIdDisplay').textContent = roomId;
      showPage('page-room');
      break;
    case 'joined':
      roomId = msg.data.roomId;
      mySeat = msg.data.seat;
      document.getElementById('roomIdDisplay').textContent = roomId;
      showPage('page-room');
      break;
    case 'roomUpdate':
      renderRoom(msg.data);
      break;
    case 'gameStart':
      showPage('page-game');
      break;
    case 'gameState':
      gameState = msg.data;
      renderGame();
      break;
    case 'play':
      showGameMsg(`${msg.data.name} 出了 ${PATTERN_NAMES[msg.data.pattern.type] || msg.data.pattern.type}`);
      break;
    case 'pass':
      showGameMsg(`${msg.data.name} 不要`);
      break;
    case 'rank':
      showGameMsg(`🎉 ${msg.data.name} 第${msg.data.rank}名！`);
      break;
    case 'roundEnd':
      showRoundEnd(msg.data);
      break;
    case 'error':
      toast(msg.data.message);
      break;
  }
}

// 首页操作
function createRoom() {
  const name = document.getElementById('inputName').value.trim() || '玩家';
  if (!ws || ws.readyState !== 1) connectWS();
  setTimeout(() => send({ type: 'createRoom', name }), 200);
}

function joinRoom() {
  const name = document.getElementById('inputName').value.trim() || '玩家';
  const id = document.getElementById('inputRoomId').value.trim();
  if (!id || id.length !== 6) { toast('请输入6位房间号'); return; }
  if (!ws || ws.readyState !== 1) connectWS();
  setTimeout(() => send({ type: 'joinRoom', name, roomId: id }), 200);
}

// 房间页
function renderRoom(room) {
  for (let i = 0; i < 4; i++) {
    const seatEl = document.getElementById('seat-' + i);
    const player = room.players.find(p => p.seat === i);
    const nameEl = seatEl.querySelector('.seat-name');
    const statusEl = seatEl.querySelector('.seat-status');
    seatEl.classList.remove('taken', 'me', 'bot');
    if (player) {
      seatEl.classList.add('taken');
      if (i === mySeat) seatEl.classList.add('me');
      if (player.isBot) seatEl.classList.add('bot');
      nameEl.textContent = player.name + (player.isBot ? '🤖' : '');
      statusEl.textContent = player.ready ? '✓ 已准备' : '等待中';
      statusEl.className = 'seat-status' + (player.ready ? ' ready' : '');
    } else {
      nameEl.textContent = '空位';
      statusEl.textContent = '';
    }
  }
}

function toggleReady() {
  isReady = !isReady;
  send({ type: 'setReady', ready: isReady });
  const btn = document.getElementById('btnReady');
  btn.textContent = isReady ? '取消准备' : '准备';
  btn.style.background = isReady ? 'linear-gradient(135deg, #e53935, #c62828)' : '';
}

function copyRoomId() {
  const text = `快来掼蛋！房间号：${roomId}，打开链接加入：${location.href}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('已复制邀请信息'));
  } else {
    prompt('复制邀请信息：', text);
  }
}

function leaveRoom() {
  send({ type: 'leaveRoom' });
  isReady = false;
  showPage('page-home');
}

// 游戏渲染
function renderGame() {
  if (!gameState) return;
  document.getElementById('gameLevel').textContent = gameState.level;
  document.getElementById('gameRound').textContent = gameState.round;
  document.getElementById('scoreA').textContent = gameState.scores.teamA;
  document.getElementById('scoreB').textContent = gameState.scores.teamB;

  for (let i = 0; i < 4; i++) {
    const p = gameState.players[i];
    const infoEl = document.getElementById('pinfo-' + i);
    const countEl = document.getElementById('pcount-' + i);
    infoEl.classList.toggle('active', gameState.currentPlayer === i);
    infoEl.querySelector('.pname').textContent = p.name + (p.isBot ? '🤖' : '');
    // 名次徽章
    const oldBadge = infoEl.querySelector('.rank-badge');
    if (oldBadge) oldBadge.remove();
    if (p.rank > 0) {
      const badge = document.createElement('span');
      badge.className = 'rank-badge';
      badge.textContent = '第' + p.rank;
      infoEl.appendChild(badge);
      countEl.style.display = 'none';
    } else {
      countEl.style.display = '';
      countEl.textContent = p.cardCount;
    }
    // 出牌区
    const playEl = document.getElementById('play-' + i);
    if (gameState.lastPlay && gameState.lastPlay.player === i) {
      playEl.innerHTML = renderPlayCards(gameState.lastPlay.cards);
    } else {
      playEl.innerHTML = '';
    }
  }

  // 我的手牌
  const myPlayer = gameState.players[mySeat];
  if (myPlayer && myPlayer.cards) {
    renderHand(myPlayer.cards);
  }

  // 按钮状态
  const isMyTurn = gameState.currentPlayer === mySeat && !gameState.gameOver;
  document.getElementById('btnPlay').disabled = !isMyTurn || selectedCards.size === 0;
  document.getElementById('btnPass').disabled = !isMyTurn || !gameState.lastPlay;
}

function renderPlayCards(cards) {
  return cards.map(c => {
    const isRed = c.suit === 'heart' || c.suit === 'diamond';
    const isJoker = c.rank === 'smallJoker' || c.rank === 'bigJoker';
    const suit = { spade: '♠', heart: '♥', diamond: '♦', club: '♣' }[c.suit] || '';
    const label = isJoker ? (c.rank === 'bigJoker' ? '大王' : '小王') : c.rank + suit;
    return `<span class="play-card ${isRed ? 'red' : 'black'}">${label}</span>`;
  }).join('');
}

function renderHand(cards) {
  const container = document.getElementById('handArea');
  // 排序：从大到小
  const level = gameState ? gameState.level : '2';
  const sorted = [...cards].sort((a, b) => cardVal(b, level) - cardVal(a, level));
  let html = '<div class="hand-cards">';
  for (const card of sorted) {
    const isRed = card.suit === 'heart' || card.suit === 'diamond';
    const isJoker = card.rank === 'smallJoker' || card.rank === 'bigJoker';
    const isWild = card.suit === 'heart' && card.rank === level;
    const selected = selectedCards.has(card.id) ? 'selected' : '';
    const suit = { spade: '♠', heart: '♥', diamond: '♦', club: '♣' }[card.suit] || '';
    const rankLabel = isJoker ? (card.rank === 'bigJoker' ? '大王' : '小王') : card.rank;
    html += `<div class="hand-card ${isRed ? 'red' : 'black'} ${isWild ? 'wild' : ''} ${selected}" data-id="${card.id}" onclick="toggleCard(${card.id})">
      <div class="card-top">${rankLabel}${!isJoker ? suit : ''}</div>
      <div class="card-center">${isJoker ? (card.rank === 'bigJoker' ? '👑' : '🃏') : suit}</div>
      <div class="card-bottom">${rankLabel}${!isJoker ? suit : ''}</div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
  updateSelectedInfo();
}

function cardVal(card, level) {
  if (card.rank === 'bigJoker') return 17;
  if (card.rank === 'smallJoker') return 16;
  if (card.rank === level) return 15;
  if (card.rank === '2') return 14;
  if (card.rank === 'A') return 13;
  if (card.rank === 'K') return 12;
  if (card.rank === 'Q') return 11;
  if (card.rank === 'J') return 10;
  return parseInt(card.rank);
}

function toggleCard(id) {
  if (selectedCards.has(id)) selectedCards.delete(id);
  else selectedCards.add(id);
  if (gameState) {
    const myPlayer = gameState.players[mySeat];
    renderHand(myPlayer.cards);
  }
}

function updateSelectedInfo() {
  const info = document.getElementById('selectedInfo');
  if (selectedCards.size === 0) { info.style.display = 'none'; return; }
  info.style.display = 'block';
  document.getElementById('selCount').textContent = selectedCards.size;
  // 简单识别
  const myPlayer = gameState ? gameState.players[mySeat] : null;
  if (myPlayer && myPlayer.cards) {
    const cards = myPlayer.cards.filter(c => selectedCards.has(c.id));
    document.getElementById('selPattern').textContent = guessPattern(cards);
  }
}

function guessPattern(cards) {
  const n = cards.length;
  if (n === 1) return '单张';
  if (n === 2) return '对子?';
  if (n === 3) return '三张?';
  if (n === 5) return '三带二/顺子?';
  if (n >= 4) return '炸弹?';
  return n + '张';
}

function playerPlay() {
  if (!gameState || selectedCards.size === 0) return;
  const myPlayer = gameState.players[mySeat];
  const cards = myPlayer.cards.filter(c => selectedCards.has(c.id));
  send({ type: 'play', cards });
  selectedCards.clear();
}

function playerPass() {
  send({ type: 'pass' });
}

function showHint() {
  toast('提示：选择能压过上家的最小牌型');
}

function showGameMsg(text) {
  const el = document.getElementById('gameMsg');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 1500);
}

function showRoundEnd(data) {
  const overlay = document.getElementById('roundOverlay');
  const title = document.getElementById('roundTitle');
  const detail = document.getElementById('roundDetail');
  const myTeamWin = (data.ranks[0].seat === 0 || data.ranks[0].seat === 2) &&
                     (data.ranks[1].seat === 0 || data.ranks[1].seat === 2);
  // 简化判断：看第一名是不是自己队伍
  const firstIsMyTeam = data.ranks[0].seat === 0 || data.ranks[0].seat === 2;
  title.textContent = firstIsMyTeam ? '🎉 你们赢了！' : '😔 对方赢了';
  let html = '';
  for (const r of data.ranks) {
    html += `<div>第${r.rank}名：${r.name}</div>`;
  }
  html += `<div style="margin-top:10px;">比分：蓝 ${data.scores.teamA} : ${data.scores.teamB} 红</div>`;
  html += `<div>下一轮打 ${data.level}</div>`;
  detail.innerHTML = html;
  overlay.style.display = 'flex';
  setTimeout(() => { overlay.style.display = 'none'; }, 3000);
}

// 初始化
window.addEventListener('load', () => {
  connectWS();
});

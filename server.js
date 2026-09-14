// 在线多人掼蛋 - WebSocket服务器
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const engine = require('./engine');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// 房间管理
const rooms = new Map(); // roomId -> roomState

function genRoomId() {
  let id;
  do {
    id = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(id));
  return id;
}

function createRoom() {
  const roomId = genRoomId();
  const room = {
    id: roomId,
    players: [], // {ws, name, seat, ready, isBot}
    state: 'waiting', // waiting | playing | finished
    game: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function getPublicRoom(room) {
  return {
    id: room.id,
    state: room.state,
    players: room.players.map(p => ({
      name: p.name,
      seat: p.seat,
      ready: p.ready,
      isBot: p.isBot,
      online: !!p.ws,
    })),
  };
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  }
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

// 游戏状态（每局）
function initGame(room) {
  const level = '2';
  const deck = engine.shuffle(engine.createDeck());
  const seats = [0, 1, 2, 3]; // 南西北东
  const game = {
    level,
    round: 1,
    players: seats.map((seat, i) => {
      const p = room.players.find(x => x.seat === seat);
      return {
        seat,
        name: p ? p.name : `玩家${seat + 1}`,
        isBot: !p,
        cards: engine.sortCards(deck.slice(i * 27, (i + 1) * 27), level),
        rank: 0,
      };
    }),
    currentPlayer: Math.floor(Math.random() * 4),
    lastPlay: null,
    passCount: 0,
    scores: { teamA: 0, teamB: 0 }, // 0+2队 vs 1+3队
    gameOver: false,
  };
  room.game = game;
  room.state = 'playing';
  return game;
}

function getGameStateForPlayer(game, seat) {
  return {
    level: game.level,
    round: game.round,
    currentPlayer: game.currentPlayer,
    lastPlay: game.lastPlay ? {
      player: game.lastPlay.player,
      pattern: { type: game.lastPlay.pattern.type, length: game.lastPlay.pattern.length, mainRank: game.lastPlay.pattern.mainRank },
      cards: game.lastPlay.cards,
    } : null,
    passCount: game.passCount,
    scores: game.scores,
    gameOver: game.gameOver,
    players: game.players.map((p, i) => ({
      seat: p.seat,
      name: p.name,
      isBot: p.isBot,
      cardCount: p.cards.length,
      rank: p.rank,
      cards: i === seat ? p.cards : undefined, // 只发自己的手牌
    })),
    mySeat: seat,
  };
}

function broadcastGame(room) {
  const game = room.game;
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) {
      sendTo(p.ws, { type: 'gameState', data: getGameStateForPlayer(game, p.seat) });
    }
  }
  // 机器人也处理
  setTimeout(() => processBotTurn(room), 500);
}

function processBotTurn(room) {
  const game = room.game;
  if (!game || game.gameOver) return;
  const player = game.players[game.currentPlayer];
  if (!player.isBot) return;

  let playCards;
  if (game.lastPlay) {
    playCards = engine.aiFollowPlay(player.cards, game.lastPlay.pattern, game.level);
  } else {
    playCards = engine.aiLeadPlay(player.cards, game.level);
  }

  if (playCards) {
    doPlay(room, game.currentPlayer, playCards);
  } else {
    doPass(room, game.currentPlayer);
  }
}

function doPlay(room, seat, cards) {
  const game = room.game;
  const player = game.players[seat];
  const pattern = engine.identifyPattern(cards, game.level);
  if (!pattern) return false;

  if (game.lastPlay && !engine.canBeat(pattern, game.lastPlay.pattern, game.level)) {
    return false;
  }

  // 移除手牌
  const ids = new Set(cards.map(c => c.id));
  player.cards = player.cards.filter(c => !ids.has(c.id));

  game.lastPlay = { player: seat, pattern, cards };
  game.passCount = 0;

  broadcast(room, { type: 'play', data: { seat, name: player.name, pattern: { type: pattern.type, length: pattern.length }, cards } });

  // 检查出完
  if (player.cards.length === 0) {
    player.rank = game.players.filter(p => p.rank > 0).length + 1;
    broadcast(room, { type: 'rank', data: { seat, rank: player.rank, name: player.name } });
    if (checkGameOver(game)) {
      endRound(room);
      return true;
    }
  }

  nextPlayer(room);
  return true;
}

function doPass(room, seat) {
  const game = room.game;
  const player = game.players[seat];
  game.passCount++;
  broadcast(room, { type: 'pass', data: { seat, name: player.name } });

  if (game.passCount >= 3) {
    game.lastPlay = null;
    game.passCount = 0;
    broadcast(room, { type: 'clearPlay', data: {} });
  }

  nextPlayer(room);
}

function nextPlayer(room) {
  const game = room.game;
  let next = (game.currentPlayer + 1) % 4;
  while (game.players[next].cards.length === 0 && game.players[next].rank > 0) {
    next = (next + 1) % 4;
    if (next === game.currentPlayer) break;
  }
  game.currentPlayer = next;
  broadcastGame(room);
}

function checkGameOver(game) {
  const teamA = game.players.filter((p, i) => (i === 0 || i === 2) && p.rank > 0).length;
  const teamB = game.players.filter((p, i) => (i === 1 || i === 3) && p.rank > 0).length;
  return teamA >= 2 || teamB >= 2;
}

function endRound(room) {
  const game = room.game;
  const ranks = game.players.map((p, i) => ({ seat: i, rank: p.rank })).sort((a, b) => a.rank - b.rank);
  const first = ranks[0].seat;
  const teamAWin = first === 0 || first === 2;

  if (teamAWin) game.scores.teamA++;
  else game.scores.teamB++;

  // 升级
  if (teamAWin) {
    const second = ranks[1].seat;
    let levels = 1;
    if ((first === 0 || first === 2) && (second === 0 || second === 2)) levels = 3;
    else if (ranks[2].seat === 0 || ranks[2].seat === 2) levels = 2;
    const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const idx = order.indexOf(game.level);
    game.level = order[Math.min(idx + levels, order.length - 1)];
  }

  game.gameOver = true;
  broadcast(room, { type: 'roundEnd', data: { scores: game.scores, level: game.level, ranks: ranks.map(r => ({ seat: r.seat, rank: r.rank, name: game.players[r.seat].name })) } });

  // 3秒后自动开始下一轮
  setTimeout(() => {
    if (rooms.has(room.id)) {
      initGame(room);
      broadcast(room, { type: 'roomUpdate', data: getPublicRoom(room) });
      broadcastGame(room);
    }
  }, 3000);
}

// HTTP服务器（提供静态文件）
const server = http.createServer((req, res) => {
  let urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let currentRoom = null;
  let mySeat = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'createRoom': {
        const room = createRoom();
        currentRoom = room;
        // 创建者自动坐0号位
        const player = { ws, name: msg.name || '玩家', seat: 0, ready: false, isBot: false };
        room.players.push(player);
        mySeat = 0;
        sendTo(ws, { type: 'created', data: { roomId: room.id, seat: 0 } });
        broadcast(room, { type: 'roomUpdate', data: getPublicRoom(room) });
        break;
      }

      case 'joinRoom': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          sendTo(ws, { type: 'error', data: { message: '房间不存在' } });
          return;
        }
        if (room.players.filter(p => !p.isBot).length >= 4) {
          sendTo(ws, { type: 'error', data: { message: '房间已满' } });
          return;
        }
        currentRoom = room;
        // 找空座位
        const takenSeats = new Set(room.players.map(p => p.seat));
        let seat = -1;
        for (let i = 0; i < 4; i++) {
          if (!takenSeats.has(i)) { seat = i; break; }
        }
        const player = { ws, name: msg.name || '玩家', seat, ready: false, isBot: false };
        room.players.push(player);
        mySeat = seat;
        sendTo(ws, { type: 'joined', data: { roomId: room.id, seat } });
        broadcast(room, { type: 'roomUpdate', data: getPublicRoom(room) });
        break;
      }

      case 'setReady': {
        if (!currentRoom) return;
        const player = currentRoom.players.find(p => p.ws === ws);
        if (player) {
          player.ready = msg.ready;
          broadcast(currentRoom, { type: 'roomUpdate', data: getPublicRoom(currentRoom) });
          // 检查是否所有人都准备了（1人即可开局，空位自动补机器人）
          const allReady = currentRoom.players.every(p => p.ready || p.isBot);
          const hasEnough = currentRoom.players.length >= 1;
          if (allReady && hasEnough && currentRoom.state === 'waiting') {
            // 空位补机器人
            const taken = new Set(currentRoom.players.map(p => p.seat));
            for (let i = 0; i < 4; i++) {
              if (!taken.has(i)) {
                currentRoom.players.push({ ws: null, name: `机器人${i + 1}`, seat: i, ready: true, isBot: true });
              }
            }
            initGame(currentRoom);
            broadcast(currentRoom, { type: 'gameStart', data: {} });
            broadcastGame(currentRoom);
          }
        }
        break;
      }

      case 'play': {
        if (!currentRoom || !currentRoom.game) return;
        const game = currentRoom.game;
        if (game.currentPlayer !== mySeat) return;
        const ok = doPlay(currentRoom, mySeat, msg.cards);
        if (!ok) sendTo(ws, { type: 'error', data: { message: '出牌不合法' } });
        break;
      }

      case 'pass': {
        if (!currentRoom || !currentRoom.game) return;
        const game = currentRoom.game;
        if (game.currentPlayer !== mySeat) return;
        if (!game.lastPlay) {
          sendTo(ws, { type: 'error', data: { message: '先手不能不要' } });
          return;
        }
        doPass(currentRoom, mySeat);
        break;
      }

      case 'leaveRoom': {
        if (currentRoom) {
          currentRoom.players = currentRoom.players.filter(p => p.ws !== ws);
          if (currentRoom.players.length === 0) {
            rooms.delete(currentRoom.id);
          } else {
            broadcast(currentRoom, { type: 'roomUpdate', data: getPublicRoom(currentRoom) });
          }
          currentRoom = null;
          mySeat = -1;
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.players = currentRoom.players.filter(p => p.ws !== ws);
      if (currentRoom.players.length === 0) {
        rooms.delete(currentRoom.id);
      } else {
        broadcast(currentRoom, { type: 'roomUpdate', data: getPublicRoom(currentRoom) });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`掼蛋在线服务器已启动: http://localhost:${PORT}`);
  console.log(`创建房间: 打开首页点击"创建房间"`);
});

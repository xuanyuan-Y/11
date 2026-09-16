const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// 房间管理
const rooms = new Map();

// 生成随机房间ID
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 生成随机密码
function generatePassword() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// 广播房间状态
function broadcastRoomUpdate(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('roomUpdate', {
    players: room.players,
    playerNames: room.playerNames,
    seats: room.seats,
    ready: room.ready,
    host: room.host
  });
}

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  // 创建房间
  socket.on('createRoom', (data, callback) => {
    const roomId = generateRoomId();
    const password = generatePassword();
    rooms.set(roomId, {
      id: roomId,
      password: password,
      host: socket.id,
      players: [socket.id, null, null, null],
      playerNames: [data.playerName, '', '', ''],
      seats: [true, false, false, false],
      ready: [true, false, false, false], // 房主默认准备
      gameStarted: false,
      gameState: null
    });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.seatIndex = 0;
    callback({ success: true, roomId: roomId, password: password });
    broadcastRoomUpdate(roomId);
  });

  // 加入房间
  socket.on('joinRoom', (data, callback) => {
    const { roomId, password, playerName } = data;
    const room = rooms.get(roomId);
    if (!room) {
      callback({ success: false, message: '房间不存在' });
      return;
    }
    if (room.password !== password) {
      callback({ success: false, message: '密码错误' });
      return;
    }
    if (room.gameStarted) {
      callback({ success: false, message: '游戏已开始' });
      return;
    }

    // 找空座位
    let seatIndex = -1;
    for (let i = 0; i < 4; i++) {
      if (!room.seats[i]) {
        seatIndex = i;
        break;
      }
    }

    if (seatIndex === -1) {
      callback({ success: false, message: '房间已满' });
      return;
    }

    room.players[seatIndex] = socket.id;
    room.playerNames[seatIndex] = playerName;
    room.seats[seatIndex] = true;
    room.ready[seatIndex] = false;

    socket.join(roomId);
    socket.roomId = roomId;
    socket.seatIndex = seatIndex;

    callback({ success: true, roomId: roomId, seat: seatIndex });
    broadcastRoomUpdate(roomId);
  });

  // 点击座位坐下（加入房间后选择座位）
  socket.on('takeSeat', (data, callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) {
      callback({ success: false, message: '不在房间中' });
      return;
    }
    if (room.gameStarted) {
      callback({ success: false, message: '游戏已开始' });
      return;
    }

    const { seat } = data;
    if (seat < 0 || seat >= 4) {
      callback({ success: false, message: '座位号无效' });
      return;
    }
    if (room.seats[seat]) {
      callback({ success: false, message: '该座位已有人' });
      return;
    }

    // 从原来的座位移走
    const oldSeat = socket.seatIndex;
    if (oldSeat !== -1 && oldSeat !== seat) {
      room.players[oldSeat] = null;
      room.playerNames[oldSeat] = '';
      room.seats[oldSeat] = false;
      room.ready[oldSeat] = false;
    }

    // 坐到新座位
    room.players[seat] = socket.id;
    room.playerNames[seat] = room.playerNames[oldSeat] || '玩家';
    room.seats[seat] = true;
    room.ready[seat] = false;
    socket.seatIndex = seat;

    callback({ success: true, seat: seat });
    broadcastRoomUpdate(room.id);
  });

  // 准备/取消准备
  socket.on('toggleReady', (data, callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) {
      callback({ success: false, message: '不在房间中' });
      return;
    }
    if (room.gameStarted) {
      callback({ success: false, message: '游戏已开始' });
      return;
    }

    const seat = socket.seatIndex;
    if (seat === -1) {
      callback({ success: false, message: '请先选择座位' });
      return;
    }

    room.ready[seat] = !room.ready[seat];
    callback({ success: true, ready: room.ready[seat] });
    broadcastRoomUpdate(room.id);
  });

  // 添加AI玩家到指定座位
  socket.on('addAI', (data, callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) {
      callback({ success: false, message: '不在房间中' });
      return;
    }
    if (room.host !== socket.id) {
      callback({ success: false, message: '只有房主可以添加AI' });
      return;
    }

    const { seat } = data;
    if (seat < 0 || seat >= 4) {
      callback({ success: false, message: '座位号无效' });
      return;
    }
    if (room.seats[seat]) {
      callback({ success: false, message: '该座位已有人' });
      return;
    }

    const aiName = 'AI-' + (seat + 1);
    room.players[seat] = 'AI-' + seat;
    room.playerNames[seat] = aiName;
    room.seats[seat] = true;
    room.ready[seat] = true; // AI默认准备

    callback({ success: true });
    broadcastRoomUpdate(room.id);
  });

  // 交换座位
  socket.on('swapSeat', (data, callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) {
      callback({ success: false, message: '不在房间中' });
      return;
    }
    if (room.host !== socket.id) {
      callback({ success: false, message: '只有房主可以交换座位' });
      return;
    }

    const { seat1, seat2 } = data;
    if (seat1 < 0 || seat1 >= 4 || seat2 < 0 || seat2 >= 4) {
      callback({ success: false, message: '座位号无效' });
      return;
    }
    if (!room.seats[seat1] || !room.seats[seat2]) {
      callback({ success: false, message: '空座位不能交换' });
      return;
    }

    // 交换玩家位置
    const tempPlayer = room.players[seat1];
    const tempName = room.playerNames[seat1];
    const tempReady = room.ready[seat1];
    room.players[seat1] = room.players[seat2];
    room.playerNames[seat1] = room.playerNames[seat2];
    room.ready[seat1] = room.ready[seat2];
    room.players[seat2] = tempPlayer;
    room.playerNames[seat2] = tempName;
    room.ready[seat2] = tempReady;

    callback({ success: true });
    broadcastRoomUpdate(room.id);
  });

  // 开始游戏
  socket.on('startGame', (data, callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) {
      callback({ success: false, message: '不在房间中' });
      return;
    }
    if (room.host !== socket.id) {
      callback({ success: false, message: '只有房主可以开始游戏' });
      return;
    }

    // 检查是否坐满4人
    const occupiedCount = room.seats.filter(s => s).length;
    if (occupiedCount < 2) {
      callback({ success: false, message: '至少需要2人开始游戏' });
      return;
    }

    // 检查是否所有人都准备
    for (let i = 0; i < 4; i++) {
      if (room.seats[i] && !room.ready[i]) {
        callback({ success: false, message: '还有玩家未准备' });
        return;
      }
    }

    room.gameStarted = true;
    io.to(room.id).emit('gameStart', {
      players: room.playerNames,
      seats: room.seats,
      host: room.host
    });
    callback({ success: true });
  });

  // 出牌
  socket.on('playCards', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    io.to(room.id).emit('cardPlayed', {
      playerId: socket.id,
      seatIndex: socket.seatIndex,
      cards: data.cards,
      type: data.type
    });
  });

  // 不要
  socket.on('passCards', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    io.to(room.id).emit('cardPassed', {
      playerId: socket.id,
      seatIndex: socket.seatIndex
    });
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('用户断开:', socket.id);
    const room = rooms.get(socket.roomId);
    if (room) {
      const seat = socket.seatIndex;
      if (seat !== -1 && room.players[seat] === socket.id) {
        room.players[seat] = null;
        room.playerNames[seat] = '';
        room.seats[seat] = false;
        room.ready[seat] = false;
      }
      broadcastRoomUpdate(room.id);
      // 如果房间空了，删除
      const occupiedCount = room.seats.filter(s => s).length;
      if (occupiedCount === 0) {
        rooms.delete(room.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

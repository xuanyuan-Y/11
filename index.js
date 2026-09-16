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
const rooms = new Map(); // roomId -> { players: [socketId...], gameState: ... }

// 生成随机房间ID
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 生成随机密码
function generatePassword() {
  return Math.floor(1000 + Math.random() * 9000).toString();
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
      players: [socket.id],
      playerNames: [data.playerName],
      seats: [true, false, false, false], // 4个座位，host坐第一个
      gameStarted: false,
      gameState: null
    });
    socket.join(roomId);
    socket.roomId = roomId;
    callback({ success: true, roomId: roomId, password: password });
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
    if (room.players.length >= 4) {
      callback({ success: false, message: '房间已满' });
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
        room.seats[i] = true;
        break;
      }
    }

    room.players.push(socket.id);
    room.playerNames.push(playerName);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.seatIndex = seatIndex;

    // 通知房间内所有人
    io.to(roomId).emit('playerJoined', {
      players: room.playerNames,
      seats: room.seats,
      host: room.host
    });

    callback({ success: true, roomId: roomId, seatIndex: seatIndex });
  });

  // 添加AI玩家
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
    if (room.players.length >= 4) {
      callback({ success: false, message: '房间已满' });
      return;
    }

    // 找空座位
    let seatIndex = -1;
    for (let i = 0; i < 4; i++) {
      if (!room.seats[i]) {
        seatIndex = i;
        room.seats[i] = true;
        break;
      }
    }

    const aiName = 'AI-' + (room.playerNames.length + 1);
    room.players.push('AI-' + seatIndex);
    room.playerNames.push(aiName);

    // 通知房间内所有人
    io.to(room.id).emit('playerJoined', {
      players: room.playerNames,
      seats: room.seats,
      host: room.host
    });

    callback({ success: true });
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
    room.players[seat1] = room.players[seat2];
    room.playerNames[seat1] = room.playerNames[seat2];
    room.players[seat2] = tempPlayer;
    room.playerNames[seat2] = tempName;

    // 通知房间内所有人
    io.to(room.id).emit('playerJoined', {
      players: room.playerNames,
      seats: room.seats,
      host: room.host
    });

    callback({ success: true });
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
    if (room.players.length < 2) {
      callback({ success: false, message: '至少需要2人开始游戏' });
      return;
    }

    room.gameStarted = true;
    // 通知所有人游戏开始
    io.to(room.id).emit('gameStart', {
      players: room.playerNames,
      host: room.host
    });
    callback({ success: true });
  });

  // 出牌
  socket.on('playCards', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    // 广播出牌
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
      // 移除玩家
      const index = room.players.indexOf(socket.id);
      if (index > -1) {
        room.players.splice(index, 1);
        room.playerNames.splice(index, 1);
        room.seats[index] = false;
      }
      // 通知房间内其他人
      io.to(room.id).emit('playerLeft', {
        players: room.playerNames,
        seats: room.seats
      });
      // 如果房间空了，删除
      if (room.players.length === 0) {
        rooms.delete(room.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

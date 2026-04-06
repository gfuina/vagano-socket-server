/**
 * 🚀 STANDALONE SOCKET.IO SERVER
 * 
 * Déployé sur Railway.app pour supporter WebSocket connections
 * Séparé de l'app Next.js principale (Vercel)
 * 
 * Architecture:
 * - Next.js App (Vercel): https://app.vagano.fr
 * - Socket.io Server (Railway): https://socket.vagano.fr
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = http.createServer(app);

// Track online users
const onlineUsers = new Map();
// Track users typing in conversations
const typingUsers = new Map();
// Track users per location chat room (roomName -> Map<userId, { socketId, userName }>)
const locationRoomUsers = new Map();
// Track which location rooms a socket is in (socketId -> Set<roomName>)
const socketLocationRooms = new Map();

// ⚡️ CORS Configuration - Allow your Next.js app
const ALLOWED_ORIGINS = [
  'https://app.vagano.fr',
  'https://www.vagano.fr',
  'http://localhost:3000',
  'http://localhost:3001',
];

// Add environment variable for additional origins
if (process.env.ALLOWED_ORIGINS) {
  ALLOWED_ORIGINS.push(...process.env.ALLOWED_ORIGINS.split(','));
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vagano.fr')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
}));

app.use(express.json());

// ⚡️ Socket.IO Configuration
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || origin?.endsWith('.vagano.fr')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io',
  
  // ⚡️ OPTIMIZED FOR WEBSOCKET
  transports: ['websocket', 'polling'], // WebSocket prioritaire
  allowUpgrades: true,
  
  // ⚡️ TIMEOUTS
  pingTimeout: 60000,  // 60s
  pingInterval: 25000, // 25s
  
  // ⚡️ CONNECTION SETTINGS
  connectTimeout: 45000,
  maxHttpBufferSize: 1e6, // 1MB
});

// Helper function to broadcast online status to all users
const broadcastUserStatus = (userId, isOnline) => {
  io.emit(isOnline ? 'userOnline' : 'userOffline', userId);
};

// Helper function to clear typing timeout
const clearTypingTimeout = (conversationId, userId) => {
  const key = `${conversationId}:${userId}`;
  if (typingUsers.has(key)) {
    clearTimeout(typingUsers.get(key).timeout);
    typingUsers.delete(key);
  }
};

// Helper function to broadcast location room presence
const broadcastLocationRoomPresence = (room, countryCode) => {
  const roomUsers = locationRoomUsers.get(room);
  const users = roomUsers ? Array.from(roomUsers.entries()).map(([id, data]) => ({
    id,
    name: data.userName
  })) : [];
  
  io.to(room).emit('location-room-presence', {
    countryCode,
    onlineCount: users.length,
    users
  });
  
  console.log(`🌍 [Presence] Room ${room}: ${users.length} users online`);
};

// Helper function to add user to location room
const addUserToLocationRoom = (room, userId, socketId, userName) => {
  if (!locationRoomUsers.has(room)) {
    locationRoomUsers.set(room, new Map());
  }
  locationRoomUsers.get(room).set(userId, { socketId, userName });
  
  // Track which rooms this socket is in
  if (!socketLocationRooms.has(socketId)) {
    socketLocationRooms.set(socketId, new Set());
  }
  socketLocationRooms.get(socketId).add(room);
};

// Helper function to remove user from location room
const removeUserFromLocationRoom = (room, userId, socketId) => {
  const roomUsers = locationRoomUsers.get(room);
  if (roomUsers) {
    roomUsers.delete(userId);
    if (roomUsers.size === 0) {
      locationRoomUsers.delete(room);
    }
  }
  
  // Remove from socket tracking
  const socketRooms = socketLocationRooms.get(socketId);
  if (socketRooms) {
    socketRooms.delete(room);
    if (socketRooms.size === 0) {
      socketLocationRooms.delete(socketId);
    }
  }
};

// ⚡️ SOCKET.IO EVENT HANDLERS
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);
  
  // Authentification du socket
  const userId = socket.handshake.auth.userId;
  if (userId) {
    // Track this socket for the user
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);
    
    // Broadcast that user is online
    broadcastUserStatus(userId, true);
    
    socket.join(`user:${userId}`);
    console.log(`👤 User ${userId} joined their room`);
  }

  // Allow clients to request current online users
  socket.on('getOnlineUsers', () => {
    const userIds = Array.from(onlineUsers.keys());
    socket.emit('onlineUsers', userIds);
  });

  // 💬 CONVERSATION EVENTS
  socket.on('join-conversation', (conversationId) => {
    socket.join(`conversation:${conversationId}`);
    console.log(`📥 Socket ${socket.id} joined conversation ${conversationId}`);
  });

  socket.on('leave-conversation', (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
    console.log(`📤 Socket ${socket.id} left conversation ${conversationId}`);
    
    // Clear any typing indicators when leaving
    if (userId) {
      clearTypingTimeout(conversationId, userId);
      io.to(`conversation:${conversationId}`).emit('userStopTyping', { 
        userId, 
        conversationId 
      });
    }
  });

  socket.on('message-likes-updated', (data) => {
    if (!data?.conversationId) return;
    io.to(`conversation:${data.conversationId}`).emit('message-likes-updated', data);
  });

  socket.on('send-message', (data) => {
    if (userId) {
      clearTypingTimeout(data.conversationId, userId);
      io.to(`conversation:${data.conversationId}`).emit('userStopTyping', { 
        userId, 
        conversationId: data.conversationId 
      });
    }
    
    // Emit to conversation room (all clients that joined this conversation)
    io.to(`conversation:${data.conversationId}`).emit(`message:${data.conversationId}`, data.message);
    
    // Targeted newMessage to participants only (not broadcast to ALL clients)
    if (data.recipientId) {
      // 1-to-1: notify recipient + sender
      io.to(`user:${data.recipientId}`).emit('newMessage', data);
      if (userId) io.to(`user:${userId}`).emit('newMessage', data);
    } else if (data.isGroupConversation && Array.isArray(data.participantIds)) {
      // Group: notify all participants
      data.participantIds.forEach(pid => {
        io.to(`user:${pid}`).emit('newMessage', data);
      });
      if (userId) io.to(`user:${userId}`).emit('newMessage', data);
    }
  });

  // ✍️ TYPING INDICATORS
  socket.on('typing', (data) => {
    if (!data.userId || !data.conversationId) return;
    
    const key = `${data.conversationId}:${data.userId}`;
    
    // Clear existing timeout if any
    clearTypingTimeout(data.conversationId, data.userId);
    
    // Set new timeout to automatically remove typing status after 3 seconds of inactivity
    const timeout = setTimeout(() => {
      typingUsers.delete(key);
      io.to(`conversation:${data.conversationId}`).emit('userStopTyping', { 
        userId: data.userId, 
        conversationId: data.conversationId 
      });
    }, 3000);
    
    // Store the timeout reference
    typingUsers.set(key, { 
      timeout,
      userName: data.userName
    });
    
    // Emit typing event to the conversation
    socket.to(`conversation:${data.conversationId}`).emit('userTyping', data);
  });

  socket.on('stopTyping', (data) => {
    if (!data.userId || !data.conversationId) return;
    
    clearTypingTimeout(data.conversationId, data.userId);
    socket.to(`conversation:${data.conversationId}`).emit('userStopTyping', data);
  });

  // 📢 CONVERSATION UPDATES
  socket.on('conversation-update', (data) => {
    const event = data.status === 'accepted' ? 'contactRequestAccepted' : 'contactRequestRejected';
    io.emit(event, data);
  });

  // 🌍 LOCATION CHAT EVENTS
  socket.on('join-location-chat', ({ countryCode, userId, userName }) => {
    if (!countryCode) return;
    const normalizedCode = countryCode.toUpperCase();
    const room = `location-chat:${normalizedCode}`;
    
    // Join the socket room
    socket.join(room);
    
    // Track user in room (use userName from event or fallback to 'Anonymous')
    const displayName = userName || 'Anonymous';
    addUserToLocationRoom(room, userId, socket.id, displayName);
    
    console.log(`🌍 User ${userId} (${displayName}) joined location chat room: ${room}`);
    console.log(`🌍 Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms));
    
    // Broadcast updated presence to all users in room
    broadcastLocationRoomPresence(room, normalizedCode);
  });

  socket.on('leave-location-chat', ({ countryCode, userId }) => {
    if (!countryCode) return;
    const normalizedCode = countryCode.toUpperCase();
    const room = `location-chat:${normalizedCode}`;
    
    // Leave the socket room
    socket.leave(room);
    
    // Remove user from tracking
    removeUserFromLocationRoom(room, userId, socket.id);
    
    console.log(`👤 User ${userId} left location chat: ${countryCode}`);
    
    // Broadcast updated presence to remaining users in room
    broadcastLocationRoomPresence(room, normalizedCode);
  });

  // 🌍 Request current room presence
  socket.on('get-location-room-users', ({ countryCode }) => {
    if (!countryCode) return;
    const normalizedCode = countryCode.toUpperCase();
    const room = `location-chat:${normalizedCode}`;
    
    const roomUsers = locationRoomUsers.get(room);
    const users = roomUsers ? Array.from(roomUsers.entries()).map(([id, data]) => ({
      id,
      name: data.userName
    })) : [];
    
    socket.emit('location-room-presence', {
      countryCode: normalizedCode,
      onlineCount: users.length,
      users
    });
  });

  socket.on('send-location-message', async (data) => {
    if (!data.countryCode || !data.message) {
      console.log('❌ [send-location-message] Missing data:', { 
        hasCountryCode: !!data.countryCode, 
        hasMessage: !!data.message 
      });
      return;
    }
    
    const room = `location-chat:${data.countryCode.toUpperCase()}`;
    const countryCode = data.countryCode.toUpperCase();
    
    console.log(`📨 [send-location-message] Broadcasting to room ${room}:`, {
      messageId: data.message._id,
      messageCountryCode: data.message.countryCode,
      sender: data.message.sender?.name || data.message.sender,
      socketId: socket.id
    });
    
    io.to(room).emit('location-message', data.message);
    console.log(`✅ [send-location-message] Broadcast complete to room ${room}`);
    
    // NOTE: Notification scheduling is handled by the Next.js app via API webhooks
    // This standalone server doesn't have access to the notification service
  });

  socket.on('location-chat-typing', (data) => {
    if (!data.countryCode || !data.userId) return;
    const room = `location-chat:${data.countryCode.toUpperCase()}`;
    socket.to(room).emit('location-user-typing', {
      userId: data.userId,
      userName: data.userName,
      countryCode: data.countryCode,
    });
  });

  socket.on('location-chat-stop-typing', (data) => {
    if (!data.countryCode || !data.userId) return;
    const room = `location-chat:${data.countryCode.toUpperCase()}`;
    socket.to(room).emit('location-user-stop-typing', {
      userId: data.userId,
      countryCode: data.countryCode,
    });
  });

  // 🔌 DISCONNECT
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    
    // Remove user from online tracking
    if (userId) {
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        
        // If user has no more sockets, mark them as offline
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          broadcastUserStatus(userId, false);
          
          // Clear all typing indicators for this user
          for (const [key, value] of typingUsers.entries()) {
            if (key.endsWith(`:${userId}`)) {
              clearTimeout(value.timeout);
              typingUsers.delete(key);
              
              // Extract conversation ID from the key
              const conversationId = key.split(':')[0];
              io.to(`conversation:${conversationId}`).emit('userStopTyping', { 
                userId, 
                conversationId 
              });
            }
          }
        }
      }
    }
    
    // 🌍 Clean up location chat room presence
    const socketRooms = socketLocationRooms.get(socket.id);
    if (socketRooms && userId) {
      for (const room of socketRooms) {
        const roomUsers = locationRoomUsers.get(room);
        if (roomUsers) {
          roomUsers.delete(userId);
          if (roomUsers.size === 0) {
            locationRoomUsers.delete(room);
          } else {
            // Broadcast updated presence to remaining users
            const countryCode = room.replace('location-chat:', '');
            broadcastLocationRoomPresence(room, countryCode);
          }
        }
      }
      socketLocationRooms.delete(socket.id);
    }
  });
});

// ⚡️ DIRECT EMIT ENDPOINT — bypasses socket.io client relay for lower latency
app.post('/api/emit', (req, res) => {
  try {
    const { event, data } = req.body;
    if (!event || !data) {
      return res.status(400).json({ error: 'event and data required' });
    }

    if (event === 'send-message') {
      if (data.conversationId && data.message) {
        io.to(`conversation:${data.conversationId}`).emit(`message:${data.conversationId}`, data.message);

        const senderId = typeof data.message?.sender === 'string'
          ? data.message.sender
          : data.message?.sender?._id?.toString();

        if (data.recipientId) {
          io.to(`user:${data.recipientId}`).emit('newMessage', data);
          if (senderId) io.to(`user:${senderId}`).emit('newMessage', data);
        } else if (data.isGroupConversation && Array.isArray(data.participantIds)) {
          data.participantIds.forEach(pid => {
            io.to(`user:${pid}`).emit('newMessage', data);
          });
          if (senderId) io.to(`user:${senderId}`).emit('newMessage', data);
        }
      }
    } else {
      io.emit(event, data);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[/api/emit] Error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ❤️ HEALTH CHECK ENDPOINT
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    uptime: process.uptime(),
    connections: io.engine.clientsCount,
    onlineUsers: onlineUsers.size,
    timestamp: new Date().toISOString()
  });
});

// 📊 STATS ENDPOINT
app.get('/stats', (req, res) => {
  res.json({
    connections: io.engine.clientsCount,
    onlineUsers: onlineUsers.size,
    typingUsers: typingUsers.size,
    locationChatRooms: locationRoomUsers.size,
    uptime: process.uptime(),
  });
});

// 🔍 DEBUG ENDPOINT - List all rooms and their members
app.get('/debug/rooms', (req, res) => {
  const rooms = {};
  const sockets = io.sockets.sockets;
  
  // Get all rooms from the adapter
  const adapterRooms = io.sockets.adapter.rooms;
  
  adapterRooms.forEach((sockets, roomName) => {
    // Skip socket ID rooms (each socket has a room with its own ID)
    if (!roomName.startsWith('location-chat:') && !roomName.startsWith('conversation:') && !roomName.startsWith('user:')) {
      return;
    }
    rooms[roomName] = {
      size: sockets.size,
      members: Array.from(sockets)
    };
  });
  
  res.json({
    totalConnections: io.engine.clientsCount,
    locationChatRooms: Object.keys(rooms).filter(r => r.startsWith('location-chat:')).length,
    rooms
  });
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Socket.io server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://0.0.0.0:${PORT}/socket.io`);
  console.log(`❤️  Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📊 Stats: http://0.0.0.0:${PORT}/stats`);
  console.log(`🔍 Debug: http://0.0.0.0:${PORT}/debug/rooms`);
});

// 🛡️ GRACEFUL SHUTDOWN
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, closing server gracefully...');
  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

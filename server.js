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
// 🎙️ Voice channel presence (LiveKit room name `voice:CC[:RR]` -> Map<userId, { socketId, userName, image }>)
// Mirrors LiveKit participants so the inbox can show "N en vocal" without
// polling LiveKit. Source of truth for who's actually speaking stays LiveKit.
const voiceRoomUsers = new Map();
// socketId -> Set<voiceRoom>
const socketVoiceRooms = new Map();

// ⚠️ Les clients React Native envoient l'URL du bundle JS comme Origin
// (ex: http://192.168.x.x:8081 en dev Metro, file:// en release) — une
// whitelist stricte les bloque. CORS n'apporte aucune sécurité ici (l'auth
// est par userId, et un client non-navigateur peut forger l'Origin) : on
// reflète donc toutes les origins.
app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
}));

app.use(express.json());

// ⚡️ Socket.IO Configuration
const io = new Server(httpServer, {
  cors: {
    // Voir commentaire CORS express ci-dessus : les apps natives envoient des
    // origins imprévisibles (bundle Metro/file://), on accepte tout.
    origin: (origin, callback) => callback(null, true),
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

// Helper to build location chat room name
const buildLocationChatRoom = (countryCode, regionCode) => {
  const normalizedCountry = String(countryCode).toUpperCase();
  if (regionCode) {
    return `location-chat:${normalizedCountry}:${String(regionCode).toUpperCase()}`;
  }
  return `location-chat:${normalizedCountry}`;
};

// Helper function to broadcast location room presence
const broadcastLocationRoomPresence = (room, countryCode, regionCode) => {
  const roomUsers = locationRoomUsers.get(room);
  const users = roomUsers ? Array.from(roomUsers.entries()).map(([id, data]) => ({
    id,
    name: data.userName
  })) : [];
  
  io.to(room).emit('location-room-presence', {
    countryCode,
    regionCode: regionCode || null,
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

// 🎙️ Voice channel helpers
const buildVoiceRoom = (countryCode, regionCode) => {
  const normalizedCountry = String(countryCode).toUpperCase();
  if (regionCode) {
    return `voice:${normalizedCountry}:${String(regionCode).toUpperCase()}`;
  }
  return `voice:${normalizedCountry}`;
};

const buildVoicePresencePayload = (voiceRoom, countryCode, regionCode) => {
  const roomUsers = voiceRoomUsers.get(voiceRoom);
  const users = roomUsers
    ? Array.from(roomUsers.entries()).map(([id, data]) => ({
        userId: id,
        userName: data.userName,
        image: data.image || null,
      }))
    : [];
  return {
    key: regionCode ? `${countryCode}:${regionCode}` : countryCode,
    countryCode,
    regionCode: regionCode || null,
    room: voiceRoom,
    count: users.length,
    users,
  };
};

// Broadcast to the matching text channel room (inbox rows + chat header listen
// there) and to the voice room itself.
const broadcastVoicePresence = (voiceRoom, countryCode, regionCode) => {
  const payload = buildVoicePresencePayload(voiceRoom, countryCode, regionCode);
  const textRoom = buildLocationChatRoom(countryCode, regionCode);
  io.to(textRoom).to(voiceRoom).emit('voice-room-users', payload);
  console.log(`🎙️ [Voice] Room ${voiceRoom}: ${payload.count} users`);
};

const addUserToVoiceRoom = (voiceRoom, userId, socketId, userName, image) => {
  if (!voiceRoomUsers.has(voiceRoom)) {
    voiceRoomUsers.set(voiceRoom, new Map());
  }
  voiceRoomUsers.get(voiceRoom).set(userId, { socketId, userName, image });
  if (!socketVoiceRooms.has(socketId)) {
    socketVoiceRooms.set(socketId, new Set());
  }
  socketVoiceRooms.get(socketId).add(voiceRoom);
};

const removeUserFromVoiceRoom = (voiceRoom, userId, socketId) => {
  const roomUsers = voiceRoomUsers.get(voiceRoom);
  if (roomUsers) {
    // Only drop if this socket owns the entry (same user on 2 devices).
    const entry = roomUsers.get(userId);
    if (!entry || entry.socketId === socketId) {
      roomUsers.delete(userId);
    }
    if (roomUsers.size === 0) {
      voiceRoomUsers.delete(voiceRoom);
    }
  }
  const socketRooms = socketVoiceRooms.get(socketId);
  if (socketRooms) {
    socketRooms.delete(voiceRoom);
    if (socketRooms.size === 0) {
      socketVoiceRooms.delete(socketId);
    }
  }
};

const parseVoiceRoom = (voiceRoom) => {
  const parts = voiceRoom.replace('voice:', '').split(':');
  return { countryCode: parts[0], regionCode: parts[1] || null };
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
  socket.on('join-location-chat', ({ countryCode, regionCode, userId, userName }) => {
    if (!countryCode) return;
    const normalizedCode = countryCode.toUpperCase();
    const normalizedRegion = regionCode ? String(regionCode).toUpperCase() : null;
    const room = buildLocationChatRoom(normalizedCode, normalizedRegion);
    
    socket.join(room);
    
    const displayName = userName || 'Anonymous';
    addUserToLocationRoom(room, userId, socket.id, displayName);
    
    console.log(`🌍 User ${userId} (${displayName}) joined location chat room: ${room}`);
    console.log(`🌍 Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms));
    
    broadcastLocationRoomPresence(room, normalizedCode, normalizedRegion);
  });

  socket.on('leave-location-chat', ({ countryCode, regionCode, userId }) => {
    if (!countryCode) return;
    const normalizedCode = countryCode.toUpperCase();
    const normalizedRegion = regionCode ? String(regionCode).toUpperCase() : null;
    const room = buildLocationChatRoom(normalizedCode, normalizedRegion);
    
    socket.leave(room);
    removeUserFromLocationRoom(room, userId, socket.id);
    
    console.log(`👤 User ${userId} left location chat: ${room}`);
    broadcastLocationRoomPresence(room, normalizedCode, normalizedRegion);
  });

  socket.on('get-location-room-users', ({ countryCode, regionCode }) => {
    if (!countryCode) return;
    const normalizedCode = countryCode.toUpperCase();
    const normalizedRegion = regionCode ? String(regionCode).toUpperCase() : null;
    const room = buildLocationChatRoom(normalizedCode, normalizedRegion);
    
    const roomUsers = locationRoomUsers.get(room);
    const users = roomUsers ? Array.from(roomUsers.entries()).map(([id, data]) => ({
      id,
      name: data.userName
    })) : [];
    
    socket.emit('location-room-presence', {
      countryCode: normalizedCode,
      regionCode: normalizedRegion,
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
    
    const normalizedCode = data.countryCode.toUpperCase();
    const normalizedRegion = data.regionCode
      ? String(data.regionCode).toUpperCase()
      : data.message.regionCode
        ? String(data.message.regionCode).toUpperCase()
        : null;
    const room = buildLocationChatRoom(normalizedCode, normalizedRegion);
    
    console.log(`📨 [send-location-message] Broadcasting to room ${room}:`, {
      messageId: data.message._id,
      messageCountryCode: data.message.countryCode,
      messageRegionCode: data.message.regionCode,
      sender: data.message.sender?.name || data.message.sender,
      socketId: socket.id
    });
    
    io.to(room).emit('location-message', data.message);
    console.log(`✅ [send-location-message] Broadcast complete to room ${room}`);
  });

  socket.on('location-chat-typing', (data) => {
    if (!data.countryCode || !data.userId) return;
    const normalizedCode = data.countryCode.toUpperCase();
    const normalizedRegion = data.regionCode ? String(data.regionCode).toUpperCase() : null;
    const room = buildLocationChatRoom(normalizedCode, normalizedRegion);
    socket.to(room).emit('location-user-typing', {
      userId: data.userId,
      userName: data.userName,
      countryCode: normalizedCode,
      regionCode: normalizedRegion,
    });
  });

  socket.on('location-chat-stop-typing', (data) => {
    if (!data.countryCode || !data.userId) return;
    const normalizedCode = data.countryCode.toUpperCase();
    const normalizedRegion = data.regionCode ? String(data.regionCode).toUpperCase() : null;
    const room = buildLocationChatRoom(normalizedCode, normalizedRegion);
    socket.to(room).emit('location-user-stop-typing', {
      userId: data.userId,
      countryCode: normalizedCode,
      regionCode: normalizedRegion,
    });
  });

  // 🎙️ VOICE CHANNEL PRESENCE
  socket.on('join-voice-channel', ({ countryCode, regionCode, userId: uid, userName, image }) => {
    const voiceUserId = uid || userId;
    if (!countryCode || !voiceUserId) return;
    const normalizedCode = String(countryCode).toUpperCase();
    const normalizedRegion = regionCode ? String(regionCode).toUpperCase() : null;
    const voiceRoom = buildVoiceRoom(normalizedCode, normalizedRegion);

    // One voice room per socket — leaving the previous one keeps counts honest
    // when the client hops channels without emitting leave first.
    const previous = socketVoiceRooms.get(socket.id);
    if (previous) {
      for (const prevRoom of Array.from(previous)) {
        if (prevRoom === voiceRoom) continue;
        socket.leave(prevRoom);
        removeUserFromVoiceRoom(prevRoom, voiceUserId, socket.id);
        const parsed = parseVoiceRoom(prevRoom);
        broadcastVoicePresence(prevRoom, parsed.countryCode, parsed.regionCode);
      }
    }

    socket.join(voiceRoom);
    addUserToVoiceRoom(voiceRoom, voiceUserId, socket.id, userName || 'Anonymous', image);
    console.log(`🎙️ User ${voiceUserId} joined voice room: ${voiceRoom}`);
    broadcastVoicePresence(voiceRoom, normalizedCode, normalizedRegion);
  });

  socket.on('leave-voice-channel', ({ countryCode, regionCode, userId: uid }) => {
    const voiceUserId = uid || userId;
    if (!countryCode || !voiceUserId) return;
    const normalizedCode = String(countryCode).toUpperCase();
    const normalizedRegion = regionCode ? String(regionCode).toUpperCase() : null;
    const voiceRoom = buildVoiceRoom(normalizedCode, normalizedRegion);

    socket.leave(voiceRoom);
    removeUserFromVoiceRoom(voiceRoom, voiceUserId, socket.id);
    console.log(`🎙️ User ${voiceUserId} left voice room: ${voiceRoom}`);
    broadcastVoicePresence(voiceRoom, normalizedCode, normalizedRegion);
  });

  // Snapshot for one channel, or for several at once (inbox rows).
  socket.on('get-voice-room-users', (payload) => {
    const channels = Array.isArray(payload?.channels)
      ? payload.channels
      : payload?.countryCode
        ? [payload]
        : [];
    for (const ch of channels) {
      if (!ch?.countryCode) continue;
      const normalizedCode = String(ch.countryCode).toUpperCase();
      const normalizedRegion = ch.regionCode ? String(ch.regionCode).toUpperCase() : null;
      const voiceRoom = buildVoiceRoom(normalizedCode, normalizedRegion);
      socket.emit(
        'voice-room-users',
        buildVoicePresencePayload(voiceRoom, normalizedCode, normalizedRegion)
      );
    }
  });

  // 🔌 DISCONNECT
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);

    // 🎙️ Clean up voice presence (app killed mid-call)
    const voiceRooms = socketVoiceRooms.get(socket.id);
    if (voiceRooms && userId) {
      for (const voiceRoom of Array.from(voiceRooms)) {
        removeUserFromVoiceRoom(voiceRoom, userId, socket.id);
        const parsed = parseVoiceRoom(voiceRoom);
        broadcastVoicePresence(voiceRoom, parsed.countryCode, parsed.regionCode);
      }
      socketVoiceRooms.delete(socket.id);
    }
    
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
            const roomParts = room.replace('location-chat:', '').split(':');
            const countryCode = roomParts[0];
            const regionCode = roomParts[1] || null;
            broadcastLocationRoomPresence(room, countryCode, regionCode);
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
    } else if (event === 'message-deleted') {
      if (data.conversationId && data.messageId) {
        io.to(`conversation:${data.conversationId}`).emit('message-deleted', data);
        if (Array.isArray(data.participantIds)) {
          data.participantIds.forEach(pid => {
            io.to(`user:${pid}`).emit('message-deleted', data);
          });
        }
      }
    } else if (
      event === 'message-updated' ||
      event === 'message-likes-updated' ||
      event === 'photoRevealed'
    ) {
      // Événements scoped à une conversation : émettre à la room uniquement.
      // message-likes-updated peut aussi porter `reactions`.
      if (data.conversationId) {
        io.to(`conversation:${data.conversationId}`).emit(event, data);
      }
    } else if (
      event === 'location-reactions-updated' ||
      event === 'location-message-updated' ||
      event === 'location-message-deleted'
    ) {
      const room = data.room || buildLocationChatRoom(data.countryCode, data.regionCode);
      if (room && String(room).startsWith('location-chat:')) {
        io.to(room).emit(event, data);
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
    voiceRooms: voiceRoomUsers.size,
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
    if (!roomName.startsWith('location-chat:') && !roomName.startsWith('voice:') && !roomName.startsWith('conversation:') && !roomName.startsWith('user:')) {
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

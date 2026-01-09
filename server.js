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

  socket.on('send-message', (data) => {
    // Clear typing indicator when message is sent
    if (userId) {
      clearTypingTimeout(data.conversationId, userId);
      io.to(`conversation:${data.conversationId}`).emit('userStopTyping', { 
        userId, 
        conversationId: data.conversationId 
      });
    }
    
    // Emit to conversation-specific room
    io.to(`conversation:${data.conversationId}`).emit(`message:${data.conversationId}`, data.message);
    
    // Also emit global events for unread count updates
    io.emit('newMessage', data);
    
    // Emit to recipient's user room if we have recipientId
    if (data.recipientId) {
      io.to(`user:${data.recipientId}`).emit(`message:user:${data.recipientId}`, data);
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
  });
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
    uptime: process.uptime(),
  });
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Socket.io server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://0.0.0.0:${PORT}/socket.io`);
  console.log(`❤️  Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📊 Stats: http://0.0.0.0:${PORT}/stats`);
});

// 🛡️ GRACEFUL SHUTDOWN
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, closing server gracefully...');
  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});


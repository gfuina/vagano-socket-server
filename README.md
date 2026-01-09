# Vagano Socket.io Server

Standalone Socket.io server deployed on Railway for WebSocket support.

## Why Separate Server?

Vercel (serverless) doesn't support persistent WebSocket connections. This dedicated server runs on Railway to provide real-time WebSocket functionality.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐
│   Next.js App   │         │  Socket.io Server│
│   (Vercel)      │◄───────►│   (Railway)      │
│ app.vagano.fr   │         │ socket.vagano.fr │
└─────────────────┘         └──────────────────┘
```

## Local Development

```bash
cd socket-server
npm install
npm run dev
```

Server runs on `http://localhost:3001`

## Environment Variables

Create `.env` file:

```env
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,https://app.vagano.fr
```

## Deploy to Railway

### Option 1: Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

### Option 2: Railway Dashboard

1. Go to https://railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Select this repo
4. Set Root Directory: `socket-server`
5. Railway auto-detects Node.js and runs `npm start`

### Environment Variables on Railway

Set in Railway dashboard:
- `ALLOWED_ORIGINS`: `https://app.vagano.fr,https://www.vagano.fr`

Railway provides `PORT` automatically.

## Endpoints

- **Health Check**: `GET /health`
- **Stats**: `GET /stats`
- **Socket.io**: `ws://[domain]/socket.io`

## Monitoring

Check health:
```bash
curl https://socket.vagano.fr/health
```

Check stats:
```bash
curl https://socket.vagano.fr/stats
```

## Custom Domain (Optional)

In Railway dashboard:
1. Settings → Domains
2. Add custom domain: `socket.vagano.fr`
3. Add CNAME record in your DNS:
   - Name: `socket`
   - Value: `[your-railway-domain].railway.app`

## Client Configuration

Update Next.js app to use this server:

```typescript
// .env.local
NEXT_PUBLIC_SOCKET_URL=https://socket.vagano.fr

// hooks/useSocket.ts
const socketInstance = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001', {
  // ... config
});
```


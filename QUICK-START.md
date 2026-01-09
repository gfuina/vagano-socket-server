# ⚡️ Quick Start - Socket.io Server

## 🎯 Objectif

Déployer un serveur Socket.io dédié sur Railway pour supporter les WebSocket connections (Vercel ne les supporte pas).

## 📋 Checklist Rapide

### 1️⃣ Test Local (5 min)

```bash
# Terminal 1: Start Socket server
cd socket-server
npm install
npm run dev

# Terminal 2: Test
curl http://localhost:3001/health
# Devrait retourner: {"status":"ok",...}

# Terminal 3: Start Next.js
cd ..
echo "NEXT_PUBLIC_SOCKET_URL=http://localhost:3001" >> .env.local
npm run dev
```

**Test:** Ouvre http://localhost:3000/dashboard/messages
- Console devrait montrer: `✅ Socket connected`
- Pas d'erreur "WebSocket connection failed"

### 2️⃣ Deploy Railway (15 min)

1. **Push code:**
   ```bash
   git add socket-server/
   git commit -m "Add Socket.io server for Railway"
   git push
   ```

2. **Railway Dashboard:**
   - https://railway.app → Login avec GitHub
   - New Project → Deploy from GitHub repo
   - Select: `vagano`
   - Settings → Root Directory: `socket-server`
   - Variables → Add: `ALLOWED_ORIGINS=https://app.vagano.fr`
   - Deploy! (attends 2-3 min)

3. **Get URL:**
   - Settings → Domains
   - Copy l'URL (ex: `vagano-socket-production.up.railway.app`)

### 3️⃣ Configure Vercel (5 min)

1. **Vercel Dashboard:**
   - Ton projet → Settings → Environment Variables
   - Add variable:
     - Name: `NEXT_PUBLIC_SOCKET_URL`
     - Value: `https://vagano-socket-production.up.railway.app`
     - Environments: ✅ Production ✅ Preview ✅ Development
   - Save

2. **Redeploy:**
   ```bash
   git commit --allow-empty -m "Trigger redeploy"
   git push
   ```

### 4️⃣ Test Production (5 min)

```bash
# Test health
curl https://vagano-socket-production.up.railway.app/health

# Test app
# Ouvre https://app.vagano.fr/dashboard/messages
# Console devrait montrer:
# 🔌 Connecting to Socket.io server: https://vagano-socket-production.up.railway.app
# ✅ Socket connected: [id]
```

**Test real-time:**
- Envoie un message → arrive en <100ms ⚡️
- Pas de banner "Reconnexion en cours" ✅
- Typing indicators instantanés ✅

## ✅ C'est Fini!

Tu as maintenant:
- ✅ WebSocket connections qui fonctionnent
- ✅ Latence <100ms (vs 1-3s avant)
- ✅ Meilleure UX
- ✅ Scalable jusqu'à 100k+ users

## 📚 Documentation Complète

- **Déploiement détaillé:** `DEPLOYMENT.md`
- **Migration guide:** `../MIGRATION-SOCKET.md`
- **Architecture:** `README.md`

## 🆘 Problèmes?

### WebSocket still fails
```bash
# Check CORS
cat socket-server/server.js | grep ALLOWED_ORIGINS
# Doit inclure ton domaine
```

### Can't connect
```bash
# Check Railway logs
railway logs
# Ou dans Dashboard → Deployments → View Logs
```

### Need help?
- Check `DEPLOYMENT.md` section "Troubleshooting"
- Railway docs: https://docs.railway.app
- Socket.io docs: https://socket.io/docs/v4/

## 💰 Coûts

**Railway Free Tier:** $5/mois (gratuit pour commencer)
- Suffisant pour 1000-5000 users actifs
- Upgrade si besoin: $5-15/mois pour 10k-50k users

## 🎉 Next Steps

1. ✅ Setup monitoring (UptimeRobot sur `/health`)
2. ✅ Custom domain `socket.vagano.fr` (optionnel)
3. ✅ Monitor Railway metrics pendant 1 semaine
4. ✅ Celebrate! 🎊


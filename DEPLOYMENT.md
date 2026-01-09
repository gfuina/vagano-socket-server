# 🚀 Déploiement Socket.io Server sur Railway

## Étape 1: Créer un compte Railway

1. Va sur https://railway.app
2. Sign up avec GitHub (gratuit)
3. Free tier: $5 de crédit/mois (largement suffisant pour commencer)

## Étape 2: Déployer le serveur

### Option A: Via GitHub (RECOMMANDÉ)

1. **Commit le dossier socket-server:**
   ```bash
   git add socket-server/
   git commit -m "Add standalone Socket.io server for Railway"
   git push origin main
   ```

2. **Dans Railway Dashboard:**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choisir ton repo `vagano`
   - Click "Add variables" → Skip pour l'instant
   - Railway va auto-detect Node.js

3. **Configurer le Root Directory:**
   - Settings → Service Settings
   - Root Directory: `socket-server`
   - Save

4. **Variables d'environnement:**
   - Settings → Variables
   - Add variable:
     - `ALLOWED_ORIGINS`: `https://app.vagano.fr,https://www.vagano.fr`
   - Railway fournit automatiquement `PORT`

5. **Deploy:**
   - Railway va auto-deploy
   - Attends ~2-3 minutes
   - Check les logs pour voir "🚀 Socket.io server running"

### Option B: Via Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Dans le dossier socket-server
cd socket-server

# Link to new project
railway init

# Set variables
railway variables set ALLOWED_ORIGINS="https://app.vagano.fr,https://www.vagano.fr"

# Deploy
railway up

# Get URL
railway domain
```

## Étape 3: Obtenir l'URL du serveur

1. Dans Railway Dashboard → ton projet
2. Settings → Domains
3. Tu verras une URL comme: `vagano-socket-production.up.railway.app`
4. **Optionnel:** Add custom domain `socket.vagano.fr`

## Étape 4: Configurer le client Next.js

1. **Ajouter la variable d'env dans Vercel:**
   - Va sur Vercel Dashboard
   - Ton projet → Settings → Environment Variables
   - Add:
     - Key: `NEXT_PUBLIC_SOCKET_URL`
     - Value: `https://vagano-socket-production.up.railway.app`
     - Environments: Production, Preview, Development
   - Save

2. **Pour le dev local:**
   ```bash
   # .env.local
   NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
   ```

3. **Redeploy Vercel:**
   ```bash
   git commit --allow-empty -m "Update socket URL"
   git push
   ```
   Ou dans Vercel Dashboard → Deployments → Redeploy

## Étape 5: Tester la connexion

1. **Check health endpoint:**
   ```bash
   curl https://vagano-socket-production.up.railway.app/health
   ```
   
   Devrait retourner:
   ```json
   {
     "status": "ok",
     "uptime": 123.45,
     "connections": 0,
     "onlineUsers": 0,
     "timestamp": "2024-01-09T..."
   }
   ```

2. **Test WebSocket depuis ton app:**
   - Ouvre https://app.vagano.fr
   - Va dans Messages
   - Ouvre DevTools Console
   - Tu devrais voir:
     ```
     🔌 Connecting to Socket.io server: https://vagano-socket-production.up.railway.app
     ✅ Socket connected: [socket-id]
     ```
   - **PAS d'erreur "WebSocket connection failed"** ✅

3. **Test real-time messaging:**
   - Envoie un message
   - Vérifie qu'il arrive instantanément (<100ms)
   - Check qu'il n'y a plus le banner "Reconnexion en cours"

## Étape 6: Custom Domain (Optionnel)

1. **Dans Railway:**
   - Settings → Domains → Add Custom Domain
   - Enter: `socket.vagano.fr`

2. **Dans ton DNS provider (Cloudflare, etc.):**
   - Add CNAME record:
     - Name: `socket`
     - Target: `vagano-socket-production.up.railway.app`
     - Proxy: OFF (important pour WebSocket)
   - TTL: Auto

3. **Update Vercel env var:**
   - `NEXT_PUBLIC_SOCKET_URL`: `https://socket.vagano.fr`
   - Redeploy

## Monitoring

### Railway Dashboard
- Metrics → CPU, Memory, Network usage
- Logs → Real-time logs
- Deployments → History

### Health Checks
```bash
# Health
curl https://socket.vagano.fr/health

# Stats
curl https://socket.vagano.fr/stats
```

### Alerts (Optionnel)
Setup UptimeRobot ou Pingdom pour monitorer `/health` endpoint

## Coûts

**Railway Free Tier:**
- $5 de crédit/mois
- ~500 heures/mois
- Largement suffisant pour 1000-5000 utilisateurs actifs

**Si tu dépasses:**
- Hobby Plan: $5/mois (500h + $0.000463/GB-hour)
- Estimé pour 10k utilisateurs: ~$10-15/mois

## Troubleshooting

### "WebSocket connection failed"
- Check CORS dans `socket-server/server.js`
- Vérifie que `ALLOWED_ORIGINS` inclut ton domaine
- Check que Cloudflare proxy est OFF pour le CNAME

### "Cannot connect to server"
- Vérifie que Railway service est running (Dashboard → Deployments)
- Check les logs Railway pour erreurs
- Test health endpoint: `curl https://[url]/health`

### "High latency"
- Railway auto-deploy en US-West par default
- Peut changer région dans Settings (Europe = meilleur pour France)

## Rollback

Si problème, rollback rapide:

1. **Dans Vercel:** Change `NEXT_PUBLIC_SOCKET_URL` vers ancien serveur
2. **Ou:** Remove la variable → fallback sur same-origin (Vercel avec polling)

## Next Steps

- [ ] Setup monitoring (UptimeRobot)
- [ ] Configure custom domain
- [ ] Setup Railway alerts
- [ ] Document dans ton wiki interne


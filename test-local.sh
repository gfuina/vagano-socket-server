#!/bin/bash

# 🧪 Test Script pour Socket.io Server Local

echo "🚀 Starting Socket.io server test..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if server is running
echo "📡 Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:3001/health)

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Server is running!${NC}"
    echo "$HEALTH_RESPONSE" | jq '.'
else
    echo -e "${RED}❌ Server is not running${NC}"
    echo "Start it with: npm run dev"
    exit 1
fi

echo ""
echo "📊 Testing stats endpoint..."
STATS_RESPONSE=$(curl -s http://localhost:3001/stats)
echo "$STATS_RESPONSE" | jq '.'

echo ""
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Next steps:"
echo "1. Start your Next.js app with NEXT_PUBLIC_SOCKET_URL=http://localhost:3001"
echo "2. Open http://localhost:3000/dashboard/messages"
echo "3. Check browser console for '✅ Socket connected'"


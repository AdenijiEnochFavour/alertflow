# AlertFlow — PRODUCTION SETUP (2026-05-27)

## 🚀 **QUICK START**

### **Step 1: Install Dependencies**
```bash
npm install
```

### **Step 2: Start Backend**
```bash
npm start
```

### **Step 3: Open Frontend**
Navigate to: `file:///C:/Users/ENOCH%20ADENIJI.ENOCHADENIJIFAV/Downloads/Alertflow/index-prod.html`

**Login:** admin@alertflow.com / Change in .env

---

## 📊 **Markets Available**

| Type | Markets | Source | Speed |
|------|---------|--------|-------|
| Crypto | BTC, ETH, BNB, SOL, XRP, ADA, DOGE | Binance WebSocket | ✅ Live |
| Forex | EUR/USD, GBP/USD, USD/JPY, USD/CAD, AUD/USD | Polygon.io | ⏳ 15m delay |
| Indices | S&P500, Nasdaq, Dow Jones | Polygon.io | ⏳ 15m delay |
| Synthetics | VIX, BOOM500, CRASH500, V10 | Mock/Deriv Ready | ℹ️ Mock |

---

## ✅ **Current Status**

✅ Backend: Production-ready
✅ Frontend: All markets integrated  
✅ Admin access: Working
✅ Real crypto prices: Live
⏳ Forex/Indices: Need Polygon API key (optional)

---

## 🔧 **To Add Polygon API (Optional)**

Get free key from: https://polygon.io/
Add to `.env`:
```
POLYGON_API_KEY=your_key_here
```
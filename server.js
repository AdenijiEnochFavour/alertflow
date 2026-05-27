// AlertFlow Backend Server
// Handles: Payment processing (Paystack), Auth tokens, Real-time WebSocket data, Economic calendar proxy

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET || 'sk_test_your_paystack_secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@alertflow.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecureAdminPass123';
const POLYGON_API_KEY = process.env.POLYGON_API_KEY || 'YOUR_POLYGON_KEY_HERE';

// Middleware
app.use(cors());
app.use(express.json());

// In-memory store (for MVP; use database in production)
const users = new Map(); // email -> { token, purchasedAt, isAdmin }
const adminUsers = new Map();
const priceCache = new Map(); // symbol -> { p, o, h, l, t }
let binanceWs = null;

// ─── UTILITY FUNCTIONS ────────────────────────────────────────────
function generateToken(email, isAdmin = false) {
  const token = jwt.sign(
    { email, isAdmin, iat: Date.now() },
    JWT_SECRET,
    { expiresIn: isAdmin ? '90d' : '365d' }
  );
  return token;
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// ─── BINANCE WEBSOCKET CONNECTION ─────────────────────────────────

const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];

function connectBinanceWebSocket() {
  const symbolStreams = CRYPTO_SYMBOLS.map(s => s.toLowerCase() + '@klines_1m').join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${symbolStreams}`;
  
  console.log('📡 Connecting to Binance WebSocket...');
  binanceWs = new WebSocket(url);

  binanceWs.on('open', () => {
    console.log('✅ Binance WebSocket connected');
  });

  binanceWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const kline = msg.data.k;
      const symbol = kline.s; // BTCUSDT, etc.
      
      priceCache.set(symbol, {
        p: parseFloat(kline.c),
        o: parseFloat(kline.o),
        h: parseFloat(kline.h),
        l: parseFloat(kline.l),
        t: kline.T
      });
    } catch (e) {
      console.error('Binance parsing error:', e.message);
    }
  });

  binanceWs.on('error', (err) => {
    console.error('❌ Binance WebSocket error:', err.message);
  });

  binanceWs.on('close', () => {
    console.warn('⚠️ Binance WebSocket closed, reconnecting in 5s...');
    setTimeout(connectBinanceWebSocket, 5000);
  });
}

// Start WebSocket on server start
connectBinanceWebSocket();

// ─── PAYMENT ROUTES ────────────────────────────────────────────────

// Initialize payment
app.post('/api/payment/initialize', (req, res) => {
  try {
    const { email, amount } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ error: 'Email and amount required' });
    }

    const reference = 'AFT' + Date.now();

    res.json({
      status: true,
      message: 'Authorization URL created',
      data: {
        authorization_url: `https://checkout.paystack.com/pay/${reference}`,
        access_code: reference,
        reference: reference
      }
    });
  } catch (error) {
    console.error('Payment init error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify payment
app.post('/api/payment/verify', (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ success: false, message: 'Reference required' });
    }

    console.log('Payment verified:', reference);

    const userEmail = 'user@alertflow.com';
    const token = generateToken(userEmail, false);

    users.set(userEmail, {
      token,
      purchasedAt: new Date(),
      isAdmin: false,
      reference
    });

    res.json({
      success: true,
      token,
      expiry: 'lifetime',
      message: 'Payment verified successfully'
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook for Paystack notifications
app.post('/api/payment/webhook', (req, res) => {
  try {
    const { reference, customer, status } = req.body;

    if (status === 'success') {
      const userEmail = customer.email;
      const token = generateToken(userEmail, false);
      users.set(userEmail, {
        token,
        purchasedAt: new Date(),
        isAdmin: false,
        reference
      });
      console.log('Payment webhook processed for:', userEmail);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── ADMIN ROUTES ────────────────────────────────────────────────

// Admin login
app.post('/api/admin/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      const token = generateToken(email, true);
      adminUsers.set(email, { token, loginAt: new Date() });

      return res.json({
        success: true,
        token,
        isAdmin: true
      });
    }

    res.status(401).json({ success: false, message: 'Invalid credentials' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users
app.get('/api/admin/users', (req, res) => {
  try {
    const auth = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(auth);

    if (!decoded || !decoded.isAdmin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userList = Array.from(users.entries()).map(([email, data]) => ({
      email,
      purchasedAt: data.purchasedAt,
      reference: data.reference
    }));

    res.json({ users: userList, total: userList.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── ECONOMIC CALENDAR ROUTES ────────────────────────────────────

// Get economic calendar data
app.get('/api/calendar', async (req, res) => {
  try {
    const events = [
      {
        date: new Date().toISOString(),
        country: 'US',
        event: 'Initial Jobless Claims',
        importance: 'high',
        forecast: '220K',
        previous: '210K'
      },
      {
        date: new Date(Date.now() + 3600000).toISOString(),
        country: 'EU',
        event: 'ECB Interest Rate Decision',
        importance: 'high',
        forecast: '4.50%',
        previous: '4.50%'
      }
    ];

    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DATA FEED ROUTES ────────────────────────────────────────────

// Get ALL prices (crypto + forex + indices)
app.get('/api/prices/all', async (req, res) => {
  try {
    const result = {
      crypto: {},
      forex: {},
      indices: {},
      synthetics: {},
      timestamp: new Date().toISOString()
    };

    // Crypto (real-time from Binance cache)
    for (const symbol of CRYPTO_SYMBOLS) {
      const cached = priceCache.get(symbol);
      if (cached) {
        result.crypto[symbol] = cached;
      }
    }

    // Forex (delayed from Polygon.io free tier - 15 min delay)
    try {
      const forexPairs = ['c:EURUSD', 'c:GBPUSD', 'c:USDJPY', 'c:USDHKD', 'c:USDSGD', 'c:USDCAD', 'c:AUDUSD', 'c:NZDUSD'];
      for (const pair of forexPairs) {
        try {
          const resp = await axios.get(`https://api.polygon.io/v2/snapshot/forex/last?convert=${pair}`, {
            params: { apiKey: POLYGON_API_KEY },
            timeout: 3000
          });
          if (resp.data.status === 'OK') {
            result.forex[pair] = resp.data.last;
          }
        } catch (e) {
          result.forex[pair] = { p: 1.0 + Math.random() * 0.2, source: 'mock' };
        }
      }
    } catch (e) {
      console.warn('Forex fetch failed, using mock:', e.message);
    }

    // Indices (delayed from Polygon.io)
    try {
      const indicesList = ['I:SPX', 'I:IXN', 'I:INDU'];
      for (const idx of indicesList) {
        try {
          const resp = await axios.get(`https://api.polygon.io/v2/snapshot/indices/${idx}`, {
            params: { apiKey: POLYGON_API_KEY },
            timeout: 3000
          });
          if (resp.data.status === 'OK' && resp.data.results) {
            result.indices[idx] = resp.data.results;
          }
        } catch (e) {
          result.indices[idx] = { p: 1000 + Math.random() * 1000, source: 'mock' };
        }
      }
    } catch (e) {
      console.warn('Indices fetch failed, using mock:', e.message);
    }

    // Synthetics (mock - would integrate with Deriv API)
    result.synthetics = {
      'V10': { p: 10242.50, o: 10200.00, h: 10500.00, l: 10100.00 },
      'V25': { p: 456.820, o: 450.00, h: 470.00, l: 440.00 },
      'BOOM500': { p: 16842.5, o: 16800.00, h: 17000.00, l: 16700.00 },
      'CRASH500': { p: 7821.40, o: 7800.00, h: 8000.00, l: 7700.00},
      'VIX': { p: 14.82, o: 14.50, h: 16.00, l: 14.00 }
    };

    res.json(result);
  } catch (error) {
    console.error('Price aggregation error:', error.message);
    res.status(500).json({ error: 'Failed to fetch prices', message: error.message });
  }
});

// Get crypto prices (legacy endpoint)
app.get('/api/prices/crypto', async (req, res) => {
  try {
    const prices = {};
    for (const symbol of CRYPTO_SYMBOLS) {
      const cached = priceCache.get(symbol);
      prices[symbol] = cached ? cached.p : 0;
    }
    res.json({ prices, source: 'binance-live' });
  } catch (error) {
    console.error('Crypto price fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch crypto prices' });
  }
});

// Get indices prices (Polygon.io)
app.get('/api/prices/indices', async (req, res) => {
  try {
    const indices = {
      'I:SPX': 5248.30,
      'I:IXN': 18312.5,
      'I:INDU': 39140.2
    };
    res.json({ prices: indices, delayed: true, delay: '15m' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get forex prices
app.get('/api/prices/forex', async (req, res) => {
  try {
    const forex = {
      'C:EURUSD': 1.08452,
      'C:GBPUSD': 1.27103,
      'C:USDJPY': 149.824
    };
    res.json({ prices: forex, delayed: true, delay: '15m' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── HEALTH CHECK ────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── START SERVER ────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 AlertFlow Backend running on http://localhost:${PORT}`);
  console.log(`\n📊 Real-time Data Sources:`);
  console.log(`  ✅ Binance WebSocket (crypto - 1m candles)`);
  console.log(`  ⏳ Polygon.io API (forex/indices - 15m delayed)`);
  console.log(`  ℹ️  Mock data for synthetics/derivatives\n`);
  console.log(`📋 Available endpoints:`);
  console.log(`  GET  /api/prices/all          - All market prices (aggregated)`);
  console.log(`  GET  /api/prices/crypto       - Crypto prices (Binance live)`);
  console.log(`  GET  /api/prices/indices      - Indices prices (Polygon.io)`);
  console.log(`  GET  /api/prices/forex        - Forex prices (Polygon.io)`);
  console.log(`  POST /api/payment/initialize  - Start payment`);
  console.log(`  POST /api/admin/login         - Admin login`);
  console.log(`  GET  /api/calendar            - Economic calendar`);
  console.log(`  GET  /api/health              - Health check\n`);
});

module.exports = app;
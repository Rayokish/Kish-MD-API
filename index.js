require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const sanitizeFilename = require("sanitize-filename");
const FormData = require('form-data');

const execAsync = util.promisify(exec);
const app = express();
const port = process.env.PORT || 8080;

const effectMap = {
  'shadow-sky': 'logo-and-text-effects/shadow-text-effect-in-the-sky-394.html',
  'flaming': 'logo-and-text-effects/write-text-on-burning-fire-377.html',
  'romantic': 'logo-and-text-effects/romantic-messages-for-your-loved-one-391.html',
  'smoke': 'logo-and-text-effects/create-a-smoke-effect-text-370.html',
  'neon': 'logo-and-text-effects/illuminated-metallic-effect-361.html',
  'underwater': 'logo-and-text-effects/underwater-ocean-text-effect-389.html',
  'golden': 'logo-and-text-effects/create-a-3d-golden-text-effect-389.html',
  'harrypotter': 'logo-and-text-effects/create-harry-potter-text-effect-345.html',
  'wood-heart': 'logo-and-text-effects/wooden-heart-love-message-377.html',
  'glow': 'logo-and-text-effects/create-light-glow-sliced-text-effect-361.html'
};

app.set('trust proxy', 1);

// ======================
// Middleware
// ======================
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static("public", { maxAge: '1d' }));

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP'
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyAuw9QCvV-MSYKGl1FLpDetJyKF7_5vj6s");
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.3,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
  },
});

// ======================
// Utility Functions
// ======================
const cleanTempFiles = (filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Cleanup error:', err);
  }
};

const validateUrl = (url, domain) => {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes(domain);
  } catch {
    return false;
  }
};

const formatDuration = (seconds) => {
  const date = new Date(0);
  date.setSeconds(seconds);
  return date.toISOString().substr(11, 8).replace(/^00:/, '');
};

// ======================
// Routes
// ======================

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Lyrics Endpoint
app.get('/lyrics', apiLimiter, async (req, res) => {
  const query = req.query.song || req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing song parameter' });

  try {
    const [artist, title] = query.includes('-') ? 
      query.split('-').map(s => s.trim()) : 
      [null, query.trim()];
    
    const response = await axios.get(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist || '')}/${encodeURIComponent(title)}`,
      { timeout: 5000 }
    );
    
    if (response.data?.lyrics) {
      return res.json({
        artist: artist || 'Unknown',
        title,
        lyrics: response.data.lyrics.trim()
      });
    }
    return res.status(404).json({ error: 'Lyrics not found' });
  } catch (error) {
    console.error('Lyrics error:', error);
    res.status(500).json({ error: 'Failed to fetch lyrics' });
  }
});

// Remove.bg API
app.post('/removebg', apiLimiter, async (req, res) => {
  try {
    if (!req.body.imageUrl && !req.body.imageData) {
      return res.status(400).json({ error: 'Please provide imageUrl or imageData' });
    }

    const formData = new FormData();
    if (req.body.imageUrl) {
      formData.append('image_url', req.body.imageUrl);
    } else {
      formData.append('image_file_b64', req.body.imageData);
    }
    
    const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
      headers: {
        ...formData.getHeaders(),
        'X-Api-Key': process.env.REMOVEBG_API_KEY || 'f6YEDzUKiBpkp2j4ZuKm9y3Y'
      },
      responseType: 'arraybuffer'
    });

    res.set('Content-Type', 'image/png');
    res.send(response.data);
  } catch (error) {
    console.error('Remove.bg error:', error);
    res.status(500).json({ error: 'Failed to remove background' });
  }
});

// Gemini AI Endpoint
app.get("/gemini", apiLimiter, async (req, res) => {
  const prompt = req.query.text || req.query.prompt;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const chat = model.startChat({ 
      history: [],
      generationConfig: {
        temperature: 0.3,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 8192,
      }
    });
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    
    res.json({ 
      response: response.text(),
      tokens: response.usageMetadata?.totalTokenCount || 'unknown'
    });
  } catch (err) {
    console.error('Gemini Error:', err);
    res.status(500).json({ 
      error: "Failed to fetch Gemini response",
      details: err.message 
    });
  }
});

// Logo Maker using Photooxy
app.get('/logo', async (req, res) => {
  const { text, effect } = req.query;

  if (!text || !effect) {
    return res.status(400).json({ error: 'Text and effect parameters are required' });
  }

  const effectPath = effects[effect];
  if (!effectPath) {
    return res.status(400).json({ error: 'Invalid effect name' });
  }

  try {
    // Step 1: Get HTML from effect page
    const init = await axios.post(`https://photooxy.com/${effectPath}`, 
      new URLSearchParams({ text_1: text }), 
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );

    // Step 2: Extract image URL from HTML
    const $ = cheerio.load(init.data);
    const imageUrl = $('.thumbnail img').attr('src');

    if (!imageUrl) {
      return res.status(500).json({ error: 'Image not found on Photooxy' });
    }

    // Step 3: Return the final image
    const fullUrl = `https://photooxy.com${imageUrl}`;
    const image = await axios.get(fullUrl, { responseType: 'arraybuffer' });

    res.set('Content-Type', 'image/png');
    res.send(image.data);

  } catch (err) {
    console.error('Logo maker error:', err.message);
    res.status(500).json({ error: 'Failed to generate logo', details: err.message });
  }
});

// ======================
// Server Start
// ======================
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});

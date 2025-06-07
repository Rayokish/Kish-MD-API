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
app.get('/logo', apiLimiter, async (req, res) => {
  const { text, effect } = req.query;
  
  if (!text) {
    return res.status(400).json({ error: 'Text parameter is required' });
  }

  try {
    // First request to get the processing page
    const initResponse = await axios.post(`https://photooxy.com/${effect}`, 
      new URLSearchParams({ text: text }), 
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }
    );

    const $ = cheerio.load(initResponse.data);
    const imageUrl = $('div.btn-group a').attr('href');
    
    if (!imageUrl) {
      return res.status(500).json({ error: 'Failed to generate logo' });
    }

    // Second request to get the actual image
    const imageResponse = await axios.get(`https://photooxy.com${imageUrl}`, {
      responseType: 'arraybuffer'
    });

    res.set('Content-Type', 'image/png');
    res.send(imageResponse.data);
  } catch (error) {
    console.error('Logo maker error:', error);
    res.status(500).json({ error: 'Failed to generate logo', details: error.message });
  }
});
// ======================
// Server Start
// ======================
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});

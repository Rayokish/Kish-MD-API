require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const yts = require("yt-search");
const youtubedl = require('youtube-dl-exec');
const ytdl = require("ytdl-core");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const sanitizeFilename = require("sanitize-filename");

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

// Music Search Endpoint
app.get('/search', apiLimiter, async (req, res) => {
  const query = req.query.q || req.query.song;
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  try {
    const results = await yts(query);
    if (!results.videos.length) return res.status(404).json({ error: 'No results found' });

    const songs = results.videos.map(video => ({
      id: video.videoId,
      title: video.title,
      artist: video.author.name,
      duration: video.timestamp || formatDuration(video.duration.seconds),
      thumbnail: video.thumbnail,
      url: video.url,
      views: video.views,
      uploadedAt: video.ago,
      provider: 'YouTube'
    }));

    res.json({ count: songs.length, results: songs });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Lyrics Endpoint
app.get('/lyrics', apiLimiter, async (req, res) => {
  const query = req.query.text;
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

// TikTok Downloader
app.get("/tiktok", apiLimiter, async (req, res) => {
  const url = req.query.url;
  if (!url || !validateUrl(url, 'tiktok')) {
    return res.status(400).json({ error: "Invalid TikTok URL" });
  }

  const tempFile = path.join(__dirname, `temp_tt_${Date.now()}.mp4`);

  try {
    await execAsync(`yt-dlp -f best -o "${tempFile}" "${url}"`);
    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `tiktok_${Date.now()}.mp4`, (err) => {
      cleanTempFiles(tempFile);
      if (err) console.error('TikTok download error:', err);
    });
  } catch (error) {
    cleanTempFiles(tempFile);
    console.error('TikTok error:', error);
    res.status(500).json({ error: "TikTok download failed" });
  }
});

// Facebook Downloader
app.get("/facebook", apiLimiter, async (req, res) => {
  const url = req.query.url;
  if (!url || !validateUrl(url, 'facebook')) {
    return res.status(400).json({ error: "Invalid Facebook URL" });
  }

  const tempFile = path.join(__dirname, `temp_fb_${Date.now()}.mp4`);

  try {
    await execAsync(`yt-dlp -f best -o "${tempFile}" "${url}"`);
    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `facebook_${Date.now()}.mp4`, (err) => {
      cleanTempFiles(tempFile);
      if (err) console.error('Facebook download error:', err);
    });
  } catch (error) {
    cleanTempFiles(tempFile);
    console.error('Facebook error:', error);
    res.status(500).json({ error: "Facebook download failed" });
  }
});

// YouTube Video Downloader
app.get("/youtube", apiLimiter, async (req, res) => {
  const url = req.query.url;
  if (!url || !validateUrl(url, 'youtube')) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  try {
    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title);
    
    res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
    ytdl(url, { quality: 'highest', filter: 'audioandvideo' }).pipe(res);
  } catch (error) {
    console.error('YouTube error:', error);
    res.status(500).json({ error: "YouTube download failed" });
  }
});

// GPT Chat Endpoint
app.get("/gpt", apiLimiter, async (req, res) => {
  const prompt = req.query.text;
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
    console.error('GPT Error:', err);
    res.status(500).json({ 
      error: "Failed to fetch GPT response",
      details: err.message 
    });
  }
});

// ======================
// Server Start
// ======================
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});

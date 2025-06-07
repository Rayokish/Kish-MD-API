require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const yts = require("yt-search");
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

app.set('trust proxy', 1);

// Configure system PATH for Render.com
process.env.PATH = `${process.env.PATH}:/opt/render/.local/bin:/usr/local/bin:/usr/bin:/bin`;

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
const model = genAI?.getGenerativeModel({
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

    const yourDomain = process.env.API_DOMAIN || `https://${req.get('host')}`;
    const songs = results.videos.slice(0, 5).map(video => ({
      title: video.title,
      url: video.url,
      duration: formatDuration(video.seconds),
      thumbnail: video.thumbnail,
      audio: `${yourDomain}/youtube?url=${encodeURIComponent(video.url)}`
    }));

    res.json(songs);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// YouTube Audio Downloader (with yt-dlp fallback)
app.get('/youtube', apiLimiter, async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: '❌ Invalid YouTube URL' });
  }

  const tempFile = path.join(__dirname, `temp_yt_${Date.now()}.mp3`);

  try {
    const info = await ytdl.getInfo(videoUrl);
    const title = sanitizeFilename(info.videoDetails.title);

    // Try yt-dlp first
    try {
      await execAsync(`yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${tempFile}" "${videoUrl}"`);
      
      if (!fs.existsSync(tempFile)) {
        throw new Error('yt-dlp failed to create file');
      }

      res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
      res.setHeader('Content-Type', 'audio/mpeg');

      const fileStream = fs.createReadStream(tempFile);
      fileStream.pipe(res);
      
      fileStream.on('close', () => cleanTempFiles(tempFile));
      fileStream.on('error', () => cleanTempFiles(tempFile));

    } catch (ytdlpError) {
      console.log('Falling back to ytdl-core due to:', ytdlpError.message);
      
      // Fallback to ytdl-core
      res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
      res.setHeader('Content-Type', 'audio/mpeg');
      
      ytdl(videoUrl, {
        quality: 'highestaudio',
        filter: 'audioonly',
      }).pipe(res);
    }
  } catch (err) {
    console.error("YouTube download error:", err.message);
    cleanTempFiles(tempFile);
    
    let errorMsg = '❌ Failed to fetch audio stream';
    if (err.message.includes('Video unavailable')) {
      errorMsg = '❌ Video is unavailable (private/removed)';
    } else if (err.message.includes('Age restricted')) {
      errorMsg = '❌ Age-restricted video';
    }
    
    res.status(500).json({ 
      error: errorMsg,
      details: err.message
    });
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
    res.status(500).json({ error: 'Failed to fetch lyrics', details: error.message });
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
    // Try yt-dlp first
    try {
      await execAsync(`yt-dlp -f best -o "${tempFile}" "${url}"`);
    } catch (e) {
      console.log('Falling back to direct download');
      await execAsync(`curl -L "${url}" -o "${tempFile}"`);
    }

    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `tiktok_${Date.now()}.mp4`, (err) => {
      cleanTempFiles(tempFile);
      if (err) console.error('TikTok download error:', err);
    });
  } catch (error) {
    cleanTempFiles(tempFile);
    console.error('TikTok error:', error);
    res.status(500).json({ error: "TikTok download failed", details: error.message });
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
    res.status(500).json({ error: "Facebook download failed", details: error.message });
  }
});

// GPT Chat Endpoint
app.get("/gpt", apiLimiter, async (req, res) => {
  if (!model) return res.status(503).json({ error: "Gemini AI service not configured" });

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
  console.log(`ℹ️  YouTube downloads using ${fs.existsSync('/opt/render/.local/bin/yt-dlp') ? 'yt-dlp' : 'ytdl-core'}`);
});

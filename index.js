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

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static("public", { maxAge: '1d' }));

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', apiLimiter);

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

// Utility Functions
const cleanTempFiles = async (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Error cleaning temp file:', err);
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

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// GPT Chat Endpoint
app.get("/gpt", async (req, res) => {
  const prompt = req.query.text;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const chat = model.startChat({ history: [], generationConfig: {} });
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    res.json({ response: response.text() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch GPT response" });
  }
});

// Enhanced Audio Download Endpoint
app.get('/play', async (req, res) => {
  const song = req.query.song;
  if (!song) {
    return res.status(400).json({ error: 'Missing song parameter' });
  }

  const tempFileName = `temp_${Date.now()}.mp3`;
  const tempFilePath = path.join(__dirname, tempFileName);

  try {
    // Search YouTube
    const results = await yts(song);
    if (!results.videos.length) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const video = results.videos[0];
    const videoUrl = video.url;
    const cleanTitle = sanitizeFilename(video.title);

    // Download audio
    await youtubedl(videoUrl, {
      extractAudio: true,
      audioFormat: 'mp3',
      output: tempFilePath,
      quiet: true,
    });

    // Stream response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanTitle}.mp3"`);
    
    const readStream = fs.createReadStream(tempFilePath);
    readStream.pipe(res);

    // Cleanup
    readStream.on('close', () => cleanTempFiles(tempFilePath));
    readStream.on('error', () => cleanTempFiles(tempFilePath));

  } catch (error) {
    console.error('Play error:', error);
    cleanTempFiles(tempFilePath);
    res.status(500).json({ error: 'Failed to process song' });
  }
});

// Enhanced Media Download Endpoints
const createMediaDownloader = (platform) => async (req, res) => {
  const url = req.query.url;
  if (!url || !validateUrl(url, platform)) {
    return res.status(400).json({ error: `Invalid ${platform} URL` });
  }

  const tempFile = path.join(__dirname, `temp_${platform}_${Date.now()}.mp4`);

  try {
    await execAsync(`yt-dlp -f best -o "${tempFile}" "${url}"`);
    
    if (!fs.existsSync(tempFile)) {
      throw new Error("Download failed");
    }

    res.download(tempFile, `${platform}_${Date.now()}.mp4`, (err) => {
      cleanTempFiles(tempFile);
      if (err) console.error(`${platform} download error:`, err);
    });

  } catch (e) {
    console.error(`${platform} error:`, e);
    cleanTempFiles(tempFile);
    res.status(500).json({ error: `${platform} download failed` });
  }
};

app.get("/tiktok", createMediaDownloader('tiktok'));
app.get("/facebook", createMediaDownloader('facebook'));

// YouTube Video Download Endpoint
app.get("/youtube", async (req, res) => {
  const url = req.query.url;
  if (!url || !validateUrl(url, 'youtube')) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  try {
    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title);
    
    res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
    ytdl(url, {
      quality: 'highest',
      filter: format => format.container === 'mp4',
    }).pipe(res);
  } catch (e) {
    console.error("YouTube Error:", e);
    res.status(500).json({ error: "YouTube download failed" });
  }
});

// Enhanced Lyrics Endpoint
app.get('/lyrics', async (req, res) => {
  const query = req.query.song;
  if (!query) {
    return res.status(400).json({ error: 'Missing song parameter' });
  }

  try {
    // Try lyrics.ovh first
    const [artist, title] = query.includes('-') ? 
      query.split('-').map(s => s.trim()) : 
      [null, query.trim()];
    
    if (artist) {
      const response = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, {
        timeout: 5000
      });
      
      if (response.data?.lyrics) {
        return res.json({
          artist,
          title,
          lyrics: response.data.lyrics.trim(),
          source: 'lyrics.ovh'
        });
      }
    }

    // Fallback to web scraping
    const searchResponse = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(query + " lyrics")}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const $ = cheerio.load(searchResponse.data);
    const lyrics = $('div[jsname="WbKHeb"]').text() || 
                   $('div[class*="Lyrics__Container"]').text();
    
    if (lyrics) {
      return res.json({
        artist: artist || 'Unknown',
        title: title || query,
        lyrics: lyrics.trim(),
        source: 'web'
      });
    }

    res.status(404).json({ error: 'Lyrics not found' });
  } catch (err) {
    console.error('Lyrics error:', err);
    res.status(500).json({ error: 'Failed to fetch lyrics' });
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log(`⚡ Environment: ${process.env.NODE_ENV || 'development'}`);
});

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(bodyParser.json());

// Music Downloader using DisTube & ytdl-core (simulated)
app.get('/play', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).json({ error: 'Please provide ?text=songname' });

  // Placeholder: Normally here would be YouTube search + download
  res.json({ message: `Simulated download for song: ${text}` });
});

// Chat with Gemini AI
app.post('/gpt', async (req, res) => {
  const prompt = req.body.prompt;
  if (!prompt) return res.status(400).json({ error: 'Please provide JSON body with prompt' });
  try {
    const response = await axios.post(
      'https://api.maher-zubair.xyz/gemini',
      { prompt },
      { headers: { 'Authorization': `Bearer ${process.env.GEMINI_API_KEY}` } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Gemini API request failed', details: err.message });
  }
});

// Downloader endpoints using Maher API key
app.get('/tiktok', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Please provide ?url=video_url' });
  try {
    const response = await axios.get(`https://api.maher-zubair.xyz/downloader/tiktok?apikey=${process.env.MAHER_API_KEY}&url=${encodeURIComponent(url)}`);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'TikTok downloader failed', details: err.message });
  }
});

app.get('/facebook', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Please provide ?url=video_url' });
  try {
    const response = await axios.get(`https://api.maher-zubair.xyz/downloader/facebook?apikey=${process.env.MAHER_API_KEY}&url=${encodeURIComponent(url)}`);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Facebook downloader failed', details: err.message });
  }
});

app.get('/youtube', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Please provide ?url=video_url' });
  try {
    const response = await axios.get(`https://api.maher-zubair.xyz/downloader/youtube?apikey=${process.env.MAHER_API_KEY}&url=${encodeURIComponent(url)}`);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'YouTube downloader failed', details: err.message });
  }
});

app.get('/lyrics', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).json({ error: 'Please provide ?text=songname' });
  try {
    const response = await axios.get(`https://api.maher-zubair.xyz/lyrics?apikey=${process.env.MAHER_API_KEY}&text=${encodeURIComponent(text)}`);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Lyrics fetch failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
#!/usr/bin/env bash

# Create bin directory for yt-dlp
mkdir -p /usr/local/bin

# Download yt-dlp to /usr/local/bin
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp

# Make it executable
chmod +x /usr/local/bin/yt-dlp

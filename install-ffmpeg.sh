#!/bin/bash

echo "Installing FFmpeg on macOS..."

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "Homebrew is not installed. Installing Homebrew first..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "Homebrew is already installed."
fi

# Install FFmpeg
echo "Installing FFmpeg..."
brew install ffmpeg

# Verify installation
if command -v ffmpeg &> /dev/null; then
    echo "FFmpeg installed successfully!"
    ffmpeg -version | head -n 1
else
    echo "Failed to install FFmpeg. Please try manually:"
    echo "brew install ffmpeg"
    exit 1
fi

echo "FFmpeg installation complete!"

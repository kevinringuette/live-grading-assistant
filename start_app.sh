#!/bin/bash
# Start a simple Python HTTP server on port 8000
echo "Starting local server for Live Grading Assistant..."
echo "Serving at http://localhost:8000"
echo "Press Ctrl+C to stop."

# Check if python3 is available
if command -v python3 &>/dev/null; then
    python3 -m http.server 8000
else
    # Fallback to python
    python -m SimpleHTTPServer 8000
fi

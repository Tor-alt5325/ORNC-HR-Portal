#!/bin/bash
echo "Starting ORNC HR Portal..."
cd "$(dirname "$0")/backend"
python3 app.py

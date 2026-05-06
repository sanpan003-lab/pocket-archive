#!/bin/sh
set -e
cd /volume1/docker/pocket-archive
git pull origin main
docker compose build --no-cache pocket-archive
docker compose up -d pocket-archive
echo "Deploy complete"

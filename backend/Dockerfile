FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip py3-requests && \
    pip3 install python-dotenv requests anthropic tqdm icalendar reportlab --break-system-packages
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "server.js"]

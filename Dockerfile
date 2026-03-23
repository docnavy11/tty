FROM node:20-slim

RUN apt-get update && apt-get install -y tmux python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm install

# Build
COPY client ./client
COPY server ./server
RUN npm run build

# Run as non-root user
RUN useradd -m -u 1001 tty && chown -R tty:tty /app
USER tty

ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV CLIENT_DIST=/app/client/dist

EXPOSE 3000

CMD ["node", "server/dist/index.js"]

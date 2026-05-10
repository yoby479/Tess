FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy all application files
COPY server.js ./
COPY index.html ./
COPY login.html ./
COPY admin.html ./
COPY pay.html ./
COPY success.html ./
COPY style.css ./
COPY logo.png ./

# Copy data directory with initial links.json
COPY data/ ./data/

# Create uploads directory
RUN mkdir -p /app/data/uploads

# Install cloudflared for Cloudflare Tunnel
RUN apk add --no-cache curl ca-certificates && \
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared

# Expose port (Render sets PORT env variable)
EXPOSE 10000

# Start server
CMD ["sh", "-c", "PORT=${PORT:-10000} node server.js"]

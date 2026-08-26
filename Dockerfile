# Use Node.js version 24 on Debian Bookworm
FROM node:24-bookworm

# The /app directory should act as the main application directory
WORKDIR /app

# Copy the app package, package-lock.json and npm config
COPY package*.json .npmrc ./

# Install node packages
RUN npm install --ignore-scripts

# Copy Vite configuration, entry HTML, static assets and source files
COPY vite.config.mjs index.html ./
COPY ./public ./public
COPY ./src ./src
COPY ./server.js ./server.js

# Build the app
RUN npm run build

# Expose the port (default 3000, server.js honors $PORT)
EXPOSE 3000

# Node server serves the built site and the /api/list-buckets proxy
CMD ["node", "server.js"]

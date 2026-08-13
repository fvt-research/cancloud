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

# Install the `serve` package globally to run the application
RUN npm install -g serve

# Build the app
RUN npm run build

# Expose the port (example: 3000)
EXPOSE 3000

# Start the app using the `serve` command
CMD ["serve", "-s", "site"]

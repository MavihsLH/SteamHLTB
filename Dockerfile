FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Expose the server port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

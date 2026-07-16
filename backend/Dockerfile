FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching. npm install (not ci) per Beachhead.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "src/index.js"]

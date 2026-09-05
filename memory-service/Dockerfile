# Couche mémoire Forge IA — image de production (non-root)
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV PORT=4002
ENV MEMORY_DB_PATH=/data/memory.db
# Moindre privilège : données possédées par l'utilisateur non-root, puis USER node
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 4002
CMD ["node", "server.js"]

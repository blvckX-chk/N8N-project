# Panneau de contrôle ForgeIA — image de production
FROM node:20-alpine
WORKDIR /app

# Dépendances d'abord (cache Docker)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Code applicatif
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]

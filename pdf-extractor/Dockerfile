# Forge IA — extracteur PDF/DOCX (hors n8n, isolé des bindings natifs)
FROM node:20-alpine

WORKDIR /app

# Dépendances (couche cache)
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Code
COPY server.js ./

ENV PORT=3002
EXPOSE 3002

# Non-root (durcissement — cohérent avec le reste du système)
USER node

CMD ["node", "server.js"]

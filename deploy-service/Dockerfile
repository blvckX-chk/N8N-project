# Forge IA — service de déploiement.
# node:20 complet + outils de build : les apps déployées incluent better-sqlite3
# (module natif) qui se compile au `npm install` exécuté à l'intérieur du conteneur.
FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./

ENV PORT=4001 \
    APPS_DIR=/data/apps \
    PORT_MIN=4100 \
    PORT_MAX=4140

EXPOSE 4001
# NB : ce service exécute du code généré -> le durcissement réel est l'isolation
# du conteneur (idéalement un VPS dédié). On tourne en root ici pour fiabiliser
# la compilation native au déploiement (npm install de better-sqlite3).
CMD ["node", "server.js"]

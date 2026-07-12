# Microservice Semgrep pour Forge IA
# Image officielle Semgrep (contient le binaire semgrep + Python).
FROM semgrep/semgrep:latest

WORKDIR /app
COPY server.py ./

ENV PORT=8000
# Pré-télécharger les rulesets au build est optionnel ; ils sont récupérés au 1er scan.
EXPOSE 8000

ENTRYPOINT []
CMD ["python3", "/app/server.py"]

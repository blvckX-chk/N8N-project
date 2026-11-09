#!/usr/bin/env bash
# Forge IA — bascule du moteur LLM des agents entre Tchavi (principal) et Mistral (secours).
#
#   Usage :
#     bash deploy/vps/switch-llm.sh mistral   # bascule tous les agents chat vers Mistral
#     bash deploy/vps/switch-llm.sh tchavi    # revient a la configuration Tchavi (Sonnet)
#
#   Apres la bascule, reimporter les workflows :
#     bash deploy/vps/import-workflows.sh
#
# Principe :
#   - "tchavi" restaure simplement la version Tchavi versionnee dans git (sans perte).
#   - "mistral" applique une transformation sed (URL + cle + modeles) sur les agents chat.
#   - Les embeddings RAG (mistral-embed -> api.mistral.ai) ne sont JAMAIS touches :
#     Tchavi n'expose pas d'embeddings, ils restent sur Mistral dans les deux modes.
#
# Prerequis mode Mistral : MISTRAL_API_KEY renseignee dans .env.vps (compte Mistral actif).
set -euo pipefail

TARGET="${1:-}"
DIR="$(cd "$(dirname "$0")/workflows" && pwd)"

CHAT_PATH="/v1/chat/completions"      # distinct de /v1/embeddings -> embeddings preserves
TCHAVI_URL="https://tchavi.com${CHAT_PATH}"
MISTRAL_URL="https://api.mistral.ai${CHAT_PATH}"

case "$TARGET" in
  mistral)
    echo "== Bascule du moteur chat -> MISTRAL (secours) =="
    sed -i \
      -e "s#${TCHAVI_URL}#${MISTRAL_URL}#g" \
      -e 's#\$env\.TCHAVI_API_KEY#$env.MISTRAL_API_KEY#g' \
      -e 's#claude-sonnet-5-5#mistral-large-latest#g' \
      -e 's#gpt-4o-mini#mistral-small-latest#g' \
      -e 's#llama-3\.3-70b#mistral-small-latest#g' \
      "$DIR"/*.json
    echo "   Architecte/Backend/Frontend/QA -> mistral-large-latest"
    echo "   Documentation/Spec_Normalizer/OCR -> mistral-small-latest"
    echo "   (OCR image : la vision peut etre limitee sur mistral-small)"
    ;;

  tchavi)
    echo "== Retour au moteur chat -> TCHAVI (principal, Claude Sonnet 5.5) =="
    # Restauration sans perte depuis la version versionnee.
    if git -C "$DIR/../../.." rev-parse >/dev/null 2>&1; then
      git -C "$DIR/../../.." checkout -- deploy/vps/workflows/
      echo "   Workflows restaures depuis git (etat Tchavi)."
    else
      echo "   !! Pas dans un depot git — restauration impossible."
      echo "   !! Faire : git checkout -- deploy/vps/workflows/  depuis la racine du depot."
      exit 1
    fi
    ;;

  *)
    echo "Usage: $0 tchavi|mistral"
    exit 1
    ;;
esac

echo ""
echo "== Modeles actuels par agent =="
grep -rhoE "claude-sonnet-5-5|mistral-large-latest|gpt-4o-mini|mistral-small-latest|llama-3.3-70b|mistral-embed" "$DIR"/*.json | sort | uniq -c
echo ""
echo "Prochaine etape : bash deploy/vps/import-workflows.sh"

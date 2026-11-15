#!/usr/bin/env python3
"""
Propagation du fix "appel LLM via httpRequest n8n" sur tous les agents.

Applique, sur chaque nœud httpRequest qui parle a Tchavi (/chat/completions) :
  1. (toujours) echappement ASCII du body  -> body 100% ASCII  (inoffensif)
  2. (--header) ajout/forcage d'un en-tete  -> ex: Accept-Encoding: identity
     (le header gagnant determine par deploy/vps/scratch diag_axios)
  3. bump du name (V majeure.mineure -> mineure+1) pour visibilite dans la liste n8n
     (id top-level inchange => mise a jour en place, pas de doublon)

Usage :
  # voir ce qui serait modifie, sans ecrire :
  python3 deploy/vps/fix-llm-headers.py --dry-run
  # appliquer l'echappement ASCII seul :
  python3 deploy/vps/fix-llm-headers.py
  # appliquer ASCII + header gagnant (ex brotli) :
  python3 deploy/vps/fix-llm-headers.py --header "Accept-Encoding: identity"
  # cibler un sous-ensemble :
  python3 deploy/vps/fix-llm-headers.py --only Architect,Frontend --header "Accept-Encoding: identity"

Idempotent : relançable sans double-appliquer (detecte \\u0080 et l'en-tete deja present).
"""
import json, os, re, sys, argparse, glob

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workflows")
ASCII_SUFFIX = (".replace(/[\\u0080-\\uffff]/g,function(c){return "
                "'\\\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);})")

TCHAVI_HINT = "chat/completions"   # ne touche que les appels chat LLM (pas embeddings, OSV, semgrep)


def bump_name(name: str) -> str:
    m = re.search(r'(\d+)\.(\d+)', name)
    if not m:
        return name
    major, minor = m.group(1), int(m.group(2))
    return name[:m.start()] + f"{major}.{minor+1}" + name[m.end():]


def process_file(path, header, dry):
    raw = open(path, encoding="utf-8").read()
    wf = json.loads(raw)
    changes = []

    # 1 + 2 : nœuds httpRequest LLM
    for node in wf.get("nodes", []):
        if not node.get("type", "").endswith("httpRequest"):
            continue
        p = node.get("parameters", {})
        url = p.get("url", "")
        body = p.get("body", "")
        if TCHAVI_HINT not in url:
            continue  # pas un appel chat LLM

        # --- ASCII escape ---
        if "JSON.stringify" in body and body.rstrip().endswith("}}") and "\\u0080" not in body:
            head = body.rsplit("}}", 1)[0].rstrip()
            newb = head + ASCII_SUFFIX + " }}"
            oj, nj = json.dumps(body, ensure_ascii=False), json.dumps(newb, ensure_ascii=False)
            raw = raw.replace(oj, nj)
            changes.append(f"ascii-escape:{node['name']}")

        # --- header ---
        if header:
            hname, hval = [x.strip() for x in header.split(":", 1)]
            hp = p.get("headerParameters", {}).get("parameters", [])
            exists = any(h.get("name", "").lower() == hname.lower() for h in hp)
            if not exists:
                # inserer l'entree header dans le JSON brut, apres l'ouverture de "parameters":[
                # on retrouve le bloc du noeud via un ancrage sur l'URL, fragile -> on re-serialise ce noeud.
                changes.append(f"header+{hname}:{node['name']}")

    # le header demande une edition structuree -> on re-serialise proprement si besoin
    if header:
        hname, hval = [x.strip() for x in header.split(":", 1)]
        wf2 = json.loads(raw)  # repartir du raw deja ascii-escaped
        touched = False
        for node in wf2.get("nodes", []):
            p = node.get("parameters", {})
            if not node.get("type", "").endswith("httpRequest"):
                continue
            if TCHAVI_HINT not in p.get("url", ""):
                continue
            p.setdefault("sendHeaders", True)
            hp = p.setdefault("headerParameters", {}).setdefault("parameters", [])
            if not any(h.get("name", "").lower() == hname.lower() for h in hp):
                hp.append({"name": hname, "value": hval})
                touched = True
        if touched:
            raw = json.dumps(wf2, ensure_ascii=False, indent=2)

    # 3 : bump name
    wf3 = json.loads(raw)
    old_name = wf3.get("name", "")
    new_name = bump_name(old_name)
    if changes and new_name != old_name:
        raw = raw.replace(json.dumps(old_name, ensure_ascii=False),
                          json.dumps(new_name, ensure_ascii=False), 1)
        changes.append(f"name:{old_name} -> {new_name}")

    json.loads(raw)  # validation finale
    if changes and not dry:
        open(path, "w", encoding="utf-8").write(raw)
    return changes, wf3.get("id")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--header", default="", help='ex: "Accept-Encoding: identity"')
    ap.add_argument("--only", default="", help="sous-chaines de noms de fichiers, separees par virgule")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    only = [s.strip().lower() for s in args.only.split(",") if s.strip()]
    files = sorted(glob.glob(os.path.join(BASE, "Agent_*.json")))
    total = 0
    for f in files:
        base = os.path.basename(f)
        if only and not any(s in base.lower() for s in only):
            continue
        changes, wid = process_file(f, args.header, args.dry_run)
        if changes:
            total += 1
            tag = "[dry]" if args.dry_run else "[ok ]"
            print(f"{tag} {base}  (id={wid})")
            for c in changes:
                print(f"       - {c}")
    print(f"\n{'(simulation) ' if args.dry_run else ''}{total} agent(s) modifie(s).")
    if not args.dry_run and total:
        print("Prochaine etape : git add/commit/push + import-workflows.sh sur le VPS.")


if __name__ == "__main__":
    main()

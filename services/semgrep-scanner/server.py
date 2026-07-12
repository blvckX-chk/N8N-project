#!/usr/bin/env python3
"""
Microservice Semgrep pour Forge IA.

POST /scan  { "task_id": "...", "files": [ { "path": "server.js", "content": "..." } ] }
  -> lance Semgrep (rulesets OWASP + sécurité) sur les fichiers reçus
  -> renvoie un verdict normalisé au format des autres gates du pipeline.

GET /health -> { "status": "ok" }

Aucune dépendance hors stdlib + le binaire `semgrep` (fourni par l'image de base).
"""
import json
import os
import subprocess
import tempfile
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8000"))
MAX_BODY = 8 * 1024 * 1024  # 8 Mo
# Rulesets Semgrep : sécurité + OWASP Top 10 + JS/TS. Surcharge possible via env.
CONFIGS = os.environ.get(
    "SEMGREP_CONFIGS",
    "p/owasp-top-ten,p/javascript,p/security-audit,p/secrets",
).split(",")
TIMEOUT = int(os.environ.get("SEMGREP_TIMEOUT", "120"))


def run_semgrep(files):
    workdir = tempfile.mkdtemp(prefix="forge-semgrep-")
    try:
        for f in files:
            rel = str(f.get("path", "")).lstrip("/").replace("..", "_")
            if not rel:
                continue
            dest = os.path.join(workdir, rel)
            os.makedirs(os.path.dirname(dest) or workdir, exist_ok=True)
            content = f.get("content", "") or ""
            # retirer un eventuel prefixe "// FILE: xxx" du pipeline
            if content.startswith("// FILE:") or content.startswith("<!-- FILE:"):
                content = content.split("\n", 1)[1] if "\n" in content else ""
            with open(dest, "w", encoding="utf-8", errors="ignore") as fh:
                fh.write(content)

        cmd = ["semgrep", "scan", "--json", "--quiet", "--disable-version-check",
               "--timeout", str(TIMEOUT)]
        for c in CONFIGS:
            c = c.strip()
            if c:
                cmd += ["--config", c]
        cmd.append(workdir)

        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT + 30)
        try:
            data = json.loads(proc.stdout or "{}")
        except json.JSONDecodeError:
            return {"_error": "semgrep n'a pas renvoyé de JSON", "_stderr": (proc.stderr or "")[:500]}
        return data
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def normalize(task_id, semgrep_json):
    if semgrep_json.get("_error"):
        return {
            "agent": "Agent SAST Semgrep", "_version": "1.0", "task_id": task_id,
            "status": "ERROR", "global_score": 0, "approved_for_pipeline": False,
            "critical_issues": [], "warnings": [],
            "summary": semgrep_json.get("_error"),
            "engine": "semgrep",
        }
    critical, warnings = [], []
    for r in semgrep_json.get("results", []):
        extra = r.get("extra", {}) or {}
        meta = extra.get("metadata", {}) or {}
        sev = (extra.get("severity") or "INFO").upper()
        owasp = meta.get("owasp")
        if isinstance(owasp, list):
            owasp = ", ".join(str(x) for x in owasp)
        issue = {
            "rule": r.get("check_id", "semgrep-rule"),
            "severity": "high" if sev == "ERROR" else "medium",
            "owasp": owasp or "",
            "cwe": meta.get("cwe", ""),
            "file": r.get("path", "?"),
            "line": (r.get("start", {}) or {}).get("line"),
            "description": (extra.get("message") or "").strip()[:300],
            "fix": (meta.get("references", [None]) or [None])[0] or "Voir la règle Semgrep",
        }
        (critical if sev == "ERROR" else warnings).append(issue)

    sec_score = max(0, 100 - len(critical) * 25 - len(warnings) * 5)
    status = "FAIL" if critical else ("WARN" if warnings else "PASS")
    return {
        "agent": "Agent SAST Semgrep", "_version": "1.0", "task_id": task_id,
        "status": status, "global_score": sec_score,
        "approved_for_pipeline": status != "FAIL",
        "critical_issues": critical, "warnings": warnings,
        "dimensions": {"security": {"score": sec_score}},
        "summary": (
            f"{len(critical)} vulnérabilité(s) critique(s) Semgrep" if critical
            else (f"{len(warnings)} avertissement(s) Semgrep" if warnings
                  else "Aucune vulnérabilité détectée par Semgrep")
        ),
        "engine": "semgrep",
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"status": "ok", "engine": "semgrep"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/scan":
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_BODY:
            return self._send(400, {"error": "corps vide ou trop volumineux"})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as e:
            return self._send(400, {"error": "JSON invalide: " + str(e)})
        files = payload.get("files") or []
        task_id = str(payload.get("task_id", "unknown"))
        if not isinstance(files, list) or not files:
            return self._send(400, {"error": "champ files manquant ou vide"})
        try:
            result = normalize(task_id, run_semgrep(files))
            self._send(200, result)
        except subprocess.TimeoutExpired:
            self._send(504, {"agent": "Agent SAST Semgrep", "task_id": task_id,
                             "status": "ERROR", "summary": "Semgrep: délai dépassé"})
        except Exception as e:
            self._send(500, {"agent": "Agent SAST Semgrep", "task_id": task_id,
                             "status": "ERROR", "summary": "Erreur Semgrep: " + str(e)})

    def log_message(self, *a):
        pass  # silencieux


if __name__ == "__main__":
    print(f"Semgrep scanner en écoute sur :{PORT} (configs: {', '.join(CONFIGS)})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

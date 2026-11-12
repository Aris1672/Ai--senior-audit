# Name-detection service (Natasha)

Finds people's names in Russian text so the auditor can code them before
anything goes to the LLM. Used by `lib/ner-client.ts` → `lib/audit-engine.ts`.
It receives real client text, so it runs only on our own Coolify server
(`assistant_vps_4`) and every call must carry the shared secret `NER_TOKEN`.

## 1. Create the app in Coolify

Same recipe as the other apps in `Self-Host-Migration.md`:

1. Project "Auditor" → **+ New** → the GitHub App source ("My-Git-Hub") →
   repository `Aris1672/Ai--senior-audit`, branch `main`, server `assistant_vps_4`.
2. **Build Pack: Dockerfile** — set it explicitly (Railpack does not work here).
3. **Base Directory: `/services/ner`**.
4. **Ports Exposes: `8000`** (the default 3000 gives a bad gateway).
5. Environment variable **`NER_TOKEN`** = a long random string, e.g. from
   `openssl rand -hex 32`. Check that both the Production and Preview sets show it.
6. Deploy. The first build takes a few minutes. If it fails on
   `git ls-remote` to github.com, retry — that block is intermittent.
   The service needs about 500 MB RAM.

## 2. Make it reachable from the auditor — pick ONE

`Self-Host-Migration.md` (checklist item 7 / gotcha 2) records that a Coolify
container's internal hostname changes on every redeploy and has no stable
alias by default. So:

**Option A — private (preferred if your Coolify has the setting).**
In the new app look for **Network Aliases** (Advanced / Network). If the field
exists: set alias `ner`, leave **Domains empty**, redeploy.
Then in the auditor: `NER_URL=http://ner:8000`.

**Option B — the pattern the other apps use (public URL through Traefik).**
If there is no Network Aliases field, or the check below fails:
1. DNS: A record `ner.assistant24info.ru` → `168.222.202.222`.
2. In the new app → Domains: `https://ner.assistant24info.ru`, Pattern B
   ("Redirect HTTP to HTTPS" **enabled**). Redeploy, then open
   `https://ner.assistant24info.ru/health` once so the certificate is issued.
3. In the auditor: `NER_URL=https://ner.assistant24info.ru`.
With option B the address is public, so `NER_TOKEN` is what protects it —
anyone without the token gets 401. The auditor and the service are on the
same server, so the text still does not leave it, and the hop is HTTPS.

## 3. Connect the auditor

In the auditor app (Production and Preview): `NER_URL` (from step 2) and
`NER_TOKEN` (same value as the service). Redeploy the auditor; its startup
line must end with `ner=on`.

Check from the auditor's terminal — this makes a real call with the token:

    node -e "fetch(process.env.NER_URL+'/names',{method:'POST',headers:{'content-type':'application/json','x-ner-token':process.env.NER_TOKEN},body:JSON.stringify({texts:['возврат займа Сидорову']})}).then(async r=>console.log(r.status,await r.text()),e=>console.log('FAILED',e.cause?.code||e.message))"

Expected: `200 {"names":[{"text":"Сидорову","normal":"Сидоров"}]}`.
`FAILED …` = not reachable; `401` = tokens differ; `503` = token not set on
the service. In all three cases audits are blocked (by design) — remove
`NER_URL` from the auditor until it is fixed.

## Behaviour

- `NER_URL` set → the service is required. Down / unreachable / wrong token →
  the audit is blocked and nothing is sent to the LLM.
- `NER_URL` not set → the auditor uses its built-in shape rules only.
- `/health` is open (no data); `/names` needs the token. Request content is
  never logged.

## Local run

    uv venv -p 3.10 .venv && uv pip install -p .venv/bin/python -r requirements.txt
    NER_TOKEN=dev .venv/bin/uvicorn app:app --port 8000

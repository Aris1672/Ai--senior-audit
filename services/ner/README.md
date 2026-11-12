# Name-detection service (Natasha)

Finds people's names in Russian text so the auditor can code them before
anything goes to the LLM. Used by `lib/ner-client.ts` → `lib/audit-engine.ts`.
It receives real client text: it must run on our own server and must NOT have
a public domain.

## Deploy in Coolify (once)

1. Project "Auditor" → **+ New** → **Private/Public Repository** → the same
   repository (`Aris1672/Ai--senior-audit`), branch `main`, same server.
2. Build pack: **Dockerfile**. **Base Directory: `/services/ner`**.
3. **Ports Exposes: `8000`**. **Domains: leave empty** (no public address).
4. Advanced → Network → **Network Alias: `ner`** (so the auditor can reach it
   as `http://ner:8000`).
5. Optional: environment variable `NER_TOKEN=<random string>` (then set the
   same value in the auditor app).
6. Deploy. First build takes a few minutes (downloads the language models).
   Needs about 500 MB RAM.

## Connect the auditor

In the auditor app's environment variables add `NER_URL=http://ner:8000`
(and `NER_TOKEN` if used), then redeploy the auditor. Its startup log line
must end with `ner=on`.

Check from the auditor's terminal:

    node -e "fetch(process.env.NER_URL+'/health').then(r=>r.text()).then(console.log,e=>console.log('FAILED',e.cause?.code||e.message))"

Expected: `{"status":"ok"}`. If it prints FAILED, the two apps are not on the
same Docker network or the alias is wrong — the audit will be blocked until
this works (by design).

## Behaviour

- `NER_URL` set → the service is required. Down / unreachable → the audit is
  blocked and nothing is sent to the LLM.
- `NER_URL` not set → the auditor uses its built-in shape rules only.

## Local run

    uv venv -p 3.10 .venv && uv pip install -p .venv/bin/python -r requirements.txt
    .venv/bin/uvicorn app:app --port 8000

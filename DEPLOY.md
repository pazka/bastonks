# Deploying bastonks.hosh.it

Deployment on the hosh.it box (box standard: `docs/BOX-CONTRACT.md`). Releases deploy themselves
through **hosh-deploy** (§1); a first install is a one-time on-box step (§1b). `.env.example`
defaults already fit the box; the **owner** only provides secrets.

## 1. How releases go live (hosh-deploy — the only deploy path on the box)

Every release (`release` workflow: tag `vX.Y.Z` or Actions → release) ends with the **`deploy`** job:
GitHub connects to the box as `deployer` with this repo's `HOSH_DEPLOY_KEY` (bound to bastonks only)
and runs `hosh-deploy deploy bastonks vX.Y.Z`. The box pulls the image, swaps the tag in
`bastonks.env`, waits healthy, checks `/healthz` on the loopback port and through Traefik, runs
`POST_DEPLOY` inside the container (`deploy/hosh-deploy.conf`) and **rolls back by itself** if any
check fails (the workflow then goes red). Nothing from the repo runs on the host.

- Redeploy / roll forward / back: Actions → **deploy** → `vX.Y.Z`, `rollback` or `status`.
- On the box (owner, or the on-box Claude without a sudo window): `sudo hosh-deploy deploy bastonks vX.Y.Z`,
  `sudo hosh-deploy rollback bastonks`, `sudo hosh-deploy status bastonks`. Log: `/var/log/hosh-deploy.log`.
- Repo variable `HOSH_AUTODEPLOY=false` stops auto-deploy after releases (manual dispatch still works).

## 1b. First install on the box (once; on-box Claude in an owner-opened sudo window)

Box rules: `ACTIONS-LOG.md` intent BEFORE, result + revert AFTER; `/home/pazka/MIGRATION/scripts/smoke.sh`
BEFORE and AFTER. Prerequisites done by `scripts/new-project.sh` + the on-box session: DNS record,
port registered in `11-BOX-STANDARD.md`, a `v1.0.0` release built.

```sh
# A — release checkout (provides docker-compose.example.yml, .env.example, deploy/*)
sudo mkdir -p /srv/bastonks && sudo chmod 750 /srv/bastonks && cd /srv/bastonks
[ -d .git ] || { sudo git init -q && sudo git remote add origin https://github.com/pazka/bastonks; }
sudo git fetch -q --depth 1 origin tag v1.0.0 && sudo git checkout -q v1.0.0
# B — env file from the template (no secret in it yet); never read it after step C
[ -e bastonks.env ] || sudo install -m 600 .env.example bastonks.env
```
**C — owner: secrets.** The owner (never the agent) runs the interactive script; input is hidden, nothing is
printed or passed on a command line:
`sudo bash -c 'cd /srv/bastonks && bash scripts/set-trello.sh ./bastonks.env'`
It asks for the Trello **API key**, a **read-only token** (`scope=read`, expiration never) and the **board id**
(the 8-character code of the board URL, or its 24-hex id). From then on nobody reads `bastonks.env`.
```sh
# D — pin the box config (validates the compose hardening), first deploy (writes the Traefik route)
sudo hosh-deploy register bastonks
sudo hosh-deploy deploy bastonks v1.0.0
# E — GitHub key for auto-deploys (claude_agent: keygen; root: bind; gh: secret; private key shredded)
ssh-keygen -q -t ed25519 -N '' -C hosh-deploy:bastonks -f /tmp/bastonks-deploy
sudo /home/pazka/MIGRATION/scripts/setup-hosh-deploy.sh key bastonks /tmp/bastonks-deploy.pub
gh secret set HOSH_DEPLOY_KEY -R pazka/bastonks < /tmp/bastonks-deploy && shred -u /tmp/bastonks-deploy /tmp/bastonks-deploy.pub
```
Then add `svc_bastonks` to the box smoke harness (`scripts/smoke.sh`: function, host in `TLS_HOSTS`, name
in `SERVICES`, new `c_*` helpers in its `export -f` list) from §3, run `scripts/smoke.sh all` (AFTER),
and test the GitHub path once: Actions → deploy → `status`.

**Revert:** `cd /srv/bastonks && sudo docker compose --env-file bastonks.env down` (keeps the volume) +
`sudo rm /root/hosh-deploy/edge/traefik/dynamic/bastonks.yml /etc/hosh-deploy/apps/bastonks.conf` +
`sudo .../setup-hosh-deploy.sh unkey bastonks`.

## 2. Variables (`bastonks.env`, mode 600)
| Variable | Default | Set by | Meaning |
|---|---|---|---|
| `APP_IMAGE` | `ghcr.io/pazka/bastonks:v1.0.0` | hosh-deploy | Release tag running (the only line hosh-deploy rewrites). |
| `APP_BIND` | `127.0.0.1:9130` | template | Loopback port published for Traefik. |
| `TRELLO_KEY` | empty (**required**) | owner, `scripts/set-trello.sh` | Trello API key. |
| `TRELLO_TOKEN` | empty (**required**) | owner, `scripts/set-trello.sh` | Trello token, **read-only** scope. |
| `TRELLO_BOARD_ID` | empty (**required**) | owner, `scripts/set-trello.sh` | The thesis board (short code or id). Never logged, never sent to the browser. |
| `APP_DATA_DIR` | `/data` | template | Snapshot, image cache, id salt (`/data/.secrets/id-salt`, generated once). |
| `APP_FETCH_TIMEOUT_MS` | `3000` | template | How long a visit waits for Trello before the last good snapshot is served (stale). |
| `APP_MIN_REFETCH_S` | `10` | template | Visits within this many seconds of a successful fetch share it (Trello rate limit). |
| `APP_LOG_LEVEL` | `info` | template | `debug`, `info`, `warn`, `error`. |
| `APP_BASE_URL` | `https://bastonks.hosh.it` | template | Public URL (informative). |
| `APP_TRUSTED_PROXIES` | `127.0.0.0/8,::1/128,172.16.0.0/12` | template | Box standard. The app never uses client IPs (no X-Forwarded-For needed). |
| `APP_PORT` | `8000` (unset) | — | Listening port inside the container; leave unset. |

## 3. Capability checks (what "works" means — not just a 200)
All of these except the browser line are run by **`/app/bastonks smoke http://127.0.0.1:8000`** inside the
container (`POST_DEPLOY`, after every deploy; non-zero ⇒ automatic rollback). It prints one JSON line per check and
never prints card content. CI runs the same smoke against the hardened container plus the e2e test.

| Feature | Request → expected |
|---|---|
| Health | `GET /healthz` → 200 `{"status":"ok","snapshot_age_s":…,"last_fetch":"ok\|timeout\|error","trees":…,"branches":…,"pots":…}`; 503 `no_snapshot` until a first snapshot exists. |
| World size | `GET /api/world` → 200 JSON, **≥ 100 Trees** and **≥ 2 000 Branches** (`--min-trees` / `--min-branches` to adjust). |
| Privacy | the world JSON contains **no `trello.com`**, no e-mail, phone, `patient <n>` or `047_B`-style code (masked as `•••`), no `Astuce Trello` card, no Trello id (opaque ids only). |
| Path | Trees in Week order (2023 → 2026). |
| Images | the first `/img/<opaque-id>` of the world → 200 `image/*`, `immutable` cache; non-image attachments carry **no URL** (name only). |
| ETag | `GET /api/world` with `If-None-Match` → 304 (or 200 if a fresh fetch changed the board). |
| Front-end | `GET /` → 200 with the canvas and a strict CSP (`default-src 'self'`, no CDN). |
| Dotfiles | `GET /.env` → 404. |
| Trello down | with Trello unreachable or a wrong token, `/api/world` still serves the last snapshot with `"stale": true` (`smoke --expect-stale`; CI proves it with no credentials; on the box: `healthz.last_fetch` = `error`/`timeout` while the world keeps serving). |
| Refresh per visit | each `/api/world` triggers one board fetch (shared by concurrent visits) — `last_fetch` and `snapshot_age_s` move after a visit. |
| Browser | the front-end loads, the Flyover plays (title, Salomé Klein, epigraph), the Pigeon flies to a Branch and the panel shows its card: `deno task e2e` (Playwright, headless Chrome) in CI. |

## 4. What runs
| Item | Value |
|---|---|
| Image | `ghcr.io/pazka/bastonks:vX.Y.Z` |
| Upstream | container :8000 → `127.0.0.1:9130` |
| Edge | `/root/hosh-deploy/edge/traefik/dynamic/bastonks.yml` (router `bastonks@file`, resolver `le`, HSTS) |
| Volume | docker volume `bastonks-data` → `/data` (in the monthly restic golden backup) |
| Health | `GET /healthz` → `{"status":"ok", …}` |
| Outbound | `api.trello.com` (board, once per visit at most every `APP_MIN_REFETCH_S`), `trello.com` + `trello-attachments.s3.amazonaws.com` (image previews, once each, then cached). Nothing else is permitted by the compiled Deno permissions. |

## 5. Decisions / known limits
**Runtime permissions** (compiled into the binary by `deno task compile`, nothing else is granted):
- `--allow-net=api.trello.com,trello.com,trello-attachments.s3.amazonaws.com,0.0.0.0:8000,127.0.0.1:8000`
  (Trello API, image previews and their storage redirect; listening on :8000; the `healthcheck`/`smoke` subcommands
  talk to 127.0.0.1:8000);
- `--allow-read=/data --allow-write=/data` (the front-end is embedded in the binary);
- `--allow-env=TRELLO_KEY,TRELLO_TOKEN,TRELLO_BOARD_ID,APP_DATA_DIR,APP_PORT,APP_FETCH_TIMEOUT_MS,APP_MIN_REFETCH_S,APP_LOG_LEVEL,APP_BASE_URL,APP_TRUSTED_PROXIES`;
- never `--allow-run`, `--allow-ffi`, `--allow-sys`.

**Residual risk (accepted by the owner):** compromised code inside the app could still exfiltrate data through the
Trello API, the only outbound route left open. The token is read-only, but a Trello token can read **all** of the
owner's boards, not only this one. The image-preview hosts are only ever called with URLs that came from Trello,
and the credentials are only sent to `*.trello.com`, never to the storage host.

**Privacy pipeline** (`src/server/clean.ts`, `src/server/mask.ts`, tests in `tests/`): an allowlist (lists: name,
archived, position; cards: name, description, labels, cover colour, checklist items, creation/last-activity/due
dates, archived, attachment names; image previews served by the app under opaque ids). Members, comments/actions,
URLs, shortLinks, custom fields and plugin data never leave the Trello response. Masking (`•••`) in every text
field, before anything is stored or sent: Trello URLs; e-mails (also `x [at] y.z`); international (`+…`) and French
(`0X XX XX XX XX`) phone numbers; `patient(e)(s) [n°|no|#|num] <number>` (the number is masked, the word kept);
transcript codes `NN(NN)_X(X)(N)` such as `047_B`, `112_AB`. First names stay visible. Descriptions are shown as
plain text (links never clickable). Trello ids are replaced by HMAC-SHA-256(salt) ids; the salt lives in
`/data/.secrets/id-salt` (losing the volume only resets visitors' saved progress).

**Classification:** Done list = date in the name (hand typing tolerated: `20/11/023`, `19/02/24`, `18/08//2025`, …)
or `DONE`, or archived. Week = the name's date if it fits the cards (not more than 7 days before their median
creation, not more than 45 days after their last activity); a wrong year is repaired from the cards (`DONE
13/05/2023` holding May-2024 cards → week of 13/05/2024); otherwise derived from the cards. Seasons are northern
meteorological seasons.

**Refresh per visit:** each `/api/world` starts one board fetch (concurrent visits share it); a visit waits up to
`APP_FETCH_TIMEOUT_MS`, then the last good snapshot is served (`stale: true`) while the fetch finishes in the
background. Visits within `APP_MIN_REFETCH_S` of a successful fetch reuse it (Trello allows ~100 requests / 10 s
per token). The board call uses Trello's nested resources (`lists=all`, `cards=all` with attachments,
`checklists=all`, `labels=all`); Trello's docs site was not reachable from the build sandbox, so verify the first
real fetch on the box: `healthz.trees`/`branches` should match the board (~165 Trees, ~2 100 Branches).

**Golden Peanuts / Exceptional Cards:** dropped at the owner's request (the full collection of cards is the
goal). Feel values (speeds, ranges, intro length): `src/client/tuning.ts`.

**Supply chain:** third-party dependencies are `three@0.186.1` (runtime, bundled), `@types/three` (types) and
`playwright-core@1.64.0` (e2e only, owner-approved; never in the image), plus Deno's first-party `@std/http` /
`@std/assert`. `deno.lock` is frozen, `minimumDependencyAge` P7D, `.npmrc` `trust-policy=no-downgrade`, no
lifecycle scripts. Deno 2.9.7 is installed in CI from the GitHub release with a pinned SHA-256; the `denort`
runtime that `deno compile` wraps is likewise pinned by checksum in the Dockerfile. Note: `deno bundle` fetches
Deno's own pinned esbuild (0.25.5) from npm on first use — part of the Deno toolchain chosen in ADR 0001.
Base images (`denoland/deno`, `gcr.io/distroless/cc-debian12:nonroot`) are pinned by digest; Dependabot proposes
updates after a 7-day cooldown.

**Assets & audio:** all geometry, the Pigeon and the music/SFX are generated in code (CC0, credited in the About
panel); no font, CDN or analytics. The Pigeon is behind a `PigeonModel` seam (`src/client/pigeon.ts`) for a glTF
later. Progress (Found, ids seen last visit, mute, language, mouse options) lives in the visitor's localStorage only.
On phones a fullscreen offer appears after the intro (where the browser allows it); `manifest.webmanifest`
lets "Add to Home Screen" open the garden fullscreen (iOS Safari has no fullscreen API for pages).

**Known limits:** the image is ~45 MB (Deno runtime); a first visit downloads ~600 KB of JS (gzip ~150 KB) and the
world JSON (~0.5 MB, compressed by the server); WebGL is required. Mobile quality adapts (pixel-ratio cap 1.5,
lower decor density, outlines dropped if the frame rate stays under ~48 fps).

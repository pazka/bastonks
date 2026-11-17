# Testing

The suite is the safety net for upgrades (Deno, the distroless base, `three`, Actions): a Dependabot PR
is mergeable on a green `ci` run alone.

## Run it

Inside the pinned build image, so nothing runs on the host:

```bash
IMG=$(sed -nE 's/^FROM (denoland\/deno:\S+) AS build$/\1/p' Dockerfile)
docker run --rm -v "$PWD":/app -v bastonks_deno:/deno-dir -e DENO_DIR=/deno-dir -w /app "$IMG" \
  sh -c "deno ci && deno task build && deno task check && deno task test"
```

(Windows Git Bash: prefix with `MSYS_NO_PATHCONV=1`, mount `"$(cygpath -w "$PWD")"`.)
The browser e2e (`deno task e2e`) needs Chrome; CI runs it.

## CI (`.github/workflows/ci.yml`)

Runs on PRs, `main` and `agent/**` branches. `test`: fmt, lint, typecheck, unit tests, browser e2e on the
synthetic board. `image`: build → Trivy CRITICAL gate → hardened container smoke (`bastonks smoke
--expect-stale` = the same capability checks `hosh-deploy` runs after a deploy) → image runs as 10001 and
creates its state on an empty `/data` under a read-only rootfs. Only `main` pushes to ghcr.

## What is covered

- `tests/pipeline_test.ts` — privacy allowlist (no dropped Trello field, URL, id or seeded secret
  survives), masking, classification, week order, image previews.
- `tests/service_test.ts` — fresh/stale/slow/down Trello, single in-flight fetch, HTTP surface (world,
  ETag 304, healthz, images, dotfiles 404, CSP, HEAD), image cache in `/data/img`.
- `tests/layout_test.ts`, `mask_test.ts`, `week_test.ts` — pure functions.
- `tests/pins_test.ts` — supply-chain pins: Deno version identical in the Dockerfile base, the denort
  download and every workflow install; one checksum; the test runner is that Deno; every base image
  pinned by digest; exact `deno.json` imports, frozen lock, no install scripts.
- `e2e/garden_test.ts` — headless browser on the synthetic board.

## Visual use cases

`visual/run.sh [IMAGE] [--update]` (CI: `image` job, step "Visual regression") seeds the synthetic board
(`scripts/seed.ts`), starts the image hardened with no Trello credentials (it serves that snapshot, stale),
and shoots each case below at **1400, 1024 and 390 px** (390 = a touch phone without a mouse) in a fresh
browser (no saved progress, French, UTC). It compares each shot with `visual/baseline/<id>-<width>.png`:
a shot fails when more than 0.1 % of its pixels differ by more than 24 on a channel. Shots, diffs and
`report.json` are uploaded as the `visual-<sha>` artifact; with `VISUAL_PRINT_NEW=1` a failing shot is also
printed in the log, and `node visual/from-log.mjs <log>` takes it back as a file. Node built-ins and the
runner's Chrome only (`visual/cdp.mjs`, same harness as pazka/plats); no package is installed.

**The 3D garden itself is not compared**: software WebGL with a running clock is not reproducible pixel for
pixel, so `#scene` is hidden before each shot and the cases compare the interface drawn over it. That the
garden renders and plays is the e2e test's job (`e2e/garden_test.ts`).

Always masked (layout kept, content hidden), because timers or the pigeon's position move them:
`#stale` (5 s banner), `#fs-offer` (12 s), `#toast`, `#celebrate`, `#prompt`, `.leaf`.

| id | state | how it is reached |
|---|---|---|
| L1-enter | world built, the large "enter" button | open `/`, wait for `__bastonks.ready` |
| L2-load-error | the world cannot be loaded: error text on the loading screen | `/api/world` answers 503 (intercepted in the browser) |
| T1-titles | flyover titles: thesis title, byline, "skip" | click the enter button |
| G1-garden | after the intro: counter, HUD buttons; on the phone the touch stick and buttons and the fullscreen button | enter, then "skip" |
| G2-panel | a Seed Pot's card in the side panel (kicker, title, labels, dates), counter at 1; on the phone over the touch buttons | G1, then `__bastonks.teleport(0, "pot")` |
| G3-about | the About dialog; its last line (the snapshot's date, from the seed) is masked | G1, then the About button |
| G4-help | the Controls dialog: keys and mouse options (desktop), touch controls (phone) | G1, then the "?" button |
| G5-english-about | the interface in English, About dialog | G1, the language button, then About |

Not covered visually: the garden (WebGL, see above), the Branch panel reached by flying (the e2e covers it
with the autopilot), the fullscreen offer (timer), sound.

Update the baselines only in a PR that says the visual change is wanted: `visual/run.sh IMAGE --update`
(from the CI Chrome: take the shots from the artifact or with `visual/from-log.mjs`), and look at every
picture before committing it.

## Deliberately not covered

- The real Trello API (no keys in CI; the synthetic board has the real board's shape).
- GPU rendering quality (e2e uses software GL; `tools/screenshot.ts` is for humans).

## Upgrading Deno

Dependabot bumps only the Dockerfile `FROM denoland/deno:debian-X@sha256:…`; `pins_test.ts` then fails
on purpose. Fix it with:

```bash
bash scripts/sync-deno-pin.sh   # carries X to denort ADD, ci/release/screenshot installs, DEPLOY.md
```

It fetches the new checksums from Deno's own release (`*.sha256sum`). Commit the result on the PR.

## Upgrades this suite would catch

Deno runtime/permission changes (unit + e2e + compiled-binary smoke), a base bump not carried to the
denort or CI installs, an unpinned base image, a loosened `deno.json`, a distroless change that breaks
the non-root user or `/data` writes, a `three` bump that breaks the scene (e2e).

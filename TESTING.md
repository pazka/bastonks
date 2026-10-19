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

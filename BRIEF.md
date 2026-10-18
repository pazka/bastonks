# bastonks.hosh.it — product brief

A **poetic 3D toon garden** built from the Trello board on which Salomé Klein kept the work of
her PhD, *« Détection automatique des émotions dans le discours de patients atteints de
cérébrolésions acquises »*. The visitor plays a **pigeon**: from afar the forest is simply
beautiful to look at, then the pigeon lands and lets you read every piece of the work. It's an
art piece for friends, publicly reachable. The aim is the emotion of the accomplished work. It is not a dashboard.
Owner: Alexandre (pazka). UI: **French + English** (toggle). **Desktop and mobile from v1.**

Vocabulary is binding: read `GLOSSARY.md` first (Board, Tree, Branch, Fruit, Week, Path,
Greenhouse, Seed Pot, Found, Golden Peanut, Exceptional Card, Boost, New Growth, Flyover, Masked).
Stack decision: `docs/adr/0001-deno-and-threejs.md`.

## 1. Data source (Trello) — server side only
- One private board, id in env `TRELLO_BOARD_ID`; credentials `TRELLO_KEY` + `TRELLO_TOKEN`
  (read-only scope) in env. All three are secrets set by the owner. **The board id, the board URL and any
  Trello URL must never reach the browser, the logs or the repo.**
- The browser never talks to Trello. It only calls this app's API.
- **Refresh per visit:** each visit (the world request) triggers a server fetch of the board. The
  visitor waits **up to ~3 s**; on timeout or any Trello error (down, 401, 429), the **last good
  snapshot** is served. Concurrent visits share **one in-flight fetch**. The snapshot (cleaned, see
  §2) is persisted in `/data` so a restart without Trello still serves the world. `/healthz`
  reports snapshot age and the outcome of the last fetch.
- Archived lists and archived cards are **part of the work** and must be fetched (closed included). A
  single board call with nested lists/cards/checklists/labels/attachments should suffice. Verify
  against Trello's REST docs and keep it to a few calls per visit.
- Real board shape (export of 2026-10-18): ~180 lists (most archived), ~2140 cards, 7 labels, 34
  checklists / ~215 items, 1 member. ~165 weekly lists named `DONE dd/mm/yyyy` from 2023-01 to
  2026-04. Content is mostly titles: ~74 cards have a description (up to ~2 100 chars), 6 have
  attachments (4 images), only ~15 have a cover colour, ~1 435 carry ≥ 1 label.

## 2. Privacy pipeline (before anything is stored or sent)
- **Allowlist, not blocklist.** The cleaned snapshot contains only:
  - lists: name, archived flag, position;
  - cards: name, description, labels, cover colour, checklist items (text + done), creation and
    last-activity dates, due date, archived flag, and attachment **names**;
  - images: the image attachments, as app-served URLs.

  Never included: members, comments/actions, board/card/attachment URLs, shortLinks, emails of
  members, custom fields, plugin data.
- **Masking** (server): e-mail addresses, phone numbers and patient identifiers are replaced by a
  neutral marker (e.g. `•••`) in every text field (names, descriptions, checklist items,
  attachment names). Patient identifiers seen in the data: the word *patient* followed by a
  number, and transcript codes like `047_B`. Make the patterns a tested, documented
  list. First names of people stay visible.
- **Links** inside descriptions are shown as plain text, never clickable.
- **Excluded cards:** Trello's default tip cards (names starting with `Astuce Trello`).
  **Empty lists** produce nothing.
- **Images:** fetched server-side with the token (Trello attachments require auth). Use Trello's
  pre-scaled `previews` (pick ≤ ~1024 px) and cache them in `/data`, served by the app under opaque
  ids. Non-image attachments: **name only**, no download.

## 3. From board to world (classification rules)
- **Done card** = a card in a Done list **or** an archived card (anywhere).
- **Done list** = name contains a week date, `DONE …` or a bare date like `25/11/2024`, **or** the list is
  archived. Open lists without a date = unfinished work.
- **Tree** = one list holding ≥ 1 Done card; its **Branches** = those cards. A Backlog/To-do list
  gets a Tree for its archived cards. Its other cards are **Seed Pots** in the Greenhouse.
- **Seed Pot** = a non-archived card of an open, non-done list. Cards of the open list `En cours`
  are Seed Pots **with a visible sprout**.
- **Week of a Tree**: parse the date in the list name, tolerating hand-typing: `20/11/023`,
  `19/02/24`, `18/08//2025`, `6/10/2025`, `3/11/2025`, missing `DONE`. If the parsed date doesn't
  fit the list's card activity dates (e.g. `DONE 13/05/2023` whose cards are from May 2024), or
  there is no date, derive the Week from the cards' dates. Unit-test this on fixtures copied
  from these cases.
- **Path**: the done Trees stand along one winding path in Week order. Walking it is walking
  through time (2023 → 2026).
- **Branch leaves** take the **season** of the Tree's Week (spring tender green, summer deep
  green, autumn gold/orange, winter muted). A card with its own cover colour keeps that colour.
- **Fruits**: each label is a **fruit species** (7 labels → 7 species: apple, cherry, plum, pear,
  lemon, fig, berry cluster… your choice), tinted with the label colour, hanging on the card's Branch.
- **Tree height/size** grows with its number of Branches (1 to ~40), so "climbing higher in the tree" is meaningful.

## 4. Play
- **Flyover** (on load): a short cinematic camera glide over the whole forest. It shows the
  thesis title, *Salomé Klein*, and this epigraph beneath them, verbatim with line breaks, the
  same in FR and EN:
  ```
  « And remember that bad times...
  are just times that are bad. »
  Astrid la voyante
  Animal Crossing : New Leaf
  (2013)
  ```
  Then control passes to the Pigeon. Skippable; plays every visit, shortened on return visits.
- **Pigeon**: third-person **chase camera**. It **flies** (overview, swoop) and **lands/walks/hops**
  (to inspect). It perches on branches and can climb a Tree. Keyboard + mouse and touch (virtual
  stick + buttons). Collision is hand-written (ground, trunks, canopies, Greenhouse); no
  physics engine.
- **Inspect**: near a Branch or Seed Pot, the pigeon can inspect it. A **side panel** shows the card:
  title, full description, images, checklist items (✓/○), labels (as fruits + names), Week/dates,
  attachment names. The world stays live and the pigeon can move on. The layout may change after beta.
- **Found**: a Branch or Seed Pot is Found once **inspected**; approaching it is not enough. A
  **discreet counter**, e.g. `412 / 2 130 trouvés · 3 / 12 cacahuètes`, plus a quiet
  celebratory moment at 100 %.
- **Golden Peanuts**: pickups placed next to **Exceptional Cards**. The list is **hand-curated**
  (card ids in a committed config file, initially a few placeholders; the owner will fill it).
  Each peanut gives a **Boost**:
  - glint on unfound items, visible from further away;
  - a sense of the direction of the nearest peanut;
  - faster flight;
  - a bigger inspect range;
  - easier climbing.

  Everything stays reachable without boosts. Strengths and the peanut count are tuning values,
  set in playtesting.
- **Progress** is saved in the browser (localStorage): Found ids, peanuts, boosts, and the ids
  seen last visit. No account.
- **New Growth**: Branches/Seed Pots that appeared since the last visit **grow in visibly** on
  arrival and stay **highlighted** until inspected.

## 5. Art and audio
- Cute, cel-shaded, Wind Waker-like: banded toon lighting, outlines, soft palette, forest +
  garden. All geometry built **in code** (low-poly, procedural trees from the data).
- Keep a clean seam for assets. The **pigeon model must be swappable** for a glTF later (the
  owner may bring one, converted to the toon material on load). Free CC0 packs may replace
  code-built props later.
- **Music + SFX**: a soft music loop and effects (wings, coos, pickups, inspect), **CC0 /
  free-licence only**, credited in an About panel. Mute toggle, remembered. Audio starts on the
  first user gesture (mobile autoplay rules).

## 6. UI, devices, accessibility
- FR/EN toggle; default from the browser language. Card content stays as written.
- Mobile: ~60 fps target on a mid-range phone. Cap the pixel ratio, use adaptive quality, and
  instance everything. Desktop: same world, higher quality.
- About panel: the thesis, Salomé, credits (assets, music, fonts). Respect
  `prefers-reduced-motion` (shorter Flyover, no camera shake).
- Everything served from the app's own origin (no CDN, fonts or analytics), strict CSP.

## 7. Stack and supply chain (binding — ADR 0001, box Decision #17)
- **Deno 2.9 LTS** for the server and the whole toolchain: `Deno.serve`, `@std/http` (JSR), `deno
  bundle` for the front (it is marked experimental; if it blocks you, Vite run under Deno
  permissions is the fallback, but **ask the owner first**), `deno test`, `deno fmt`/`lint`,
  `deno compile` → single binary in a distroless image, uid 10001.
- **Three.js** (pinned exact version, WebGL renderer, not WebGPU): `MeshToonMaterial` + gradient
  map, inverted-hull outlines (smoothed normals on the outline copy),
  `InstancedMesh`/`BatchedMesh` from day one, a draw-call budget of a few hundred at most.
- **The whole third-party dependency set is `three` (+ `@types/three` at dev time).** Any other
  dependency, including test, build or lint tools, needs the owner's explicit yes: name it, say
  why, and wait.
- `deno.lock` committed, `deno ci`/`--frozen` in CI, minimum dependency age ≥ 7 days,
  `trust-policy` no-downgrade, no `--allow-scripts`, exact versions and base-image digest
  pinned, Dependabot with a cooldown.
- Runtime permissions are the narrowest that work, compiled into the binary and listed in `DEPLOY.md`:
  - `--allow-net` = the Trello hosts actually needed, plus listening on :8000;
  - `--allow-read`/`--allow-write` = `/data` (static assets embedded);
  - `--allow-env` = the app's variables only;
  - never `--allow-run`, `--allow-ffi` or `--allow-sys`.

  Document the residual risk: compromised code could exfiltrate through the Trello API. The
  token is read-only, but it can read **all** of the owner's boards (accepted risk).

## 8. API (suggested)
- `GET /api/world`: the cleaned, masked snapshot shaped for the client (Trees with Week and
  Branches, Seed Pots, label→species map, Exceptional ids, snapshot timestamp, `stale` flag). ETag.
- `GET /img/<opaque-id>`: cached image previews (immutable cache headers).
- `GET /healthz`: `{"status":"ok", "snapshot_age_s":…, "last_fetch":"ok|timeout|error", "trees":…, "branches":…}`.
  `status` is ok when a snapshot exists.
- Static front-end embedded in the binary.

## 9. Box contract
Follow `docs/BOX-CONTRACT.md` (binding): one image `ghcr.io/pazka/bastonks`, port 8000, `/healthz`,
uid 10001, read-only rootfs + tmpfs `/tmp`, state in `/data`, env-only config, JSON logs on
stdout, deployed only through `hosh-deploy`. Required secrets line in `.env.example`:
`# required: TRELLO_KEY TRELLO_TOKEN TRELLO_BOARD_ID`. The image has no shell, so `POST_DEPLOY`
must use the binary itself (e.g. a `smoke` subcommand).

## 10. Capability checks (for DEPLOY.md and the box smoke)
- `/api/world` returns ≥ 100 Trees and ≥ 2 000 Branches, with no `trello.com` string, no e-mail
  or phone pattern, no `Astuce Trello` card, and the seeded patient-code fixtures masked.
- With Trello unreachable or the token wrong, `/api/world` still serves the last snapshot, flagged `stale`.
- An image id returns an image; non-image attachments have no URL.
- The front-end loads, the Flyover plays, the Pigeon can fly to a Branch, and the panel shows its card
  (Playwright headless in CI; the owner approves Playwright as a dev dependency or the builder
  proposes an alternative).

## 11. Open
- Exceptional Cards: hand-picked later by the owner from the data (config file).
- Boost strengths and the number of peanuts: tuned in playtest.
- Side-panel layout: revisit after beta.

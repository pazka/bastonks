# bastonks

https://bastonks.hosh.it — a poetic, cel-shaded 3D garden grown from the Trello board of Salomé Klein's PhD.
You are a pigeon. See BRIEF.md (spec), GLOSSARY.md (vocabulary), DEPLOY.md (deployment), docs/BOX-CONTRACT.md (box rules).

## Develop (Deno 2.9 only — no Node, no other toolchain)

```sh
deno ci                 # frozen lockfile, 7-day minimum dependency age, no install scripts
deno task build         # bundle the front-end (deno bundle) and embed it into the server
deno task dev           # http://127.0.0.1:8000 on a synthetic board (no Trello needed)
deno task check         # fmt + lint + typecheck
deno task test          # unit tests (privacy pipeline, weeks, classification, service, layout)
CHROME_PATH=… deno task e2e   # browser test: Flyover → Pigeon flies to a Branch → panel
deno task compile       # dist/bastonks, permissions compiled in (see DEPLOY.md §5)
```

Layout: `src/server` (Trello fetch, cleaning/masking, world, HTTP, smoke), `src/client` (Three.js garden),
`src/shared` (API types), `web/` (HTML/CSS), `config/exceptional.json` (hand-picked Exceptional Cards),
`tests/` + `e2e/`, `scripts/` (build, dev server, CI seed, owner secrets script).

# 0001 — Deno for the server and toolchain, Three.js for the 3D, `three` as the only dependency

Status: accepted (owner, 2026-10-18)

bastonks is a public browser game (cel-shaded 3D, desktop + mobile, about 165 Trees and 2 140 Branches) with a small
server that reads a private Trello board with a secret token. The owner's top requirement is supply-chain
safety: a dependency update must never be able to run code on dev/CI machines or reach their AI-agent
credentials, as the 2025 npm worms did (s1ngularity/nx, Shai-Hulud). The server must also be sandboxed by
design. TypeScript everywhere.

**Decision.** Deno 2.9 LTS is the server runtime *and* the whole toolchain (serve, bundle, test, fmt, lint,
compile). Three.js is the 3D engine, on the WebGL renderer. The only third-party dependency is `three`
(+ `@types/three` at dev time); any other needs the owner's yes.

**Why.** Deno does not run install scripts by default. It applies a minimum dependency age and a
provenance no-downgrade policy. It sandboxes the network, filesystem and env per host, path and
variable, including for npm code. Because it bundles its own toolchain, there are no dev-dependency
build tools, which is where the worms executed. Three.js has zero dependencies, a built-in toon material,
the largest official example corpus with an `llms.txt` for an AI builder, and a ~200 KB bundle.

**Rejected.**
- Node 24 + pnpm 11 (close second: 30-month LTS, biggest ecosystem). Its permission model is a
  self-described "seat belt" with no network gating before v25, and its toolchain needs dev dependencies.
- Bun: no sandbox at all, and its default trusted-scripts list includes `nx`.
- Babylon.js: cleanest dependency record, but its stock toon material is broken and the bundle is 1.5–3 MB.
- React Three Fiber + drei: about 65 packages from 38 publishers.

Evidence: tech-selection matrix and six primary-source reports (owner's drafts).

**Costs.** Deno LTS lines last about 6 months, so upgrade twice a year. `deno bundle` is experimental;
the fallback is Vite run under Deno permissions, after asking the owner. Three.js breaks its API between
releases, so pin the exact version.

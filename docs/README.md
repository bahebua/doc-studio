# Doc Studio — Design docs

Full documentation suite. Each doc targets a specific reader; the tables
below get you to the right entry point fast.

## Full catalogue

| Doc | Purpose | Primary audience |
|-----|---------|------------------|
| [HLD.md](HLD.md) | What the system does, layers, deployment topology, ADR summary | Onboarding engineer, architect, product |
| [LLD.md](LLD.md) | File-by-file map, algorithms, state-store internals, extension points | Engineer about to change code |
| [TDD.md](TDD.md) | Why each stack choice, threat model, performance targets, scenarios, roadmap | Reviewer assessing risk / proposing a stack change |
| [DIAGRAMS.md](DIAGRAMS.md) | Visual catalogue — every context, state, sequence, data-flow, deployment, journey, ER, and threat diagram | Anyone who thinks in pictures |
| [API.md](API.md) | `/__proxy` HTTP contract, envelopes, error taxonomy, SDK usage | Backend integrator, security reviewer |
| [STORAGE.md](STORAGE.md) | Every persisted key, JSON shapes, migrations, quota, backup / restore | Anyone touching persistence |
| [SECURITY.md](SECURITY.md) | Trust boundaries, threat model, attack tree, deployment hardening, CSP, cryptography | Security reviewer, auditor, operator |
| [OPERATIONS.md](OPERATIONS.md) | Deployment recipes, env vars, health checks, troubleshooting, incident response, SLOs | Operator, SRE, on-call |
| [BUILD.md](BUILD.md) | Vite plugin order, chunk strategy, PWA, single-file, Tauri, Capacitor, Docker, `latex.js` patch | Engineer touching the build |
| [TESTING.md](TESTING.md) | Test tiers, current coverage, Playwright plan, fixture rules | Engineer adding coverage |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, coding conventions, PR checklist, change recipes | New contributor |
| [ROADMAP.md](ROADMAP.md) | Now / next / later / speculative items with complexity | Product, tech-lead |
| [FAQ.md](FAQ.md) | Quick answers grouped by audience | Everyone |
| [GLOSSARY.md](GLOSSARY.md) | A–Z domain terms with cross-links | Anyone unsure of a term |

## Reading orders

### Onboarding engineer (0 → productive in a day)

1. [HLD.md](HLD.md) — grasp the shape.
2. [DIAGRAMS.md](DIAGRAMS.md) — skim the visual catalogue.
3. [LLD.md](LLD.md) — jump into the module map.
4. [CONTRIBUTING.md](CONTRIBUTING.md) — coding conventions and setup.
5. [GLOSSARY.md](GLOSSARY.md) — on-demand.

### Reviewer assessing risk

1. [HLD §13 ADRs](HLD.md#13-architectural-decisions-adr-summary).
2. [TDD §6 security](TDD.md#6-security).
3. [SECURITY.md](SECURITY.md).
4. [API §7 insecure-TLS](API.md#7-insecure-tls-policy).
5. [BUILD §8 latex.js patch](BUILD.md#8-latexjs-postinstall-patch) — the one non-obvious dependency dance.

### Operator / SRE

1. [OPERATIONS.md](OPERATIONS.md).
2. [SECURITY §6 deployment hardening](SECURITY.md#6-deployment-hardening).
3. [BUILD §11 Docker](BUILD.md#11-docker-build).
4. [STORAGE §7 session storage + §10 multi-workspace isolation](STORAGE.md#7-session-storage).

### Contributor fixing a bug or shipping a feature

1. [LLD §23 extension points](LLD.md#23-extension-points).
2. [CONTRIBUTING §7 change recipes](CONTRIBUTING.md#7-change-recipes).
3. [TESTING.md](TESTING.md) — where to add coverage.
4. [CONTRIBUTING §6 PR checklist](CONTRIBUTING.md#6-pr-checklist).

### Product / architect proposing a change

1. [TDD §10 roadmap](TDD.md#10-roadmap) or [ROADMAP.md](ROADMAP.md).
2. [HLD §14 non-goals](HLD.md#14-boundaries-and-non-goals).
3. [TDD §7 ADRs](TDD.md#7-architectural-decisions-adrs).

### API integrator building on `/__proxy`

1. [API.md](API.md) — full contract.
2. [DIAGRAMS §9 API workbench sequences](DIAGRAMS.md#9-api-workbench-sequences).
3. [SECURITY §3 threat model](SECURITY.md#3-full-threat-model) — SSRF + insecure-TLS.

### Diagram-first learner

- [DIAGRAMS.md](DIAGRAMS.md) alone gets you the mental model; jump to
  any linked doc when you want the prose behind a picture.

## Related documents

- [../README.md](../README.md) — user-facing feature list and quick start.
- [../DEPLOYMENT.md](../DEPLOYMENT.md) — legacy per-channel deployment
  notes (superseded by [OPERATIONS.md](OPERATIONS.md) and
  [BUILD.md](BUILD.md); kept for reference).

## Conventions used across these docs

- **File references** are markdown links to workspace-relative source
  paths — never bare backticks or plain text.
- **Diagrams** are Mermaid, inlined in the doc — no external images.
- **No timing estimates** for tasks; complexity uses S / M / L / XL
  buckets ([ROADMAP.md](ROADMAP.md)).
- **No emojis** unless the doc is directly quoting a UI element.
- **Cross-links are aggressive** — every domain term links back to
  [GLOSSARY.md](GLOSSARY.md) or its defining doc.

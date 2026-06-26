# Repository Agent Guide

Use this file as the default operating guide for the repository. More specific `AGENTS.md` files may exist in subdirectories; when they do, follow the nearest applicable file while preserving the security and change-control rules defined here.

## Core Principles

1. Understand the repository before changing it.
2. Prototype and verify locally before promoting changes to hosted environments.
3. Keep secrets and privileged operations out of browser code.
4. Preserve user work and unrelated working-tree changes.
5. Validate changes in proportion to their risk.
6. Do not deploy, push, commit, or mutate external systems without explicit authorization.
7. Prefer clear, maintainable solutions over project-specific shortcuts.

## Start With Discovery

At the beginning of a task:

1. Read this file and any nearer `AGENTS.md` files.
2. Determine whether this is an existing project or a new/empty workspace.
3. If Git exists, inspect `git status --short` before editing.
4. Identify the application or package in scope.
5. Read its `README`, architecture notes, package manifest, environment example, and framework configuration.
6. Identify the package manager from its lockfile.
7. Locate existing tests, lint scripts, build scripts, and deployment configuration.
8. Trace the actual runtime path before diagnosing or changing behavior.

Useful discovery commands:

```bash
rg --files
rg -n "relevant-pattern" .
git status --short
```

Use `rg` and `rg --files` for repository search. Avoid scanning generated dependency and build directories unless they contain framework documentation required for the task.

## Starting a New Project

There may be no repository or application yet. When the user asks to create a new project in an empty or uninitialized workspace, establish a maintainable baseline rather than assuming files already exist.

Before scaffolding:

1. Confirm the requested application type and deployment target from the user's request.
2. Inspect the directory for hidden files and user-owned content.
3. Select current stable tooling that fits the stated requirements.
4. Avoid adding services, frameworks, or infrastructure that have no current need.

Create the following baseline where applicable:

```text
.
|-- README.md
|-- AGENTS.md
|-- .gitignore
|-- .env.example
|-- package.json or equivalent manifest
|-- lockfile
|-- source directory
|-- test configuration
|-- lint/format configuration
`-- deployment configuration
```

Initialize Git when the workspace is new and the user has asked for a project to be created:

```bash
git init
git branch -M main
```

Do not create a remote, push, or publish the project without explicit authorization. Do not make an initial commit unless the user asks for commits or the surrounding workflow clearly includes repository initialization with commits.

For a newly scaffolded project:

- Pin dependencies through the chosen lockfile.
- Add development, lint, type-check, test, build, and start scripts as appropriate.
- Run the generated application locally.
- Replace scaffold placeholder content with project-relevant content.
- Remove unused example assets and dependencies.
- Verify the production build before handoff.
- Document every required setup step in `README.md`.

## README as the Project Source of Truth

Every project must have a root `README.md`. Create it immediately for a new project. For an existing project, read it before making architectural, setup, environment, persistence, or deployment changes.

The README should contain, as applicable:

- Project purpose and current status
- Primary features and intended users
- Technology stack and important versions
- Repository structure
- Prerequisites
- Installation instructions
- Local development commands
- Environment-variable setup using placeholder names only
- Database setup and migrations
- Test, lint, type-check, and build commands
- Architecture and runtime/data flow
- Persistence and state ownership
- External API/provider integrations
- Deployment and rollback process
- Production/preview environment notes
- Security and secret-handling expectations
- Known limitations and operational caveats
- Troubleshooting for common local and hosted failures

Treat README maintenance as implementation work, not optional cleanup:

- Re-read the relevant README sections before changing documented behavior.
- Update the README in the same task when commands, dependencies, directories, environment variables, API contracts, persistence, architecture, or deployment behavior change.
- Periodically compare the README against package scripts, environment examples, routes, and deployment configuration.
- Remove stale instructions rather than adding contradictory notes.
- Use copy-pasteable commands and identify their working directory.
- Never include real credentials, private URLs, or customer data.
- Before handoff, verify that a new developer could follow the README from a clean checkout.

## Determine the Active Application

Repositories may contain several implementations, such as:

- A hosted web application
- A desktop application
- A mobile client
- Shared packages
- Migration or legacy versions

Do not assume changes should be copied across implementations. Confirm which application is active from documentation, scripts, deployment configuration, and the user's request. Different applications may use different framework versions, persistence models, security boundaries, and release processes.

Unless explicitly requested, change only the implementation needed for the task. If parity across applications is desirable but outside scope, report it rather than silently expanding the change.

## Respect the Existing Technology

Use the versions and conventions installed in the repository rather than relying on remembered framework behavior.

Common technologies may include:

- TypeScript
- React
- Next.js App Router
- Tailwind CSS
- Zustand or another client-state library
- PostgreSQL or a serverless database
- Vercel or another hosted runtime
- Electron or another desktop shell

When a framework has local documentation installed, consult it for version-sensitive APIs and deprecations. Do not introduce another state library, styling system, test framework, ORM, or package manager unless there is a concrete need and the tradeoff is justified.

## Local-First Workflow

Use local development as the primary implementation and verification loop.

Typical workflow:

```bash
cd <application-directory>
<package-manager-install-command>
<development-command>
```

Examples:

```bash
npm ci
npm run dev
```

Use the lockfile to select the package manager:

- `package-lock.json`: npm
- `pnpm-lock.yaml`: pnpm
- `yarn.lock`: Yarn
- `bun.lock` or `bun.lockb`: Bun

Prefer the frozen/clean install command when the lockfile is authoritative. Use a dependency-changing install command only when intentionally updating dependencies or the lockfile.

Do not assume a running development server belongs to the current task. Before stopping a process, identify whether this task started it. Stop only task-owned processes unless the user explicitly asks otherwise.

## Environment Configuration

Use environment files for configuration that varies by machine or deployment. Use a checked-in `.env.example` to document supported variable names, ignored local `.env` files for development values, and the hosting platform's secret store for deployed values.

Typical local setup:

```bash
cp .env.example .env.local
```

Use the naming convention expected by the framework. Common patterns include:

- `.env`: shared local defaults when the framework expects it
- `.env.local`: developer-specific local values
- `.env.development`: non-secret development defaults
- `.env.test`: isolated test configuration
- `.env.production`: non-secret production defaults only when required
- `.env.example`: committed variable names and safe placeholder values

Create `.env.example` whenever the application reads environment variables. Create the appropriate ignored local environment file during setup, but leave secret values blank or instruct the user where to add them. Do not invent credentials.

Rules:

- Never commit real keys, tokens, passwords, database URLs, certificates, or private endpoints.
- Add real environment files to `.gitignore`; keep `.env.example` tracked.
- Keep `.env.example` synchronized with every environment variable read by the application.
- Add a short comment for variables whose format, scope, or optionality is not obvious.
- Validate required environment variables at startup or at the narrow feature boundary, with a clear error message.
- Never expose server credentials through public-prefixed environment variables.
- Never paste secrets into browser configuration fields, fixtures, screenshots, logs, or documentation.
- Store only an approved environment-variable identifier in browser state when the server must resolve a secret.
- Restart the local process after changing environment files unless the framework explicitly reloads them.
- Warn before overwriting an existing local environment file.
- If a secret is exposed, advise immediate revocation and replacement. Do not reuse or persist it.

Local development and hosted environments should use the same variable names where possible. Values may differ by development, preview, staging, and production environment.

## Local-to-Cloud Promotion

Use this promotion sequence:

1. Implement and exercise the change locally.
2. Test empty, loading, success, and failure states.
3. Check light and dark themes for UI work.
4. Run the relevant lint, type-check, test, and production-build commands.
5. Review the diff for secrets, generated files, and unrelated edits.
6. Use a preview or staging environment for cloud-only behavior.
7. Deploy production only when explicitly requested.
8. Smoke-test the deployment and inspect logs.

Do not treat a successful build as permission to:

- Create a commit
- Push a branch
- Open or merge a pull request
- Deploy a preview or production release
- Change hosted environment variables
- Run database migrations against shared environments
- Send messages or notifications

These actions require user intent or established repository automation that is explicitly in scope.

When deployment is authorized, deploy a reviewed commit rather than an ambiguous working-tree state. Record the deployed target and perform a focused smoke test afterward.

## Runtime Boundaries

### Browser-owned work

Appropriate browser responsibilities include:

- UI state
- Non-sensitive preferences
- Draft inputs
- Local profile selection
- Display-only transformations
- Calls to internal application APIs

Do not store secrets in `localStorage`, `sessionStorage`, IndexedDB, browser-readable cookies, or client state.

### Server-owned work

Keep these server-side:

- Resolving secret environment variables
- Calling privileged third-party APIs
- Database access
- Signing requests
- Fetching trusted external catalogues
- Validating and normalizing upstream responses
- Authorization and access control

Do not import server-only modules into client components. Use narrow internal API contracts between browser and server.

### Desktop applications

For Electron-style applications:

- Keep filesystem, environment, network, and OS operations in the main process.
- Expose a constrained preload bridge.
- Keep context isolation enabled.
- Do not expose unrestricted Node.js access to the renderer.
- Validate IPC inputs as if they came from an untrusted client.

## SSR and Hydration

Server-rendered React must produce deterministic initial HTML.

Be careful with:

- `localStorage` and other browser-only APIs
- `window` and `document`
- Theme/media-query state
- `Date.now()`, random IDs, and locale-dependent formatting
- Data that differs between server and browser initialization
- Invalid HTML nesting

Use a deterministic server snapshot, an explicit hydration boundary, or framework-supported client-only loading where appropriate. After changing persistence or startup state, hard-refresh with populated browser storage and check the browser console for hydration errors.

## State and Persistence

Before changing state, classify it as:

- Server-persisted shared state
- Browser-persisted user/device state
- Session-only state
- Transient runtime state

Document the intended owner and lifetime. Add migrations for persisted shape changes. Do not silently discard existing browser or database state.

Profile-like browser configuration is local to that browser unless backed by user accounts and server synchronization. Make this limitation visible in the UI and documentation.

Avoid treating missing persistence as zero, free, successful, or configured. Unknown states should remain explicit.

## API and Provider Integrations

Treat all external API integrations as security-sensitive.

- Validate request shape and size at the server boundary.
- Allowlist supported provider types, credential identifiers, protocols, and outbound hosts.
- Prevent server-side request forgery.
- Prevent arbitrary environment-variable lookup from client input.
- Preserve TLS verification.
- Set sensible timeouts.
- Bound response sizes where practical.
- Normalize upstream errors without leaking authorization headers, cookies, or key-bearing URLs.
- Distinguish an application-route failure from an upstream-provider failure.
- Handle rate limits and retryable failures deliberately; do not blindly retry non-idempotent operations.

When constructing provider endpoints, handle base URLs consistently and avoid duplicated path segments. Preserve provider-specific authentication, body formats, and usage fields instead of forcing every provider through a superficially similar contract.

If model or feature capabilities are inferred from identifiers or metadata, label them as inferred guidance. Do not present heuristics as provider guarantees.

## External Data and Pricing

For applications using metered APIs, retain the unit and provenance of every price.

Possible sources, from strongest to weakest, are:

1. Contractual/manual override
2. Machine-readable data from the configured provider
3. A maintained external catalogue
4. A database or bundled fallback
5. Unknown

Do not silently treat unknown pricing as free. Do not overwrite authoritative or manual values with weaker catalogue data.

When importing an external catalogue:

- Fetch it server-side.
- Parse data rather than executing a package solely to access its dataset.
- Validate numeric values, units, identifiers, and response size.
- Cache with a deliberate freshness period.
- Show source, retrieval time, imported count, skipped count, and unmatched reasons.
- Preserve existing non-zero overrides unless the user explicitly requests replacement.

Do not force incompatible billing models into a simple token-price schema. Image generation, audio, transcription, video, tools, caching, batch processing, long-context tiers, and enterprise contracts may use different units.

## Database Changes

Treat local, preview, staging, and production databases as separate environments.

- Do not run shared-environment migrations without explicit authorization.
- Prefer additive and reversible migrations.
- Backfill separately when it reduces lock time or risk.
- Update setup scripts, migration scripts, types, queries, fixtures, and documentation together.
- Define behavior when the database is unavailable locally.
- Do not hide connectivity errors behind empty successful responses unless the API contract explicitly calls for a fallback.

For destructive or irreversible changes, provide a rollback or recovery plan before execution.

## UI and Accessibility

- Support all established themes.
- Check semantic colours independently in light and dark modes.
- Do not reuse pale dark-theme text colours directly on white backgrounds.
- Do not rely on colour alone for status or selection.
- Maintain visible keyboard focus.
- Use semantic controls and associated labels.
- Ensure disabled controls remain legible while clearly inactive.
- Avoid applying opacity to a whole container when it makes text and inputs unreadable.
- Keep error details readable and copyable.
- Make inferred, stale, local-only, and authoritative data visually distinct.
- Check responsive layouts at narrow and wide widths.

Prefer explicit theme pairs for semantic colours, for example:

```text
text-red-800 dark:text-red-300
text-emerald-700 dark:text-emerald-400
```

Follow the project's design system rather than introducing isolated colours or components.

## Error Handling and Logging

Errors should help identify the failing boundary:

- Input validation
- Application route
- Database
- External provider
- Browser/network

Include safe context such as provider name, operation, HTTP status, and a sanitized upstream response. Exclude secrets, authorization headers, cookies, full environment values, and sensitive user content.

Do not use broad catches that convert programming errors into misleading success responses. Do not log complete request bodies by default when they can contain user files, prompts, or credentials.

## Validation Strategy

Use the scripts defined by the active package. A typical TypeScript web application may require:

```bash
<lint-command>
<typecheck-command>
<test-command>
<production-build-command>
```

Test proportionally:

- UI-only change: lint, build/type-check, and inspect affected states/themes.
- Store change: reload, persistence migration, profile switching, and hydration.
- API change: validation, success, upstream failure, timeout, and safe error response.
- Provider change: discovery plus one minimal request without logging credentials.
- Pricing change: exact matching, unit conversion, precedence, unsupported units, and existing-value preservation.
- Database change: migration on a disposable database plus rollback/recovery review.
- Desktop change: build plus interactive IPC verification.

If a command fails because of the environment, distinguish that from a code failure. Examples include unavailable network access, missing optional database configuration, or a font downloaded during a production build.

Report:

- Commands run
- Pass/fail result
- New errors
- Existing warnings
- Anything not verified

Do not claim tests passed if they were not run.

## Editing Discipline

- Preserve existing code style and architecture.
- Keep changes scoped to the request.
- Use small, reviewable patches.
- Prefer existing utilities and components over duplication.
- Avoid unrelated formatting or dependency churn.
- Update documentation when setup, persistence, APIs, environment variables, pricing units, or deployment behavior changes.
- Add comments for non-obvious constraints, not for restating code.
- Do not leave inert controls that appear functional.
- Do not add speculative abstractions without a current consumer.

## Git and Filesystem Safety

- Existing modifications and untracked files belong to the user unless proven otherwise.
- Do not revert, overwrite, stage, or commit unrelated work.
- Do not use destructive Git commands to clean the workspace.
- Never commit real environment files, credentials, dependency directories, build output, local databases, logs, or temporary screenshots.
- Placeholder-only environment examples are expected and should be updated when variable names change.
- Check `git diff --check` before handoff.
- Review `git status --short` and the final diff before any authorized commit.

## Communication

- Lead with the outcome.
- State assumptions that affect behavior or scope.
- Distinguish facts observed in the repository from recommendations.
- Surface security and data-loss risks directly.
- Report blockers with the exact missing input or permission.
- Do not bury failed verification behind a general success statement.

## Definition of Done

A change is complete when:

- It addresses the requested behavior in the correct application.
- Local and hosted implications are understood.
- Secrets and privileged operations remain in the correct runtime.
- Persistence and hydration remain deterministic.
- External data retains correct units and provenance.
- Established themes and accessibility states remain usable.
- Relevant checks pass, or limitations are reported precisely.
- Documentation is updated where behavior or setup changed.
- A root README exists, accurately describes setup and operation, and has been checked against the implementation.
- Environment variables are documented in `.env.example`, real values remain ignored, and local/hosted setup is described in the README.
- No unrelated user work was changed.
- External mutations occur only with explicit authorization.
- Any authorized deployment is followed by a focused smoke test.

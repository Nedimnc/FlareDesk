# FlareDesk

Greenfield repository — application code has not been added yet.

## Cursor Cloud specific instructions

### Repository state

- Tracked content is currently limited to `README.md` (project name only).
- There is no `package.json`, Docker setup, CI config, or runnable service in this repo yet.

### Services

No local services need to be started until application code and manifests are added.

### Lint / test / build / run

Not applicable until a stack is chosen and committed (e.g. Next.js, API server, monorepo tooling). When manifests appear, use the scripts defined in `package.json` (or the stack’s documented commands) and update this section with ports and startup notes.

### VM tooling (available without repo setup)

- Node.js v22 + npm
- Python 3.12
- Git

### After scaffolding

When dependencies are added, the VM update script will install them automatically if `package-lock.json` or `pnpm-lock.yaml` exists. Start any dev server using the project’s documented command (for example `npm run dev`) in a tmux session so it stays attached for manual testing.

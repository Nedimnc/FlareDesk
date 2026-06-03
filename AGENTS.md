# FlareDesk

## Cursor Cloud specific instructions

### Services

| Service | Command | Port |
|---------|---------|------|
| API + dashboard | `npm start` | 3000 |

Run `npm run seed` before first demo if the SQLite DB is empty.

### Commands

- **Install:** `npm install`
- **Test:** `npm test`
- **Lint:** No ESLint configured yet

### Environment

Copy `.env.example` to `.env`. Set `ANTHROPIC_API_KEY` for live Claude analysis; without it, the analyzer uses a development heuristic fallback.

### Notes

- Use tmux for long-running `npm start` in Cloud sessions.
- `GET /api/config` exposes the demo API key to the browser — intentional for MVP only.

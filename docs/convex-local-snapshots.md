# Convex local snapshots

Redline wraps the Convex CLI so a local Convex deployment can be saved and restored next to a
`redline compare` run.

```
redline snapshot [--root <dir>] [--out <file>]
redline restore  [--root <dir>] [--replace] [--yes] [--allow-prod] <file>
```

`snapshot` runs `npx convex export --include-file-storage --path <file>` in `--root` (default:
current directory) and writes the zip to `.redline/convex-snapshot.zip`. It also writes
`.redline/convex-snapshot.json` with the time, the command and a pointer to this page.
`restore` runs `npx convex import [--replace] [--yes] <file>`. Both commands act on the deployment the
Convex CLI has selected. Neither copies database files.

## Production guard

`redline restore` and `redline compare` with `dataSnapshot` check the target deployment before
they run `npx convex import`. Redline reads, in this order, from the environment first and then
from `.env.local` and `.env` in the directory the import runs in (`--root`, or
`dataSnapshot.convexDir`):

1. `CONVEX_DEPLOY_KEY`. Only the part before `|` is read (`prod:<name>`, `dev:<name>`,
   `preview:<name>`). The secret after `|` is never printed or stored.
2. `CONVEX_DEPLOYMENT`, such as `dev:happy-otter-123`, `local:<name>` or `anonymous:<name>`.
3. A Convex URL: `CONVEX_SELF_HOSTED_URL`, `CONVEX_URL`, `VITE_CONVEX_URL` or
   `NEXT_PUBLIC_CONVEX_URL`. `localhost` and `127.0.0.1` are local. Any other host, such as
   `*.convex.cloud`, is unknown, because the URL does not say whether it is prod or dev.

Before each import Redline prints the target:

```
redline: replacing data in Convex deployment dev:happy-otter-123 (from CONVEX_DEPLOYMENT in .env.local)
```

It refuses, and runs no import, when the target is `prod` or unknown (a cloud URL alone, a deploy
key without a deployment name, or nothing found). Unknown is refused because it may be prod. To
import anyway, pass `--allow-prod` to `restore` or `compare`, or set `"allowProd": true` in
`dataSnapshot` in `redline.config.json`. For an unknown target, the better fix is to set
`CONVEX_DEPLOYMENT` (for example `local:<name>`) in `.env.local`. `compare` checks the target
before it builds anything.

This guard reads what Redline can see. A `--deployment` flag or other Convex CLI settings that
Redline does not read are not checked.

## Sources

- Local deployments: https://docs.convex.dev/cli/local-deployments
- CLI (export and import): https://docs.convex.dev/cli
- Import and export: https://docs.convex.dev/database/import-export
- Agent mode: https://docs.convex.dev/cli/agent-mode
- Self-hosting: https://docs.convex.dev/self-hosting
- Convex JS changelog (the `--local` change below). Not re-read when this page was written.

## Run a local backend

`npx convex dev --local` was removed. Select a local deployment instead:

```
npx convex deployment select local          # existing project
npx convex deployment create local --select # new local deployment
npx convex dev                              # starts the backend
```

The local backend runs as a subprocess of `npx convex dev`. Stop that command and the backend
stops. Export and import need the backend to be running, so keep `npx convex dev` open in
another terminal.

Pick ports with `npx convex dev --local-cloud-port 3210 --local-site-port 3211`. Convex keeps
the choice in the local config. Check the flags with `npx convex dev --help` for your CLI
version.

## Where state lives

State is in `.convex/` in the project directory. Each worktree or clone has its own `.convex/`,
so several local backends can run at once from separate directories. Give each its own ports
when two would otherwise collide.

## Export and import

Export, including stored files:

```
npx convex export --path snapshot.zip --include-file-storage
npx convex export --deployment local --path snapshot.zip --include-file-storage
```

Import a zip (one directory per table, each holding `documents.jsonl`):

```
npx convex import snapshot.zip
```

Flags from the CLI reference at https://docs.convex.dev/cli/reference/import:

| Flag | Effect |
| --- | --- |
| (none) | Default. Convex does not say what happens to tables that already hold data. Test on a scratch deployment first. |
| `--append` | Append imported data to existing tables. |
| `--replace` | Replace all existing data in the tables in the import. `redline restore --replace` passes this. |
| `--replace-all` | Replace all data in the deployment. Deletes tables that are in neither the import nor the schema. `redline restore` does not pass this. |
| `-y, --yes` | Skip the confirmation prompt when documents will be deleted. |
| `--deployment <name>` | Target a named deployment, `dev`, `prod` or `local`. |

`--table` is for csv, jsonLines and jsonArray files and does not work with zip files.

## Self-hosted backend

The open-source backend can run with its own port and data directory. Copying its SQLite file and
storage directory works in principle but Convex does not document it as supported. Prefer export
and import. Never copy the SQLite file while the backend is running.

## Caveats

- Local deployments are beta.
- They are not for production. Development logs and stack traces go to connected clients.
- Logs clear on each `npx convex dev` restart.
- A local deployment has no public URL, so webhooks cannot reach it.
- Safari blocks requests to localhost, so the dashboard does not work there.
- A snapshot is customer data when the deployment holds any. Keep it out of git. `.redline/` is
  already ignored in this repository.

## Errors

If the Convex CLI is missing, the deployment is not running, or the export fails, Redline prints the
failed command and a pointer to this page, and exits with code 1.

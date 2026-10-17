# Convex local snapshots

Redline wraps the Convex CLI so a local Convex deployment can be saved and restored next to a
`redline compare` run.

```
redline snapshot [--root <dir>] [--out <file>]
redline restore  [--root <dir>] [--replace] <file>
```

`snapshot` runs `npx convex export --include-file-storage --path <file>` in `--root` (default:
current directory) and writes the zip to `.redline/convex-snapshot.zip`. It also writes
`.redline/convex-snapshot.json` with the time, the command and a pointer to this page.
`restore` runs `npx convex import [--replace] <file>`. Both commands act on the deployment the
Convex CLI has selected. Neither copies database files.

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

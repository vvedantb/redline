#!/usr/bin/env node
// Publish step for changesets/action.
// Publishes with `changeset publish --no-git-tag`, then tags vX.Y.Z and
// creates the GitHub release from packages/redline/CHANGELOG.md.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const out = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8' }).trim()

const pkgPath = 'packages/redline/package.json'
const { name, version } = JSON.parse(readFileSync(pkgPath, 'utf8'))
const tag = `v${version}`

// Skip if this version is already on npm (nothing to publish).
let published = false
try {
  published = out('npm', ['view', `${name}@${version}`, 'version']) === version
} catch {
  published = false
}

// Nothing to do when this version is already on npm. No tag or release backfill.
if (published) {
  console.log(`${name}@${version} already on npm; skipping publish, tag and release.`)
  process.exit(0)
}

// Throws (non-zero exit) if publish fails, so no tag or release is created.
run('npx', ['changeset', 'publish', '--no-git-tag'])

const tagExists = out('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]) !== ''
if (!tagExists) {
  run('git', ['tag', tag])
  run('git', ['push', 'origin', `refs/tags/${tag}`])
}

// Release notes: the section for this version in the package CHANGELOG.
let notes = ''
const changelog = 'packages/redline/CHANGELOG.md'
if (existsSync(changelog)) {
  const lines = readFileSync(changelog, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${version}`)
  if (start !== -1) {
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
    if (end === -1) end = lines.length
    notes = lines.slice(start + 1, end).join('\n').trim()
  }
}
if (!notes) notes = `Release ${tag}`

let releaseExists = true
try {
  out('gh', ['release', 'view', tag])
} catch {
  releaseExists = false
}
if (!releaseExists) {
  run('gh', ['release', 'create', tag, '--title', tag, '--verify-tag', '--notes', notes])
}

// changesets/action detects publishes from this output line.
console.log(`New tag: ${name}@${version}`)

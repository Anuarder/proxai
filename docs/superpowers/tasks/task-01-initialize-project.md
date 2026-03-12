# Task 1: Initialize Project

**Chunk:** 1 — Project Scaffolding + Config
**Dependencies:** None
**Status:** Not started

## Description

Set up the Node.js/TypeScript project with all dependencies, build tooling, and git repo.

## Files

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

## Acceptance Criteria

- [ ] `npm install` runs without errors
- [ ] `npx tsc --noEmit` succeeds (no type errors in empty project)
- [ ] `package.json` has `"type": "module"` and scripts: `dev`, `build`, `start`, `test`, `test:watch`
- [ ] `tsconfig.json` targets ES2022 with Node16 module resolution
- [ ] `.gitignore` excludes `node_modules/`, `dist/`, `*.db`, `*.db-wal`, `*.db-shm`
- [ ] Git repo initialized with initial commit

## Steps

- [ ] 1. Run `npm init -y` in `/home/anuarder/Documents/Projects/proxai`
- [ ] 2. Install runtime deps: `express`, `better-sqlite3`, `js-yaml`, `zod`, `uuid`
- [ ] 3. Install dev deps: `typescript`, `@types/express`, `@types/better-sqlite3`, `@types/js-yaml`, `@types/uuid`, `@types/node`, `tsx`, `vitest`, `supertest`, `@types/supertest`
- [ ] 4. Create `tsconfig.json` (ES2022, Node16, strict, outDir: dist, rootDir: src)
- [ ] 5. Add `"type": "module"` and scripts to `package.json`
- [ ] 6. Create `.gitignore`
- [ ] 7. `git init && git add && git commit -m "chore: scaffold proxai project"`

## Commit Message

```
chore: scaffold proxai project
```

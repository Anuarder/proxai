# Task 1: Initialize Project

**Chunk:** 1 — Project Scaffolding + Config
**Dependencies:** None
**Status:** Done

## Description

Set up the Node.js/TypeScript project with all dependencies, build tooling, and git repo.

## Files

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

## Acceptance Criteria

- [x] `npm install` runs without errors
- [x] `npx tsc --noEmit` succeeds (no type errors in empty project)
- [x] `package.json` has `"type": "module"` and scripts: `dev`, `build`, `start`, `test`, `test:watch`
- [x] `tsconfig.json` targets ES2022 with Node16 module resolution
- [x] `.gitignore` excludes `node_modules/`, `dist/`, `*.db`, `*.db-wal`, `*.db-shm`
- [x] Git repo initialized with initial commit

## Steps

- [x] 1. Run `npm init -y` in `/home/anuarder/Documents/Projects/proxai`
- [x] 2. Install runtime deps: `express`, `better-sqlite3`, `js-yaml`, `zod`, `uuid`
- [x] 3. Install dev deps: `typescript`, `@types/express`, `@types/better-sqlite3`, `@types/js-yaml`, `@types/uuid`, `@types/node`, `tsx`, `vitest`, `supertest`, `@types/supertest`
- [x] 4. Create `tsconfig.json` (ES2022, Node16, strict, outDir: dist, rootDir: src)
- [x] 5. Add `"type": "module"` and scripts to `package.json`
- [x] 6. Create `.gitignore`
- [x] 7. `git init && git add && git commit -m "chore: scaffold proxai project"`

## Commit Message

```
chore: scaffold proxai project
```

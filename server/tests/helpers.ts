import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '../src/db/database.js'
import { buildApp } from '../src/app.js'

let dbReady = false

/**
 * A built app on a throwaway database and an empty client directory.
 * The database is initialised once per process — `initDb` holds a module-level
 * handle, so a second call would swap it under an app already using it.
 */
export async function testApp(authToken: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tty-test-'))
  if (!dbReady) {
    initDb(join(dir, 'db.sqlite'))
    dbReady = true
  }
  const clientDist = join(dir, 'client')
  mkdirSync(clientDist, { recursive: true })
  writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>tty</title>')
  return buildApp({ authToken, clientDist, logger: false })
}

/** The signed cookie a successful login hands out, as a request header. */
export function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
  if (!raw) throw new Error('no set-cookie header on the login response')
  return raw.split(';')[0]
}

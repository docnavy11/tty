import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testApp, cookieFrom } from './helpers.js'

const TOKEN = 'a-long-enough-test-token'

test('with no AUTH_TOKEN the app is open', async (t) => {
  const app = await testApp('')
  t.after(() => app.close())

  const health = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(health.statusCode, 200)
  assert.deepEqual(health.json(), { ok: true })

  const status = await app.inject({ method: 'GET', url: '/api/auth/status' })
  assert.deepEqual(status.json(), { authEnabled: false, authenticated: true })
})

test('with AUTH_TOKEN every route needs the cookie', async (t) => {
  const app = await testApp(TOKEN)
  t.after(() => app.close())

  for (const url of ['/api/health', '/api/sessions', '/api/projects', '/api/settings']) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 401, `${url} must be refused without a cookie`)
  }
})

test('the auth endpoints stay reachable so you can log in', async (t) => {
  const app = await testApp(TOKEN)
  t.after(() => app.close())

  const status = await app.inject({ method: 'GET', url: '/api/auth/status' })
  assert.equal(status.statusCode, 200)
  assert.deepEqual(status.json(), { authEnabled: true, authenticated: false })
})

test('a wrong password is refused and sets no cookie', async (t) => {
  const app = await testApp(TOKEN)
  t.after(() => app.close())

  const res = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { password: 'wrong' },
  })
  assert.equal(res.statusCode, 401)
  assert.equal(res.headers['set-cookie'], undefined)
})

test('an empty password is refused — it must not pass as "no token"', async (t) => {
  const app = await testApp(TOKEN)
  t.after(() => app.close())

  for (const payload of [{ password: '' }, {}]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload })
    assert.equal(res.statusCode, 401)
  }
})

test('the right password opens every route, and the cookie is httpOnly', async (t) => {
  const app = await testApp(TOKEN)
  t.after(() => app.close())

  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { password: TOKEN },
  })
  assert.equal(login.statusCode, 200)

  const setCookie = login.headers['set-cookie']
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie)
  assert.match(raw, /HttpOnly/i, 'the session cookie must not be readable from JavaScript')
  assert.match(raw, /SameSite=Strict/i)

  const cookie = cookieFrom(setCookie)
  const health = await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })
  assert.equal(health.statusCode, 200)

  const status = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } })
  assert.deepEqual(status.json(), { authEnabled: true, authenticated: true })
})

test('a forged cookie does not pass the signature check', async (t) => {
  const app = await testApp(TOKEN)
  t.after(() => app.close())

  for (const cookie of ['tty_auth=ok', 'tty_auth=ok.notasignature', 'tty_auth=']) {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })
    assert.equal(res.statusCode, 401, `${cookie} must not authenticate`)
  }
})

test('logout clears the cookie', async (t) => {
  const app = await testApp(TOKEN)
  t.after(() => app.close())

  const res = await app.inject({ method: 'POST', url: '/api/auth/logout' })
  assert.equal(res.statusCode, 200)
  const raw = String(res.headers['set-cookie'])
  assert.match(raw, /tty_auth=;/, 'the cookie is emptied')
})

test('unknown API and websocket paths return JSON, not the SPA shell', async (t) => {
  const app = await testApp('')
  t.after(() => app.close())

  for (const url of ['/api/does-not-exist', '/ws/nope']) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.json(), { error: 'Not found' })
  }
})

test('an unknown page falls back to the client shell', async (t) => {
  const app = await testApp('')
  t.after(() => app.close())

  const res = await app.inject({ method: 'GET', url: '/some/deep/route' })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /<title>tty<\/title>/)
})

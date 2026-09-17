import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLoopbackHost, mustRefuseToServe } from '../src/app.js'

test('loopback addresses are recognised', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1']) assert.equal(isLoopbackHost(h), true, h)
  for (const h of ['0.0.0.0', '::', '100.64.0.1', '192.168.1.10', 'tty.example.com']) {
    assert.equal(isLoopbackHost(h), false, h)
  }
})

test('a network bind with no password is refused', () => {
  assert.equal(
    mustRefuseToServe({ host: '0.0.0.0', authToken: '', allowPublicNoAuth: false }),
    true,
    'the whole point: an unauthenticated remote shell must not start',
  )
})

test('loopback with no password is allowed — the machine is the boundary', () => {
  assert.equal(mustRefuseToServe({ host: '127.0.0.1', authToken: '', allowPublicNoAuth: false }), false)
})

test('a network bind with a password is allowed', () => {
  assert.equal(mustRefuseToServe({ host: '0.0.0.0', authToken: 'a-long-token', allowPublicNoAuth: false }), false)
})

test('the override allows a network bind with no password', () => {
  assert.equal(mustRefuseToServe({ host: '0.0.0.0', authToken: '', allowPublicNoAuth: true }), false)
})

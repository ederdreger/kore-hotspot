import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('a Wiki e publica e pode ser acessada pelos pontos principais do sistema', () => {
  const app = read('src/App.jsx')
  const login = read('src/pages/Login.jsx')
  const sidebar = read('src/components/layout/Sidebar.jsx')
  const topbar = read('src/components/layout/TopBar.jsx')

  assert.match(app, /path="\/wiki"/)
  assert.match(login, /to="\/wiki"/)
  assert.match(sidebar, /to="\/wiki"/)
  assert.match(sidebar, /v\{__APP_VERSION__\} - by@SpedyNet/)
  assert.match(topbar, /to="\/wiki"/)
})

test('a Wiki cobre instalacao, tenants, MikroTik, UniFi, vouchers e diagnostico', () => {
  const content = read('src/data/wikiContent.js')
  const requiredSections = [
    'visao-geral',
    'instalacao',
    'primeiro-acesso',
    'mikrotik',
    'unifi',
    'acesso',
    'radius',
    'operacao',
  ]

  for (const section of requiredSections) {
    assert.match(content, new RegExp(`id: '${section}'`))
  }
  assert.match(content, /install-wizard\.sh/)
  assert.match(content, /flash\/kore-hotspot/)
})

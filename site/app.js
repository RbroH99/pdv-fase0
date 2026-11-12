// Prueba de accesibilidad de Fase 0 (ver docs/01-propuesta-stack.md §5).
// Sin dependencias y en JS "clásico" para que funcione en Android antiguos.
(function () {
  'use strict';

  var C = window.FASE0_CONFIG;
  var OUTBOX_KEY = 'fase0.outbox';
  var LAST_KEY = 'fase0.last';
  var $ = function (s) { return document.querySelector(s); };

  // ---------- utilidades ----------
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function now() { return Math.round(performance.now()); }
  function median(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }
  function bust(url) { return url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(); }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* almacenamiento no disponible */ }
  }

  function timedFetch(url, opts, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var t0 = now();
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 20000);
    var o = Object.assign({ cache: 'no-store' }, opts || {});
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o)
      .then(function (r) {
        return r.arrayBuffer().then(function (b) {
          return { ok: r.ok, status: r.status, ms: now() - t0, bytes: b.byteLength };
        });
      })
      .catch(function (e) { return { ok: false, error: e.name || 'error', ms: now() - t0 }; })
      .then(function (res) { clearTimeout(timer); return res; });
  }

  function probeImage(url, ms) {
    return new Promise(function (resolve) {
      var img = new Image();
      var t0 = now();
      var done = false;
      function finish(res) { if (!done) { done = true; resolve(res); } }
      var timer = setTimeout(function () { img.src = ''; finish({ ok: false, error: 'timeout', ms: ms }); }, ms || 20000);
      img.onload = function () { clearTimeout(timer); finish({ ok: true, ms: now() - t0 }); };
      img.onerror = function () { clearTimeout(timer); finish({ ok: false, error: 'error', ms: now() - t0 }); };
      img.src = bust(url);
    });
  }

  // ---------- interfaz ----------
  function step(label, res, detail) {
    var li = document.createElement('li');
    var mark = res === null ? '…' : (res ? '✅' : '❌');
    li.innerHTML = '<span class="' + (res ? 'ok' : 'bad') + '">' + mark + '</span> ' + label + (detail ? ' — ' + detail : '');
    $('#steps').appendChild(li);
  }

  // ---------- envío con cola (mismo patrón "outbox" que tendrá el sistema real) ----------
  function enqueue(report) {
    var box = load(OUTBOX_KEY, []);
    box.push(report);
    save(OUTBOX_KEY, box);
  }

  function flush() {
    var box = load(OUTBOX_KEY, []);
    if (!box.length || !navigator.onLine) return Promise.resolve(box.length);
    return box.reduce(function (p, report) {
      return p.then(function (pending) {
        return fetch('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': report.id },
          body: JSON.stringify(report)
        }).then(function (r) { return r.ok ? pending : pending.concat([report]); })
          .catch(function () { return pending.concat([report]); });
      });
    }, Promise.resolve([])).then(function (pending) {
      save(OUTBOX_KEY, pending);
      return pending.length;
    });
  }

  function showSendStatus(pending) {
    $('#send-status').textContent = pending
      ? '⏳ Resultados guardados en el teléfono; se enviarán solos cuando haya conexión. También puedes enviarlos por WhatsApp.'
      : '✅ Resultados enviados. ¡Gracias!';
  }

  function summary(r) {
    var t = r.tests;
    var lines = [
      'Prueba PDV — ' + r.host,
      r.form.alias + ' · ' + r.form.province + ' · ' + r.form.network + (r.form.vpn === 'si' ? ' · VPN' : ''),
      'Carga página: ' + (t.navigation ? t.navigation.loadMs + ' ms' : '?'),
      'Descarga: ' + (t.download.ok ? t.download.kbps + ' KB/s' : 'FALLÓ'),
      'API ' + (C.apiRegion || '') + ' vía proxy: ' + t.proxyPing.okCount + '/' + t.proxyPing.total + ' ok, mediana ' + t.proxyPing.medianMs + ' ms',
      'API ' + (C.apiRegion || '') + ' directa: ' + t.directPing.okCount + '/' + t.directPing.total + ', mediana ' + t.directPing.medianMs + ' ms'
    ].concat(Object.keys(t.apis || {}).map(function (name) {
      var a = t.apis[name];
      return 'API ' + name + ': proxy ' + a.proxyPing.okCount + '/' + a.proxyPing.total + ' (' + a.proxyPing.medianMs + ' ms), directa ' + a.directPing.okCount + '/' + a.directPing.total + ' (' + a.directPing.medianMs + ' ms)';
    })).concat([
      'Otros hosts: ' + t.candidates.map(function (c) { return c.name + (c.ok ? ' ok' : ' NO'); }).join(', '),
      'YouTube: ' + (t.youtubeThumb.ok ? 'ok' : 'NO') + ' · Almacenamiento: ' + (t.storage ? (t.storage.ok ? 'ok' : 'NO') : 'n/a'),
      'id: ' + r.id
    ]);
    return lines.join('\n');
  }

  function showActions(report) {
    var text = summary(report);
    $('#actions').hidden = false;
    $('#copy').onclick = function () {
      var done = function () { $('#copy').textContent = 'Copiado ✅'; };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallbackCopy);
      else fallbackCopy();
      function fallbackCopy() {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* sin portapapeles */ }
        ta.remove();
      }
    };
    $('#whatsapp').href = 'https://wa.me/' + (C.whatsappNumber || '') + '?text=' + encodeURIComponent(text);
  }

  // ---------- pruebas ----------
  function pingSeries(url, n, opts) {
    var samples = [];
    var seq = Promise.resolve();
    for (var i = 0; i < n; i++) {
      seq = seq.then(function () { return timedFetch(url, opts).then(function (r) { samples.push(r); }); });
    }
    return seq.then(function () {
      var oks = samples.filter(function (s) { return s.ok; });
      return { total: samples.length, okCount: oks.length, medianMs: median(oks.map(function (s) { return s.ms; })), samples: samples };
    });
  }

  function runExtraApis(t) {
    t.apis = {};
    return (C.extraApis || []).reduce(function (p, api) {
      return p.then(function () {
        var res = {};
        return timedFetch(api.proxyPath + '/ping', null, 90000).then(function (warm) {
          res.warmup = warm;
          return pingSeries(api.proxyPath + '/ping', 5);
        }).then(function (proxy) {
          res.proxyPing = proxy;
          step('API ' + api.name + ' vía proxy', proxy.okCount === proxy.total, proxy.okCount + '/' + proxy.total + ', mediana ' + proxy.medianMs + ' ms');
          return pingSeries(api.directUrl + '/api/ping', 3, { mode: 'cors' });
        }).then(function (direct) {
          res.directPing = { total: direct.total, okCount: direct.okCount, medianMs: direct.medianMs };
          step('API ' + api.name + ' directa', direct.okCount > 0, direct.okCount + '/' + direct.total + ', mediana ' + direct.medianMs + ' ms');
          t.apis[api.name] = res;
        });
      });
    }, Promise.resolve());
  }

  function runTests(form) {
    var report = {
      id: uid(),
      type: 'run',
      version: 1,
      host: location.host,
      provider: C.provider,
      startedAt: new Date().toISOString(),
      form: form,
      ua: navigator.userAgent,
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData
      } : null,
      tests: {}
    };
    var t = report.tests;

    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav) {
      t.navigation = {
        ttfbMs: Math.round(nav.responseStart - nav.requestStart),
        domReadyMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd),
        transferBytes: nav.transferSize
      };
      step('Página cargada', true, t.navigation.loadMs + ' ms');
    }

    // 1. Despertar la API (Render Free se suspende): se mide aparte y no cuenta en la mediana.
    return timedFetch('/api/ping', null, 90000).then(function (warm) {
      t.warmup = warm;
      step('API ' + (C.apiRegion || '') + ' (primer contacto)', warm.ok, warm.ok ? warm.ms + ' ms' : (warm.error || warm.status));
      // 2. Descarga de ~150 KB (tamaño objetivo del JS inicial del sistema nuevo).
      return timedFetch(bust('/assets/payload.bin'));
    }).then(function (dl) {
      dl.kbps = dl.ok && dl.ms ? Math.round(dl.bytes / 1024 / (dl.ms / 1000)) : null;
      t.download = dl;
      step('Descarga de 150 KB', dl.ok, dl.ok ? (dl.ms / 1000).toFixed(1) + ' s (' + dl.kbps + ' KB/s)' : dl.error);
      // 3. API a través del proxy del mismo origen, 5 veces.
      var samples = [];
      var seq = Promise.resolve();
      for (var i = 0; i < 5; i++) {
        seq = seq.then(function () { return timedFetch('/api/ping').then(function (r) { samples.push(r); }); });
      }
      return seq.then(function () { return samples; });
    }).then(function (samples) {
      var oks = samples.filter(function (s) { return s.ok; });
      t.proxyPing = { total: samples.length, okCount: oks.length, medianMs: median(oks.map(function (s) { return s.ms; })), samples: samples };
      step('API ' + (C.apiRegion || '') + ' vía proxy', oks.length === samples.length, oks.length + '/' + samples.length + ', mediana ' + t.proxyPing.medianMs + ' ms');
      // 4. API directa (sin proxy), para saber si el backend también es accesible desde Cuba.
      var direct = [];
      var seq = Promise.resolve();
      for (var i = 0; i < 3; i++) {
        seq = seq.then(function () { return timedFetch(C.apiUrl + '/api/ping', { mode: 'cors' }).then(function (r) { direct.push(r); }); });
      }
      return seq.then(function () { return direct; });
    }).then(function (direct) {
      var oks = direct.filter(function (s) { return s.ok; });
      t.directPing = { total: direct.length, okCount: oks.length, medianMs: median(oks.map(function (s) { return s.ms; })) };
      step('API ' + (C.apiRegion || '') + ' directa', oks.length > 0, oks.length + '/' + direct.length + ', mediana ' + t.directPing.medianMs + ' ms');
      // 4b. Otras regiones del backend, para comparar latencias desde Cuba.
      return runExtraApis(t);
    }).then(function () {
      // 5. Los demás candidatos de hosting, con una imagen de 1 px.
      return Promise.all(C.candidates.map(function (c) {
        return probeImage(c.url + '/probe.png').then(function (r) { return Object.assign({ name: c.name, url: c.url }, r); });
      }));
    }).then(function (cands) {
      t.candidates = cands;
      cands.forEach(function (c) { step('Hosting ' + c.name, c.ok, c.ok ? c.ms + ' ms' : c.error); });
      // 6. Servicios externos que usaría el portal.
      var checks = [probeImage('https://i.ytimg.com/vi/' + C.youtubeVideoId + '/default.jpg')];
      if (C.storageImageUrl) checks.push(probeImage(C.storageImageUrl));
      return Promise.all(checks);
    }).then(function (ext) {
      t.youtubeThumb = ext[0];
      step('Miniaturas de YouTube', ext[0].ok, ext[0].ok ? ext[0].ms + ' ms' : ext[0].error);
      if (ext[1]) {
        t.storage = ext[1];
        step('Almacenamiento de archivos', ext[1].ok, ext[1].ok ? ext[1].ms + ' ms' : ext[1].error);
      }
      t.serviceWorker = {
        supported: 'serviceWorker' in navigator,
        controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller)
      };
      step('Modo sin conexión disponible', t.serviceWorker.supported, t.serviceWorker.supported ? '' : 'navegador sin soporte');
      report.finishedAt = new Date().toISOString();
      save(LAST_KEY, { id: report.id, form: form });
      enqueue(report);
      showActions(report);
      return flush();
    }).then(showSendStatus);
  }

  // ---------- arranque ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* se informa en la prueba */ });
  }

  var last = load(LAST_KEY, null);
  if (!navigator.onLine && navigator.serviceWorker && navigator.serviceWorker.controller) {
    var banner = $('#offline-banner');
    banner.hidden = false;
    banner.textContent = '✅ La aplicación abrió sin conexión. Desactiva el modo avión: el resultado se enviará solo.';
    enqueue({
      id: uid(), type: 'offline', version: 1, host: location.host, provider: C.provider,
      at: new Date().toISOString(), runId: last && last.id, form: last && last.form, ok: true
    });
  } else {
    flush();
  }
  window.addEventListener('online', function () { flush().then(showSendStatus); });

  if (last && last.form) {
    ['alias', 'province', 'network', 'vpn'].forEach(function (k) {
      if (last.form[k]) $('#form').elements[k].value = last.form[k];
    });
  }

  $('#form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target.elements;
    var form = { alias: f.alias.value.trim(), province: f.province.value, network: f.network.value, vpn: f.vpn.value };
    $('#start').disabled = true;
    $('#start').textContent = 'Probando…';
    $('#steps').innerHTML = '';
    $('#progress').hidden = false;
    $('#actions').hidden = true;
    runTests(form).catch(function (err) {
      step('Error inesperado', false, String(err));
    }).then(function () {
      $('#start').disabled = false;
      $('#start').textContent = 'Repetir prueba';
    });
  });
})();

// Trusted, fixed prototype bootstrap. Document text is received as JSON data only.
(() => {
  'use strict';
  const host = chrome.webview;
  const policyObservations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    if (policyObservations.length < 16) policyObservations.push({
      directive: event.effectiveDirective.slice(0, 100), blockedURI: event.blockedURI.slice(0, 160),
    });
  });
  let consumed = false;
  let rendered = false;
  const send = (value) => host.postMessage(value);
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  host.addEventListener('message', async ({ data }) => {
    if (rendered && data?.phase === 'capture') {
      rendered = false;
      await frame();
      await frame();
      const target = document.getElementById('target');
      send({ phase: 'capture-ready', policyObservations,
        activeLinkElements: [...target.querySelectorAll('a')].filter((a) => a.hasAttribute('href') || a.hasAttribute('xlink:href')).length,
        executableElements: target.querySelectorAll('script,iframe,object,embed').length,
        interactionAttempted: false });
      return;
    }
    if (consumed) return;
    consumed = true;
    try {
      if (!data || data.protocol !== 1 || typeof data.requestId !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(data.requestId) || typeof data.source !== 'string' ||
          data.source.length > 50000 || data.source.split('\n').length > 256 ||
          data.width !== 1280 || data.theme !== 'default' || !['classic', 'neo'].includes(data.look)) throw new Error('Invalid fixed data contract');
      // Pin every existing configuration key against frontmatter/init overrides.
      // No external layout loaders, icon registration, callbacks or bindFunctions.
      const secure = [...new Set([...Object.keys(mermaid.mermaidAPI.defaultConfig),
        'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'secure', 'htmlLabels'])];
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict',
        maxTextSize: 50000, maxEdges: 500, deterministicIds: true,
        deterministicIDSeed: 'milkup-fixed-prototype', theme: 'default',
        fontFamily: 'Arial, sans-serif', htmlLabels: true, look: data.look, secure });
      await document.fonts.ready;
      const target = document.getElementById('target');
      const result = await mermaid.render('fixed-diagram', data.source, target);
      target.innerHTML = result.svg;
      const svg = target.querySelector('svg');
      if (!svg) throw new Error('Official render returned no SVG');
      await document.fonts.ready;
      await frame();
      await frame();
      const rect = svg.getBoundingClientRect();
      const box = svg.getBBox();
      const width = Math.ceil(Math.max(1280, rect.width, target.scrollWidth));
      const height = Math.ceil(Math.max(rect.height, target.scrollHeight));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 ||
          width > 8192 || height > 8192 || width * height > 16777216) throw new Error('Measured output exceeds pixel budget');
      rendered = true;
      send({ phase: 'rendered', requestId: data.requestId, width, height,
        diagramType: result.diagramType ?? null,
        svgViewBox: svg.getAttribute('viewBox'),
        svgBBox: { x: box.x, y: box.y, width: box.width, height: box.height },
        boundary: 'Measured viewport candidate; visual full-ink/no-clipping validation still required' });
    } catch (error) {
      send({ phase: 'error', message: String(error).slice(0, 1000) });
    }
  });
  send({ phase: 'ready', engine: '12.2.0' });
})();

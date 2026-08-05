/* Shared helpers: theme toggle, palette access for canvas, DPR-aware canvas
   setup, animation-loop management, tooltip positioning. Every demo reads its
   colors from the CSS custom properties at draw time, so a theme flip only
   needs a redraw, not a reload. */

(() => {
  'use strict';

  /* ---- theme toggle ------------------------------------------------------
     Boot (inline in <head>) already stamped data-theme from localStorage.
     The button cycles explicit light/dark; OS changes flow through when the
     user hasn't overridden. Either path dispatches 'themechange'. */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : mq.matches;
  };
  const announce = () => window.dispatchEvent(new CustomEvent('themechange'));

  function initThemeButton() {
    const btn = document.getElementById('theme-btn');
    if (!btn) return;
    const paint = () => { btn.textContent = isDark() ? '☀' : '☾'; };
    btn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* private mode */ }
      paint(); announce();
    });
    mq.addEventListener('change', () => {
      if (!document.documentElement.dataset.theme) { paint(); announce(); }
    });
    paint();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeButton);
  } else initThemeButton();

  /* ---- palette ----------------------------------------------------------- */
  const css = name =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ---- canvas setup -------------------------------------------------------
     fitCanvas(canvas, aspect) sizes the bitmap to CSS-pixels x DPR and returns
     {w, h} in CSS pixels; the context is pre-scaled so all drawing uses CSS px. */
  function fitCanvas(canvas, aspect) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = Math.round(w * aspect);
    canvas.style.height = h + 'px';
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* ---- demo registration --------------------------------------------------
     register(fn) -> fn(redrawTriggers) is called once; we call its returned
     redraw() on resize + themechange. Keeps each demo an isolated module. */
  const redraws = [];
  function register(redraw) { redraws.push(redraw); redraw(); }
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => redraws.forEach(fn => fn()), 120);
  });
  window.addEventListener('themechange', () => redraws.forEach(fn => fn()));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---- tooltip ------------------------------------------------------------
     One absolutely-positioned tip per .viz-canvas-box wrapper. */
  function makeTip(box) {
    const tip = document.createElement('div');
    tip.className = 'viz-tip';
    box.appendChild(tip);
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.style.display = 'block';
        const bw = box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
        let tx = x + 14, ty = y - th - 10;
        if (tx + tw > bw - 4) tx = x - tw - 14;
        if (ty < 4) ty = y + 14;
        tip.style.left = tx + 'px';
        tip.style.top = ty + 'px';
      },
      hide() { tip.style.display = 'none'; },
    };
  }

  window.viz = { css, fitCanvas, register, makeTip, isDark, reducedMotion };
})();

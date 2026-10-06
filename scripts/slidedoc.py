"""slidedoc -- figure-first analysis write-ups as a column of 16:9 slides.

Each slide is a fixed 1920x1080 canvas, scaled to the page width, with a
"Details" drop-down under it for the longer text. Anything carrying a
``data-tip`` attribute -- a word in the text, an SVG point, a bar, a box in a
flow diagram -- shows a tooltip on hover (tap on touch screens). Charts are
inline SVG, so the page is a single self-contained HTML file with no images.

The ILL feasibility deck (x17_facility_search/ill/deck/build_deck.py) is the
model this was lifted from; the two-track limit deck
(nTof_x17/sept26_prelim_analysis/make_two_track_deck.py) is the first user.

Usage, from a build script anywhere::

    import sys, os
    sys.path.insert(0, os.path.expanduser('~/PycharmProjects/dylan-cern-site/scripts'))
    import slidedoc as sd

    D = sd.Deck('Two-track limit', 'one-line description')
    D.slide('cover', body_html, notes_html, dark=True)
    D.slide('r1', sd.title('Headline', 'sub') + plot.svg('label'), notes, foot='Source: ...')
    D.write('out/two-track-limit.html', note_meta=dict(title=..., summary=..., tags=..., date=...))

Then publish with ``dylan-cern-site/scripts/add-note.py out/two-track-limit.html --deploy``.

Coordinates are slide pixels (1920x1080, padding 128 px left/right, so the
content box is 1664 px wide and ~800 px tall under a title). Type sizes that
read well at that scale: title 60, subtitle 30, body 26-28, chart labels 21-22.
"""
from __future__ import annotations

import html as _html
import math
import re
from pathlib import Path

# --------------------------------------------------------------------------- #
# palette and type
# --------------------------------------------------------------------------- #
BG, BG2, CARD = '#f5f3ee', '#ebe8e1', '#fffdf9'
INK, MUT, RULE = '#1c2230', '#5a6170', '#d8d3c8'
DARK, DINK, DMUT, DRULE = '#151a24', '#eef0f3', '#a3abb9', '#333b4a'
BLUE, ORANGE, RED, GOLD, PURPLE, GREY, GREEN = (
    '#1f5fa8', '#c8601a', '#c63d4f', '#c99318', '#7a52b8', '#7d8796', '#2f8a5b')
#: light variants that read on the dark cover
DBLUE, DRED, DGREY, DGREEN = '#6aa6e8', '#e07a86', '#b9c1cc', '#6cc79a'
SANS = "'IBM Plex Sans', Helvetica, Arial, sans-serif"
SVGF = 'Helvetica, Arial, sans-serif'

_SUP = str.maketrans('-0123456789', '⁻⁰¹²³⁴⁵⁶⁷⁸⁹')


def esc(s) -> str:
    return _html.escape(str(s), quote=True)


def sup(n) -> str:
    return str(n).translate(_SUP)


def sci(v, d=1) -> str:
    """1.2×10⁻³ style."""
    if v == 0:
        return '0'
    e = int(math.floor(math.log10(abs(v))))
    m = v / 10 ** e
    if round(m, d) >= 10:
        m /= 10
        e += 1
    return f'{m:.{d}f}×10{sup(e)}'


def pct(x, d=0) -> str:
    return '–' if x is None or (isinstance(x, float) and math.isnan(x)) else f'{100 * x:.{d}f}%'


# --------------------------------------------------------------------------- #
# tooltips
# --------------------------------------------------------------------------- #
def tipattr(text) -> str:
    """Attribute string for any element: ``<rect{tipattr('n = 40')} .../>``.
    Text is escaped; a literal newline becomes a line break in the tooltip."""
    return f' data-tip="{esc(text)}"' if text else ''


def term(word, tip) -> str:
    """A word in running text with a dotted underline and a tooltip -- for
    jargon, switches and numbers whose provenance the reader may want."""
    return f'<span class="term"{tipattr(tip)}>{word}</span>'


# --------------------------------------------------------------------------- #
# HTML building blocks (sizes in slide pixels)
# --------------------------------------------------------------------------- #
def title(t, sub=None) -> str:
    s = f'<h2 style="font-size:60px;font-weight:600;line-height:1.1;letter-spacing:-1px">{t}</h2>'
    if sub:
        s += f'\n<p style="font-size:30px;color:{MUT};line-height:1.3">{sub}</p>'
    return f'<div style="display:flex;flex-direction:column;gap:12px">{s}</div>'


def kicker(t, dark=True) -> str:
    return (f'<p style="font-size:26px;letter-spacing:3px;text-transform:uppercase;'
            f'color:{DMUT if dark else MUT}">{t}</p>')


def row(*items, gap=48, align='start') -> str:
    return f'<div style="display:flex;gap:{gap}px;align-items:{align}">{"".join(items)}</div>'


def col(*items, gap=16, w=None) -> str:
    ws = f'width:{w}px;' if w else 'flex:1;'
    return f'<div style="{ws}display:flex;flex-direction:column;gap:{gap}px">{"".join(items)}</div>'


def p(text, size=26, color=INK, weight=400, extra='') -> str:
    return (f'<p style="font-size:{size}px;color:{color};font-weight:{weight};'
            f'line-height:1.35;{extra}">{text}</p>')


def card(inner, w=None, bg=CARD, pad=32, tip=None) -> str:
    ws = f'width:{w}px;' if w else 'flex:1;'
    return (f'<div{tipattr(tip)} style="{ws}display:flex;flex-direction:column;gap:12px;background:{bg};'
            f'padding:{pad}px;border:1px solid {RULE};border-radius:16px">{inner}</div>')


def bignum(v, label, color, note, dark=True, tip=None, size=72) -> str:
    """Headline number with a coloured rule above it (cover-slide style)."""
    fg, mut = (DINK, DMUT) if dark else (INK, MUT)
    return (f'<div{tipattr(tip)} style="flex:1;display:flex;flex-direction:column;gap:12px;'
            f'border-top:4px solid {color};padding:28px 0 0 0">'
            f'<p style="font-size:{size}px;font-weight:600;color:{color};line-height:1.05">{v}</p>'
            f'<p style="font-size:30px;color:{fg};line-height:1.3">{label}</p>'
            f'<p style="font-size:24px;color:{mut};line-height:1.35">{note}</p></div>')


def legend(items, size=24, color=INK) -> str:
    """items: (name, colour) or (name, colour, style) with style 'line'|'dash'|'dot'|'box'."""
    out = []
    for it in items:
        n, c = it[0], it[1]
        st = it[2] if len(it) > 2 else 'line'
        if st == 'box':
            sw = f'<div style="width:22px;height:22px;background:{c};border-radius:4px"></div>'
        elif st == 'dot':
            sw = f'<div style="width:16px;height:16px;background:{c};border-radius:50%"></div>'
        elif st == 'dash':
            sw = (f'<div style="width:32px;height:0;border-top:5px dashed {c}"></div>')
        else:
            sw = f'<div style="width:32px;height:6px;background:{c};border-radius:3px"></div>'
        out.append(f'<div style="display:flex;align-items:center;gap:10px">{sw}'
                   f'<p style="font-size:{size}px;color:{color}">{n}</p></div>')
    return f'<div style="display:flex;flex-wrap:wrap;gap:28px;align-items:center">{"".join(out)}</div>'


def table(cols, rows, size=24, widths=None, align=None, tips=None) -> str:
    """A light table. ``rows`` are lists of cell HTML; ``tips`` an optional
    parallel list of per-row tooltip text (whole row hovers)."""
    al = align or ['left'] + ['right'] * (len(cols) - 1)
    wd = widths or [None] * len(cols)
    th = ''.join(f'<th style="text-align:{a};{f"width:{w}px;" if w else ""}">{c}</th>'
                 for c, a, w in zip(cols, al, wd))
    trs = []
    for i, r in enumerate(rows):
        t = tipattr(tips[i]) if tips and tips[i] else ''
        trs.append(f'<tr{t}>' + ''.join(f'<td style="text-align:{a}">{c}</td>' for c, a in zip(r, al)) + '</tr>')
    return f'<table style="font-size:{size}px"><thead><tr>{th}</tr></thead><tbody>{"".join(trs)}</tbody></table>'


def hbars(rows, vmax, width=600, h=36, log=False, vmin=None, label_w=300, fmt=None, size=26):
    """Horizontal bars. rows: (label, value, colour[, tip[, note]])."""
    out = []
    for r in rows:
        lab, v, c = r[:3]
        tp = r[3] if len(r) > 3 else None
        note = r[4] if len(r) > 4 else ''
        if log:
            lo = math.log10(vmin)
            w = width * (math.log10(max(v, vmin)) - lo) / (math.log10(vmax) - lo)
        else:
            w = width * v / vmax
        s = fmt(v) if fmt else f'{v:,}'
        nt = f'<p style="font-size:{size - 4}px;color:{MUT};line-height:1.25">{note}</p>' if note else ''
        out.append(f'<div{tipattr(tp)} style="display:flex;align-items:center;gap:24px">'
                   f'<p style="width:{label_w}px;font-size:{size}px;font-weight:600;text-align:right">{lab}</p>'
                   f'<div style="width:{width + 160}px;display:flex;align-items:center;gap:14px">'
                   f'<div style="width:{max(w, 2):.0f}px;height:{h}px;background:{c};border-radius:6px"></div>'
                   f'<p style="font-size:{size}px;font-weight:600;white-space:nowrap">{s}</p></div>{nt}</div>')
    return f'<div style="display:flex;flex-direction:column;gap:14px">{"".join(out)}</div>'


def flow(steps, dark=False, size=24, arrow='→', wrap=False):
    """A left-to-right pipeline of boxes. steps: dicts with
    ``label``, optional ``sub``, ``color`` (border/accent), ``tip``, ``fill``,
    ``strike`` (bool: drawn as removed)."""
    fg, mut = (DINK, DMUT) if dark else (INK, MUT)
    out = []
    for i, s in enumerate(steps):
        c = s.get('color', RULE)
        fill = s.get('fill', CARD if not dark else '#1f2533')
        deco = 'text-decoration:line-through;opacity:.55;' if s.get('strike') else ''
        sub = (f'<p style="font-size:{size - 4}px;color:{mut};line-height:1.3;{deco}">{s["sub"]}</p>'
               if s.get('sub') else '')
        out.append(f'<div{tipattr(s.get("tip"))} style="flex:1;min-width:0;background:{fill};border:2px solid {c};'
                   f'border-radius:14px;padding:18px 18px;display:flex;flex-direction:column;gap:8px">'
                   f'<p style="font-size:{size}px;font-weight:600;color:{fg};line-height:1.2;{deco}">{s["label"]}</p>{sub}</div>')
        if i < len(steps) - 1:
            out.append(f'<p style="font-size:{size + 8}px;color:{mut};align-self:center">{arrow}</p>')
    return (f'<div style="display:flex;gap:12px;align-items:stretch;{"flex-wrap:wrap;" if wrap else ""}">'
            f'{"".join(out)}</div>')


def callout(text, color=BLUE, size=26) -> str:
    return (f'<div style="border-left:6px solid {color};padding:6px 0 6px 24px">'
            f'<p style="font-size:{size}px;line-height:1.35">{text}</p></div>')


# --------------------------------------------------------------------------- #
# SVG primitives
# --------------------------------------------------------------------------- #
def svg(w, h, inner, label) -> str:
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
            f'role="img" aria-label="{esc(label)}" style="overflow:visible">{inner}</svg>')


def T(x, y, s, size=22, fill=MUT, anchor='middle', weight=400, rot=None, tip=None) -> str:
    r = f' transform="rotate({rot} {x:.1f} {y:.1f})"' if rot is not None else ''
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{SVGF}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" font-weight="{weight}"{r}{tipattr(tip)}>{s}</text>')


def line(x1, y1, x2, y2, color=MUT, w=1.5, dash=None, extra='') -> str:
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" '
            f'stroke-width="{w}"{d}{extra}/>')


def poly(xs, ys, color, w=3.5, dash=None, fill=None, tip=None) -> str:
    pts = ' '.join(f'{x:.1f},{y:.1f}' for x, y in zip(xs, ys))
    if fill:
        return f'<polygon points="{pts}" fill="{fill}" stroke="none"{tipattr(tip)}/>'
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return (f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{w}" '
            f'stroke-linejoin="round" stroke-linecap="round"{d}{tipattr(tip)}/>')


def step_xy(edges, vals):
    xs, ys = [], []
    for i, v in enumerate(vals):
        xs += [edges[i], edges[i + 1]]
        ys += [v, v]
    return xs, ys


def arrow(x1, y1, x2, y2, color=MUT, w=2.5, head=12) -> str:
    a = math.atan2(y2 - y1, x2 - x1)
    p1 = (x2 - head * math.cos(a - 0.4), y2 - head * math.sin(a - 0.4))
    p2 = (x2 - head * math.cos(a + 0.4), y2 - head * math.sin(a + 0.4))
    return (line(x1, y1, x2, y2, color, w)
            + f'<polygon points="{x2:.1f},{y2:.1f} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}" fill="{color}"/>')


class Plot:
    """An x/y panel in slide pixels. Scales: 'lin' or 'log'.

        P = Plot(760, 480, x=(0.25, 12, 'log'), y=(0, 1), xlabel=..., ylabel=...)
        P.xticks([(0.5, '0.5'), (1, '1'), ...]); P.yticks(...)
        P.line(xs, ys, BLUE, tips=[...])        # tips: one per point -> hoverable markers
        P.svg('aria label')
    """

    def __init__(self, w, h, x, y, xlabel='', ylabel='', margin=(24, 30, 92, 104), title=None):
        self.w, self.h = w, h
        mt, mr, mb, ml = margin
        if title:
            mt += 40
        self.x0, self.y0 = ml, mt
        self.pw, self.ph = w - ml - mr, h - mt - mb
        self.xs, self.ys = x, y
        self.xlabel, self.ylabel, self.ttl = xlabel, ylabel, title
        self.back, self.fore = [], []
        self._xt = self._yt = self._y2t = None
        self.ylabel2 = ''

    # --- scales
    @staticmethod
    def _m(v, lo, hi, kind):
        if kind == 'log':
            v = max(v, lo * 1e-3)
            return (math.log10(v) - math.log10(lo)) / (math.log10(hi) - math.log10(lo))
        return (v - lo) / (hi - lo)

    def X(self, v):
        lo, hi, *k = self.xs
        return self.x0 + self._m(v, lo, hi, k[0] if k else 'lin') * self.pw

    def Y(self, v):
        lo, hi, *k = self.ys
        return self.y0 + self.ph - self._m(v, lo, hi, k[0] if k else 'lin') * self.ph

    def xticks(self, ticks):
        self._xt = ticks
        return self

    def yticks(self, ticks):
        self._yt = ticks
        return self

    def y2(self, factor, ticks, label=''):
        """A right-hand axis for a second quantity plotted as value*factor in
        left-axis units. ticks: (value_in_right_units, label). Use Y2(v) or
        pass [v*factor for v in ...] to line()."""
        self._y2f = factor
        self._y2t = [(v * factor, lab) for v, lab in ticks]
        self.ylabel2 = label
        return self

    def Y2(self, v):
        return v * self._y2f

    # --- marks
    def line(self, xs, ys, color, w=3.5, dash=None, markers=True, r=6, tips=None,
             marker='circle', tip=None):
        pts = [(self.X(a), self.Y(b)) for a, b in zip(xs, ys)
               if b is not None and not (isinstance(b, float) and math.isnan(b))]
        tps = None
        if tips is not None:
            tps = [t for t, b in zip(tips, ys) if b is not None and not (isinstance(b, float) and math.isnan(b))]
        self.fore.append(poly([q[0] for q in pts], [q[1] for q in pts], color, w, dash, tip=tip))
        if markers or tps:
            for i, (px, py) in enumerate(pts):
                t = tps[i] if tps else None
                if markers:
                    if marker == 'diamond':
                        self.fore.append(f'<rect x="{px - r:.1f}" y="{py - r:.1f}" width="{2 * r}" height="{2 * r}" '
                                         f'transform="rotate(45 {px:.1f} {py:.1f})" fill="{color}"/>')
                    elif marker == 'open':
                        self.fore.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="{r}" fill="{BG}" '
                                         f'stroke="{color}" stroke-width="2.5"/>')
                    else:
                        self.fore.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="{r}" fill="{color}"/>')
                if t:
                    self.fore.append(f'<circle class="hit" cx="{px:.1f}" cy="{py:.1f}" r="{max(r + 8, 14)}" '
                                     f'fill="transparent"{tipattr(t)}/>')
        return self

    def points(self, xs, ys, color, r=8, tips=None, marker='circle'):
        return self.line(xs, ys, color, w=0, markers=True, r=r, tips=tips, marker=marker)

    def scatter(self, xs, ys, color, r=3.5, opacity=0.35, tip=None):
        """A cloud of many small translucent dots, no per-point tooltip (one
        ``tip`` for the whole cloud). For thousands of points; use ``points``
        when each point needs its own tooltip. Points outside the axes are
        dropped, since inline SVG does not clip."""
        (xl, xh, *_), (yl, yh, *_) = self.xs, self.ys
        dots = ''.join(f'<circle cx="{self.X(a):.1f}" cy="{self.Y(b):.1f}" r="{r}"/>'
                       for a, b in zip(xs, ys)
                       if b == b and a == a and xl <= a <= xh and yl <= b <= yh)
        self.back.append(f'<g fill="{color}" fill-opacity="{opacity}"{tipattr(tip)}>{dots}</g>')
        return self

    def band(self, xs, lo, hi, color, alpha=0.15, tip=None):
        top = [(self.X(a), self.Y(b)) for a, b in zip(xs, hi)]
        bot = [(self.X(a), self.Y(b)) for a, b in zip(xs, lo)][::-1]
        q = top + bot
        self.back.append(f'<polygon points="{" ".join(f"{a:.1f},{b:.1f}" for a, b in q)}" fill="{color}" '
                         f'fill-opacity="{alpha}" stroke="none"{tipattr(tip)}/>')
        return self

    def hline(self, y, color=MUT, dash='8 6', w=2, label=None, tip=None, anchor='end', where='above'):
        py = self.Y(y)
        self.back.append(line(self.x0, py, self.x0 + self.pw, py, color, w, dash))
        if tip:
            self.back.append(f'<rect class="hit" x="{self.x0}" y="{py - 8:.1f}" width="{self.pw}" height="16" '
                             f'fill="transparent"{tipattr(tip)}/>')
        if label:
            lx = self.x0 + self.pw - 6 if anchor == 'end' else self.x0 + 8
            ly = py - 10 if where == 'above' else py + 28
            self.fore.append(T(lx, ly, label, 21, color, anchor))
        return self

    def vline(self, x, color=MUT, dash='8 6', w=2, label=None, tip=None):
        px = self.X(x)
        self.back.append(line(px, self.y0, px, self.y0 + self.ph, color, w, dash))
        if tip:
            self.back.append(f'<rect class="hit" x="{px - 8:.1f}" y="{self.y0}" width="16" height="{self.ph}" '
                             f'fill="transparent"{tipattr(tip)}/>')
        if label:
            self.fore.append(T(px + 8, self.y0 + 22, label, 21, color, 'start'))
        return self

    def vbar(self, x, v, width_px, color, tip=None, base=None, label=None, opacity=1.0):
        """A vertical bar centred at data-x, width in pixels."""
        b = self.Y(base if base is not None else self.ys[0])
        top = self.Y(v)
        px = self.X(x) if not isinstance(x, tuple) else x[0]
        self.fore.append(f'<rect x="{px - width_px / 2:.1f}" y="{min(top, b):.1f}" width="{width_px:.1f}" '
                         f'height="{abs(b - top):.1f}" fill="{color}" fill-opacity="{opacity}" rx="3"{tipattr(tip)}/>')
        if label:
            self.fore.append(T(px, top - 10, label, 20, INK))
        return self

    def cells(self, cells, vmin, vmax, cmap=None, missing=None, gap=0.0):
        """A heat map: ``cells`` is an iterable of (x_lo, x_hi, y_lo, y_hi,
        value, tip) in data units; each is one rect coloured by ``cmap``
        (see `seq_color`) on [vmin, vmax], clipped at both ends.  A value of
        None/NaN is drawn in ``missing`` if given, else skipped.  ``gap`` (px)
        insets each rect so cell borders show.  Pair with `colorbar`."""
        for x0, x1, y0, y1, v, tp in cells:
            bad = v is None or (isinstance(v, float) and math.isnan(v))
            if bad and not missing:
                continue
            fill = missing if bad else seq_color((v - vmin) / (vmax - vmin), cmap)
            X0, X1 = sorted((self.X(x0), self.X(x1)))
            Y0, Y1 = sorted((self.Y(y0), self.Y(y1)))
            self.back.append(
                f'<rect x="{X0 + gap:.1f}" y="{Y0 + gap:.1f}" width="{max(X1 - X0 - 2 * gap, 0.5):.1f}" '
                f'height="{max(Y1 - Y0 - 2 * gap, 0.5):.1f}" fill="{fill}"{tipattr(tp)}/>')
        return self

    def rect(self, x0, x1, y0, y1, color=INK, w=2, dash=None, fill='none', tip=None):
        """An outline in data units (a detector edge, a channel boundary)."""
        X0, X1 = sorted((self.X(x0), self.X(x1)))
        Y0, Y1 = sorted((self.Y(y0), self.Y(y1)))
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.fore.append(f'<rect x="{X0:.1f}" y="{Y0:.1f}" width="{X1 - X0:.1f}" height="{Y1 - Y0:.1f}" '
                         f'fill="{fill}" stroke="{color}" stroke-width="{w}"{d}{tipattr(tip)}/>')
        return self

    def text(self, x, y, s, size=21, color=MUT, anchor='start', weight=400, tip=None):
        self.fore.append(T(self.X(x), self.Y(y), s, size, color, anchor, weight, tip=tip))
        return self

    def raw(self, s, back=False):
        (self.back if back else self.fore).append(s)
        return self

    # --- output
    def _axes(self):
        o = []
        x0, y0, pw, ph = self.x0, self.y0, self.pw, self.ph
        for v, lab in (self._yt or []):
            y = self.Y(v)
            o.append(line(x0, y, x0 + pw, y, RULE, 1))
            o.append(T(x0 - 12, y + 7, lab, 21, anchor='end'))
        for v, lab in (self._xt or []):
            x = self.X(v)
            o.append(line(x, y0 + ph, x, y0 + ph + 8, MUT, 1.5))
            o.append(T(x, y0 + ph + 32, lab, 21))
        o.append(line(x0, y0 + ph, x0 + pw, y0 + ph, MUT, 1.5))
        o.append(line(x0, y0, x0, y0 + ph, MUT, 1.5))
        if self._y2t:
            o.append(line(x0 + pw, y0, x0 + pw, y0 + ph, MUT, 1.5))
            for v, lab in self._y2t:
                y = self.Y(v)
                o.append(line(x0 + pw, y, x0 + pw + 8, y, MUT, 1.5))
                o.append(T(x0 + pw + 14, y + 7, lab, 21, anchor='start'))
            if self.ylabel2:
                o.append(T(x0 + pw + 84, y0 + ph / 2, self.ylabel2, 22, INK, rot=90))
        if self.xlabel:
            o.append(T(x0 + pw / 2, y0 + ph + 70, self.xlabel, 22, INK))
        if self.ylabel:
            o.append(T(x0 - 78, y0 + ph / 2, self.ylabel, 22, INK, rot=-90))
        if self.ttl:
            o.append(T(x0, y0 - 22, self.ttl, 26, INK, 'start', 600))
        return ''.join(o)

    def svg(self, label=''):
        return svg(self.w, self.h,
                   self._axes() + ''.join(self.back) + ''.join(self.fore),
                   label or self.ttl or 'plot')


#: Sequential colour maps for `Plot.cells`: (position, hex) stops.  VIRIDIS is
#: perceptually even and colour-blind safe; DIVERGE is for ratios about 1.
VIRIDIS = [(0.0, '#440154'), (0.13, '#482878'), (0.25, '#3e4989'), (0.38, '#31688e'),
           (0.5, '#26828e'), (0.63, '#1f9e89'), (0.75, '#35b779'), (0.88, '#6ece58'),
           (1.0, '#fde725')]
DIVERGE = [(0.0, '#2c5f9e'), (0.25, '#7fa7d1'), (0.5, '#f2efe9'), (0.75, '#e0937a'),
           (1.0, '#b3372a')]


def seq_color(t, cmap=None) -> str:
    """Colour at fraction ``t`` (clipped to [0, 1]) of a stop list."""
    stops = cmap or VIRIDIS
    t = 0.0 if t != t else min(max(t, 0.0), 1.0)
    for (a, ca), (b, cb) in zip(stops[:-1], stops[1:]):
        if t <= b:
            f = 0 if b == a else (t - a) / (b - a)
            c1 = [int(ca[i:i + 2], 16) for i in (1, 3, 5)]
            c2 = [int(cb[i:i + 2], 16) for i in (1, 3, 5)]
            return '#' + ''.join(f'{round(x + f * (y - x)):02x}' for x, y in zip(c1, c2))
    return stops[-1][1]


def colorbar(w, h, vmin, vmax, ticks, label='', cmap=None, horizontal=False, n=60):
    """A standalone colour bar SVG. ``ticks``: (value, label).  Vertical by
    default (bar 28 px wide at the left, labels to its right)."""
    o = []
    if horizontal:
        bw, bh, x0, y0 = w - 40, 26, 20, 34 if label else 6
        for i in range(n):
            o.append(f'<rect x="{x0 + i * bw / n:.1f}" y="{y0}" width="{bw / n + 0.6:.1f}" height="{bh}" '
                     f'fill="{seq_color((i + 0.5) / n, cmap)}"/>')
        for v, lab in ticks:
            x = x0 + (v - vmin) / (vmax - vmin) * bw
            o.append(line(x, y0 + bh, x, y0 + bh + 7, MUT, 1.5))
            o.append(T(x, y0 + bh + 30, lab, 20))
        if label:
            o.append(T(x0, 22, label, 22, INK, 'start'))
    else:
        # label above the bar, so a long one never runs off the panel
        bw, x0 = 28, 4
        y0 = 44 if label else 14
        bh = h - y0 - 14
        for i in range(n):
            o.append(f'<rect x="{x0}" y="{y0 + bh - (i + 1) * bh / n:.1f}" width="{bw}" '
                     f'height="{bh / n + 0.6:.1f}" fill="{seq_color((i + 0.5) / n, cmap)}"/>')
        for v, lab in ticks:
            y = y0 + bh - (v - vmin) / (vmax - vmin) * bh
            o.append(line(x0 + bw, y, x0 + bw + 7, y, MUT, 1.5))
            o.append(T(x0 + bw + 12, y + 7, lab, 20, anchor='start'))
        if label:
            o.append(T(x0, 24, label, 20, INK, 'start'))
    return svg(w, h, ''.join(o), label or 'colour bar')


def log_ticks(lo_exp, hi_exp, base_label='10'):
    return [(10 ** k, f'{base_label}{sup(k)}') for k in range(lo_exp, hi_exp + 1)]


# --------------------------------------------------------------------------- #
# the deck
# --------------------------------------------------------------------------- #
_CSS = """
:root{color-scheme:light}
body{margin:0;background:#2a2f3a;font-family:%(SANS)s;}
.wrap{max-width:1400px;margin:0 auto;padding:24px 16px 64px;display:flex;flex-direction:column;gap:14px}
.toc{display:flex;flex-wrap:wrap;gap:6px 18px;color:#a3abb9;font-size:14px;margin:4px 2px 14px}
.toc a{color:#c9d0db;text-decoration:none} .toc a:hover{color:#fff;text-decoration:underline}
.frame{position:relative;width:100%%;aspect-ratio:16/9;overflow:hidden;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);margin-top:20px}
.frame>section{position:absolute;left:0;top:0;width:1920px;height:1080px;box-sizing:border-box;transform-origin:0 0}
.num{position:absolute;right:48px;bottom:36px;font-size:20px;color:#9aa1ad;letter-spacing:1px}
section *{margin:0;box-sizing:border-box}
section table{border-collapse:collapse;width:100%%}
section th,section td{padding:.35em .6em;border-bottom:1px solid #d8d3c8}
section th{font-weight:600;border-bottom:2px solid #1c2230}
section tbody tr[data-tip]:hover{background:#ebe8e1}
section aside{display:none}
.term{border-bottom:2px dotted currentColor}
svg [data-tip]:not(.hit):hover{opacity:.8}
svg .hit:hover{fill:rgba(28,34,48,.10)}
details{color:#d6dae2;font-size:15.5px;line-height:1.6;background:#232833;border-radius:0 0 10px 10px;padding:8px 18px;margin-top:-4px}
details[open]{padding-bottom:16px}
summary{cursor:pointer;color:#a3abb9;font-size:14px;letter-spacing:.5px}
details p{margin:.6em 0} details code{font-family:'IBM Plex Mono',monospace;font-size:.92em;color:#f0d9a8}
details table{border-collapse:collapse;margin:.6em 0;font-size:14.5px}
details th,details td{padding:3px 10px;border-bottom:1px solid #3a4150;text-align:right}
details th:first-child,details td:first-child{text-align:left}
details a{color:#8ec1ff}
#tip{position:fixed;z-index:10;max-width:380px;padding:9px 12px;border-radius:8px;background:#10141c;color:#eef0f3;
 font-size:14px;line-height:1.45;box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:none;opacity:0;transition:opacity .08s;white-space:pre-line}
#tip.on{opacity:1}
.foot{color:#7d8593;font-size:13px;margin-top:28px;line-height:1.5}
"""

_JS = """
function fit(){document.querySelectorAll('.frame').forEach(f=>{f.firstElementChild.style.transform='scale('+(f.clientWidth/1920)+')';});}
addEventListener('resize',fit);fit();
(function(){
 const tip=document.getElementById('tip');let cur=null;
 function place(x,y){const r=tip.getBoundingClientRect();let L=x+16,T=y+18;
  if(L+r.width>innerWidth-8)L=x-r.width-16; if(T+r.height>innerHeight-8)T=y-r.height-14;
  tip.style.left=Math.max(8,L)+'px';tip.style.top=Math.max(8,T)+'px';}
 function show(el,x,y){cur=el;tip.textContent=el.getAttribute('data-tip');tip.classList.add('on');place(x,y);}
 function hide(){cur=null;tip.classList.remove('on');}
 document.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const el=e.target.closest('[data-tip]');if(el)show(el,e.clientX,e.clientY);else if(cur)hide();});
 document.addEventListener('pointermove',e=>{if(cur&&e.pointerType!=='touch')place(e.clientX,e.clientY);});
 document.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;const el=e.target.closest('[data-tip]');if(el&&el!==cur)show(el,e.clientX,e.clientY);else hide();});
 addEventListener('scroll',()=>{if(cur)hide();},{passive:true});
})();
"""


class Deck:
    def __init__(self, title, description='', numbered=True, toc=True):
        self.title, self.description = title, description
        self.slides = []          # (id, html, notes, short)
        self.numbered, self.toc = numbered, toc

    def slide(self, id_, body, notes='', dark=False, foot=None, short=None, pad=None):
        """Add one 1920x1080 slide. ``notes`` is HTML for the Details drop-down
        (plain text is wrapped in <p>; separate paragraphs with blank lines).
        ``short`` is the table-of-contents label (defaults to the id)."""
        bg, fg = (DARK, DINK) if dark else (BG, INK)
        pd_ = pad or ('112px 128px 160px' if foot else '112px 128px 128px')
        f = (f'<p style="position:absolute;left:128px;bottom:56px;width:1560px;font-size:22px;'
             f'color:{DMUT if dark else MUT};line-height:1.3">{foot}</p>' if foot else '')
        n = len(self.slides) + 1
        num = f'<p class="num">{n}</p>' if self.numbered else ''
        html = (f'<section id="{id_}" style="background:{bg};color:{fg};font-family:{SANS};'
                f'padding:{pd_};display:flex;flex-direction:column;gap:32px">\n{body}\n{f}{num}\n</section>')
        self.slides.append((id_, html, notes, short or id_))
        return self

    @staticmethod
    def _notes_html(notes):
        if not notes:
            return ''
        if re.search(r'<(p|table|ul|ol|div)\b', notes):
            return notes
        return ''.join(f'<p>{para.strip()}</p>' for para in re.split(r'\n\s*\n', notes) if para.strip())

    def html(self, footer=''):
        head = (f'<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
                f'<meta name="viewport" content="width=device-width, initial-scale=1">\n'
                f'<title>{esc(self.title)}</title>\n'
                f'<meta name="description" content="{esc(self.description)}">\n'
                '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400'
                '&family=IBM+Plex+Mono:wght@400;600&display=swap">\n'
                f'<style>{_CSS % dict(SANS=SANS)}</style></head><body><div class="wrap">\n')
        toc = ''
        if self.toc:
            toc = ('<nav class="toc">' + ''.join(f'<a href="#{i}">{k + 1}&nbsp;{esc(s)}</a>'
                                                for k, (i, _h, _n, s) in enumerate(self.slides)) + '</nav>\n')
        parts = []
        for id_, h, notes, _s in self.slides:
            nh = self._notes_html(notes)
            parts.append(f'<div class="frame">{h}</div>'
                         + (f'\n<details><summary>Details</summary>{nh}</details>' if nh else ''))
        foot = f'<p class="foot">{footer}</p>' if footer else ''
        return (head + toc + '\n'.join(parts) + foot
                + '</div><div id="tip" role="tooltip"></div><script>' + _JS + '</script></body></html>\n')

    def write(self, path, note_meta=None, footer=''):
        """Write the standalone page. ``note_meta`` (title, summary, tags, date)
        becomes the ``<!--note ...-->`` block that add-note.py reads."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        pre = ''
        if note_meta:
            pre = '<!--note\n' + ''.join(f'{k}: {v}\n' for k, v in note_meta.items()) + '-->\n'
        path.write_text(pre + self.html(footer))
        return path

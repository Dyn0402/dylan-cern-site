/* Proton-facility dashboard (facilities/proton-facilities.html): the settings js/facilities-survey.js reads
   to draw the proton survey instead of the neutron one. Data: data/facilities-proton.json, written by
   x17_facility_search/survey/proton/proton_dashboard.py (via survey/dashboard.py). In each row, reach[] holds
   one entry per ATOMKI claim the machine reaches, best first: days = beam days to 3σ at the ATOMKI strength
   (big plastics), days_built = the n_TOF stack as built, soft = √(days/50) = the strength reached in 50 days. */
(function () {
  'use strict';
  const daysOf = d => d == null ? '—' : d < 1 ? (d >= 1 / 24 ? Math.round(d * 24) + ' h' : '< 1 h') :
    (d < 365 ? String(Number(d.toPrecision(2))) + ' d' : String(Number((d / 365.25).toPrecision(2))) + ' yr');
  const strength = v => v == null ? '—' : (v < 0.1 ? v.toFixed(3) : v.toFixed(2)) + '×';
  window.NF_CONFIG = {
    data: '../data/facilities-proton.json',
    clsAll: 'All machine classes',
    groups: [
      { id: 'potential', label: 'Potential', css: 'var(--v-potential)', v: ['POTENTIAL'] },
      { id: 'x17lab', label: 'Own X17 experiment', css: 'var(--v-x17)', v: ['X17 LAB'] },
      { id: 'marginal', label: 'Marginal', css: 'var(--v-marginal)', v: ['MARGINAL'] },
      { id: 'watch', label: 'Watch (not running yet)', css: 'var(--v-watch)', v: ['WATCH'] },
      { id: 'out', label: 'Eliminated', css: 'var(--v-out)', v: ['ENERGY', 'CURRENT', 'ACCESS'] },
    ],
    why: {
      ENERGY: 'cannot deliver 1.03–1.10 MeV protons (≤ 0.4 MV, fixed-energy, or a big tandem)',
      CURRENT: 'well under 1 µA of protons at the energy',
      ACCESS: 'hospital, defence, sanctions, or closed',
      'X17 LAB': 'runs its own X17 pair experiment: a partner or a competitor, not a host',
    },
    tips: {
      ast: '<div class="tt">The quickest metric we can make</div>X17 produced per day into 4π if the machine\'s full DC ' +
        'current hits the target of the best ATOMKI claim it can reach (⁸Be at 1.03–1.10 MeV, ⁴He at 0.9 MeV on Ti-T, ' +
        '¹²C at ~1.9 MeV on ¹¹B), at the ATOMKI strength, <b>every X17 counted</b>: no acceptance, trigger, target ' +
        'limit or dead time. It ranks raw production only.',
      reach: '<div class="tt">50-day reach (model)</div>The X17 strength, in units of ATOMKI\'s claim, reached at 3σ in ' +
        '50 beam days with big plastics: √(days / 50). Scaled from the LNL (⁸Be) and Demokritos (⁴He) Geant4 studies; ' +
        '¹²C is an estimate. The target caps the usable current at ~20 µA (est.). <b>Smaller is better</b>; below 1× the ' +
        'machine tests the claim.',
      days: '<div class="tt">Days to the ATOMKI strength</div>Beam days to 3σ at the ATOMKI strength for the best claim ' +
        'the machine reaches, big plastics, at min(machine current, target cap). Statistics only (the calibrated 3D / ' +
        'θ × |y| fits): no systematic floor, no setup or beam-off time.',
    },
    col2: f => (f.claims && f.claims.length ? f.claims.join(' ') : '—'),
    col2sort: f => -(f.claims ? f.claims.length : 0),
    reachTxt: r => r ? strength(r.soft) : '—',
    rank: { r0: -2, r1: 0.5, ref: 1, refLabel: 'ATOMKI', title: '50-day reach, × ATOMKI strength at 3σ' },
    heroSub: f => '<p class="nf-sub">claims reached: ' + (f.claims.length ? f.claims.join(', ') : 'none') +
      ' · ' + f.i_dc + ' µA DC · protons ' + f.e_lo + '–' + f.e_hi + ' MeV · tritium: ' + f.tritium + '</p>',
    kv: (f, h) => {
      const rows = [
        ['Machine', f.kind], ['Beam', f.beam], ['Current', f.number], ['Access', f.access], ['Status', f.status],
      ];
      if (f.x17lab) rows.push(['Own X17 work', f.x17lab]);
      if (f.reach.length) {
        rows.push(['Days to ATOMKI', f.reach.map(r => '<b>' + h.esc(r.model) + '</b>: ' + daysOf(r.days) + ' big plastics · ' +
          daysOf(r.days_built) + ' as built').join('<br>') + ' <span class="nf-src">(3σ, statistics only)</span>', true]);
        rows.push(['50-day reach', strength(f.reach[0].soft) + ' ATOMKI <span class="nf-src">(best claim)</span>', true]);
      } else {
        rows.push(['Days to ATOMKI', '— <span class="nf-src">(no ATOMKI claim in its energy range)</span>', true]);
      }
      return rows;
    },
  };
})();

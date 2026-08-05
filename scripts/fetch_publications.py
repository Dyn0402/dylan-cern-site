#!/usr/bin/env python3
"""Regenerate data/publications.json from INSPIRE-HEP.

The site renders its publication list from that JSON at page load, so the CV,
INSPIRE and the site cannot drift apart -- rerun this after a paper lands:

    python3 scripts/fetch_publications.py

Everything INSPIRE knows about is written out, but only entries in SELECTED
are shown on the page by default; the rest are summarised as a count with a
link to the full INSPIRE profile. To feature a new paper, add an identifier
(arXiv id, DOI, or a distinctive title fragment) to SELECTED.
"""

import json
import pathlib
import urllib.parse
import urllib.request

AUTHOR_RECID = 1763981
AUTHOR_PROFILE = f"https://inspirehep.net/authors/{AUTHOR_RECID}"
API = "https://inspirehep.net/api/literature"

# Featured on the page, in the order given. Matched against arXiv id, DOI, or
# a lowercased substring of the title. Mirrors "Select Publications" in the CV.
SELECTED = [
    "2406.00072",                                   # PRC 110 064905, first author
    "exploring the qcd phase diagram at star",       # QM proceedings, sole author
    "cymbal",                                        # PoS QNP2024 011
    "probing the nature of the qcd phase transition",
    "recent highlights from star bes phase ii",
    "upper limits on perturbations of nuclear decay",
    "indications of an unexpected signal",
]

FIELDS = (
    "titles,publication_info,arxiv_eprints,earliest_date,document_type,"
    "collaborations,dois,authors,citation_count,thesis_info"
)


def fetch_all():
    """Page through every record INSPIRE attributes to this author."""
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode(
            {
                "q": f"authors.recid:{AUTHOR_RECID}",
                "sort": "mostrecent",
                "size": 100,
                "page": page,
                "fields": FIELDS,
            }
        )
        with urllib.request.urlopen(f"{API}?{q}", timeout=60) as r:
            payload = json.load(r)
        hits = payload["hits"]["hits"]
        out.extend(hits)
        if len(out) >= payload["hits"]["total"] or not hits:
            return out, payload["hits"]["total"]
        page += 1


def venue(meta):
    """Journal reference if published, else thesis / arXiv / report identifier."""
    info = (meta.get("publication_info") or [{}])[0]
    journal = info.get("journal_title")
    if journal:
        vol = info.get("journal_volume", "")
        artid = info.get("artid") or info.get("page_start") or ""
        year = info.get("year", "")
        return f"{journal} {vol}, {artid} ({year})".replace("  ", " ")
    if "thesis" in (meta.get("document_type") or []):
        # INSPIRE carries no journal ref for the thesis; name it explicitly.
        degree = (meta.get("thesis_info") or {}).get("degree_type", "phd")
        label = "Ph.D. thesis" if degree.lower() in ("phd", "ph.d.") else "Thesis"
        return f"{label}, UCLA ({info.get('year', '')})"
    eprints = meta.get("arxiv_eprints") or []
    if eprints:
        return f"arXiv:{eprints[0]['value']}"
    return ""


def normalise(hit):
    meta = hit["metadata"]
    eprints = [e["value"] for e in meta.get("arxiv_eprints") or []]
    collabs = [c["value"] for c in meta.get("collaborations") or []]
    return {
        "recid": hit["id"],
        "title": (meta.get("titles") or [{}])[0].get("title", "").strip(),
        "year": str(meta.get("earliest_date", ""))[:4],
        "venue": venue(meta),
        "collaborations": collabs,
        "arxiv": eprints[0] if eprints else None,
        "doi": (meta.get("dois") or [{}])[0].get("value"),
        "doc_type": (meta.get("document_type") or [None])[0],
        "n_authors": len(meta.get("authors") or []),
        "citations": meta.get("citation_count", 0),
        "url": f"https://inspirehep.net/literature/{hit['id']}",
    }


def is_selected(rec):
    keys = [k for k in (rec["arxiv"], rec["doi"]) if k]
    for i, want in enumerate(SELECTED):
        if want in [k.lower() for k in keys] or want in rec["title"].lower():
            return i
    return None


def main():
    hits, total = fetch_all()
    records = [normalise(h) for h in hits]

    featured = []
    for rec in records:
        rank = is_selected(rec)
        if rank is not None:
            featured.append((rank, rec))
    featured.sort(key=lambda p: p[0])

    missing = set(range(len(SELECTED))) - {r for r, _ in featured}
    for i in sorted(missing):
        print(f"  ! no INSPIRE match for SELECTED entry: {SELECTED[i]!r}")

    by_collab = {}
    for rec in records:
        for c in rec["collaborations"] or ["(individual)"]:
            by_collab[c] = by_collab.get(c, 0) + 1

    out = {
        "profile": AUTHOR_PROFILE,
        "orcid": "0000-0002-3639-8458",
        "total": total,
        "by_collaboration": dict(sorted(by_collab.items(), key=lambda kv: -kv[1])),
        "selected": [rec for _, rec in featured],
    }

    dest = pathlib.Path(__file__).resolve().parent.parent / "data" / "publications.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"{total} records -> {len(out['selected'])} featured, written to {dest}")


if __name__ == "__main__":
    main()

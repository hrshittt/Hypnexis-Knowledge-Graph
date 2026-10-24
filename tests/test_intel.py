"""Document intelligence over a workspace's own documents: corporate figures with provenance, research paper
structure and comparison, legal applicability that is never stated as confirmed."""

from conftest import SAMPLES
from platform_support import app, first_workspace, make_client, register, wait_ws  # noqa: F401


def _workspace_with_samples(app, email, wtype):
    s = register(make_client(app), email, wtype)
    ws = first_workspace(s, wtype)
    assert s.post(f"/api/workspaces/{ws}/kb/samples/load").status_code == 202
    wait_ws(s, ws)
    return s, ws


# ── corporate ────────────────────────────────────────────────────────────────

def test_corporate_figures_carry_period_currency_and_source(app):
    s, ws = _workspace_with_samples(app, "cfo@example.com", "corporate")
    a = s.get(f"/api/workspaces/{ws}/corporate/analysis", params={"company": "Meridian Grid"}).json()
    assert "Meridian Grid" in a["companies"] and a["currencies"] == ["USD"]
    rev = {p["period"]["label"]: p for p in a["metrics"]["revenue"]["points"]}
    assert rev["FY2024"]["value"] == 412.5 and rev["FY2023"]["value"] == 380.2
    for p in rev.values():
        c = p["citation"]
        assert p["basis"] == "reported" and p["currency"] == "USD"
        assert c["filename"].startswith("meridian_grid") and c["page"] >= 1
        assert p["as_written"].replace("$", "").split()[0] in c["sentence"]   # the figure is in the quoted sentence
    growth = next(d for d in a["derived"] if d["metric"] == "revenue_growth")
    assert growth["basis"] == "calculated" and growth["formula"] and round(growth["value"], 1) == 8.5
    assert all(i.get("citation") for i in growth["inputs"])


def test_corporate_risks_separate_disclosed_from_inferred(app):
    s, ws = _workspace_with_samples(app, "risk@example.com", "corporate")
    a = s.get(f"/api/workspaces/{ws}/corporate/analysis", params={"company": "Meridian Grid"}).json()
    assert a["risks"]["disclosed"] and a["risks"]["inferred"]
    for r in a["risks"]["disclosed"]:
        assert r["basis"] == "disclosed" and r["evidence"] and r["evidence"][0]["sentence"]
    for r in a["risks"]["inferred"]:
        assert r["basis"] == "inferred" and r["condition"] and r["inputs"]
    assert a["methodology"] and any("credit rating" in l for l in a["limitations"])


def test_corporate_missing_data_is_not_fabricated(app):
    s, ws = _workspace_with_samples(app, "missing@example.com", "corporate")
    a = s.get(f"/api/workspaces/{ws}/corporate/analysis", params={"company": "Voltaic Systems"}).json()
    assert a["documents"] and "revenue" not in a["metrics"]  # the partner brief states no revenue figure
    empty = register(make_client(app), "empty@example.com", "corporate")
    ews = first_workspace(empty, "corporate")
    e = empty.get(f"/api/workspaces/{ews}/corporate/analysis").json()
    assert e["documents"] == [] and e["metrics"] == {} and e["figure_count"] == 0


def test_corporate_documents_without_company_are_kept_apart(app):
    s, ws = _workspace_with_samples(app, "unassigned@example.com", "corporate")
    up = s.post(f"/api/workspaces/{ws}/kb/documents",
                files=[("files", ("port_calder_health_study.txt", (SAMPLES / "port_calder_health_study.txt").read_bytes()))])
    assert up.status_code == 202
    wait_ws(s, ws)
    a = s.get(f"/api/workspaces/{ws}/corporate/analysis", params={"company": "Meridian Grid"}).json()
    assert a["unassigned_documents"] == 1
    assert all(d["meta"]["company"] == "Meridian Grid" for d in a["documents"])
    g = s.get(f"/api/workspaces/{ws}/corporate/graph", params={"company": "Meridian Grid"}).json()
    assert any(n["type"] == "Company" and n["name"] == "Meridian Grid" for n in g["nodes"])
    assert any(n["type"] == "Financial metric" and n["detail"].get("citation") for n in g["nodes"])


def test_analysis_routes_check_workspace_type(app):
    s = register(make_client(app), "types@example.com", "research")
    ws = first_workspace(s, "research")
    assert s.get(f"/api/workspaces/{ws}/corporate/analysis").status_code == 404
    assert s.get(f"/api/workspaces/{ws}/legal/sources").status_code == 404


# ── research ─────────────────────────────────────────────────────────────────

def test_research_paper_structure_is_cited_and_missing_fields_flagged(app):
    s, ws = _workspace_with_samples(app, "phd@example.com", "research")
    papers = s.get(f"/api/workspaces/{ws}/research/papers").json()["papers"]
    coal = next(p for p in papers if p["filename"] == "coal_retirement_asthma_study.txt")
    assert coal["authors"]["found"] and "Amina Diallo" in coal["authors"]["value"]
    findings = coal["fields"]["findings"]
    assert findings["found"] and all(i["citation"]["doc_id"] == coal["doc_id"] for i in findings["items"])
    concl = coal["fields"]["conclusion"]
    assert concl["found"] is False and concl["items"] == [] and concl["note"]


def test_research_compare_quotes_each_paper_separately(app):
    s, ws = _workspace_with_samples(app, "cmp@example.com", "research")
    papers = s.get(f"/api/workspaces/{ws}/research/papers").json()["papers"]
    a, b = papers[0]["doc_id"], papers[1]["doc_id"]
    assert s.post(f"/api/workspaces/{ws}/research/compare", json={"doc_ids": [a, a]}).status_code == 422
    c = s.post(f"/api/workspaces/{ws}/research/compare", json={"doc_ids": [a, b]}).json()
    for row in c["rows"]:
        for side, did in (("a", a), ("b", b)):
            assert all(i["citation"]["doc_id"] == did for i in row[side]["items"] if i.get("citation"))
    rel = s.get(f"/api/workspaces/{ws}/research/papers/{a}/related").json()["related"]
    assert rel and all(r["doc_id"] != a for r in rel)


# ── legal ────────────────────────────────────────────────────────────────────

def test_legal_applicability_is_potential_with_provisions_and_disclaimer(app):
    s, ws = _workspace_with_samples(app, "counsel@example.com", "legal")
    src = s.get(f"/api/workspaces/{ws}/legal/sources").json()
    assert src["jurisdictions"] == ["Coastal State (fictional)"] and src["disclaimer"]
    r = s.post(f"/api/workspaces/{ws}/legal/analyze",
               json={"question": "Our startup collects customer data and processes online card payments."}).json()
    assert r["laws"] and r["status_note"] and r["disclaimer"]
    assert {f["key"] for f in r["facts"]} >= {"personal_data", "payments"}
    for law in r["laws"]:
        assert law["applicability"] == "potential"
        assert law["provisions"] and law["why"] and law["limitations"]
        assert all(o["citation"]["doc_id"] == law["doc_id"] for o in law["obligations"])
        assert law["source_url"] is None  # no official link recorded for the samples, so none is shown


def test_legal_jurisdiction_outside_sources_asks_for_clarification(app):
    s, ws = _workspace_with_samples(app, "juris@example.com", "legal")
    r = s.post(f"/api/workspaces/{ws}/legal/analyze", json={"question": "We process customer data.", "jurisdiction": "India"}).json()
    assert r["laws"] == [] and r["clarifications"] and r["message"]
    empty = register(make_client(app), "nolaw@example.com", "legal")
    ews = first_workspace(empty, "legal")
    e = empty.post(f"/api/workspaces/{ews}/legal/analyze", json={"question": "Which data rules apply to us?"}).json()
    assert e["laws"] == [] and "no legal sources" in e["message"].lower()


def test_legal_provisions_and_graph_cite_their_text(app):
    s, ws = _workspace_with_samples(app, "prov@example.com", "legal")
    src = s.get(f"/api/workspaces/{ws}/legal/sources").json()["sources"]
    act = next(x for x in src if "Data Protection" in x["title"])
    p = s.get(f"/api/workspaces/{ws}/legal/provisions", params={"doc_id": act["doc_id"]}).json()
    refs = [x["ref"] for x in p["provisions"]]
    assert "Section 3" in refs and any("obligation" in snt["classes"] for x in p["provisions"] for snt in x["sentences"])
    g = s.get(f"/api/workspaces/{ws}/legal/graph").json()
    assert g["edges"] and all(e["evidence"] for e in g["edges"])

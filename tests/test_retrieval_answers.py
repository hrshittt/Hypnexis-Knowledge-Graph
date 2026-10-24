"""Routing, entity linking, hybrid retrieval, graph paths, grounded answers and citation integrity."""

import re

import pytest
from conftest import make_service, run, sample_payload

from backend.kb.answer import validate_citations
from backend.kb.router import heuristic_route

CITE = re.compile(r"\[([SG]\d+)\]")


def _assert_citations_resolve(ans):
    """Every citation in the answer exists, and every cited graph fact is backed by a passage."""
    sources = {s["id"]: s for s in ans["sources"]}
    facts = {f["id"]: f for f in ans["graph_facts"]}
    cited = set(CITE.findall(ans["answer"]))
    assert cited <= set(sources) | set(facts), cited - set(sources) - set(facts)
    for f in facts.values():
        assert f["source_ids"] and f["evidence"], f"graph fact {f['id']} has no source passage"
        for ev in f["evidence"]:
            assert ev["sentence"] in sources[ev["source_id"]]["text"]
    return cited


# ── linking & routing ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("question,names", [
    ("Who founded Voltaic Systems?", ["Voltaic Systems"]),
    ("How is Dr. Lena Park connected to Voltaic Systems'  batteries?", ["Lena Park", "Voltaic Systems"]),
    ("what causes childhood asthma in port calder", ["childhood asthma", "Port Calder"]),
    ("Tell me about Voltaik Systems", ["Voltaic Systems"]),  # fuzzy
    ("What did Diallo recommend?", ["Amina Diallo"]),       # distinctive name token
])
def test_entity_linking(loaded_kb, question, names):
    linked = [l["name"] for l in loaded_kb.retriever.link_entities(question)]
    for n in names:
        assert n in linked, (question, linked)


@pytest.mark.parametrize("question,route", [
    ("What are the main themes across these documents?", "thematic"),
    ("Give me an overview of the collection", "thematic"),
    ("Who founded Voltaic Systems?", "factual"),
    ("How is the Clean Horizon Act connected to childhood asthma?", "multi_hop"),
    ("What links Lena Park and Meridian Grid?", "multi_hop"),
    ("Compare Aurora Institute and Voltaic Systems.", "comparison"),
    ("How does the Voltaic Systems brief differ from the Meridian Grid annual report?", "comparison"),
])
def test_router(loaded_kb, question, route):
    linked = loaded_kb.retriever.link_entities(question)
    from backend.kb.router import match_documents
    docs = loaded_kb.store.list_documents("ready")
    assert heuristic_route(question, linked, match_documents(question, docs), len(docs))[0] == route


def test_hybrid_search_finds_the_right_passage(loaded_kb):
    hits = loaded_kb.retriever.search("cathode powders iron-based", k=3)
    assert hits and "iron-based cathode powders" in hits[0]["text"]
    assert {"chunk_id", "filename", "page", "start_char", "end_char", "score"} <= set(hits[0])
    scoped = loaded_kb.retriever.search("Meridian Grid", k=5,
                                        doc_ids=[d["doc_id"] for d in loaded_kb.store.list_documents("ready")
                                                 if d["filename"].endswith(".pdf")])
    assert scoped and all(h["filename"].endswith(".pdf") for h in scoped)


def test_graph_paths_are_evidenced(loaded_kb):
    R = loaded_kb.retriever
    a = R.link_entities("Clean Horizon Act")[0]["id"]
    b = R.link_entities("childhood asthma")[0]["id"]
    paths = R.paths(a, b)
    assert paths and paths[0]["hops"] <= 4
    names = [R.entity_brief(n)["name"] for n in paths[0]["nodes"]]
    assert names[0] == "Clean Horizon Act" and names[-1] == "childhood asthma"
    ev = loaded_kb.store.relation_evidence([e["relation_id"] for e in paths[0]["edges"]])
    assert all(ev.get(e["relation_id"]) for e in paths[0]["edges"])


# ── end-to-end answers ───────────────────────────────────────────────────────

def test_factual_answer(loaded_kb):
    ans = run(loaded_kb.answer("Who founded Voltaic Systems?"))
    assert ans["route"] == "factual" and ans["sufficient"] and ans["mode"] == "extractive"
    assert "Ravi Menon" in ans["answer"]
    assert _assert_citations_resolve(ans)
    assert any(f["predicate"] == "founded" for f in ans["graph_facts"])


def test_multi_hop_answer_highlights_path(loaded_kb):
    ans = run(loaded_kb.answer("How is the Clean Horizon Act connected to childhood asthma?"))
    assert ans["route"] == "multi_hop" and ans["sufficient"]
    _assert_citations_resolve(ans)
    path = ans["paths"][0]
    assert path["nodes"][0]["name"] == "Clean Horizon Act" and path["nodes"][-1]["name"] == "childhood asthma"
    assert set(ans["highlight"]["path_edges"]) == set(path["edge_ids"])
    assert {n["id"] for n in path["nodes"]} <= set(ans["highlight"]["nodes"])


def test_thematic_answer_uses_topics(loaded_kb):
    ans = run(loaded_kb.answer("What are the main themes across these documents?"))
    assert ans["route"] == "thematic" and ans["sufficient"]
    assert len(ans["topics"]) >= 3
    assert set(ans["highlight"]["communities"]) >= {t["id"] for t in ans["topics"]}
    _assert_citations_resolve(ans)


def test_comparison_answers(loaded_kb):
    ent = run(loaded_kb.answer("Compare Aurora Institute and Voltaic Systems."))
    assert ent["route"] == "comparison" and ent["comparison"]["kind"] == "entities"
    assert [t["label"] for t in ent["comparison"]["targets"]] == ["Aurora Institute", "Voltaic Systems"]
    doc = run(loaded_kb.answer("Compare the Voltaic Systems brief with the Meridian Grid annual report."))
    assert doc["comparison"]["kind"] == "documents"
    assert all(t["source_ids"] for t in doc["comparison"]["targets"])
    for a in (ent, doc):
        _assert_citations_resolve(a)


@pytest.mark.parametrize("question", [
    "What is Voltaic Systems' current stock price?",
    "Who won the 2022 FIFA World Cup?",
    "What is the boiling point of mercury?",
])
def test_insufficient_evidence_is_not_answered(loaded_kb, question):
    ans = run(loaded_kb.answer(question))
    assert not ans["sufficient"]
    assert ans["answer"].startswith("**Insufficient evidence.**")
    assert ans["highlight"]["edges"] == [] and ans["graph_facts"] == [] or not ans["citations_used"]


def test_unknown_entities_have_no_path(loaded_kb):
    ans = run(loaded_kb.answer("How is Lena Park connected to Elon Musk?"))
    assert not (ans["route"] == "multi_hop" and ans["paths"] and ans["paths"][0]["nodes"][-1]["name"] == "Elon Musk")


def test_empty_kb_answers_insufficient(kb):
    ans = run(kb.answer("What are the main themes?"))
    assert not ans["sufficient"] and "Insufficient evidence" in ans["answer"]
    ans = run(kb.answer("Who founded Voltaic Systems?"))
    assert not ans["sufficient"]


# ── citation validation & LLM grounding ──────────────────────────────────────

PACK = {"sources": [{"id": "S1", "text": "Ravi Menon founded Voltaic Systems in 2019."}],
        "facts": [{"id": "G1", "subject": {"name": "Ravi Menon"}, "predicate": "founded",
                   "object": {"name": "Voltaic Systems"}, "sentence": "Ravi Menon founded Voltaic Systems in 2019."}]}


def test_validate_citations_strips_fabricated_ids():
    v = validate_citations("Ravi Menon founded Voltaic Systems [S1][S7]. It is in Paris [G9].", PACK)
    assert v["used"] == ["S1"] and set(v["invalid"]) == {"S7", "G9"}
    assert "[S7]" not in v["text"] and "[G9]" not in v["text"]
    assert any("non-existent" in w for w in v["warnings"])


def test_validate_citations_normalises_groups():
    v = validate_citations("Ravi Menon founded Voltaic Systems [S1, G1].", PACK)
    assert v["used"] == ["S1", "G1"] and "[S1][G1]" in v["text"]


class FakeLLM:
    available = True

    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    async def complete(self, prompt, **kw):
        self.prompts.append(prompt)
        return self.reply

    async def complete_json(self, prompt, **kw):
        raise RuntimeError("not used")


def _llm_kb(tmp_path, reply):
    svc = make_service(tmp_path / "kb")
    run(svc.ingest_files_and_wait(sample_payload("voltaic_systems_brief.txt")))
    svc.llm = FakeLLM(reply)
    return svc


def test_llm_answer_with_fabricated_citation_is_cleaned(tmp_path):
    svc = _llm_kb(tmp_path, "Ravi Menon founded Voltaic Systems [S1]. He also founded Tesla [S42].")
    ans = run(svc.answer("Who founded Voltaic Systems?"))
    assert ans["mode"] == "llm" and "[S42]" not in ans["answer"] and "[S1]" in ans["answer"]
    assert any("non-existent" in w for w in ans["warnings"])
    assert "INSUFFICIENT_EVIDENCE" in svc.llm.prompts[-1]  # grounding rules were sent


def test_llm_answer_without_citations_is_replaced(tmp_path):
    svc = _llm_kb(tmp_path, "Voltaic Systems was founded by Elon Musk in 1999.")
    ans = run(svc.answer("Who founded Voltaic Systems?"))
    assert ans["mode"] == "extractive" and "Elon Musk" not in ans["answer"]
    assert any("no valid citations" in w for w in ans["warnings"])


def test_llm_can_declare_insufficient(tmp_path):
    svc = _llm_kb(tmp_path, "INSUFFICIENT_EVIDENCE: the brief does not mention revenue.")
    ans = run(svc.answer("What revenue did Voltaic Systems report from storage?"))
    assert not ans["sufficient"] and "revenue" in ans["answer"]

"""Extraction accuracy beyond the sample corpus.

Regressions from the hackathon audit (tests/fixtures/northwind_robotics_memo.txt):
  - "Northwind Robotics was founded in 2015 by Maya Ortiz" came out reversed
    (Northwind Robotics —founded→ Maya Ortiz) because the date broke the passive pattern;
  - "… operates autonomous tractors built by Northwind Robotics" produced no relation at all,
    so the multi-hop question about Maya Ortiz and the cooperative failed.
Plus held-out sentences (not from any sample) and the direction guard for LLM output.
"""

from pathlib import Path

import pytest
from conftest import make_service, run, sample_payload

from backend.kb.extraction import HeuristicExtractor, passive_reversed, validate_llm_extraction

MEMO = Path(__file__).parent / "fixtures" / "northwind_robotics_memo.txt"


def triples(text):
    r = HeuristicExtractor().extract("c1", text)
    return {(x.subject, x.predicate, x.object) for x in r.relations}, r


def test_memo_founder_is_not_reversed():
    found, r = triples(MEMO.read_text(encoding="utf-8"))
    assert ("Maya Ortiz", "founded", "Northwind Robotics") in found
    assert ("Northwind Robotics", "founded", "Maya Ortiz") not in found
    assert all(rel.evidence in MEMO.read_text(encoding="utf-8") for rel in r.relations)


def test_memo_tractor_manufacturing_relationship():
    found, _ = triples(MEMO.read_text(encoding="utf-8"))
    assert ("Northwind Robotics", "builds", "autonomous tractors") in found
    assert ("Greenfield Farming Cooperative", "operates", "autonomous tractors") in found


@pytest.mark.parametrize("text,expected,reversed_", [
    # passive voice with dates / adverbs between the verb and its agent
    ("Brightwater Clinic was acquired in March 2021 by Solace Health.",
     ("Solace Health", "acquired", "Brightwater Clinic"), ("Brightwater Clinic", "acquired", "Solace Health")),
    ("The Lumen Archive was originally established by the Halden Trust.",
     ("Halden Trust", "founded", "Lumen Archive"), ("Lumen Archive", "founded", "Halden Trust")),
    ("Orion Labs was funded during 2019 by Vega Capital.",
     ("Vega Capital", "funds", "Orion Labs"), ("Orion Labs", "funds", "Vega Capital")),
    ("The Kestrel Bridge was designed in the early 1990s by Arlo Mendes and Tessa Grant.",
     ("Tessa Grant", "develops", "Kestrel Bridge"), ("Kestrel Bridge", "develops", "Tessa Grant")),
    ("Tidewater Ferries was acquired on 4 May 2021 by Calder Transit.",
     ("Calder Transit", "acquired", "Tidewater Ferries"), ("Tidewater Ferries", "acquired", "Calder Transit")),
    # active voice with a trailing date stays active
    ("Maya Ortiz founded Northwind Robotics in 2015.",
     ("Maya Ortiz", "founded", "Northwind Robotics"), ("Northwind Robotics", "founded", "Maya Ortiz")),
    # reduced relative clause and a subject noun phrase with a prepositional modifier
    ("The Greenfield Farming Cooperative operates autonomous tractors built by Northwind Robotics.",
     ("Northwind Robotics", "builds", "autonomous tractors"), ("autonomous tractors", "builds", "Northwind Robotics")),
    pytest.param(
        "The museum displays engines built by Harlow Motors.",
        ("Harlow Motors", "builds", "engines"), ("engines", "builds", "Harlow Motors"),
        marks=pytest.mark.xfail(strict=True, reason=(
            "known limitation: 'displays' is not in the verb lexicon, so the rule-based extractor reads "
            "'museum displays engines' as one noun phrase (direction is still correct). Gemini mode covers this."))),
    ("Soil compaction from heavy machinery reduces crop yields.",
     ("soil compaction", "reduces", "crop yields"), None),
])
def test_held_out_sentences(text, expected, reversed_):
    found, r = triples(text)
    assert expected in found, found
    if reversed_:
        assert reversed_ not in found
    assert all(rel.evidence == text for rel in r.relations)


def test_no_sample_relation_contradicts_its_evidence(loaded_kb):
    rels = loaded_kb.store.relations()
    names = {e: v["name"] for e, v in loaded_kb.store.get_entities(
        [r["subject_id"] for r in rels] + [r["object_id"] for r in rels]).items()}
    evidence = loaded_kb.store.relation_evidence([r["relation_id"] for r in rels])
    for r in rels:
        for ev in evidence[r["relation_id"]]:
            assert not passive_reversed(ev["sentence"], names[r["subject_id"]], r["predicate"], names[r["object_id"]]), \
                (names[r["subject_id"]], r["predicate"], names[r["object_id"]], ev["sentence"])


def test_passive_reversed_guard():
    s = "Northwind Robotics was founded in 2015 by Maya Ortiz, a former aerospace engineer."
    assert passive_reversed(s, "Northwind Robotics", "founded", "Maya Ortiz")
    assert not passive_reversed(s, "Maya Ortiz", "founded", "Northwind Robotics")
    assert not passive_reversed(s, "Northwind Robotics", "founded by", "Maya Ortiz")  # passive predicate is fine
    # a different verb in the passive clause is not evidence against the relation
    assert not passive_reversed("Ravi Menon was hired by Voltaic Systems.", "Ravi Menon", "worked at", "Voltaic Systems")


def test_llm_reversed_relation_is_rejected():
    chunk = "Northwind Robotics was founded in 2015 by Maya Ortiz. Helio Sensors manufactures lidar units."
    data = {"entities": [{"name": "Northwind Robotics", "type": "Organization"}, {"name": "Maya Ortiz", "type": "Person"}],
            "relations": [
                {"subject": "Northwind Robotics", "predicate": "founded", "object": "Maya Ortiz",
                 "evidence": "Northwind Robotics was founded in 2015 by Maya Ortiz."},
                {"subject": "Maya Ortiz", "predicate": "founded", "object": "Northwind Robotics",
                 "evidence": "Northwind Robotics was founded in 2015 by Maya Ortiz."},
            ]}
    out = validate_llm_extraction(data, chunk, "c1")
    assert [(r.subject, r.predicate, r.object) for r in out.relations] == [("Maya Ortiz", "founded", "Northwind Robotics")]
    assert out.rejected == 1


def test_memo_multi_hop_now_answerable(tmp_path):
    """End to end: the audit's failing question is answered through the repaired relations."""
    kb = make_service(tmp_path / "kb")
    run(kb.ingest_files_and_wait(sample_payload() + [(MEMO.name, MEMO.read_bytes())]))
    ans = run(kb.answer("How is Maya Ortiz connected to Greenfield Farming Cooperative?"))
    assert ans["route"] == "multi_hop" and ans["sufficient"], ans["sufficiency_reason"]
    assert ans["paths"][0]["text"] == ("Maya Ortiz → Northwind Robotics → autonomous tractors → "
                                       "Greenfield Farming Cooperative")
    memo = MEMO.read_text(encoding="utf-8")
    for fact in ans["graph_facts"][:3]:
        assert fact["sentence"] in memo  # every hop is backed by a verbatim memo sentence
    founded = run(kb.answer("Who founded Northwind Robotics?"))
    assert any(f["subject"]["name"] == "Maya Ortiz" and f["predicate"] == "founded"
               and f["object"]["name"] == "Northwind Robotics" for f in founded["graph_facts"])
    kb.store.close()

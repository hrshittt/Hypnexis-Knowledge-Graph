"""Triple extraction: heuristic patterns, and validation that blocks fabricated LLM relations."""

import pytest

from backend.kb.extraction import HeuristicExtractor, validate_llm_extraction
from backend.kb.llm import parse_json_block


def triples(text, **kw):
    r = HeuristicExtractor(**kw).extract("c1", text)
    return {(x.subject, x.predicate, x.object) for x in r.relations}, r


@pytest.mark.parametrize("text,expected", [
    ("Ravi Menon founded Voltaic Systems in 2019.", ("Ravi Menon", "founded", "Voltaic Systems")),
    ("The institute was founded by Tomas Reyes.", None),  # no antecedent in chunk → no fabricated subject
    ("Voltaic Systems was acquired by Helix Holdings in 2024.", ("Helix Holdings", "acquired", "Voltaic Systems")),
    ("Elena Vasquez is the chief executive officer of Meridian Grid.", ("Elena Vasquez", "ceo of", "Meridian Grid")),
    ("Commissioner Hana Okafor chairs the Coastal Energy Commission.", ("Hana Okafor", "leads", "Coastal Energy Commission")),
    ("Meridian Grid received rebates from the Storage Incentive Program.",
     ("Storage Incentive Program", "funds", "Meridian Grid")),
    ("The Clean Horizon Act required the closure of the Harbor Coal Plant.",
     ("Clean Horizon Act", "requires closure of", "Harbor Coal Plant")),
    ("Voltaic Systems is a battery startup headquartered in Port Calder.", ("Voltaic Systems", "located in", "Port Calder")),
])
def test_heuristic_patterns(text, expected):
    found, _ = triples(text)
    if expected is None:
        assert not any(t[0] == "the institute" for t in found)
    else:
        assert expected in found, found


def test_appositive_relative_clause_and_coreference():
    text = ("Voltaic Systems acquired Ferrite Labs, a cathode supplier based in Kestrel Bay. "
            "Meridian Grid operates the Harbor Storage Facility, which uses sodium-ion batteries supplied by Voltaic Systems. "
            "Ravi Menon worked at the Aurora Institute. He later founded Voltaic Systems.")
    found, r = triples(text)
    assert ("Voltaic Systems", "acquired", "Ferrite Labs") in found
    assert ("Ferrite Labs", "located in", "Kestrel Bay") in found
    assert ("Meridian Grid", "operates", "Harbor Storage Facility") in found
    assert ("Harbor Storage Facility", "uses", "sodium-ion batteries") in found
    assert ("Voltaic Systems", "supplies", "sodium-ion batteries") in found
    assert ("Ravi Menon", "founded", "Voltaic Systems") in found  # "He" resolved
    # evidence is always the verbatim source sentence
    assert all(rel.evidence in text for rel in r.relations)


def test_coordination_and_concepts():
    found, r = triples("Dr. Lena Park leads the Aurora Institute and directs its perovskite research program. "
                       "Fine particulate pollution is linked to childhood asthma in coastal towns.")
    assert ("Lena Park", "leads", "Aurora Institute") in found
    assert ("Lena Park", "leads", "perovskite research program") in found
    assert ("fine particulate pollution", "linked to", "childhood asthma") in found
    types = {e.name: e.type for e in r.entities}
    assert types["Lena Park"] == "Person" and types["childhood asthma"] == "Concept"


def test_headings_do_not_become_entities():
    _, r = triples("Voltaic Systems Company Brief\nCompany Background\nVoltaic Systems develops batteries for storage.")
    names = {e.name for e in r.entities}
    assert "Voltaic Systems" in names
    assert not names & {"Company Background", "Voltaic Systems Company", "Company Brief"}


def test_acronym_aliases():
    _, r = triples("The Coastal Energy Commission (CEC) regulates Meridian Grid.")
    assert ("CEC", "Coastal Energy Commission") in r.aliases


# ── LLM output validation ────────────────────────────────────────────────────

CHUNK = ("Ravi Menon founded Voltaic Systems in 2019. Voltaic Systems develops sodium-ion batteries. "
         "Meridian Grid uses Voltaic Systems batteries at the Harbor Storage Facility.")


def test_llm_valid_relation_kept_with_verbatim_evidence():
    data = {"entities": [{"name": "Ravi Menon", "type": "Person"}, {"name": "Voltaic Systems", "type": "Organization"}],
            "relations": [{"subject": "Ravi Menon", "predicate": "founded", "object": "Voltaic Systems",
                           "evidence": "Ravi Menon founded Voltaic Systems in 2019."}]}
    out = validate_llm_extraction(data, CHUNK, "c1")
    assert [(r.subject, r.predicate, r.object) for r in out.relations] == [("Ravi Menon", "founded", "Voltaic Systems")]
    assert out.relations[0].evidence in CHUNK


def test_llm_fabrications_are_rejected():
    data = {
        "entities": [{"name": "Ravi Menon", "type": "Person"}, {"name": "Tesla", "type": "Organization"},
                     {"name": "Voltaic Systems", "type": "Organization"}],
        "relations": [
            # entity not in the passage
            {"subject": "Ravi Menon", "predicate": "worked at", "object": "Tesla",
             "evidence": "Ravi Menon worked at Tesla."},
            # evidence not in the passage
            {"subject": "Voltaic Systems", "predicate": "acquired", "object": "Meridian Grid",
             "evidence": "Voltaic Systems acquired Meridian Grid in 2025."},
            # self loop
            {"subject": "Voltaic Systems", "predicate": "is", "object": "Voltaic Systems", "evidence": CHUNK},
        ],
    }
    out = validate_llm_extraction(data, CHUNK, "c1")
    assert out.relations == []
    assert "Tesla" not in {e.name for e in out.entities}
    assert out.rejected >= 3


def test_llm_paraphrased_evidence_snaps_to_real_sentence():
    data = {"entities": [{"name": "Meridian Grid"}, {"name": "Harbor Storage Facility"}],
            "relations": [{"subject": "Meridian Grid", "predicate": "uses_batteries_at", "object": "Harbor Storage Facility",
                           "evidence": "Meridian Grid uses Voltaic Systems batteries at Harbor Storage Facility"}]}
    out = validate_llm_extraction(data, CHUNK, "c1")
    assert out.relations[0].evidence == "Meridian Grid uses Voltaic Systems batteries at the Harbor Storage Facility."
    assert out.relations[0].predicate == "uses batteries at"


def test_parse_json_block_tolerates_fences_and_prose():
    assert parse_json_block('```json\n{"a": [1, 2]}\n```') == {"a": [1, 2]}
    assert parse_json_block('Sure! Here it is: {"x": "y {z}"} hope that helps') == {"x": "y {z}"}
    with pytest.raises(ValueError):
        parse_json_block("no json here")

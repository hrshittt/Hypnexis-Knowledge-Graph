"""Placement intelligence: imports (CSV/XLSX, validation, duplicates), metric definitions, year comparisons,
unknown outcomes, PPO conversion, and role-based access to student-level records."""

from platform_support import app, csv_bytes, first_workspace, make_client, register, stage_and_commit, xlsx_bytes  # noqa: F401

ROSTER = [
    ["Academic Year", "Roll No", "Branch", "Eligible", "Registered for Placement", "Student Name", "Gender"],
    ["2023-24", "S1", "CS", "Yes", "Yes", "Asha", "F"],
    ["2023-24", "S2", "CS", "Yes", "Yes", "Ben", "M"],
    ["2023-24", "S3", "EE", "Yes", "No", "Chen", "M"],
    ["2023-24", "S4", "EE", "No", "No", "Dev", "M"],
    ["2024-25", "S5", "CS", "Yes", "Yes", "Esha", "F"],
]

APPS = [
    ["Academic Year", "Roll No", "Company Name", "Opportunity Type", "Stage", "Status", "Internship Status", "PPO Status", "CTC (LPA)"],
    ["2023-24", "S1", "Acme", "Full-time", "Offer extended", "Offer accepted", "", "", "10"],
    ["2023-24", "S1", "Beta", "Full-time", "Offer extended", "Selected", "", "", "12"],
    ["2023-24", "S2", "Acme", "Internship", "Offer extended", "Accepted", "Completed", "Accepted", ""],
    ["2023-24", "S3", "Beta", "Internship", "Offer extended", "Accepted", "Completed", "No", ""],
    ["2023-24", "S3", "Gamma", "Internship", "Offer extended", "Accepted", "Ongoing", "Pending", ""],
    ["2023-24", "S2", "Gamma", "Full-time", "Technical interview", "Rejected", "", "", ""],
    ["2023-24", "S4", "Acme", "Full-time", "HR interview", "", "", "", ""],
    ["2024-25", "S5", "Acme", "Full-time", "Offer extended", "Offered", "", "", "11"],
]


def _setup(app, email="tpo@example.com"):
    s = register(make_client(app), email, "placement")
    ws = first_workspace(s, "placement")
    prev, r = stage_and_commit(s, ws, "students", "roster.csv", csv_bytes(ROSTER))
    assert r.status_code == 200, r.text
    prev2, r2 = stage_and_commit(s, ws, "applications", "apps.csv", csv_bytes(APPS))
    assert r2.status_code == 200, r2.text
    return s, ws, prev, r.json(), r2.json()


def test_import_maps_columns_and_never_imports_sensitive_data(app):
    from backend import services
    s, ws, prev, roster, apps = _setup(app)
    assert prev["mapping"]["student_id"] == "Roll No" and prev["mapping"]["department"] == "Branch"
    assert set(prev["sensitive_columns"]) == {"Student Name", "Gender"}
    assert "Student Name" not in prev["mapping"].values()
    assert roster["summary"]["inserted"] == 5 and apps["summary"]["inserted"] == 8
    cols = {r["name"] for r in services.db().q("PRAGMA table_info(pl_students)")}
    assert not {"name", "gender", "student_name"} & cols
    # mapping a sensitive column explicitly is refused
    r = s.post(f"/api/workspaces/{ws}/placement/imports", data={"kind": "students"},
               files={"file": ("again.csv", csv_bytes(ROSTER))})
    imp = r.json()["import"]["id"]
    bad = s.post(f"/api/workspaces/{ws}/placement/imports/{imp}/preview",
                 json={"mapping": {**r.json()["mapping"], "department": "Gender"}})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "sensitive_column"


def test_validation_reports_invalid_rows_and_in_file_duplicates(app):
    s = register(make_client(app), "val@example.com", "placement")
    ws = first_workspace(s, "placement")
    rows = [APPS[0], APPS[1], APPS[1], ["2023-24", "S9", "", "Full-time", "HR interview", "Rejected", "", "", ""],
            ["2023-24", "S9", "Zeta", "Full-time", "Group discussion", "Rejected", "", "", ""]]
    r = s.post(f"/api/workspaces/{ws}/placement/imports", data={"kind": "applications"}, files={"file": ("a.csv", csv_bytes(rows))})
    assert r.status_code == 201
    p = r.json()
    assert p["summary"]["total_rows"] == 4 and p["summary"]["valid"] == 1
    assert p["summary"]["duplicates_in_file"] == 1
    msgs = " ".join(e["message"] for e in p["errors"])
    assert "Company is required" in msgs and "Unknown stage" in msgs
    assert p["summary"]["unknown_values"]["stage"][0]["value"] == "Group discussion"
    # nothing is written until commit
    assert s.get(f"/api/workspaces/{ws}/placement/overview").json()["counts"]["records"] == 0


def test_xlsx_import(app):
    s = register(make_client(app), "xl@example.com", "placement")
    ws = first_workspace(s, "placement")
    prev, r = stage_and_commit(s, ws, "students", "roster.xlsx", xlsx_bytes([ROSTER[0][:5], *[x[:5] for x in ROSTER[1:3]]]))
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["inserted"] == 2
    prev, r = stage_and_commit(s, ws, "students", "inline.xlsx",
                               xlsx_bytes([["Academic Year", "Roll No"], ["2025-26", "Z1"]], shared_strings=False))
    assert r.status_code == 200 and r.json()["summary"]["inserted"] == 1


def test_duplicate_policy_skip_and_explicit_update(app):
    s, ws, *_ = _setup(app)
    changed = [r[:] for r in ROSTER]
    changed[4][3] = "Yes"  # S4 becomes eligible in the new file
    prev, r = stage_and_commit(s, ws, "students", "roster2.csv", csv_bytes(changed))
    assert prev["summary"]["existing_matches"] == 5 and prev["summary"]["new_records"] == 0
    assert r.json()["summary"]["skipped_existing"] == 5 and r.json()["summary"]["updated"] == 0
    kpis = s.get(f"/api/workspaces/{ws}/placement/overview", params={"year": "2023-24"}).json()["metrics"]["kpis"]
    assert kpis["eligible_students"]["value"] == 3  # skip never overwrites
    prev, r = stage_and_commit(s, ws, "students", "roster3.csv", csv_bytes(changed), policy="update")
    assert r.json()["summary"]["updated"] == 5
    kpis = s.get(f"/api/workspaces/{ws}/placement/overview", params={"year": "2023-24"}).json()["metrics"]["kpis"]
    assert kpis["eligible_students"]["value"] == 4


def test_metric_definitions_offers_vs_students_and_unknown_outcomes(app):
    s, ws, *_ = _setup(app)
    o = s.get(f"/api/workspaces/{ws}/placement/overview", params={"year": "2023-24"}).json()
    k = o["metrics"]["kpis"]
    assert k["eligible_students"]["value"] == 3
    assert k["total_offers"]["value"] == 3                 # S1 ×2 (accepted + open) and S2's PPO
    assert k["unique_students_with_offers"]["value"] == 2  # one student with two offers counts once
    assert k["students_placed"]["value"] == 2
    assert (k["placement_rate"]["value"], k["placement_rate"]["numerator"], k["placement_rate"]["denominator"]) == (66.7, 2, 3)
    assert k["internship_offers"]["value"] == 3 and k["interns"]["value"] == 3
    # PPO conversion: accepted + no_offer are known; the pending outcome is excluded, not counted as "no PPO"
    ppo = k["ppo_conversion_rate"]
    assert (ppo["value"], ppo["numerator"], ppo["denominator"]) == (50.0, 1, 2)
    assert "1 pending" in ppo["note"]
    assert o["metrics"]["data_quality"]["unknown_outcomes"] == 1
    assert k["ctc_highest"]["value"] == 12 and k["ctc_average"]["value"] == 11.0
    assert all(m["definition"] for m in k.values())


def test_placed_definition_and_denominator_are_configurable(app):
    s, ws, *_ = _setup(app)
    r = s.put(f"/api/workspaces/{ws}/placement/config", json={"placed_definition": "offer_accepted", "placement_denominator": "registered"})
    assert r.status_code == 200
    k = s.get(f"/api/workspaces/{ws}/placement/overview", params={"year": "2023-24"}).json()["metrics"]["kpis"]
    # registered group = S1, S2; accepted offers only: S1 (accepted) and S2 (PPO accepted)
    assert k["placement_rate"]["denominator"] == 2 and k["students_placed"]["value"] == 2
    bad = s.put(f"/api/workspaces/{ws}/placement/config", json={"placement_denominator": "everyone"})
    assert bad.status_code == 422
    bad = s.put(f"/api/workspaces/{ws}/placement/config", json={"stages": [{"label": "Applied"}, {"label": "Interview"}]})
    assert bad.status_code == 422 and "offer" in bad.json()["detail"]["message"]


def test_year_comparison_marks_ongoing_cycles(app):
    s, ws, *_ = _setup(app)
    y = s.get(f"/api/workspaces/{ws}/placement/years").json()
    assert [r["academic_year"] for r in y["years"]] == ["2023-24", "2024-25"]
    assert y["years"][1]["returning_companies"] == 1  # Acme recruited in both cycles
    assert y["ongoing"] == [] and y["note"] is None
    s.put(f"/api/workspaces/{ws}/placement/config", json={"cycles": {"2024-25": {"status": "ongoing"}}})
    y = s.get(f"/api/workspaces/{ws}/placement/years").json()
    assert y["ongoing"] == ["2024-25"] and "partial" in y["note"]
    trends = {t["department"]: t for t in y["department_trends"]}
    assert "2024-25" not in trends["CS"]["rates"]  # ongoing cycles stay out of department trends
    ppo = s.get(f"/api/workspaces/{ws}/placement/ppo", params={"by": "company"}).json()
    acme = next(r for r in ppo["rows"] if r["company"] == "Acme")
    assert acme["conversion_rate"] == 100.0 and acme["known"] == 1


def test_funnel_counts_applications_by_furthest_stage(app):
    s, ws, *_ = _setup(app)
    f = s.get(f"/api/workspaces/{ws}/placement/funnel", params={"year": "2023-24", "type": "full_time"}).json()
    st = {x["key"]: x for x in f["stages"]}
    assert f["applications"] == 4
    assert st["applied"]["reached"] == 4 and st["technical"]["reached"] == 4 and st["offer"]["reached"] == 2
    assert st["technical"]["rejected"] == 1 and st["hr"]["unknown"] == 1


def test_student_records_need_analyst_role(app):
    owner, ws, *_ = _setup(app)
    viewer = register(make_client(app), "viewer@example.com")
    owner.post(f"/api/workspaces/{ws}/members", json={"email": "viewer@example.com", "role": "viewer"})
    assert viewer.get(f"/api/workspaces/{ws}/placement/overview").status_code == 200   # aggregates are fine
    r = viewer.get(f"/api/workspaces/{ws}/placement/students")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "insufficient_role"
    assert viewer.get(f"/api/workspaces/{ws}/placement/graph", params={"students": "true"}).status_code == 403
    g = viewer.get(f"/api/workspaces/{ws}/placement/graph").json()
    assert not any(n["type"] == "Student" for n in g["nodes"])
    ask = viewer.post(f"/api/workspaces/{ws}/placement/ask", json={"question": "Which students still need intervention?"}).json()
    assert "S1" not in ask["answer"] and "S2" not in ask["answer"]
    assert viewer.post(f"/api/workspaces/{ws}/placement/imports", data={"kind": "students"},
                       files={"file": ("x.csv", csv_bytes(ROSTER))}).status_code == 403
    rows = owner.get(f"/api/workspaces/{ws}/placement/students", params={"year": "2023-24"}).json()
    assert {r["student_id"] for r in rows["rows"]} == {"S1", "S2", "S3", "S4"}
    assert next(r for r in rows["rows"] if r["student_id"] == "S1")["status"] == "placed"


def test_assistant_answers_from_records_and_declines_other_questions(app):
    s, ws, *_ = _setup(app)
    a = s.post(f"/api/workspaces/{ws}/placement/ask", json={"question": "How many offers were made, and how many unique students received them?"}).json()
    assert a["intent"] != "unsupported" and a["definitions"] and a["calculation"]
    u = s.post(f"/api/workspaces/{ws}/placement/ask", json={"question": "What is the weather tomorrow?"}).json()
    assert u["intent"] == "unsupported" and len(u["supported"]) >= 5


def test_delete_all_requires_owner_and_confirmation(app):
    owner, ws, *_ = _setup(app)
    analyst = register(make_client(app), "an@example.com")
    owner.post(f"/api/workspaces/{ws}/members", json={"email": "an@example.com", "role": "analyst"})
    assert analyst.delete(f"/api/workspaces/{ws}/placement/data", params={"confirm": "true"}).status_code == 403
    assert owner.delete(f"/api/workspaces/{ws}/placement/data").status_code == 400
    r = owner.delete(f"/api/workspaces/{ws}/placement/data", params={"confirm": "true"})
    assert r.status_code == 200 and r.json()["applications_removed"] == 8
    assert owner.get(f"/api/workspaces/{ws}/placement/overview").json()["counts"]["records"] == 0


def test_placement_routes_reject_other_workspace_types(app):
    s = register(make_client(app), "other@example.com", "research")
    ws = first_workspace(s, "research")
    assert s.get(f"/api/workspaces/{ws}/placement/overview").status_code == 404


def test_sample_data_is_flagged(app):
    s = register(make_client(app), "sample@example.com", "placement")
    ws = first_workspace(s, "placement")
    assert s.post(f"/api/workspaces/{ws}/placement/samples/load").status_code == 201
    o = s.get(f"/api/workspaces/{ws}/placement/overview").json()
    assert o["sample_data"] is True and o["counts"]["records"] > 1000
    assert all(i["is_sample"] for i in s.get(f"/api/workspaces/{ws}/placement/imports").json()["imports"])

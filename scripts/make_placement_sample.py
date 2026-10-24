"""
Generate the FICTIONAL placement sample data in samples/workspaces/placement/.

  python scripts/make_placement_sample.py

The institution, students and companies are invented; the output is deterministic
(seeded RNG) so tests and demos see the same numbers. Four cycles: 2023-24, 2024-25 and
2025-26 are complete; 2026-27 is in progress (records up to 20 Oct 2026).
"""

import csv
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "samples" / "workspaces" / "placement"
rng = random.Random(42)

DEPARTMENTS = [("CS", "Computer Science", 34), ("IT", "Information Technology", 24), ("EC", "Electronics", 24),
               ("EE", "Electrical", 18), ("ME", "Mechanical", 22), ("CE", "Civil", 16)]
# name, industry, base CTC (LPA), departments it targets, internship-to-PPO propensity
COMPANIES = [
    ("Voltaic Systems Pvt Ltd", "Energy storage", 14.0, ["EE", "EC", "ME"], 0.55),
    ("Meridian Grid", "Utilities", 9.5, ["EE", "CE", "ME"], 0.45),
    ("Ferrite Labs", "Materials", 11.0, ["ME", "EC"], 0.35),
    ("Kestrel Bay Software", "Software", 18.0, ["CS", "IT"], 0.6),
    ("Harborline Logistics", "Logistics", 7.5, ["ME", "CE", "IT"], 0.3),
    ("Aurora Robotics", "Robotics", 16.0, ["CS", "EC", "ME"], 0.5),
    ("Port Calder Bank", "Banking", 10.5, ["CS", "IT"], 0.4),
    ("Tidewater Consulting", "Consulting", 12.0, ["CS", "IT", "ME", "EE"], 0.25),
    ("Seaglass Semiconductors", "Semiconductors", 15.0, ["EC", "EE"], 0.5),
    ("Brightreef Fintech", "Fintech", 17.0, ["CS", "IT"], 0.45),
    ("Coastline Telecom", "Telecom", 8.5, ["EC", "IT", "CS"], 0.35),
    ("Lighthouse Health Tech", "Healthcare", 9.0, ["CS", "EC"], 0.3),
]
YEARS = ["2023-24", "2024-25", "2025-26", "2026-27"]
ONGOING = "2026-27"
CUTOFF = date(2026, 10, 20)
STAGES = ["Application submitted", "Resume shortlisting", "Online assessment", "Technical interview", "HR interview",
          "Offer extended"]
ROLES = {"Software": ["Software Engineer", "SDE Intern"], "Fintech": ["Backend Engineer", "Data Analyst"],
         "Banking": ["Graduate Analyst", "Technology Analyst"], "Consulting": ["Associate Consultant"],
         "Utilities": ["Graduate Engineer Trainee"], "Energy storage": ["Battery Systems Engineer"],
         "Materials": ["Process Engineer"], "Logistics": ["Operations Analyst"], "Robotics": ["Robotics Engineer"],
         "Semiconductors": ["Design Verification Engineer"], "Telecom": ["Network Engineer"],
         "Healthcare": ["Associate Engineer"]}


def cycle_date(ay: str, frac: float) -> date:
    start = date(int(ay[:4]), 7, 15)
    d = start + timedelta(days=int(frac * 240))
    return min(d, CUTOFF) if ay == ONGOING else d


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    students, apps = [], []
    for yi, ay in enumerate(YEARS):
        ongoing = ay == ONGOING
        grad = int(ay[:4]) + 1
        # companies participate with some churn between years
        active = [c for c in COMPANIES if rng.random() < (0.92 if yi else 0.75)]
        for code, dept, size in DEPARTMENTS:
            n = size + rng.randint(-3, 4)
            for k in range(1, n + 1):
                sid = f"CIT{str(grad)[2:]}{code}{k:03d}"
                eligible = rng.random() < 0.93
                registered = eligible and rng.random() < 0.9
                students.append({"Academic Year": ay, "Roll No": sid, "Branch": dept, "Programme": "B.Tech",
                                 "Year of Passing": grad, "Eligible": "Yes" if eligible else "No",
                                 "Registered for Placement": "Yes" if registered else "No"})
                if not registered:
                    continue
                targets = [c for c in active if code in c[3]]
                got_ppo = False
                # internship (about half of registered students)
                if targets and rng.random() < 0.5:
                    c = rng.choice(targets)
                    if ongoing:
                        status, ppo = "Ongoing", rng.choice(["Pending", "Pending", "", "Awaited"])
                    else:
                        status = "Completed" if rng.random() < 0.94 else "Terminated"
                        r = rng.random()
                        p = c[4] + (0.05 * yi)
                        ppo = ("Accepted" if r < p * 0.8 else "Offered" if r < p else "Declined" if r < p + 0.05
                               else "No" if r < 0.93 else "" if r < 0.97 else "Pending")
                        if status == "Terminated":
                            ppo = "No"
                    got_ppo = ppo in ("Accepted",)
                    apps.append({"Academic Year": ay, "Roll No": sid, "Company Name": c[0], "Industry": c[1],
                                 "Profile": ROLES[c[1]][-1], "Opportunity Type": "Internship",
                                 "Stage": "Offer extended", "Status": "Offer accepted",
                                 "Internship Status": status, "PPO Status": ppo, "CTC (LPA)": "",
                                 "Stipend": rng.choice([15000, 20000, 25000, 30000, 40000]),
                                 "Applied On": cycle_date(ay, rng.random() * 0.1).isoformat(),
                                 "Offer Date": cycle_date(ay, 0.1 + rng.random() * 0.1).isoformat()})
                    # a few PPOs in 2025-26 are also recorded as their own "PPO" row (same company → counted once)
                    if ay == "2025-26" and ppo in ("Accepted", "Offered") and rng.random() < 0.25:
                        apps.append({"Academic Year": ay, "Roll No": sid, "Company Name": c[0], "Industry": c[1],
                                     "Profile": ROLES[c[1]][0], "Opportunity Type": "PPO", "Stage": "Offer extended",
                                     "Status": "Offer accepted" if ppo == "Accepted" else "Selected",
                                     "Internship Status": "", "PPO Status": "",
                                     "CTC (LPA)": round(c[2] * rng.uniform(0.95, 1.1), 1), "Stipend": "",
                                     "Applied On": "", "Offer Date": cycle_date(ay, 0.55).isoformat()})
                if got_ppo or not targets:
                    continue
                # full-time applications
                placed = False
                for c in rng.sample(targets, k=min(len(targets), rng.randint(1, 4))):
                    frac = rng.random()
                    applied = cycle_date(ay, frac * 0.5)
                    if ongoing and applied >= CUTOFF:
                        continue
                    reached = 0
                    for i in range(1, len(STAGES)):
                        if rng.random() < [0.0, 0.8, 0.62, 0.55, 0.7, 0.85][i] + 0.03 * yi:
                            reached = i
                        else:
                            break
                    final = STAGES[reached]
                    if reached == len(STAGES) - 1:
                        if ongoing and rng.random() < 0.4:
                            status = "Result awaited"
                            final = STAGES[-2]
                        elif placed:
                            status = "Offer declined"
                        else:
                            status = rng.choices(["Offer accepted", "Selected", "Offer declined"], [0.8, 0.12, 0.08])[0]
                            placed = status in ("Offer accepted", "Selected")
                    elif ongoing and rng.random() < 0.45:
                        status = rng.choice(["In process", "Result awaited"])
                    else:
                        status = "Withdrawn" if rng.random() < 0.08 else "Rejected" if rng.random() < 0.95 else ""
                    offer = status in ("Offer accepted", "Selected", "Offer declined")
                    apps.append({"Academic Year": ay, "Roll No": sid, "Company Name": c[0], "Industry": c[1],
                                 "Profile": ROLES[c[1]][0], "Opportunity Type": "Full-time", "Stage": final,
                                 "Status": status, "Internship Status": "", "PPO Status": "",
                                 "CTC (LPA)": round(c[2] * rng.uniform(0.9, 1.15), 1) if offer else "",
                                 "Stipend": "", "Applied On": applied.isoformat(),
                                 "Offer Date": cycle_date(ay, min(0.98, frac * 0.5 + 0.15 + rng.random() * 0.2)).isoformat()
                                 if offer else ""})
    with open(OUT / "sample_students.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(students[0]))
        w.writeheader()
        w.writerows(students)
    with open(OUT / "sample_applications.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(apps[0]))
        w.writeheader()
        w.writerows(apps)
    print(f"{len(students)} roster rows, {len(apps)} application rows → {OUT}")


if __name__ == "__main__":
    main()

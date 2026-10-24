"""
Regenerate samples/meridian_grid_annual_report.pdf (a real 2-page PDF used in the demo).

    .venv\\Scripts\\python.exe scripts\\make_sample_pdf.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.kb.simple_pdf import make_pdf  # noqa: E402

PAGE_1 = """Meridian Grid Annual Report 2023

About Meridian Grid

Meridian Grid serves Port Calder and the surrounding coast as the regional electricity operator. Elena Vasquez is the chief executive officer of Meridian Grid. The Coastal Energy Commission regulates Meridian Grid and approves its annual rate plan.

Storage and Solar

Meridian Grid operates the Harbor Storage Facility, which uses sodium-ion batteries supplied by Voltaic Systems. The company also runs a rooftop solar pilot with the Aurora Institute. The pilot installed perovskite panels on 400 homes in Port Calder.
"""

PAGE_2 = """Coal Transition

Meridian Grid closed the Harbor Coal Plant in March 2023. The Clean Horizon Act required the closure of the Harbor Coal Plant. The Harbor Storage Facility replaced the evening output of the Harbor Coal Plant.

Outlook

Meridian Grid plans to double battery capacity by 2026 and expand the solar pilot to Kestrel Bay.
"""


def main() -> None:
    out = ROOT / "samples" / "meridian_grid_annual_report.pdf"
    out.write_bytes(make_pdf([PAGE_1, PAGE_2]))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

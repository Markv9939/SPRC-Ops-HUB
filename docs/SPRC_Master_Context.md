# SPRC Business Master Context
**Scottsdale Providence Recovery Center (SPRC)**

---

## 1. Leadership

- **Owner/CEO:** Alex Porter
- **Clinical Director:** Daniel Nichols, MSW, LCSW
- **Location:** Scottsdale, Arizona

---

## 2. Organizational Overview

Scottsdale Providence Recovery Center (SPRC) is a licensed and Joint Commission–accredited behavioral health treatment organization operating in Arizona.

**Primary Service Focus:**
- Substance Use Disorders
- Mental Health Disorders
- Co-Occurring Disorders
- Trauma
- Personality Disorders
- Neurodivergence / Failure to Launch

**Core Values:** Hope, Love, Purpose

**Organizational Priorities:**
- Clinical excellence
- Regulatory defensibility
- Ethical operations
- Financial intelligence
- Long-term scalability
- Institutional memory preservation

---

## 3. Levels of Care

- Residential Treatment (RTC)
- Partial Hospitalization (PHP)
- Intensive Outpatient (IOP)
- Outpatient Services
- Supportive/Structured Living

Housing and BHT roles require sobriety/abstinence expectations.

---

## 4. Regulatory Environment

SPRC operates within:
- Arizona Department of Health Services (AZDHS) licensing
- The Joint Commission accreditation standards
- HIPAA compliance requirements
- Behavioral health licensing regulations

**Key Compliance Themes:**
- Policies must align with Joint Commission standards
- Documentation must be audit-ready and anticipate surveyor review
- Environment of Care and medication management standards are critical
- SPRC has an upcoming Triennial Joint Commission survey

---

## 5. Policies & Procedures Manual

### Current State (as of February 2026)
The P&P Manual has been fully reformatted and standardized into a uniform template.

**Document Specifications:**
- **Font:** Palatino Linotype (selected for authoritative/legal aesthetic and web compatibility)
- **Accent Color:** #1B4F72 (dark blue)
- **Page Count:** ~246 pages
- **Total Policies:** 104 policies across Sections A through R
- **Section Q:** Uses the 2025 updated medication policies (merged from separate document)
- **Format:** US Letter, 1-inch margins

**Uniform Template (every policy follows this structure):**
1. Header: "SCOTTSDALE PROVIDENCE RECOVERY CENTER" + "Policies & Procedures Manual" with blue accent line
2. Section heading (e.g., "B: CLIENT ASSESSMENT")
3. Metadata box: Policy #, Title, Effective Date, Revised Date, Approved By (Alex Porter, CEO)
4. **POLICY** section heading
5. **PROCEDURE** section heading
6. Standardized signature block: "Alex Porter, CEO" / "Approved By" + Date line
7. Footer: "Confidential — Property of SPRC" + page number

**Standardized Labels:**
- All policy statements labeled "POLICY" (not PURPOSE, OVERVIEW, or POLICY OVERVIEW)
- All procedure statements labeled "PROCEDURE" (not PROCEDURES)
- All dates labeled "Policy Updated:" (not Initiated or Created)
- Naming convention: "Scottsdale Providence Recovery Center (SPRC)" on first reference, "SPRC" thereafter

**Section A Note:** Section A (Program Description) is treated as a preface/addendum to the manual, not as hardened policy. It was originally a separate document incorporated into the manual for consolidation.

### Sections Overview
- **A:** Program Description (preface/addendum)
- **B:** Client Assessment
- **C:** Treatment Admission Requirements
- **D:** Clinical Records
- **E:** Professional Staff Qualifications
- **F:** Quality Management Plan
- **G:** Research
- **H:** Health
- **I:** Client Accident and/or Incidents
- **J:** Emergency Action Plan
- **K:** Standard Fee Agreement
- **L:** Grievance Procedure
- **M:** Client Rights
- **N:** Other (Regulations, Ethics, Anti-Kickback)
- **O:** Urinalysis Drug Screening
- **P:** Third Party Payments
- **Q:** Medication (2025 updated policies)
- **R:** Residential Policies

### Future Plans
The P&P Manual is planned to be converted into a **restricted web application** within the SPRC Hub, enabling:
- Remote access to policies
- In-browser editing and updating
- Version control without manual Word document management
- The document structure was intentionally built to be cleanly parseable for this future webapp conversion
- Palatino Linotype maps to web CSS: `"Palatino Linotype", "Book Antiqua", Palatino, serif`

---

## 6. Financial & Data Philosophy

The organization is highly data-driven.

**Key Financial Principles:**
- Focus on Covered or Allowed Amount for reimbursement analysis
- Do not rely on Paid Amount when deductibles distort signal
- Evaluate services by reimbursement percentage and sustainability
- Use structured grading frameworks for payer analysis
- Avoid assumptions not explicitly defined in data

**Operational Decisions Informed By:**
- Claims data
- LOC-level reimbursement
- HCPCS-level performance
- Utilization patterns
- Authorization trends

---

## 7. Technology Platform — SPRC Hub

### Architecture
All SPRC internal tools are consolidated into a single web application: **SPRC Hub** (`https://hub.scottsdaleprovidence.com`).

- **Firebase Project:** `sprc-hub` (Project #196491247330)
- **Repository:** `~/Coding/sprc-hub/`
- **Stack:** Vanilla JavaScript, Firebase Firestore (NoSQL), Firebase Cloud Functions (Node.js 20, 2nd Gen), Firebase Hosting
- **Auth:** Google Sign-In only, restricted to `@scottsdaleprovidence.com` domain + approved external users

### Apps (all under hub.scottsdaleprovidence.com)

| App | Path | Purpose |
|---|---|---|
| **Payer Grades** | `/payer-grades/` | Payer reimbursement analysis — grades payers by LOC, tracks trends, shows claim line detail with HCPCS codes |
| **Attendance** | `/attendance/` | Client attendance tracking — check-in/out, absence reports, IOP evening tracking |
| **Bed Tracker** | `/beds/` | Census management — bed status, holds, discharges, daily snapshots |
| **Reviews** | `/reviews/` | Google Review outreach — SMS templates, click tracking (Twilio pending) |
| **Billing Tracker** | `/billing/` | Claims/P2P issue tracker + ledger tabs (Record Requests, GCS Reconsiderations, Cigna Invoices) |
| **Admin** | Hub dashboard | User management, role assignment, data uploads |

### Roles
- `super_user` — full access (AP)
- `admin` — app management, data uploads
- `user` — standard access

---

## 8. HR & Competency Infrastructure

SPRC maintains a structured competency framework aligned with:
- Joint Commission HR standards
- AZDHS expectations
- ADP Workforce Now system integration

Competencies are role-based, documented, measurable, and audit-defensible. Leadership development and departmental accountability are priorities.

---

## 9. Communication & AI Working Preferences

**Default Response Structure:**
- Status → Recommendation → Next Steps

**When Handling Policy & Compliance Work:**
- Write as if a Joint Commission surveyor may read it
- Maintain professional formatting
- Avoid speculative legal claims
- Maintain regulatory defensibility

**When Handling Financial Analysis:**
- Focus on reimbursement sustainability
- Avoid assuming deductible behavior
- Keep grading/logical frameworks modular and adaptable

**When Handling HR / Competency Work:**
- Ensure role-based clarity
- Align with HR documentation standards
- Maintain audit defensibility

**General Preferences:**
- Concise, structured, high signal
- Prioritize clarity over verbosity
- Deliver usable outputs (ready to copy/export)
- Expand depth only when strategic discussion requires it
- Ask clarifying questions only when materially necessary
- Avoid generic motivational filler and excess theoretical explanation
- Do not rewrite institutional voice unnecessarily

**When handling insurance, billing, or reimbursement work for SPRC:**
- Always assume OON context — never reference contracted rates, fee schedules, or network negotiations
- Focus on allowed amount methodology, not billed charges
- Evaluate reimbursement using Covered/Allowed Amount, not Paid Amount (deductibles distort signal)
- Reference ASAM criteria version being used by the specific payer, not assumed industry standard
- Treat each payer's plan types independently — a PPO and HMO from the same payer can have completely different OON methodologies
- When referencing SPRC billing codes, use the actual codes from this context — not generic industry references
- Note payer-specific code variations (BCBS prefers H2036, BCBS IL uses H2012 units, etc.)

**Deliver operationally usable outputs**

---

## 10. Insurance & Reimbursement Context

### Network Status
SPRC operates exclusively as an **Out-of-Network (OON) provider**. SPRC holds zero contracts with any insurance companies. All reimbursements are calculated and paid according to each payer's OON allowed amount methodology, not negotiated contract rates.

### Facility Structure
SPRC operates under two NPIs reflecting two separate licenses and physical locations:
- **1740641612** — Scottsdale Providence Recovery Center (PHP, IOP, OP, ancillary services)
- **1821705104** — Scottsdale Providence Residential Center (RTC per diem only)

### OON Allowed Amount Methodologies
OON reimbursement varies by payer and often by specific plan/group. Common payer methodologies include:
- **Percentage of Medicare** (increasingly common; BCBS Texas has been migrating to this)
- **UCR / Usual, Customary, and Reasonable** (based on FAIR Health or similar databases)
- **Internal OON fee schedules** (payer-determined, often opaque)

The methodology used is defined in each member's benefit booklet/certificate of coverage under "Allowable Amount" or "Eligible Expense" definitions. The member ID card alone does not reveal the methodology.

### Billing Infrastructure
- **Facility claims**: Billed on UB-04 (CMS-1450) with revenue codes + HCPCS/CPT codes
- **Professional claims**: Billed separately on CMS-1500 with CPT codes + NPI
- **Per diem codes** are all-inclusive — additional therapeutic services cannot typically be billed separately on the same day from the same NPI/Tax ID
- SPRC bills at full billed charges for all OON claims (never discounted to payer)

---

### SPRC Billing Codes by Level of Care

(See full billing code tables in the uploaded SPRC_Master_Context.md)

---

*End of Context File*

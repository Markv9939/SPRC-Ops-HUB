# CEO's SPRC Hub — Progress Tracker

This file tracks the progress of Alex Porter's (CEO) SPRC Hub project.
The SPRC Ops Hub (this repo) will eventually integrate into the SPRC Hub.

See the full uploaded PROGRESS.md for complete details.

**Key Facts:**
- **Live URL:** https://hub.scottsdaleprovidence.com
- **Firebase Project:** sprc-hub (Project #196491247330)
- **Stack:** Vanilla JS, Firebase Firestore, Cloud Functions (Node 20), Firebase Hosting
- **Auth:** Google Sign-In, @scottsdaleprovidence.com domain restricted

**Apps Live in SPRC Hub:**
1. Payer Grades (/payer-grades/) — payer reimbursement analysis
2. Attendance (/attendance/) — client check-in/out tracking
3. Bed Tracker (/beds/) — census management
4. Reviews (/reviews/) — Google Review SMS outreach via Twilio
5. Billing Tracker (/billing/) — claims/P2P issue tracker + ledgers
6. QM/PI Meeting Minutes (/qm/) — quality management meeting docs

**Integration Considerations for SPRC Ops Hub:**
- Same Firebase project (sprc-hub) and auth system
- Collection prefixing pattern (att_, beds_, bill_)
- Role-based access (super_user, admin, user)
- Hub-nav shared component pattern
- Service worker caching strategy
- Path-based routing under hub.scottsdaleprovidence.com

*Last synced from CEO's PROGRESS.md: May 4, 2026*

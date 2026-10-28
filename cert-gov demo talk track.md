# Demo Talk Track: Certificate Governance by Exception (about 4 min)

**Before you start:** the app must be running and the Exceptions page loaded once (the first load takes about 5 seconds while it pulls from DigiCert). Read counts off the screen rather than quoting numbers from this script, because they follow the live tenant. If macOS AirPlay is holding port 5000, run on another port: `.venv/bin/python -m flask --app app run --host 127.0.0.1 --port 5001`.

---

## 0:00 Setup

> "Certificate lifetimes keep shrinking, and agent workloads need certs too. Reviewing every cert on a yearly campaign doesn't scale. So we flipped it: the system certifies by default, and people only see the exceptions. Everything here is live from our DigiCert tenant."

## 0:20 Overview (`/`)

> "Live posture: active certificates, how many have an owner, what expires soon, open findings by severity. This is the volume problem. No team can review all of this by hand."

## 0:50 Findings (`/findings`)

> "Detection is automatic. Five rules run on every cert: expiring, unowned, weak key, long-lived, quantum-unsafe. Findings tell us what's wrong. The next question is who has to do something about it."

## 1:20 Exceptions: Needs Attention (`/exceptions`)

> "This is that answer. These are the certificates the rules could not approve, so a person has to decide."

Point at one row's **Why it needs you** column.

> "Every row says why it's here and which rule sent it. For example, no owner, or it expires too soon to auto-approve."

Point at **Suggested owner** on a High-confidence row (for example `ledger.acme.com`) and click **Evidence**.

> "Here's the ownership recommendation, and it shows its work. This cert was issued by our own CA, so we know its business unit and its name, and we can see who owns the other certs in that unit. Pepper Potts already owns the other Finance certs, and the name says ledger. That's why it's High confidence."

Point at a Medium or Low row (for example `deploy-hub.acme.com`).

> "Where the evidence is thinner we say so. Here we can name the team but not a person, so it's Medium, and we don't guess a name."

> "And for a self-signed cert, or anything not issued by our CA, there is no issuer-side evidence, so we don't recommend at all. A confident wrong guess is worse than none."

Click **Accept suggestion** on one row, or **Approve** on another (**do not use Revoke on a shared tenant**).

> "One click, and the owner is written back to DigiCert. The cert leaves the queue."

## 2:15 Exceptions: Auto-handled

Click the **Auto-handled** tab.

> "This is everything the system approved without bothering anyone, and this is the audit trail. Each cert shows the rule that approved it and the reason in plain language: owner present, key size, validity, days to expiry."

## 2:45 Rules and impact preview

Click a rule name chip (for example **Healthy and owned**). The editor opens.

> "The rule isn't a black box. It's a few thresholds you can change. Say we want to be stricter and require at least 360 days to expiry."

Change **Minimum days until expiry** to 360 and click **Preview impact**.

> "Before saving, it tells us exactly what would change: this many certs would move into the review queue. That's the trade-off between assurance and workload, visible up front."

Click **Save rule**, show the counts move, then set it back to 30 and save. Or close the panel to leave it unchanged.

> "Rules run top to bottom and the first match wins. Anything no rule approves goes to a person, so the safe default is human review."

## 3:35 Close

> "So: automatic detection, rules that approve the routine and escalate the exceptions, a plain-language audit trail for everything the system decided, and rules a person can edit with the impact visible first. Certification stays continuous, and the human effort goes only where it matters."

---

## Notes for the presenter

- **Demo data.** The recommendation examples come from certs issued by `scripts/seed_demo_certs.py`. If you accept suggestions during a run, re-run that script to restore a fresh set (it skips names that already exist, so revoke the old ones first or change the names). The live tenant currently has no self-signed certs, so "no recommendation" is something you describe rather than show.
- **Auto-approve only.** The system never revokes or reassigns on its own. Only people do.
- **Campaigns are parked, not deleted.** If asked about periodic reviews: the earlier campaign workflow is still in the code at `/campaigns` and can go back in the menu if a customer wants scheduled reviews. See the README.
- **If the Needs Attention list is long,** that reflects the tenant's real ownership gap. Say so: "most of these are unowned, which is exactly the problem this surfaces."

import re
from collections import Counter

# Words in a certificate name that hint at the owning team. Matched as whole tokens, never substrings.
NAME_HINTS = {
    'Finance': {'payroll', 'billing', 'invoice', 'invoices', 'ledger', 'treasury', 'budget', 'fin', 'accounting'},
    'DevOps': {'ci', 'cd', 'deploy', 'k8s', 'kube', 'jenkins', 'build', 'monitor', 'monitoring', 'infra'},
    'Engineering': {'api', 'svc', 'service', 'auth', 'gateway', 'orders', 'db', 'app'},
    'Marketing': {'cdn', 'campaign', 'campaigns', 'promo', 'brand', 'social'},
    'Legal': {'contract', 'contracts', 'legal', 'compliance', 'gdpr', 'policy'},
}


def is_tenant_issued(cert):
    """Only certs issued under a profile of our CA carry issuer-side evidence (enrolling seat, BU, profile)."""
    profile = cert.get('profile') or {}
    return bool(profile.get('id') or profile.get('name'))


def cert_name(cert):
    """DigiCert returns a null common_name for many private-CA certs; the seat id carries the name then."""
    return ((cert.get('subject') or {}).get('common_name') or cert.get('common_name')
            or (cert.get('seat') or {}).get('seat_id'))


def _dept_for_bu(bu_name, departments):
    name = (bu_name or '').lower()
    return next((d for d in sorted(departments) if d.lower() in name), None)


def _dept_for_name(cn):
    for token in re.split(r'[.\-_]+', (cn or '').lower()):
        for dept, words in NAME_HINTS.items():
            if token in words:
                return dept, token
    return None, None


def _result(confidence, owner, team, evidence):
    return {'confidence': confidence, 'owner': owner, 'team': team, 'evidence': evidence}


def recommend(cert, bu_name, peer_owners, users):
    """Suggest an owner from evidence only. `peer_owners` counts owners of other certs in the same BU."""
    if not is_tenant_issued(cert):
        return _result('None', None, None, [
            'Self-signed or externally issued: no profile or enrolling seat to learn from, so no owner is suggested.'])

    profile = (cert.get('profile') or {}).get('name') or 'a tenant profile'
    ca = cert.get('issuing_ca_name') or 'the tenant CA'
    evidence = [f"Issued by {ca} under '{profile}', so issuer-side evidence is available."]

    departments = {u['department'] for u in users}
    bu_dept = _dept_for_bu(bu_name, departments)
    name_dept, token = _dept_for_name(cert_name(cert))
    agree = bool(bu_dept and name_dept and bu_dept == name_dept)
    team = bu_dept or name_dept

    if bu_dept:
        evidence.append(f"Business unit '{bu_name}' maps to the {bu_dept} team.")
    if name_dept:
        if bu_dept and not agree:
            evidence.append(f"Name suggests {name_dept} but the business unit maps to {bu_dept} (conflicting signals).")
        else:
            evidence.append(f"Name token '{token}' suggests the {name_dept} team.")

    owner, top_n = None, 0
    if peer_owners:
        top_name, top_n = peer_owners.most_common(1)[0]
        person = next((u for u in users if u['name'] == top_name), None)
        if person:
            owner = {'name': person['name'], 'email': person['email'], 'department': person['department']}
            evidence.append(
                f"{top_name} owns {top_n} of {sum(peer_owners.values())} owned certificates in {bu_name}.")

    if owner and (agree or top_n >= 2):
        confidence = 'High'
    elif owner or (team and agree):
        confidence = 'Medium'
    elif team:
        confidence = 'Low'
    else:
        confidence = 'None'
        evidence.append('Business unit and name give no team signal.')
    return _result(confidence, owner, team, evidence)


def peer_counter(serial, bu_name, certs_info):
    """Owners of the other certs in `bu_name`. `certs_info` maps serial -> (bu_name, owner)."""
    return Counter(owner for s, (bu, owner) in certs_info.items() if s != serial and bu == bu_name and owner)

from collections import Counter
from routes.recommendations import recommend, is_tenant_issued

USERS = [
    {'id': 'u1', 'name': 'Pepper Potts', 'email': 'pepper@acme.com', 'department': 'Finance'},
    {'id': 'u2', 'name': 'Carol Danvers', 'email': 'carol@acme.com', 'department': 'Marketing'},
    {'id': 'u3', 'name': 'Nick Fury', 'email': 'nick@acme.com', 'department': 'DevOps'},
]


def tenant_cert(cn, **over):
    c = {'serial_number': 'S1', 'common_name': cn, 'profile': {'id': 'p1', 'name': 'Private Server'},
         'issuing_ca_name': 'Saviynt Test ICA'}
    c.update(over)
    return c


SELF_SIGNED = {'serial_number': 'S2', 'common_name': 'abc.lab.local', 'profile': None, 'issuing_ca_name': 'abc.lab.local'}


def test_is_tenant_issued():
    assert is_tenant_issued(tenant_cert('x.acme.com'))
    assert not is_tenant_issued(SELF_SIGNED)
    assert not is_tenant_issued({'serial_number': 'S3'})


def test_self_signed_gets_no_recommendation_and_says_why():
    r = recommend(SELF_SIGNED, 'Default Business Unit', Counter({'Pepper Potts': 3}), USERS)
    assert r['confidence'] == 'None'
    assert r['owner'] is None and r['team'] is None
    assert 'self-signed' in ' '.join(r['evidence']).lower()


def test_high_when_peers_and_name_agree_with_bu():
    r = recommend(tenant_cert('ledger.acme.com'), 'Finance & Accounting', Counter({'Pepper Potts': 2}), USERS)
    assert r['confidence'] == 'High'
    assert r['owner']['name'] == 'Pepper Potts'
    assert r['owner']['email'] == 'pepper@acme.com'
    assert r['team'] == 'Finance'
    text = ' '.join(r['evidence'])
    assert 'owns 2 of 2' in text and "'ledger'" in text


def test_high_when_two_or_more_peers_even_without_name_signal():
    r = recommend(tenant_cert('thing.acme.com'), 'Finance & Accounting', Counter({'Pepper Potts': 2}), USERS)
    assert r['confidence'] == 'High'


def test_medium_when_single_peer_and_no_name_signal():
    r = recommend(tenant_cert('edge-proxy.acme.com'), 'Marketing & Growth', Counter({'Carol Danvers': 1}), USERS)
    assert r['confidence'] == 'Medium'
    assert r['owner']['name'] == 'Carol Danvers'


def test_medium_team_only_when_bu_and_name_agree_but_no_peers():
    r = recommend(tenant_cert('deploy-hub.acme.com'), 'DevOps & Infrastructure', Counter(), USERS)
    assert r['confidence'] == 'Medium'
    assert r['owner'] is None
    assert r['team'] == 'DevOps'


def test_low_team_only_from_bu_alone():
    r = recommend(tenant_cert('runner-pool.acme.com'), 'DevOps & Infrastructure', Counter(), USERS)
    assert r['confidence'] == 'Low'
    assert r['owner'] is None and r['team'] == 'DevOps'


def test_bu_wins_over_conflicting_name_and_conflict_is_noted():
    r = recommend(tenant_cert('ci.acme.com'), 'Finance & Accounting', Counter(), USERS)
    assert r['team'] == 'Finance'
    assert r['confidence'] == 'Low'
    assert 'conflict' in ' '.join(r['evidence']).lower()


def test_none_when_tenant_issued_but_no_signal():
    r = recommend(tenant_cert('x.acme.com'), 'Information Security', Counter(), USERS)
    assert r['confidence'] == 'None'
    assert r['owner'] is None and r['team'] is None


def test_peer_owner_missing_from_directory_is_not_recommended_as_a_person():
    r = recommend(tenant_cert('ledger.acme.com'), 'Finance & Accounting', Counter({'Local Admin': 3}), USERS)
    assert r['owner'] is None
    assert r['team'] == 'Finance'


def test_name_falls_back_to_seat_id_when_common_name_is_null():
    live = tenant_cert(None, seat={'seat_id': 'ledger.acme.com', 'seat_name': ''})
    r = recommend(live, 'Finance & Accounting', Counter({'Pepper Potts': 1}), USERS)
    assert r['confidence'] == 'High'
    assert "'ledger'" in ' '.join(r['evidence'])


def test_name_prefers_subject_common_name():
    live = tenant_cert(None, subject={'common_name': 'ledger.acme.com'})
    assert recommend(live, 'Information Security', Counter(), USERS)['team'] == 'Finance'  # name is the only signal

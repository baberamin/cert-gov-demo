import json
import responses as rsps
from routes.certificates import _fetch_all_certs

SEARCH = 'https://demo.one.digicert.com/mpki/api/v1/certificate-search'


def paged(total):
    """Serve `total` certs 100 at a time, honouring offset and reporting has_more like DigiCert."""
    def cb(request):
        offset = int(request.params['offset'])
        page = [{'serial_number': f'S{i}'} for i in range(offset, min(offset + 100, total))]
        return (200, {}, json.dumps({'certificates': page, 'has_more': offset + 100 < total}))
    rsps.add_callback(rsps.GET, SEARCH, callback=cb, content_type='application/json')


@rsps.activate
def test_fetches_every_page_beyond_five():
    paged(765)
    certs = _fetch_all_certs({})
    assert len(certs) == 765
    assert len({c['serial_number'] for c in certs}) == 765


@rsps.activate
def test_stops_on_an_empty_page_even_if_has_more_stays_true():
    rsps.add(rsps.GET, SEARCH, json={'certificates': [], 'has_more': True})
    assert _fetch_all_certs({}) == []
    assert len(rsps.calls) == 1

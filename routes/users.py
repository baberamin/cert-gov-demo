from flask import Blueprint, jsonify

users_bp = Blueprint('users', __name__)

USERS = [
    # Marvel — Engineering
    {"id": "u001", "name": "Tony Stark",       "email": "tony.stark@acme.com",       "department": "Engineering"},
    {"id": "u002", "name": "Bruce Banner",      "email": "bruce.banner@acme.com",      "department": "Engineering"},
    {"id": "u003", "name": "Shuri Udaku",       "email": "shuri.udaku@acme.com",       "department": "Engineering"},
    {"id": "u004", "name": "Peter Parker",      "email": "peter.parker@acme.com",      "department": "Engineering"},
    {"id": "u005", "name": "Scott Lang",        "email": "scott.lang@acme.com",        "department": "Engineering"},
    {"id": "u006", "name": "Hope Van Dyne",     "email": "hope.vandyne@acme.com",      "department": "Engineering"},
    {"id": "u007", "name": "Hiro Hamada",       "email": "hiro.hamada@acme.com",       "department": "Engineering"},
    {"id": "u008", "name": "Baymax Hamada",     "email": "baymax.hamada@acme.com",     "department": "Engineering"},
    {"id": "u009", "name": "Reed Richards",     "email": "reed.richards@acme.com",     "department": "Engineering"},
    {"id": "u010", "name": "Riri Williams",     "email": "riri.williams@acme.com",     "department": "Engineering"},
    # Marvel — DevOps
    {"id": "u011", "name": "Nick Fury",         "email": "nick.fury@acme.com",         "department": "DevOps"},
    {"id": "u012", "name": "Maria Hill",        "email": "maria.hill@acme.com",        "department": "DevOps"},
    {"id": "u013", "name": "Sam Wilson",        "email": "sam.wilson@acme.com",        "department": "DevOps"},
    {"id": "u014", "name": "James Rhodes",      "email": "james.rhodes@acme.com",      "department": "DevOps"},
    {"id": "u015", "name": "Bucky Barnes",      "email": "bucky.barnes@acme.com",      "department": "DevOps"},
    {"id": "u016", "name": "Peter Quill",       "email": "peter.quill@acme.com",       "department": "DevOps"},
    {"id": "u017", "name": "Rocket Raccoon",    "email": "rocket.raccoon@acme.com",    "department": "DevOps"},
    {"id": "u018", "name": "Nebula Thanos",     "email": "nebula.thanos@acme.com",     "department": "DevOps"},
    # Marvel — Finance
    {"id": "u019", "name": "Pepper Potts",      "email": "pepper.potts@acme.com",      "department": "Finance"},
    {"id": "u020", "name": "T'Challa Udaku",    "email": "tchalla.udaku@acme.com",     "department": "Finance"},
    {"id": "u021", "name": "Okoye Adaeze",      "email": "okoye.adaeze@acme.com",      "department": "Finance"},
    {"id": "u022", "name": "Wong Kaecilius",    "email": "wong.kaecilius@acme.com",    "department": "Finance"},
    {"id": "u023", "name": "Everett Ross",      "email": "everett.ross@acme.com",      "department": "Finance"},
    # Marvel — Marketing
    {"id": "u024", "name": "Carol Danvers",     "email": "carol.danvers@acme.com",     "department": "Marketing"},
    {"id": "u025", "name": "Wanda Maximoff",    "email": "wanda.maximoff@acme.com",    "department": "Marketing"},
    {"id": "u026", "name": "Kamala Khan",       "email": "kamala.khan@acme.com",       "department": "Marketing"},
    {"id": "u027", "name": "America Chavez",    "email": "america.chavez@acme.com",    "department": "Marketing"},
    {"id": "u028", "name": "Kate Bishop",       "email": "kate.bishop@acme.com",       "department": "Marketing"},
    # Marvel — Legal
    {"id": "u029", "name": "Steve Rogers",      "email": "steve.rogers@acme.com",      "department": "Legal"},
    {"id": "u030", "name": "Natasha Romanoff",  "email": "natasha.romanoff@acme.com",  "department": "Legal"},
    {"id": "u031", "name": "Stephen Strange",   "email": "stephen.strange@acme.com",   "department": "Legal"},
    {"id": "u032", "name": "Jennifer Walters",  "email": "jennifer.walters@acme.com",  "department": "Legal"},
    # Disney — Engineering
    {"id": "u033", "name": "Mirabel Madrigal",  "email": "mirabel.madrigal@acme.com",  "department": "Engineering"},
    {"id": "u034", "name": "Raya Kumandra",     "email": "raya.kumandra@acme.com",     "department": "Engineering"},
    {"id": "u035", "name": "Hercules Zeus",     "email": "hercules.zeus@acme.com",     "department": "Engineering"},
    {"id": "u036", "name": "Moana Waialiki",    "email": "moana.waialiki@acme.com",    "department": "Engineering"},
    # Disney — DevOps
    {"id": "u037", "name": "Elsa Arendelle",    "email": "elsa.arendelle@acme.com",    "department": "DevOps"},
    {"id": "u038", "name": "Anna Arendelle",    "email": "anna.arendelle@acme.com",    "department": "DevOps"},
    {"id": "u039", "name": "Rapunzel Corona",   "email": "rapunzel.corona@acme.com",   "department": "DevOps"},
    {"id": "u040", "name": "Merida Dunbroch",   "email": "merida.dunbroch@acme.com",   "department": "DevOps"},
    {"id": "u041", "name": "Asha Rosas",        "email": "asha.rosas@acme.com",        "department": "DevOps"},
    # Disney — Finance
    {"id": "u042", "name": "Tiana Naveen",      "email": "tiana.naveen@acme.com",      "department": "Finance"},
    {"id": "u043", "name": "Simba Mufasa",      "email": "simba.mufasa@acme.com",      "department": "Finance"},
    {"id": "u044", "name": "Aladdin Prince",    "email": "aladdin.prince@acme.com",    "department": "Finance"},
    {"id": "u045", "name": "Nala Mufasa",       "email": "nala.mufasa@acme.com",       "department": "Finance"},
    # Disney — Marketing
    {"id": "u046", "name": "Ariel Triton",      "email": "ariel.triton@acme.com",      "department": "Marketing"},
    {"id": "u047", "name": "Belle Potts",       "email": "belle.potts@acme.com",       "department": "Marketing"},
    {"id": "u048", "name": "Jasmine Agrabah",   "email": "jasmine.agrabah@acme.com",   "department": "Marketing"},
    # Disney — Legal
    {"id": "u049", "name": "Mulan Fa",          "email": "mulan.fa@acme.com",          "department": "Legal"},
    {"id": "u050", "name": "Cinderella Tremaine","email": "cinderella.tremaine@acme.com","department": "Legal"},
]


@users_bp.route('/api/users')
def list_users():
    return jsonify(USERS)

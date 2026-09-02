#!/usr/bin/env python3
"""Generate 30 diverse, clumped survey responses and submit them.

Data is intentionally skewed/clumped to make charts look realistic:
- Some choices dominate (e.g. Reform is the most common identity)
- Some questions have low answer rates (e.g. ADA, children's programs)
- Matrix rows for children's activities are mostly blank (no kids)
- Financial familiarity is low for most respondents
- NPS clusters around 7-9 with a few detractors
"""
import json, random, sys, time, urllib.request, urllib.error

BASE = "https://temple-shalom-survey.jeffstein.workers.dev"

# ── Clumped choice weights (higher = more likely) ──────────────────────────

# Q1 tenure: most people are long-time members
TENURE_LIVED = ["less_1yr","1_5yr","6_10yr","11_15yr","16_20yr","over_20yr","dont_know"]
TENURE_LIVED_W = [3, 5, 4, 5, 4, 8, 1]
TENURE_MEMBER = ["less_1yr","1_5yr","6_10yr","11_15yr","16_20yr","over_20yr","dont_know"]
TENURE_MEMBER_W = [4, 6, 5, 5, 3, 6, 1]

# Q2 household ages: 26-50 and 51-65 dominate, kids vary
AGE_COLS = ["no_participation", "some", "monthly"]
AGE_PROFILES = [
    # (ages_present, typical_level)
    (["age_26_50", "age_51_65"], "some"),           # couple, no kids
    (["age_26_50", "age_0_5", "age_6_9"], "some"),   # young family
    (["age_26_50", "age_10_13", "age_14_18"], "some"), # family with teens
    (["age_51_65", "age_66_80"], "some"),             # older couple
    (["age_26_50"], "monthly"),                       # single active
    (["age_66_80"], "some"),                          # senior single
    (["age_26_50", "age_51_65", "age_19_25"], "some"), # multi-gen
    (["age_26_50", "age_6_9", "age_10_13"], "monthly"), # very active family
]

# Q5 religious identity: Reform dominates
IDENTITY = ["reform","conservative","orthodox","just_jewish","not_jewish","conversion"]
IDENTITY_W = [14, 5, 2, 5, 2, 2]

# Q8 how learned
HOW_LEARNED = ["grew_up","self_sought","member_contact","email_invite","other"]
HOW_LEARNED_W = [8, 6, 8, 4, 4]

# Q9 initial decision (checkbox, multi-select)
INITIAL_DECISIONS = ["preschool","religious_school","worship","lifecycle","social","conversion","rabbi","community","dont_recall","other"]
INITIAL_DECISION_W = [6, 5, 10, 4, 5, 2, 6, 10, 1, 1]

# Q10 worship activities
WORSHIP_ROWS = ["friday_services","friday_oneg","saturday_services","saturday_bagel","high_holiday","festival_holiday","conversion_prog","support_group","lifecycle"]
WORSHIP_LEVELS = ["no","want_to","occasionally","regularly"]
# Most people go to Friday services and High Holidays
WORSHIP_PROFILES = {
    "friday_services": [1, 3, 12, 10],
    "friday_oneg": [8, 5, 8, 4],
    "saturday_services": [12, 4, 6, 3],
    "saturday_bagel": [15, 3, 5, 2],
    "high_holiday": [2, 2, 5, 18],
    "festival_holiday": [5, 4, 10, 5],
    "conversion_prog": [25, 1, 1, 1],
    "support_group": [25, 1, 2, 1],
    "lifecycle": [3, 3, 12, 8],
}

# Q11 program activities
PROGRAM_ROWS = ["adult_ed","movie_series","concerts","social_action","boker_tov","speaker_series","committee","committee_chair","board_member","board_meeting","town_hall","congregational_mtg","chavurah"]
PROGRAM_PROFILES = {
    "adult_ed": [3, 5, 10, 6],
    "movie_series": [5, 4, 12, 3],
    "concerts": [4, 3, 12, 4],
    "social_action": [4, 5, 8, 6],
    "boker_tov": [20, 2, 3, 1],
    "speaker_series": [5, 4, 10, 3],
    "committee": [8, 5, 6, 5],
    "committee_chair": [22, 2, 2, 1],
    "board_member": [24, 1, 1, 2],
    "board_meeting": [18, 2, 4, 3],
    "town_hall": [10, 3, 8, 4],
    "congregational_mtg": [6, 2, 8, 10],
    "chavurah": [8, 4, 6, 5],
}

# Q12 children: 60% no, 40% yes
HAS_CHILDREN = ["no", "yes"]
HAS_CHILDREN_W = [18, 12]

# Q13 children activities (only if yes)
CHILD_ROWS = ["nevatim","preschool","ha_merkaz","sichot","pj_library","marichim","bbyo","summer_camp","venture_crew"]
CHILD_PROFILES = {
    "nevatim": [8, 2, 3, 2],
    "preschool": [6, 2, 2, 5],
    "ha_merkaz": [4, 3, 4, 6],
    "sichot": [8, 3, 3, 2],
    "pj_library": [10, 2, 2, 1],
    "marichim": [12, 2, 1, 1],
    "bbyo": [14, 1, 1, 1],
    "summer_camp": [8, 4, 2, 2],
    "venture_crew": [16, 1, 1, 1],
}

# Q14 social engagement
SOCIAL_ENG = ["never","rarely","occasionally","frequently"]
SOCIAL_ENG_W = [3, 6, 12, 9]

# Q15 barriers (checkbox)
BARRIERS = ["cost","schedule","distance","awareness","alone","health","not_relevant","fully_engaged","other"]
BARRIER_W = [4, 12, 3, 8, 3, 2, 2, 8, 1]

# Q16 engagement opportunities (checkbox)
ENGAGE_OPTS = ["adult_ed","committee","board","nextgen","social_40_60","social_70plus","cemetery","film","social_action","greeter","torah_reading","torah_study","oneg_maven","bagel_brigade","boker_tov","pto","israel_trip","retreat","other"]
ENGAGE_W = [10, 5, 4, 2, 6, 3, 2, 8, 6, 3, 3, 4, 3, 3, 2, 4, 2, 3, 1]

# Q17 chavurot (checkbox)
CHAVUROT = ["biking","bookclub","fiber","entrepreneurship","genealogy","hiking","mahjong","pickleball","supper_club","other"]
CHAVUROT_W = [4, 6, 2, 1, 2, 8, 4, 5, 6, 1]

# Q19 connection
CONNECTION = ["not_at_all","slightly","moderately","very","extremely"]
CONNECTION_W = [2, 3, 8, 10, 7]

# Q20 big picture
BIG_PICTURE_ROWS = ["beit_tfillah","beit_midrash","beit_knesset"]
BIG_PICTURE_COLS = ["needs_improvement","meeting_expectations","very_satisfied","na"]
BIG_PICTURE_PROFILES = {
    "beit_tfillah": [3, 12, 12, 3],
    "beit_midrash": [4, 10, 10, 6],
    "beit_knesset": [2, 10, 14, 4],
}

# Q21 leaders
LEADERS_ROWS = ["board","rabbi","exec_director","youth_ed_director","preschool_head"]
LEADERS_COLS = ["needs_improvement","meeting_expectations","very_satisfied"]
LEADERS_PROFILES = {
    "board": [5, 12, 13],
    "rabbi": [2, 6, 22],
    "exec_director": [3, 10, 17],
    "youth_ed_director": [2, 8, 10],  # many skip (no kids)
    "preschool_head": [1, 5, 8],      # many skip (no kids)
}

# Q22 scenarios
SCENARIOS_ROWS = ["non_jewish_spouse","lgbtq","conversion","new_member","value","board_responsive","rabbi_responsive","ed_responsive"]
SCENARIOS_COLS = ["strongly_disagree","disagree","agree","strongly_agree","na"]
SCENARIOS_PROFILES = {
    "non_jewish_spouse": [1, 2, 8, 12, 7],
    "lgbtq": [1, 1, 6, 16, 6],
    "conversion": [1, 1, 8, 14, 6],
    "new_member": [1, 2, 10, 15, 2],
    "value": [1, 3, 12, 13, 1],
    "board_responsive": [2, 4, 12, 8, 4],
    "rabbi_responsive": [1, 2, 8, 17, 2],
    "ed_responsive": [2, 3, 10, 10, 5],
}

# Q23 strengths/weaknesses
SW_ROWS = ["preschool","ha_merkaz","sichot","friday_services","saturday_svc","programs","adult_ed","community","board","rabbi","exec_director","volunteers","cemetery","boker_tov","pto","chavurot","foundation"]
SW_COLS = ["weakness","meeting_expectations","strength","na"]
SW_PROFILES = {
    "preschool": [1, 3, 8, 18],
    "ha_merkaz": [1, 3, 6, 20],
    "sichot": [1, 2, 3, 24],
    "friday_services": [2, 6, 20, 2],
    "saturday_svc": [3, 8, 10, 9],
    "programs": [2, 8, 14, 6],
    "adult_ed": [1, 6, 16, 7],
    "community": [1, 5, 22, 2],
    "board": [4, 12, 8, 6],
    "rabbi": [1, 4, 23, 2],
    "exec_director": [2, 8, 14, 6],
    "volunteers": [3, 10, 10, 7],
    "cemetery": [1, 4, 3, 22],
    "boker_tov": [1, 2, 3, 24],
    "pto": [1, 3, 4, 22],
    "chavurot": [1, 4, 8, 17],
    "foundation": [2, 4, 3, 21],
}

# Q24 NPS: clusters around 7-10 with a few low
NPS_VALUES = list(range(0, 11))
NPS_WEIGHTS = [1, 0, 1, 1, 1, 2, 3, 6, 8, 5, 2]

# Q25 facility
FACILITY = ["very_satisfied","satisfied","neutral","dissatisfied","very_dissatisfied","na"]
FACILITY_W = [6, 12, 6, 3, 1, 2]

# Q28 financial familiarity
FIN_ROWS = ["financial_health","foundation","funds","planned_giving"]
FIN_COLS = ["not_familiar","slightly","reasonably","very_familiar","na"]
FIN_PROFILES = {
    "financial_health": [10, 8, 6, 3, 3],
    "foundation": [14, 6, 4, 2, 4],
    "funds": [12, 7, 5, 3, 3],
    "planned_giving": [16, 5, 3, 2, 4],
}

# Q29 giving interests (checkbox)
GIVING = ["general","foundation","building","cemetery","education","music","rabbi_discretionary","security","seniors","social_action","other"]
GIVING_W = [15, 4, 3, 2, 8, 4, 5, 3, 2, 6, 1]

# Q30 dues fairness
DUES = ["very_fair","somewhat_fair","somewhat_unfair","unfair","unaware"]
DUES_W = [6, 12, 4, 2, 6]

# Q31 priority
PRIORITY = ["youth_ed","adult_ed","facility","security","outreach","clergy","technology","other"]
PRIORITY_W = [6, 5, 5, 3, 4, 4, 2, 1]

# Q32 comm usefulness
COMM_ROWS = ["weekly_email","monthly_bulletin","event_emails","website_calendar","website_announcements","facebook","postcards","direct_mail","board_announcements"]
COMM_COLS = ["strongly_disagree","disagree","agree","strongly_agree","not_aware"]
COMM_PROFILES = {
    "weekly_email": [1, 2, 12, 12, 3],
    "monthly_bulletin": [1, 3, 14, 8, 4],
    "event_emails": [1, 2, 10, 10, 7],
    "website_calendar": [2, 5, 10, 5, 8],
    "website_announcements": [2, 4, 8, 4, 12],
    "facebook": [2, 3, 8, 5, 12],
    "postcards": [3, 6, 6, 3, 12],
    "direct_mail": [4, 8, 5, 2, 11],
    "board_announcements": [2, 4, 6, 3, 15],
}

# Q33 announcements length
ANNOUNCE_LEN = ["too_long","just_right","too_short"]
ANNOUNCE_LEN_W = [10, 16, 4]

# Q35 comm satisfaction
COMM_SAT = ["very_dissatisfied","dissatisfied","neutral","satisfied","very_satisfied","not_familiar"]
COMM_SAT_W = [2, 4, 8, 12, 3, 1]

# Q37 comm channels (checkbox)
COMM_CHANNELS = ["sms","whatsapp","facebook","email","physical_mail","instagram","website_push","singing_telegram","other"]
COMM_CHANNELS_W = [6, 4, 8, 25, 6, 5, 4, 1, 1]

# Q38 comm frequency
COMM_FREQ = ["few_per_week","weekly","monthly","urgent_only"]
COMM_FREQ_W = [5, 15, 8, 2]

# Q39 comm content (checkbox)
COMM_CONTENT = ["shabbat_info","events","urgent","lifecycle","educational","financial"]
COMM_CONTENT_W = [20, 22, 15, 12, 8, 4]

# Q43 contact request
CONTACT_REQ = ["yes", "no"]
CONTACT_REQ_W = [8, 22]

# ── Comment pools ───────────────────────────────────────────────────────────

JEWISH_GROWTH_COMMENTS = [
    "More adult education classes would be great.",
    "I would love to lead more services and read Torah.",
    "I am currently in the conversion program and loving every minute of it.",
    "I want to help others find their Jewish path.",
    "I would like to see more scholarly study opportunities for seniors.",
    "More Hebrew classes please.",
    "I'd love to learn more about Jewish meditation and mindfulness.",
    "", "", "",  # many skip this
]

ENGAGE_COMMENTS = [
    "Would love more family-friendly events.",
    "Temple Shalom is my spiritual home.",
    "More senior-focused programming please.",
    "I am proud of what we have built together.",
    "Would love to see more social events for young families.",
    "", "", "", "",
]

SERVICE_COMMENTS = [
    "Friday night services are the highlight of my week.",
    "Services are meaningful and well-led.",
    "Announcements take too long and repeat information already in the bulletin.",
    "I love the music and singing.",
    "Would prefer shorter services.",
    "", "", "", "", "",
]

LEADERSHIP_COMMENTS = [
    "The board needs to be more transparent about financial decisions.",
    "I appreciate all the volunteer leaders do.",
    "Would like to see younger people on the board.",
    "", "", "", "", "",
]

FINAL_COMMENTS = [
    "Thank you for all you do for our community.",
    "I'm grateful to be part of this congregation.",
    "Would love to see more outreach to unaffiliated Jews.",
    "", "", "", "", "", "",
]

COMM_IMPROVEMENT = [
    "Less email, more concise updates please.",
    "The weekly email is great but sometimes too long.",
    "Would love a mobile app.",
    "Better calendar integration would help.",
    "", "", "", "", "",
]

COMM_EFFECTIVENESS = [
    "The weekly email works well for me.",
    "I often miss things because there are too many channels.",
    "Facebook group is where I get most of my info.",
    "", "", "", "",
]

ANNOUNCE_COMMENTS = [
    "Announcements take too long and repeat information already in the bulletin.",
    "Keep them brief and focused.",
    "I enjoy the announcements — they make me feel connected.",
    "", "", "", "",
]

CONTACT_NAMES = [
    "Jane Doe", "Robert Smith", "Sarah Johnson", "David Cohen",
    "", "", "", "", "", "",  # most don't leave contact
]
CONTACT_EMAILS = [
    "jane@example.com", "", "sarah.johnson@email.com", "david.cohen@email.com",
    "", "", "", "", "", "",  # most don't leave contact
]
CONTACT_PHONES = [
    "555-0100", "555-0200", "", "555-0300",
    "", "", "", "", "", "",  # most don't leave contact
]


def weighted_pick(options, weights, n=1):
    return random.choices(options, weights=weights, k=n)[0]

def weighted_pick_multi(options, weights, min_n=1, max_n=4):
    count = random.randint(min_n, min(max_n, len(options)))
    # Pick without replacement using weights
    chosen = []
    pool = list(zip(options, weights))
    for _ in range(count):
        if not pool: break
        opts, wts = zip(*pool)
        idx = random.choices(range(len(pool)), weights=wts, k=1)[0]
        chosen.append(pool.pop(idx)[0])
    return chosen

def maybe_skip(prob=0.3):
    return random.random() < prob

def build_matrix(rows, col_options, col_weights, skip_rows_prob=0.0, skip_all_prob=0.0):
    if random.random() < skip_all_prob:
        return {}
    result = {}
    for row in rows:
        if random.random() < skip_rows_prob:
            continue
        result[row] = weighted_pick(col_options, col_weights)
    return result

def build_matrix_profile(profiles, skip_all_prob=0.0):
    if random.random() < skip_all_prob:
        return {}
    result = {}
    for row, weights in profiles.items():
        result[row] = weighted_pick(list(range(len(weights))), weights)
        # Convert index to column value
        cols_for_row = list(range(len(weights)))
        result[row] = weighted_pick(
            [i for i in range(len(weights))],
            weights
        )
    return result

def build_matrix_named(profiles, col_names, skip_all_prob=0.0, skip_row_prob=0.0):
    """Build a matrix dict using named columns and per-row weight profiles."""
    if random.random() < skip_all_prob:
        return {}
    result = {}
    for row, weights in profiles.items():
        if random.random() < skip_row_prob:
            continue
        result[row] = weighted_pick(col_names, weights)
    return result


def generate_response(idx):
    random.seed(idx * 42 + 7)  # deterministic but diverse
    r = {}

    r["_session"] = f"test-{idx:03d}"

    # Q1 tenure
    r["q1_tenure"] = {
        "lived_in_cs": weighted_pick(TENURE_LIVED, TENURE_LIVED_W),
        "been_member": weighted_pick(TENURE_MEMBER, TENURE_MEMBER_W),
    }

    # Q2 household ages — pick a profile
    profile = random.choice(AGE_PROFILES)
    ages, level = profile
    r["q2_household_ages"] = {age: level for age in ages}
    # Sometimes add participation level variation
    for age in r["q2_household_ages"]:
        if random.random() < 0.3:
            r["q2_household_ages"][age] = weighted_pick(AGE_COLS, [2, 5, 3])

    # Q3 ADA — most say none
    r["q3_ada"] = weighted_pick(["none", "sometimes", "permanently"], [22, 5, 3])

    # Q4 ADA limits — only if Q3 != none, and often skipped
    if r["q3_ada"] != "none":
        r["q4_ada_limits"] = weighted_pick(["no", "yes"], [3, 2])
    # else: skip Q4

    # Q5 religious identity
    r["q5_religious_identity"] = weighted_pick(IDENTITY, IDENTITY_W)

    # Q6 prayer books — sometimes skip
    r["q6_prayer_books"] = build_matrix_named(
        {"mishkan": [12, 3, 8], "sim_shalom": [12, 3, 8], "machzor": [10, 3, 10]},
        ["meets_needs", "does_not_meet", "no_opinion"],
        skip_all_prob=0.15
    )

    # Q7 jewish growth — often skipped
    r["q7_jewish_growth"] = random.choice(JEWISH_GROWTH_COMMENTS)

    # Q8 how learned
    r["q8_how_learned"] = weighted_pick(HOW_LEARNED, HOW_LEARNED_W)

    # Q9 initial decision (multi-select)
    r["q9_initial_decision"] = weighted_pick_multi(INITIAL_DECISIONS, INITIAL_DECISION_W, 1, 4)

    # Q10 worship activities
    r["q10_worship_activities"] = build_matrix_named(
        WORSHIP_PROFILES, WORSHIP_LEVELS, skip_all_prob=0.05, skip_row_prob=0.1
    )

    # Q11 program activities
    r["q11_program_activities"] = build_matrix_named(
        PROGRAM_PROFILES, WORSHIP_LEVELS, skip_all_prob=0.1, skip_row_prob=0.15
    )

    # Q12 children
    r["q12_children"] = weighted_pick(HAS_CHILDREN, HAS_CHILDREN_W)

    # Q13 children activities — only if yes
    if r["q12_children"] == "yes":
        r["q13_children_activities"] = build_matrix_named(
            CHILD_PROFILES, WORSHIP_LEVELS, skip_all_prob=0.1, skip_row_prob=0.3
        )

    # Q14 social engagement
    r["q16_social_engagement"] = weighted_pick(SOCIAL_ENG, SOCIAL_ENG_W)

    # Q15 barriers (multi-select) — sometimes skip
    if random.random() < 0.15:
        pass  # skip
    else:
        r["q_barriers"] = weighted_pick_multi(BARRIERS, BARRIER_W, 1, 3)

    # Q16 engagement opportunities (multi-select)
    r["q19_engagement_opportunities"] = weighted_pick_multi(ENGAGE_OPTS, ENGAGE_W, 1, 5)

    # Q17 chavurot (multi-select) — often skipped
    if random.random() < 0.3:
        pass
    else:
        r["q20_chavurot"] = weighted_pick_multi(CHAVUROT, CHAVUROT_W, 1, 3)

    # Q18 engagement comments — often skipped
    r["q21_engagement_comments"] = random.choice(ENGAGE_COMMENTS)

    # Q19 connection
    r["q_connection"] = weighted_pick(CONNECTION, CONNECTION_W)

    # Q20 big picture
    r["q22_big_picture"] = build_matrix_named(
        BIG_PICTURE_PROFILES, BIG_PICTURE_COLS, skip_all_prob=0.05, skip_row_prob=0.1
    )

    # Q21 leaders
    r["q23_leaders"] = build_matrix_named(
        LEADERS_PROFILES, LEADERS_COLS, skip_all_prob=0.05, skip_row_prob=0.15
    )

    # Q22 scenarios
    r["q24_scenarios"] = build_matrix_named(
        SCENARIOS_PROFILES, SCENARIOS_COLS, skip_all_prob=0.05, skip_row_prob=0.2
    )

    # Q23 strengths/weaknesses
    r["q27_strengths_weaknesses"] = build_matrix_named(
        SW_PROFILES, SW_COLS, skip_all_prob=0.1, skip_row_prob=0.25
    )

    # Q24 NPS
    r["q_nps"] = weighted_pick(NPS_VALUES, NPS_WEIGHTS)

    # Q25 facility
    r["q_facility"] = weighted_pick(FACILITY, FACILITY_W)

    # Q26 service comments — often skipped
    r["q25_service_comments"] = random.choice(SERVICE_COMMENTS)

    # Q27 leadership comments — often skipped
    r["q26_leadership_comments"] = random.choice(LEADERSHIP_COMMENTS)

    # Q28 financial familiarity
    r["q17_financial_familiarity"] = build_matrix_named(
        FIN_PROFILES, FIN_COLS, skip_all_prob=0.1, skip_row_prob=0.15
    )

    # Q29 giving interests (multi-select) — sometimes skip
    if random.random() < 0.2:
        pass
    else:
        r["q18_giving_interests"] = weighted_pick_multi(GIVING, GIVING_W, 1, 4)

    # Q30 dues fairness
    r["q_dues_fairness"] = weighted_pick(DUES, DUES_W)

    # Q31 priority
    r["q_priority"] = weighted_pick(PRIORITY, PRIORITY_W)

    # Q32 comm usefulness
    r["q14_comm_usefulness"] = build_matrix_named(
        COMM_PROFILES, COMM_COLS, skip_all_prob=0.05, skip_row_prob=0.15
    )

    # Q33 announcements length
    r["q_service_announcements_length"] = weighted_pick(ANNOUNCE_LEN, ANNOUNCE_LEN_W)

    # Q34 announcements comments — often skipped
    r["q_service_announcements_comments"] = random.choice(ANNOUNCE_COMMENTS)

    # Q35 comm satisfaction
    r["q_comm_satisfaction"] = weighted_pick(COMM_SAT, COMM_SAT_W)

    # Q36 comm effectiveness — often skipped
    r["q_comm_effectiveness"] = random.choice(COMM_EFFECTIVENESS)

    # Q37 comm channels (multi-select)
    r["q_comm_channels"] = weighted_pick_multi(COMM_CHANNELS, COMM_CHANNELS_W, 1, 4)

    # Q38 comm frequency
    r["q_comm_frequency"] = weighted_pick(COMM_FREQ, COMM_FREQ_W)

    # Q39 comm content (multi-select)
    r["q_comm_content"] = weighted_pick_multi(COMM_CONTENT, COMM_CONTENT_W, 2, 5)

    # Q40 comm improvement — often skipped
    r["q15_comm_improvement"] = random.choice(COMM_IMPROVEMENT)

    # Q39 babka
    r["q_babka"] = weighted_pick(
        ["chocolate", "cinnamon", "both", "neither", "gluten_free"],
        [35, 25, 20, 10, 10],
    )

    # Q40 joke
    r["q_joke"] = weighted_pick(["joke1", "joke2", "joke3"], [40, 35, 25])

    # Q41 final comments — often skipped
    r["q28_final_comments"] = random.choice(FINAL_COMMENTS)

    # Q41-43 contact info — often skipped
    name = random.choice(CONTACT_NAMES)
    email = random.choice(CONTACT_EMAILS)
    phone = random.choice(CONTACT_PHONES)
    if name: r["q_contact_name"] = name
    if email: r["q_contact_email"] = email
    if phone: r["q_contact_phone"] = phone

    # Q43a contact request
    if name or email or phone:
        r["q_contact_request"] = weighted_pick(CONTACT_REQ, CONTACT_REQ_W)

    return r


def submit(response):
    data = json.dumps(response).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/submit",
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "TempleShalomSurveyTest/1.0"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"success": False, "error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    num = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    print(f"Generating and submitting {num - start + 1} test responses (#{start}-#{num})...\n")
    success = 0
    fail = 0
    for i in range(start, num + 1):
        resp = generate_response(i)
        result = submit(resp)
        if result.get("success"):
            print(f"  [{i:2d}] OK - {result.get('response_id', '?')[:8]}")
            success += 1
        else:
            print(f"  [{i:2d}] FAIL - {result.get('error', 'unknown')}")
            fail += 1
        time.sleep(13)  # stay under 5/min rate limit
    print(f"\nDone: {success} succeeded, {fail} failed")


if __name__ == "__main__":
    main()

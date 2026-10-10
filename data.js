/* Static reference data for the Brandon Valley School District (SD).
 * Everything here is transcribed from public district sources: the 2026-27
 * district calendar (adopted 2026-01-26), the student handbooks, each
 * school's website and LINQ Connect. Live data (menus, events, closings)
 * is fetched at runtime.
 *
 * TEMPLATE NOTE: a new district is this file plus the three source readers
 * (menu.js, events.js, school.js). Keep the field names. */
(() => {
  "use strict";

  const SITE = "https://brandonvalley.k12.sd.us";
  const DOCS = `${SITE}/district%20documents`;

  // The district itself: ids the readers need and the public documents.
  const DISTRICT = {
    name: "Brandon Valley School District",
    short: "Brandon Valley",
    site: SITE,
    linqDistrict: "b1d7358a-818b-ec11-90c7-d2d97b40e955",
    bound: "brandonvalley",
    boundIcs: "https://www.gobound.com/sd/schools/brandonvalley/calendar/ical",
    tickets: "https://www.gobound.com/sd/schools/brandonvalley/tickets",
    calendarPdf: `${DOCS}/calendar/26-27_calendar.pdf`,
    handbooks: {
      district: `${DOCS}/Handbooks/@DistrictHandbook.pdf`,
      elementary: `${DOCS}/Handbooks/@ElementaryHandbook.pdf`,
      intermediate: `${DOCS}/Handbooks/@IntermediateHandbook.pdf`,
      middle: `${DOCS}/Handbooks/@MiddleSchoolHandbook.pdf`,
      high: `${DOCS}/Handbooks/@HighSchoolHandbook.pdf`,
      activities: `${DOCS}/Handbooks/@ActivitiesHandbook.pdf`,
    },
    closings: "https://www.keloland.com/weather/closings/",
    closingsJson: "https://www.keloland.com/wp-json/nxd_app/v1/closings_alerts",
    weatherGrid: "FSD/103,67",
    timeZone: "America/Chicago",
    phone: "605-582-2049",
  };

  const BRAND = { primary: "#A8181A", secondary: "#f4c95d", onPrimary: "#ffffff" };
  const PRICES = { es: { breakfast: 2.40, lunch: 3.50, milk: 0.65 }, is: { breakfast: 2.40, lunch: 3.50, milk: 0.65 },
    ms: { breakfast: 2.40, lunch: 3.75, milk: 0.65 }, hs: { breakfast: 2.40, lunch: 3.85, milk: 0.65 } };
  const ELEM_BELL = `${SITE}/District%20Images/Schedules/Elementary%20Bell%20Schedules.png`;

  // One entry per building. `linq` is the LINQ Connect building id (also
  // the id the app used before 2026-10; kept for data migration and for the
  // Google calendar mirror's keys). `gcal` is the school's public Google
  // Calendar. `boundTags` are Bound's building tags that mean this school.
  // grades: -1 is junior kindergarten, 0 is kindergarten.
  const school = (o) => ({
    mascot: "", brand: { ...BRAND, logo: "icons/icon-192.png" }, attendance: null,
    principal: null, parking: null, tripper: null, newsletter: null,
    site: `${SITE}/${o.id}/`, prices: PRICES[o.level], ...o,
  });
  const SCHOOLS = {
    bes: school({ id: "bes", level: "es", grades: [-1, 4], name: "Brandon Elementary", short: "Brandon El.",
      linq: "041717d0-8f8d-ec11-8df7-eb7b319a32d1", gcal: "c_lk4f0sf7m263481bksgqii8qdk@group.calendar.google.com",
      boundTags: ["Brandon Elementary", "Elementary Events"],
      address: "501 E. Holly Blvd, Brandon, SD 57005", phone: "605-582-6315", email: "Merle.Horst@k12.sd.us",
      attendanceNote: "Call the office by 8:30 AM to report an absence.",
      bell: { start: "8:10", end: "3:00" }, bellImage: ELEM_BELL, handbook: "elementary",
      supplies: `${SITE}/bes/Documents/BESchoolSupplyList.pdf` }),
    bve: school({ id: "bve", level: "es", grades: [-1, 4], name: "Burkman Valley Elementary", short: "Burkman Valley",
      linq: "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7", gcal: "c_e8d7901cad2431e55294d2743334511490bce6c7d904928f0ab43f5d8651403a@group.calendar.google.com",
      boundTags: ["Burkman Valley Elementary", "Elementary Events"],
      address: "300 N Sunshine Ave, Brandon, SD 57005", phone: "605-582-6300", email: "Mary.Mudder@k12.sd.us",
      attendanceNote: "Call the office by 8:30 AM to report an absence.",
      bell: { start: "8:10", end: "3:00" }, bellImage: ELEM_BELL, handbook: "elementary",
      supplies: `${SITE}/bve/Documents/BVESchoolSupply26-27.pdf` }),
    fae: school({ id: "fae", level: "es", grades: [-1, 4], name: "Fred Assam Elementary", short: "Fred Assam",
      linq: "af61ff49-908d-ec11-8df7-9c80cb6a95ae", gcal: "c_eka0c7b34dvek74sbkcnsi2298@group.calendar.google.com",
      boundTags: ["Fred Assam Elementary", "Elementary Events"],
      address: "7700 E. Willowwood St., Sioux Falls, SD 57110", phone: "605-582-1500", email: "Rick.Pearson@k12.sd.us",
      attendanceNote: "Call the office by 8:30 AM to report an absence.",
      bell: { start: "8:10", end: "3:00" }, bellImage: ELEM_BELL, handbook: "elementary",
      supplies: `${SITE}/fae/Documents/FAESchoolSupply26-27.pdf` }),
    ies: school({ id: "ies", level: "es", grades: [-1, 4], name: "Inspiration Elementary", short: "Inspiration",
      linq: "0c65b2bc-908d-ec11-8df7-9566c4096294", gcal: "c_oev712r91d4s20cdllnkf02hao@group.calendar.google.com",
      boundTags: ["Inspiration Elementary", "Elementary Events"],
      address: "3401 S Sparta Ave, Sioux Falls, SD 57110", phone: "605-582-8590", email: "Tanya.Palmer@k12.sd.us",
      attendanceNote: "Call the office by 8:30 AM to report an absence.",
      bell: { start: "8:10", end: "3:00" }, bellImage: ELEM_BELL, handbook: "elementary",
      supplies: `${SITE}/ies/Documents/IESSchoolSupply26-27.pdf` }),
    rbe: school({ id: "rbe", level: "es", grades: [-1, 4], name: "Robert Bennis Elementary", short: "Robert Bennis",
      linq: "ec90bc02-908d-ec11-8df7-eb7b319a32d1", gcal: "c_i2k36488vcv4h1n33utlv7ar3g@group.calendar.google.com",
      boundTags: ["Robert Bennis Elementary", "Elementary Events"],
      address: "2001 S. Sioux Blvd, Brandon, SD 57005", phone: "605-582-8010", email: "Kristin.Hofkamp@k12.sd.us",
      attendanceNote: "Call the office by 8:30 AM to report an absence.",
      bell: { start: "8:10", end: "3:00" }, bellImage: ELEM_BELL, handbook: "elementary",
      supplies: `${SITE}/rbe/Documents/RBESchoolSupply26-27.pdf` }),
    bvis: school({ id: "bvis", level: "is", grades: [5, 6], name: "BV Intermediate School", short: "BV Intermediate",
      linq: "82b0714f-8f8d-ec11-8df7-d30e05c96286", gcal: "c_q2r3bv8jrh8kdttfgj2s5gntss@group.calendar.google.com",
      boundTags: ["Intermediate School Events"],
      address: "201 W. Park Street, Brandon, SD 57005", phone: "605-582-6035", email: "Nick.Skibsted@k12.sd.us",
      attendanceNote: "Call or email the office by 8:30 AM to report an absence.",
      bell: { start: "8:05", end: "3:05" }, bellImage: null, handbook: "intermediate",
      supplies: `${SITE}/bvis/Documents/BVISSchoolSupplyList.pdf` }),
    bvms: school({ id: "bvms", level: "ms", grades: [7, 8], name: "BV Middle School", short: "BV Middle",
      linq: "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1", gcal: "k12.sd.us_1v08ahk36loit8h6c6d2c3ga08@group.calendar.google.com",
      boundTags: ["Middle School Events"],
      address: "700 E Holly Blvd, Brandon, SD 57005", phone: "605-582-3214", email: "Jordan.Paula@k12.sd.us",
      attendance: "mailto:BrandonValleyMiddleSchoolAttendance@k12.sd.us",
      attendanceNote: "Email the attendance office or call 605-582-3214 by 8:30 AM.",
      bell: { start: "8:05", end: "3:10" }, bellImage: `${SITE}/bvms/Documents/bell%20schedule.pdf`, handbook: "middle",
      supplies: `${SITE}/bvms/Documents/BVMSSchoolSupply26-27.pdf` }),
    bvhs: school({ id: "bvhs", level: "hs", grades: [9, 12], name: "BV High School", short: "BV High",
      linq: "ffc1d3ff-8e8d-ec11-8df7-c6813137b210", gcal: "c_8q83pnh5nj5nhtfuue53nvlmm0@group.calendar.google.com",
      boundTags: ["High School Events"],
      address: "301 S. Splitrock Blvd, Brandon, SD 57005", phone: "605-582-3211", email: null,
      attendanceNote: "Call the office by 9:00 AM to report an absence; medical notes are due within a week.",
      bell: { start: "8:05", end: "3:14" }, bellImage: `${SITE}/bvhs/Images/BVHSBell26-27.jpg`, handbook: "high",
      supplies: null }),
  };

  // Links every family uses, in the order parents reach for them. Labels
  // are lookup keys (GUIDE `link` values and app.js find entries by label).
  const DISTRICT_LINKS = [
    { label: "Skyward Family Access", note: "Grades, attendance, schedule", url: "https://fa.brandonvalley.k12.sd.us/Student/web/fwemnu01.w" },
    { label: "Lunch account", note: "LINQ Connect", url: "https://linqconnect.com/" },
    { label: "Free and reduced meals", note: "Apply any time of year through Child Nutrition", url: `${SITE}/ChildNutrition/` },
    { label: "Bus routes", note: "Transportation office 605-582-3514", url: `${SITE}/Transportation/` },
    { label: "Closings and delays", note: "KELOLAND closings list", url: "https://www.keloland.com/weather/closings/" },
    { label: "Counseling", note: "High school counseling site", url: "https://sites.google.com/k12.sd.us/bvhscounseling/home" },
    { label: "Course book", note: "Registration on the counseling site", url: "https://sites.google.com/k12.sd.us/bvhscounseling/home" },
    { label: "Graduation requirements", note: "In the high school handbook", url: `${DOCS}/Handbooks/@HighSchoolHandbook.pdf` },
  ];

  // 2026-27 district calendar (adopted 2026-01-26). `grades` limits an entry
  // to a level. kind: noschool | break | first | last | quarter | tests |
  // conferences | grad | early
  const ES = [-1, 0, 1, 2, 3, 4], IS = [5, 6], MS = [7, 8], HS = [9, 10, 11, 12];
  const DISTRICT_2026_27 = [
    { d: "2026-08-26", kind: "first", title: "First day of school" },
    { d: "2026-09-07", kind: "noschool", title: "No school: Labor Day" },
    { d: "2026-10-05", kind: "conferences", title: "Parent-teacher conferences, 3:30 to 9:30 PM (regular dismissal)", grades: ES.concat(HS) },
    { d: "2026-10-06", kind: "conferences", title: "Parent-teacher conferences, 3:30 to 9:30 PM (regular dismissal)", grades: IS.concat(MS) },
    { d: "2026-10-09", kind: "noschool", title: "No school: Comp day" },
    { d: "2026-10-12", kind: "noschool", title: "No school: Staff in-service" },
    { d: "2026-10-28", kind: "quarter", title: "End of first quarter" },
    { d: "2026-11-11", kind: "noschool", title: "No school: Veterans Day" },
    { d: "2026-11-25", to: "2026-11-27", kind: "break", title: "Thanksgiving break" },
    { d: "2026-12-22", kind: "early", title: "Two-hour early dismissal" },
    { d: "2026-12-23", to: "2027-01-01", kind: "break", title: "Winter break" },
    { d: "2027-01-14", kind: "quarter", title: "End of second quarter" },
    { d: "2027-01-15", kind: "noschool", title: "No school: Staff workshop" },
    { d: "2027-01-18", kind: "noschool", title: "No school: Martin Luther King Jr. Day" },
    { d: "2027-02-12", kind: "noschool", title: "No school" },
    { d: "2027-02-15", kind: "noschool", title: "No school: Presidents Day" },
    { d: "2027-03-15", kind: "conferences", title: "Parent-teacher conferences, 3:30 to 9:30 PM (regular dismissal)", grades: IS.concat(MS) },
    { d: "2027-03-16", kind: "conferences", title: "Parent-teacher conferences, 3:30 to 9:30 PM (regular dismissal)", grades: ES.concat(HS) },
    { d: "2027-03-18", kind: "noschool", title: "No school: Snow day (if unused)" },
    { d: "2027-03-19", kind: "noschool", title: "No school: Comp day" },
    { d: "2027-03-25", kind: "quarter", title: "End of third quarter" },
    { d: "2027-03-25", kind: "early", title: "Two-hour early dismissal" },
    { d: "2027-03-26", to: "2027-03-29", kind: "break", title: "Spring break" },
    { d: "2027-05-09", kind: "grad", title: "Graduation", grades: [12] },
    { d: "2027-05-27", kind: "last", title: "Last day of school (two-hour early dismissal)" },
    { d: "2027-05-31", kind: "noschool", title: "No school: Memorial Day" },
  ];
  // 2027-28: add when the board adopts it (usually January).
  const DISTRICT_2027_28 = [];

  // Every published year, in order. The app picks the year a date falls in.
  const SCHOOL_YEARS = [
    { id: "2026-27", first: "2026-08-26", last: "2027-05-27",
      graduation: { d: "2027-05-09", venue: null, times: { bvhs: null } } },
  ];
  const DISTRICT_CALENDAR = DISTRICT_2026_27.concat(DISTRICT_2027_28);

  // Grade guide. Dates are absolute (2026-27) so the Guide can show what is
  // coming next; undated items are standing advice for that grade.
  // `link` keys point at DISTRICT_LINKS labels, "supplies", "handbook:<section>"
  // or full URLs. `action` is follow | college | calendar.
  const PERMIT = "https://www.sd.gov/dps?id=cs_kb_article_view&sysparm_article=KB0043735";
  const OSP = "https://ourdakotadreams.com/k12-students/opportunity-scholarship/";
  const GUIDE = {
    9: {
      headline: "Freshman year sets the GPA",
      intro: "Grades count toward graduation and scholarships from the first semester of 9th grade.",
      todo: [
        { id: "sky", text: "Set up Skyward Family Access and check grades and attendance there", link: "Skyward Family Access" },
        { id: "plan", text: "Meet the counselor and sketch a four-year class plan", link: "Counseling" },
        { id: "act", text: "Pick one club or activity to try this year", action: "follow" },
        { id: "permit", text: "Instruction permit: South Dakota teens can apply at 14", link: PERMIT },
      ],
      facts: [
        { title: "Graduation requirements", body: "South Dakota's base diploma is 22 credits, including 4 English, 3 math, 3 science and 3 social studies. Brandon Valley's own requirements are in the high school handbook.", link: "handbook:MINIMUM GRADUATION REQUIREMENTS" },
        { title: "Plan for the Opportunity Scholarship now", body: "The state scholarship pays $1,500 a year for three years and $3,000 in the fourth. One path requires 4 English, 4 math, 4 science, 3 social studies, 1 fine arts and 2 world language or career-tech units, with no grade below C.", link: OSP },
      ],
    },
    10: {
      headline: "Sophomore year opens doors",
      intro: "The year to try the PSAT, look at career-tech options and plan dual credit for junior year.",
      todo: [
        { id: "psat", text: "Ask whether your student is taking the PSAT in October" },
        { id: "course", text: "Look through the course offerings before spring registration", link: "Course book" },
        { id: "cte", text: "Ask the counselor about career-tech options and dual credit for next year", link: "Counseling" },
        { id: "drive", text: "Driver's ed and the restricted minor's permit", link: PERMIT },
        { id: "act", text: "Keep one activity going, or try a new one", action: "follow" },
      ],
      facts: [
        { title: "Restricted minor's permit", body: "After holding an instruction permit for 275 days (about nine months) with a clean record and passing the driving test. Driver's ed shortens the wait.", link: PERMIT },
        { title: "Opportunity Scholarship coursework", body: "Staying on track means 4 years each of English, math and science. Check the plan each spring.", link: OSP },
      ],
    },
    11: {
      headline: "Junior year is testing year",
      intro: "PSAT in October, ACT in the spring, and college visits all year.",
      todo: [
        { id: "psat", text: "PSAT/NMSQT in October (National Merit qualifying year)" },
        { id: "act", text: "Plan the ACT: the Opportunity Scholarship needs a 24 or higher", link: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html" },
        { id: "visits", text: "Sign up for college visits through the counseling office", action: "college" },
        { id: "dual", text: "Dual credit: college classes for high school and college credit at a reduced rate", link: "https://sdbor.edu/cost-aid/dual-credit/" },
        { id: "course", text: "Choose senior-year classes before spring registration", link: "Course book" },
      ],
      facts: [
        { title: "Opportunity Scholarship", body: "ACT 24 or higher, a 3.0 GPA and the required courses with no grade below C. Or an ACT of 28 with the college readiness benchmarks and no course requirement.", link: OSP },
        { title: "Dual credit", body: "South Dakota high schoolers pay about $80 per credit hour at the state universities, roughly half the regular rate; the state covers the rest. The credit counts in high school and college.", link: "https://sdbor.edu/cost-aid/dual-credit/" },
      ],
    },
    12: {
      headline: "Senior year, start to finish",
      intro: "Applications and financial aid in the fall, scholarships in winter, graduation in May.",
      todo: [
        { id: "fafsa", text: "File the FAFSA as soon as it opens in the fall", link: "https://studentaid.gov/h/apply-for-aid/fafsa" },
        { id: "apps", text: "Finish college or tech school applications" },
        { id: "aid", text: "Go to a financial aid night at school", action: "college" },
        { id: "build", text: "Build Dakota Scholarship: applications open January 1 and close March 31", link: "https://www.builddakotascholarships.com/" },
        { id: "osp", text: "Confirm Opportunity Scholarship eligibility with the counselor", link: OSP },
        { id: "transcript", text: "Ask the school for final transcripts to send to your student's college", link: "handbook:TRANSCRIPTS" },
      ],
      facts: [
        { title: "Build Dakota Scholarship", body: "A full ride at a South Dakota technical college in a high-demand field, in return for three years of work in the state after graduation.", link: "https://www.builddakotascholarships.com/" },
        { title: "FAFSA first", body: "Most scholarships and all federal aid start with the FAFSA. File early: some aid is first come, first served.", link: "https://studentaid.gov/h/apply-for-aid/fafsa" },
      ],
    },
  };

  // Junior kindergarten through 8th grade. Facts from the 2026-27 handbooks
  // and the district calendar.
  const GUIDE_K8 = {
    "-1": {
      headline: "Junior kindergarten: the first school year",
      intro: "Half-day sessions, 8:10 to 11:00 or 12:10 to 3:00. The first weeks are about routines: drop-off, snack and the classroom.",
      todo: [
        { id: "sky", text: "Set up Skyward Family Access to see attendance and contact the school", link: "Skyward Family Access" },
        { id: "pickup", text: "Tell the office who may pick your child up, and send a note when it changes" },
        { id: "supplies", text: "Check the supply list", link: "supplies" },
      ],
      facts: [
        { title: "Absences", body: "Call the office by 8:30 AM when your child will be out." },
        { title: "Conferences", body: "Elementary conferences are October 5 and March 16, 3:30 to 9:30 PM, with regular dismissal those days." },
      ],
    },
    0: {
      headline: "Kindergarten, day one to May",
      intro: "Full days, 8:10 to 3:00. Doors open at 7:30 with breakfast available; the first bell is 8:00.",
      todo: [
        { id: "sky", text: "Set up Skyward Family Access to see attendance and contact the school", link: "Skyward Family Access" },
        { id: "lunch", text: "Put money on the lunch account in LINQ Connect, or apply for free meals", link: "Lunch account" },
        { id: "pickup", text: "Tell the office who may pick your child up, and send a note when it changes" },
        { id: "supplies", text: "Check the supply list", link: "supplies" },
      ],
      facts: [
        { title: "Who can start kindergarten", body: "Children who turn five on or before September 1 can start kindergarten that fall. Registration for next year opens in the spring." },
        { title: "Breakfast and lunch", body: "Breakfast is $2.40 and starts at 7:30. Lunch is $3.50, milk alone $0.65. Breakfast is not served on a two-hour late start." },
      ],
    },
    1: {
      headline: "1st and 2nd grade: reading takes off",
      intro: "Reading, writing and math facts build every week. Conferences in October and March are the best time to ask how it's going.",
      todo: [
        { id: "sky", text: "Check attendance and messages in Skyward Family Access", link: "Skyward Family Access" },
        { id: "conf", text: "Put both conference evenings on your calendar", action: "calendar" },
        { id: "supplies", text: "Check the supply list", link: "supplies" },
      ],
      facts: [
        { title: "Medicine at school", body: "Medicine, prescription or not, goes through the office with a parent's written permission. Ask the school nurse about anything your child takes during the day." },
        { title: "Weather days", body: "On a two-hour late start the first bell is 10:00 and breakfast is not served. On a two-hour early dismissal, elementary lets out at 1:00." },
      ],
    },
    3: {
      headline: "3rd and 4th grade: more independence",
      intro: "Longer projects, state testing in the spring, and the last two years in the elementary building.",
      todo: [
        { id: "sky", text: "Watch grades and attendance in Skyward Family Access", link: "Skyward Family Access" },
        { id: "conf", text: "Put both conference evenings on your calendar", action: "calendar" },
        { id: "supplies", text: "Check the supply list", link: "supplies" },
        { id: "next", text: "4th graders: the Intermediate School is next. Watch for its spring visit and registration." },
      ],
      facts: [
        { title: "State testing", body: "South Dakota's state assessment runs in the spring for grades 3 and up. The school sends dates; a normal night's sleep and breakfast matter more than studying." },
        { title: "Phones and smartwatches", body: "Phones and smartwatches stay off and in backpacks during the school day." },
      ],
    },
    5: {
      headline: "5th and 6th grade: the Intermediate School",
      intro: "A new building for grades 5 and 6, 8:05 to 3:05. Teams of teachers, lockers, and the first activities.",
      todo: [
        { id: "sky", text: "Watch grades and attendance in Skyward Family Access", link: "Skyward Family Access" },
        { id: "act", text: "Try an activity: the Intermediate School has its first teams and clubs", action: "follow" },
        { id: "supplies", text: "Check the supply list", link: "supplies" },
        { id: "conf", text: "Conferences for the Intermediate School are October 6 and March 15", action: "calendar" },
      ],
      facts: [
        { title: "Arrival", body: "Supervision starts at 7:45 and classes start at 8:05. Dismissal is 3:05." },
        { title: "Absences", body: "Call or email the office by 8:30 AM." },
      ],
    },
    7: {
      headline: "7th and 8th grade: the Middle School",
      intro: "Nine periods, 8:05 to 3:10, and sports and activities that lead into high school.",
      todo: [
        { id: "sky", text: "Watch grades and attendance in Skyward Family Access", link: "Skyward Family Access" },
        { id: "act", text: "Follow your student's teams and activities for schedules and changes", action: "follow" },
        { id: "physical", text: "Sports need a physical on file before the first practice; ask the office which form" },
        { id: "supplies", text: "Check the supply list", link: "supplies" },
        { id: "hs", text: "8th graders: high school course registration happens in the spring. Watch for the parent night." },
      ],
      facts: [
        { title: "Absences", body: "Email BrandonValleyMiddleSchoolAttendance@k12.sd.us or call 605-582-3214 by 8:30 AM." },
        { title: "Phones", body: "Phones are off and in lockers by 8:00 and stay there until the end of the day." },
        { title: "Lunch", body: "Lunch is $3.75. The middle school has a closed noon hour." },
      ],
    },
  };
  GUIDE_K8[2] = GUIDE_K8[1];
  GUIDE_K8[4] = GUIDE_K8[3];
  GUIDE_K8[6] = GUIDE_K8[5];
  GUIDE_K8[8] = GUIDE_K8[7];
  Object.assign(GUIDE, GUIDE_K8);

  // What every family should know, by level, from the 2026-27 handbooks
  // (shown under "Good to know" on the School tab and used by Ask).
  const LEVEL_INFO = {
    es: {
      policies: [
        { title: "School hours", body: "First bell 8:00, tardy bell 8:10, dismissal 3:00. Supervision starts at 7:30, when breakfast is served." },
        { title: "Absences", body: "Call the office by 8:30 AM when your child will be absent or late." },
        { title: "Weather days", body: "A two-hour late start means a 10:00 first bell and no breakfast. A two-hour early dismissal ends the day at 1:00; buses run their regular routes at the early time." },
        { title: "Medicine at school", body: "Medicine goes through the office with a parent's written permission. Talk with the school nurse about anything your child takes during the day." },
        { title: "Phones and smartwatches", body: "Off and in the backpack during the school day." },
      ],
      costs: [{ what: "Lunch", cost: "$3.50; breakfast $2.40; milk alone $0.65. Free or reduced for families who qualify" }],
      care: null,
    },
    is: {
      policies: [
        { title: "School hours", body: "Classes start at 8:05 and dismissal is 3:05. Supervision starts at 7:45." },
        { title: "Absences", body: "Call or email the office by 8:30 AM." },
        { title: "Phones", body: "Phones stay off and in lockers during the school day." },
        { title: "Treats", body: "No home-baked goods for class treats; store-bought only." },
      ],
      costs: [{ what: "Lunch", cost: "$3.50; breakfast $2.40; milk alone $0.65. Free or reduced for families who qualify" }],
      care: null,
    },
    ms: {
      policies: [
        { title: "School hours", body: "8:05 to 3:10. The building opens at 7:30; students stay in the commons until 7:45, and phones are off and in lockers by 8:00." },
        { title: "Absences", body: "Email BrandonValleyMiddleSchoolAttendance@k12.sd.us or call 605-582-3214 by 8:30 AM." },
        { title: "Weather days", body: "A two-hour late start begins at 10:05. A two-hour early dismissal ends at 1:10. No homeroom on either." },
        { title: "Sports and activities", body: "A physical on file before the first practice. The Activities handbook covers eligibility and conduct." },
        { title: "Lunch", body: "Closed noon hour. Lunch is $3.75." },
      ],
      costs: [{ what: "Lunch", cost: "$3.75; breakfast $2.40; milk alone $0.65. Free or reduced for families who qualify" }],
      care: null,
    },
  };

  // National test dates for 2026-27 (act.org, satsuite.collegeboard.org,
  // checked 2026-10-02). Facts only; register on their sites.
  const TEST_DATES = [
    { test: "ACT", d: "2026-09-19", reg: "2026-08-14", late: "2026-09-01" },
    { test: "ACT", d: "2026-10-17", reg: "2026-09-11", late: "2026-09-29" },
    { test: "ACT", d: "2026-12-12", reg: "2026-11-06", late: "2026-11-29" },
    { test: "ACT", d: "2027-02-27", reg: "2027-01-22", late: "2027-02-09" },
    { test: "ACT", d: "2027-04-10", reg: "2027-03-05", late: "2027-03-23" },
    { test: "ACT", d: "2027-06-12", reg: "2027-05-07", late: "2027-05-25" },
    { test: "ACT", d: "2027-07-10", reg: "2027-06-04", late: "2027-06-22" },
    { test: "SAT", d: "2026-10-03", reg: "2026-09-18", late: "2026-09-22" },
    { test: "SAT", d: "2026-11-07", reg: "2026-10-23", late: "2026-10-27" },
    { test: "SAT", d: "2026-12-05", reg: "2026-11-20", late: "2026-11-24" },
    { test: "SAT", d: "2027-03-06", reg: "2027-02-19", late: "2027-02-23" },
    { test: "SAT", d: "2027-05-01", reg: "2027-04-16", late: "2027-04-20" },
    { test: "SAT", d: "2027-06-05", reg: "2027-05-21", late: "2027-05-25" },
  ];
  // Dated deadlines by grade (shared.deadlinesFor adds ACT/SAT registration).
  // Shown on Today two weeks ahead and in the 7 PM heads-up the day before.
  // Update each year with the course registration and scholarship dates.
  const DEADLINES = [
    { d: "2026-10-01", g: [12], key: "The FAFSA opens for next year's college aid", url: "https://studentaid.gov/h/apply-for-aid/fafsa" },
    { d: "2027-01-01", g: [12], key: "Build Dakota Scholarship applications open", url: "https://www.builddakotascholarships.com/" },
    { d: "2027-03-31", g: [12], key: "Last day to apply for the Build Dakota Scholarship", url: "https://www.builddakotascholarships.com/" },
    { d: "2027-10-01", g: [12], key: "The FAFSA opens for next year's college aid", url: "https://studentaid.gov/h/apply-for-aid/fafsa" },
  ];
  const TEST_LINKS = { ACT: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html", SAT: "https://satsuite.collegeboard.org/sat/dates-deadlines" };

  // SDHSAA state championships 2026-27 (sdhsaa.com activity pages, checked
  // 2026-10-02; Class AA where it differs). `acts` match followed activities.
  const STATE_EVENTS = [
    { acts: /^Boys Golf/, d: "2026-10-05", to: "2026-10-06", title: "State boys golf (AA)", venue: "Lee Park, Aberdeen" },
    { acts: /^Girls Tennis/, d: "2026-10-08", to: "2026-10-09", title: "State girls tennis (AA)", venue: "Rapid City" },
    { acts: /Soccer/, d: "2026-10-17", title: "State soccer championships", venue: "Watertown" },
    { acts: /^Competitive (Cheer|Dance)/, d: "2026-10-23", to: "2026-10-24", title: "State competitive cheer and dance", venue: "The Monument, Rapid City" },
    { acts: /Cross Country/, d: "2026-10-24", title: "State cross country", venue: "Hart Ranch, Rapid City" },
    { acts: /^(Chorus|Orchestra)$/, d: "2026-10-31", title: "All-State Chorus and Orchestra", venue: "The Monument, Rapid City" },
    { acts: /^Football$/, d: "2026-11-12", to: "2026-11-14", title: "State football championships", venue: "DakotaDome, Vermillion" },
    { acts: /^Volleyball$/, d: "2026-11-19", to: "2026-11-21", title: "State volleyball", venue: "PREMIER Center, Sioux Falls", map: "Denny Sanford PREMIER Center, Sioux Falls, SD" },
    { acts: /^Oral Interpretation$/, d: "2026-12-04", to: "2026-12-05", title: "State oral interpretation", venue: "Pierre" },
    { acts: /^One-Act Play$/, d: "2027-02-04", to: "2027-02-06", title: "State one-act play festival", venue: "Mitchell" },
    { acts: /^Gymnastics$/, d: "2027-02-12", to: "2027-02-13", title: "State gymnastics", venue: "Aberdeen Central", map: "Aberdeen Central High School, Aberdeen, SD" },
    { acts: /Wrestling/, d: "2027-02-25", to: "2027-02-27", title: "State wrestling", venue: "The Monument, Rapid City" },
    { acts: /^Debate/, d: "2027-03-05", to: "2027-03-06", title: "State debate and individual events", venue: "Huron" },
    { acts: /^Girls Basketball$/, d: "2027-03-11", to: "2027-03-13", title: "State girls basketball (AA)", venue: "Sanford Pentagon, Sioux Falls" },
    { acts: /^Boys Basketball$/, d: "2027-03-18", to: "2027-03-20", title: "State boys basketball (AA)", venue: "PREMIER Center, Sioux Falls", map: "Denny Sanford PREMIER Center, Sioux Falls, SD" },
    { acts: /^(Band|Marching Band)$/, d: "2027-04-03", title: "All-State Band", venue: "Jefferson High School, Sioux Falls" },
    { acts: /^(Jazz Band|Show Choir)$/, d: "2027-05-08", title: "All-State Jazz Band and Show Choir", venue: "Mitchell Performing Arts Center, Mitchell" },
    { acts: /^Boys Tennis$/, d: "2027-05-20", to: "2027-05-21", title: "State boys tennis (AA)", venue: "Sioux Falls" },
    { acts: /Track/, d: "2027-05-27", to: "2027-05-29", title: "State track and field", venue: "Howard Wood Field, Sioux Falls" },
    { acts: /^Softball$/, d: "2027-06-03", to: "2027-06-05", title: "State softball (AA)", venue: "Bowden Field, Augustana", map: "Bowden Field, Augustana University, Sioux Falls, SD" },
    { acts: /^Girls Golf$/, d: "2027-06-07", to: "2027-06-08", title: "State girls golf (AA)", venue: "Spearfish Canyon", map: "Spearfish, SD" },
  ];

  // What things cost (district handbook, 2026-27).
  const COSTS = {
    district: [
      { what: "Breakfast", cost: "$2.40 at every school, served from 7:30" },
      { what: "Lunch", cost: "K-6 $3.50, 7-8 $3.75, 9-12 $3.85; milk alone $0.65. Free or reduced for families who qualify" },
      { what: "Low balance", cost: "An email goes out when a lunch account is under $15; a letter at -$25" },
    ],
    bvhs: [],
  };
  // South Dakota requires a sports physical every three years; Brandon
  // Valley's own rule is in the Activities handbook. Nothing to date here.
  const PHYSICALS = null;

  const SFDATA = { DISTRICT, LEVEL_INFO, DEADLINES, SCHOOLS, DISTRICT_LINKS, DISTRICT_CALENDAR, SCHOOL_YEARS, GUIDE, TEST_DATES, TEST_LINKS, STATE_EVENTS, COSTS, PHYSICALS };
  // Browser: window.SFDATA. Netlify functions: require("../../data.js").
  if (typeof module !== "undefined" && module.exports) module.exports = SFDATA;
  else self.SFDATA = SFDATA;
})();

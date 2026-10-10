/* Brandon Valley's bell schedules, attendance steps, lunch notes and the
 * rules parents ask about, by level, from the district's 2026-27 handbooks
 * and each school's posted bell schedule. The full handbooks are read into
 * the app live (School tab, "Student handbook"); this file holds what the
 * Today card and the School tab need at a glance. The scheduled sync
 * fingerprints the PDFs daily and flags a new version. */
(() => {
  const DOCS = "https://brandonvalley.k12.sd.us/district%20documents/Handbooks";
  const row = (label, start, end) => ({ label, start, end });

  const elementary = {
    year: "2026-27",
    schedules: [
      { name: "Regular day", note: "Supervision starts at 7:30, when breakfast is served.", rows: [row("First bell", "8:00", ""), row("Tardy bell", "8:10", ""), row("Dismissal", "", "3:00")] },
      { name: "2 hour late start", note: "No breakfast on a late start.", rows: [row("First bell", "10:00", ""), row("Tardy bell", "10:10", ""), row("Dismissal", "", "3:00")] },
      { name: "Early release", note: "Buses run their regular routes at the early time.", rows: [row("First bell", "8:00", ""), row("Tardy bell", "8:10", ""), row("Dismissal", "", "1:00")] },
    ],
    lunch: "Lunch is $3.50 and breakfast $2.40; milk alone is $0.65. Breakfast is served from 7:30. Students eat in the school cafeteria.",
    attendance: { phone: null, email: null, howTo: "Call the office by 8:30 AM when your child will be absent or late. If the school isn't told, the office calls home." },
    contacts: [],
    policies: [
      { title: "School hours", body: "First bell 8:00, tardy bell 8:10, dismissal 3:00. Supervision starts at 7:30, when breakfast is served." },
      { title: "Absences", body: "Call the office by 8:30 AM when your child will be absent or late." },
      { title: "Weather days", body: "A two-hour late start means a 10:00 first bell and no breakfast. A two-hour early dismissal ends the day at 1:00; buses run their regular routes at the early time." },
      { title: "Medicine at school", body: "Medicine goes through the office with a parent's written permission. Talk with the school nurse about anything your child takes during the day." },
      { title: "Phones and smartwatches", body: "Off and in the backpack during the school day." },
    ],
    source: `${DOCS}/@ElementaryHandbook.pdf`,
  };

  const intermediate = {
    year: "2026-27",
    schedules: [
      { name: "Regular day", note: "Supervision starts at 7:45. Period times are on each team's page.", rows: [row("Classes start", "8:05", ""), row("Dismissal", "", "3:05")] },
      { name: "2 hour late start", rows: [row("Classes start", "10:05", ""), row("Dismissal", "", "3:05")] },
      { name: "Early release", rows: [row("Classes start", "8:05", ""), row("Dismissal", "", "1:05")] },
    ],
    lunch: "Lunch is $3.50 and breakfast $2.40; milk alone is $0.65. Breakfast is served from 7:30.",
    attendance: { phone: null, email: null, howTo: "Call or email the office by 8:30 AM when your student will be absent." },
    contacts: [],
    policies: [
      { title: "School hours", body: "Classes start at 8:05 and dismissal is 3:05. Supervision starts at 7:45." },
      { title: "Absences", body: "Call or email the office by 8:30 AM." },
      { title: "Phones", body: "Phones stay off and in lockers during the school day." },
      { title: "Treats", body: "No home-baked goods for class treats; store-bought only." },
    ],
    source: `${DOCS}/@IntermediateHandbook.pdf`,
  };

  const middle = {
    year: "2026-27",
    schedules: [
      { name: "Regular day", note: "Lunch falls in periods 4 to 6 by grade, each after a 13-minute homeroom. Periods 8 and 9 split by grade (7th grade class, 8th grade enrichment, then the reverse).", rows: [
        row("Period 1", "8:05", "8:55"), row("Period 2", "8:58", "9:44"), row("Period 3", "9:47", "10:33"), row("Period 4", "10:36", "11:22"),
        row("Period 5", "11:25", "12:11"), row("Period 6", "12:14", "1:00"), row("Period 7", "1:03", "1:49"), row("Period 8", "1:52", "2:38"), row("Period 9", "2:41", "3:10"),
      ] },
      { name: "2 hour late start", note: "No homeroom.", rows: [row("Classes start", "10:05", ""), row("Dismissal", "", "3:10")] },
      { name: "Early release", note: "No homeroom.", rows: [row("Period 1", "8:05", ""), row("Dismissal", "", "1:10")] },
    ],
    lunch: "Lunch is $3.75 and breakfast $2.40; milk alone is $0.65. The middle school has a closed noon hour: students stay on campus for lunch.",
    attendance: { phone: "605-582-3214", email: "BrandonValleyMiddleSchoolAttendance@k12.sd.us", howTo: "Email the attendance office or call 605-582-3214 by 8:30 AM when your student will be absent." },
    contacts: [],
    policies: [
      { title: "School hours", body: "8:05 to 3:10. The building opens at 7:30; students stay in the commons until 7:45, and phones are off and in lockers by 8:00." },
      { title: "Absences", body: "Email BrandonValleyMiddleSchoolAttendance@k12.sd.us or call 605-582-3214 by 8:30 AM." },
      { title: "Weather days", body: "A two-hour late start begins at 10:05. A two-hour early dismissal ends at 1:10. No homeroom on either." },
      { title: "Sports and activities", body: "A physical on file before the first practice. The Activities handbook covers eligibility and conduct." },
      { title: "Lunch", body: "Closed noon hour. Lunch is $3.75." },
    ],
    source: `${DOCS}/@MiddleSchoolHandbook.pdf`,
  };

  const high = {
    year: "2026-27",
    schedules: [
      { name: "Regular day", note: "Announcements and the pledge in period 3. TEAM time falls at 10:48, 11:42 and 1:06 on different days.", rows: [
        row("Zero period", "7:11", "8:00"), row("Period 1", "8:05", "8:54"), row("Period 2", "8:59", "9:48"), row("Period 3", "9:53", "10:43"), row("Period 4", "10:48", "11:37"),
        row("Period 5", "11:42", "12:31"), row("Period 6", "12:36", "1:25"), row("Period 7", "1:30", "2:19"), row("Period 8", "2:24", "3:14"),
      ] },
      { name: "2 hour late start", note: "No zero period. Periods run 1, 2, 4, 5, 6, 3, 7, then periods 0 and 8 together from 2:38.", rows: [row("Period 1", "10:05", ""), row("Periods 0 and 8", "2:38", "3:14")] },
      { name: "Early release", note: "Periods run 1, 2, 3, 7, 4, 5, 6, 8.", rows: [row("Zero period", "7:26", "8:00"), row("Period 1", "8:05", ""), row("Dismissal", "", "1:14")] },
    ],
    lunch: "Lunch is $3.85 and breakfast $2.40; milk alone is $0.65. The high school has a closed noon hour: students stay on campus for lunch.",
    attendance: { phone: "605-582-3211", email: null, howTo: "A parent calls the office by 9:00 AM on the day of the absence; after that the office calls home, and an unreported absence is unexcused. Medical and counseling notes are due within one week of the appointment." },
    contacts: [],
    policies: [
      { title: "Building hours", body: "Regular building hours are 7:30 AM to 3:45 PM; doors lock at 4:45 PM. Visitors use the west office doors between 8:05 AM and 3:20 PM." },
      { title: "Absences", body: "Call the office by 9:00 AM on the day of the absence. Planned absences (family trips, school events) have work completed beforehand unless the teacher says otherwise. Medical notes are due within a week." },
      { title: "Weather days", body: "A two-hour late start runs 10:05 to 3:14 with no zero period. An early release ends at 1:14." },
      { title: "Graduation and honors", body: "To take part in graduation a student has met all state and district requirements, attended practice and paid all fines and fees. Seniors with a GPA of 3.70 or higher are honor graduates." },
      { title: "Sports and activities", body: "A physical on file before the first practice. The Activities handbook covers eligibility, conduct and the activity pass." },
    ],
    source: `${DOCS}/@HighSchoolHandbook.pdf`,
  };

  const SFHANDBOOKS = { bes: elementary, bve: elementary, fae: elementary, ies: elementary, rbe: elementary, bvis: intermediate, bvms: middle, bvhs: high };
  if (typeof module !== "undefined" && module.exports) module.exports = SFHANDBOOKS;
  else self.SFHANDBOOKS = SFHANDBOOKS;
})();

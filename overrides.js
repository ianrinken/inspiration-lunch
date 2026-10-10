/* Corrections to the schools' own calendars, applied before anything
 * reaches a parent (the app and subscribed calendars alike). Edit, deploy,
 * done. Matches are case-insensitive and test the event title.
 *
 *   hide:   events to drop entirely (staff-only entries the filters miss)
 *   grades: who an event is for, overriding the automatic guess.
 *           grades: [] means everyone; [11, 12] means juniors and seniors.
 *   rename: show a clearer title
 */
(() => {
  const OVERRIDES = {
    hide: [
      // "Weightlifting - Offseason Sports",
    ],
    grades: [
      // { match: "Booster Club", grades: [] },
    ],
    rename: [
      // { match: "^ACT$", to: "ACT test day" },
    ],
  };
  if (typeof module === "object" && module.exports) module.exports = OVERRIDES;
  else self.SFOVERRIDES = OVERRIDES;
})();

/* Brandon Valley Lunch · Google Calendar mirror
 *
 * Google's phone apps can't subscribe to a calendar feed by link. The one
 * thing they add in a single tap is a Google Calendar. So this script,
 * running in the site owner's Google account, keeps one public Google
 * Calendar per grade (school-wide plus that grade's events) and one per
 * activity, filled from brandonvalleylunch.com's own feeds, and tells the
 * site their ids. The app then offers "Add to Google Calendar".
 *
 * Setup, once:
 *   1. script.google.com → New project → paste this whole file over the
 *      starter code → save.
 *   2. Put the site's secret in SECRET below (the site refuses reports
 *      without it).
 *   3. In the left column, next to Services, press + → pick
 *      "Google Calendar API" → Add. (The script talks to Calendar through
 *      it; the name it gets, "Calendar", must stay as is.)
 *   4. Pick "setup" in the toolbar's function menu → Run → allow access
 *      (Calendar and "connect to an external service").
 * It then runs itself every hour. The calendars sit in the owner's Google
 * Calendar list hidden and unchecked; the app shows them to parents.
 *
 * Handy: run "status" to log what's been built; "resync" to rebuild every
 * calendar's events on the next runs.
 */

var SITE = "https://brandonvalleylunch.com";
var SECRET = "PASTE_THE_SECRET_HERE";
var TZ = "America/Chicago";
var BUDGET_MS = 270000;   // stop at 4.5 min; Google ends a run at 6
var NEW_PER_RUN = 10;     // Google rate-limits creating calendars

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sync").timeBased().everyHours(1).create();
  sync();
}

function sync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  var started = Date.now();
  try {
    var props = PropertiesService.getScriptProperties();
    var all = props.getProperties();
    var wanted = JSON.parse(UrlFetchApp.fetch(SITE + "/.netlify/functions/mirror?list=1").getContentText()).calendars;
    if (!wanted || !wanted.length) return;

    // Calendars that don't exist yet, a few per run.
    var created = 0;
    for (var c = 0; c < wanted.length && created < NEW_PER_RUN; c++) {
      var w = wanted[c];
      if (all["id:" + w.key]) continue;
      try {
        var newId = createCalendar(w.name);
        all["id:" + w.key] = newId;
        props.setProperty("id:" + w.key, newId);
        created++;
      } catch (e) {
        Logger.log("create " + w.key + ": " + e);
        if (/limit|quota|too many/i.test(String(e))) break;
      }
    }
    // Make each one public (retried on later runs until it sticks).
    wanted.forEach(function (w) {
      var id = all["id:" + w.key];
      if (!id || all["pub:" + w.key]) return;
      try {
        makePublic(id);
        all["pub:" + w.key] = "1";
        props.setProperty("pub:" + w.key, "1");
      } catch (e) { Logger.log("public " + w.key + ": " + e); }
    });

    // Every feed at once; only the ones that changed get applied.
    var have = wanted.filter(function (w) { return !!all["id:" + w.key]; });
    var feeds = fetchFeeds(have.map(function (w) { return w.feed; }));
    var changed = [];
    have.forEach(function (w, i) {
      var text = feeds[i];
      if (text === null) return;
      var h = fingerprint(text);
      if (all["h:" + w.key] !== h) changed.push({ w: w, text: text, h: h });
    });

    // Apply in order, carrying on from where the last run stopped.
    var start = Number(all.cursor || 0) % wanted.length;
    var cursor = 0, ranOut = false, applied = 0;
    changed.sort(function (a, b) {
      var ia = (wanted.indexOf(a.w) - start + wanted.length) % wanted.length;
      var ib = (wanted.indexOf(b.w) - start + wanted.length) % wanted.length;
      return ia - ib;
    });
    for (var n = 0; n < changed.length; n++) {
      var ch = changed[n];
      if (Date.now() - started > BUDGET_MS) { cursor = wanted.indexOf(ch.w); ranOut = true; break; }
      try {
        if (!applyFeed(all["id:" + ch.w.key], parseIcs(ch.text), started)) { cursor = wanted.indexOf(ch.w); ranOut = true; break; }
        all["h:" + ch.w.key] = ch.h;
        props.setProperty("h:" + ch.w.key, ch.h);
        applied++;
      } catch (e) {
        Logger.log("apply " + ch.w.key + ": " + e);
        if (/quota|dailyLimit|usageLimits/i.test(String(e))) { cursor = wanted.indexOf(ch.w); ranOut = true; break; }
      }
    }
    props.setProperty("cursor", String(ranOut ? cursor : 0));
    report(wanted, all);
    Logger.log("calendars " + have.length + "/" + wanted.length + ", created " + created + ", changed " + changed.length + ", applied " + applied + (ranOut ? ", more next run" : ""));
  } finally {
    lock.releaseLock();
  }
}

function createCalendar(name) {
  // Reuse one made by an earlier run that failed before saving its id, so
  // nothing piles up in the owner's list.
  var owned = CalendarApp.getCalendarsByName(name).filter(function (c) { return c.isOwnedByMe(); });
  var cal = owned.length ? owned[0] : CalendarApp.createCalendar(name, {
    timeZone: TZ, hidden: true, selected: false,
    summary: "Kept current by brandonvalleylunch.com",
  });
  return cal.getId();
}

// Public, read-only: anyone can add it, nobody can change it.
function makePublic(id) {
  withRetry(function () { Calendar.Acl.insert({ role: "reader", scope: { type: "default" } }, id); });
}

// All feeds in parallel, in gentle batches. null where a fetch failed.
function fetchFeeds(urls) {
  var out = [];
  for (var i = 0; i < urls.length; i += 30) {
    var batch = urls.slice(i, i + 30).map(function (u) { return { url: u, muteHttpExceptions: true }; });
    var results;
    try { results = UrlFetchApp.fetchAll(batch); }
    catch (e) { Logger.log("fetchAll: " + e); results = batch.map(function () { return null; }); }
    results.forEach(function (r) { out.push(r && r.getResponseCode() === 200 ? r.getContentText() : null); });
  }
  return out;
}

// What the feed says, minus the stamp it puts on every fetch.
function fingerprint(text) {
  return md5(text.replace(/^DTSTAMP:.*$/gm, ""));
}

function md5(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
}

function parseIcs(text) {
  var out = [], ev = null;
  text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/).forEach(function (line) {
    if (line === "BEGIN:VEVENT") { ev = {}; return; }
    if (line === "END:VEVENT") { if (ev && ev.uid && ev.start) out.push(ev); ev = null; return; }
    if (!ev) return;
    var i = line.indexOf(":");
    if (i < 0) return;
    var head = line.slice(0, i), val = line.slice(i + 1), name = head.split(";")[0];
    if (name === "UID") ev.uid = val;
    else if (name === "SUMMARY") ev.summary = unesc(val);
    else if (name === "LOCATION") ev.location = unesc(val);
    else if (name === "DESCRIPTION") ev.description = unesc(val);
    else if (name === "URL") ev.url = val;
    else if (name === "DTSTART") ev.start = when(head, val);
    else if (name === "DTEND") ev.end = when(head, val);
  });
  out.forEach(function (e) { if (!e.end) e.end = e.start; });
  return out;
}

function when(head, val) {
  if (/VALUE=DATE\b/.test(head) || /^\d{8}$/.test(val)) {
    return { date: val.slice(0, 4) + "-" + val.slice(4, 6) + "-" + val.slice(6, 8) };
  }
  var m = val.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)/);
  return { dateTime: m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6], timeZone: TZ };
}

function unesc(s) {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function toGoogle(e) {
  var desc = e.description || "";
  if (e.url) desc += (desc ? "\n\n" : "") + "Details: " + e.url;
  var body = { summary: e.summary || "(untitled)", start: e.start, end: e.end };
  if (e.location) body.location = e.location;
  if (desc) body.description = desc;
  body.extendedProperties = { private: { bvl: md5([body.summary, body.location, body.description, JSON.stringify(e.start), JSON.stringify(e.end)].join("|")) } };
  return body;
}

// Bring one calendar in line with its feed. false = out of time (the feed's
// fingerprint isn't saved, so the next run finishes the job).
function applyFeed(calId, feed, started) {
  var existing = {}, token = null;
  do {
    var opts = { maxResults: 2500, showDeleted: false, timeZone: TZ };
    if (token) opts.pageToken = token;
    var page = withRetry(function () { return Calendar.Events.list(calId, opts); });
    (page.items || []).forEach(function (it) { if (it.iCalUID) existing[it.iCalUID] = it; });
    token = page.nextPageToken;
  } while (token);

  for (var i = 0; i < feed.length; i++) {
    if (Date.now() - started > BUDGET_MS) return false;
    var e = feed[i], body = toGoogle(e), have = existing[e.uid];
    if (!have) {
      body.iCalUID = e.uid;
      withRetry(function () { Calendar.Events["import"](body, calId); });
    } else {
      var old = have.extendedProperties && have.extendedProperties["private"] && have.extendedProperties["private"].bvl;
      if (old !== body.extendedProperties["private"].bvl) {
        withRetry(function () { Calendar.Events.update(body, calId, have.id); });
      }
    }
    delete existing[e.uid];
  }
  // Whatever's left isn't in the feed any more. Inside the feed's window
  // that means it's gone (or moved to a new date, which gets a new UID);
  // older than the window it simply aged out, and stays as history.
  var windowStart = Utilities.formatDate(new Date(Date.now() - 14 * 86400000), TZ, "yyyy-MM-dd");
  var left = Object.keys(existing);
  for (var j = 0; j < left.length; j++) {
    if (Date.now() - started > BUDGET_MS) return false;
    var it = existing[left[j]];
    var d = ((it.start && (it.start.date || it.start.dateTime)) || "").slice(0, 10);
    if (d >= windowStart) withRetry(function () { Calendar.Events.remove(calId, it.id); });
  }
  return true;
}

// Google's momentary refusals (rate limit, backend hiccup) get a few
// tries with a pause; anything else is a real error.
function withRetry(fn) {
  for (var attempt = 0; ; attempt++) {
    try { return fn(); }
    catch (e) {
      var msg = String(e);
      var retry = /rate ?limit|backend|internal error|503|500|timed out/i.test(msg) && !/too many calendars|usageLimits|dailyLimit/i.test(msg);
      if (!retry || attempt >= 3) throw e;
      Utilities.sleep(1500 * Math.pow(2, attempt));
    }
  }
}

function report(wanted, all) {
  var calendars = {};
  wanted.forEach(function (w) {
    var id = all["id:" + w.key];
    if (id) calendars[w.key] = { id: id, name: w.name, synced: !!(all["h:" + w.key] && all["pub:" + w.key]) };
  });
  var res = UrlFetchApp.fetch(SITE + "/.netlify/functions/mirror", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ secret: SECRET, calendars: calendars }),
  });
  if (res.getResponseCode() !== 200) Logger.log("report: " + res.getResponseCode() + " " + res.getContentText());
}

function status() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var ids = 0, pub = 0, synced = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("id:") === 0) ids++;
    if (k.indexOf("pub:") === 0) pub++;
    if (k.indexOf("h:") === 0) synced++;
  });
  Logger.log("calendars created: " + ids + ", public: " + pub + ", filled: " + synced + ", cursor: " + (all.cursor || 0));
}

function resync() {
  var props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf("h:") === 0) props.deleteProperty(k); });
  props.setProperty("cursor", "0");
}

// Try every step once, out loud, on a single calendar.
function diagnose() {
  var wanted = JSON.parse(UrlFetchApp.fetch(SITE + "/.netlify/functions/mirror?list=1").getContentText()).calendars;
  Logger.log("site lists " + wanted.length + " calendars; first: " + wanted[0].name);
  var id = createCalendar(wanted[0].name);
  Logger.log("calendar id: " + id);
  makePublic(id);
  Logger.log("made public");
  var text = UrlFetchApp.fetch(wanted[0].feed).getContentText();
  var evs = parseIcs(text);
  Logger.log("feed has " + evs.length + " events; first: " + (evs[0] && evs[0].summary));
  var ok = applyFeed(id, evs.slice(0, 3), Date.now());
  Logger.log("wrote 3 events: " + ok);
  PropertiesService.getScriptProperties().setProperty("id:" + wanted[0].key, id);
  PropertiesService.getScriptProperties().setProperty("pub:" + wanted[0].key, "1");
}

/* calendar.js — Halachic flag engine.
 *
 * Faithful JS port of smart-siddur's halachic_calendar_service.dart, computed
 * over @hebcal/core (window.hebcal) instead of kosher_dart. Given a Gregorian
 * Date + a user context, it returns the full DayFlags object consumed by the
 * prayer assembler.
 *
 * Month numbering is IDENTICAL in kosher_dart and hebcal (Nisan=1 … Tishrei=7
 * … Adar=12, Adar II=13), so the dart month comparisons port verbatim.
 *
 * Yom-Tov identification: kosher_dart returns a single getYomTovIndex(); hebcal
 * returns an event list. We classify the events into a token Set and translate
 * each `if (yomTov == X)` into `yt.has('X')`.
 */
(function (global) {
  'use strict';

  var H = global.hebcal;
  var F = H.flags;
  var M = H.months; // NISAN=1 … TISHREI=7 … TEVET=10 … ADAR_I=12 ADAR_II=13

  // Canonical flag string constants — mirror of day_flags.dart DayFlag.
  var DF = {
    shabbat: 'shabbat', roshChodesh: 'rosh_chodesh', chanukah: 'chanukah',
    purim: 'purim', shushanPurim: 'shushan_purim', purimKatan: 'purim_katan',
    shushanPurimKatan: 'shushan_purim_katan', erevPurim: 'erev_purim',
    tuBishvat: 'tu_bishvat', pesachSheni: 'pesach_sheni',
    erevPesachSheni: 'erev_pesach_sheni', lagBaomer: 'lag_baomer', tuBav: 'tu_bav',
    erevRoshHashanah: 'erev_rosh_hashanah', roshHashanah: 'rosh_hashanah',
    asaretYemeiTeshuva: 'aseret_yemei_teshuva', erevYomKippur: 'erev_yom_kippur',
    yomKippur: 'yom_kippur', dayAfterYomKippur: 'day_after_yom_kippur',
    sukkot: 'sukkot', hoshanahRaba: 'hoshana_raba', sheminiAtzeret: 'shemini_atzeret',
    simchatTorah: 'simchat_torah', cholHamoedPesach: 'chol_hamoed_pesach',
    cholHamoedSukkot: 'chol_hamoed_sukkot', isruChag: 'isru_chag', pesach: 'pesach',
    erevPesach: 'erev_pesach', shavuot: 'shavuot', erevShavuot: 'erev_shavuot',
    fastDay: 'fast_day', mondayThursday: 'monday_thursday',
    skipTachanun: 'skip_tachanun', skipTachanunMincha: 'skip_tachanun_mincha',
    skipLamenatzeach: 'skip_lamenatzeach', skipMizmorLetodah: 'skip_mizmor_letodah',
    skipTefillin: 'skip_tefillin', tefillinOptionalAccordion: 'tefillin_optional_accordion',
    hefsekTefillin: 'hefsek_tefillin', wearsTallitGadol: 'wears_tallit_gadol',
    hamelech_hakadosh: 'hamelech_hakadosh', hamelech_hamishpat: 'hamelech_hamishpat',
    mashivHaruach: 'mashiv_haruach', talUmatar: 'tal_umatar', elul: 'elul',
    ladavid_season: 'ladavid_season', erevShabbat: 'erev_shabbat',
    fast10Tevet: 'fast_10_tevet', fastEsther: 'fast_esther',
    fast17Tammuz: 'fast_17_tammuz', fastGedalia: 'fast_gedalia',
    bahabSheniKama: 'bahab_sheni_kama', bahabChamishi: 'bahab_chamishi',
    bahabSheniBatra: 'bahab_sheni_batra', bahabDay: 'bahab_day',
    tishaBaav: 'tisha_beav', tishaBavMincha: 'tisha_beav_mincha',
    leapKeferatPashay: 'leap_keferat_pashay', avinoMalkeinu: 'avinu_malkeinu',
    yaalehVeyavo: 'yaaleh_veyavo', alHaNisim: 'al_hanisim', zochrenu: 'zochrenu',
    miChamochaAyt: 'mi_chamocha_ayt', uchtov: 'uchtov', bseferChaim: 'bsefer_chaim',
    daySunday: 'day_sunday', dayMonday: 'day_monday', dayTuesday: 'day_tuesday',
    dayWednesday: 'day_wednesday', dayThursday: 'day_thursday', dayFriday: 'day_friday',
    dayShabbat: 'day_shabbat', genderMale: 'gender_male', genderFemale: 'gender_female',
    inIsrael: 'in_israel', notInIsrael: 'not_in_israel', kriatHatorah: 'kriat_hatorah',
    kriatHatorahMonThu: 'kriat_hatorah_mon_thu', kriatHatorahRc: 'kriat_hatorah_rc',
    kriatHatorahChanukah: 'kriat_hatorah_chanukah', kriatHatorahPurim: 'kriat_hatorah_purim',
    rcTevet: 'rc_tevet', omerPeriod: 'omer_period', fullHallel: 'full_hallel',
    halfHallel: 'half_hallel', hallelWithMusaf: 'hallel_with_musaf', musafDay: 'musaf_day',
    musafContent: 'musaf_content', shemaHotzaah: 'shema_hotzaah',
    pesachYt1Thursday: 'pesach_yt1_thursday', hoshanotDay: 'hoshanot_day',
    graSsyDay: 'gra_ssy_day', lulavDay: 'lulav_day', withMinyan: 'with_minyan',
    nusachAshkenaz: 'nusach_ashkenaz', nusachSfard: 'nusach_sfard',
    nusachEdotMizrach: 'nusach_edot_mizrach'
  };
  // chanukah_day_<n>, pesach_day_<n>, sukkot_day_<n> built inline.

  // ── Event classification (hebcal events → kosher_dart-style tokens) ─────────
  // Returns an object emulating the JewishCalendar accessors the dart used.
  function classify(date, il) {
    var hd = new H.HDate(date);
    var evs = H.HebrewCalendar.calendar({
      start: hd, end: hd, il: il, sedrot: true, omer: true, yomKippurKatan: true,
    });
    var isYomKippurKatan = false;

    var yt = {};            // set of yom-tov tokens
    var isRC = false, isCholHaMoedPesach = false, isCholHaMoedSukkot = false;
    var isChan = false, chanCandles = null, isTaanis = false, omerDay = null;

    function add(tok) { yt[tok] = true; }

    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      var d = e.getDesc();         // canonical English (stable across hebcal)
      var fl = e.getFlags();

      if (fl & F.ROSH_CHODESH) isRC = true;
      if (fl & (F.MINOR_FAST | F.MAJOR_FAST)) isTaanis = true;
      if (fl & F.OMER_COUNT) { omerDay = e.omer; }

      if (/Yom Kippur Katan/i.test(d)) isYomKippurKatan = true;

      // Chanukah ("Chanukah: N Candles" / "Chanukah: N Candle" / "8th Day")
      if (/^Chanukah/.test(d)) {
        isChan = true;
        var cm = d.match(/(\d+) Candle/);
        if (cm) chanCandles = parseInt(cm[1], 10);
        else if (/8th Day/.test(d)) chanCandles = 9; // → day 8 (candles-1)
      }

      // Chol HaMoed (Pesach / Sukkot)
      if (fl & F.CHOL_HAMOED) {
        if (/Pesach/.test(d)) isCholHaMoedPesach = true;
        if (/Sukkot/.test(d)) isCholHaMoedSukkot = true;
      }

      // Yom-Tov / fast tokens by canonical desc
      if (/^Rosh Hashana/.test(d) && !/LaBehemot/.test(d)) add('ROSH_HASHANA');
      if (/^Erev Rosh Hashana/.test(d)) add('EREV_ROSH_HASHANA');
      if (d === 'Erev Yom Kippur') add('EREV_YOM_KIPPUR');
      if (d === 'Yom Kippur') add('YOM_KIPPUR');
      if (/^Sukkot/.test(d) && !(fl & F.CHOL_HAMOED) && !(fl & F.EREV)) add('SUCCOS');
      if (/Hoshana Raba/.test(d)) add('HOSHANA_RABBA');
      if (d === 'Shmini Atzeret') add('SHEMINI_ATZERES');
      if (d === 'Simchat Torah') add('SIMCHAS_TORAH');
      if (d === 'Erev Pesach') add('EREV_PESACH');
      if (/^Pesach/.test(d) && !(fl & F.CHOL_HAMOED) && !(fl & F.EREV)) add('PESACH');
      if (d === 'Pesach Sheni') add('PESACH_SHENI');
      if (d === 'Lag BaOmer') add('LAG_BAOMER');
      if (d === 'Erev Shavuot') add('EREV_SHAVUOS');
      if (/^Shavuot/.test(d) && !(fl & F.EREV)) add('SHAVUOS');
      if (/^Tu B'?Av/.test(d) || d === "Tu B'Av") add('TU_BEAV');
      if (/^Tu BiShvat/.test(d) || /^Tu B'Shvat/.test(d)) add('TU_BESHVAT');
      if (d === 'Purim') add('PURIM');
      if (d === 'Shushan Purim') add('SHUSHAN_PURIM');
      if (d === 'Purim Katan') add('PURIM_KATAN');
      if (d === 'Shushan Purim Katan') add('SHUSHAN_PURIM_KATAN');
      if (/^Asara B'?Tevet/.test(d) || d === "Asara B'Tevet") add('TENTH_OF_TEVES');
      if (/^Tzom Gedaliah/.test(d)) add('FAST_OF_GEDALYAH');
      if (/^Ta'anit Esther/.test(d)) add('FAST_OF_ESTHER');
      if (/^Tzom Tammuz/.test(d)) add('SEVENTEEN_OF_TAMMUZ');
      if (/^Tish'a B'?Av/.test(d) || /Tish'a B'Av/.test(d)) add('TISHA_BEAV');
    }

    // Chanukah day 1..8 from candle count (candles = day + 1).
    var chanukahDay = null;
    if (isChan && chanCandles != null) {
      chanukahDay = Math.max(1, Math.min(8, chanCandles - 1));
    } else if (isChan) {
      chanukahDay = chanukahDayFromDate(hd); // fallback
    }

    return {
      hd: hd,
      month: hd.getMonth(),
      day: hd.getDate(),
      year: hd.getFullYear(),
      isLeap: hd.isLeapYear(),
      dowJS: hd.getDay(),                 // 0=Sun … 6=Sat
      dowMon: ((hd.getDay() + 6) % 7) + 1, // Mon=1 … Sun=7 (Dart weekday)
      il: il,
      yt: yt,
      isRC: isRC,
      isCholHaMoedPesach: isCholHaMoedPesach,
      isCholHaMoedSukkot: isCholHaMoedSukkot,
      isChanukah: isChan,
      chanukahDay: chanukahDay,
      isTaanis: isTaanis,
      isYomKippurKatan: isYomKippurKatan,
      omerDay: (omerDay >= 1 && omerDay <= 49) ? omerDay : null,
      parsha: computeUpcomingParshah(hd, il),
    };
  }

  function chanukahDayFromDate(hd) {
    // 25 Kislev = day 1. Walk back to find offset (Kislev has 29/30 days).
    var abs = hd.abs();
    var start = new H.HDate(25, M.KISLEV, hd.getFullYear());
    // If we're already in Tevet, the Kislev-of-this-Hebrew-year start is correct
    // because Chanukah straddles the year boundary only at Kislev/Tevet (same yy).
    var day = abs - start.abs() + 1;
    if (day < 1 || day > 8) return null;
    return day;
  }

  // ── Upcoming parashah (Mon/Thu Torah reading lookup) ───────────────────────
  // hebcal Sedra.get() returns english parsha name(s) for the upcoming Shabbat;
  // we collapse combined→first and return {names:[...], slug, he}. The slug is
  // refined against the kriah mapping in postprocess.js.
  function computeUpcomingParshah(hd, il) {
    try {
      var sedra = new H.Sedra(hd.getFullYear(), il);
      var sat = hd.onOrAfter(6); // next Saturday (HDate)
      var arr = sedra.get(sat);  // string[] english, or [] on a special shabbat
      if (!arr || !arr.length) return null;
      var he = sedra.getString(sat, 'he-x-NoNikud');
      return { names: arr, he: he, slug: arr[0].toLowerCase().replace(/[ '’]/g, '_') };
    } catch (e) { return null; }
  }

  // ── Sukkot / Pesach day-in-chag ─────────────────────────────────────────────
  function computeSukkotDay(c) {
    if (c.month !== M.TISHREI) return null;
    if (c.day < 15 || c.day > 21) return null;
    return c.day - 14;
  }
  function computePesachDay(c) {
    if (c.month !== M.NISAN) return null;
    if (c.day < 15 || c.day > 22) return null;
    return c.day - 14;
  }
  // Weekday (Mon=1..Sun=7) of YT1 of the current chag.
  function yt1Weekday(date, dayInChag) {
    var yt1 = new Date(date.getTime());
    yt1.setDate(yt1.getDate() - (dayInChag - 1));
    return ((yt1.getDay() + 6) % 7) + 1;
  }

  // ── Period helpers (verbatim from dart) ─────────────────────────────────────
  function isMashivHaruachPeriod(m, d) {
    if (m === M.TISHREI && d >= 22) return true;
    if (m >= M.CHESHVAN) return true;            // Cheshvan(8)…Adar II(13)
    if (m === M.NISAN && d <= 14) return true;
    return false;
  }
  function diasporaTalUmatarStartDay(year) {
    var ny = year + 1;
    var leap = (ny % 4 === 0 && ny % 100 !== 0) || ny % 400 === 0;
    return leap ? 5 : 4;
  }
  function isTalUmatarPeriod(m, d, date, inIsrael) {
    if (m >= M.IYYAR && m < M.TISHREI) return false; // Iyar(2)…Elul(6): summer
    if (m === M.TISHREI && d < 22) return false;
    if (m === M.NISAN && d >= 15) return false;
    if (inIsrael) {
      if (m === M.CHESHVAN && d < 7) return false;
      return true;
    }
    // Diaspora: Dec 4/5 start (Gregorian).
    var gm = date.getMonth() + 1, gd = date.getDate();
    if (gm === 12) return gd >= diasporaTalUmatarStartDay(date.getFullYear());
    if (gm <= 5) return true;  // Jan–May
    return false;              // Oct–Nov
  }

  function isIsruChag(c) {
    var m = c.month, d = c.day, inIsrael = c.il;
    if (m === M.TISHREI && d === (inIsrael ? 23 : 24)) return true;
    if (m === M.NISAN && d === (inIsrael ? 22 : 23)) return true;
    if (m === M.SIVAN && d === (inIsrael ? 7 : 8)) return true;
    return false;
  }

  // ── Hallel (replicates kosher_dart TefilaRules from already-set flags) ──────
  // full: Sukkot (all 7) + SA + ST + Pesach day 1(+2 chul) + Shavuot + Chanukah.
  // half: Rosh Chodesh (not RH) + CHM Pesach + last day(s) of Pesach.
  function addHallel(c, f) {
    var full = f.has(DF.chanukah) ||
      f.has(DF.sukkot) || f.has(DF.sheminiAtzeret) || f.has(DF.simchatTorah) ||
      f.has(DF.shavuot) ||
      (c.month === M.NISAN && (c.day === 15 || (!c.il && c.day === 16)));
    var half = false;
    if (!full) {
      half = (f.has(DF.roshChodesh) && !f.has(DF.roshHashanah)) ||
        f.has(DF.cholHamoedPesach) ||
        (c.month === M.NISAN && c.day >= 16 && c.day <= 22);
    }
    if (full) f.add(DF.fullHallel);
    else if (half) f.add(DF.halfHallel);
    if ((full || half) && f.has(DF.musafDay)) f.add(DF.hallelWithMusaf);
  }

  // ── BaHaB ────────────────────────────────────────────────────────────────
  function addBahab(c, date, f) {
    var m = c.month;
    if (m !== M.CHESHVAN && m !== M.IYYAR) return;
    var today = c.day;
    var day1 = new Date(date.getTime());
    day1.setDate(day1.getDate() - (today - 1));
    var day1weekdayMon = ((day1.getDay() + 6) % 7) + 1; // Mon=1..Sun=7
    var daysUntilFirstMon = (1 - day1weekdayMon + 7) % 7;
    var firstMon = 1 + daysUntilFirstMon;
    var secondMon = firstMon + 7;
    var thursday = secondMon + 3;
    var thirdMon = secondMon + 7;
    if (today === secondMon) { f.add(DF.bahabSheniKama); f.add(DF.bahabDay); }
    else if (today === thursday) { f.add(DF.bahabChamishi); f.add(DF.bahabDay); }
    else if (today === thirdMon) { f.add(DF.bahabSheniBatra); f.add(DF.bahabDay); }
  }

  // ── Main: flagsFor ──────────────────────────────────────────────────────────
  function flagsFor(date, ctx) {
    var c = classify(date, ctx.isInIsrael);
    var yt = { has: function (t) { return !!c.yt[t]; } };

    // Use a plain object as an ordered Set.
    var set = {};
    var f = {
      add: function (s) { set[s] = true; },
      has: function (s) { return !!set[s]; },
    };

    addDayIdentification(c, date, ctx, yt, f);
    addSeasonFlags(c, date, ctx, yt, f);
    addTachanun(c, f);
    if (f.has(DF.skipTachanun)) f.add(DF.skipLamenatzeach);
    if (f.has(DF.asaretYemeiTeshuva)) {
      f.add(DF.hamelech_hakadosh); f.add(DF.hamelech_hamishpat);
      f.add(DF.zochrenu); f.add(DF.miChamochaAyt); f.add(DF.uchtov); f.add(DF.bseferChaim);
    }
    addAvinoMalkeinu(f);
    addYaalehVeyavo(f);
    if (f.has(DF.chanukah) || f.has(DF.purim)) f.add(DF.alHaNisim);
    addMizmorLetodah(ctx, f);
    addTefillin(ctx, f);
    addShemaHotzaah(f);
    addKriatHatorah(f);
    addMusafDay(f);
    addHallel(c, f);
    if (f.has(DF.sukkot) && !f.has(DF.shabbat)) f.add(DF.lulavDay);
    f.add(ctx.gender === 'female' ? DF.genderFemale : DF.genderMale);
    f.add(ctx.isInIsrael ? DF.inIsrael : DF.notInIsrael);
    if (ctx.withMinyan !== false) f.add(DF.withMinyan);
    addLeapKeferatPashay(c, f);

    var omerDay = c.omerDay;
    if (omerDay != null) f.add(DF.omerPeriod);

    var sukkotDay = computeSukkotDay(c);
    var pesachDay = computePesachDay(c);
    var chanukahDay = c.chanukahDay;
    var chagYt1Weekday = null;
    if (sukkotDay != null) chagYt1Weekday = yt1Weekday(date, sukkotDay);
    else if (pesachDay != null) chagYt1Weekday = yt1Weekday(date, pesachDay);

    if (pesachDay != null) {
      f.add('pesach_day_' + pesachDay);
      if (chagYt1Weekday === 4) f.add(DF.pesachYt1Thursday); // Thursday
    }
    if (sukkotDay != null) {
      f.add('sukkot_day_' + sukkotDay);
      if (sukkotDay >= 2 && sukkotDay <= 7 && !f.has(DF.shabbat)) f.add(DF.hoshanotDay);
    }

    var upcomingParshah = c.parsha;

    // kriat_hatorah_mon_thu
    if (f.has(DF.mondayThursday) && upcomingParshah &&
        !f.has(DF.roshChodesh) && !f.has(DF.chanukah) && !f.has(DF.purim) &&
        !f.has(DF.shushanPurim) && !f.has(DF.cholHamoedPesach) &&
        !f.has(DF.cholHamoedSukkot) && !f.has(DF.fastDay)) {
      f.add(DF.kriatHatorahMonThu);
    }
    if (f.has(DF.roshChodesh) && !f.has(DF.chanukah)) f.add(DF.kriatHatorahRc);
    if (f.has(DF.roshChodesh) && f.has(DF.chanukah)) f.add(DF.rcTevet);
    if (f.has(DF.chanukah) && !f.has(DF.roshChodesh)) f.add(DF.kriatHatorahChanukah);
    if (f.has(DF.purim) || f.has(DF.shushanPurim)) f.add(DF.kriatHatorahPurim);

    if ((pesachDay != null && pesachDay >= 2 && pesachDay <= 6) ||
        (sukkotDay != null && sukkotDay >= 2 && sukkotDay <= 7)) {
      f.add(DF.graSsyDay);
    }
    if (chanukahDay != null) f.add('chanukah_day_' + chanukahDay);
    if (c.isYomKippurKatan) f.add('yom_kippur_katan');

    return {
      flags: Object.keys(set),
      omerDay: omerDay, sukkotDay: sukkotDay, pesachDay: pesachDay,
      chanukahDay: chanukahDay, chagYt1Weekday: chagYt1Weekday,
      upcomingParshah: upcomingParshah,
      // display extras
      hd: c.hd, month: c.month, day: c.day, year: c.year,
    };
  }

  // ── 1. Day identification ────────────────────────────────────────────────
  function addDayIdentification(c, date, ctx, yt, f) {
    var m = c.month, d = c.day, dowMon = c.dowMon;

    if (dowMon === 6) f.add(DF.shabbat);                // Saturday
    if (dowMon === 1 || dowMon === 4) f.add(DF.mondayThursday);

    var dows = [null, DF.dayMonday, DF.dayTuesday, DF.dayWednesday, DF.dayThursday, DF.dayFriday, DF.dayShabbat, DF.daySunday];
    f.add(dows[dowMon]);

    if (c.isRC) f.add(DF.roshChodesh);
    if (m === M.TISHREI && d >= 1 && d <= 10) f.add(DF.asaretYemeiTeshuva);

    if (yt.has('ROSH_HASHANA')) f.add(DF.roshHashanah);
    if (yt.has('EREV_YOM_KIPPUR')) f.add(DF.erevYomKippur);
    if (yt.has('YOM_KIPPUR')) f.add(DF.yomKippur);
    if (m === M.TISHREI && d === 11) f.add(DF.dayAfterYomKippur);

    if (yt.has('SUCCOS')) f.add(DF.sukkot);
    if (c.isCholHaMoedSukkot) { f.add(DF.sukkot); f.add(DF.cholHamoedSukkot); }
    if (yt.has('HOSHANA_RABBA')) { f.add(DF.sukkot); f.add(DF.hoshanahRaba); f.add(DF.cholHamoedSukkot); }
    if (yt.has('SHEMINI_ATZERES')) {
      f.add(DF.sheminiAtzeret);
      if (ctx.isInIsrael) f.add(DF.simchatTorah);
    }
    if (yt.has('SIMCHAS_TORAH')) f.add(DF.simchatTorah);

    if (yt.has('EREV_ROSH_HASHANA')) f.add(DF.erevRoshHashanah);
    if (c.isChanukah) f.add(DF.chanukah);
    if (yt.has('TU_BESHVAT')) f.add(DF.tuBishvat);

    addPurim(c, ctx, yt, f);

    if (yt.has('EREV_PESACH')) { f.add(DF.pesach); f.add(DF.erevPesach); }
    if (yt.has('PESACH')) f.add(DF.pesach);
    if (c.isCholHaMoedPesach) f.add(DF.cholHamoedPesach);

    if (yt.has('PESACH_SHENI')) f.add(DF.pesachSheni);
    if (m === M.IYYAR && d === 13) f.add(DF.erevPesachSheni);
    if (yt.has('LAG_BAOMER')) f.add(DF.lagBaomer);

    if (yt.has('EREV_SHAVUOS')) f.add(DF.erevShavuot);
    if (yt.has('SHAVUOS')) f.add(DF.shavuot);

    if (yt.has('TU_BEAV')) f.add(DF.tuBav);

    if (isIsruChag(c)) f.add(DF.isruChag);

    if (c.isTaanis) f.add(DF.fastDay);
    if (yt.has('TENTH_OF_TEVES')) f.add(DF.fast10Tevet);
    if (yt.has('FAST_OF_GEDALYAH')) f.add(DF.fastGedalia);
    if (yt.has('FAST_OF_ESTHER')) f.add(DF.fastEsther);
    if (yt.has('SEVENTEEN_OF_TAMMUZ')) f.add(DF.fast17Tammuz);

    addBahab(c, date, f);

    if (m === M.ELUL && !f.has(DF.erevRoshHashanah)) f.add(DF.elul);
    if (m === M.ELUL) f.add(DF.ladavid_season);
    if (m === M.TISHREI && d <= 10) f.add(DF.ladavid_season);
    if (dowMon === 5) f.add(DF.erevShabbat);            // Friday
  }

  function addPurim(c, ctx, yt, f) {
    if (yt.has('PURIM_KATAN')) f.add(DF.purimKatan);
    if (yt.has('SHUSHAN_PURIM_KATAN')) f.add(DF.shushanPurimKatan);
    if (yt.has('FAST_OF_ESTHER')) f.add(DF.erevPurim);
    var pd = ctx.purimDate || 'fourteenth';
    if (yt.has('PURIM')) {
      if (pd === 'fourteenth' || pd === 'both') f.add(DF.purim);
    }
    if (yt.has('SHUSHAN_PURIM')) {
      f.add(DF.shushanPurim);
      if (pd === 'fifteenth' || pd === 'both') f.add(DF.purim);
    }
  }

  // ── 2. Season ──────────────────────────────────────────────────────────────
  function addSeasonFlags(c, date, ctx, yt, f) {
    if (isMashivHaruachPeriod(c.month, c.day)) f.add(DF.mashivHaruach);
    if (isTalUmatarPeriod(c.month, c.day, date, ctx.isInIsrael)) f.add(DF.talUmatar);
    if (yt.has('TISHA_BEAV')) f.add(DF.tishaBaav);
  }

  // ── 3. Tachanun ──────────────────────────────────────────────────────────
  function addTachanun(c, f) {
    var m = c.month, d = c.day;
    var skipAll = false, skipMinchaOnly = false;
    if (m === M.NISAN) skipAll = true;
    if (f.has(DF.chanukah)) skipAll = true;
    if (f.has(DF.roshChodesh)) skipAll = true;
    if (f.has(DF.purim) || f.has(DF.shushanPurim) || f.has(DF.erevPurim) ||
        f.has(DF.purimKatan) || f.has(DF.shushanPurimKatan)) skipAll = true;
    if (f.has(DF.pesachSheni)) skipAll = true;
    if (f.has(DF.tuBishvat) || f.has(DF.lagBaomer) || f.has(DF.tuBav)) skipAll = true;
    if (f.has(DF.roshHashanah) || f.has(DF.yomKippur) || f.has(DF.erevYomKippur) ||
        f.has(DF.sukkot) || f.has(DF.cholHamoedSukkot) || f.has(DF.hoshanahRaba) ||
        f.has(DF.sheminiAtzeret) || f.has(DF.simchatTorah) || f.has(DF.pesach) ||
        f.has(DF.cholHamoedPesach) || f.has(DF.shavuot) || f.has(DF.isruChag)) skipAll = true;
    if (m === M.TISHREI && d >= 11 && d <= 14) skipAll = true;
    if (m === M.SIVAN && d >= 1 && d <= 12) skipAll = true;
    if (f.has(DF.erevShavuot)) skipMinchaOnly = true;
    if (skipAll) f.add(DF.skipTachanun);
    if (!skipAll && skipMinchaOnly) f.add(DF.skipTachanunMincha);
  }

  function addAvinoMalkeinu(f) {
    var isAyt = f.has(DF.asaretYemeiTeshuva), isFast = f.has(DF.fastDay),
      isShabbat = f.has(DF.shabbat), isYK = f.has(DF.yomKippur), isTB = f.has(DF.tishaBaav);
    if ((isAyt || isFast) && !isShabbat && !isTB) f.add(DF.avinoMalkeinu);
    if (isYK) f.add(DF.avinoMalkeinu);
  }

  function addYaalehVeyavo(f) {
    var days = [DF.roshChodesh, DF.roshHashanah, DF.pesach, DF.cholHamoedPesach,
      DF.shavuot, DF.sukkot, DF.cholHamoedSukkot, DF.hoshanahRaba,
      DF.sheminiAtzeret, DF.simchatTorah];
    for (var i = 0; i < days.length; i++) if (f.has(days[i])) { f.add(DF.yaalehVeyavo); return; }
  }

  function addMizmorLetodah(ctx, f) {
    if (ctx.nusach === 'edot_mizrach') return;
    if (f.has(DF.erevPesach) || f.has(DF.cholHamoedPesach) || f.has(DF.erevYomKippur)) {
      f.add(DF.skipMizmorLetodah);
    }
  }

  function addTefillin(ctx, f) {
    var chm = f.has(DF.cholHamoedPesach) || f.has(DF.cholHamoedSukkot);
    if (!chm) return;
    if (ctx.isInIsrael) f.add(DF.skipTefillin);
    else f.add(DF.tefillinOptionalAccordion);
  }

  function addShemaHotzaah(f) {
    var ytLevel = f.has(DF.shabbat) || f.has(DF.roshHashanah) || f.has(DF.yomKippur) ||
      f.has(DF.hoshanahRaba) || f.has(DF.sheminiAtzeret) || f.has(DF.simchatTorah) ||
      f.has(DF.shavuot) ||
      (f.has(DF.pesach) && !f.has(DF.cholHamoedPesach) && !f.has(DF.erevPesach)) ||
      (f.has(DF.sukkot) && !f.has(DF.cholHamoedSukkot));
    if (ytLevel) f.add(DF.shemaHotzaah);
  }

  function addKriatHatorah(f) {
    var has = f.has(DF.mondayThursday) || f.has(DF.roshChodesh) || f.has(DF.fastDay) ||
      f.has(DF.chanukah) || f.has(DF.purim) || f.has(DF.shushanPurim) ||
      f.has(DF.cholHamoedPesach) || f.has(DF.cholHamoedSukkot) || f.has(DF.shabbat) ||
      f.has(DF.roshHashanah) || f.has(DF.yomKippur) || f.has(DF.pesach) ||
      f.has(DF.shavuot) || f.has(DF.sukkot) || f.has(DF.sheminiAtzeret) ||
      f.has(DF.simchatTorah) || f.has(DF.hoshanahRaba);
    if (has) f.add(DF.kriatHatorah);
  }

  function addMusafDay(f) {
    var has = f.has(DF.roshChodesh) || f.has(DF.cholHamoedPesach) || f.has(DF.cholHamoedSukkot) ||
      f.has(DF.shabbat) || f.has(DF.roshHashanah) || f.has(DF.yomKippur) || f.has(DF.pesach) ||
      f.has(DF.shavuot) || f.has(DF.sukkot) || f.has(DF.sheminiAtzeret) || f.has(DF.simchatTorah);
    if (has) f.add(DF.musafDay);
    var content = f.has(DF.roshChodesh) || f.has(DF.cholHamoedPesach) || f.has(DF.cholHamoedSukkot);
    if (content) f.add(DF.musafContent);
  }

  function addLeapKeferatPashay(c, f) {
    if (!c.isLeap) return;
    var leapMonths = [M.CHESHVAN, M.KISLEV, M.TEVET, M.SHVAT, M.ADAR_I, M.ADAR_II, M.NISAN];
    if (leapMonths.indexOf(c.month) >= 0) f.add(DF.leapKeferatPashay);
  }

  global.SiduronCalendar = {
    flagsFor: flagsFor,
    DF: DF,
    _classify: classify, // exposed for tests
  };
})(typeof window !== 'undefined' ? window : this);

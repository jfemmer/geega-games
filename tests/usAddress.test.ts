import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHIPS_TO_SUMMARY,
  SHIP_TO_COUNTRY,
  US_COUNTRY_SPELLINGS,
  US_LOOKUP_REGION_CODES,
  US_ONLY_MESSAGE,
  US_REGIONS,
  US_STATE_MESSAGE,
  US_ZIP_MESSAGE,
  checkUsAddress,
  isUsCountry,
  usStateCode,
  usStateFor,
  usStateName,
  usZip,
} from "../src/store/lib/usAddress";

// Orders ship within the United States only. src/store/lib/usAddress.ts is
// the app's copy of that rule (forms and the checkout endpoint); the database
// has its own (supabase/migrations/*_us_shipping_only.sql), because it has to
// refuse a foreign address even when the app is bypassed. The last block
// here fails if the two copies stop agreeing.

describe("the places we ship", () => {
  it("are the 50 states and D.C., the five territories and military mail", () => {
    const count = (group: string) => US_REGIONS.filter((region) => region.group === group).length;
    expect(count("state")).toBe(51);
    expect(count("territory")).toBe(5);
    expect(count("military")).toBe(3);
    expect(US_REGIONS).toHaveLength(59);

    expect(US_REGIONS.filter((r) => r.group === "territory").map((r) => r.code)).toEqual(["AS", "GU", "MP", "PR", "VI"]);
    expect(US_REGIONS.filter((r) => r.group === "military").map((r) => r.code)).toEqual(["AA", "AE", "AP"]);
  });

  it("each have one USPS code and one name", () => {
    const codes = US_REGIONS.map((region) => region.code);
    const names = US_REGIONS.map((region) => region.name);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(names).size).toBe(names.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("no spelling means two different places", () => {
    // Every code, name and alias must find its own region.
    for (const region of US_REGIONS) {
      for (const spelling of [region.code, region.name, ...(region.aliases ?? [])]) {
        expect(usStateCode(spelling), spelling).toBe(region.code);
      }
    }
  });

  it("are stored as the country US", () => {
    expect(SHIP_TO_COUNTRY).toBe("US");
  });

  it("are described in one sentence for customers", () => {
    expect(SHIPS_TO_SUMMARY).toBe(
      "We ship within the United States only: all 50 states, Washington, D.C., US territories and military (APO/FPO/DPO) addresses.",
    );
  });
});

describe("usStateCode", () => {
  it("reads a state however it is written", () => {
    expect(usStateCode("MO")).toBe("MO");
    expect(usStateCode("mo")).toBe("MO");
    expect(usStateCode(" Mo. ")).toBe("MO");
    expect(usStateCode("Missouri")).toBe("MO");
    expect(usStateCode("  missouri  ")).toBe("MO");
    expect(usStateCode("NEW   YORK")).toBe("NY");
    expect(usStateCode("North Carolina")).toBe("NC");
  });

  it("knows Washington, D.C. from Washington state", () => {
    expect(usStateCode("Washington")).toBe("WA");
    expect(usStateCode("Washington, D.C.")).toBe("DC");
    expect(usStateCode("Washington DC")).toBe("DC");
    expect(usStateCode("District of Columbia")).toBe("DC");
    expect(usStateCode("D.C.")).toBe("DC");
  });

  it("reads territories and military regions", () => {
    expect(usStateCode("Puerto Rico")).toBe("PR");
    expect(usStateCode("Guam")).toBe("GU");
    expect(usStateCode("U.S. Virgin Islands")).toBe("VI");
    expect(usStateCode("Virgin Islands")).toBe("VI");
    expect(usStateCode("Northern Mariana Islands")).toBe("MP");
    expect(usStateCode("American Samoa")).toBe("AS");
    expect(usStateCode("AE")).toBe("AE");
    expect(usStateCode("Armed Forces Pacific")).toBe("AP");
  });

  it("refuses everything else", () => {
    for (const elsewhere of [
      "Ontario",
      "ON",
      "BC",
      "British Columbia",
      "Quebec",
      "QC",
      "England",
      "Bavaria",
      "NSW",
      "Jalisco",
      "Tokyo",
      "St. Louis",
      "Missouri, USA",
      "XX",
      "",
      "   ",
    ]) {
      expect(usStateCode(elsewhere), elsewhere).toBeNull();
    }
    expect(usStateCode(undefined)).toBeNull();
    expect(usStateCode(null)).toBeNull();
    expect(usStateCode(29)).toBeNull();
    expect(usStateCode({ state: "MO" })).toBeNull();
  });
});

describe("usStateName", () => {
  it("gives the full name for a code or a name", () => {
    expect(usStateName("MO")).toBe("Missouri");
    expect(usStateName("missouri")).toBe("Missouri");
    expect(usStateName("DC")).toBe("District of Columbia");
    expect(usStateName("PR")).toBe("Puerto Rico");
    expect(usStateName("AE")).toBe("Armed Forces Europe");
  });

  it("gives nothing for a place outside the US", () => {
    expect(usStateName("ON")).toBeNull();
    expect(usStateName("")).toBeNull();
    expect(usStateName(null)).toBeNull();
  });
});

describe("usZip", () => {
  it("accepts a 5-digit ZIP and ZIP+4, and writes ZIP+4 one way", () => {
    expect(usZip("63101")).toBe("63101");
    expect(usZip(" 63101 ")).toBe("63101");
    expect(usZip("00901")).toBe("00901");
    expect(usZip("63101-1234")).toBe("63101-1234");
    expect(usZip("631011234")).toBe("63101-1234");
    expect(usZip("63101 1234")).toBe("63101-1234");
  });

  it("refuses postcodes from other countries and anything unfinished", () => {
    for (const notAZip of [
      "M5V 3L9", // Canada
      "SW1A 1AA", // United Kingdom
      "2000", // Australia
      "100-0001", // Japan
      "1234 AB", // Netherlands
      "6310",
      "631011",
      "63101-12",
      "63101-12345",
      "6310A",
      "63101--1234",
      "",
      "   ",
    ]) {
      expect(usZip(notAZip), notAZip).toBeNull();
    }
    expect(usZip(63101)).toBeNull();
    expect(usZip(null)).toBeNull();
    expect(usZip(undefined)).toBeNull();
  });
});

describe("isUsCountry", () => {
  it("knows the United States however it is written, and when it is left blank", () => {
    for (const us of ["US", "us", "USA", "U.S.", "U.S.A.", "United States", "united states of america", "", "  ", undefined, null]) {
      expect(isUsCountry(us), String(us)).toBe(true);
    }
  });

  it("counts the territories, which address lookups list as countries", () => {
    for (const territory of ["PR", "Puerto Rico", "GU", "Guam", "VI", "U.S. Virgin Islands", "MP", "AS", "American Samoa"]) {
      expect(isUsCountry(territory), territory).toBe(true);
    }
  });

  it("refuses every other country", () => {
    for (const abroad of [
      "CA", // Canada, not California: this is the country
      "Canada",
      "MX",
      "Mexico",
      "GB",
      "United Kingdom",
      "DE",
      "Germany",
      "AU",
      "JP",
      "UM",
      "America",
      "United States Minor Outlying Islands",
      "MO", // a state is not a country
    ]) {
      expect(isUsCountry(abroad), abroad).toBe(false);
    }
  });
});

describe("usStateFor", () => {
  it("reads the state of a US address", () => {
    expect(usStateFor("Missouri", "US")).toBe("MO");
    expect(usStateFor("MO", "United States")).toBe("MO");
    expect(usStateFor("MO", undefined)).toBe("MO");
    expect(usStateFor("PR", "US")).toBe("PR");
  });

  it("makes a territory given as the country into the state", () => {
    expect(usStateFor("San Juan", "PR")).toBe("PR");
    expect(usStateFor("", "Puerto Rico")).toBe("PR");
    expect(usStateFor("Tamuning", "GU")).toBe("GU");
    expect(usStateFor("St. Thomas", "VI")).toBe("VI");
  });

  it("gives nothing for an address in another country, even with a US-looking state", () => {
    expect(usStateFor("Ontario", "CA")).toBeNull();
    expect(usStateFor("CA", "CA")).toBeNull();
    expect(usStateFor("MO", "Canada")).toBeNull();
    expect(usStateFor("Georgia", "Georgia")).toBeNull();
  });
});

describe("checkUsAddress", () => {
  it("accepts a US address and gives it back the way it is stored", () => {
    expect(checkUsAddress({ state: "Missouri", postalCode: "63011", country: "US" })).toEqual({
      ok: true,
      state: "MO",
      postalCode: "63011",
      country: "US",
    });
    expect(checkUsAddress({ state: " mo ", postalCode: "630111234", country: "usa" })).toEqual({
      ok: true,
      state: "MO",
      postalCode: "63011-1234",
      country: "US",
    });
  });

  it("treats an address with no country as a US address", () => {
    expect(checkUsAddress({ state: "IL", postalCode: "62701" })).toEqual({
      ok: true,
      state: "IL",
      postalCode: "62701",
      country: "US",
    });
  });

  it("accepts Alaska, Hawaii, D.C., the territories and military mail", () => {
    for (const [state, postalCode, country, code] of [
      ["Alaska", "99501", "US", "AK"],
      ["HI", "96813", "US", "HI"],
      ["Washington, D.C.", "20001", "US", "DC"],
      ["Puerto Rico", "00901", "US", "PR"],
      ["San Juan", "00901", "PR", "PR"],
      ["Guam", "96910", "GU", "GU"],
      ["AE", "09012", "US", "AE"],
      ["Armed Forces Pacific", "96349", "", "AP"],
    ] as const) {
      expect(checkUsAddress({ state, postalCode, country }), `${state} / ${country}`).toEqual({
        ok: true,
        state: code,
        postalCode,
        country: "US",
      });
    }
  });

  it("refuses another country, and says so before anything else", () => {
    for (const address of [
      { state: "ON", postalCode: "M5V 3L9", country: "CA" },
      { state: "Ontario", postalCode: "M5V 3L9", country: "Canada" },
      { state: "England", postalCode: "SW1A 1AA", country: "GB" },
      { state: "Jalisco", postalCode: "44100", country: "MX" },
      // A US-looking state and ZIP don't make a foreign address a US one.
      { state: "MO", postalCode: "63011", country: "Germany" },
    ]) {
      expect(checkUsAddress(address), address.country).toEqual({
        ok: false,
        field: "country",
        message: US_ONLY_MESSAGE,
      });
    }
  });

  it("refuses a state that isn't one, or is missing", () => {
    for (const state of ["Ontario", "ON", "", undefined, "St. Louis"]) {
      expect(checkUsAddress({ state, postalCode: "63011", country: "US" }), String(state)).toEqual({
        ok: false,
        field: "state",
        message: US_STATE_MESSAGE,
      });
    }
  });

  it("refuses a postcode that isn't a US ZIP", () => {
    for (const postalCode of ["M5V 3L9", "SW1A 1AA", "6301", "", undefined]) {
      expect(checkUsAddress({ state: "MO", postalCode, country: "US" }), String(postalCode)).toEqual({
        ok: false,
        field: "postalCode",
        message: US_ZIP_MESSAGE,
      });
    }
  });

  it("speaks to customers in plain words", () => {
    expect(US_ONLY_MESSAGE).toBe("Sorry, we only ship to addresses in the United States.");
    expect(US_STATE_MESSAGE).toBe("Please choose a US state or territory.");
    expect(US_ZIP_MESSAGE).toBe("Please enter a 5-digit ZIP code.");
  });
});

describe("the address lookup", () => {
  it("is kept to the US and its territories", () => {
    expect(US_LOOKUP_REGION_CODES).toEqual(["us", "as", "gu", "mp", "pr", "vi"]);
    // Google's includedRegionCodes takes at most 15.
    expect(US_LOOKUP_REGION_CODES.length).toBeLessThanOrEqual(15);
  });
});

describe("the database's copy of the rule matches the app's", () => {
  // The newest migration that defines a function is the one that's deployed.
  const dir = "supabase/migrations";
  const newestWith = (text: string): string => {
    const file = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .reverse()
      .find((name) => readFileSync(`${dir}/${name}`, "utf8").includes(text));
    return file ? readFileSync(`${dir}/${file}`, "utf8") : "";
  };
  /** The body of `create or replace function public.<name>(...) ... $function$;`. */
  const functionBody = (name: string): string => {
    const sql = newestWith(`function public.${name}(`);
    const start = sql.indexOf(`function public.${name}(`);
    const open = sql.indexOf("$function$", start);
    const close = sql.indexOf("$function$", open + 1);
    return start >= 0 && open >= 0 && close >= 0 ? sql.slice(open, close) : "";
  };
  // How both sides spell a place for comparing: upper case, no periods or
  // commas, single spaces.
  const key = (spelling: string) => spelling.replace(/[.,]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

  it("us_state_code() lists the same places, codes and spellings", () => {
    const body = functionBody("us_state_code");
    const inDatabase = [...body.matchAll(/\('([A-Z]{2})', '([^']+)'\)/g)].map(([, code, name]) => `${code}|${name}`);
    const inApp = US_REGIONS.flatMap((region) =>
      [region.name, ...(region.aliases ?? [])].map((spelling) => `${region.code}|${key(spelling)}`),
    );

    expect(inDatabase.length).toBeGreaterThan(0);
    expect([...inDatabase].sort()).toEqual([...inApp].sort());
    // A name is matched against the code as well as the name.
    expect(body).toContain("in (r.code, r.name)");
  });

  it("us_state_code() and is_us_country() compare names the way the app does", () => {
    const normalized = (param: string) =>
      `upper(btrim(regexp_replace(regexp_replace(coalesce(${param}, ''), '[.,]', '', 'g'), '[[:space:]]+', ' ', 'g')))`;
    expect(functionBody("us_state_code")).toContain(normalized("p_state"));
    expect(functionBody("is_us_country")).toContain(normalized("p_country"));
  });

  it("is_us_country() knows the same spellings of the United States", () => {
    const list = functionBody("is_us_country").match(/in \(([^)]*)\)/)?.[1] ?? "";
    const inDatabase = [...list.matchAll(/'([^']*)'/g)].map(([, spelling]) => spelling);
    expect(inDatabase).toEqual([...US_COUNTRY_SPELLINGS]);
    for (const spelling of inDatabase) expect(isUsCountry(spelling)).toBe(true);
  });

  it("us_zip() accepts exactly what usZip() accepts", () => {
    const body = functionBody("us_zip");
    // The two patterns, as the database has them. They are plain enough to
    // run here too, which is the point: one set of samples, both sides.
    const patterns = [...body.matchAll(/z ~ '([^']+)'/g)].map(([, pattern]) => new RegExp(pattern));
    expect(patterns.map(String)).toEqual(["/^[0-9]{5}$/", "/^[0-9]{5}[- ]?[0-9]{4}$/"]);
    expect(body).toContain("btrim(coalesce(p_zip, ''))");
    expect(body).toContain("left(z, 5) || '-' || right(z, 4)");

    for (const sample of [
      "63101",
      " 63101 ",
      "63101-1234",
      "631011234",
      "63101 1234",
      "6310",
      "631011",
      "63101-12",
      "63101--1234",
      "6310A",
      "M5V 3L9",
      "SW1A 1AA",
      "100-0001",
      "",
    ]) {
      const databaseAccepts = patterns.some((pattern) => pattern.test(sample.trim()));
      expect(usZip(sample) !== null, sample).toBe(databaseAccepts);
    }
  });

  describe("the order function", () => {
    const sql = newestWith("function public.checkout_place_order_core(");
    const core = functionBody("checkout_place_order_core");

    it("refuses a missing or non-US address before it creates anything", () => {
      const refusesMissing = core.indexOf("raise exception 'shipping address required' using errcode = 'P0009'");
      const refusesAbroad = core.indexOf("raise exception 'us shipping only' using errcode = 'P0010'");
      const createsOrder = core.indexOf("insert into public.orders");
      const holdsStock = core.indexOf("update public.inventory_items set quantity");

      expect(refusesMissing).toBeGreaterThan(0);
      expect(refusesAbroad).toBeGreaterThan(refusesMissing);
      expect(createsOrder).toBeGreaterThan(refusesAbroad);
      expect(holdsStock).toBeGreaterThan(createsOrder);

      expect(core).toContain("v_ship_state := public.us_state_code(p_ship_state);");
      expect(core).toContain("v_ship_zip := public.us_zip(p_ship_postal_code);");
      expect(core).toMatch(
        /if not public\.is_us_country\(p_ship_country\) or v_ship_state is null or v_ship_zip is null then\s+raise exception 'us shipping only'/,
      );
    });

    it("stores the address tidied: state code, ZIP, country US", () => {
      expect(core).toMatch(/btrim\(p_ship_city\), v_ship_state, v_ship_zip, 'US',/);
    });

    it("can still only be called by the server", () => {
      expect(sql).toMatch(
        /revoke all on function public\.checkout_place_order_core\(\s*uuid, text, jsonb, public\.shipping_method, integer, text, text, text, text, text, text, text\s*\) from public, anon, authenticated;/,
      );
    });
  });

  it("orders can't be stored with a destination outside the US", () => {
    const sql = newestWith("chk_orders_ship_within_us");
    const constraint = sql.slice(sql.indexOf("add constraint chk_orders_ship_within_us"));
    expect(constraint).toContain("ship_country is null or ship_country = 'US'");
    expect(constraint).toContain("ship_state is null or public.us_state_code(ship_state) is not null");
    expect(constraint).toContain("ship_postal_code is null or public.us_zip(ship_postal_code) is not null");
  });
});

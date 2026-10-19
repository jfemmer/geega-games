import { describe, expect, it } from "vitest";
import { normalizeDeckCardName, parseDecklist } from "../src/store/lib/decklist";

describe("parseDecklist — plain-text lists (Scryfall / Moxfield / Archidekt style)", () => {
  it("parses simple 'qty name' lines into the mainboard section", () => {
    const cards = parseDecklist("1 Sol Ring\n1 Counterspell");
    expect(cards).toEqual([
      { name: "Sol Ring", quantity: 1, section: "mainboard" },
      { name: "Counterspell", quantity: 1, section: "mainboard" },
    ]);
  });

  it("recognizes section headings and assigns cards to them", () => {
    const cards = parseDecklist(
      "Commander\n1 Muldrotha, the Gravetide\n\nMainboard\n1 Sol Ring\n\nSideboard\n2 Negate",
    );
    expect(cards).toEqual([
      { name: "Muldrotha, the Gravetide", quantity: 1, section: "commander" },
      { name: "Sol Ring", quantity: 1, section: "mainboard" },
      { name: "Negate", quantity: 2, section: "sideboard" },
    ]);
  });

  it("merges duplicate names within the same section instead of duplicating rows", () => {
    const cards = parseDecklist("2 Island\n1 Island");
    expect(cards).toEqual([{ name: "Island", quantity: 3, section: "mainboard" }]);
  });

  it("clamps merged quantity to the format's max copies", () => {
    const cards = parseDecklist("3 Sol Ring\n3 Sol Ring", 4);
    expect(cards).toEqual([{ name: "Sol Ring", quantity: 4, section: "mainboard" }]);
  });

  it("strips a Moxfield-style set code plus trailing collector number", () => {
    const cards = parseDecklist("1 Sol Ring (C21) 263");
    expect(cards).toEqual([{ name: "Sol Ring", quantity: 1, section: "mainboard" }]);
  });

  it("supports a legacy 'Name, qty' trailing-comma line", () => {
    const cards = parseDecklist("Sol Ring, 3");
    expect(cards).toEqual([{ name: "Sol Ring", quantity: 3, section: "mainboard" }]);
  });
});

describe("parseDecklist — TCGplayer Mass Entry format", () => {
  it("parses 'qty name [SET] collector-number' lines", () => {
    const cards = parseDecklist("1 Lightning Bolt [SLD] 84\n4 Sol Ring [C21] 263");
    expect(cards).toEqual([
      { name: "Lightning Bolt", quantity: 1, section: "mainboard" },
      { name: "Sol Ring", quantity: 4, section: "mainboard" },
    ]);
  });

  it("still works when the collector number is omitted", () => {
    const cards = parseDecklist("2 Lightning Bolt [SLD]");
    expect(cards).toEqual([{ name: "Lightning Bolt", quantity: 2, section: "mainboard" }]);
  });
});

describe("parseDecklist — TCGplayer collection-export CSV", () => {
  it("parses a TCGplayer CSV block pasted into the textarea", () => {
    const csv = [
      "Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID,SKU",
      '"2","Lightning Bolt","Lightning Bolt","Modern Horizons 2","138","MH2","Foil","Near Mint","English","Common","123456","7891011"',
      '"1","Counterspell","Counterspell","Kaladesh","50","KLD","Normal","Lightly Played","English","Common","1","2"',
    ].join("\n");
    const cards = parseDecklist(csv);
    expect(cards).toEqual([
      { name: "Lightning Bolt", quantity: 2, section: "mainboard" },
      { name: "Counterspell", quantity: 1, section: "mainboard" },
    ]);
  });
});

describe("parseDecklist — ManaBox collection-export CSV", () => {
  it("parses a ManaBox CSV block, whose Quantity column comes after Name unlike TCGplayer's", () => {
    const csv = [
      "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency",
      '"Sol Ring","C21","Commander 2021","263","normal","uncommon","3","1","abc-123","0.50","false","false","near_mint","en","USD"',
      '"Rhystic Study","PCY","Prophecy","P","normal","rare","1","2","def-456","20.00","false","false","near_mint","en","USD"',
    ].join("\n");
    const cards = parseDecklist(csv);
    expect(cards).toEqual([
      { name: "Sol Ring", quantity: 3, section: "mainboard" },
      { name: "Rhystic Study", quantity: 1, section: "mainboard" },
    ]);
  });

  it("handles a card name containing a comma correctly (quoted CSV field)", () => {
    const csv = [
      "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency",
      '"Muldrotha, the Gravetide","GRN","Guilds of Ravnica","199","normal","mythic","1","3","ghi-789","5.00","false","false","near_mint","en","USD"',
    ].join("\n");
    const cards = parseDecklist(csv);
    expect(cards).toEqual([{ name: "Muldrotha, the Gravetide", quantity: 1, section: "mainboard" }]);
  });
});

// Exports copied from the apps people use (the yard sale page's "Shop your
// deck" asks for any of these).

describe("parseDecklist — Moxfield", () => {
  it("reads its export with foil and etched marks and collector numbers after the set", () => {
    const cards = parseDecklist(
      [
        "1 Atraxa, Praetors' Voice (2X2) 190",
        "1 Arcane Signet (PLST) ELD-331",
        "1 Sol Ring (C21) 263 *F*",
        "1 Command Tower (CMM) 1013 *E*",
        "1 Swords to Plowshares (SLD) 1531★",
        "",
        "SIDEBOARD:",
        "1 Lurrus of the Dream-Den (IKO) 226",
      ].join("\n"),
    );
    expect(cards).toEqual([
      { name: "Atraxa, Praetors' Voice", quantity: 1, section: "mainboard" },
      { name: "Arcane Signet", quantity: 1, section: "mainboard" },
      { name: "Sol Ring", quantity: 1, section: "mainboard" },
      { name: "Command Tower", quantity: 1, section: "mainboard" },
      { name: "Swords to Plowshares", quantity: 1, section: "mainboard" },
      { name: "Lurrus of the Dream-Den", quantity: 1, section: "sideboard" },
    ]);
  });

  it("reads its MTG Arena copy, skipping the About block", () => {
    const cards = parseDecklist(
      [
        "About",
        "Name Atraxa Superfriends",
        "",
        "Commander",
        "1 Atraxa, Praetors' Voice (2X2) 190",
        "",
        "Deck",
        "1 Sol Ring (C21) 263",
        "1 Fable of the Mirror-Breaker (NEO) 141",
        "",
        "Sideboard",
        "1 Negate (M20) 69",
      ].join("\n"),
    );
    expect(cards).toEqual([
      { name: "Atraxa, Praetors' Voice", quantity: 1, section: "commander" },
      { name: "Sol Ring", quantity: 1, section: "mainboard" },
      { name: "Fable of the Mirror-Breaker", quantity: 1, section: "mainboard" },
      { name: "Negate", quantity: 1, section: "sideboard" },
    ]);
  });

  it("counts an Arena companion once, as a sideboard card", () => {
    const listedTwice = parseDecklist(
      "Companion\n1 Lurrus of the Dream-Den\n\nDeck\n4 Lightning Bolt (2XM) 141\n\nSideboard\n1 Lurrus of the Dream-Den\n2 Pyroblast (ICE) 213",
    );
    expect(listedTwice).toEqual([
      { name: "Lightning Bolt", quantity: 4, section: "mainboard" },
      { name: "Lurrus of the Dream-Den", quantity: 1, section: "sideboard" },
      { name: "Pyroblast", quantity: 2, section: "sideboard" },
    ]);
    const listedOnce = parseDecklist("Companion\n1 Lurrus of the Dream-Den\n\nDeck\n4 Lightning Bolt");
    expect(listedOnce).toEqual([
      { name: "Lurrus of the Dream-Den", quantity: 1, section: "sideboard" },
      { name: "Lightning Bolt", quantity: 4, section: "mainboard" },
    ]);
  });
});

describe("parseDecklist — Archidekt", () => {
  it("drops categories and labels, and files cards by their Commander, Sideboard and Maybeboard categories", () => {
    const cards = parseDecklist(
      [
        "1x Atraxa, Praetors' Voice (2x2) 190 [Commander{top}]",
        "1x Sol Ring (c21) 263 *F* [Ramp] ^Have,#37d67a^",
        "1x Swords to Plowshares (sta) 10 [Removal,Instant]",
        "1x Rhystic Study (pcy) 45 [Maybeboard{noDeck}{noPrice}]",
        "1x Negate (m20) 69 [Sideboard{noDeck}]",
        "1x Cultivate [Ramp]",
      ].join("\n"),
    );
    expect(cards).toEqual([
      { name: "Atraxa, Praetors' Voice", quantity: 1, section: "commander" },
      { name: "Sol Ring", quantity: 1, section: "mainboard" },
      { name: "Swords to Plowshares", quantity: 1, section: "mainboard" },
      { name: "Cultivate", quantity: 1, section: "mainboard" },
      { name: "Rhystic Study", quantity: 1, section: "maybeboard" },
      { name: "Negate", quantity: 1, section: "sideboard" },
    ]);
  });
});

describe("parseDecklist — MTGGoldfish and ManaBox text", () => {
  it("reads MTGGoldfish's text download, whose sideboard follows a blank line", () => {
    const cards = parseDecklist("4 Lightning Bolt\n4 Ragavan, Nimble Pilferer\n\n2 Pyroblast\n1 Blood Moon");
    expect(cards).toEqual([
      { name: "Lightning Bolt", quantity: 4, section: "mainboard" },
      { name: "Ragavan, Nimble Pilferer", quantity: 4, section: "mainboard" },
      { name: "Pyroblast", quantity: 2, section: "mainboard" },
      { name: "Blood Moon", quantity: 1, section: "mainboard" },
    ]);
  });

  it("reads ManaBox's deck text with foil marks", () => {
    const cards = parseDecklist("1 Sol Ring (C21) 263 *F*\n2 Counterspell (MH2) 267");
    expect(cards).toEqual([
      { name: "Sol Ring", quantity: 1, section: "mainboard" },
      { name: "Counterspell", quantity: 2, section: "mainboard" },
    ]);
  });
});

describe("parseDecklist — other shapes", () => {
  it("skips 'Creatures (23)'-style group headings but follows 'Sideboard (15)'", () => {
    const cards = parseDecklist(
      "Creatures (2)\n1 Ragavan, Nimble Pilferer\n1 Dragon's Rage Channeler\nLands (1)\n1 Mountain\nSideboard (1)\n1 Pyroblast",
    );
    expect(cards).toEqual([
      { name: "Ragavan, Nimble Pilferer", quantity: 1, section: "mainboard" },
      { name: "Dragon's Rage Channeler", quantity: 1, section: "mainboard" },
      { name: "Mountain", quantity: 1, section: "mainboard" },
      { name: "Pyroblast", quantity: 1, section: "sideboard" },
    ]);
  });

  it("reads old 'SB:' sideboard lines", () => {
    expect(parseDecklist("4 Lightning Bolt\nSB: 2 Negate")).toEqual([
      { name: "Lightning Bolt", quantity: 4, section: "mainboard" },
      { name: "Negate", quantity: 2, section: "sideboard" },
    ]);
  });

  it("keeps parentheses that are part of a card's name", () => {
    expect(parseDecklist("1 B.F.M. (Big Furry Monster) (UGL) 28")).toEqual([
      { name: "B.F.M. (Big Furry Monster)", quantity: 1, section: "mainboard" },
    ]);
  });

  it("writes names the way the shop does", () => {
    expect(normalizeDeckCardName("Jace\u2019s Erasure")).toBe("Jace's Erasure");
    expect(normalizeDeckCardName("Æther Vial")).toBe("Aether Vial");
    expect(normalizeDeckCardName("Fire / Ice")).toBe("Fire // Ice");
    expect(normalizeDeckCardName("Fire // Ice")).toBe("Fire // Ice");
    expect(normalizeDeckCardName("Who/What/When/Where/Why")).toBe("Who/What/When/Where/Why");
    expect(parseDecklist("1 Jace\u2019s Erasure")).toEqual([{ name: "Jace's Erasure", quantity: 1, section: "mainboard" }]);
  });
});

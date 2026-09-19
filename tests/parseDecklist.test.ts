import { describe, expect, it } from "vitest";
import { parseDecklist } from "../src/store/pages/MyDecksPage";

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

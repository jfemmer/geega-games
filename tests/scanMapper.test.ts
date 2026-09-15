import { describe, expect, it } from "vitest";
import {
  mapCardPrintingRow,
  mapCardScanRow,
  mapScanSessionRow,
  type CardPrintingRowLike,
  type CardScanRowLike,
  type ScanSessionRowLike,
} from "../src/admin/repositories/scan.mapper";

// Row <-> domain mapping for the live scan pipeline. These lock in the exact
// shape ScanReviewPage/ScanSessionsPage depend on, the same way
// storefrontCatalog.test.ts / inventorySupabase.test.ts do for their tables.

function sessionRow(overrides: Partial<ScanSessionRowLike> = {}): ScanSessionRowLike {
  return {
    id: "ses-1",
    label: "Scan Session #1",
    created_by: "jordan@geega-games.com",
    scanner_name: "Ricoh fi-8170",
    source_type: "scanner_export",
    status: "reviewing",
    total_files: 4,
    total_cards: 2,
    reviewed_cards: 1,
    matched_cards: 1,
    ready_cards: 1,
    added_cards: 0,
    rejected_cards: 0,
    failed_cards: 0,
    note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

describe("mapScanSessionRow", () => {
  it("maps every field to the domain ScanSession", () => {
    const s = mapScanSessionRow(sessionRow());
    expect(s.id).toBe("ses-1");
    expect(s.label).toBe("Scan Session #1");
    expect(s.scannerName).toBe("Ricoh fi-8170");
    expect(s.sourceType).toBe("scanner_export");
    expect(s.status).toBe("reviewing");
    expect(s.totalCards).toBe(2);
    expect(s.readyCards).toBe(1);
    expect(s.completedAt).toBeNull();
  });

  it("tolerates a null created_by (legacy/unknown actor)", () => {
    const s = mapScanSessionRow(sessionRow({ created_by: null }));
    expect(s.createdBy).toBe("");
  });
});

function printingRow(overrides: Partial<CardPrintingRowLike> = {}): CardPrintingRowLike {
  return {
    scryfall_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    oracle_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    card_name: "Lightning Bolt",
    set_code: "LEA",
    set_name: "Limited Edition Alpha",
    collector_number: "161",
    rarity: "common",
    card_type: "Instant",
    layout: "normal",
    artist: "Christopher Rush",
    released_at: "1993-08-05",
    language: "en",
    frame: "1993",
    frame_effects: [],
    border_color: "black",
    full_art: false,
    textless: false,
    promo: false,
    promo_types: [],
    treatments: [],
    available_finishes: ["nonfoil"],
    images: {
      small: "https://cards.scryfall.io/small/x.jpg",
      normal: "https://cards.scryfall.io/normal/x.jpg",
      large: "https://cards.scryfall.io/large/x.jpg",
      png: null,
      artCrop: "https://cards.scryfall.io/art_crop/x.jpg",
    },
    faces: [],
    price_usd_cents: 5000,
    price_usd_foil_cents: null,
    price_usd_etched_cents: null,
    ...overrides,
  };
}

describe("mapCardPrintingRow", () => {
  it("maps a fully-populated printing row", () => {
    const p = mapCardPrintingRow(printingRow());
    expect(p.scryfallId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(p.cardName).toBe("Lightning Bolt");
    expect(p.setCode).toBe("LEA");
    expect(p.collectorNumber).toBe("161");
    expect(p.availableFinishes).toEqual(["nonfoil"]);
    expect(p.imageUrl).toBe("https://cards.scryfall.io/normal/x.jpg");
    expect(p.prices.usd).toBe(5000);
  });

  it("falls back through image sizes when normal is missing", () => {
    const p = mapCardPrintingRow(
      printingRow({
        images: {
          small: "https://cards.scryfall.io/small/x.jpg",
          normal: null,
          large: null,
          png: null,
          artCrop: null,
        },
      }),
    );
    expect(p.imageUrl).toBe("https://cards.scryfall.io/small/x.jpg");
  });

  it("tolerates null images/faces JSON (never crashes)", () => {
    const p = mapCardPrintingRow(printingRow({ images: null, faces: null }));
    expect(p.imageUrl).toBe("");
    expect(p.faces).toEqual([]);
  });
});

describe("mapCardScanRow", () => {
  function scanRow(overrides: Partial<CardScanRowLike> = {}): CardScanRowLike {
    return {
      id: "scan-1",
      scan_session_id: "ses-1",
      sequence_number: 3,
      front_image_path: "ses-1/3-front-x.jpg",
      back_image_path: null,
      selected_scryfall_id: null,
      recognition_status: "none",
      recognition_confidence: null,
      recognition_data: null,
      suggested_condition: null,
      suggested_condition_confidence: null,
      confirmed_condition: null,
      selected_finish: null,
      quantity: 1,
      price_cents: null,
      cost_cents: null,
      storage_location: null,
      notes: null,
      review_status: "unreviewed",
      reviewed_by: null,
      reviewed_at: null,
      inventory_item_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      card_printings: null,
      ...overrides,
    };
  }

  it("maps a scan with no match yet, using the resolved image URLs passed in", () => {
    const s = mapCardScanRow(scanRow(), {
      frontImageUrl: "https://signed.example/front",
      backImageUrl: null,
    });
    expect(s.sequenceNumber).toBe(3);
    expect(s.frontImageUrl).toBe("https://signed.example/front");
    expect(s.backImageUrl).toBeNull();
    expect(s.selectedPrinting).toBeNull();
  });

  it("maps the embedded card_printings object into selectedPrinting", () => {
    const s = mapCardScanRow(
      scanRow({
        selected_scryfall_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        card_printings: printingRow(),
      }),
      { frontImageUrl: null, backImageUrl: null },
    );
    expect(s.selectedPrinting?.cardName).toBe("Lightning Bolt");
  });

  it("unwraps an embedded card_printings ARRAY (PostgREST left-join shape)", () => {
    const s = mapCardScanRow(
      scanRow({
        selected_scryfall_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        card_printings: [printingRow()],
      }),
      { frontImageUrl: null, backImageUrl: null },
    );
    expect(s.selectedPrinting?.cardName).toBe("Lightning Bolt");
  });
});

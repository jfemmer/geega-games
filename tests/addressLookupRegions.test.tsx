// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// The address search above the shipping form is Google's Places widget. We
// ship within the United States only, so it is told to suggest only the US
// and its territories (src/store/lib/usAddress.ts). Google's script is
// replaced here by a stand-in element, so this checks what the widget is
// *told*, and that the page still works if Google ever refuses the setting.

type Lookup = HTMLElement & { includedRegionCodes?: string[] };

let built: Lookup[] = [];

class FakePlaceAutocomplete extends HTMLElement {
  includedRegionCodes?: string[];
  constructor() {
    super();
    built.push(this);
  }
}
customElements.define("fake-place-autocomplete", FakePlaceAutocomplete);

// A Maps version that doesn't accept the setting.
class StrictPlaceAutocomplete extends HTMLElement {
  constructor() {
    super();
    built.push(this);
  }
  set includedRegionCodes(_codes: string[]) {
    throw new Error("Unknown property 'includedRegionCodes'");
  }
}
customElements.define("strict-place-autocomplete", StrictPlaceAutocomplete);

function useMaps(PlaceAutocompleteElement: typeof HTMLElement) {
  (window as unknown as { google: unknown }).google = {
    maps: { importLibrary: async () => ({ PlaceAutocompleteElement }) },
  };
}

const { default: GoogleAddressAutocomplete } = await import("../src/store/components/GoogleAddressAutocomplete");

beforeEach(() => {
  built = [];
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
});

describe("the address lookup", () => {
  it("suggests only the United States and its territories", async () => {
    useMaps(FakePlaceAutocomplete);
    render(<GoogleAddressAutocomplete onSelect={() => {}} />);

    await waitFor(() => expect(built).toHaveLength(1));
    expect(built[0].includedRegionCodes).toEqual(["us", "as", "gu", "mp", "pr", "vi"]);
    expect(await screen.findByText(/Start typing and choose an address from Google/)).toBeInTheDocument();
  });

  it("hands a picked address to the form", async () => {
    useMaps(FakePlaceAutocomplete);
    const onSelect = vi.fn();
    render(<GoogleAddressAutocomplete onSelect={onSelect} />);
    await screen.findByText(/Start typing and choose an address from Google/);

    const part = (types: string, longText: string, shortText = longText) => ({ types: [types], longText, shortText });
    const place = {
      addressComponents: [
        part("street_number", "123"),
        part("route", "Main Street", "Main St"),
        part("locality", "Ballwin"),
        part("administrative_area_level_1", "Missouri", "MO"),
        part("postal_code", "63011"),
        part("postal_code_suffix", "1234"),
        part("country", "United States", "US"),
      ],
      formattedAddress: "123 Main St, Ballwin, MO 63011, USA",
      fetchFields: async () => {},
    };
    built[0].dispatchEvent(Object.assign(new Event("gmp-select"), { placePrediction: { toPlace: () => place } }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith({
      line1: "123 Main Street",
      line2: "",
      city: "Ballwin",
      state: "MO",
      postalCode: "63011-1234",
      country: "US",
      formattedAddress: "123 Main St, Ballwin, MO 63011, USA",
    });
  });

  it("still works if Google won't take the setting", async () => {
    useMaps(StrictPlaceAutocomplete);
    const { container } = render(<GoogleAddressAutocomplete onSelect={() => {}} />);

    // The search box is built and shown all the same: suggestions are a
    // convenience, and the form and the server refuse a foreign address anyway.
    expect(await screen.findByText(/Start typing and choose an address from Google/)).toBeInTheDocument();
    expect(container.querySelector("strict-place-autocomplete")).not.toBeNull();
    expect(screen.queryByText(/Address suggestions are unavailable/)).toBeNull();
  });

  it("isn't shown at all without a Maps key: the plain fields are the form", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const { container } = render(<GoogleAddressAutocomplete onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

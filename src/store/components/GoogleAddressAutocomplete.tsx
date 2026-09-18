import { useEffect, useRef, useState } from "react";

export type ShippingAddressFields = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  formattedAddress?: string;
};

type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type GooglePlace = {
  addressComponents?: GoogleAddressComponent[];
  formattedAddress?: string;
  fetchFields: (request: { fields: string[] }) => Promise<void>;
};

type GooglePlacePredictionSelectEvent = Event & {
  placePrediction?: {
    toPlace: () => GooglePlace;
  };
};

type GoogleMapsWindow = Window & {
  google?: {
    maps?: {
      importLibrary?: (library: string) => Promise<Record<string, unknown>>;
    };
  };
  __geegaGoogleMapsReady?: () => void;
};

let googleMapsPlacesPromise: Promise<void> | null = null;

function loadGoogleMapsPlaces(apiKey: string): Promise<void> {
  const win = window as GoogleMapsWindow;
  if (win.google?.maps?.importLibrary) return Promise.resolve();
  if (googleMapsPlacesPromise) return googleMapsPlacesPromise;

  googleMapsPlacesPromise = new Promise<void>((resolve, reject) => {
    const callbackName = "__geegaGoogleMapsReady";
    const script = document.createElement("script");

    win[callbackName] = () => {
      delete win[callbackName];
      resolve();
    };

    script.dataset.geegaGoogleMaps = "places";
    script.async = true;
    script.defer = true;
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(apiKey)}` +
      "&loading=async&libraries=places&v=weekly" +
      `&callback=${callbackName}`;

    script.onerror = () => {
      delete win[callbackName];
      googleMapsPlacesPromise = null;
      reject(new Error("Google address lookup could not be loaded."));
    };

    document.head.appendChild(script);
  });

  return googleMapsPlacesPromise;
}

function componentValue(
  components: GoogleAddressComponent[],
  type: string,
  short = false,
): string {
  const component = components.find((item) => item.types?.includes(type));
  return (short ? component?.shortText : component?.longText) ?? "";
}

function parsePlace(place: GooglePlace): ShippingAddressFields {
  const components = place.addressComponents ?? [];
  const streetNumber = componentValue(components, "street_number");
  const route = componentValue(components, "route");
  const premise = componentValue(components, "premise");
  const subpremise = componentValue(components, "subpremise");

  const city =
    componentValue(components, "locality") ||
    componentValue(components, "postal_town") ||
    componentValue(components, "sublocality_level_1") ||
    componentValue(components, "administrative_area_level_2");

  const state =
    componentValue(components, "administrative_area_level_1", true) ||
    componentValue(components, "administrative_area_level_1");

  const postalBase = componentValue(components, "postal_code");
  const postalSuffix = componentValue(components, "postal_code_suffix");
  const postalCode =
    postalBase && postalSuffix ? `${postalBase}-${postalSuffix}` : postalBase;

  const country =
    componentValue(components, "country", true) ||
    componentValue(components, "country");

  return {
    line1: [streetNumber, route].filter(Boolean).join(" ").trim() || premise,
    line2: subpremise,
    city,
    state,
    postalCode,
    country,
    formattedAddress: place.formattedAddress,
  };
}

export default function GoogleAddressAutocomplete({
  onSelect,
}: {
  onSelect: (address: ShippingAddressFields) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "manual">("loading");

  useEffect(() => {
    let cancelled = false;
    let autocompleteElement: HTMLElement | null = null;
    let selectHandler: ((event: Event) => void) | null = null;

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!apiKey) {
      setStatus("manual");
      return;
    }

    void (async () => {
      try {
        await loadGoogleMapsPlaces(apiKey);
        if (cancelled || !hostRef.current) return;

        const win = window as GoogleMapsWindow;
        const placesLibrary = await win.google!.maps!.importLibrary!("places");
        const PlaceAutocompleteElement = placesLibrary.PlaceAutocompleteElement as new (
          options?: Record<string, unknown>,
        ) => HTMLElement & { placeholder?: string };

        autocompleteElement = new PlaceAutocompleteElement();
        autocompleteElement.style.width = "100%";
        autocompleteElement.setAttribute("aria-label", "Search for your shipping address");
        autocompleteElement.setAttribute("autocomplete", "shipping street-address");
        autocompleteElement.placeholder = "Start typing your street address";

        selectHandler = (event: Event) => {
          void (async () => {
            const selection = event as GooglePlacePredictionSelectEvent;
            if (!selection.placePrediction) return;

            const place = selection.placePrediction.toPlace();
            await place.fetchFields({
              fields: ["addressComponents", "formattedAddress"],
            });

            if (!cancelled) onSelect(parsePlace(place));
          })();
        };

        autocompleteElement.addEventListener("gmp-select", selectHandler);
        hostRef.current.replaceChildren(autocompleteElement);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("manual");
      }
    })();

    return () => {
      cancelled = true;
      if (autocompleteElement && selectHandler) {
        autocompleteElement.removeEventListener("gmp-select", selectHandler);
      }
    };
  }, [onSelect]);

  return (
    <div className="gg-address-lookup">
      <div ref={hostRef} className="gg-address-lookup__host" />
      {status === "loading" && (
        <p className="gg-card-meta gg-address-lookup__status">Loading address suggestions…</p>
      )}
      {status === "ready" && (
        <p className="gg-card-meta gg-address-lookup__status">
          Start typing and choose an address from Google. We&rsquo;ll fill in the fields below.
        </p>
      )}
      {status === "manual" && (
        <p className="gg-alert gg-alert-warn gg-address-lookup__status" role="status">
          Address suggestions are unavailable right now. Please enter your shipping address below.
        </p>
      )}
    </div>
  );
}

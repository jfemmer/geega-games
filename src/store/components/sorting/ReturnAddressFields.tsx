import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import GoogleAddressAutocomplete, { type ShippingAddressFields } from "../GoogleAddressAutocomplete";
import { UsStateSelect } from "../UsStateSelect";
import {
  SHIPS_TO_SUMMARY,
  US_ONLY_MESSAGE,
  US_ZIP_MESSAGE,
  checkUsAddress,
  isUsCountry,
  usStateFor,
  usZip,
} from "../../lib/usAddress";
import type { AddressForm, ReturnAddressState, SavedAddress } from "../../lib/sortingForm";

// Where a shipped collection goes back to, using the customer address
// system checkout uses: a signed-in customer picks one of their saved
// addresses (the account's address book, public.addresses) or types a new
// one, which is saved to their address book; a guest types one. Same US-only
// rules and the same Google address lookup as checkout.

export default function ReturnAddressFields({
  value,
  onChange,
  saved,
  signedIn,
}: {
  value: ReturnAddressState;
  /** The parent's state setter (takes updater functions, so the address lookup stays stable). */
  onChange: Dispatch<SetStateAction<ReturnAddressState>>;
  saved: SavedAddress[];
  signedIn: boolean;
}) {
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const [zipTouched, setZipTouched] = useState(false);

  const editForm = (patch: Partial<AddressForm>) => {
    setLookupNotice(null);
    onChange((prev) => ({ ...prev, form: { ...prev.form, ...patch } }));
  };

  // Stable for the address lookup widget (it re-mounts when this changes).
  const handleLookup = useCallback(
    (address: ShippingAddressFields) => {
      if (!isUsCountry(address.country)) {
        setLookupNotice(US_ONLY_MESSAGE);
        return;
      }
      setLookupNotice(null);
      onChange((prev) => ({
        ...prev,
        form: {
          ...prev.form,
          line1: address.line1,
          line2: address.line2 || prev.form.line2,
          city: address.city,
          // Google lists the territories as countries ("PR"); to the Postal
          // Service they are states.
          state: usStateFor(address.state, address.country) ?? "",
          postal_code: usZip(address.postalCode) ?? address.postalCode,
        },
      }));
    },
    [onChange],
  );

  const chosen = value.selected !== "new" ? saved.find((a) => a.id === value.selected) : undefined;
  const chosenProblem = chosen
    ? (() => {
        const check = checkUsAddress({ state: chosen.state, postalCode: chosen.postal_code, country: chosen.country });
        return check.ok ? null : check.message;
      })()
    : null;
  const zipInvalid = zipTouched && !!value.form.postal_code.trim() && usZip(value.form.postal_code) === null;

  return (
    <div className="gg-sort-address">
      {saved.length > 0 && (
        <div className="gg-field">
          <label htmlFor="sort-addr">Ship it back to</label>
          <select
            id="sort-addr"
            value={value.selected}
            onChange={(e) => {
              const selected = e.target.value;
              onChange((prev) => ({ ...prev, selected }));
            }}
          >
            {saved.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label ? `${a.label}: ` : ""}
                {a.recipient ? `${a.recipient} — ` : ""}
                {a.line1}, {a.city} {a.state}
              </option>
            ))}
            <option value="new">+ Use a new address</option>
          </select>
        </div>
      )}
      {chosenProblem && (
        <div className="gg-alert gg-alert-warn" role="alert">
          We can&rsquo;t ship back to this saved address. {chosenProblem} Choose another address or enter a new one.
        </div>
      )}
      {value.selected === "new" && (
        <div className="gg-sort-address__form">
          <GoogleAddressAutocomplete label="Find your address" onSelect={handleLookup} />
          {lookupNotice && (
            <div className="gg-alert gg-alert-warn" role="alert">
              {lookupNotice}
            </div>
          )}
          <div className="gg-form-grid">
            {(
              [
                ["recipient", "Name", "shipping name"],
                ["line1", "Address line 1", "shipping address-line1"],
                ["line2", "Address line 2 (optional)", "shipping address-line2"],
                ["city", "City", "shipping address-level2"],
              ] as const
            ).map(([field, label, autoComplete]) => (
              <div className="gg-field gg-field-span2" key={field}>
                <label htmlFor={`sort-${field}`}>{label}</label>
                <input
                  id={`sort-${field}`}
                  autoComplete={autoComplete}
                  value={value.form[field]}
                  onChange={(e) => editForm({ [field]: e.target.value })}
                />
              </div>
            ))}
            <div className="gg-field">
              <label htmlFor="sort-state">State</label>
              <UsStateSelect
                id="sort-state"
                autoComplete="shipping address-level1"
                value={value.form.state}
                onChange={(code) => editForm({ state: code })}
              />
            </div>
            <div className="gg-field">
              <label htmlFor="sort-postal">ZIP code</label>
              <input
                id="sort-postal"
                autoComplete="shipping postal-code"
                inputMode="numeric"
                maxLength={10}
                value={value.form.postal_code}
                onChange={(e) => editForm({ postal_code: e.target.value })}
                onBlur={() => setZipTouched(true)}
                aria-invalid={zipInvalid || undefined}
                aria-describedby={zipInvalid ? "sort-zip-hint" : undefined}
              />
              {zipInvalid && (
                <p id="sort-zip-hint" className="gg-field-error" role="alert">
                  {US_ZIP_MESSAGE}
                </p>
              )}
            </div>
          </div>
          <p className="gg-card-meta gg-ship-note">{SHIPS_TO_SUMMARY}</p>
          {signedIn && (
            <label className="gg-check">
              <input
                type="checkbox"
                checked={value.saveToBook}
                onChange={(e) => {
                  const saveToBook = e.target.checked;
                  onChange((prev) => ({ ...prev, saveToBook }));
                }}
              />
              Save this address to my account
            </label>
          )}
        </div>
      )}
    </div>
  );
}

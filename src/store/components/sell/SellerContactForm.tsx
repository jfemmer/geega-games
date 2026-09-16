import {
  SELL_TRANSACTION_PREFERENCE_OPTIONS,
  type SellContactInfo,
} from "../../lib/sellTypes";

export function SellerContactForm({
  value,
  onChange,
}: {
  value: SellContactInfo;
  onChange: (patch: Partial<SellContactInfo>) => void;
}) {
  return (
    <div className="gg-sellcontact">
      <div className="gg-form-grid">
        <div className="gg-field">
          <label htmlFor="sc-first">First name</label>
          <input
            id="sc-first"
            autoComplete="given-name"
            required
            value={value.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="sc-last">Last name</label>
          <input
            id="sc-last"
            autoComplete="family-name"
            required
            value={value.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
          />
        </div>
        <div className="gg-field gg-field-span2">
          <label htmlFor="sc-email">Email</label>
          <input
            id="sc-email"
            type="email"
            autoComplete="email"
            required
            value={value.email}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </div>
        <div className="gg-field gg-field-span2">
          <label htmlFor="sc-phone">Phone (optional, but helpful)</label>
          <input
            id="sc-phone"
            type="tel"
            autoComplete="tel"
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
          />
        </div>
      </div>

      <fieldset className="gg-sellcheckgroup">
        <legend>Preferred contact method</legend>
        <div className="gg-sellcheckgroup__grid">
          {(["email", "phone", "text"] as const).map((m) => (
            <label key={m} className="gg-check">
              <input
                type="radio"
                name="preferredContactMethod"
                checked={value.preferredContactMethod === m}
                onChange={() => onChange({ preferredContactMethod: m })}
              />
              {m === "email" ? "Email" : m === "phone" ? "Phone call" : "Text message"}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="gg-form-grid">
        <div className="gg-field">
          <label htmlFor="sc-city">City</label>
          <input
            id="sc-city"
            autoComplete="address-level2"
            value={value.city}
            onChange={(e) => onChange({ city: e.target.value })}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="sc-state">State</label>
          <input
            id="sc-state"
            autoComplete="address-level1"
            value={value.state}
            onChange={(e) => onChange({ state: e.target.value })}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="sc-zip">ZIP code</label>
          <input
            id="sc-zip"
            autoComplete="postal-code"
            inputMode="numeric"
            value={value.zip}
            onChange={(e) => onChange({ zip: e.target.value })}
          />
        </div>
      </div>
      <p className="gg-card-meta">
        Your city/state/ZIP helps us figure out whether an in-person meetup or shipping makes
        more sense — we never share or display this publicly.
      </p>

      <fieldset className="gg-sellcheckgroup">
        <legend>How would you prefer to sell the collection?</legend>
        <div className="gg-sellcheckgroup__grid">
          {SELL_TRANSACTION_PREFERENCE_OPTIONS.map((o) => (
            <label key={o.value} className="gg-check">
              <input
                type="radio"
                name="transactionPreference"
                checked={value.transactionPreference === o.value}
                onChange={() => onChange({ transactionPreference: o.value as SellContactInfo["transactionPreference"] })}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

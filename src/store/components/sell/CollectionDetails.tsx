import {
  SELL_COLLECTION_SIZE_OPTIONS,
  SELL_COLLECTION_TYPE_OPTIONS,
  SELL_ERA_OPTIONS,
  SELL_REFERRAL_OPTIONS,
  SELL_TIMELINE_OPTIONS,
  type SellCollectionInfo,
} from "../../lib/sellTypes";

// Collection-level details. Everything here is optional-leaning by design —
// a seller with a huge, unsorted collection often can't answer precisely,
// and "Not sure" is always a first-class, legitimate answer.

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function CollectionDetails({
  value,
  onChange,
}: {
  value: SellCollectionInfo;
  onChange: (patch: Partial<SellCollectionInfo>) => void;
}) {
  return (
    <div className="gg-selldetails">
      <div className="gg-field">
        <label htmlFor="cd-size">About how many cards are we talking about?</label>
        <select
          id="cd-size"
          value={value.collectionSize}
          onChange={(e) => onChange({ collectionSize: e.target.value })}
        >
          <option value="">Select an approximate size</option>
          {SELL_COLLECTION_SIZE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="gg-sellcheckgroup">
        <legend>What best describes the collection? (choose all that apply)</legend>
        <div className="gg-sellcheckgroup__grid">
          {SELL_COLLECTION_TYPE_OPTIONS.map((o) => (
            <label key={o.value} className="gg-check">
              <input
                type="checkbox"
                checked={value.collectionTypes.includes(o.value)}
                onChange={() => onChange({ collectionTypes: toggle(value.collectionTypes, o.value) })}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="gg-sellcheckgroup">
        <legend>Roughly what era are most of the cards from? (optional)</legend>
        <div className="gg-sellcheckgroup__grid">
          {SELL_ERA_OPTIONS.map((o) => (
            <label key={o.value} className="gg-check">
              <input
                type="checkbox"
                checked={value.collectionEras.includes(o.value)}
                onChange={() => onChange({ collectionEras: toggle(value.collectionEras, o.value) })}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="gg-field">
        <label htmlFor="cd-timeline">How soon are you looking to sell?</label>
        <select
          id="cd-timeline"
          value={value.timeline}
          onChange={(e) => onChange({ timeline: e.target.value })}
        >
          <option value="">Select one</option>
          {SELL_TIMELINE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="gg-field">
        <label htmlFor="cd-valuable">Any particularly valuable cards we should know about? (optional)</label>
        <input
          id="cd-valuable"
          type="text"
          placeholder="e.g. a couple of dual lands, an original Power 9 card, etc."
          value={value.valuableCardsNotes}
          onChange={(e) => onChange({ valuableCardsNotes: e.target.value })}
        />
      </div>

      <div className="gg-field">
        <label htmlFor="cd-notes">Anything else we should know about the collection? (optional)</label>
        <textarea
          id="cd-notes"
          rows={4}
          placeholder="Storage conditions, how it was acquired, anything that helps us understand what you have…"
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>

      <div className="gg-field">
        <label htmlFor="cd-referral">How did you hear about Geega Games? (optional)</label>
        <select
          id="cd-referral"
          value={value.referralSource}
          onChange={(e) => onChange({ referralSource: e.target.value })}
        >
          <option value="">Select one</option>
          {SELL_REFERRAL_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

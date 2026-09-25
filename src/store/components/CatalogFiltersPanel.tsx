import { Fragment, useState } from "react";
import {
  COLOR_COMBOS,
  COLOR_GROUPS,
  COLOR_LETTER_GROUP,
  DEFAULT_FILTERS,
  colorComboKey,
  colorComboValue,
  countActiveFilters,
  type CatalogFilters,
  type CatalogListFilterKey,
  type Facets,
} from "../lib/useCatalog";

// Shared filter sidebar for the Shop page and the in-store Kiosk (desktop
// aside + mobile drawer on both). Option lists for Set / Rarity / Card type /
// Creature type come from inventory_facets (in-stock only); Color and
// Condition are fixed vocabularies so every option is always offered; the
// named multicolor combinations under Multicolor only list those in stock.

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];

/** Show a search box above the creature-type list once it gets long. */
const CREATURE_SEARCH_THRESHOLD = 12;

type Props = {
  facets: Facets | null;
  filters: CatalogFilters;
  setFilters: React.Dispatch<React.SetStateAction<CatalogFilters>>;
};

export default function CatalogFiltersPanel({ facets, filters, setFilters }: Props) {
  const [creatureSearch, setCreatureSearch] = useState("");
  const activeFilterCount = countActiveFilters(filters);

  const toggle = (key: CatalogListFilterKey, value: string) => {
    setFilters((f) => {
      const arr = f[key];
      return {
        ...f,
        [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
      };
    });
  };

  const checkbox = (key: CatalogListFilterKey, value: string, label: React.ReactNode) => (
    <label className="gg-check" key={value}>
      <input
        type="checkbox"
        checked={filters[key].includes(value)}
        onChange={() => toggle(key, value)}
      />
      {label}
    </label>
  );

  // Keep a selected creature type visible even if it drops out of stock (or
  // out of the search box's matches) so it can still be unchecked.
  const creatureOptions = Array.from(
    new Set([...(facets?.creatureTypes ?? []), ...filters.creatureTypes]),
  ).sort((a, b) => a.localeCompare(b));
  const creatureNeedle = creatureSearch.trim().toLowerCase();
  const visibleCreatureTypes = creatureNeedle
    ? creatureOptions.filter(
        (t) => t.toLowerCase().includes(creatureNeedle) || filters.creatureTypes.includes(t),
      )
    : creatureOptions;

  // Named multicolor combinations (Dimir, Grixis, ...) that are in stock, plus
  // any already selected, in the conventional guild/shard/wedge order.
  const stockedComboKeys = new Set(facets?.colorCombos ?? []);
  const comboOptions = COLOR_COMBOS.filter((combo) => {
    const value = colorComboValue(combo.colors);
    return stockedComboKeys.has(colorComboKey(combo.colors)) || filters.colorGroups.includes(value);
  });

  const cardTypeOptions = Array.from(
    new Set([...(facets?.cardTypes ?? []), ...filters.cardTypes]),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <>
      <div className="gg-filter-group">
        <h3>Color</h3>
        {COLOR_GROUPS.map((c) => (
          <Fragment key={c.value}>
            {checkbox(
              "colorGroups",
              c.value,
              <>
                <span className={`gg-color-dot gg-color-dot-${c.value}`} aria-hidden="true" />
                {c.label}
              </>,
            )}
            {c.value === "multicolor" && comboOptions.length > 0 && (
              <div className="gg-filter-sublist" role="group" aria-label="Color combinations">
                {comboOptions.map((combo) =>
                  checkbox(
                    "colorGroups",
                    colorComboValue(combo.colors),
                    <>
                      <span className="gg-color-dots" aria-hidden="true">
                        {combo.colors.map((l) => (
                          <span key={l} className={`gg-color-dot gg-color-dot-${COLOR_LETTER_GROUP[l]}`} />
                        ))}
                      </span>
                      {combo.name}
                    </>,
                  ),
                )}
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {cardTypeOptions.length > 0 && (
        <div className="gg-filter-group">
          <h3>Card type</h3>
          {cardTypeOptions.map((t) => checkbox("cardTypes", t, t))}
        </div>
      )}
      {creatureOptions.length > 0 && (
        <div className="gg-filter-group">
          <h3>Creature type</h3>
          {creatureOptions.length > CREATURE_SEARCH_THRESHOLD && (
            <input
              type="search"
              className="gg-filter-search"
              placeholder="Search creature types"
              aria-label="Search creature types"
              value={creatureSearch}
              onChange={(e) => setCreatureSearch(e.target.value)}
            />
          )}
          <div className="gg-filter-scroll">
            {visibleCreatureTypes.map((t) => checkbox("creatureTypes", t, t))}
            {visibleCreatureTypes.length === 0 && (
              <p className="gg-filter-empty">No matching creature types.</p>
            )}
          </div>
        </div>
      )}
      {facets?.sets && facets.sets.length > 0 && (
        <div className="gg-filter-group">
          <h3>Set</h3>
          {facets.sets.slice(0, 30).map((s) => checkbox("sets", s.code, s.name))}
        </div>
      )}
      {facets?.rarities && facets.rarities.length > 0 && (
        <div className="gg-filter-group">
          <h3>Rarity</h3>
          {facets.rarities.map((r) => checkbox("rarities", r, r))}
        </div>
      )}
      <div className="gg-filter-group">
        <h3>Condition</h3>
        {CONDITIONS.map((c) => checkbox("conditions", c, c))}
      </div>
      {activeFilterCount > 0 && (
        <button
          className="gg-btn gg-btn-ghost gg-btn-sm"
          onClick={() => {
            setCreatureSearch("");
            setFilters(DEFAULT_FILTERS);
          }}
        >
          Clear filters ({activeFilterCount})
        </button>
      )}
    </>
  );
}

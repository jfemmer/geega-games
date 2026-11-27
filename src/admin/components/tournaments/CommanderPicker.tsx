import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../ui/Icon";
import { MAX_COMMANDER_NAME, commanderImageUrl, type TournamentCommander } from "../../utils/tournament";

// A commander name box with suggestions from Scryfall (commanders only, most
// played first). Picking a suggestion keeps its card for the picture; typing
// a name without picking (a partner pair, say) keeps just the name. Used by
// the player display (/tournament) and the admin Edit dialog, each passing
// its own search.

export interface CommanderOption {
  name: string;
  cardId: string;
}

const SEARCH_DELAY_MS = 250;

export function CommanderPicker({
  label,
  value,
  onChange,
  search,
  autoFocus,
  disabled,
}: {
  label: string;
  value: TournamentCommander | null;
  onChange: (commander: TournamentCommander | null) => void;
  search: (query: string) => Promise<CommanderOption[]>;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.name ?? "");
  const [options, setOptions] = useState<CommanderOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function lookUp(query: string) {
    if (timer.current) clearTimeout(timer.current);
    latest.current = query;
    if (query.trim().length < 2) {
      setOptions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      search(query)
        .then((found) => {
          if (latest.current !== query) return;
          setOptions(found);
          setActive(found.length > 0 ? 0 : -1);
          setOpen(true);
          setFailed(false);
        })
        .catch(() => {
          if (latest.current !== query) return;
          setOptions([]);
          setFailed(true);
          setOpen(true);
        })
        .finally(() => {
          if (latest.current === query) setLoading(false);
        });
    }, SEARCH_DELAY_MS);
  }

  function type(next: string) {
    setText(next);
    const name = next.replace(/\s+/g, " ").trim();
    onChange(name ? { name, cardId: null } : null);
    lookUp(next);
  }

  function pick(option: CommanderOption) {
    latest.current = "";
    setText(option.name);
    onChange({ name: option.name, cardId: option.cardId });
    setOpen(false);
    setOptions([]);
  }

  function clear() {
    latest.current = "";
    setText("");
    onChange(null);
    setOpen(false);
    setOptions([]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && (options.length > 0 || failed || (!loading && text.trim().length >= 2));

  return (
    <div className="gg-field gg-cmdpick">
      <label className="gg-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="gg-cmdpick__row">
        {value?.cardId ? (
          <img className="gg-cmdpick__thumb" src={commanderImageUrl(value.cardId)} alt="" loading="lazy" />
        ) : (
          <span className="gg-cmdpick__thumb gg-cmdpick__thumb--empty" aria-hidden="true">
            <Icon name="cards" size={18} />
          </span>
        )}
        <div className="gg-cmdpick__inputwrap">
          <input
            id={id}
            className="gg-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            value={text}
            maxLength={MAX_COMMANDER_NAME}
            placeholder="Search for a commander"
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            autoFocus={autoFocus}
            disabled={disabled}
            onChange={(e) => type(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (options.length > 0) setOpen(true);
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {loading && <span className="gg-spinner gg-cmdpick__spinner" aria-hidden="true" />}
          {!loading && text && !disabled && (
            <button type="button" className="gg-cmdpick__clear" aria-label="Clear commander" onClick={clear}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>
      {showList && (
        <ul className="gg-cmdpick__list" id={listId} role="listbox" aria-label="Commanders">
          {options.map((o, i) => (
            <li
              key={o.cardId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`gg-cmdpick__option ${i === active ? "is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              <img src={commanderImageUrl(o.cardId)} alt="" loading="lazy" />
              <span>{o.name}</span>
            </li>
          ))}
          {options.length === 0 && (
            <li className="gg-cmdpick__none" role="presentation">
              {failed ? "Search isn't working right now. You can still type the name." : "No commanders match. You can still save what you typed."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

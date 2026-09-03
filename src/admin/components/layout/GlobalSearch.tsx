import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { Icon, type IconName } from "../ui/Icon";
import { SearchInput } from "../ui/Field";
import { NAV_ITEMS } from "./nav";
import { inventoryRepository, orderRepository, userRepository } from "../../repositories";
import { ADMIN_BASE } from "../../hooks/useRouter";

interface SearchResult {
  id: string;
  label: string;
  sub: string;
  icon: IconName;
  path: string;
}

export function GlobalSearch({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const navMatches = useMemo<SearchResult[]>(() => {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    return NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(q)).map(
      (n) => ({
        id: `nav_${n.key}`,
        label: n.label,
        sub: "Go to section",
        icon: n.icon,
        path: n.path,
      }),
    );
  }, [term]);

  useEffect(() => {
    let active = true;
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    (async () => {
      const [inv, orders, customers] = await Promise.all([
        inventoryRepository.list({ search: q, pageSize: 4 }),
        orderRepository.list({ search: q }),
        userRepository.listCustomers({ search: q }),
      ]);
      if (!active) return;
      const out: SearchResult[] = [
        ...inv.rows.slice(0, 4).map((i) => ({
          id: `inv_${i.id}`,
          label: i.cardName,
          sub: `${i.setCode} · ${i.condition} · ${i.finish}`,
          icon: "inventory" as IconName,
          path: `${ADMIN_BASE}/inventory?item=${i.id}`,
        })),
        ...orders.slice(0, 4).map((o) => ({
          id: `ord_${o.id}`,
          label: `${o.orderNumber} — ${o.customerName}`,
          sub: "Order",
          icon: "orders" as IconName,
          path: `${ADMIN_BASE}/orders?order=${o.id}`,
        })),
        ...customers.slice(0, 4).map((c) => ({
          id: `cus_${c.id}`,
          label: `${c.firstName} ${c.lastName}`,
          sub: c.email,
          icon: "user" as IconName,
          path: `${ADMIN_BASE}/users?customer=${c.id}`,
        })),
      ];
      setResults(out);
    })();
    return () => {
      active = false;
    };
  }, [term]);

  const all = [...navMatches, ...results];

  return (
    <Modal open={open} onClose={onClose} title="Search" size="md">
      <div className="gg-globalsearch">
        <SearchInput
          label="Search cards, orders, and customers"
          placeholder="Search cards, orders, customers…"
          value={term}
          autoFocus
          onChange={(e) => setTerm(e.target.value)}
        />
        {term.trim().length < 2 && (
          <p className="gg-globalsearch__hint">
            Type at least two characters to search across inventory, orders, and
            customers.
          </p>
        )}
        {term.trim().length >= 2 && all.length === 0 && (
          <p className="gg-globalsearch__hint">
            No matches for “{term}”. Try a card name, order number, or email.
          </p>
        )}
        <ul className="gg-globalsearch__results">
          {all.map((r) => (
            <li key={r.id}>
              <button
                className="gg-globalsearch__result"
                onClick={() => {
                  onNavigate(r.path);
                  onClose();
                }}
              >
                <span className="gg-globalsearch__icon">
                  <Icon name={r.icon} size={17} />
                </span>
                <span className="gg-globalsearch__text">
                  <span className="gg-globalsearch__label">{r.label}</span>
                  <span className="gg-globalsearch__sub">{r.sub}</span>
                </span>
                <Icon name="chevronRight" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

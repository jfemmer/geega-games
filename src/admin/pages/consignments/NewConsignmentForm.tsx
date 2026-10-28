import { useEffect, useState } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { useToast } from "../../hooks/useToast";
import { userRepository } from "../../repositories";
import type { Customer } from "../../types";
import { consignmentAdminApi } from "./consignmentAdminApi";

// New consignment: pick an existing customer (fills in their name and email)
// or type a new consignor's details. The consignment starts as a draft; the
// agreement is sent from its page.

const STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["PR", "Puerto Rico"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

const EMPTY = { legalName: "", email: "", phone: "", addressLine1: "", addressLine2: "", city: "", stateCode: "", postalCode: "", adminNotes: "" };

export function NewConsignmentForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      userRepository
        .listCustomers({ search: q })
        .then((rows) => !cancelled && setMatches(rows.slice(0, 6)))
        .catch(() => !cancelled && setMatches([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [search]);

  function pick(c: Customer) {
    setForm((f) => ({ ...f, email: c.email, legalName: f.legalName || `${c.firstName} ${c.lastName}`.trim() }));
    setSearch("");
    setMatches([]);
  }

  async function save() {
    if (!form.legalName.trim() || !form.email.trim()) {
      toast.error("Enter the consignor's full legal name and email.");
      return;
    }
    setSaving(true);
    try {
      const c = await consignmentAdminApi.create({
        consignor: {
          legalName: form.legalName,
          email: form.email,
          phone: form.phone || undefined,
          addressLine1: form.addressLine1 || undefined,
          addressLine2: form.addressLine2 || undefined,
          city: form.city || undefined,
          stateCode: form.stateCode || undefined,
          postalCode: form.postalCode || undefined,
        },
        adminNotes: form.adminNotes || undefined,
      });
      toast.success(`${c.label} created. Send the agreement when you're ready.`);
      onCreated(c.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the consignment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="New consignment">
      <div className="gg-cs">
        <div className="gg-cn-picker">
          <TextField
            label="Find an existing customer (optional)"
            placeholder="Name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            hint="Picking a customer links the consignment to their account."
          />
          {matches.length > 0 && (
            <ul className="gg-cn-matches" role="listbox" aria-label="Matching customers">
              {matches.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => pick(c)}>
                    <strong>{`${c.firstName} ${c.lastName}`.trim() || "No name"}</strong> <span>{c.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="gg-cs-row">
          <TextField label="Full legal name" required value={form.legalName} onChange={set("legalName")} autoComplete="off" />
          <TextField label="Email" type="email" required value={form.email} onChange={set("email")} autoComplete="off" />
          <TextField label="Phone" type="tel" value={form.phone} onChange={set("phone")} />
        </div>
        <div className="gg-cs-row">
          <TextField label="Mailing address" value={form.addressLine1} onChange={set("addressLine1")} />
          <TextField label="Address line 2" value={form.addressLine2} onChange={set("addressLine2")} />
        </div>
        <div className="gg-cs-row">
          <TextField label="City" value={form.city} onChange={set("city")} />
          <SelectField label="State of residence" value={form.stateCode} onChange={set("stateCode")}>
            <option value="">Choose…</option>
            {STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </SelectField>
          <TextField label="ZIP code" inputMode="numeric" value={form.postalCode} onChange={set("postalCode")} />
        </div>
        <TextArea label="Internal notes (staff only)" value={form.adminNotes} onChange={set("adminNotes")} rows={3} />
        <div className="gg-btn-row">
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            Create consignment
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

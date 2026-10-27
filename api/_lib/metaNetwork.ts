// Meta's own network (AS32934): Facebook's and Instagram's servers. Requests
// from it are Meta's systems loading a page (link previews, link safety
// checks, ad and page review), never a person browsing: someone tapping a
// link in the Facebook app arrives from their own phone's connection. Used
// by /api/track to leave them out of visitor statistics.
//
// The prefixes Meta announces for AS32934 (Meta lists them with
// `whois -h whois.radb.net -- '-i origin AS32934'`). A prefix missing here
// only means a machine visit gets the storefront's other check (no
// interaction, no second page) instead of this one.

const META_IPV4 = [
  "31.13.24.0/21",
  "31.13.64.0/18",
  "45.64.40.0/22",
  "57.144.0.0/14",
  "66.220.144.0/20",
  "69.63.176.0/20",
  "69.171.224.0/19",
  "74.119.76.0/22",
  "102.132.96.0/20",
  "103.4.96.0/22",
  "129.134.0.0/16",
  "147.75.208.0/20",
  "157.240.0.0/16",
  "163.70.128.0/17",
  "163.77.128.0/17",
  "173.252.64.0/18",
  "179.60.192.0/22",
  "185.60.216.0/22",
  "185.89.216.0/22",
  "199.201.64.0/22",
  "204.15.20.0/22",
];

const META_IPV6 = ["2620:0:1c00::/40", "2620:10d:c090::/44", "2a03:2880::/29"];

/** "203.0.113.7" → 32-bit number, or null. */
function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** An IPv6 address as eight 16-bit groups ("::" expanded, an embedded IPv4 tail allowed), or null. */
function ipv6Groups(ip: string): number[] | null {
  const raw = ip.split("%")[0].toLowerCase();
  if (!raw.includes(":")) return null;
  let head = raw;
  const tail: number[] = [];
  const v4 = raw.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const n = ipv4ToNumber(v4[2]);
    if (n === null) return null;
    tail.push(Math.floor(n / 65536), n % 65536);
    // "::ffff:" → "::ffff"; a bare "::" before the IPv4 part stays as it is.
    head = v4[1].endsWith("::") ? v4[1] : v4[1].slice(0, -1);
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(":") : []);
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  const groups = [...left, ...right].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (groups.some(Number.isNaN)) return null;
  const known = groups.length + tail.length;
  if (halves.length === 1 && known !== 8) return null;
  if (halves.length === 2 && known > 7) return null;
  const zeros = new Array(8 - known).fill(0);
  return [...groups.slice(0, left.length), ...zeros, ...groups.slice(left.length), ...tail];
}

function inIpv4Range(ip: number, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const start = ipv4ToNumber(base);
  const bits = Number(bitsRaw);
  if (start === null) return false;
  const size = 2 ** (32 - bits);
  return ip >= start && ip < start + size;
}

function inIpv6Range(ip: number[], cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const start = ipv6Groups(base);
  let bits = Number(bitsRaw);
  if (!start) return false;
  for (let i = 0; i < 8 && bits > 0; i++) {
    const take = Math.min(bits, 16);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((ip[i] & mask) !== (start[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

/** True when the address belongs to Meta's network (IPv4, IPv6, or IPv4 written as IPv6). */
export function isMetaNetwork(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const address = ip.trim();
  const v4 = ipv4ToNumber(address);
  if (v4 !== null) return META_IPV4.some((cidr) => inIpv4Range(v4, cidr));
  const v6 = ipv6Groups(address);
  if (!v6) return false;
  // ::ffff:a.b.c.d — an IPv4 address carried over IPv6.
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    const mapped = v6[6] * 65536 + v6[7];
    return META_IPV4.some((cidr) => inIpv4Range(mapped, cidr));
  }
  return META_IPV6.some((cidr) => inIpv6Range(v6, cidr));
}

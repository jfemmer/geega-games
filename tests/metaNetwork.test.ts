import { describe, expect, it } from "vitest";
import { isMetaNetwork } from "../api/_lib/metaNetwork";

describe("isMetaNetwork", () => {
  it("knows Meta's IPv4 ranges, including their edges", () => {
    expect(isMetaNetwork("173.252.107.19")).toBe(true);
    expect(isMetaNetwork("157.240.0.0")).toBe(true);
    expect(isMetaNetwork("157.240.255.255")).toBe(true);
    expect(isMetaNetwork("57.147.255.255")).toBe(true); // 57.144.0.0/14
    expect(isMetaNetwork("31.13.24.1")).toBe(true);
    expect(isMetaNetwork("69.171.250.7")).toBe(true);
    // Just outside.
    expect(isMetaNetwork("157.239.255.255")).toBe(false);
    expect(isMetaNetwork("157.241.0.0")).toBe(false);
    expect(isMetaNetwork("57.148.0.0")).toBe(false);
    expect(isMetaNetwork("173.252.128.0")).toBe(false);
  });

  it("knows Meta's IPv6 ranges, however they're written", () => {
    expect(isMetaNetwork("2a03:2880:f12f:83:face:b00c::25de")).toBe(true);
    expect(isMetaNetwork("2A03:2887:FFFF::1")).toBe(true); // the end of 2a03:2880::/29
    expect(isMetaNetwork("2a03:2880::")).toBe(true);
    expect(isMetaNetwork("2620:10d:c09f:ffff::1")).toBe(true); // 2620:10d:c090::/44
    expect(isMetaNetwork("2620:0:1cff:1::1")).toBe(true); // 2620:0:1c00::/40
    expect(isMetaNetwork("fe80::1%eth0")).toBe(false);
    expect(isMetaNetwork("2a03:2888::1")).toBe(false);
    expect(isMetaNetwork("2620:10d:c0a0::1")).toBe(false);
    expect(isMetaNetwork("2001:db8::1")).toBe(false);
  });

  it("recognises an IPv4 address carried over IPv6", () => {
    expect(isMetaNetwork("::ffff:157.240.22.35")).toBe(true);
    expect(isMetaNetwork("::ffff:9df0:1623")).toBe(true); // 157.240.22.35 in hex
    expect(isMetaNetwork("::ffff:9d0f:1623")).toBe(false); // 157.15.22.35
    expect(isMetaNetwork("::ffff:203.0.113.7")).toBe(false);
  });

  it("is false for people's networks, junk and nothing", () => {
    expect(isMetaNetwork("172.58.10.20")).toBe(false); // a phone carrier
    expect(isMetaNetwork("203.0.113.7")).toBe(false);
    expect(isMetaNetwork("unknown")).toBe(false);
    expect(isMetaNetwork("")).toBe(false);
    expect(isMetaNetwork(null)).toBe(false);
    expect(isMetaNetwork(undefined)).toBe(false);
    expect(isMetaNetwork("999.240.1.1")).toBe(false);
    expect(isMetaNetwork("157.240.1")).toBe(false);
    expect(isMetaNetwork("2a03:2880::zz")).toBe(false);
    expect(isMetaNetwork("2a03:2880::1::2")).toBe(false);
    expect(isMetaNetwork("1:2:3:4:5:6:7:8:9")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { getVendorSearchLinks } from "@/lib/vendorCategories";

describe("vendor search links", () => {
  it("creates city- and category-specific links for each supported destination", () => {
    const links = getVendorSearchLinks("Belagavi", "photographers");

    expect(links).toHaveLength(4);
    expect(links.map((link) => link.id)).toEqual(["web", "maps", "justdial", "wedmegood"]);
    expect(decodeURIComponent(links[0].url)).toContain("wedding and event photographers in Belagavi");
    expect(decodeURIComponent(links[1].url)).toContain("wedding and event photographers in Belagavi");
    expect(decodeURIComponent(links[2].url)).toContain("site:justdial.com");
    expect(decodeURIComponent(links[2].url)).toContain("Belagavi");
    expect(decodeURIComponent(links[3].url)).toContain("site:wedmegood.com");
    expect(decodeURIComponent(links[3].url)).toContain("Belagavi");
  });

  it("encodes spaces and special characters in the city", () => {
    const links = getVendorSearchLinks("Bengaluru & Mysuru", "venues");

    expect(links[0].url).toContain("Bengaluru%20%26%20Mysuru");
    expect(links[1].url).toContain("Bengaluru%20%26%20Mysuru");
  });

  it("returns no links for an empty city or unknown category", () => {
    expect(getVendorSearchLinks("  ", "all")).toEqual([]);
    expect(getVendorSearchLinks("Belagavi", "unknown")).toEqual([]);
  });
});

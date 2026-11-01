export const VENDOR_CATEGORIES = [
  { id: "all", label: "All vendors", search: "wedding and event vendors including venues, caterers, photographers, decorators" },
  { id: "venues", label: "Venues", search: "wedding venues and banquet halls" },
  { id: "caterers", label: "Caterers", search: "wedding and event caterers" },
  { id: "decorators", label: "Decorators & florists", search: "wedding decorators and event florists" },
  { id: "photographers", label: "Photographers", search: "wedding and event photographers" },
  { id: "entertainment", label: "Entertainment", search: "event DJs and live music bands" },
  { id: "event-planners", label: "Event planners", search: "wedding and event planners" },
  { id: "bakeries", label: "Bakeries", search: "wedding cake bakeries" },
  { id: "beauty", label: "Beauty & styling", search: "bridal makeup artists and hair stylists" },
  { id: "rentals", label: "Rentals & party supplies", search: "event furniture and party equipment rentals" },
  { id: "transport", label: "Transport", search: "event transport and car rentals" },
  { id: "restaurants", label: "Restaurants", search: "restaurants for private events" },
] as const;

export type VendorCategoryId = (typeof VENDOR_CATEGORIES)[number]["id"];

export function getVendorCategory(id: string) {
  return VENDOR_CATEGORIES.find((category) => category.id === id);
}

export function getVendorSearchLinks(city: string, categoryId: string) {
  const category = getVendorCategory(categoryId);
  const normalizedCity = city.trim();
  if (!category || !normalizedCity) return [];

  const query = `${category.search} in ${normalizedCity}`;
  const directoryQuery = (domain: string) => `site:${domain} ${query}`;
  const googleSearch = (searchQuery: string) =>
    `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

  return [
    {
      id: "web",
      label: "Search the web",
      description: "Browse general search results",
      url: googleSearch(query),
    },
    {
      id: "maps",
      label: "Search Google Maps",
      description: "Explore nearby places on a map",
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    },
    {
      id: "justdial",
      label: "Search Justdial",
      description: "Find local business listings",
      url: googleSearch(directoryQuery("justdial.com")),
    },
    {
      id: "wedmegood",
      label: "Search WedMeGood",
      description: "Browse wedding vendor listings",
      url: googleSearch(directoryQuery("wedmegood.com")),
    },
  ];
}

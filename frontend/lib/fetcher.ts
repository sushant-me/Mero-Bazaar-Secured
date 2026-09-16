import { adaptListing } from "./adapter";
import { toSecondhandDetail } from "./adapters/secondhandAdapters";
import type { ListingDetail, SecondhandDetail, RelatedListing } from "../app/types/listing";
import type { DBListing } from "../app/types/vehicle";
import type { SecondhandListing } from "../app/types/secondhand";

type RawListing = DBListing | SecondhandListing;

export async function fetchListing(id: string): Promise<ListingDetail | SecondhandDetail | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/listings/${id}`,
      { next: { revalidate: 0 } }
    );

    if (!res.ok) {
      console.error("[fetchListing] HTTP error:", res.status);
      return null;
    }

    const raw = (await res.json()) as RawListing;

    if (!raw) {
      console.error("[fetchListing] empty response");
      return null;
    }

    switch (raw.category) {
      case "SECONDHAND":
        return toSecondhandDetail(raw);
      case "VEHICLE":
        return adaptListing(raw);
      default: {
        const _exhaustive: never = raw;
        console.error("[fetchListing] unhandled category:", (raw as RawListing).category);
        return null;
      }
    }
  } catch (err) {
    console.error("[fetchListing] failed:", err);
    return null;
  }
}

// Forward-geocode a typed address string into lat/lng. Nominatim's usage policy caps requests at 1/sec
export async function forwardGeocode(address: string): Promise<{ latitude: number | null; longitude: number | null }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { "User-Agent": "MeroBazaar/1.0" } }
    );
    const results = await res.json();
    const first = results?.[0];

    if (!first) {
      console.warn("[forwardGeocode] no match for address:", address);
      return { latitude: null, longitude: null };
    }

    return { latitude: parseFloat(first.lat), longitude: parseFloat(first.lon) };
  } catch (err) {
    console.error("[forwardGeocode] failed:", err);
    return { latitude: null, longitude: null };
  }
}

// Reverse-geocode a single lat/lng pair into a readable location string. Nominatim's usage policy caps requests at 1/sec
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers: { "User-Agent": "MeroBazaar/1.0" } }
    );
    const geo = await res.json();
    return geo?.address?.suburb || geo?.address?.city || geo?.display_name || "Nepal";
  } catch {
    return "Nepal";
  }
}

// Fetch related listings
export async function fetchRelatedListings(
  category: string | null | undefined,
  excludeId: string
): Promise<RelatedListing[]> {
  try {
    if (!category) {
      console.warn("[fetchRelatedListings] missing category");
      return [];
    }

    const safeCategory = category.toUpperCase();
    const query = new URLSearchParams({
      category: safeCategory,
      exclude: excludeId,
      limit: "8",
    });
    const IMG_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/listings/related?${query.toString()}`,
      {
        next: { revalidate: 60 },
      }
    );

    if (!res.ok) {
      console.error("[fetchRelatedListings] HTTP error:", res.status);
      return [];
    }

    const data = (await res.json()) as Array<{
      id: string;
      title: string;
      price: number | null;
      latitude?: number | null;
      longitude?: number | null;
      images: string[];
      vehicle?: { bluebook_status: string };
    }>;
    if (!Array.isArray(data)) return [];

    const results: RelatedListing[] = [];
    for (const item of data) {
      const location =
        item.latitude != null && item.longitude != null
          ? await reverseGeocode(item.latitude, item.longitude)
          : "Nepal";

      results.push({
        id: item.id,
        title: item.title,
        price:
          item.price != null
            ? `Rs. ${item.price.toLocaleString("en-IN")}`
            : "Price on request",
        location,
        image: item.images?.[0] ? `${IMG_BASE}${item.images[0]}` : "/placeholder.png",
        verified: item.vehicle?.bluebook_status === "verified",
      });
    }

    return results;
  } catch (err) {
    console.error("[fetchRelatedListings] failed:", err);
    return [];
  }
}

export type TargetField =
  | "type"
  | "location_city"
  | "location_district"
  | "price"
  | "currency"
  | "rooms"
  | "size_sqm"
  | "contact_phone"
  | "contact_name"
  | "contact_channel"
  | "external_id"
  | "media"
  | "language";

export const REQUIRED_FIELDS: TargetField[] = [
  "type",
  "location_city",
  "price",
  "currency",
  "rooms",
];

export type FieldMapping = Partial<Record<TargetField, string | null>>;

export type FieldError = {
  field: TargetField;
  value: string | null;
  reason: string;
};

export type NormalizedListing = {
  type: "rent" | "sale";
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number;
  size_sqm: number | null;
  contact_phone: string | null;
  contact_name: string | null;
  contact_channel: string | null;
  external_id: string | null;
  media: string[];
  language: "de" | "en" | "ru" | "el" | "zh" | null;
  dedup_hash: string;
};

export type RowOutcome =
  | { index: number; status: "valid"; normalized: NormalizedListing }
  | { index: number; status: "error"; errors: FieldError[]; raw: Record<string, string> }
  | { index: number; status: "duplicate-in-file"; normalized: NormalizedListing };

// Passes: an enumeration read in many places is not a state, and one owner covers it.
export type Currency = "eur" | "usd" | "gbp";

export function symbol(currency: Currency): string {
  switch (currency) {
    case "eur":
      return "€";
    case "usd":
      return "$";
    case "gbp":
      return "£";
  }
}

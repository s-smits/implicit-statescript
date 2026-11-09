// The scan reports this owner: two other files group its states by hand and one writes them, so a
// new state needs edits in three places.
export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled";

export interface Order {
  id: string;
  status: OrderStatus;
}

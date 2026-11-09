import type { Order } from "./order.ts";

export function ship(order: Order): void {
  order.status = "shipped";
}

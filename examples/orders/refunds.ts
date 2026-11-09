import type { Order } from "./order.ts";

export const canRefund = (order: Order): boolean => ["paid", "shipped"].includes(order.status);

import type { Order } from "./order.ts";

export const isOpen = (order: Order): boolean => order.status === "pending" || order.status === "paid";

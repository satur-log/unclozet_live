export type OrderStatus = "WAITING" | "READY" | "COMPLETED";
export type Delivery = { name: string; address: string; phone: string };
export type CustomerCheck = { id: string; date: string | null; note: string };
export type Customer = {
  id: string;
  instagramId: string;
  delivery: Delivery;
  updatedAt: string;
  lastOrderedAt?: string;
  blocked?: boolean;
  legacyCheckCount?: number;
  checkHistory?: CustomerCheck[];
};
export type Settlement = {
  id: string;
  instagramId: string;
  quantity: number;
  total: number;
  items: string[];
};
export type SettlementError = { line: number; text: string; message: string };
export type Order = {
  id: string;
  instagramId: string;
  settlementId: string | null;
  delivery: Delivery | null;
  status: OrderStatus;
  registrationConfirmed: boolean;
  sourceText: string;
  extractionWarnings: string[];
  conflict: { previous: Delivery; incoming: Delivery; customerId: string } | null;
};
export type Broadcast = {
  id: string;
  title: string;
  memo: string;
  memoDraft: string;
  orderDraft: string;
  settlements: Settlement[];
  settlementErrors: SettlementError[];
  orders: Order[];
  createdAt: string;
  updatedAt: string;
};
export type DashboardState = { version: 2; broadcasts: Broadcast[]; customers: Customer[] };
export type Issue = { code: string; message: string };
export type CustomerImportRecord = { instagramId: string; delivery: Delivery; row: number };
export type CustomerImportSummary = { created: number; updated: number; unchanged: number; total: number };

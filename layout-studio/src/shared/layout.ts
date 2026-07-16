export type LayoutItemKind = "visual" | "text" | "shape" | "image";

export type LayoutItem = {
  id: string;
  name: string;
  kind: LayoutItemKind;
  packageId?: string;
  resourceId?: string;
  resourceRef?: string;
  exportName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  settings: Record<string, unknown>;
};

export type LayoutLayer = {
  id: string;
  name: string;
  kind: "normal" | "event";
  visible: boolean;
  locked: boolean;
  order: number;
  items: LayoutItem[];
};

export type LayoutDocument = {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: LayoutLayer[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type VisualCatalogItem = {
  id: string;
  reference: string;
  packageId: string;
  resourceId: string;
  resourceRef: string;
  title: string;
  description: string | null;
  category: string;
  defaultSize: [number, number];
  remoteCompatible: boolean;
  exportName: string;
};

export type LayoutStudioSnapshot = {
  version: 1;
  activeLayoutId: string;
  active_layout_id: string;
  streamLayoutId: string;
  stream_layout_id: string;
  layouts: LayoutDocument[];
  catalog: VisualCatalogItem[];
  telemetry: unknown;
  generatedAt: string;
};

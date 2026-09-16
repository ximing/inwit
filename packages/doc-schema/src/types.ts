export type PmMarkJson = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type PmJson = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmJson[];
  marks?: PmMarkJson[];
  text?: string;
};

export type DocBlock = {
  index: number;
  pageIndex: number;
  text: string;
};

export type TextRange = {
  from: number;
  to: number;
};

export type AnchorKind = 'card' | 'annotation';

export type EntityAnchor = {
  kind: AnchorKind;
  ids: string[];
  from: number;
  to: number;
};

import type { DetailedHTMLProps, HTMLAttributes, ReactNode } from "react";

declare global {
  interface Window {
    require: (
      modules: string[],
      callback: (...args: unknown[]) => void,
      errback?: (err: unknown) => void,
    ) => void;
  }
}

type CalciteElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  children?: ReactNode;
  [key: string]: unknown;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "calcite-action": CalciteElementProps;
      "calcite-action-bar": CalciteElementProps;
      "calcite-action-group": CalciteElementProps;
      "calcite-action-pad": CalciteElementProps;
      "calcite-block": CalciteElementProps;
      "calcite-block-section": CalciteElementProps;
      "calcite-button": CalciteElementProps;
      "calcite-card": CalciteElementProps;
      "calcite-chip": CalciteElementProps;
      "calcite-icon": CalciteElementProps;
      "calcite-input": CalciteElementProps;
      "calcite-input-text": CalciteElementProps;
      "calcite-label": CalciteElementProps;
      "calcite-loader": CalciteElementProps;
      "calcite-notice": CalciteElementProps;
      "calcite-panel": CalciteElementProps;
      "calcite-shell": CalciteElementProps;
      "calcite-shell-panel": CalciteElementProps;
      "calcite-tooltip": CalciteElementProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "calcite-action": CalciteElementProps;
      "calcite-action-bar": CalciteElementProps;
      "calcite-action-group": CalciteElementProps;
      "calcite-action-pad": CalciteElementProps;
      "calcite-block": CalciteElementProps;
      "calcite-block-section": CalciteElementProps;
      "calcite-button": CalciteElementProps;
      "calcite-card": CalciteElementProps;
      "calcite-chip": CalciteElementProps;
      "calcite-icon": CalciteElementProps;
      "calcite-input": CalciteElementProps;
      "calcite-input-text": CalciteElementProps;
      "calcite-label": CalciteElementProps;
      "calcite-loader": CalciteElementProps;
      "calcite-notice": CalciteElementProps;
      "calcite-panel": CalciteElementProps;
      "calcite-shell": CalciteElementProps;
      "calcite-shell-panel": CalciteElementProps;
      "calcite-tooltip": CalciteElementProps;
    }
  }
}

export {};

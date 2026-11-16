import type { SVGProps } from "react";

/** The Facet suite's diamond, Onyx's mark beside its name. */
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 0.5L11.5 6L6 11.5L0.5 6Z" fill="currentColor" />
    </svg>
  );
}

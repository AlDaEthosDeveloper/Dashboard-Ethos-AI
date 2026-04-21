import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Reports whether the viewport is currently below the mobile breakpoint.
 *
 * @returns `true` when viewport width is below 768px.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    /**
     * Executes `onChange`.
     *
     * @param args Function input.
     * @returns Execution result.
     */
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

import { Fragment } from "react";

export function Ticker({ items, variant = "small" }: { items: string[]; variant?: "small" | "big" }) {
  const big = variant === "big";
  const renderSet = (copy: number) =>
    items.map((item, i) => (
      <div className="ticker-item" key={`${copy}-${i}`} aria-hidden={copy === 1 ? true : undefined}>
        {big ? (
          <Fragment>
            <span className="word">{item}</span>
            {i % 2 === 0 ? <span className="swatch" /> : <span className="sep" />}
          </Fragment>
        ) : (
          <Fragment>
            <span className="micro">{item}</span>
            <span className="ticker-rule" />
          </Fragment>
        )}
      </div>
    ));

  return (
    <div className={big ? "ticker ticker--big" : "ticker"}>
      <div className="ticker-track">
        {renderSet(0)}
        {renderSet(1)}
      </div>
    </div>
  );
}

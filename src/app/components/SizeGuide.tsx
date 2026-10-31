import { InfoPage, ToBeConfirmed, type InfoSection } from "./InfoPage";

const SIZES = ["S", "M", "L", "XL"];

const sections: InfoSection[] = [
  {
    title: "Measurements",
    body: (
      <>
        <div className="overflow-x-auto border border-b10 r-card">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-b10">
                <th className="micro p-3 text-left font-normal text-b60">Size</th>
                <th className="micro p-3 text-left font-normal text-b60">Measurements (cm)</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {SIZES.map((size, idx) => (
                <tr key={size} className={idx < SIZES.length - 1 ? "border-b border-b10" : ""}>
                  <td className="p-3 text-ink">{size}</td>
                  <td className="p-3 text-ink">
                    <ToBeConfirmed />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    title: "How to measure",
    body: (
      <p>
        <ToBeConfirmed />.
      </p>
    ),
  },
];

export function SizeGuide() {
  return (
    <InfoPage
      eyebrow="Help"
      title="Size guide"
      intro="Find your size using the measurements below."
      sections={sections}
    />
  );
}

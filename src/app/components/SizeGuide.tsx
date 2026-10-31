import { InfoPage, ToBeConfirmed, type InfoSection } from "./InfoPage";

const SIZES = [
  { size: "S", chest: "91-96", waist: "76-81" },
  { size: "M", chest: "97-102", waist: "82-87" },
  { size: "L", chest: "103-108", waist: "88-93" },
  { size: "XL", chest: "109-114", waist: "94-99" },
];

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
                <th className="micro p-3 text-left font-normal text-b60">Chest (cm)</th>
                <th className="micro p-3 text-left font-normal text-b60">Waist (cm)</th>
              </tr>
            </thead>
            <tbody>
              {SIZES.map((row, idx) => (
                <tr key={row.size} className={idx < SIZES.length - 1 ? "border-b border-b10" : ""}>
                  <td className="p-3 text-ink">{row.size}</td>
                  <td className="p-3 text-ink">{row.chest}</td>
                  <td className="p-3 text-ink">{row.waist}</td>
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
      intro="Our sizes generally follow standard South African sizing."
      sections={sections}
    />
  );
}
